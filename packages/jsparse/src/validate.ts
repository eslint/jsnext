/**
 * @fileoverview The validation phase.
 *
 * Parsing accepts the union of everything JavaScript and TypeScript allow.
 * This pass walks the result and reports the problems that only become
 * problems once you know how the program is meant to be interpreted: the
 * source type, the dialect, whether strict mode is in effect, and what names
 * are already bound in the surrounding scope.
 */

import { TF_LEGACY_OCTAL } from "./binary.js";
import {
	LIT_REGEXP,
	LIT_STRING,
	DECL_CONST,
	DECL_MASK,
	DECL_SHIFT,
	DECL_VAR,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	MKIND_CONSTRUCTOR,
	MKIND_GET,
	MKIND_MASK,
	MKIND_SET,
	MKIND_SHIFT,
	NF_ASYNC,
	NF_COMMA_AFTER_REST,
	NF_COMPUTED,
	NF_DECLARE,
	NF_DEFINITE,
	NF_GENERATOR,
	NF_IDENTIFIER_NAME,
	NF_METHOD,
	NF_PARENTHESIZED,
	NF_SHORTHAND,
	NF_STATIC,
	NF_TYPE_ONLY,
	TS_FIRST,
	N_AccessorProperty,
	N_ArrayPattern,
	N_AssignmentExpression,
	N_AwaitExpression,
	N_YieldExpression,
	N_AssignmentPattern,
	N_BinaryExpression,
	N_BlockStatement,
	N_BreakStatement,
	N_CallExpression,
	N_ChainExpression,
	N_CatchClause,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ContinueStatement,
	N_DoWhileStatement,
	N_ExportAllDeclaration,
	N_ExportDefaultDeclaration,
	N_ExportNamedDeclaration,
	N_ExportSpecifier,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_ArrowFunctionExpression,
	N_Identifier,
	N_IfStatement,
	N_ImportDeclaration,
	N_ImportSpecifier,
	N_JSXElement,
	N_JSXFragment,
	N_LabeledStatement,
	N_Literal,
	N_ObjectPattern,
	N_Program,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_ReturnStatement,
	N_StaticBlock,
	N_Super,
	N_SwitchStatement,
	N_TSAbstractPropertyDefinition,
	N_TSAbstractAccessorProperty,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_TSEnumDeclaration,
	N_TSInterfaceDeclaration,
	N_TSModuleBlock,
	N_TSModuleDeclaration,
	N_TSTypeAliasDeclaration,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_WhileStatement,
	N_MemberExpression,
	N_MethodDefinition,
	N_PrivateIdentifier,
	N_TSAbstractMethodDefinition,
	N_TSAsExpression,
	N_TSNonNullExpression,
	N_TSSatisfiesExpression,
	N_TSTypeAssertion,
	N_UnaryExpression,
	N_UpdateExpression,
	N_WithStatement,
} from "./node-kinds.js";
import { AstReader, TokenReader } from "./reader.js";
import { RegExpValidator } from "./regexp.js";
import { decodeEscapes } from "./values.js";
import { SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE } from "./slots.js";
import {
	KEYWORD_FIRST,
	KEYWORD_LAST,
	KEYWORD_NAMES,
	KIND_KEYWORD_FLAGS,
	KW_STRICT_RESERVED,
	T_ASSIGN,
	T_await,
	T_delete,
	T_in,
	T_yield,
	lookupKeyword,
	hashChar,
} from "./token-kinds.js";

/** A problem found during validation. */
export interface ValidationProblem {
	message: string;
	start: number;
}

/**
 * How a binding was introduced, which decides what may shadow it.
 *
 * `BINDING_VAR` never appears in a scope's `names`; a `var` is recorded in
 * `varNames` instead, because it is the only kind that binds somewhere other
 * than where it is written.
 */
const BINDING_VAR = 0;
const BINDING_LEXICAL = 1;
const BINDING_FUNCTION = 2;
const BINDING_PARAM = 3;
const BINDING_TYPE = 4;
const BINDING_SIGNATURE = 5;
const BINDING_CATCH = 6;

/**
 * An ambient class, which is a lexical binding that a signature may merge
 * with. `declare function f(): void; declare class f {}` declares one thing
 * twice over; drop either `declare` and TypeScript reports the pair.
 */
const BINDING_AMBIENT_CLASS = 7;

/**
 * A generator or async function declaration, which binds exactly as a plain
 * one does everywhere but Annex B. The web-legacy rule that lets two function
 * declarations share a block in sloppy code names `FunctionDeclaration`
 * alone, so a `function*` or an `async function` beside another declaration
 * of the same name is a redeclaration however the code is written.
 */
const BINDING_ASYNC_OR_GENERATOR = 8;

/** The character that hides a letter, as in `yield`. */
const CH_BACKSLASH = 0x5c;

/**
 * The letters `arguments` and `eval` begin with.
 *
 * Either word may be written with an escape, and one written that way begins
 * with the backslash that hides its first letter instead, so three characters
 * rule out every identifier that is neither word.
 */
const CH_a = 0x61;
const CH_e = 0x65;

/**
 * Which characters an identifier that might be a reserved word can start with.
 *
 * The words are `await`, `implements`, `interface`, `let`, `package`,
 * `private`, `protected`, `public`, `static`, and `yield`, so six letters
 * cover all of them — plus the backslash, for a first letter written as an
 * escape. Indexed by character code; anything outside ASCII cannot begin one.
 */
const RESERVED_INITIALS = /* @__PURE__ */ buildReservedInitials();

/**
 * Determines whether a node kind is an iteration statement.
 *
 * These are the four `for` forms plus `while` and `do-while` — the statements
 * a bare `continue` can be inside of, and the ones a label has to be on for
 * `continue` to name it.
 * @param kind The node kind.
 * @returns `true` when the kind loops.
 */
function isIteration(kind: number): boolean {
	return (
		kind === N_ForStatement ||
		kind === N_ForInStatement ||
		kind === N_ForOfStatement ||
		kind === N_WhileStatement ||
		kind === N_DoWhileStatement
	);
}

/**
 * Determines whether a binding is one a function declaration made.
 *
 * The two spellings differ only under Annex B, and everywhere else — merging
 * with an overload signature, colliding with a `var` — they answer alike.
 * @param binding How the name was introduced.
 * @returns `true` when a function declaration introduced it.
 */
function isFunctionBinding(binding: number): boolean {
	return (
		binding === BINDING_FUNCTION ||
		binding === BINDING_ASYNC_OR_GENERATOR
	);
}

/**
 * Builds the table of characters a reserved word can start with.
 * @returns The table, indexed by character code.
 */
function buildReservedInitials(): Uint8Array {
	const table = new Uint8Array(128);

	for (const letter of "ailpsy\\") {
		table[letter.charCodeAt(0)] = 1;
	}

	return table;
}

/**
 * One lexical scope's bindings.
 */
interface Scope {
	/** Names bound where they are written, mapped to how they were introduced. */
	names: Map<string, number>;

	/**
	 * Names `var`-declared in this scope or in any scope below it that a
	 * `var` climbs out of. A lexical declaration collides with one of these
	 * however the two are ordered, which is what makes `{ var a; let a; }`
	 * and `{ let a; var a; }` alike.
	 */
	varNames: Set<string>;

	/** Whether `var` declarations stop climbing here. */
	isFunctionScope: boolean;

	/**
	 * Whether a function declaration written directly in this scope binds
	 * here rather than in the nearest function scope. That is true of a
	 * block and of a module's top level, and false of a script's top level
	 * and of a function body — which is why `function a(){} var a;` is a
	 * redeclaration in a module and not in a script.
	 */
	functionsAreLexical: boolean;

	/** The enclosing scope, or `null` for the program scope. */
	parent: Scope | null;
}

/**
 * Walks a parsed program and reports context-dependent problems.
 * @param reader The reader over the AST buffer.
 * @param tokens The reader over the token buffer.
 * @param sourceType How the program should be interpreted.
 * @param dialect Whether TypeScript syntax is allowed.
 * @param jsx Whether JSX syntax is allowed.
 * @returns Every problem found, in the order they were encountered.
 */
export function validateAst(
	reader: AstReader,
	tokens: TokenReader,
	sourceType: "script" | "module" | "commonjs",
	dialect: "js" | "ts",
	jsx: boolean,
	declaration: boolean,
): ValidationProblem[] {
	const validator = new Validator(
		reader,
		tokens,
		sourceType,
		dialect,
		jsx,
		declaration,
	);

	validator.run();

	return validator.problems;
}

/**
 * Implements the validation walk.
 */
class Validator {
	/** Problems found so far. */
	readonly problems: ValidationProblem[] = [];

	/** The reader over the AST buffer. */
	private readonly reader: AstReader;

	/** The reader over the token buffer. */
	private readonly tokens: TokenReader;

	/** How the program should be interpreted. */
	private readonly sourceType: "script" | "module" | "commonjs";

	/** Whether TypeScript syntax is allowed. */
	private readonly dialect: "js" | "ts";

	/** Whether JSX syntax is allowed. */
	private readonly jsx: boolean;

	/** Whether strict mode rules currently apply. */
	private strict: boolean;

	/** Depth of enclosing functions; `0` means top level. */
	private functionDepth = 0;

	/**
	 * Whether the walk is inside a JSX element or fragment, so that a
	 * disallowed JSX tree is reported once at its root rather than once per
	 * node it contains.
	 */
	private inJsx = false;

	/** The innermost scope. */
	private scope: Scope;

	/**
	 * Whether the parameter list being declared may not repeat a name.
	 *
	 * Sloppy code lets a plain function repeat a *simple* parameter —
	 * `function f(a, a) {}` is legal and the last one wins. Every other
	 * combination bans it: strict code, any non-simple list, a method, and an
	 * arrow function.
	 */
	private uniqueParams = false;

	/**
	 * Whether the function being visited is a method, which its own node does
	 * not record — the method-ness belongs to the `MethodDefinition` or
	 * `Property` above it, and only reaches the function through here.
	 */
	private inMethod = false;

	/**
	 * The private names each enclosing class declares, outermost first.
	 *
	 * Empty at the top level, which is what makes a `#x` outside any class an
	 * error rather than an unresolved name.
	 */
	private readonly privateNames: Set<string>[] = [];

	/**
	 * Whether the function being visited is a generator, which reserves
	 * `yield` even in sloppy code.
	 */
	private inGenerator = false;

	/**
	 * Whether the function being visited is async, which reserves `await`.
	 *
	 * Separate from `awaitReserved` because it decides only the wording of the
	 * complaint: a module reserves `await` without any function being async.
	 */
	private inAsync = false;

	/**
	 * Whether `await` may not be an identifier here.
	 *
	 * True inside an async function, anywhere in a module, and inside a class
	 * static block — which is not async, but reserves the word anyway so that
	 * it can be given a meaning there later.
	 */
	private awaitReserved = false;

	/**
	 * Whether `super.x` may be written here.
	 *
	 * True inside any method — an accessor, a generator, and an async method
	 * included — and inside a class field initializer or a static block,
	 * because all of those have a home object to look the property up on. An
	 * ordinary function has none, so it turns this off however it is nested.
	 */
	private superPropertyAllowed = false;

	/**
	 * Whether `super()` may be written here.
	 *
	 * Only the constructor of a class that extends something may call it, so
	 * this is far narrower than `superPropertyAllowed`: a method of a derived
	 * class may read `super.x` and may not call `super()`.
	 */
	private superCallAllowed = false;

	/** Whether the class being visited has a heritage clause. */
	private inDerivedClass = false;

	/**
	 * Whether the method being visited is the constructor of a derived class,
	 * which the function node records no more than it records method-ness.
	 */
	private inDerivedConstructor = false;

	/**
	 * The one `Super` node that is allowed to be where it is.
	 *
	 * `super` is never an expression by itself: it has to be the callee of a
	 * call or the object of a member access, and only the parent knows which
	 * it is. Each parent sanctions its own `Super` before the walk descends
	 * into it, so any other one is a bare `super` and an error.
	 */
	private sanctionedSuper = 0;

	/**
	 * Whether a parameter list is being visited.
	 *
	 * A default value runs before the function's own body exists, so it may
	 * not suspend it: neither `yield` nor `await` may appear in one. A nested
	 * function's body clears this, because `f(x = async () => await 1)` is
	 * fine — the suspension belongs to the arrow, not to `f`.
	 */
	private inParameters = false;

	/**
	 * The labels a `break` may name, outermost first.
	 *
	 * Emptied at every function boundary and at a class static block, because
	 * a label names a statement rather than a place, and the statement it
	 * names is not one the code inside a nested function can leave.
	 */
	private readonly labels: { name: string; iteration: boolean }[] = [];

	/** How many iteration statements enclose the walk. */
	private iterationDepth = 0;

	/** How many `switch` statements enclose it, which only `break` may leave. */
	private switchDepth = 0;

	/**
	 * Whether the class body being walked has declared its constructor.
	 *
	 * Saved and restored around each class, so a constructor in a nested one
	 * does not count against the class outside it.
	 */
	private sawConstructor = false;

	/**
	 * Whether the node being checked sits directly in a statement list.
	 *
	 * Only the labelled-function rule reads it, and a `LabeledStatement` can
	 * only ever be a statement — so every list `visitList()` walks that could
	 * hold one is a statement list, and marking them all is exact.
	 */
	private inStatementList = false;

	/**
	 * Whether an `import` or `export` declaration may stand where the walk is.
	 *
	 * Only two lists take one: the top level of a module, and the body of a
	 * namespace or an ambient module. `visit()` clears this the moment it
	 * descends past a statement, and `visitModuleItems()` sets it again for
	 * each item of a list that does take them, so a declaration nested inside
	 * one of those statements is reported while its siblings are not.
	 */
	private moduleItemsAllowed = false;

	/**
	 * Whether what is being visited declares nothing at run time.
	 *
	 * A TypeScript overload signature, anything under a `declare`, and every
	 * line of a `.d.ts` describe something that exists elsewhere rather than
	 * bringing it into being. Two rules read this. A binding that names
	 * nothing is not held to what a name may be — `declare function
	 * eval(x: string): any` is TypeScript's own declaration of `eval`, in
	 * `lib.es5.d.ts` — and a `const` that initializes nothing needs no
	 * initializer.
	 */
	private ambient: boolean;

	/**
	 * Whether the source could hold an `arguments` at all.
	 *
	 * A class field initializer and a static block each need a search of
	 * their own for one, and almost no program has anything to find. Two
	 * scans of the text settle it once for the whole program: the word
	 * itself, or the `\u` that any escape hiding a letter of it must carry.
	 */
	private readonly mentionsArguments: boolean;

	/**
	 * The reader for regular expression patterns, made on first use.
	 *
	 * Most programs have no regular expression literal at all, and the one
	 * instance is reused by every literal in the ones that do.
	 */
	private regexp: RegExpValidator | null = null;

	/**
	 * Creates a validator.
	 * @param reader The reader over the AST buffer.
	 * @param tokens The reader over the token buffer.
	 * @param sourceType How the program should be interpreted.
	 * @param dialect Whether TypeScript syntax is allowed.
	 * @param jsx Whether JSX syntax is allowed.
	 * @param declaration Whether the whole file is ambient.
	 */
	constructor(
		reader: AstReader,
		tokens: TokenReader,
		sourceType: "script" | "module" | "commonjs",
		dialect: "js" | "ts",
		jsx: boolean,
		declaration: boolean,
	) {
		this.reader = reader;
		this.tokens = tokens;
		this.sourceType = sourceType;
		this.dialect = dialect;
		this.jsx = jsx;
		this.ambient = declaration;
		this.strict = sourceType === "module";
		this.mentionsArguments =
			reader.source.includes("arguments") ||
			reader.source.includes("\\u");

		// A module reserves `await` everywhere in it, function or no function.
		this.awaitReserved = sourceType === "module";
		this.scope = {
			names: new Map(),
			varNames: new Set(),
			isFunctionScope: true,
			functionsAreLexical: sourceType === "module",
			parent: null,
		};
	}

	/**
	 * Runs every check over the whole program.
	 * @returns Nothing.
	 */
	run(): void {
		const root = this.reader.root;

		if (!this.strict && this.hasUseStrictDirective(root)) {
			this.strict = true;
		}

		this.checkTokens();
		this.hoist(this.reader.field(root, NODE_A));
		this.visitModuleItems(this.reader.field(root, NODE_A));
	}

	/**
	 * Reports a problem.
	 * @param message A description of the problem.
	 * @param start The offset where the problem begins.
	 * @returns Nothing.
	 */
	private report(message: string, start: number): void {
		this.problems.push({ message, start });
	}

	//-------------------------------------------------------------------------
	// Token-Level Checks
	//-------------------------------------------------------------------------

	/**
	 * Reports problems that can be seen from the token stream alone.
	 * @returns Nothing.
	 */
	private checkTokens(): void {
		if (!this.strict) {
			return;
		}

		for (let i = 0; i < this.tokens.count; i++) {
			if ((this.tokens.flags(i) & TF_LEGACY_OCTAL) !== 0) {
				this.report(
					"Octal literals are not allowed in strict mode.",
					this.tokens.start(i),
				);
			}
		}
	}

	/**
	 * Determines whether a body begins with a `"use strict"` directive.
	 * @param node The `Program` or function body node.
	 * @returns `true` when the directive is present.
	 */
	private hasUseStrictDirective(node: number): boolean {
		const body = this.reader.field(node, NODE_A);
		const size = this.reader.listSize(body);

		for (let i = 0; i < size; i++) {
			const statement = this.reader.listItem(body, i);

			// The prologue ends at the first non-directive statement.
			if (this.reader.field(statement, NODE_B) !== 1) {
				return false;
			}

			const raw = this.reader.text(
				this.reader.field(statement, NODE_A),
			);

			if (raw === '"use strict"' || raw === "'use strict'") {
				return true;
			}
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Traversal
	//-------------------------------------------------------------------------

	/**
	 * Visits a node and everything below it.
	 * @param node The node index, or `0`.
	 * @returns Nothing.
	 */
	private visit(node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		this.check(node, kind);

		/*
		 * `check()` has had its look at this node, so anything below it is
		 * nested: it takes no module item, and it is not a statement list.
		 * A sibling gets both answers back from the list walk, which sets
		 * them again for each item.
		 */
		const wasInStatementList = this.inStatementList;

		this.moduleItemsAllowed = false;
		this.inStatementList = false;

		switch (kind) {
			/*
			 * A chain of labels is one position rather than several, so
			 * `l: m: function f() {}` is as legal as `l: function f() {}`
			 * and as illegal as it wherever that one is.
			 */
			case N_LabeledStatement: {
				const body = reader.field(node, NODE_B);
				const name = this.identifierName(reader.field(node, NODE_A));

				for (const entry of this.labels) {
					if (entry.name === name) {
						this.report(
							`Label '${name}' has already been declared.`,
							reader.start(node),
						);

						break;
					}
				}

				/*
				 * `continue` may only name a label that is on a loop, and a
				 * chain of labels is all on whatever the chain ends at — so
				 * `a: b: while (0) continue a;` works.
				 */
				let target = body;

				while (
					target !== 0 &&
					reader.kind(target) === N_LabeledStatement
				) {
					target = reader.field(target, NODE_B);
				}

				this.labels.push({
					name,
					iteration: target !== 0 && isIteration(reader.kind(target)),
				});
				this.visit(reader.field(node, NODE_A));
				this.inStatementList = wasInStatementList;
				this.visit(body);
				this.inStatementList = false;
				this.labels.pop();
				return;
			}

			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_ArrowFunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				this.visitFunction(node);
				return;

			case N_BlockStatement:
				this.enterScope(false);
				this.hoist(reader.field(node, NODE_A));
				this.visitChildren(node, kind);
				this.exitScope();
				return;

			/*
			 * `declare namespace N { ... }` makes everything inside it
			 * ambient, and so does `declare module "m" { ... }`. A namespace
			 * written without the keyword does not — TypeScript rejects a
			 * `const` with no initializer in one exactly as it does at the
			 * top level of an ordinary file — which is why this is inherited
			 * rather than assumed of every namespace.
			 */
			case N_TSModuleDeclaration: {
				const previousAmbient = this.ambient;

				this.ambient =
					previousAmbient ||
					(reader.flags(node) & NF_DECLARE) !== 0;
				this.visitChildren(node, kind);
				this.ambient = previousAmbient;
				return;
			}

			/*
			 * A `var` cannot escape a static block or a namespace body, so
			 * both stop the climb the way a function body does, and a
			 * function declared in either one binds there.
			 */
			case N_StaticBlock:
			case N_TSModuleBlock: {
				const wasAwait = this.awaitReserved;
				const wasGenerator = this.inGenerator;

				/*
				 * A static block is not async, but it reserves `await` so that
				 * the word is free to be given a meaning there later. It is
				 * not a generator either, and `yield` inside one is reserved
				 * only because a class body is strict.
				 */
				const wasSuperProperty = this.superPropertyAllowed;
				const wasSuperCall = this.superCallAllowed;

				const outerLabels =
					kind === N_StaticBlock
						? this.labels.splice(0, this.labels.length)
						: null;
				const previousIterationDepth = this.iterationDepth;
				const previousSwitchDepth = this.switchDepth;

				if (kind === N_StaticBlock) {
					this.awaitReserved = true;
					this.inGenerator = false;

					/*
					 * A static block is a boundary for `break` and `continue`
					 * as much as a function is: it runs when the class is
					 * defined, not where the class is written, so a loop
					 * around the class is nothing it can leave.
					 */
					this.iterationDepth = 0;
					this.switchDepth = 0;

					// A static block has a home object but no constructor.
					this.superPropertyAllowed = true;
					this.superCallAllowed = false;
					this.checkNoArguments(
						this.findArgumentsInList(
							reader.field(node, NODE_A),
						),
						"a class static block",
					);
				}

				this.enterScope(true);
				this.hoist(reader.field(node, NODE_A));

				/*
				 * A namespace body is the one place other than the top level
				 * of a module where an `import` or `export` may be written.
				 * A static block is not.
				 */
				if (kind === N_TSModuleBlock) {
					this.visitModuleItems(reader.field(node, NODE_A));
				} else {
					this.visitChildren(node, kind);
				}

				this.exitScope();

				if (outerLabels !== null) {
					this.labels.push(...outerLabels);
					this.iterationDepth = previousIterationDepth;
					this.switchDepth = previousSwitchDepth;
				}

				this.awaitReserved = wasAwait;
				this.inGenerator = wasGenerator;
				this.superPropertyAllowed = wasSuperProperty;
				this.superCallAllowed = wasSuperCall;
				return;
			}

			/*
			 * Every case shares the switch's one block scope, so a lexical
			 * declaration in one case collides with the same name in
			 * another.
			 */
			case N_SwitchStatement: {
				const cases = reader.field(node, NODE_B);
				const size = reader.listSize(cases);

				this.enterScope(false);

				for (let i = 0; i < size; i++) {
					this.hoist(reader.field(reader.listItem(cases, i), NODE_B));
				}

				this.switchDepth++;
				this.visitChildren(node, kind);
				this.switchDepth--;
				this.exitScope();
				return;
			}

			/*
			 * A `let` or `const` in the head binds in a scope of its own, so
			 * that a `var` of the same name in the body is a redeclaration
			 * while a `let` is not.
			 */
			case N_ForStatement:
			case N_ForInStatement:
			case N_ForOfStatement: {
				const head = reader.field(node, NODE_A);

				this.enterScope(false);

				if (head !== 0 && reader.kind(head) === N_VariableDeclaration) {
					// Only a C-style head has a place to put an initializer.
					this.declareVariableDeclaration(
						head,
						kind === N_ForStatement,
					);
				}

				this.iterationDepth++;
				this.visitChildren(node, kind);
				this.iterationDepth--;
				this.exitScope();
				return;
			}

			case N_WhileStatement:
			case N_DoWhileStatement:
				this.iterationDepth++;
				this.visitChildren(node, kind);
				this.iterationDepth--;
				return;

			/*
			 * The clause and its block share one scope, because a lexical
			 * declaration in the block collides with the parameter even
			 * though the block is a scope of its own everywhere else.
			 */
			case N_CatchClause: {
				const param = reader.field(node, NODE_A);
				const body = reader.field(node, NODE_B);

				this.enterScope(false);

				/*
				 * A `var` may reuse the name of a simple parameter but not of
				 * one picked out of a pattern, so only the simple one gets a
				 * binding kind that a `var` passes through.
				 */
				this.declarePattern(
					param,
					param !== 0 && reader.kind(param) === N_Identifier
						? BINDING_CATCH
						: BINDING_LEXICAL,
				);
				this.visit(param);

				if (body !== 0) {
					this.hoist(reader.field(body, NODE_A));
					this.visitList(reader.field(body, NODE_A));
				}

				this.exitScope();
				return;
			}

			/*
			 * A method's parameters may never repeat a name, however sloppy
			 * the surrounding code is, and an accessor's list has a fixed
			 * shape. Neither fact is recorded on the function itself, so both
			 * are settled here and the first is handed down for the value
			 * alone — a computed key holding a function is not a method.
			 */
			case N_MethodDefinition:
			case N_TSAbstractMethodDefinition:
			case N_Property: {
				const flags = reader.flags(node);
				const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;
				const value = reader.field(node, NODE_B);

				if (accessor === MKIND_GET || accessor === MKIND_SET) {
					this.checkAccessorParameters(value, accessor);
				}

				this.visit(reader.field(node, NODE_A));

				const wasMethod = this.inMethod;

				this.inMethod =
					kind !== N_Property ||
					(flags & NF_METHOD) !== 0 ||
					accessor === MKIND_GET ||
					accessor === MKIND_SET;

				/*
				 * The key is visited above, outside all of this, because a
				 * computed key is evaluated where the class is written rather
				 * than inside it: `class C { [super.x]() {} }` has no home
				 * object to read from.
				 */
				this.inDerivedConstructor =
					kind === N_MethodDefinition &&
					accessor === MKIND_CONSTRUCTOR &&
					this.inDerivedClass;
				this.visit(value);
				this.inDerivedConstructor = false;
				this.inMethod = wasMethod;
				this.visitList(reader.field(node, NODE_C));
				return;
			}

			/*
			 * A field initializer runs with the instance as its home object,
			 * so it may read `super.x` — but it is not the constructor, so it
			 * may not call `super()`. Its key is visited first and separately,
			 * a computed one being evaluated outside the class body.
			 */
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractPropertyDefinition: {
				const wasSuperProperty = this.superPropertyAllowed;
				const wasSuperCall = this.superCallAllowed;

				this.visit(reader.field(node, NODE_A));
				this.checkNoArguments(
					this.findArguments(reader.field(node, NODE_B)),
					"a class field initializer",
				);
				this.superPropertyAllowed = true;
				this.superCallAllowed = false;
				this.visit(reader.field(node, NODE_B));
				this.superPropertyAllowed = wasSuperProperty;
				this.superCallAllowed = wasSuperCall;
				this.visitList(reader.field(node, NODE_C));
				return;
			}

			/*
			 * A class opens a private environment that covers its body and
			 * nothing else. The heritage clause is deliberately visited before
			 * the push, because the specification evaluates it in the *outer*
			 * environment: `class C extends this.#x { #x; }` does not resolve.
			 */
			case N_ClassDeclaration:
			case N_ClassExpression: {
				const body = reader.field(node, NODE_C);
				const wasStrict = this.strict;

				/*
				 * Every part of a class is strict mode code, its name and its
				 * heritage clause included, whatever surrounds it. So
				 * `class C { m() { var yield; } }` is an error in a sloppy
				 * script, where the same method written outside a class is
				 * not.
				 */
				this.strict = true;
				this.checkRestrictedName(reader.field(node, NODE_A), "bound");
				this.visit(reader.field(node, NODE_A));
				this.visit(reader.field(node, NODE_B));

				const wasDerived = this.inDerivedClass;
				const wasSawConstructor = this.sawConstructor;

				this.sawConstructor = false;

				/*
				 * Only a class that extends something has a `super()` to call,
				 * and the heritage clause above is deliberately visited before
				 * this is set — it is evaluated outside the class body.
				 */
				this.inDerivedClass = reader.field(node, NODE_B) !== 0;

				if (body !== 0) {
					this.privateNames.push(this.collectPrivateNames(body));
					this.visitChildren(body, reader.kind(body));
					this.privateNames.pop();
				}

				this.inDerivedClass = wasDerived;
				this.sawConstructor = wasSawConstructor;
				this.strict = wasStrict;
				return;
			}

			/*
			 * Everything below a JSX element or fragment is JSX too, so the
			 * subtree is marked to keep `check()` from reporting a disallowed
			 * tree again at every element nested inside it.
			 */
			case N_JSXElement:
			case N_JSXFragment: {
				const wasInJsx = this.inJsx;

				this.inJsx = true;
				this.visitChildren(node, kind);
				this.inJsx = wasInJsx;
				return;
			}

			default:
				this.visitChildren(node, kind);
		}
	}

	/**
	 * Visits every child of a node using the slot descriptor table.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: number, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitList(this.reader.field(node, NODE_A + slot));
			}
		}
	}

	/**
	 * Visits every element of a list.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	/**
	 * Visits a list whose items may be `import` and `export` declarations.
	 *
	 * The permission is granted one item at a time rather than for the list,
	 * because `visit()` takes it away as soon as it descends: `import x from
	 * "m";` at the top level is a module item, and the same line inside the
	 * block on the next line is not.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	private visitModuleItems(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.moduleItemsAllowed = true;
			this.inStatementList = true;
			this.visit(this.reader.listItem(handle, i));
		}

		this.moduleItemsAllowed = false;
		this.inStatementList = false;
	}

	private visitList(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.inStatementList = true;
			this.visit(this.reader.listItem(handle, i));
		}

		this.inStatementList = false;
	}

	/**
	 * Visits a function, giving its parameters and body a fresh scope.
	 * @param node The function node index.
	 * @returns Nothing.
	 */
	private visitFunction(node: number): void {
		const reader = this.reader;
		const previousStrict = this.strict;
		const previousUnique = this.uniqueParams;
		const previousGenerator = this.inGenerator;
		const previousAsync = this.inAsync;
		const previousAwait = this.awaitReserved;
		const previousParameters = this.inParameters;
		const previousAmbient = this.ambient;
		const isMethod = this.inMethod;
		const isDerivedConstructor = this.inDerivedConstructor;
		const previousSuperProperty = this.superPropertyAllowed;
		const previousSuperCall = this.superCallAllowed;
		const body = reader.field(node, NODE_C);
		const kind = reader.kind(node);
		const flags = reader.flags(node);
		const isArrow = kind === N_ArrowFunctionExpression;
		const isGenerator = (flags & NF_GENERATOR) !== 0;
		const isAsync = (flags & NF_ASYNC) !== 0;

		/*
		 * Method-ness reaches exactly one function, the one it was set for.
		 * A function nested inside a method is an ordinary function again.
		 */
		this.inMethod = false;
		this.inDerivedConstructor = false;
		this.functionDepth++;
		this.enterScope(true);

		/*
		 * A label names a statement, and nothing inside a nested function can
		 * leave a statement outside it, so the whole set is put aside for the
		 * duration along with the loops and switches it sits in.
		 */
		const outerLabels = this.labels.splice(0, this.labels.length);
		const previousIterationDepth = this.iterationDepth;
		const previousSwitchDepth = this.switchDepth;

		this.iterationDepth = 0;
		this.switchDepth = 0;

		const directive =
			body !== 0 &&
			reader.kind(body) === N_BlockStatement &&
			this.hasUseStrictDirective(body);

		if (directive) {
			this.strict = true;
		}

		// A function with no body is a signature, not a definition.
		this.ambient = previousAmbient || body === 0;

		/*
		 * A function's name is checked here rather than where it is bound,
		 * because a `"use strict"` directive in the body reaches back over
		 * it: `function eval() { "use strict"; }` is an error although the
		 * `eval` it binds lands in a scope that is not strict at all.
		 */
		this.checkRestrictedName(reader.field(node, NODE_A), "bound");

		const params = reader.field(node, NODE_B);
		const size = reader.listSize(params);
		const simple = this.hasSimpleParameters(params, size);

		/*
		 * A `"use strict"` directive cannot make strict something the engine
		 * would have to evaluate to know — a default expression runs in the
		 * function's own scope, so whether *it* is strict would depend on the
		 * directive it precedes. The language sidesteps the question by
		 * banning the combination outright.
		 */
		if (directive && !simple) {
			this.report(
				"Illegal 'use strict' directive in a function with a non-simple parameter list.",
				reader.start(node),
			);
		}

		this.uniqueParams =
			this.strict || !simple || isMethod || isArrow;

		const isDeclaration =
			kind === N_FunctionDeclaration || kind === N_TSDeclareFunction;

		/*
		 * A function's own name is read where the function is written, not
		 * inside it — so `function* yield() {}` is legal in sloppy code while
		 * `(function* yield() {})` is not, an expression's name being the one
		 * thing about it that is in scope within its own body.
		 */
		if (isDeclaration) {
			this.visit(reader.field(node, NODE_A));
		}

		/*
		 * An arrow reads its parameters in the enclosing context and its body
		 * in a fresh one, which no other function does. So
		 * `async function f() { (await) => 1; }` is an error while
		 * `async function f() { () => { var await; }; }` is not.
		 */
		this.inGenerator = isArrow ? previousGenerator : isGenerator;
		this.inAsync = isArrow ? previousAsync || isAsync : isAsync;
		this.awaitReserved =
			this.inAsync ||
			(isArrow && previousAwait) ||
			this.sourceType === "module";

		/*
		 * An arrow has no home object of its own and so borrows the enclosing
		 * one, which is what lets `constructor() { () => super(); }` work.
		 * Every other function brings its own, or brings none: only a method
		 * may read `super.x`, and only a derived constructor may call it.
		 */
		if (!isArrow) {
			this.superPropertyAllowed = isMethod;
			this.superCallAllowed = isDerivedConstructor;
		}

		for (let i = 0; i < size; i++) {
			const param = reader.listItem(params, i);

			if (
				reader.kind(param) === N_RestElement &&
				i !== size - 1
			) {
				this.report(
					"A rest parameter must be the last parameter.",
					reader.start(param),
				);
			}

			this.declarePattern(param, BINDING_PARAM);
		}

		this.uniqueParams = previousUnique;

		if (!isDeclaration) {
			this.visit(reader.field(node, NODE_A));
		}

		this.inParameters = true;
		this.visitList(params);
		this.inParameters = false;

		// The body of an arrow is the one place the enclosing context stops.
		if (isArrow) {
			this.inGenerator = false;
			this.inAsync = isAsync;
			this.awaitReserved = isAsync || this.sourceType === "module";
		}

		if (body !== 0 && reader.kind(body) === N_BlockStatement) {
			this.hoist(reader.field(body, NODE_A));
			this.visitList(reader.field(body, NODE_A));
		} else {
			this.visit(body);
		}

		this.visit(reader.field(node, 7));
		this.visit(reader.field(node, 8));
		this.exitScope();
		this.functionDepth--;
		this.strict = previousStrict;
		this.inGenerator = previousGenerator;
		this.inAsync = previousAsync;
		this.awaitReserved = previousAwait;
		this.inParameters = previousParameters;
		this.labels.push(...outerLabels);
		this.iterationDepth = previousIterationDepth;
		this.switchDepth = previousSwitchDepth;
		this.ambient = previousAmbient;
		this.superPropertyAllowed = previousSuperProperty;
		this.superCallAllowed = previousSuperCall;
	}

	/**
	 * Determines whether every parameter is a plain binding identifier.
	 *
	 * That is the specification's `IsSimpleParameterList`, and it decides two
	 * separate things: whether the list may repeat a name in sloppy code, and
	 * whether the body may open with a `"use strict"` directive.
	 * @param params The parameter list handle.
	 * @param size How many parameters it holds.
	 * @returns `true` when no parameter is a pattern, a default, or a rest.
	 */
	private hasSimpleParameters(params: number, size: number): boolean {
		for (let i = 0; i < size; i++) {
			if (
				this.reader.kind(this.reader.listItem(params, i)) !==
				N_Identifier
			) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Reports an accessor whose parameter list is not the shape it must be.
	 *
	 * A getter takes nothing and a setter takes exactly one thing, and neither
	 * may collect a rest — the two are called with a fixed shape by the
	 * property machinery, so there is nothing for the extra parameters to be.
	 * @param value The function node index, or `0`.
	 * @param accessor The packed method kind.
	 * @returns Nothing.
	 */
	private checkAccessorParameters(value: number, accessor: number): void {
		if (value === 0) {
			return;
		}

		const reader = this.reader;
		const params = reader.field(value, NODE_B);
		const size = reader.listSize(params);

		if (accessor === MKIND_GET) {
			if (size > 0) {
				this.report(
					"A getter must have no parameters.",
					reader.start(reader.listItem(params, 0)),
				);
			}

			return;
		}

		if (size !== 1) {
			this.report(
				"A setter must have exactly one parameter.",
				reader.start(size === 0 ? value : reader.listItem(params, 1)),
			);

			return;
		}

		const only = reader.listItem(params, 0);

		if (reader.kind(only) === N_RestElement) {
			this.report(
				"A setter cannot have a rest parameter.",
				reader.start(only),
			);
		}
	}

	//-------------------------------------------------------------------------
	// Scopes
	//-------------------------------------------------------------------------

	/**
	 * The name an identifier spells, with any escape in it decoded.
	 *
	 * An `Identifier` runs to the end of whatever TypeScript hung off it — an
	 * `x!` or an `x: number` — so slot A carries where the name itself stops
	 * when that is not the end of the node.
	 * @param node The `Identifier` node index.
	 * @returns The name.
	 */
	private identifierName(node: number): string {
		const reader = this.reader;
		const nameEnd = reader.field(node, NODE_A);
		const raw = reader.source.slice(
			reader.start(node),
			nameEnd === 0 ? reader.end(node) : nameEnd,
		);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * Pushes a new scope.
	 * @param isFunctionScope Whether `var` declarations stop here.
	 * @returns Nothing.
	 */
	private enterScope(isFunctionScope: boolean): void {
		this.scope = {
			names: new Map(),
			varNames: new Set(),
			isFunctionScope,
			functionsAreLexical: !isFunctionScope,
			parent: this.scope,
		};
	}

	/**
	 * Pops the innermost scope.
	 * @returns Nothing.
	 */
	private exitScope(): void {
		this.scope = this.scope.parent!;
	}

	/**
	 * Declares the block-scoped names of a statement list before visiting it,
	 * which is what lets a redeclaration be reported at either occurrence.
	 * @param handle The list handle of the statements.
	 * @returns Nothing.
	 */
	private hoist(handle: number): void {
		const reader = this.reader;
		const size = reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			let statement = reader.listItem(handle, i);
			let kind = reader.kind(statement);

			// Look through `export` to the declaration it wraps.
			if (
				kind === N_ExportNamedDeclaration ||
				kind === N_ExportDefaultDeclaration
			) {
				statement = reader.field(statement, NODE_A);

				if (statement === 0) {
					continue;
				}

				kind = reader.kind(statement);
			}

			switch (kind) {
				case N_VariableDeclaration:
					this.declareVariableDeclaration(statement, true);
					break;

				case N_ImportDeclaration:
					this.declareImportDeclaration(statement);
					break;

				case N_FunctionDeclaration:
					this.declare(
						reader.field(statement, NODE_A),
						this.scope.functionsAreLexical
							? (reader.flags(statement) &
									(NF_ASYNC | NF_GENERATOR)) !==
								0
								? BINDING_ASYNC_OR_GENERATOR
								: BINDING_FUNCTION
							: BINDING_VAR,
					);
					break;

				/*
				 * A body-less function declaration is either a TypeScript
				 * overload signature or an ambient one, and both merge with
				 * the other declarations of the same name instead of
				 * redeclaring it.
				 */
				case N_TSDeclareFunction:
					this.declare(
						reader.field(statement, NODE_A),
						this.scope.functionsAreLexical
							? BINDING_SIGNATURE
							: BINDING_VAR,
					);
					break;

				case N_ClassDeclaration:
					this.declare(
						reader.field(statement, NODE_A),
						this.ambient ||
							(reader.flags(statement) & NF_DECLARE) !== 0
							? BINDING_AMBIENT_CLASS
							: BINDING_LEXICAL,
					);
					break;

				case N_TSInterfaceDeclaration:
				case N_TSTypeAliasDeclaration:
				case N_TSEnumDeclaration:
				case N_TSModuleDeclaration:
					this.declare(reader.field(statement, NODE_A), BINDING_TYPE);
					break;

				default:
					break;
			}
		}
	}

	/**
	 * Declares every name introduced by a variable declaration.
	 * @param node The `VariableDeclaration` node index.
	 * @param checkInitializer Whether a `const` here needs an initializer,
	 *      which a `for...in` or `for...of` head does not.
	 * @returns Nothing.
	 */
	private declareVariableDeclaration(
		node: number,
		checkInitializer: boolean,
	): void {
		const reader = this.reader;
		const flags = reader.flags(node);
		const declarationKind = (flags & DECL_MASK) >>> DECL_SHIFT;
		const binding =
			declarationKind === DECL_VAR ? BINDING_VAR : BINDING_LEXICAL;
		const declarations = reader.field(node, NODE_A);
		const size = reader.listSize(declarations);
		const previousAmbient = this.ambient;

		this.ambient = previousAmbient || (flags & NF_DECLARE) !== 0;

		for (let i = 0; i < size; i++) {
			const declarator = reader.listItem(declarations, i);

			this.declarePattern(reader.field(declarator, NODE_A), binding);

			/*
			 * An ambient `const` names something declared elsewhere, so it
			 * has nothing to initialize, and a definite assignment assertion
			 * promises an initializer that TypeScript cannot see.
			 */
			if (
				checkInitializer &&
				declarationKind === DECL_CONST &&
				reader.field(declarator, NODE_B) === 0 &&
				(reader.flags(declarator) & NF_DEFINITE) === 0 &&
				!this.ambient
			) {
				this.report(
					"Missing initializer in const declaration.",
					reader.start(declarator),
				);
			}
		}

		this.ambient = previousAmbient;
	}

	/**
	 * Declares the local name of every specifier of an import declaration.
	 * @param node The `ImportDeclaration` node index.
	 * @returns Nothing.
	 */
	private declareImportDeclaration(node: number): void {
		const reader = this.reader;
		const specifiers = reader.field(node, NODE_A);
		const size = reader.listSize(specifiers);

		/*
		 * `import type { A } from "m"` brings in a name that exists only in
		 * type space, so a value of the same name may sit beside it. Whether
		 * it really may depends on what the other module exports — TypeScript
		 * allows the pair above and rejects it when `A` is imported by
		 * default, because a default export is a value — and that is a
		 * question about the module graph, which nothing here can see. Binding
		 * it as a type is the reading that errs toward accepting: it can miss
		 * a collision, where the other reading reports working code.
		 */
		const typeOnly = (reader.flags(node) & NF_TYPE_ONLY) !== 0;

		for (let i = 0; i < size; i++) {
			const specifier = reader.listItem(specifiers, i);

			/*
			 * A named specifier carries the imported name first and the local
			 * one second; a default or namespace specifier has only the local
			 * name.
			 */
			const local = reader.field(
				specifier,
				reader.kind(specifier) === N_ImportSpecifier
					? NODE_B
					: NODE_A,
			);

			this.checkRestrictedName(local, "bound");
			this.declare(
				local,
				typeOnly ||
					(reader.flags(specifier) & NF_TYPE_ONLY) !== 0
					? BINDING_TYPE
					: BINDING_LEXICAL,
			);
		}
	}

	/**
	 * Declares every identifier inside a binding pattern, and reports a
	 * pattern that is not a shape a pattern may take.
	 *
	 * The shape rules are the same ones `checkArrayPattern()` and
	 * `checkObjectPattern()` apply on the left of an assignment, because a
	 * rest element collects what is left over either way and there is nothing
	 * left over after it. They are checked here rather than there because
	 * this is the walk that reaches a binding: `[...a, b] = c` and
	 * `var [...a, b] = c` are the same mistake arrived at down two paths.
	 * @param node The pattern node index.
	 * @param binding How the names are being introduced.
	 * @returns Nothing.
	 */
	private declarePattern(node: number, binding: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				this.checkRestrictedName(node, "bound");

				/*
				 * `let let` is banned outright, sloppy code included, because
				 * a lexical declaration reading its own keyword back as the
				 * name it binds is exactly the ambiguity `let` was given a
				 * lookahead restriction to avoid. `var let` stays legal — a
				 * `var` never had the problem — and so does `catch (let)`,
				 * which binds without declaring.
				 */
				if (
					binding === BINDING_LEXICAL &&
					this.identifierName(node) === "let"
				) {
					this.report(
						"'let' may not be the name a lexical declaration binds.",
						reader.start(node),
					);
				}

				this.declare(node, binding);
				return;

			case N_ArrayPattern: {
				const elements = reader.field(node, NODE_A);
				const size = reader.listSize(elements);

				for (let i = 0; i < size; i++) {
					const element = reader.listItem(elements, i);

					/*
					 * A hole is written as a missing element, so a `null`
					 * after the rest is `[...a, ,]` — an element, and one the
					 * rest has already swallowed.
					 */
					if (
						element !== 0 &&
						reader.kind(element) === N_RestElement
					) {
						if (i === size - 1) {
							this.checkCommaAfterRest(node, element);
						} else {
							this.report(
								"A rest element must be the last element.",
								reader.start(element),
							);
						}
					}

					this.declarePattern(element, binding);
				}

				return;
			}

			case N_ObjectPattern: {
				const properties = reader.field(node, NODE_A);
				const size = reader.listSize(properties);

				for (let i = 0; i < size; i++) {
					const property = reader.listItem(properties, i);
					const isProperty = reader.kind(property) === N_Property;
					const target = reader.field(
						property,
						isProperty ? NODE_B : NODE_A,
					);

					if (!isProperty) {
						if (i === size - 1) {
							this.checkCommaAfterRest(node, property);
						} else {
							this.report(
								"A rest element must be the last element.",
								reader.start(property),
							);
						}

						/*
						 * `{ ...rest }` binds one plain name: there is no
						 * iterator to take apart here, only the properties
						 * nothing else claimed, and they arrive as an object
						 * that has to go somewhere whole. The assignment form
						 * is wider — `({ ...a.b } = c)` is legal — because it
						 * stores into a target rather than binding a name.
						 */
						if (
							target !== 0 &&
							reader.kind(target) !== N_Identifier
						) {
							this.report(
								"A rest element in an object pattern must be an identifier.",
								reader.start(target),
							);
						}
					}

					this.declarePattern(target, binding);
				}

				return;
			}

			case N_AssignmentPattern:
			case N_RestElement:
				this.declarePattern(reader.field(node, NODE_A), binding);
				return;

			default:
				return;
		}
	}

	/**
	 * Binds a name in the current scope and reports illegal redeclarations.
	 * @param identifier The `Identifier` node index, or `0`.
	 * @param binding How the name is being introduced.
	 * @returns Nothing.
	 */
	private declare(identifier: number, binding: number): void {
		if (identifier === 0) {
			return;
		}

		const reader = this.reader;

		if (reader.kind(identifier) !== N_Identifier) {
			return;
		}

		/*
		 * Two bindings collide when their `StringValue`s match, which is what
		 * the escapes in them mean rather than how they are spelled, and
		 * which stops at the name — an `Identifier` node runs on through
		 * whatever TypeScript hung off it. Reading the node's text instead
		 * would let `let x: number` and `let x: string` pass for different
		 * names, and `\u0061` for something other than `a`.
		 */
		const name = this.identifierName(identifier);
		const start = reader.start(identifier);

		/*
		 * Nothing checks the word here. Every binding identifier is also
		 * reached by the walk, which checks all of them in one place —
		 * references and labels included — so doing it here too would report
		 * a binding twice.
		 */

		if (binding === BINDING_VAR) {
			this.declareVar(name, start);
			return;
		}

		const scope = this.scope;
		const existing = scope.names.get(name);

		if (
			existing !== undefined
				? this.conflicts(existing, binding)
				: scope.varNames.has(name) && !this.tolerantOfVar(binding)
		) {
			this.report(
				`Identifier '${name}' has already been declared.`,
				start,
			);

			return;
		}

		/*
		 * A signature written after the implementation must not erase the
		 * record of the implementation, or a second implementation would go
		 * unreported.
		 */
		if (
			binding === BINDING_SIGNATURE &&
			existing !== undefined &&
			isFunctionBinding(existing)
		) {
			return;
		}

		scope.names.set(name, binding);
	}

	/**
	 * Binds a name that climbs to the nearest function scope, recording it in
	 * every scope it passes through so that a lexical declaration written
	 * later in any of them is still caught.
	 * @param name The name being bound.
	 * @param start The offset of the identifier.
	 * @returns Nothing.
	 */
	private declareVar(name: string, start: number): void {
		let scope = this.scope;

		for (;;) {
			const existing = scope.names.get(name);

			if (existing !== undefined && !this.tolerantOfVar(existing)) {
				this.report(
					`Identifier '${name}' has already been declared.`,
					start,
				);

				return;
			}

			scope.varNames.add(name);

			if (scope.isFunctionScope || scope.parent === null) {
				return;
			}

			scope = scope.parent;
		}
	}

	/**
	 * Determines whether a binding may share its scope with a `var` of the
	 * same name.
	 * @param binding How the name was introduced.
	 * @returns `true` when the two may coexist.
	 */
	private tolerantOfVar(binding: number): boolean {
		return (
			binding !== BINDING_LEXICAL &&
			binding !== BINDING_AMBIENT_CLASS &&
			!isFunctionBinding(binding)
		);
	}

	/**
	 * Determines whether two bindings of the same name may coexist.
	 * @param existing How the name was first introduced.
	 * @param incoming How the name is being introduced now.
	 * @returns `true` when the pair is an illegal redeclaration.
	 */
	private conflicts(existing: number, incoming: number): boolean {
		// Types may merge freely with each other and with values.
		if (existing === BINDING_TYPE || incoming === BINDING_TYPE) {
			return false;
		}

		if (existing === BINDING_PARAM && incoming === BINDING_PARAM) {
			return this.uniqueParams;
		}

		/*
		 * Overload signatures merge with each other and with the
		 * implementation they belong to, so only two implementations of the
		 * same name are a redeclaration — and then only where a function
		 * declaration binds lexically, since two of them in a function scope
		 * are as legal as two `var`s.
		 */
		/*
		 * An ambient class is what a signature describes when the thing
		 * described is a class, so the two are one declaration. Two ambient
		 * classes are still two, and a `let` beside either is still a
		 * collision, so this is the one pairing that merges.
		 */
		if (
			(existing === BINDING_SIGNATURE &&
				incoming === BINDING_AMBIENT_CLASS) ||
			(existing === BINDING_AMBIENT_CLASS &&
				incoming === BINDING_SIGNATURE)
		) {
			return false;
		}

		if (
			(isFunctionBinding(existing) || existing === BINDING_SIGNATURE) &&
			(isFunctionBinding(incoming) || incoming === BINDING_SIGNATURE)
		) {
			/*
			 * Two implementations of the same name in one block are what
			 * Annex B forgives, and only as it is written there: the rule
			 * names `FunctionDeclaration`, so a generator or an async
			 * function on either side takes the pair back out of it.
			 */
			return (
				isFunctionBinding(existing) &&
				isFunctionBinding(incoming) &&
				(this.strict ||
					existing === BINDING_ASYNC_OR_GENERATOR ||
					incoming === BINDING_ASYNC_OR_GENERATOR)
			);
		}

		return true;
	}

	/**
	 * Reports names that may not be bound under the current rules.
	 * @param name The name being bound.
	 * @param start The offset of the identifier.
	 * @returns Nothing.
	 */
	private checkReservedBinding(name: string, start: number): void {
		let hash = 0;

		for (let i = 0; i < name.length; i++) {
			hash = hashChar(hash, name.charCodeAt(i));
		}

		this.checkReservedWord(
			lookupKeyword(name, 0, name.length, hash),
			start,
		);
	}

	/**
	 * Reports a word that may not be an identifier where it was written.
	 *
	 * Three rules meet here. Strict mode reserves a fixed list. A generator
	 * reserves `yield`, and an async function — or a module, or a class static
	 * block — reserves `await`; those two are reserved by *position* rather
	 * than by strict mode, which is why a sloppy script may still name a
	 * variable `yield` outside a generator.
	 * @param kind The keyword kind the word matched, if any.
	 * @param start Where the word is, as an offset into the program text.
	 * @returns Nothing.
	 */
	private checkReservedWord(kind: number, start: number): void {
		if (kind < KEYWORD_FIRST || kind > KEYWORD_LAST) {
			return;
		}

		if (kind === T_yield && this.inGenerator) {
			this.report(
				"'yield' cannot be used as an identifier inside a generator.",
				start,
			);

			return;
		}

		if (kind === T_await && this.awaitReserved) {
			this.report(
				this.sourceType === "module" && !this.inAsync
					? "'await' cannot be used as an identifier in a module."
					: "'await' cannot be used as an identifier here.",
				start,
			);

			return;
		}

		if (
			this.strict &&
			(KIND_KEYWORD_FLAGS[kind] & KW_STRICT_RESERVED) !== 0
		) {
			this.report(
				`Unexpected reserved word '${KEYWORD_NAMES[kind - KEYWORD_FIRST]}' in strict mode.`,
				start,
			);
		}
	}

	/**
	 * Checks one `Identifier` for a word that is reserved where it is written.
	 *
	 * This runs on every identifier in the program, so it opens with the
	 * cheapest test that can rule one out. Every word it looks for begins with
	 * one of six letters, and one that is written with an escape begins either
	 * with its own first letter or with the backslash that hides it — so a
	 * single table lookup on the first character settles the great majority.
	 * @param node The `Identifier` node index.
	 * @returns Nothing.
	 */
	private checkIdentifierWord(node: number): void {
		/*
		 * An `IdentifierName` may be any word at all. `o.await` and
		 * `({ yield: 1 })` are names rather than references, and the parser is
		 * the only thing that can tell, so it says so.
		 */
		if ((this.reader.flags(node) & NF_IDENTIFIER_NAME) !== 0) {
			return;
		}

		this.checkWordAt(node);
	}

	/**
	 * Checks a `super` used as the operand of a call or a member access.
	 *
	 * Sanctioning the node is what keeps the bare-`super` rule from firing on
	 * the legal ones: `check()` runs on a parent before the walk descends into
	 * it, so the operand is marked by the time it is reached.
	 * @param operand The callee or object node index, which may be anything.
	 * @param allowed Whether `super` is allowed to be used this way here.
	 * @param message What to report when it is not.
	 * @returns Nothing.
	 */
	private checkSuperOperand(
		operand: number,
		allowed: boolean,
		message: string,
	): void {
		if (operand === 0 || this.reader.kind(operand) !== N_Super) {
			return;
		}

		this.sanctionedSuper = operand;

		if (!allowed) {
			this.report(message, this.reader.start(operand));
		}
	}

	/**
	 * Checks the identifier a node uses as a name and as a reference at once.
	 *
	 * `({ await })`, `import { await }`, and `export { await }` each hold one
	 * `Identifier` in both slots, and the parser read it down the name path
	 * because that is what it looked like. The reference half still has to be
	 * checked, and this is where the double duty is visible.
	 * @param node The `Property`, `ImportSpecifier`, or `ExportSpecifier`.
	 * @returns Nothing.
	 */
	private checkSharedName(node: number): void {
		const reader = this.reader;
		const first = reader.field(node, NODE_A);

		if (
			first !== 0 &&
			first === reader.field(node, NODE_B) &&
			reader.kind(first) === N_Identifier
		) {
			this.checkWordAt(first);
		}
	}

	/**
	 * Checks an identifier's text for a word reserved where it is written.
	 * @param node The `Identifier` node index.
	 * @returns Nothing.
	 */
	private checkWordAt(node: number): void {
		const reader = this.reader;
		const source = reader.source;
		const start = reader.start(node);
		const first = source.charCodeAt(start);

		if (first >= RESERVED_INITIALS.length || RESERVED_INITIALS[first] === 0) {
			return;
		}

		const nameEnd = reader.field(node, NODE_A);
		const end = nameEnd === 0 ? reader.end(node) : nameEnd;
		let hash = 0;
		let escaped = false;

		for (let i = start; i < end; i++) {
			const code = source.charCodeAt(i);

			if (code === CH_BACKSLASH) {
				escaped = true;
			}

			hash = hashChar(hash, code);
		}

		/*
		 * A word written with an escape is the word it spells, so `yield`
		 * is `yield` and is reserved wherever `yield` is. Decoding costs a
		 * string, which is why it waits until an escape is known to be there.
		 */
		if (escaped) {
			this.checkReservedBinding(
				decodeEscapes(source.slice(start, end), false),
				start,
			);

			return;
		}

		this.checkReservedWord(lookupKeyword(source, start, end, hash), start);
	}

	//-------------------------------------------------------------------------
	// `eval` and `arguments`
	//-------------------------------------------------------------------------

	/*
	 * Neither word is reserved, so both are ordinary names to read: `eval(x)`
	 * and `arguments[0]` are legal in the strictest code there is. What strict
	 * mode bans is putting a value *into* one — binding it or assigning to it
	 * — because an engine that could not see which `eval` a call names could
	 * not optimize anything around it.
	 *
	 * A class field initializer and a class static block ban `arguments`
	 * outright, mention included. Both are compiled into a function of their
	 * own that the surrounding code never calls, so an `arguments` written
	 * there would name that hidden function's argument list rather than the
	 * enclosing method's, which is never what anyone meant.
	 */

	/**
	 * Reports `eval` or `arguments` where strict mode will not have it.
	 * @param node The `Identifier` node index, or `0`.
	 * @param verb What is being done to it, for the message.
	 * @returns Nothing.
	 */
	private checkRestrictedName(node: number, verb: string): void {
		if (node === 0 || !this.strict || this.ambient) {
			return;
		}

		const reader = this.reader;
		const start = reader.start(node);
		const first = reader.source.charCodeAt(start);

		if (first !== CH_a && first !== CH_e && first !== CH_BACKSLASH) {
			return;
		}

		const name = this.identifierName(node);

		if (name === "eval" || name === "arguments") {
			this.report(`'${name}' cannot be ${verb} in strict mode.`, start);
		}
	}

	/**
	 * Finds the `arguments` that bans a field initializer or a static block.
	 *
	 * This is the specification's `ContainsArguments`, which is a search
	 * rather than a state the walk could carry: it crosses an arrow function,
	 * because an arrow has no argument list of its own to name, and stops at
	 * every other kind of function, because one written here would answer for
	 * its own `arguments`. A method contributes only its name, the key being
	 * evaluated outside the body it belongs to.
	 *
	 * What it looks for is the word rather than a reference to it, so a
	 * `var arguments` or a statement labelled `arguments` counts as well.
	 * The specification counts an `IdentifierReference` alone, but both
	 * `espree` and V8 read it this way, and telling the two apart would mean
	 * naming every position that binds a name in either language for the sake
	 * of programs no engine accepts. A binding is reported twice for it —
	 * once here and once by the strict mode rule that a class body always
	 * turns on — which is the whole of the difference in practice.
	 * @param node The node to search, or `0`.
	 * @returns The offending `Identifier`, or `0` if there is none.
	 */
	private findArguments(node: number): number {
		if (node === 0 || !this.mentionsArguments) {
			return 0;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				return (reader.flags(node) & NF_IDENTIFIER_NAME) === 0 &&
					this.identifierName(node) === "arguments"
					? node
					: 0;

			/*
			 * A function of its own brings its own `arguments`, so nothing
			 * inside one belongs to the initializer being searched. An arrow
			 * is missing from this list on purpose.
			 */
			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				return 0;

			/*
			 * A nested field or static block is searched on its own account,
			 * so only what sits outside its value — the key, and any
			 * decorator — is this one's to answer for. Reporting it twice is
			 * what this avoids; the specification counts it for both.
			 */
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractPropertyDefinition:
				return (
					this.findArguments(reader.field(node, NODE_A)) ||
					this.findArgumentsInList(reader.field(node, NODE_C))
				);

			case N_StaticBlock:
				return 0;

			default:
				break;
		}

		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];
			let found = 0;

			if (descriptor === SLOT_NODE) {
				found = this.findArguments(reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				found = this.findArgumentsInList(
					reader.field(node, NODE_A + slot),
				);
			}

			if (found !== 0) {
				return found;
			}
		}

		return 0;
	}

	/**
	 * Searches every element of a list for a banned `arguments`.
	 * @param handle The list handle.
	 * @returns The offending `Identifier`, or `0` if there is none.
	 */
	private findArgumentsInList(handle: number): number {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			const found = this.findArguments(this.reader.listItem(handle, i));

			if (found !== 0) {
				return found;
			}
		}

		return 0;
	}

	/**
	 * Reports an `arguments` written where it can only mean the wrong thing.
	 * @param found The offending `Identifier`, or `0` if there is none.
	 * @param where What contains it, for the message.
	 * @returns Nothing.
	 */
	private checkNoArguments(found: number, where: string): void {
		if (found !== 0) {
			this.report(
				`'arguments' cannot be used in ${where}.`,
				this.reader.start(found),
			);
		}
	}

	//-------------------------------------------------------------------------
	// JSX
	//-------------------------------------------------------------------------

	/**
	 * Reports a JSX element or fragment written where JSX is not enabled.
	 *
	 * `parse()` reads JSX unconditionally, because whether it is allowed is
	 * exactly the kind of question the text alone cannot answer. Only the
	 * outermost element or fragment is reported, so a whole tree costs one
	 * problem rather than one per node.
	 * @param node The `JSXElement` or `JSXFragment` node index.
	 * @returns Nothing.
	 */
	private checkJsxNotAllowed(node: number): void {
		if (!this.jsx && !this.inJsx) {
			this.report(
				"JSX syntax is not allowed unless the jsx option is enabled.",
				this.reader.start(node),
			);
		}
	}

	/**
	 * Reports a closing tag whose name does not match its opening tag.
	 *
	 * A mismatched pair still forms a well-shaped tree, so it is reported here
	 * rather than thrown during parsing.
	 * @param node The `JSXElement` node index.
	 * @returns Nothing.
	 */
	private checkJsxTagsMatch(node: number): void {
		const reader = this.reader;
		const closing = reader.field(node, NODE_B);

		if (closing === 0) {
			return;
		}

		const opening = reader.field(node, NODE_A);
		const openingName = this.jsxTagName(reader.field(opening, NODE_A));
		const closingName = this.jsxTagName(reader.field(closing, NODE_A));

		if (openingName !== closingName) {
			this.report(
				`JSX element <${openingName}> is closed by </${closingName}>.`,
				reader.start(closing),
			);
		}
	}

	/**
	 * Reads a JSX tag name with its internal whitespace removed, so that
	 * `<A.B>` and `</A . B>` compare equal.
	 * @param name The name node index.
	 * @returns The tag name as written, without whitespace.
	 */
	private jsxTagName(name: number): string {
		return name === 0 ? "" : this.reader.text(name).replace(/\s+/gu, "");
	}

	//-------------------------------------------------------------------------
	// Private Names
	//-------------------------------------------------------------------------

	/*
	 * A `#x` is not a property name but a binding, and the thing it binds in is
	 * the class body — one private environment per class, nested inside the
	 * environments of any enclosing classes. A reference resolves against that
	 * whole stack, which is what lets an inner class reach an outer class's
	 * `#x`, and what makes a reference with no class around it an error.
	 *
	 * Two things make this unlike the ordinary scope walk. A class may refer to
	 * a name declared *later* in its own body, so every name has to be
	 * collected before any member is visited. And the heritage clause is
	 * outside its own class's environment — `class C extends this.#x { #x; }`
	 * does not resolve — which is why `extends` is visited before the push.
	 */

	/**
	 * Collects the private names a class body declares, reporting the ones it
	 * may not declare twice.
	 *
	 * A name may appear twice only as a getter/setter pair on the same side of
	 * `static`, so what is remembered per name is enough to tell that pair from
	 * every other repeat.
	 * @param body The `ClassBody` node index.
	 * @returns The names it declares.
	 */
	private collectPrivateNames(body: number): Set<string> {
		const reader = this.reader;
		const members = reader.field(body, NODE_A);
		const size = reader.listSize(members);
		const names = new Set<string>();

		/** What has been seen for a name so far, to allow one getter/setter pair. */
		const seen = new Map<string, number>();

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(members, i);
			const key = reader.field(member, NODE_A);

			if (
				key === 0 ||
				reader.kind(key) !== N_PrivateIdentifier ||
				(reader.flags(member) & NF_COMPUTED) !== 0
			) {
				continue;
			}

			const name = this.privateName(key);

			if (name === "#constructor") {
				this.report(
					"Classes may not have a private element named '#constructor'.",
					reader.start(key),
				);
				continue;
			}

			names.add(name);

			/*
			 * A getter and a setter pair up only with each other. Encoding the
			 * accessor kind and the `static` side in one number makes "have I
			 * already seen something this cannot sit beside?" a single lookup.
			 */
			const flags = reader.flags(member);
			const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;
			const isStatic = (flags & NF_STATIC) !== 0;
			const descriptor =
				accessor === MKIND_GET || accessor === MKIND_SET
					? accessor | (isStatic ? 4 : 0)
					: -1;
			const previous = seen.get(name);

			if (previous === undefined) {
				seen.set(name, descriptor);
				continue;
			}

			const pairs =
				descriptor >= 0 &&
				previous >= 0 &&
				(descriptor & 4) === (previous & 4) &&
				(descriptor & 3) !== (previous & 3);

			if (!pairs) {
				this.report(
					`Identifier '${name}' has already been declared.`,
					reader.start(key),
				);
				continue;
			}

			// A completed pair may not take a third member.
			seen.set(name, -1);
		}

		return names;
	}

	/**
	 * Reads a private name, resolving any escapes in it.
	 *
	 * Two private names are the same name when their `StringValue`s match, and
	 * `StringValue` is what the escapes mean rather than how they are spelled —
	 * `#℘` declares the same field `#℘` refers to. Comparing source text
	 * would report every escaped name as undeclared.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns The name, `#` included.
	 */
	private privateName(key: number): string {
		const raw = this.reader.text(key);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * Determines whether an expression reads a private field.
	 *
	 * Parentheses and an optional chain both wrap the member access without
	 * changing what is being deleted, so `delete (o?.#x)` has to be seen
	 * through to be reported.
	 * @param node The expression node index.
	 * @returns `true` when the expression is a private reference.
	 */
	private isPrivateReference(node: number): boolean {
		const reader = this.reader;
		let current = node;

		while (reader.kind(current) === N_ChainExpression) {
			current = reader.field(current, NODE_A);

			if (current === 0) {
				return false;
			}
		}

		if (reader.kind(current) !== N_MemberExpression) {
			return false;
		}

		const property = reader.field(current, NODE_B);

		return (
			property !== 0 && reader.kind(property) === N_PrivateIdentifier
		);
	}

	/**
	 * Reports a private name that no enclosing class declares.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns Nothing.
	 */
	private checkPrivateReference(key: number): void {
		const name = this.privateName(key);

		for (let i = this.privateNames.length - 1; i >= 0; i--) {
			if (this.privateNames[i].has(name)) {
				return;
			}
		}

		this.report(
			`Private field '${name}' must be declared in an enclosing class.`,
			this.reader.start(key),
		);
	}

	//-------------------------------------------------------------------------
	// Assignment Targets
	//-------------------------------------------------------------------------

	/*
	 * The spec calls this a node's `AssignmentTargetType`, and it is `simple`
	 * for exactly two things: a reference to a name, and a member access.
	 * Everything else is `invalid`, and assigning to it, incrementing it, or
	 * naming it in a `for-in`/`for-of` head is an early error.
	 *
	 * Destructuring widens that for `=` alone. `[a, b] = c` assigns through a
	 * pattern, so a pattern is allowed on the left of a plain assignment and
	 * of a `for-of` head, and each of its elements is then a target in its own
	 * right. It is *not* allowed on the left of `+=`, which has nothing to
	 * destructure.
	 *
	 * The parser has already done the hard half: it rewrites the left of a
	 * plain assignment into `ArrayPattern` and `ObjectPattern` where that
	 * reading works, so a bare `ArrayExpression` surviving to here is one that
	 * could not be reinterpreted.
	 */

	/**
	 * Reports an expression being assigned to that cannot be.
	 * @param node The target node index, or `0`.
	 * @param pattern Whether a destructuring pattern is allowed here, which it
	 *      is for `=` and a `for-of` head but not for `+=` or `++`.
	 * @returns Nothing.
	 */
	private checkAssignmentTarget(node: number, pattern: boolean): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;

		switch (reader.kind(node)) {
			case N_Identifier:
				this.checkRestrictedName(node, "assigned to");
				return;

			case N_MemberExpression:
				return;

			/*
			 * A TypeScript wrapper is transparent here. `x! = 1` and
			 * `(x as T) = 1` are the parser's shape for an assignment to `x`,
			 * and `@typescript-eslint/parser` accepts both, so looking through
			 * keeps this from reporting real TypeScript.
			 */
			case N_TSNonNullExpression:
			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
			case N_TSTypeAssertion:
				this.checkAssignmentTarget(reader.field(node, NODE_A), pattern);
				return;

			case N_ArrayPattern:
				if (pattern) {
					this.checkArrayPattern(node);
					return;
				}

				break;

			case N_ObjectPattern:
				if (pattern) {
					this.checkObjectPattern(node);
					return;
				}

				break;

			/*
			 * `f() = 1` is an early error in strict code and, for web
			 * compatibility, only a runtime `ReferenceError` in sloppy code —
			 * the spec spells the sloppy answer `~web-compat~` rather than
			 * `~invalid~`. `espree` reports it either way, which is the one
			 * deviation this check carries; see `docs/deviations.md`.
			 */
			case N_CallExpression:
				if (!this.strict) {
					return;
				}

				break;

			/*
			 * An optional chain is never a target: `a?.b = c` is an error even
			 * though `a.b = c` is fine, because the chain may produce
			 * `undefined` and there would be nothing to assign to.
			 */
			default:
				break;
		}

		this.report(
			"Invalid assignment target.",
			reader.start(node),
		);
	}

	/**
	 * Checks the elements of an array destructuring pattern.
	 *
	 * A rest element has to come last and take no default, since there is
	 * nothing after it to collect and nothing to be absent.
	 * @param node The `ArrayPattern` node index.
	 * @returns Nothing.
	 */
	private checkArrayPattern(node: number): void {
		const reader = this.reader;
		const elements = reader.field(node, NODE_A);
		const size = reader.listSize(elements);

		for (let i = 0; i < size; i++) {
			const element = reader.listItem(elements, i);

			// A hole is written as a missing element and targets nothing.
			if (element === 0) {
				continue;
			}

			if (reader.kind(element) !== N_RestElement) {
				this.checkPatternElement(element);
				continue;
			}

			if (i === size - 1) {
				this.checkCommaAfterRest(node, element);
			} else {
				this.report(
					"A rest element must be the last element.",
					reader.start(element),
				);
			}

			this.checkRestTarget(element);
		}
	}

	/**
	 * Checks the properties of an object destructuring pattern.
	 * @param node The `ObjectPattern` node index.
	 * @returns Nothing.
	 */
	private checkObjectPattern(node: number): void {
		const reader = this.reader;
		const properties = reader.field(node, NODE_A);
		const size = reader.listSize(properties);

		for (let i = 0; i < size; i++) {
			const property = reader.listItem(properties, i);

			if (reader.kind(property) === N_RestElement) {
				if (i === size - 1) {
					this.checkCommaAfterRest(node, property);
				} else {
					this.report(
						"A rest element must be the last element.",
						reader.start(property),
					);
				}

				this.checkRestTarget(property);
				continue;
			}

			this.checkPatternElement(reader.field(property, NODE_B));
		}
	}

	/**
	 * Reports a comma written after the rest element that ends a pattern.
	 * @param pattern The `ArrayPattern` or `ObjectPattern` node index.
	 * @param rest The `RestElement` that ends it.
	 * @returns Nothing.
	 */
	private checkCommaAfterRest(pattern: number, rest: number): void {
		if ((this.reader.flags(pattern) & NF_COMMA_AFTER_REST) !== 0) {
			this.report(
				"A comma is not allowed after a rest element.",
				this.reader.start(rest),
			);
		}
	}

	/**
	 * Checks one element of a pattern, seeing past its default.
	 * @param node The element node index, or `0`.
	 * @returns Nothing.
	 */
	private checkPatternElement(node: number): void {
		if (node === 0) {
			return;
		}

		this.checkAssignmentTarget(
			this.reader.kind(node) === N_AssignmentPattern
				? this.reader.field(node, NODE_A)
				: node,
			true,
		);
	}

	/**
	 * Checks what a rest element collects into.
	 * @param node The `RestElement` node index.
	 * @returns Nothing.
	 */
	private checkRestTarget(node: number): void {
		const target = this.reader.field(node, NODE_A);

		if (target !== 0 && this.reader.kind(target) === N_AssignmentPattern) {
			this.report(
				"A rest element cannot have an initializer.",
				this.reader.start(target),
			);

			return;
		}

		this.checkAssignmentTarget(target, true);
	}

	//-------------------------------------------------------------------------
	// `break` and `continue`
	//-------------------------------------------------------------------------

	/**
	 * Reports a `break` or `continue` with nothing to act on.
	 *
	 * Without a label, `break` needs a loop or a `switch` around it and
	 * `continue` needs a loop; with one, both need a labelled statement of
	 * that name, and `continue` needs that statement to be a loop. Either way
	 * the target has to be in the same function: a label is a name for a
	 * statement, and a nested function cannot leave a statement it is inside
	 * of rather than part of.
	 * @param node The `BreakStatement` or `ContinueStatement` node index.
	 * @param isContinue Whether it is a `continue`, which a `switch` and a
	 *      label on anything but a loop do not answer.
	 * @returns Nothing.
	 */
	private checkBreakOrContinue(node: number, isContinue: boolean): void {
		const reader = this.reader;
		const label = reader.field(node, NODE_A);
		const word = isContinue ? "continue" : "break";

		if (label === 0) {
			if (
				this.iterationDepth === 0 &&
				(isContinue || this.switchDepth === 0)
			) {
				this.report(
					isContinue
						? "'continue' must be inside a loop."
						: "'break' must be inside a loop or a switch.",
					reader.start(node),
				);
			}

			return;
		}

		const name = this.identifierName(label);

		for (const entry of this.labels) {
			if (entry.name !== name) {
				continue;
			}

			if (!isContinue || entry.iteration) {
				return;
			}

			this.report(
				`Label '${name}' is not on a loop, so 'continue' cannot name it.`,
				reader.start(node),
			);

			return;
		}

		this.report(
			`Label '${name}' is not enclosing this '${word}'.`,
			reader.start(node),
		);
	}

	//-------------------------------------------------------------------------
	// `for` Statement Heads
	//-------------------------------------------------------------------------

	/**
	 * Reports a `for-in` or `for-of` head that declares more than it may.
	 *
	 * A C-style head runs its initializer once and then tests; these two take
	 * their values from something else entirely, so a binding with an
	 * initializer has nowhere for the value to go and a second binding has
	 * nothing to bind. Annex B keeps the one spelling the web already had —
	 * `for (var x = 1 in y)` in sloppy code, and only for a plain name, since
	 * a pattern would have to be destructured before the loop could start.
	 * @param node The `ForInStatement` or `ForOfStatement` node index.
	 * @param isForOf Whether it is a `for-of`, which Annex B does not reach.
	 * @returns Nothing.
	 */
	private checkForHead(node: number, isForOf: boolean): void {
		const reader = this.reader;
		const left = reader.field(node, NODE_A);

		if (left === 0) {
			return;
		}

		if (reader.kind(left) !== N_VariableDeclaration) {
			/*
			 * `for (async of x)` is the one thing the grammar looks ahead to
			 * rule out, so that it never has to be told from the `for await`
			 * that was arriving at the same time. It is a restriction on the
			 * *token*, so all three ways out of it are lexical: parentheses
			 * make it an expression rather than the lookahead, an escape
			 * makes it a different token, and `for await (async of x)` is a
			 * production the restriction was never put on.
			 */
			if (
				isForOf &&
				(reader.flags(node) & NF_ASYNC) === 0 &&
				reader.kind(left) === N_Identifier &&
				(reader.flags(left) & NF_PARENTHESIZED) === 0 &&
				reader.text(left) === "async"
			) {
				this.report(
					"'async' may not be the target of a for-of loop.",
					reader.start(left),
				);
			}

			return;
		}

		const declarations = reader.field(left, NODE_A);
		const size = reader.listSize(declarations);

		if (size > 1) {
			this.report(
				"A for-in or for-of head may declare only one binding.",
				reader.start(reader.listItem(declarations, 1)),
			);

			return;
		}

		const declarator = size === 0 ? 0 : reader.listItem(declarations, 0);

		if (declarator === 0 || reader.field(declarator, NODE_B) === 0) {
			return;
		}

		const declarationKind =
			(reader.flags(left) & DECL_MASK) >>> DECL_SHIFT;

		if (
			!isForOf &&
			declarationKind === DECL_VAR &&
			!this.strict &&
			reader.kind(reader.field(declarator, NODE_A)) === N_Identifier
		) {
			return;
		}

		this.report(
			"A for-in or for-of head may not have an initializer.",
			reader.start(reader.field(declarator, NODE_B)),
		);
	}

	//-------------------------------------------------------------------------
	// Class Element Names
	//-------------------------------------------------------------------------

	/*
	 * Three names are spoken for inside a class body. `constructor` names the
	 * one method the `new` operator runs, so it may not also be a field, and
	 * it may not be a method of a kind that could not be run that way — a
	 * getter, a setter, a generator, or an async function. `prototype` is
	 * already a property of the constructor function itself, so no static
	 * element may take it. And a class has one constructor.
	 *
	 * All three are rules about the *name*, which a computed key does not
	 * have: `class C { static ["prototype"]() {} }` is legal, because nothing
	 * can know what the brackets will produce until the class is evaluated.
	 */

	/**
	 * The name a class element is written with.
	 * @param node The element node index.
	 * @returns The name, or `null` for a computed or private one.
	 */
	private propertyName(node: number): string | null {
		const reader = this.reader;

		if ((reader.flags(node) & NF_COMPUTED) !== 0) {
			return null;
		}

		const key = reader.field(node, NODE_A);

		if (key === 0) {
			return null;
		}

		switch (reader.kind(key)) {
			case N_Identifier:
				return this.identifierName(key);

			/*
			 * A string key is the string it denotes, so
			 * `class C { "constructor"; }` is the same mistake written
			 * differently. A numeric one can never spell either name.
			 */
			case N_Literal:
				return reader.field(key, NODE_A) === LIT_STRING
					? decodeEscapes(reader.text(key).slice(1, -1), false)
					: null;

			default:
				return null;
		}
	}

	/**
	 * Reports a class element whose name it may not have.
	 * @param node The element node index.
	 * @param kind The element's node kind.
	 * @returns Nothing.
	 */
	private checkClassElementName(node: number, kind: number): void {
		const reader = this.reader;
		const flags = reader.flags(node);
		const isStatic = (flags & NF_STATIC) !== 0;
		const name = this.propertyName(node);

		if (name === null) {
			return;
		}

		if (isStatic && name === "prototype") {
			this.report(
				"A static class element may not be named 'prototype'.",
				reader.start(node),
			);

			return;
		}

		if (name !== "constructor") {
			return;
		}

		/*
		 * A field takes the name nowhere: there is no `constructor` field to
		 * be had, static or not, because the name belongs to the method that
		 * `new` runs and to the property that points back at the class.
		 */
		if (
			kind !== N_MethodDefinition &&
			kind !== N_TSAbstractMethodDefinition
		) {
			this.report(
				"A class field may not be named 'constructor'.",
				reader.start(node),
			);

			return;
		}

		/*
		 * A *static* method called `constructor` is an ordinary static member
		 * and escapes the rest of this — the name is only spoken for on the
		 * prototype side.
		 */
		if (isStatic) {
			return;
		}

		const value = reader.field(node, NODE_B);
		const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;

		if (
			accessor !== MKIND_CONSTRUCTOR ||
			(value !== 0 &&
				(reader.flags(value) & (NF_GENERATOR | NF_ASYNC)) !== 0)
		) {
			this.report(
				"A class constructor may not be a getter, a setter, a generator, or async.",
				reader.start(node),
			);

			return;
		}

		/*
		 * A body-less constructor is a TypeScript overload signature, and
		 * signatures describe the one implementation rather than adding
		 * another — so only an implementation is counted, and two of those
		 * are what a class may not have.
		 */
		if (value === 0 || reader.kind(value) === N_TSEmptyBodyFunctionExpression) {
			return;
		}

		if (this.sawConstructor) {
			this.report(
				"A class may not have more than one constructor.",
				reader.start(node),
			);

			return;
		}

		this.sawConstructor = true;
	}

	//-------------------------------------------------------------------------
	// Single-Statement Contexts
	//-------------------------------------------------------------------------

	/**
	 * Reports a declaration written where only a statement may go.
	 *
	 * The body of an `if`, a loop, a `with`, or a label is a `Statement`, and
	 * a `Declaration` is not one — there is nowhere for `let x = 1;` to bind
	 * when the only thing that can reach it is a branch that may not be
	 * taken. Annex B carves out the one case the web already depended on: a
	 * plain function declaration as the body of an `if`, or under a label, in
	 * sloppy code. Neither carve-out survives strict mode, and neither
	 * stretches to a generator or an async function, both of which Annex B
	 * predates.
	 * @param body The body node index, or `0`.
	 * @param allowFunction Whether Annex B's function carve-out reaches here.
	 * @returns Nothing.
	 */
	private checkStatementBody(body: number, allowFunction: boolean): void {
		if (body === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(body);

		if (kind === N_VariableDeclaration) {
			// `var` is the one declaration that is also a statement.
			if (
				((reader.flags(body) & DECL_MASK) >>> DECL_SHIFT) === DECL_VAR
			) {
				return;
			}
		} else if (
			kind !== N_ClassDeclaration &&
			kind !== N_FunctionDeclaration
		) {
			return;
		}

		if (
			allowFunction &&
			!this.strict &&
			kind === N_FunctionDeclaration &&
			(reader.flags(body) & (NF_GENERATOR | NF_ASYNC)) === 0
		) {
			return;
		}

		this.report(
			"A declaration may not appear in a single-statement context.",
			reader.start(body),
		);
	}

	//-------------------------------------------------------------------------
	// Node Checks
	//-------------------------------------------------------------------------

	/**
	 * Applies the checks that belong to a single node.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private check(node: number, kind: number): void {
		if (this.dialect === "js" && kind >= TS_FIRST) {
			this.report(
				`TypeScript syntax is not allowed when the dialect is "js".`,
				this.reader.start(node),
			);
		}

		switch (kind) {
			case N_MethodDefinition:
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractMethodDefinition:
			case N_TSAbstractPropertyDefinition:
			case N_TSAbstractAccessorProperty:
				this.checkClassElementName(node, kind);
				return;

			case N_ImportDeclaration:
			case N_ExportNamedDeclaration:
			case N_ExportDefaultDeclaration:
			case N_ExportAllDeclaration:
				if (this.sourceType !== "module") {
					this.report(
						"'import' and 'export' may only appear when sourceType is \"module\".",
						this.reader.start(node),
					);
				} else if (!this.moduleItemsAllowed) {
					/*
					 * A `ModuleItem` is not a `Statement`, so there is no
					 * production that puts one inside a block, a function, or
					 * the body of an `if`. TypeScript adds exactly one place:
					 * the body of a namespace or an ambient module.
					 */
					this.report(
						"'import' and 'export' may only appear at the top level of a module or a namespace.",
						this.reader.start(node),
					);
				}

				return;

			case N_BreakStatement:
			case N_ContinueStatement:
				this.checkBreakOrContinue(node, kind === N_ContinueStatement);
				return;

			case N_WithStatement:
				if (this.strict) {
					this.report(
						"Strict mode code may not include a with statement.",
						this.reader.start(node),
					);
				}

				this.checkStatementBody(this.reader.field(node, NODE_B), false);
				return;

			/*
			 * Annex B's carve-out reaches the two branches of an `if` and the
			 * body of a label, and nothing else: an iteration statement would
			 * declare the function afresh on every turn.
			 */
			case N_IfStatement:
				this.checkStatementBody(this.reader.field(node, NODE_B), true);
				this.checkStatementBody(this.reader.field(node, NODE_C), true);
				return;

			case N_LabeledStatement:
				this.checkStatementBody(
					this.reader.field(node, NODE_B),
					this.inStatementList,
				);
				return;

			case N_WhileStatement:
				this.checkStatementBody(this.reader.field(node, NODE_B), false);
				return;

			case N_DoWhileStatement:
				this.checkStatementBody(this.reader.field(node, NODE_A), false);
				return;

			case N_ForStatement:
				this.checkStatementBody(this.reader.field(node, NODE_D), false);
				return;

			/*
			 * The two places a private name is *used*: `o.#x`, and the
			 * `#x in o` form that exists to ask whether an object has one
			 * without throwing.
			 */
			case N_MemberExpression: {
				const property = this.reader.field(node, NODE_B);

				if (
					property !== 0 &&
					this.reader.kind(property) === N_PrivateIdentifier
				) {
					this.checkPrivateReference(property);

					/*
					 * A private name is looked up on the object itself, and
					 * `super` names the prototype rather than an object, so
					 * there is nothing for `super.#x` to read.
					 */
					if (
						this.reader.kind(this.reader.field(node, NODE_A)) ===
						N_Super
					) {
						this.report(
							"A private name may not be read on 'super'.",
							this.reader.start(node),
						);
					}
				}

				this.checkSuperOperand(
					this.reader.field(node, NODE_A),
					this.superPropertyAllowed,
					"'super' may only be read inside a method, a field initializer, or a static block.",
				);
				return;
			}

			/*
			 * The other half of `super`. A call is far more restricted than a
			 * property access: every method of a derived class may read
			 * `super.x`, and only its constructor may call `super()`.
			 */
			case N_CallExpression:
				this.checkSuperOperand(
					this.reader.field(node, NODE_A),
					this.superCallAllowed,
					"'super' may only be called inside the constructor of a derived class.",
				);
				return;

			/*
			 * Anything that reaches here is a `super` the walk arrived at
			 * without passing through a call or a member access above it, and
			 * `super` is not an expression on its own.
			 */
			case N_Super:
				if (node !== this.sanctionedSuper) {
					this.report(
						"'super' must be followed by an argument list or a property access.",
						this.reader.start(node),
					);
				}

				return;

			case N_BinaryExpression: {
				const left = this.reader.field(node, NODE_A);

				if (
					this.reader.field(node, NODE_C) === T_in &&
					left !== 0 &&
					this.reader.kind(left) === N_PrivateIdentifier
				) {
					this.checkPrivateReference(left);
				}

				return;
			}

			/*
			 * `delete o.#x` is an early error however the reference is
			 * written, because a private field cannot be removed.
			 */
			case N_UnaryExpression: {
				const argument = this.reader.field(node, NODE_A);

				if (
					this.reader.field(node, NODE_B) === T_delete &&
					argument !== 0 &&
					this.isPrivateReference(argument)
				) {
					this.report(
						"Private fields cannot be deleted.",
						this.reader.start(node),
					);
				}

				return;
			}

			case N_AssignmentExpression:
				this.checkAssignmentTarget(
					this.reader.field(node, NODE_A),
					this.reader.field(node, NODE_C) === T_ASSIGN,
				);
				return;

			case N_UpdateExpression:
				this.checkAssignmentTarget(
					this.reader.field(node, NODE_A),
					false,
				);
				return;

			/*
			 * A `for` head either declares its binding, in which case the
			 * declaration is what is checked, or assigns to an existing
			 * target. `for-in` takes a pattern too — `for ([a, b] in c)` is
			 * legal, if odd.
			 */
			case N_ForInStatement:
			case N_ForOfStatement: {
				const left = this.reader.field(node, NODE_A);

				if (
					left !== 0 &&
					this.reader.kind(left) !== N_VariableDeclaration
				) {
					this.checkAssignmentTarget(left, true);
				}

				this.checkForHead(node, kind === N_ForOfStatement);
				this.checkStatementBody(this.reader.field(node, NODE_C), false);
				return;
			}

			/*
			 * The pattern between the slashes. `parse()` found where the
			 * literal ends, which is all the lexical grammar covers; whether
			 * the text in between is a pattern at all is an early error on the
			 * literal, and so belongs here.
			 */
			case N_Literal: {
				if (this.reader.field(node, NODE_A) !== LIT_REGEXP) {
					return;
				}

				this.regexp ??= new RegExpValidator();

				const problem = this.regexp.validate(
					this.reader.source,
					this.reader.start(node),
					this.reader.field(node, NODE_B),
					this.reader.end(node),
				);

				if (problem !== null) {
					this.report(problem.message, problem.start);
				}

				return;
			}

			case N_Identifier:
				this.checkIdentifierWord(node);
				return;

			/*
			 * A default value is evaluated as the call sets up the function's
			 * own scope, before there is anything to suspend, so neither form
			 * of suspension may appear in one.
			 */
			case N_YieldExpression:
			case N_AwaitExpression:
				if (this.inParameters) {
					this.report(
						kind === N_YieldExpression
							? "A yield expression may not appear in a parameter list."
							: "An await expression may not appear in a parameter list.",
						this.reader.start(node),
					);
				}

				return;

			/*
			 * Shorthand reuses one node for both halves, and that node was
			 * read as a property name — but in `({ await })` it is also the
			 * reference, so it is checked here where the shorthand is known.
			 * `import { await }` and `export { await }` have the same shape.
			 */
			case N_Property:
				if ((this.reader.flags(node) & NF_SHORTHAND) !== 0) {
					this.checkSharedName(node);
				}

				return;

			case N_ImportSpecifier:
			case N_ExportSpecifier:
				this.checkSharedName(node);
				return;

			case N_JSXElement:
				this.checkJsxNotAllowed(node);
				this.checkJsxTagsMatch(node);
				return;

			case N_JSXFragment:
				this.checkJsxNotAllowed(node);
				return;

			case N_ReturnStatement:
				if (this.functionDepth === 0) {
					this.report(
						"'return' outside of function.",
						this.reader.start(node),
					);
				}

				return;

			/*
			 * Top-level `await` is not checked here. Whether `await` is an
			 * operator at all is settled in `parse()`, which is told the
			 * source type: in a script it is an ordinary name, so no
			 * `AwaitExpression` can reach the top level of one to be
			 * complained about.
			 */

			case N_Program:
			case N_VariableDeclarator:
			case N_VariableDeclaration:
			default:
				return;
		}
	}
}

/** Re-exported for callers that want the node constant. */
export { N_Program };
