/**
 * @fileoverview The scope graph, built directly in binary form.
 *
 * This is the storage the walk writes into. There is no `Scope`, `Variable`,
 * `Reference`, or `Definition` object anywhere in it: a scope is thirteen
 * words in a growable buffer, a reference is its eight format words plus one
 * side word, and every list is a chain of `[value, next]` cells in a shared
 * pool. `finish()` compacts all of it into the scope buffer format; the
 * classes with those names exist only on the other side of that buffer, in
 * `toScopeManager()`.
 *
 * The semantics are a port of what the object implementation in `scope.ts`
 * does while closing scopes — the same resolution rule, the same delegation,
 * the same dynamic-scope and `with` behavior, the same implicit-global
 * handling — and the differential corpus is what holds the port to that:
 * every buffer this produces is rehydrated through `toScopeManager()` and
 * compared against the reference implementations.
 *
 * Orderings that are contractual and easy to break:
 *
 * - **References are recorded in walk order** and their buffer IDs are that
 *   order.
 * - **A symbol's reference list is in resolution order** — the order scopes
 *   close — not the order the references were written.
 * - **Symbols are emitted scope by scope in binding order**, with the global
 *   scope's implicit variables at the end, whatever order they were created
 *   in. `finish()` renumbers them; nothing else ever does.
 */

import {
	N_ArrowFunctionExpression,
	N_BlockStatement,
	N_Program,
} from "../parse/index.js";
import { SLOT_C, type AstAccess } from "./ast-access.js";
import {
	DEF_CATCH_CLAUSE,
	DEF_CLASS_NAME,
	DEF_FUNCTION_NAME,
	DEF_IMPLICIT_GLOBAL_VARIABLE,
	DEF_IMPORT_BINDING,
	DEF_PARAMETER,
	DEF_TS_ENUM_MEMBER,
	DEF_TS_ENUM_NAME,
	DEF_TS_MODULE_NAME,
	DEF_TYPE,
	DEF_VARIABLE,
	isImplicitlyStrictType,
	isVariableScopeType,
	SCOPE_BLOCK,
	SCOPE_CATCH,
	SCOPE_CLASS,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FOR,
	SCOPE_FUNCTION,
	SCOPE_FUNCTION_EXPRESSION_NAME,
	SCOPE_FUNCTION_TYPE,
	SCOPE_GLOBAL,
	SCOPE_MAPPED_TYPE,
	SCOPE_MODULE,
	SCOPE_SWITCH,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
	SCOPE_WITH,
	type ScopeType,
} from "./kinds.js";
import type { ResolvedOptions } from "./options.js";
import {
	BUFFER_TREE_HANDLES,
	codeOfDefinitionType,
	codeOfScopeType,
	D_FLAGS,
	D_INDEX,
	D_KIND,
	D_NAME,
	D_NODE,
	D_PARENT,
	D_TYPE,
	DEFINITION_WORDS,
	DF_REST,
	DF_TYPE_DEFINITION,
	DF_VARIABLE_DEFINITION,
	SCOPE_H_DECLARED_BASE,
	SCOPE_H_DECLARED_COUNT,
	SCOPE_H_DEFINITION_COUNT,
	SCOPE_H_DEFINITIONS_BASE,
	SCOPE_H_FLAGS,
	SCOPE_H_IDENT_REF_BASE,
	SCOPE_H_IDENT_REF_COUNT,
	SCOPE_H_JSX_FRAGMENT,
	SCOPE_H_JSX_PRAGMA,
	SCOPE_H_MAGIC,
	SCOPE_H_NODE_SCOPE_BASE,
	SCOPE_H_NODE_SCOPE_COUNT,
	SCOPE_H_OPTIONS,
	SCOPE_H_POOL_BASE,
	SCOPE_H_REFERENCE_COUNT,
	SCOPE_H_REFERENCES_BASE,
	SCOPE_H_SCOPE_COUNT,
	SCOPE_H_SCOPES_BASE,
	SCOPE_H_STRING_BYTES,
	SCOPE_H_STRING_COUNT,
	SCOPE_H_STRINGS_BASE,
	SCOPE_H_SYMBOL_COUNT,
	SCOPE_H_SYMBOLS_BASE,
	SCOPE_H_VERSION,
	SCOPE_HEADER_WORDS,
	OPT_DIALECT_TS,
	OPT_GLOBAL_RETURN,
	OPT_IGNORE_EVAL,
	OPT_IMPLIED_STRICT,
	OPT_JSX,
	OPT_SOURCE_TYPE_COMMONJS,
	OPT_SOURCE_TYPE_MODULE,
	OPT_SOURCE_TYPE_SCRIPT,
	R_FLAGS,
	R_FROM,
	R_IDENTIFIER,
	R_IG_NODE,
	R_IG_PATTERN,
	R_NAME,
	R_RESOLVED,
	R_WRITE_EXPR,
	REFERENCE_WORDS,
	RF_INIT,
	RF_PARTIAL,
	RF_READ,
	RF_TAINTED,
	RF_TYPE,
	RF_VALUE,
	S_BLOCK,
	S_FLAGS,
	S_IMPLICIT,
	S_REFERENCES,
	S_THROUGH,
	S_TYPE,
	S_UPPER,
	S_VARIABLE_SCOPE,
	S_VARIABLES,
	SCOPE_BUFFER_MAGIC,
	SCOPE_BUFFER_VERSION,
	SCOPE_TYPE_CODES,
	SCOPE_WORDS,
	SF_DIRECT_EVAL,
	SF_DYNAMIC,
	SF_FUNCTION_EXPRESSION_SCOPE,
	SF_STRICT,
	SF_THIS_FOUND,
	SYMBOL_WORDS,
	V_DEFINITIONS,
	V_FLAGS,
	V_IDENTIFIERS,
	V_NAME,
	V_REFERENCES,
	V_SCOPE,
	VF_IMPLICIT_GLOBAL,
	VF_STACK,
	VF_TAINTED,
} from "./scope-buffer.js";
import { hasUseStrictDirective } from "./scope.js";

//-----------------------------------------------------------------------------
// Growable word storage
//-----------------------------------------------------------------------------

/**
 * A growable `Uint32Array`.
 */
class U32Vec {
	/** The storage. Only the first `length` words are meaningful. */
	data: Uint32Array;

	/** How many words are in use. */
	length = 0;

	/**
	 * Creates a vector.
	 * @param capacity The initial capacity in words.
	 */
	constructor(capacity: number) {
		this.data = new Uint32Array(capacity);
	}

	/**
	 * Makes room for more words, doubling as needed.
	 * @param extra How many words are about to be written.
	 * @returns The base index the words should be written at.
	 */
	reserve(extra: number): number {
		const base = this.length;
		const needed = base + extra;

		if (needed > this.data.length) {
			let capacity = this.data.length * 2;

			while (capacity < needed) {
				capacity *= 2;
			}

			const grown = new Uint32Array(capacity);

			grown.set(this.data);
			this.data = grown;
		}

		this.length = needed;

		return base;
	}

	/**
	 * Appends one word.
	 * @param value The word to append.
	 * @returns Nothing.
	 */
	push(value: number): void {
		/*
		 * `reserve()` must run before `this.data` is read: in a member
		 * assignment the object is evaluated first, so the one-liner
		 * `this.data[this.reserve(1)] = value` would write into the old,
		 * discarded array whenever the reserve grows it.
		 */
		const base = this.reserve(1);

		this.data[base] = value;
	}
}

//-----------------------------------------------------------------------------
// Build-time record layouts
//-----------------------------------------------------------------------------

/*
 * Scopes and symbols carry their list heads and tails inline while the graph
 * is being built; the format's pool lists are made from these chains in
 * `finish()`. References and definitions are built directly in their format
 * layouts, so emission copies them wholesale.
 */

const BS_WORDS = 13;
const BS_TYPE = 0;
const BS_FLAGS = 1;
const BS_BLOCK = 2;
const BS_UPPER = 3; // scope ID + 1
const BS_VARIABLE_SCOPE = 4;
const BS_VARS_HEAD = 5;
// BS_VARS_HEAD + 1 is the tail; appendTo() relies on tail = head + 1.
const BS_REFS_HEAD = 7;
const BS_THROUGH_HEAD = 9;
const BS_LEFT_HEAD = 11;

/** `BS_FLAGS` bit: the scope's block is the whole program (`globalReturn`). */
const BSF_PROGRAM_BLOCK = 64;

const BV_WORDS = 9;
const BV_NAME = 0;
const BV_SCOPE = 1;
const BV_FLAGS = 2;
const BV_IDENTS_HEAD = 3;
const BV_DEFS_HEAD = 5;
const BV_REFS_HEAD = 7;

/** `BV_FLAGS` bits beyond the serialized `VF_*` set. */
const BVF_TYPE_BINDING = 8;
const BVF_VALUE_BINDING = 16;

/** The `VF_*` subset of symbol flags that is serialized. */
const BVF_SERIALIZED = VF_TAINTED | VF_STACK | VF_IMPLICIT_GLOBAL;

/** Scope type codes whose scopes are their own variable scope, as a bitmask. */
const VARIABLE_SCOPE_MASK = /* @__PURE__ */ SCOPE_TYPE_CODES.reduce(
	(mask, type, code) => (isVariableScopeType(type) ? mask | (1 << code) : mask),
	0,
);

/** Scope type codes that are strict by nature, as a bitmask. */
const IMPLICITLY_STRICT_MASK = /* @__PURE__ */ SCOPE_TYPE_CODES.reduce(
	(mask, type, code) =>
		isImplicitlyStrictType(type) ? mask | (1 << code) : mask,
	0,
);

const CODE_GLOBAL = /* @__PURE__ */ codeOfScopeType(SCOPE_GLOBAL);
const CODE_FUNCTION = /* @__PURE__ */ codeOfScopeType(SCOPE_FUNCTION);
const CODE_BLOCK = /* @__PURE__ */ codeOfScopeType(SCOPE_BLOCK);
const CODE_SWITCH = /* @__PURE__ */ codeOfScopeType(SCOPE_SWITCH);
const CODE_WITH = /* @__PURE__ */ codeOfScopeType(SCOPE_WITH);

const DEF_CODE_CATCH = /* @__PURE__ */ codeOfDefinitionType(DEF_CATCH_CLAUSE);
const DEF_CODE_PARAMETER = /* @__PURE__ */ codeOfDefinitionType(DEF_PARAMETER);
const DEF_CODE_FUNCTION = /* @__PURE__ */ codeOfDefinitionType(
	DEF_FUNCTION_NAME,
);
const DEF_CODE_CLASS = /* @__PURE__ */ codeOfDefinitionType(DEF_CLASS_NAME);
const DEF_CODE_VARIABLE = /* @__PURE__ */ codeOfDefinitionType(DEF_VARIABLE);
const DEF_CODE_IMPORT = /* @__PURE__ */ codeOfDefinitionType(
	DEF_IMPORT_BINDING,
);
const DEF_CODE_IMPLICIT = /* @__PURE__ */ codeOfDefinitionType(
	DEF_IMPLICIT_GLOBAL_VARIABLE,
);
const DEF_CODE_TYPE = /* @__PURE__ */ codeOfDefinitionType(DEF_TYPE);
const DEF_CODE_ENUM = /* @__PURE__ */ codeOfDefinitionType(DEF_TS_ENUM_NAME);
const DEF_CODE_ENUM_MEMBER = /* @__PURE__ */ codeOfDefinitionType(
	DEF_TS_ENUM_MEMBER,
);
const DEF_CODE_MODULE = /* @__PURE__ */ codeOfDefinitionType(
	DEF_TS_MODULE_NAME,
);

/**
 * Sorts an array of `(key, value)` pairs by key, then value, and flattens it.
 * @param pairs The pairs to sort.
 * @returns One word per pair member, sorted.
 */
function sortedPairWords(pairs: [number, number][]): number[] {
	pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	const words: number[] = [];

	for (const [key, value] of pairs) {
		words.push(key, value);
	}

	return words;
}

/**
 * The scope graph under construction, and the walk's whole recording API.
 *
 * @template TNode How one node is represented.
 */
export class ScopeBuilder<TNode> {
	/** How to read the program. */
	readonly ast: AstAccess<TNode>;

	/** The options the analysis runs with. */
	readonly options: ResolvedOptions;

	/** Turns a node into the handle the buffer stores. */
	private readonly handleOf: (node: TNode) => number;

	/** The scope records. */
	private readonly scopes = new U32Vec(16 * BS_WORDS);

	/** The symbol records. */
	private readonly symbols = new U32Vec(32 * BV_WORDS);

	/** The reference records, already in format layout. */
	private readonly refs = new U32Vec(64 * REFERENCE_WORDS);

	/** The start offset of each reference's identifier. */
	private readonly refStarts = new U32Vec(64);

	/** The definition records, already in format layout. */
	private readonly defs = new U32Vec(32 * DEFINITION_WORDS);

	/** The start offset of each definition's name. */
	private readonly defStarts = new U32Vec(32);

	/**
	 * The cell pool every list is chained through. A cell is two words,
	 * `[value, next]`; cell `0` is a sentinel so `0` can mean "no cell".
	 */
	private readonly cells = new U32Vec(256);

	/** Every distinct string, in the order it was first seen. */
	private readonly strings: string[] = [];

	/** The ID each string was assigned. */
	private readonly stringIds = new Map<string, number>();

	/** Each scope's bindings by name ID, created on the first binding. */
	private readonly bindings: (Map<number, number> | null)[] = [];

	/** Each scope's block node, for strictness and body-position checks. */
	private readonly blocks: TNode[] = [];

	/** Each symbol's first declaring identifier node, or `null`. */
	private readonly firstIdentifiers: (TNode | null)[] = [];

	/** The scope being filled in right now, or `-1` once analysis ends. */
	private current = -1;

	/** How many scopes exist. */
	private scopeCount = 0;

	/** How many symbols exist. */
	private symbolCount = 0;

	/** How many references exist. */
	private refCount = 0;

	/** How many definitions exist. */
	private defCount = 0;

	/** The global scope's implicit variables, by name ID. */
	private readonly implicitByName = new Map<number, number>();

	/** Head cell of the implicit variable list. */
	private implicitHead = 0;

	/** Tail cell of the implicit variable list. */
	private implicitTail = 0;

	/** Head cell of each declaring node's symbol list, by node handle. */
	private readonly declaredHeads = new Map<number, number>();

	/** Tail cell of each declaring node's symbol list, by node handle. */
	private readonly declaredTails = new Map<number, number>();

	/**
	 * Creates an empty builder.
	 * @param ast How to read the program.
	 * @param options The options the analysis runs with.
	 * @param handleOf Turns a node into the handle the buffer stores.
	 */
	constructor(
		ast: AstAccess<TNode>,
		options: ResolvedOptions,
		handleOf: (node: TNode) => number,
	) {
		this.ast = ast;
		this.options = options;
		this.handleOf = handleOf;

		// Cell 0 is the "no cell" sentinel.
		this.cells.push(0);
		this.cells.push(0);
	}

	//-------------------------------------------------------------------------
	// Options
	//-------------------------------------------------------------------------

	/**
	 * Whether the program is an ES module.
	 * @returns `true` for `sourceType: "module"`.
	 */
	isModule(): boolean {
		return this.options.sourceType === "module";
	}

	/**
	 * Whether the program runs inside an implicit function, the way a
	 * CommonJS module does.
	 * @returns `true` when an extra function scope wraps the program.
	 */
	isGlobalReturn(): boolean {
		return (
			this.options.globalReturn || this.options.sourceType === "commonjs"
		);
	}

	/**
	 * Whether strict mode applies without a directive saying so.
	 * @returns `true` when strict mode is implied.
	 */
	isImpliedStrict(): boolean {
		return this.options.impliedStrict;
	}

	//-------------------------------------------------------------------------
	// Cells and strings
	//-------------------------------------------------------------------------

	/**
	 * Appends a value to a chained list held in a record. The list's tail
	 * field must sit one word after its head field.
	 * @param vec The record storage holding the head and tail.
	 * @param base The record's base word.
	 * @param headField The head field's offset within the record.
	 * @param value The value to append.
	 * @returns Nothing.
	 */
	private appendTo(
		vec: U32Vec,
		base: number,
		headField: number,
		value: number,
	): void {
		const cells = this.cells;
		const cell = cells.reserve(2);

		cells.data[cell] = value;
		cells.data[cell + 1] = 0;

		const tail = vec.data[base + headField + 1];

		if (tail === 0) {
			vec.data[base + headField] = cell;
		} else {
			cells.data[tail + 1] = cell;
		}

		vec.data[base + headField + 1] = cell;
	}

	/**
	 * The ID for a string, assigning one the first time it appears.
	 * @param value The string to intern.
	 * @returns Its ID.
	 */
	private intern(value: string): number {
		let id = this.stringIds.get(value);

		if (id === undefined) {
			id = this.strings.length;
			this.stringIds.set(value, id);
			this.strings.push(value);
		}

		return id;
	}

	//-------------------------------------------------------------------------
	// Nesting
	//-------------------------------------------------------------------------

	/**
	 * Opens a scope inside the current one and makes it current.
	 * @param type The scope type to open.
	 * @param block The node of the syntax opening it.
	 * @param isMethodDefinition Whether the scope is a method body.
	 * @returns The new scope's ID.
	 */
	private nest(
		type: ScopeType,
		block: TNode,
		isMethodDefinition = false,
	): number {
		const code = codeOfScopeType(type);
		const id = this.scopeCount++;
		const base = this.scopes.reserve(BS_WORDS);
		const words = this.scopes.data;
		const upper = this.current;
		let flags = 0;

		if (code === CODE_GLOBAL || code === CODE_WITH) {
			flags |= SF_DYNAMIC;
		}

		if (
			code === CODE_FUNCTION &&
			this.ast.kind(block) === N_Program
		) {
			flags |= BSF_PROGRAM_BLOCK;
		}

		if (this.isStrictScope(code, upper, block, isMethodDefinition, flags)) {
			flags |= SF_STRICT;
		}

		words[base + BS_TYPE] = code;
		words[base + BS_FLAGS] = flags;
		words[base + BS_BLOCK] = this.handleOf(block);
		words[base + BS_UPPER] = upper + 1;
		words[base + BS_VARIABLE_SCOPE] =
			(VARIABLE_SCOPE_MASK >> code) & 1
				? id
				: this.scopes.data[upper * BS_WORDS + BS_VARIABLE_SCOPE];

		this.bindings.push(null);
		this.blocks.push(block);
		this.current = id;

		return id;
	}

	/**
	 * Decides whether a scope runs under strict mode, exactly the way the
	 * object implementation's `isStrictScope()` does.
	 * @param code The scope type code.
	 * @param upper The enclosing scope's ID, or `-1`.
	 * @param block The node of the syntax that opened the scope.
	 * @param isMethodDefinition Whether the scope is a method body.
	 * @param flags The flags computed so far.
	 * @returns `true` when strict mode rules apply.
	 */
	private isStrictScope(
		code: number,
		upper: number,
		block: TNode,
		isMethodDefinition: boolean,
		flags: number,
	): boolean {
		// Strictness is inherited, so an enclosing strict scope settles it.
		if (
			upper !== -1 &&
			(this.scopes.data[upper * BS_WORDS + BS_FLAGS] & SF_STRICT) !== 0
		) {
			return true;
		}

		if (isMethodDefinition || ((IMPLICITLY_STRICT_MASK >> code) & 1) === 1) {
			return true;
		}

		if (code === CODE_BLOCK || code === CODE_SWITCH) {
			return false;
		}

		const ast = this.ast;
		let body: TNode | null;

		if (code === CODE_FUNCTION) {
			if ((flags & BSF_PROGRAM_BLOCK) !== 0) {
				body = block;
			} else {
				body = ast.child(block, SLOT_C);

				/*
				 * An expression-bodied arrow has no statement list, so it has
				 * no prologue and cannot turn strict mode on by itself.
				 */
				if (
					ast.kind(block) === N_ArrowFunctionExpression &&
					(body === null || ast.kind(body) !== N_BlockStatement)
				) {
					return false;
				}
			}

			if (body === null) {
				return false;
			}
		} else if (code === CODE_GLOBAL) {
			body = block;
		} else {
			return false;
		}

		return hasUseStrictDirective(ast, body);
	}

	/**
	 * Opens the global scope.
	 * @param block The `Program` node.
	 * @returns Nothing.
	 */
	nestGlobalScope(block: TNode): void {
		this.nest(SCOPE_GLOBAL, block);
	}

	/**
	 * Opens a module scope.
	 * @param block The `Program` node.
	 * @returns Nothing.
	 */
	nestModuleScope(block: TNode): void {
		this.nest(SCOPE_MODULE, block);
	}

	/**
	 * Opens a function scope, binding `arguments` unless the function is an
	 * arrow.
	 * @param block The function node.
	 * @param isMethodDefinition Whether the function is a method body.
	 * @returns Nothing.
	 */
	nestFunctionScope(block: TNode, isMethodDefinition: boolean): void {
		const id = this.nest(SCOPE_FUNCTION, block, isMethodDefinition);

		/*
		 * Section 10.2.11, FunctionDeclarationInstantiation. An arrow function
		 * has no `arguments` object of its own, so a mention of the name in
		 * one belongs to the enclosing function.
		 */
		if (this.ast.kind(block) !== N_ArrowFunctionExpression) {
			this.bindSymbol(id, null, this.intern("arguments"));
		}
	}

	/**
	 * Opens the scope that holds a named function expression's own name.
	 * @param block The `FunctionExpression` node.
	 * @returns Nothing.
	 */
	nestFunctionExpressionNameScope(block: TNode): void {
		const id = this.nest(SCOPE_FUNCTION_EXPRESSION_NAME, block);

		this.scopes.data[id * BS_WORDS + BS_FLAGS] |=
			SF_FUNCTION_EXPRESSION_SCOPE;
	}

	/**
	 * Opens a block scope.
	 * @param block The `BlockStatement` node.
	 * @returns Nothing.
	 */
	nestBlockScope(block: TNode): void {
		this.nest(SCOPE_BLOCK, block);
	}

	/**
	 * Opens a `switch` scope.
	 * @param block The `SwitchStatement` node.
	 * @returns Nothing.
	 */
	nestSwitchScope(block: TNode): void {
		this.nest(SCOPE_SWITCH, block);
	}

	/**
	 * Opens a `catch` scope.
	 * @param block The `CatchClause` node.
	 * @returns Nothing.
	 */
	nestCatchScope(block: TNode): void {
		this.nest(SCOPE_CATCH, block);
	}

	/**
	 * Opens a `with` scope.
	 * @param block The `WithStatement` node.
	 * @returns Nothing.
	 */
	nestWithScope(block: TNode): void {
		this.nest(SCOPE_WITH, block);
	}

	/**
	 * Opens the scope of a `for` statement's own bindings.
	 * @param block The loop node.
	 * @returns Nothing.
	 */
	nestForScope(block: TNode): void {
		this.nest(SCOPE_FOR, block);
	}

	/**
	 * Opens a class scope.
	 * @param block The class node.
	 * @returns Nothing.
	 */
	nestClassScope(block: TNode): void {
		this.nest(SCOPE_CLASS, block);
	}

	/**
	 * Opens the scope a class field initializer runs in.
	 * @param block The initializer expression node.
	 * @returns Nothing.
	 */
	nestClassFieldInitializerScope(block: TNode): void {
		this.nest(SCOPE_CLASS_FIELD_INITIALIZER, block, true);
	}

	/**
	 * Opens the scope of a `static` block.
	 * @param block The `StaticBlock` node.
	 * @returns Nothing.
	 */
	nestClassStaticBlockScope(block: TNode): void {
		this.nest(SCOPE_CLASS_STATIC_BLOCK, block, true);
	}

	/**
	 * Opens the scope holding a type alias or interface's type parameters.
	 * @param block The declaration node.
	 * @returns Nothing.
	 */
	nestTypeScope(block: TNode): void {
		this.nest(SCOPE_TYPE, block);
	}

	/**
	 * Opens the scope of a function type's parameters.
	 * @param block The function type node.
	 * @returns Nothing.
	 */
	nestFunctionTypeScope(block: TNode): void {
		this.nest(SCOPE_FUNCTION_TYPE, block);
	}

	/**
	 * Opens the scope a conditional type's `infer` names belong to.
	 * @param block The `TSConditionalType` node.
	 * @returns Nothing.
	 */
	nestConditionalTypeScope(block: TNode): void {
		this.nest(SCOPE_CONDITIONAL_TYPE, block);
	}

	/**
	 * Opens the scope of a mapped type's key.
	 * @param block The `TSMappedType` node.
	 * @returns Nothing.
	 */
	nestMappedTypeScope(block: TNode): void {
		this.nest(SCOPE_MAPPED_TYPE, block);
	}

	/**
	 * Opens the scope of an enum's members.
	 * @param block The `TSEnumDeclaration` node.
	 * @returns Nothing.
	 */
	nestTSEnumScope(block: TNode): void {
		this.nest(SCOPE_TS_ENUM, block);
	}

	/**
	 * Opens the scope of a namespace or module body.
	 * @param block The `TSModuleDeclaration` node.
	 * @returns Nothing.
	 */
	nestTSModuleScope(block: TNode): void {
		this.nest(SCOPE_TS_MODULE, block);
	}

	//-------------------------------------------------------------------------
	// The current scope
	//-------------------------------------------------------------------------

	/**
	 * The scope being filled in right now.
	 * @returns Its ID, or `-1` once every scope has closed.
	 */
	currentScope(): number {
		return this.current;
	}

	/**
	 * The node that opened the current scope.
	 * @returns The block node.
	 */
	currentBlock(): TNode {
		return this.blocks[this.current];
	}

	/**
	 * The nearest enclosing scope a `var` declaration binds in.
	 * @returns Its ID.
	 */
	currentVariableScope(): number {
		return this.scopes.data[
			this.current * BS_WORDS + BS_VARIABLE_SCOPE
		];
	}

	/**
	 * Whether strict mode rules apply in the current scope.
	 * @returns `true` when the current scope is strict.
	 */
	isStrict(): boolean {
		return (
			(this.scopes.data[this.current * BS_WORDS + BS_FLAGS] &
				SF_STRICT) !==
			0
		);
	}

	/**
	 * Overrides the current scope's strictness, which `visitProgram()` does
	 * for `globalReturn` and `impliedStrict`.
	 * @param strict The strictness to record.
	 * @returns Nothing.
	 */
	setStrict(strict: boolean): void {
		const at = this.current * BS_WORDS + BS_FLAGS;

		if (strict) {
			this.scopes.data[at] |= SF_STRICT;
		} else {
			this.scopes.data[at] &= ~SF_STRICT;
		}
	}

	/**
	 * The kind of a scope.
	 * @param scope The scope ID.
	 * @returns The scope type.
	 */
	scopeType(scope: number): ScopeType {
		return SCOPE_TYPE_CODES[this.scopes.data[scope * BS_WORDS + BS_TYPE]];
	}

	/**
	 * The enclosing scope.
	 * @param scope The scope ID.
	 * @returns The enclosing scope's ID, or `-1` for the global scope.
	 */
	upperOf(scope: number): number {
		return this.scopes.data[scope * BS_WORDS + BS_UPPER] - 1;
	}

	/**
	 * Records that `this` is mentioned in the current variable scope.
	 * @returns Nothing.
	 */
	detectThis(): void {
		this.scopes.data[
			this.currentVariableScope() * BS_WORDS + BS_FLAGS
		] |= SF_THIS_FOUND;
	}

	/**
	 * Marks the current variable scope, and everything around it, as
	 * containing a direct call to `eval`.
	 * @returns Nothing.
	 */
	detectEval(): void {
		const words = this.scopes.data;
		let scope = this.currentVariableScope();

		words[scope * BS_WORDS + BS_FLAGS] |= SF_DIRECT_EVAL;

		while (scope !== -1) {
			words[scope * BS_WORDS + BS_FLAGS] |= SF_DYNAMIC;
			scope = words[scope * BS_WORDS + BS_UPPER] - 1;
		}
	}

	//-------------------------------------------------------------------------
	// Declaring
	//-------------------------------------------------------------------------

	/**
	 * Binds a name in a scope, creating the symbol the first time the name is
	 * seen there.
	 * @param scope The scope to bind in.
	 * @param identifier The `Identifier` node, or `null` when the binding has
	 *      no identifier of its own, as `arguments` does not.
	 * @param nameId The interned name.
	 * @returns The symbol the name is bound to.
	 */
	private bindSymbol(
		scope: number,
		identifier: TNode | null,
		nameId: number,
	): number {
		let map = this.bindings[scope];

		if (map === null) {
			map = new Map();
			this.bindings[scope] = map;
		}

		let symbol = map.get(nameId);

		if (symbol === undefined) {
			symbol = this.newSymbol(scope, nameId, VF_STACK);
			map.set(nameId, symbol);
			this.appendTo(
				this.scopes,
				scope * BS_WORDS,
				BS_VARS_HEAD,
				symbol,
			);
		}

		if (identifier !== null) {
			this.appendTo(
				this.symbols,
				symbol * BV_WORDS,
				BV_IDENTS_HEAD,
				this.handleOf(identifier),
			);

			if (this.firstIdentifiers[symbol] === null) {
				this.firstIdentifiers[symbol] = identifier;
			}
		}

		return symbol;
	}

	/**
	 * Creates a bare symbol record.
	 * @param scope The scope that owns it.
	 * @param nameId The interned name.
	 * @param flags Its initial flags.
	 * @returns The new symbol's ID.
	 */
	private newSymbol(scope: number, nameId: number, flags: number): number {
		const symbol = this.symbolCount++;
		const base = this.symbols.reserve(BV_WORDS);
		const words = this.symbols.data;

		words[base + BV_NAME] = nameId;
		words[base + BV_SCOPE] = scope;
		words[base + BV_FLAGS] = flags;
		this.firstIdentifiers.push(null);

		return symbol;
	}

	/**
	 * Records one definition of a symbol and files it under its declaring
	 * nodes.
	 * @param symbol The symbol being defined.
	 * @param type The definition type code.
	 * @param name The `Identifier` (or `Literal`) node that spells the name.
	 * @param node The node that declares it.
	 * @param parent The enclosing statement, or `null`.
	 * @param index The position within a multi-declarator statement, or `-1`.
	 * @param kindId The interned declaration keyword plus one, or `0`.
	 * @param flags The definition's `DF_*` flags.
	 * @returns Nothing.
	 */
	private addDefinition(
		symbol: number,
		type: number,
		name: TNode,
		node: TNode,
		parent: TNode | null,
		index: number,
		kindId: number,
		flags: number,
	): void {
		const definition = this.defCount++;
		const base = this.defs.reserve(DEFINITION_WORDS);
		const words = this.defs.data;

		words[base + D_TYPE] = type;
		words[base + D_NAME] = this.handleOf(name);
		words[base + D_NODE] = this.handleOf(node);
		words[base + D_PARENT] = parent === null ? 0 : this.handleOf(parent);
		words[base + D_INDEX] = index + 1;
		words[base + D_KIND] = kindId;
		words[base + D_FLAGS] = flags;
		this.defStarts.push(this.ast.start(name));

		this.appendTo(this.symbols, symbol * BV_WORDS, BV_DEFS_HEAD, definition);

		const symbolFlags = symbol * BV_WORDS + BV_FLAGS;

		if ((flags & DF_TYPE_DEFINITION) !== 0) {
			this.symbols.data[symbolFlags] |= BVF_TYPE_BINDING;
		}

		if ((flags & DF_VARIABLE_DEFINITION) !== 0) {
			this.symbols.data[symbolFlags] |= BVF_VALUE_BINDING;
		}

		this.declareOn(node, symbol);

		if (parent !== null) {
			this.declareOn(parent, symbol);
		}
	}

	/**
	 * Files a symbol under a declaring node for `getDeclaredVariables()`.
	 * @param node The declaring node.
	 * @param symbol The symbol it declares.
	 * @returns Nothing.
	 */
	private declareOn(node: TNode, symbol: number): void {
		this.declareOnHandle(this.handleOf(node), symbol);
	}

	/**
	 * Binds a name declared by `var`, `let`, or `const`.
	 * @param scope The scope the binding lands in.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param declarator The `VariableDeclarator` node.
	 * @param declaration The `VariableDeclaration` node.
	 * @param index The declarator's position within the declaration.
	 * @param kind The declaration keyword.
	 * @returns Nothing.
	 */
	defineVariable(
		scope: number,
		id: TNode,
		name: string,
		declarator: TNode,
		declaration: TNode,
		index: number,
		kind: string,
	): void {
		this.addDefinition(
			this.bindSymbol(scope, id, this.intern(name)),
			DEF_CODE_VARIABLE,
			id,
			declarator,
			declaration,
			index,
			this.intern(kind) + 1,
			DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds a function parameter in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param func The function node the parameter belongs to.
	 * @param index The parameter's position in the list.
	 * @param rest Whether the name came from a rest element.
	 * @returns Nothing.
	 */
	defineParameter(
		id: TNode,
		name: string,
		func: TNode,
		index: number,
		rest: boolean,
	): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_PARAMETER,
			id,
			func,
			null,
			index,
			0,
			DF_VARIABLE_DEFINITION | (rest ? DF_REST : 0),
		);
	}

	/**
	 * Binds a function's own name in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param func The function node.
	 * @returns Nothing.
	 */
	defineFunctionName(id: TNode, name: string, func: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_FUNCTION,
			id,
			func,
			null,
			-1,
			0,
			DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds a class's own name in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param node The class node.
	 * @returns Nothing.
	 */
	defineClassName(id: TNode, name: string, node: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_CLASS,
			id,
			node,
			null,
			-1,
			0,
			DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds a `catch` clause parameter in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param node The `CatchClause` node.
	 * @returns Nothing.
	 */
	defineCatchClause(id: TNode, name: string, node: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_CATCH,
			id,
			node,
			null,
			-1,
			0,
			DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds an imported name in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param specifier The specifier node, or the `TSImportEqualsDeclaration`.
	 * @param declaration The `ImportDeclaration` node.
	 * @returns Nothing.
	 */
	defineImportBinding(
		id: TNode,
		name: string,
		specifier: TNode,
		declaration: TNode,
	): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_IMPORT,
			id,
			specifier,
			declaration,
			-1,
			0,
			DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds a type-only name — an interface, a type alias, a type parameter —
	 * in a scope.
	 * @param scope The scope the binding lands in.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param node The declaring node.
	 * @returns Nothing.
	 */
	defineType(scope: number, id: TNode, name: string, node: TNode): void {
		this.addDefinition(
			this.bindSymbol(scope, id, this.intern(name)),
			DEF_CODE_TYPE,
			id,
			node,
			null,
			-1,
			0,
			DF_TYPE_DEFINITION,
		);
	}

	/**
	 * Binds an enum's own name in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param node The `TSEnumDeclaration` node.
	 * @returns Nothing.
	 */
	defineEnumName(id: TNode, name: string, node: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_ENUM,
			id,
			node,
			null,
			-1,
			0,
			DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds one enum member in the current scope.
	 * @param id The `Identifier` node naming the member.
	 * @param name The name it spells.
	 * @param member The `TSEnumMember` node.
	 * @returns Nothing.
	 */
	defineEnumMember(id: TNode, name: string, member: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_ENUM_MEMBER,
			id,
			member,
			null,
			-1,
			0,
			DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds an enum member whose name a string literal spells, which has no
	 * identifier of its own.
	 * @param name The name the literal spells.
	 * @param literal The `Literal` node.
	 * @param member The `TSEnumMember` node.
	 * @returns Nothing.
	 */
	defineEnumMemberLiteral(name: string, literal: TNode, member: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, null, this.intern(name)),
			DEF_CODE_ENUM_MEMBER,
			literal,
			member,
			null,
			-1,
			0,
			DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
		);
	}

	/**
	 * Binds a namespace or module's own name in the current scope.
	 * @param id The `Identifier` node.
	 * @param name The name it spells.
	 * @param node The `TSModuleDeclaration` node.
	 * @returns Nothing.
	 */
	defineModuleName(id: TNode, name: string, node: TNode): void {
		this.addDefinition(
			this.bindSymbol(this.current, id, this.intern(name)),
			DEF_CODE_MODULE,
			id,
			node,
			null,
			-1,
			0,
			DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
		);
	}

	//-------------------------------------------------------------------------
	// Referencing
	//-------------------------------------------------------------------------

	/**
	 * Records a reference in a scope and queues it for resolution there.
	 * @param scope The scope the occurrence was written in.
	 * @param identifier The identifier node.
	 * @param nameId The interned name.
	 * @param flags The reference's `RF_*` flags.
	 * @param writeExpr The expression assigned, for a write, or `null`.
	 * @param igPattern The pattern of an undeclared assignment, or `null`.
	 * @param igNode The assignment that assigns it, or `null`.
	 * @returns Nothing.
	 */
	private addReference(
		scope: number,
		identifier: TNode,
		nameId: number,
		flags: number,
		writeExpr: TNode | null,
		igPattern: TNode | null,
		igNode: TNode | null,
	): void {
		const reference = this.refCount++;
		const base = this.refs.reserve(REFERENCE_WORDS);
		const words = this.refs.data;

		words[base + R_IDENTIFIER] = this.handleOf(identifier);
		words[base + R_NAME] = nameId;
		words[base + R_FROM] = scope;
		words[base + R_RESOLVED] = 0;
		words[base + R_FLAGS] = flags;
		words[base + R_WRITE_EXPR] =
			writeExpr === null ? 0 : this.handleOf(writeExpr);
		words[base + R_IG_PATTERN] =
			igPattern === null ? 0 : this.handleOf(igPattern);
		words[base + R_IG_NODE] = igNode === null ? 0 : this.handleOf(igNode);
		this.refStarts.push(this.ast.start(identifier));

		const scopeBase = scope * BS_WORDS;

		this.appendTo(this.scopes, scopeBase, BS_REFS_HEAD, reference);
		this.appendTo(this.scopes, scopeBase, BS_LEFT_HEAD, reference);
	}

	/**
	 * Records a read of a name used as a value, in the current scope.
	 * @param identifier The identifier node.
	 * @param name The name it spells.
	 * @returns Nothing.
	 */
	referenceRead(identifier: TNode, name: string): void {
		this.addReference(
			this.current,
			identifier,
			this.intern(name),
			RF_READ | RF_VALUE,
			null,
			null,
			null,
		);
	}

	/**
	 * Records an occurrence of a name used as a value, in the current scope.
	 * @param identifier The identifier node.
	 * @param name The name it spells.
	 * @param flag The read/write mode, `READ`, `WRITE`, or `READ_WRITE`.
	 * @param writeExpr The expression assigned, for a write, or `null`.
	 * @param igNode The undeclared assignment's statement, or `null`.
	 * @param partial Whether a write sets only part of the assigned value.
	 * @param init Whether a write initializes a declaration.
	 * @returns Nothing.
	 */
	referenceValue(
		identifier: TNode,
		name: string,
		flag: number,
		writeExpr: TNode | null,
		igNode: TNode | null,
		partial: boolean,
		init: boolean,
	): void {
		/*
		 * `READ` and `WRITE` are numerically `RF_READ` and `RF_WRITE`, so the
		 * mode is the flags' low bits as-is.
		 */
		this.addReference(
			this.current,
			identifier,
			this.intern(name),
			flag |
				RF_VALUE |
				(partial ? RF_PARTIAL : 0) |
				(init ? RF_INIT : 0),
			writeExpr,
			igNode === null ? null : identifier,
			igNode,
		);
	}

	/**
	 * Records an occurrence of a name used as a type, in the current scope.
	 * @param identifier The identifier node.
	 * @param name The name it spells.
	 * @returns Nothing.
	 */
	referenceType(identifier: TNode, name: string): void {
		this.addReference(
			this.current,
			identifier,
			this.intern(name),
			RF_READ | RF_TYPE,
			null,
			null,
			null,
		);
	}

	/**
	 * Records an occurrence that could name either a value or a type, which
	 * is what a bare `export { x }` does.
	 * @param identifier The identifier node.
	 * @param name The name it spells.
	 * @returns Nothing.
	 */
	referenceDualValueType(identifier: TNode, name: string): void {
		this.addReference(
			this.current,
			identifier,
			this.intern(name),
			RF_READ | RF_VALUE | RF_TYPE,
			null,
			null,
			null,
		);
	}

	/**
	 * References a name in whichever enclosing scope declares it, which is
	 * how a configured JSX factory is marked as used.
	 * @param name The name to reference.
	 * @returns `true` when some scope declared the name.
	 */
	referenceIfDeclared(name: string): boolean {
		const nameId = this.stringIds.get(name);

		if (nameId === undefined) {
			return false;
		}

		for (let scope = this.current; scope !== -1; scope = this.upperOf(scope)) {
			const symbol = this.bindings[scope]?.get(nameId);

			if (symbol !== undefined) {
				const identifier = this.firstIdentifiers[symbol];

				if (identifier !== null) {
					this.addReference(
						scope,
						identifier,
						nameId,
						RF_READ | RF_VALUE,
						null,
						null,
						null,
					);
				}

				return true;
			}
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Closing
	//-------------------------------------------------------------------------

	/**
	 * Resolves everything queued on the current scope and makes its parent
	 * current, exactly the way `Scope#close()` does.
	 * @returns Nothing.
	 */
	closeCurrent(): void {
		const scope = this.current;
		const base = scope * BS_WORDS;
		const words = this.scopes.data;
		const code = words[base + BS_TYPE];
		const flags = words[base + BS_FLAGS];

		if (code === CODE_GLOBAL) {
			this.closeGlobal(scope);
			this.resolveLeft(scope, true);
		} else if (
			code === CODE_WITH &&
			(flags & SF_DYNAMIC) !== 0
		) {
			/*
			 * A `with` body whose object is not statically known cannot
			 * resolve anything: every name in it might be a property of that
			 * object. The references are marked so a consumer can tell a
			 * resolution it can trust from one it cannot.
			 *
			 * Delegating appends cells, which can grow the pool, so the
			 * chain is always read through `cells.data` rather than a
			 * cached array.
			 */
			const cells = this.cells;

			for (
				let cell = words[base + BS_LEFT_HEAD];
				cell !== 0;
				cell = cells.data[cell + 1]
			) {
				const reference = cells.data[cell];

				this.refs.data[reference * REFERENCE_WORDS + R_FLAGS] |=
					RF_TAINTED;
				this.delegate(scope, reference);
			}
		} else {
			this.resolveLeft(scope, (flags & SF_DYNAMIC) === 0);
		}

		words[base + BS_LEFT_HEAD] = 0;
		words[base + BS_LEFT_HEAD + 1] = 0;
		this.current = words[base + BS_UPPER] - 1;
	}

	/**
	 * Resolves every queued reference, or files them all as passing through
	 * when the scope is dynamic.
	 * @param scope The scope being closed.
	 * @param isStatic Whether references here can be resolved from the source
	 *      alone.
	 * @returns Nothing.
	 */
	private resolveLeft(scope: number, isStatic: boolean): void {
		/*
		 * Resolution and delegation append cells, which can grow the pool,
		 * so the chain is always read through `cells.data` rather than a
		 * cached array. The scope records never grow during a close.
		 */
		const words = this.scopes.data;
		const cells = this.cells;

		for (
			let cell = words[scope * BS_WORDS + BS_LEFT_HEAD];
			cell !== 0;
			cell = cells.data[cell + 1]
		) {
			const reference = cells.data[cell];

			if (isStatic) {
				if (!this.resolve(scope, reference)) {
					this.delegate(scope, reference);
				}
			} else {
				// Every enclosing scope has to see a name it might not own.
				for (
					let current = scope;
					current !== -1;
					current = words[current * BS_WORDS + BS_UPPER] - 1
				) {
					this.appendTo(
						this.scopes,
						current * BS_WORDS,
						BS_THROUGH_HEAD,
						reference,
					);
				}
			}
		}
	}

	/**
	 * Links a reference to the symbol it names, if this scope binds it.
	 * @param scope The scope being closed.
	 * @param reference The reference to resolve.
	 * @returns `true` when the reference was resolved here.
	 */
	private resolve(scope: number, reference: number): boolean {
		const map = this.bindings[scope];

		if (map === null) {
			return false;
		}

		const refBase = reference * REFERENCE_WORDS;
		const refWords = this.refs.data;
		const symbol = map.get(refWords[refBase + R_NAME]);

		if (symbol === undefined) {
			return false;
		}

		if (!this.isValidResolution(scope, reference, symbol)) {
			return false;
		}

		/*
		 * A name can be bound as a type, as a value, or as both, and a
		 * reference names one or the other. An interface does not satisfy a
		 * reference from expression position, and the search has to continue
		 * outward for a value of the same name.
		 */
		const refFlags = refWords[refBase + R_FLAGS];
		const symbolBase = symbol * BV_WORDS;
		const symbolWords = this.symbols.data;
		let symbolFlags = symbolWords[symbolBase + BV_FLAGS];
		const bindingBits =
			symbolWords[symbolBase + BV_DEFS_HEAD] === 0
				? BVF_TYPE_BINDING | BVF_VALUE_BINDING
				: symbolFlags;

		if (
			!(
				(refFlags & RF_TYPE) !== 0 &&
				(bindingBits & BVF_TYPE_BINDING) !== 0
			) &&
			!(
				(refFlags & RF_VALUE) !== 0 &&
				(bindingBits & BVF_VALUE_BINDING) !== 0
			)
		) {
			return false;
		}

		this.appendTo(this.symbols, symbolBase, BV_REFS_HEAD, reference);

		const scopeWords = this.scopes.data;
		const fromScope = refWords[refBase + R_FROM];

		if (
			scopeWords[fromScope * BS_WORDS + BS_VARIABLE_SCOPE] !==
			scopeWords[scope * BS_WORDS + BS_VARIABLE_SCOPE]
		) {
			symbolFlags &= ~VF_STACK;
		}

		if ((refFlags & RF_TAINTED) !== 0) {
			symbolFlags |= VF_TAINTED;
		}

		symbolWords[symbolBase + BV_FLAGS] = symbolFlags;
		refWords[refBase + R_RESOLVED] = symbol + 1;

		return true;
	}

	/**
	 * Rejects the resolutions that are lexically impossible.
	 *
	 * A default parameter value is evaluated before the body's bindings
	 * exist, so in `function f(a = x) { const x = 2; }` the `x` belongs to
	 * whatever encloses `f`, not to the body.
	 * @param scope The scope being closed.
	 * @param reference The reference being resolved.
	 * @param symbol The candidate symbol.
	 * @returns `true` when the reference may resolve to the symbol.
	 */
	private isValidResolution(
		scope: number,
		reference: number,
		symbol: number,
	): boolean {
		const base = scope * BS_WORDS;
		const words = this.scopes.data;

		if (words[base + BS_TYPE] !== CODE_FUNCTION) {
			return true;
		}

		// With `globalReturn`, the function scope's block is the program.
		if ((words[base + BS_FLAGS] & BSF_PROGRAM_BLOCK) !== 0) {
			return true;
		}

		const ast = this.ast;
		const body = ast.child(this.blocks[scope], SLOT_C);
		const bodyStart = body === null ? -1 : ast.start(body);

		if (
			this.symbols.data[symbol * BV_WORDS + BV_SCOPE] !== scope ||
			this.refStarts.data[reference] >= bodyStart
		) {
			return true;
		}

		// Valid only if some declaration sits before the body: a parameter.
		const cells = this.cells.data;

		for (
			let cell = this.symbols.data[symbol * BV_WORDS + BV_DEFS_HEAD];
			cell !== 0;
			cell = cells[cell + 1]
		) {
			if (this.defStarts.data[cells[cell]] < bodyStart) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Passes a reference this scope could not resolve to the enclosing one.
	 * @param scope The scope that failed to resolve it.
	 * @param reference The unresolved reference.
	 * @returns Nothing.
	 */
	private delegate(scope: number, reference: number): void {
		const base = scope * BS_WORDS;
		const upper = this.scopes.data[base + BS_UPPER] - 1;

		if (upper !== -1) {
			this.appendTo(
				this.scopes,
				upper * BS_WORDS,
				BS_LEFT_HEAD,
				reference,
			);
		}

		this.appendTo(this.scopes, base, BS_THROUGH_HEAD, reference);
	}

	/**
	 * Turns the assignments to undeclared names into implicit global
	 * variables, which is the only way a name enters the global scope
	 * without a declaration.
	 * @param scope The global scope's ID.
	 * @returns Nothing.
	 */
	private closeGlobal(scope: number): void {
		/*
		 * Creating an implicit variable appends cells, which can grow the
		 * pool, so the chain is always read through `cells.data`.
		 */
		const words = this.scopes.data;
		const cells = this.cells;
		const refWords = this.refs.data;
		const map = this.bindings[scope];

		for (
			let cell = words[scope * BS_WORDS + BS_LEFT_HEAD];
			cell !== 0;
			cell = cells.data[cell + 1]
		) {
			const reference = cells.data[cell];
			const refBase = reference * REFERENCE_WORDS;
			const pattern = refWords[refBase + R_IG_PATTERN];

			if (pattern === 0) {
				continue;
			}

			const nameId = refWords[refBase + R_NAME];

			if (map !== null && map.has(nameId)) {
				continue;
			}

			let symbol = this.implicitByName.get(nameId);

			if (symbol === undefined) {
				symbol = this.newSymbol(
					scope,
					nameId,
					VF_STACK | VF_IMPLICIT_GLOBAL,
				);
				this.implicitByName.set(nameId, symbol);

				const implicitCell = this.cells.reserve(2);

				this.cells.data[implicitCell] = symbol;
				this.cells.data[implicitCell + 1] = 0;

				if (this.implicitTail === 0) {
					this.implicitHead = implicitCell;
				} else {
					this.cells.data[this.implicitTail + 1] = implicitCell;
				}

				this.implicitTail = implicitCell;
			}

			// Every undeclared assignment adds its own occurrence.
			this.appendTo(
				this.symbols,
				symbol * BV_WORDS,
				BV_IDENTS_HEAD,
				pattern,
			);

			const definition = this.defCount++;
			const defBase = this.defs.reserve(DEFINITION_WORDS);
			const defWords = this.defs.data;

			defWords[defBase + D_TYPE] = DEF_CODE_IMPLICIT;
			defWords[defBase + D_NAME] = pattern;
			defWords[defBase + D_NODE] = refWords[refBase + R_IG_NODE];
			defWords[defBase + D_PARENT] = 0;
			defWords[defBase + D_INDEX] = 0;
			defWords[defBase + D_KIND] = 0;
			defWords[defBase + D_FLAGS] = DF_VARIABLE_DEFINITION;
			this.defStarts.push(0);

			this.appendTo(
				this.symbols,
				symbol * BV_WORDS,
				BV_DEFS_HEAD,
				definition,
			);
			this.symbols.data[symbol * BV_WORDS + BV_FLAGS] |=
				BVF_VALUE_BINDING;
			this.declareOnHandle(refWords[refBase + R_IG_NODE], symbol);
		}
	}

	/**
	 * Files a symbol under a declaring node already held as a handle.
	 * @param handle The declaring node's handle.
	 * @param symbol The symbol it declares.
	 * @returns Nothing.
	 */
	private declareOnHandle(handle: number, symbol: number): void {
		const head = this.declaredHeads.get(handle);
		const cells = this.cells;

		if (head !== undefined) {
			for (let cell = head; cell !== 0; cell = cells.data[cell + 1]) {
				if (cells.data[cell] === symbol) {
					return;
				}
			}
		}

		const cell = cells.reserve(2);

		cells.data[cell] = symbol;
		cells.data[cell + 1] = 0;

		if (head === undefined) {
			this.declaredHeads.set(handle, cell);
		} else {
			cells.data[this.declaredTails.get(handle)! + 1] = cell;
		}

		this.declaredTails.set(handle, cell);
	}

	//-------------------------------------------------------------------------
	// Globals
	//-------------------------------------------------------------------------

	/**
	 * Declares names in the global scope and resolves whatever was waiting
	 * for them, which is how a host's globals are supplied after the fact.
	 * @param names The global names to declare.
	 * @returns Nothing.
	 */
	addGlobals(names: Iterable<string>): void {
		if (this.scopeCount === 0) {
			return;
		}

		const added = new Set<number>();

		for (const name of names) {
			const nameId = this.intern(name);

			this.bindSymbol(0, null, nameId);
			this.implicitByName.delete(nameId);
			added.add(nameId);
		}

		const words = this.scopes.data;
		const cells = this.cells;
		const refWords = this.refs.data;
		const map = this.bindings[0]!;

		// Resolve the waiting references; keep the rest passing through.
		const oldHead = words[BS_THROUGH_HEAD];
		let newHead = 0;
		let newTail = 0;

		for (let cell = oldHead; cell !== 0; ) {
			const next = cells.data[cell + 1];
			const reference = cells.data[cell];
			const nameId = refWords[reference * REFERENCE_WORDS + R_NAME];

			if (added.has(nameId)) {
				const symbol = map.get(nameId)!;

				refWords[reference * REFERENCE_WORDS + R_RESOLVED] =
					symbol + 1;
				this.appendTo(
					this.symbols,
					symbol * BV_WORDS,
					BV_REFS_HEAD,
					reference,
				);
			} else {
				cells.data[cell + 1] = 0;

				if (newTail === 0) {
					newHead = cell;
				} else {
					cells.data[newTail + 1] = cell;
				}

				newTail = cell;
			}

			cell = next;
		}

		words[BS_THROUGH_HEAD] = newHead;
		words[BS_THROUGH_HEAD + 1] = newTail;

		// Drop the implicit variables the supplied globals cover.
		let implicitHead = 0;
		let implicitTail = 0;

		for (let cell = this.implicitHead; cell !== 0; ) {
			const next = cells.data[cell + 1];
			const symbol = cells.data[cell];
			const nameId = this.symbols.data[symbol * BV_WORDS + BV_NAME];

			if (!added.has(nameId)) {
				cells.data[cell + 1] = 0;

				if (implicitTail === 0) {
					implicitHead = cell;
				} else {
					cells.data[implicitTail + 1] = cell;
				}

				implicitTail = cell;
			}

			cell = next;
		}

		this.implicitHead = implicitHead;
		this.implicitTail = implicitTail;
	}

	//-------------------------------------------------------------------------
	// Emission
	//-------------------------------------------------------------------------

	/**
	 * Compacts the finished graph into the scope buffer format.
	 * @param treeHandles Whether node handles are tree enumeration indexes
	 *      rather than byte offsets into a binary AST.
	 * @returns The scope buffer.
	 */
	finish(treeHandles: boolean): ArrayBuffer {
		const cells = this.cells.data;
		const scopeWords = this.scopes.data;
		const symbolWords = this.symbols.data;

		/*
		 * Final symbol IDs: scope by scope in binding order, with the
		 * implicit globals at the end. A symbol on no list — an implicit
		 * global that a supplied global replaced — gets no final ID and is
		 * not emitted.
		 */
		const symbolRemap = new Int32Array(this.symbolCount);
		const finalSymbols: number[] = [];

		for (let scope = 0; scope < this.scopeCount; scope++) {
			for (
				let cell = scopeWords[scope * BS_WORDS + BS_VARS_HEAD];
				cell !== 0;
				cell = cells[cell + 1]
			) {
				symbolRemap[cells[cell]] = finalSymbols.length + 1;
				finalSymbols.push(cells[cell]);
			}
		}

		for (
			let cell = this.implicitHead;
			cell !== 0;
			cell = cells[cell + 1]
		) {
			symbolRemap[cells[cell]] = finalSymbols.length + 1;
			finalSymbols.push(cells[cell]);
		}

		// Definitions follow their symbols.
		const definitionRemap = new Int32Array(this.defCount);
		const finalDefinitions: number[] = [];

		for (const symbol of finalSymbols) {
			for (
				let cell = symbolWords[symbol * BV_WORDS + BV_DEFS_HEAD];
				cell !== 0;
				cell = cells[cell + 1]
			) {
				definitionRemap[cells[cell]] = finalDefinitions.length;
				finalDefinitions.push(cells[cell]);
			}
		}

		//---------------------------------------------------------------------
		// Pool lists and record sections
		//---------------------------------------------------------------------

		const pool = new U32Vec(1024);

		pool.push(0);

		/**
		 * Copies a cell chain into the pool as-is.
		 * @param head The chain's head cell.
		 * @returns The pool handle, or `0` for an empty chain.
		 */
		const listFromCells = (head: number): number => {
			if (head === 0) {
				return 0;
			}

			let count = 0;

			for (let cell = head; cell !== 0; cell = cells[cell + 1]) {
				count++;
			}

			const handle = pool.length;
			const base = pool.reserve(count + 1);

			pool.data[base] = count;

			let at = base + 1;

			for (let cell = head; cell !== 0; cell = cells[cell + 1]) {
				pool.data[at++] = cells[cell];
			}

			return handle;
		};

		/**
		 * Copies a cell chain of symbol IDs into the pool, remapped to their
		 * final IDs.
		 * @param head The chain's head cell.
		 * @returns The pool handle, or `0` for an empty chain.
		 */
		const listFromCellsRemapped = (head: number): number => {
			if (head === 0) {
				return 0;
			}

			let count = 0;

			for (let cell = head; cell !== 0; cell = cells[cell + 1]) {
				count++;
			}

			const handle = pool.length;
			const base = pool.reserve(count + 1);

			pool.data[base] = count;

			let at = base + 1;

			for (let cell = head; cell !== 0; cell = cells[cell + 1]) {
				pool.data[at++] = symbolRemap[cells[cell]] - 1;
			}

			return handle;
		};

		const outScopes = new Uint32Array(this.scopeCount * SCOPE_WORDS);

		for (let scope = 0; scope < this.scopeCount; scope++) {
			const from = scope * BS_WORDS;
			const to = scope * SCOPE_WORDS;

			outScopes[to + S_TYPE] = scopeWords[from + BS_TYPE];
			outScopes[to + S_FLAGS] =
				scopeWords[from + BS_FLAGS] & ~BSF_PROGRAM_BLOCK;
			outScopes[to + S_BLOCK] = scopeWords[from + BS_BLOCK];
			outScopes[to + S_UPPER] = scopeWords[from + BS_UPPER];
			outScopes[to + S_VARIABLE_SCOPE] =
				scopeWords[from + BS_VARIABLE_SCOPE];
			outScopes[to + S_VARIABLES] = listFromCellsRemapped(
				scopeWords[from + BS_VARS_HEAD],
			);
			outScopes[to + S_REFERENCES] = listFromCells(
				scopeWords[from + BS_REFS_HEAD],
			);
			outScopes[to + S_THROUGH] = listFromCells(
				scopeWords[from + BS_THROUGH_HEAD],
			);
			outScopes[to + S_IMPLICIT] =
				scope === 0 &&
				scopeWords[from + BS_TYPE] === CODE_GLOBAL
					? listFromCellsRemapped(this.implicitHead)
					: 0;
		}

		const outSymbols = new Uint32Array(finalSymbols.length * SYMBOL_WORDS);

		for (let i = 0; i < finalSymbols.length; i++) {
			const symbol = finalSymbols[i];
			const from = symbol * BV_WORDS;
			const to = i * SYMBOL_WORDS;

			outSymbols[to + V_NAME] = symbolWords[from + BV_NAME];
			outSymbols[to + V_SCOPE] = symbolWords[from + BV_SCOPE];
			outSymbols[to + V_FLAGS] =
				symbolWords[from + BV_FLAGS] & BVF_SERIALIZED;
			outSymbols[to + V_IDENTIFIERS] = listFromCells(
				symbolWords[from + BV_IDENTS_HEAD],
			);

			// Definition IDs are already final-ordered; remap each.
			let defsHandle = 0;
			const defsHead = symbolWords[from + BV_DEFS_HEAD];

			if (defsHead !== 0) {
				let count = 0;

				for (
					let cell = defsHead;
					cell !== 0;
					cell = cells[cell + 1]
				) {
					count++;
				}

				defsHandle = pool.length;

				const base = pool.reserve(count + 1);

				pool.data[base] = count;

				let at = base + 1;

				for (
					let cell = defsHead;
					cell !== 0;
					cell = cells[cell + 1]
				) {
					pool.data[at++] = definitionRemap[cells[cell]];
				}
			}

			outSymbols[to + V_DEFINITIONS] = defsHandle;
			outSymbols[to + V_REFERENCES] = listFromCells(
				symbolWords[from + BV_REFS_HEAD],
			);
		}

		// References are already final: copy, then remap what they resolved to.
		const outRefs = new Uint32Array(
			this.refs.data.subarray(0, this.refCount * REFERENCE_WORDS),
		);

		for (let i = 0; i < this.refCount; i++) {
			const resolved = outRefs[i * REFERENCE_WORDS + R_RESOLVED];

			if (resolved !== 0) {
				outRefs[i * REFERENCE_WORDS + R_RESOLVED] =
					symbolRemap[resolved - 1];
			}
		}

		const outDefs = new Uint32Array(
			finalDefinitions.length * DEFINITION_WORDS,
		);

		for (let i = 0; i < finalDefinitions.length; i++) {
			const from = finalDefinitions[i] * DEFINITION_WORDS;
			const to = i * DEFINITION_WORDS;

			for (let field = 0; field < DEFINITION_WORDS; field++) {
				outDefs[to + field] = this.defs.data[from + field];
			}
		}

		//---------------------------------------------------------------------
		// Indexes
		//---------------------------------------------------------------------

		const nodeScopePairs: [number, number][] = [];

		for (let scope = 0; scope < this.scopeCount; scope++) {
			nodeScopePairs.push([
				scopeWords[scope * BS_WORDS + BS_BLOCK],
				scope,
			]);
		}

		const declaredPairs: [number, number][] = [];

		for (const [handle, head] of this.declaredHeads) {
			/*
			 * A list can be entirely dead symbols — an implicit global that a
			 * supplied global replaced. It gets no pair rather than an empty
			 * list.
			 */
			let count = 0;

			for (let cell = head; cell !== 0; cell = cells[cell + 1]) {
				if (symbolRemap[cells[cell]] !== 0) {
					count++;
				}
			}

			if (count === 0) {
				continue;
			}

			const listHandle = pool.length;
			const base = pool.reserve(count + 1);

			pool.data[base] = count;

			let at = base + 1;

			for (let cell = head; cell !== 0; cell = cells[cell + 1]) {
				const remapped = symbolRemap[cells[cell]];

				if (remapped !== 0) {
					pool.data[at++] = remapped - 1;
				}
			}

			declaredPairs.push([handle, listHandle]);
		}

		const identRefPairs: [number, number][] = [];

		for (let i = 0; i < this.refCount; i++) {
			identRefPairs.push([
				outRefs[i * REFERENCE_WORDS + R_IDENTIFIER],
				i,
			]);
		}

		const nodeScopeWords = sortedPairWords(nodeScopePairs);
		const declaredWords = sortedPairWords(declaredPairs);
		const identRefWords = sortedPairWords(identRefPairs);

		//---------------------------------------------------------------------
		// Strings
		//---------------------------------------------------------------------

		const options = this.options;
		const jsxPragmaId =
			options.jsxPragma === null
				? 0
				: this.intern(options.jsxPragma) + 1;
		const jsxFragmentId =
			options.jsxFragmentName === null
				? 0
				: this.intern(options.jsxFragmentName) + 1;

		const encoder = new TextEncoder();
		const encoded = this.strings.map(value => encoder.encode(value));
		const stringOffsets = new Uint32Array(encoded.length + 1);
		let byteLength = 0;

		for (let i = 0; i < encoded.length; i++) {
			stringOffsets[i] = byteLength;
			byteLength += encoded[i].length;
		}

		stringOffsets[encoded.length] = byteLength;

		//---------------------------------------------------------------------
		// Layout
		//---------------------------------------------------------------------

		const scopesBase = SCOPE_HEADER_WORDS;
		const symbolsBase = scopesBase + outScopes.length;
		const referencesBase = symbolsBase + outSymbols.length;
		const definitionsBase = referencesBase + outRefs.length;
		const poolBase = definitionsBase + outDefs.length;
		const nodeScopeBase = poolBase + pool.length;
		const declaredBase = nodeScopeBase + nodeScopeWords.length;
		const identRefBase = declaredBase + declaredWords.length;
		const stringsBase = identRefBase + identRefWords.length;
		const stringDataBase = stringsBase + stringOffsets.length;
		const totalWords = stringDataBase + Math.ceil(byteLength / 4);

		const buffer = new ArrayBuffer(totalWords * 4);
		const out = new Uint32Array(buffer);

		out[SCOPE_H_MAGIC] = SCOPE_BUFFER_MAGIC;
		out[SCOPE_H_VERSION] = SCOPE_BUFFER_VERSION;
		out[SCOPE_H_FLAGS] = treeHandles ? BUFFER_TREE_HANDLES : 0;
		out[SCOPE_H_SCOPE_COUNT] = this.scopeCount;
		out[SCOPE_H_SYMBOL_COUNT] = finalSymbols.length;
		out[SCOPE_H_REFERENCE_COUNT] = this.refCount;
		out[SCOPE_H_DEFINITION_COUNT] = finalDefinitions.length;
		out[SCOPE_H_SCOPES_BASE] = scopesBase;
		out[SCOPE_H_SYMBOLS_BASE] = symbolsBase;
		out[SCOPE_H_REFERENCES_BASE] = referencesBase;
		out[SCOPE_H_DEFINITIONS_BASE] = definitionsBase;
		out[SCOPE_H_POOL_BASE] = poolBase;
		out[SCOPE_H_NODE_SCOPE_BASE] = nodeScopeBase;
		out[SCOPE_H_NODE_SCOPE_COUNT] = nodeScopeWords.length / 2;
		out[SCOPE_H_DECLARED_BASE] = declaredBase;
		out[SCOPE_H_DECLARED_COUNT] = declaredWords.length / 2;
		out[SCOPE_H_IDENT_REF_BASE] = identRefBase;
		out[SCOPE_H_IDENT_REF_COUNT] = identRefWords.length / 2;
		out[SCOPE_H_STRINGS_BASE] = stringsBase;
		out[SCOPE_H_STRING_COUNT] = this.strings.length;
		out[SCOPE_H_STRING_BYTES] = byteLength;
		out[SCOPE_H_OPTIONS] =
			(options.sourceType === "module"
				? OPT_SOURCE_TYPE_MODULE
				: options.sourceType === "commonjs"
					? OPT_SOURCE_TYPE_COMMONJS
					: OPT_SOURCE_TYPE_SCRIPT) |
			(options.dialect === "ts" ? OPT_DIALECT_TS : 0) |
			(options.jsx ? OPT_JSX : 0) |
			(options.impliedStrict ? OPT_IMPLIED_STRICT : 0) |
			(options.globalReturn ? OPT_GLOBAL_RETURN : 0) |
			(options.ignoreEval ? OPT_IGNORE_EVAL : 0);
		out[SCOPE_H_JSX_PRAGMA] = jsxPragmaId;
		out[SCOPE_H_JSX_FRAGMENT] = jsxFragmentId;

		out.set(outScopes, scopesBase);
		out.set(outSymbols, symbolsBase);
		out.set(outRefs, referencesBase);
		out.set(outDefs, definitionsBase);
		out.set(pool.data.subarray(0, pool.length), poolBase);
		out.set(nodeScopeWords, nodeScopeBase);
		out.set(declaredWords, declaredBase);
		out.set(identRefWords, identRefBase);
		out.set(stringOffsets, stringsBase);

		const bytes = new Uint8Array(buffer, stringDataBase * 4, byteLength);
		let written = 0;

		for (const chunk of encoded) {
			bytes.set(chunk, written);
			written += chunk.length;
		}

		return buffer;
	}
}
