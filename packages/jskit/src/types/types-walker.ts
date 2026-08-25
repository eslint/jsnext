/**
 * @fileoverview The walk that reads types out of a parsed program.
 *
 * Two passes over the tree, both in source order, both driven by the binary
 * buffers and materializing no ESTree objects.
 *
 * The **declaration pass** reads what the program states: annotations,
 * function signatures, classes, interfaces, type aliases, enums, and imports.
 * It binds what it learns to the scope buffer's symbols — a symbol's *value*
 * type and, separately, the type it *declares* — so that the expression pass
 * and every later consumer can follow a name to its meaning. Hoisting is why
 * this pass exists: a call above the function it calls still types, because
 * the signature was read before any expression.
 *
 * The **expression pass** types what expressions it can by simple
 * syntax-directed rules — literals, operators with fixed result types,
 * initializers, member lookups, calls through typed callees, `await` through
 * `Promise` — and records a `(node, type)` pair for every node it can speak
 * for. Where the answer would need real checking or narrowing, it records
 * nothing: silence, never a guess.
 *
 * A type reference does not copy its target's structure; it stores the
 * symbol it resolved to, and consumers chase the symbol's declared type.
 * That is what makes forward references free and keeps one interface one
 * record no matter how many times it is named.
 *
 * Everything here must stay byte-for-byte reproducible by the Rust
 * implementation: creation order is source order, internments are by exact
 * key, and no output depends on hash iteration or float formatting.
 */

import {
	AstReader,
	DECL_AWAIT_USING,
	DECL_CONST,
	DECL_MASK,
	DECL_SHIFT,
	DECL_USING,
	LIT_BIGINT,
	LIT_BOOLEAN,
	LIT_NULL,
	LIT_NUMBER,
	LIT_REGEXP,
	LIT_STRING,
	MKIND_CONSTRUCTOR,
	MKIND_GET,
	MKIND_MASK,
	MKIND_SET,
	MKIND_SHIFT,
	NF_COMPUTED,
	NF_TYPE_ONLY,
	NF_ASYNC,
	NF_GENERATOR,
	NF_METHOD,
	NF_OPTIONAL,
	NF_READONLY,
	NF_STATIC,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	N_AccessorProperty,
	N_ArrayExpression,
	N_ArrayPattern,
	N_ArrowFunctionExpression,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_AwaitExpression,
	N_BinaryExpression,
	N_CallExpression,
	N_CatchClause,
	N_ChainExpression,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ConditionalExpression,
	N_ExportNamedDeclaration,
	N_ExportSpecifier,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_Identifier,
	N_ImportDeclaration,
	N_ImportDefaultSpecifier,
	N_ImportExpression,
	N_ImportSpecifier,
	N_Literal,
	N_LogicalExpression,
	N_MemberExpression,
	N_MethodDefinition,
	N_NewExpression,
	N_ObjectExpression,
	N_ObjectPattern,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_SequenceExpression,
	N_SpreadElement,
	N_TSAbstractAccessorProperty,
	N_TSAbstractMethodDefinition,
	N_TSAbstractPropertyDefinition,
	N_TSAnyKeyword,
	N_TSArrayType,
	N_TSAsExpression,
	N_TSBigIntKeyword,
	N_TSBooleanKeyword,
	N_TSCallSignatureDeclaration,
	N_TSClassImplements,
	N_TSConstructSignatureDeclaration,
	N_TSConstructorType,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_TSEnumDeclaration,
	N_TSEnumMember,
	N_TSFunctionType,
	N_TSIndexSignature,
	N_TSInstantiationExpression,
	N_TSInterfaceDeclaration,
	N_TSInterfaceHeritage,
	N_TSIntersectionType,
	N_TSLiteralType,
	N_TSMethodSignature,
	N_TSModuleDeclaration,
	N_TSNamedTupleMember,
	N_TSNeverKeyword,
	N_TSNonNullExpression,
	N_TSNullKeyword,
	N_TSNumberKeyword,
	N_TSObjectKeyword,
	N_TSOptionalType,
	N_TSParameterProperty,
	N_TSPropertySignature,
	N_TSQualifiedName,
	N_TSRestType,
	N_TSSatisfiesExpression,
	N_TSStringKeyword,
	N_TSSymbolKeyword,
	N_TSTemplateLiteralType,
	N_TSTupleType,
	N_TSTypeLiteral,
	N_TSTypeAliasDeclaration,
	N_TSTypeAnnotation,
	N_TSTypeAssertion,
	N_TSTypeParameter,
	N_TSTypeParameterDeclaration,
	N_TSTypeParameterInstantiation,
	N_TSTypePredicate,
	N_TSTypeReference,
	N_TSUndefinedKeyword,
	N_TSUnionType,
	N_TSUnknownKeyword,
	N_TSVoidKeyword,
	N_TemplateLiteral,
	N_UnaryExpression,
	N_UpdateExpression,
	N_VariableDeclaration,
	N_VariableDeclarator,
	SLOT_COUNT,
	SLOT_LIST,
	SLOT_NODE,
	SLOT_TABLE,
	T_delete,
	T_in,
	T_instanceof,
	T_ASSIGN,
	T_ASSIGN_AMPAMP,
	T_ASSIGN_PLUS,
	T_ASSIGN_QQ,
	T_EQ_EQ,
	T_GT_EQ,
	T_MINUS,
	T_NOT,
	T_PLUS,
	T_TILDE,
	T_typeof,
	T_void,
} from "../parse/index.js";
import {
	BinaryAst,
	DEF_IMPORT_BINDING,
	RF_TYPE,
	RF_VALUE,
	R_FLAGS,
	R_RESOLVED,
	ScopeBufferReader,
	DEF_CLASS_NAME,
	DEF_FUNCTION_NAME,
	DEF_TS_ENUM_NAME,
	DEF_VARIABLE,
	D_NAME,
	D_NODE,
	D_PARENT,
	D_TYPE,
	V_DEFINITIONS,
	V_IDENTIFIERS,
	V_NAME,
	codeOfDefinitionType,
} from "../scope/index.js";
import { typeNodeHandle } from "./handles.js";
import { TypesBuilder } from "./types-builder.js";
import {
	SY_NAME,
	SY_ORIGIN,
	SY_SPECIFIER,
	SY_TARGET,
	TM_FLAGS,
	TM_NAME,
	TM_TYPE,
	TMF_GETTER,
	TMF_INDEX_NUMBER,
	TMF_INDEX_STRING,
	TMF_METHOD,
	TMF_OPTIONAL,
	TMF_READONLY,
	TMF_SETTER,
	TYF_ANY,
	TYF_BIGINT_LIKE,
	TYF_BIGINT_LITERAL,
	TYF_ENUM,
	TYF_ENUM_LITERAL,
	TYF_INTERSECTION,
	TYF_NULLISH,
	TYF_NUMBER_LITERAL,
	TYF_OBJECT,
	TYF_STRING_LIKE,
	TYF_STRING_LITERAL,
	TYF_TEMPLATE_LITERAL,
	TYF_TYPE_PARAMETER,
	TYF_UNION,
	TYF_UNKNOWN,
	TYO_FILE,
	TYO_GLOBAL,
	TYO_LIB,
	TYO_LOCAL,
	TYO_PACKAGE,
	TYPE_ANY,
	TYPE_BIGINT,
	TYPE_BOOLEAN,
	TYPE_FALSE,
	TYPE_NEVER,
	TYPE_NONE,
	TYPE_NULL,
	TYPE_NUMBER,
	TYPE_OBJECT,
	TYPE_STRING,
	TYPE_SYMBOL,
	TYPE_TRUE,
	TYPE_UNDEFINED,
	TYPE_UNKNOWN,
	TYPE_VOID,
	TYS_ANONYMOUS,
	TYS_ARRAY,
	TYS_CALLABLE,
	TYS_CLASS,
	TYS_CONSTRUCTOR,
	TYS_DEFERRED,
	TYS_FOREIGN,
	TYS_FUNCTION,
	TYS_INEXACT,
	TYS_INTERFACE,
	TYS_NAMESPACE,
	TYS_REFERENCE,
	TYS_TUPLE,
	TYS_UNRESOLVED,
	TY_DATA0,
	TY_DATA1,
	TY_FLAGS,
	TY_MEMBER_COUNT,
	TY_MEMBER_FIRST,
	TY_SHAPE,
	TY_SYMBOL,
} from "./types-buffer.js";
import { isWellKnownLibType } from "./well-known.js";

/** How deep a member lookup follows references and heritage before giving up. */
const MEMBER_LOOKUP_DEPTH = 8;

/** A member entry collected before its run is written contiguously. */
interface MemberEntry {
	/** The name's string ID, `0` for an index signature. */
	name: number;

	/** The member's type ID. */
	type: number;

	/** The `TMF_*` flags. */
	flags: number;
}

/**
 * Reads types out of the parse and scope buffers and records them into a
 * `TypesBuilder`.
 */
export class TypesWalker {
	/** The reader over the parse buffer. */
	readonly #reader: AstReader;

	/** The accessor that slices names and literal text out of the source. */
	readonly #ast: BinaryAst;

	/** The reader over the scope buffer. */
	readonly #scope: ScopeBufferReader;

	/** The builder collecting the output. */
	readonly #builder: TypesBuilder;

	/** Identifier node handle to the scope symbol it declares. */
	readonly #symbolOfIdent = new Map<number, number>();

	/** Our symbol ID for a scope symbol, `-1` until created. */
	readonly #typeSymbolOf: Int32Array;

	/** Node index to the type already computed for it. */
	readonly #nodeTypeMemo = new Map<number, number>();

	/** The definition type code of an import binding. */
	readonly #importCode = codeOfDefinitionType(DEF_IMPORT_BINDING);

	/** The definition type codes of value declarations a namespace merges with. */
	readonly #valueMergeCodes = [
		codeOfDefinitionType(DEF_CLASS_NAME),
		codeOfDefinitionType(DEF_FUNCTION_NAME),
		codeOfDefinitionType(DEF_TS_ENUM_NAME),
		codeOfDefinitionType(DEF_VARIABLE),
	];

	/**
	 * Creates a walker over one program.
	 * @param reader The reader over the parse buffer.
	 * @param scope The reader over the scope buffer built from it.
	 * @param builder The builder that collects the result.
	 */
	constructor(
		reader: AstReader,
		scope: ScopeBufferReader,
		builder: TypesBuilder,
	) {
		this.#reader = reader;
		this.#ast = new BinaryAst(reader);
		this.#scope = scope;
		this.#builder = builder;
		this.#typeSymbolOf = new Int32Array(scope.symbolCount).fill(-1);

		/*
		 * Every declared name, keyed by the identifier that declares it. The
		 * scope buffer already knows both halves; one pass over its symbols
		 * turns "which symbol does this identifier declare" into a map hit.
		 */
		for (let symbol = 0; symbol < scope.symbolCount; symbol++) {
			const idents = scope.listItems(
				scope.symbolField(symbol, V_IDENTIFIERS),
			);

			for (let i = 0; i < idents.length; i++) {
				if (!this.#symbolOfIdent.has(idents[i])) {
					this.#symbolOfIdent.set(idents[i], symbol);
				}
			}
		}
	}

	/**
	 * Runs both passes over the whole program.
	 * @returns Nothing.
	 */
	build(): void {
		this.#declare(this.#reader.root);
		this.#express(this.#reader.root);
	}

	//-------------------------------------------------------------------------
	// Shared plumbing
	//-------------------------------------------------------------------------

	/**
	 * The handle of a node.
	 * @param node The node index.
	 * @returns Its byte offset in the parse buffer.
	 */
	#handle(node: number): number {
		return typeNodeHandle(this.#reader, node);
	}

	/**
	 * Records a node's type when there is one to record.
	 * @param node The node index.
	 * @param type The type ID, `TYPE_NONE` to record nothing.
	 * @returns Nothing.
	 */
	#record(node: number, type: number): void {
		if (type !== TYPE_NONE) {
			this.#builder.addNodeType(this.#handle(node), type);
		}
	}

	/**
	 * Descends into every child of a node, in slot order.
	 * @param node The node index.
	 * @param visit The per-node visit to apply.
	 * @returns Nothing.
	 */
	#eachChild(node: number, visit: (child: number) => void): void {
		const reader = this.#reader;
		const kind = reader.kind(node);
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const shape = SLOT_TABLE[base + slot];

			if (shape === SLOT_NODE) {
				const child = reader.field(node, NODE_A + slot);

				if (child !== 0) {
					visit(child);
				}
			} else if (shape === SLOT_LIST) {
				const list = reader.field(node, NODE_A + slot);
				const size = reader.listSize(list);

				for (let i = 0; i < size; i++) {
					const child = reader.listItem(list, i);

					if (child !== 0) {
						visit(child);
					}
				}
			}
		}
	}

	/**
	 * The scope symbol an identifier declares, or `-1`.
	 * @param ident The identifier node index.
	 * @returns The scope symbol ID, or `-1`.
	 */
	#declaredSymbol(ident: number): number {
		const symbol = this.#symbolOfIdent.get(this.#handle(ident));

		return symbol === undefined ? -1 : symbol;
	}

	/**
	 * Whether a symbol also has a value declaration — a function, class,
	 * enum, or variable a namespace of the same name merges with.
	 * @param symbol The scope symbol ID.
	 * @returns `true` when a value declaration shares the symbol.
	 */
	#mergesWithValue(symbol: number): boolean {
		const scope = this.#scope;
		const defs = scope.listItems(scope.symbolField(symbol, V_DEFINITIONS));

		for (let i = 0; i < defs.length; i++) {
			if (
				this.#valueMergeCodes.includes(
					scope.definitionField(defs[i], D_TYPE),
				)
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * The scope symbol an identifier reference resolves to, or `-1`.
	 * @param ident The identifier node index.
	 * @param namespaceFlag `RF_VALUE` or `RF_TYPE`: which namespace to prefer.
	 * @returns The scope symbol ID, or `-1`.
	 */
	#resolvedSymbol(ident: number, namespaceFlag: number): number {
		const refs = this.#scope.referencesAtIdentifier(this.#handle(ident));
		let fallback = -1;

		for (let i = 0; i < refs.length; i++) {
			const resolved = this.#scope.referenceField(refs[i], R_RESOLVED);

			if (resolved === 0) {
				continue;
			}

			const flags = this.#scope.referenceField(refs[i], R_FLAGS);

			if ((flags & namespaceFlag) !== 0) {
				return resolved - 1;
			}

			if (fallback === -1) {
				fallback = resolved - 1;
			}
		}

		return fallback;
	}

	/**
	 * Whether an identifier reference resolves to nothing — a global.
	 * @param ident The identifier node index.
	 * @returns `true` when a reference exists and none of its records resolve.
	 */
	#isUnresolved(ident: number): boolean {
		const refs = this.#scope.referencesAtIdentifier(this.#handle(ident));

		if (refs.length === 0) {
			return false;
		}

		for (let i = 0; i < refs.length; i++) {
			if (this.#scope.referenceField(refs[i], R_RESOLVED) !== 0) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Our symbol for a name the standard library declares.
	 * @param name The global's name.
	 * @returns The symbol ID.
	 */
	#libSymbol(name: string): number {
		return this.#builder.internSymbol(
			this.#builder.intern(name),
			TYO_LIB,
			0,
			0,
			0,
		);
	}

	/**
	 * Our symbol for a scope symbol, created on first use.
	 *
	 * A local declaration gets a `local` origin and its declaring node; an
	 * import binding gets the origin its module specifier implies — a
	 * `package` or a `file` — the imported name rather than the local alias,
	 * and the specifier itself, which is what lets a consumer match the
	 * symbol the way `TypeOrValueSpecifier` does.
	 * @param symbol The scope symbol ID.
	 * @returns Our symbol ID.
	 */
	#symbolFor(symbol: number): number {
		let id = this.#typeSymbolOf[symbol];

		if (id !== -1) {
			return id;
		}

		const scope = this.#scope;
		const builder = this.#builder;
		let name = builder.intern(
			scope.string(scope.symbolField(symbol, V_NAME)),
		);
		let origin = TYO_LOCAL;
		let specifier = 0;
		let decl = 0;
		const defs = scope.listItems(scope.symbolField(symbol, V_DEFINITIONS));

		if (defs.length > 0) {
			const def = defs[0];

			decl = scope.definitionField(def, D_NAME);

			if (scope.definitionField(def, D_TYPE) === this.#importCode) {
				const from = this.#importSource(
					scope.definitionField(def, D_PARENT),
				);

				if (from !== null) {
					origin =
						from.startsWith(".") || from.startsWith("/")
							? TYO_FILE
							: TYO_PACKAGE;
					specifier = builder.intern(from) + 1;
				}

				name = this.#importedName(
					scope.definitionField(def, D_NODE),
					name,
				);
				decl = scope.definitionField(def, D_NODE);
			}
		}

		id = builder.internSymbol(name, origin, specifier, decl, symbol + 1);
		this.#typeSymbolOf[symbol] = id;

		return id;
	}

	/**
	 * The module specifier of an import declaration.
	 * @param handle The handle of the `ImportDeclaration` node.
	 * @returns The specifier text, or `null` when the handle is not one.
	 */
	#importSource(handle: number): string | null {
		if (handle === 0) {
			return null;
		}

		const node = this.#nodeAt(handle);

		if (this.#reader.kind(node) !== N_ImportDeclaration) {
			return null;
		}

		return this.#ast.literalString(this.#reader.field(node, NODE_B));
	}

	/**
	 * The name an import binding was exported under.
	 * @param handle The handle of the specifier node.
	 * @param fallback The local name's string ID.
	 * @returns The string ID of the imported name.
	 */
	#importedName(handle: number, fallback: number): number {
		if (handle === 0) {
			return fallback;
		}

		const node = this.#nodeAt(handle);
		const kind = this.#reader.kind(node);

		if (kind === N_ImportSpecifier) {
			const imported = this.#reader.field(node, NODE_A);

			return this.#builder.intern(
				this.#reader.kind(imported) === N_Literal
					? this.#ast.literalString(imported)
					: this.#ast.name(imported),
			);
		}

		if (kind === N_ImportDefaultSpecifier) {
			return this.#builder.intern("default");
		}

		return fallback;
	}

	/**
	 * The node a handle names.
	 * @param handle The node's handle.
	 * @returns The node's index.
	 */
	#nodeAt(handle: number): number {
		const reader = this.#reader;

		return (handle / 4 - reader.nodesBase) / reader.nodeWords;
	}

	//-------------------------------------------------------------------------
	// Type construction helpers
	//-------------------------------------------------------------------------

	/**
	 * A record for a construct this analysis does not model.
	 * @param node The node index it came from.
	 * @returns The type ID.
	 */
	#deferred(node: number): number {
		return this.#builder.addType(
			TYF_UNKNOWN,
			TYS_DEFERRED,
			0,
			0,
			0,
			0,
			0,
			this.#handle(node),
		);
	}

	/**
	 * An `Array<element>` reference.
	 * @param element The element type ID.
	 * @param node The node index it came from.
	 * @returns The type ID.
	 */
	#arrayType(element: number, node: number): number {
		return this.#builder.addType(
			TYF_OBJECT,
			TYS_REFERENCE | TYS_ARRAY,
			this.#libSymbol("Array") + 1,
			this.#builder.poolList([element]),
			0,
			0,
			0,
			this.#handle(node),
		);
	}

	/**
	 * A `Promise<value>` reference.
	 * @param value The resolved value's type ID.
	 * @param node The node index it came from.
	 * @returns The type ID.
	 */
	#promiseType(value: number, node: number): number {
		return this.#builder.addType(
			TYF_OBJECT,
			TYS_REFERENCE,
			this.#libSymbol("Promise") + 1,
			this.#builder.poolList([value]),
			0,
			0,
			0,
			this.#handle(node),
		);
	}

	/**
	 * A union of already-built types: flattened one level, deduplicated,
	 * collapsed when fewer than two constituents remain. The union record's
	 * flags carry the OR of its constituents' flags, so classification stays
	 * a single word read.
	 * @param ids The constituent type IDs, in source order.
	 * @param node The node index the union came from, or `0`.
	 * @returns The type ID.
	 */
	#union(ids: number[], node: number): number {
		const builder = this.#builder;
		const flat: number[] = [];

		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];

			if ((builder.typeField(id, TY_FLAGS) & TYF_UNION) !== 0) {
				const pool = builder.typeField(id, TY_DATA0);
				const count = builder.poolCount(pool);

				for (let j = 0; j < count; j++) {
					flat.push(builder.poolItem(pool, j));
				}
			} else {
				flat.push(id);
			}
		}

		const unique: number[] = [];

		for (let i = 0; i < flat.length; i++) {
			if (unique.indexOf(flat[i]) === -1) {
				unique.push(flat[i]);
			}
		}

		if (unique.length === 0) {
			return TYPE_NEVER;
		}

		if (unique.length === 1) {
			return unique[0];
		}

		let flags = TYF_UNION;

		for (let i = 0; i < unique.length; i++) {
			flags |= builder.typeField(unique[i], TY_FLAGS);
		}

		return builder.addType(
			flags,
			0,
			0,
			builder.poolList(unique),
			0,
			0,
			0,
			node === 0 ? 0 : this.#handle(node),
		);
	}

	/**
	 * A literal type widened to its base, for a mutable binding.
	 * @param type The type ID.
	 * @returns The widened type ID.
	 */
	#widen(type: number): number {
		const flags = this.#builder.typeField(type, TY_FLAGS);

		/*
		 * A union first: its flags word carries the OR of its constituents,
		 * so testing the literal bits before decomposing would widen a mixed
		 * `1 | "x"` to whichever base happened to be checked first.
		 */
		if ((flags & TYF_UNION) !== 0) {
			const pool = this.#builder.typeField(type, TY_DATA0);
			const count = this.#builder.poolCount(pool);
			const widened: number[] = [];

			for (let i = 0; i < count; i++) {
				widened.push(this.#widen(this.#builder.poolItem(pool, i)));
			}

			return this.#union(widened, 0);
		}

		if ((flags & TYF_ENUM_LITERAL) !== 0) {
			return this.#builder.typeField(type, TY_DATA1);
		}

		if ((flags & (TYF_STRING_LITERAL | TYF_TEMPLATE_LITERAL)) !== 0) {
			return TYPE_STRING;
		}

		if ((flags & TYF_NUMBER_LITERAL) !== 0) {
			return TYPE_NUMBER;
		}

		if (type === TYPE_TRUE || type === TYPE_FALSE) {
			return TYPE_BOOLEAN;
		}

		if ((flags & TYF_BIGINT_LITERAL) !== 0) {
			return TYPE_BIGINT;
		}

		return type;
	}

	/**
	 * Whether a type is a `Promise` or `PromiseLike` reference from the
	 * standard library — the provenance-checked reading of "is a promise".
	 * @param type The type ID.
	 * @returns `true` for a library promise reference.
	 */
	#isPromiseReference(type: number): boolean {
		const builder = this.#builder;

		if ((builder.typeField(type, TY_SHAPE) & TYS_REFERENCE) === 0) {
			return false;
		}

		// Every reference this walk writes carries a symbol.
		const symbol = builder.typeField(type, TY_SYMBOL);

		if (builder.symbolField(symbol - 1, SY_ORIGIN) !== TYO_LIB) {
			return false;
		}

		const name = builder.symbolField(symbol - 1, SY_NAME);

		return (
			name === builder.stringId("Promise") ||
			name === builder.stringId("PromiseLike")
		);
	}

	/**
	 * The type `await` produces from an operand's type.
	 * @param type The operand's type ID.
	 * @param node The `AwaitExpression` node index.
	 * @returns The awaited type ID.
	 */
	#awaited(type: number, node: number): number {
		if (type === TYPE_NONE) {
			return TYPE_NONE;
		}

		const builder = this.#builder;
		const flags = builder.typeField(type, TY_FLAGS);

		if ((flags & (TYF_ANY | TYF_UNKNOWN)) !== 0) {
			return type;
		}

		if ((flags & TYF_UNION) !== 0) {
			const pool = builder.typeField(type, TY_DATA0);
			const count = builder.poolCount(pool);
			const parts: number[] = [];

			for (let i = 0; i < count; i++) {
				parts.push(this.#awaited(builder.poolItem(pool, i), node));
			}

			return this.#union(parts, node);
		}

		if (this.#isPromiseReference(type)) {
			const pool = builder.typeField(type, TY_DATA0);

			return builder.poolCount(pool) > 0
				? builder.poolItem(pool, 0)
				: TYPE_UNKNOWN;
		}

		return type;
	}

	/**
	 * A type with `null` and `undefined` removed, as `!` asserts.
	 * @param type The type ID.
	 * @returns The non-nullable type ID.
	 */
	#nonNullable(type: number): number {
		if (type === TYPE_NONE) {
			return TYPE_NONE;
		}

		const builder = this.#builder;
		const flags = builder.typeField(type, TY_FLAGS);

		if ((flags & TYF_UNION) !== 0) {
			const pool = builder.typeField(type, TY_DATA0);
			const count = builder.poolCount(pool);
			const kept: number[] = [];

			for (let i = 0; i < count; i++) {
				const part = builder.poolItem(pool, i);
				const partFlags = builder.typeField(part, TY_FLAGS);

				if (partFlags !== 0 && (partFlags & ~TYF_NULLISH) === 0) {
					continue;
				}

				kept.push(part);
			}

			return this.#union(kept, 0);
		}

		if (flags !== 0 && (flags & ~TYF_NULLISH) === 0) {
			return TYPE_NEVER;
		}

		return type;
	}

	/**
	 * The type of a member on a type, following references to their declared
	 * targets and `extends` heritage, to a fixed depth.
	 * @param type The object's type ID.
	 * @param name The member's name.
	 * @param depth How many hops remain.
	 * @returns The member's type ID, `TYPE_NONE` when unknown.
	 */
	#memberType(type: number, name: string, depth: number): number {
		if (type === TYPE_NONE || depth === 0) {
			return TYPE_NONE;
		}

		const builder = this.#builder;
		const shape = builder.typeField(type, TY_SHAPE);

		// A reference is asked through the symbol it names.
		if ((shape & TYS_REFERENCE) !== 0) {
			if ((shape & TYS_ARRAY) !== 0 && name === "length") {
				return TYPE_NUMBER;
			}

			// Every reference this walk writes carries a symbol.
			const symbol = builder.typeField(type, TY_SYMBOL);
			const target = builder.symbolField(symbol - 1, SY_TARGET);

			if (target === 0) {
				return TYPE_NONE;
			}

			return this.#memberType(
				builder.declaredType(target - 1),
				name,
				depth - 1,
			);
		}

		if ((shape & TYS_TUPLE) !== 0 && name === "length") {
			return TYPE_NUMBER;
		}

		const nameId = builder.stringId(name);

		if (nameId !== -1) {
			const first = builder.typeField(type, TY_MEMBER_FIRST);
			const count = builder.typeField(type, TY_MEMBER_COUNT);

			for (let i = 0; i < count; i++) {
				if (
					builder.memberField(first + i, TM_NAME) === nameId &&
					(builder.memberField(first + i, TM_FLAGS) &
						(TMF_INDEX_STRING | TMF_INDEX_NUMBER)) ===
						0
				) {
					const found = builder.memberField(first + i, TM_TYPE);

					/*
					 * An optional member may simply be absent, so reading
					 * it produces `undefined` as readily as its type —
					 * which is the checker's answer for `a.b` too.
					 */
					return found !== TYPE_NONE &&
						(builder.memberField(first + i, TM_FLAGS) &
							TMF_OPTIONAL) !==
							0
						? this.#union([found, TYPE_UNDEFINED], 0)
						: found;
				}
			}
		}

		// Heritage: `extends` bases of classes and interfaces.
		if ((shape & (TYS_CLASS | TYS_INTERFACE)) !== 0) {
			const pool = builder.typeField(type, TY_DATA0);
			const count = builder.poolCount(pool);

			for (let i = 0; i < count; i++) {
				const found = this.#memberType(
					builder.poolItem(pool, i),
					name,
					depth - 1,
				);

				if (found !== TYPE_NONE) {
					return found;
				}
			}
		}

		return TYPE_NONE;
	}

	//-------------------------------------------------------------------------
	// Annotation conversion
	//-------------------------------------------------------------------------

	/**
	 * The type a `TSTypeAnnotation` wrapper denotes.
	 * @param annotation The wrapper's node index, or `0` for none.
	 * @returns The type ID, `TYPE_NONE` for an absent annotation.
	 */
	#annotated(annotation: number): number {
		if (annotation === 0) {
			return TYPE_NONE;
		}

		return this.#convert(this.#reader.field(annotation, NODE_A));
	}

	/**
	 * Converts a written type to a type record, memoized per node.
	 * @param node The type node's index.
	 * @returns The type ID, never `TYPE_NONE`.
	 */
	#convert(node: number): number {
		let type = this.#nodeTypeMemo.get(node);

		if (type !== undefined) {
			return type;
		}

		type = this.#convertUncached(node);
		this.#nodeTypeMemo.set(node, type);
		this.#record(node, type);

		return type;
	}

	/**
	 * The conversion behind `#convert()`.
	 * @param node The type node's index.
	 * @returns The type ID.
	 */
	#convertUncached(node: number): number {
		const reader = this.#reader;

		switch (reader.kind(node)) {
			case N_TSAnyKeyword:
				return TYPE_ANY;
			case N_TSUnknownKeyword:
				return TYPE_UNKNOWN;
			case N_TSNeverKeyword:
				return TYPE_NEVER;
			case N_TSVoidKeyword:
				return TYPE_VOID;
			case N_TSUndefinedKeyword:
				return TYPE_UNDEFINED;
			case N_TSNullKeyword:
				return TYPE_NULL;
			case N_TSStringKeyword:
				return TYPE_STRING;
			case N_TSNumberKeyword:
				return TYPE_NUMBER;
			case N_TSBigIntKeyword:
				return TYPE_BIGINT;
			case N_TSBooleanKeyword:
				return TYPE_BOOLEAN;
			case N_TSSymbolKeyword:
				return TYPE_SYMBOL;
			case N_TSObjectKeyword:
				return TYPE_OBJECT;

			case N_TSLiteralType:
				return this.#literalType(reader.field(node, NODE_A));

			case N_TSTemplateLiteralType:
				return this.#builder.internType(
					TYF_TEMPLATE_LITERAL,
					0,
					0,
					0,
					0,
				);

			case N_TSUnionType: {
				const list = reader.field(node, NODE_A);
				const size = reader.listSize(list);
				const parts: number[] = [];

				for (let i = 0; i < size; i++) {
					parts.push(this.#convert(reader.listItem(list, i)));
				}

				return this.#union(parts, node);
			}

			case N_TSIntersectionType: {
				const list = reader.field(node, NODE_A);
				const size = reader.listSize(list);
				const parts: number[] = [];
				let flags = TYF_INTERSECTION;

				for (let i = 0; i < size; i++) {
					const part = this.#convert(reader.listItem(list, i));

					parts.push(part);
					flags |= this.#builder.typeField(part, TY_FLAGS);
				}

				return this.#builder.addType(
					flags,
					0,
					0,
					this.#builder.poolList(parts),
					0,
					0,
					0,
					this.#handle(node),
				);
			}

			case N_TSArrayType:
				return this.#arrayType(
					this.#convert(reader.field(node, NODE_A)),
					node,
				);

			case N_TSTupleType: {
				const list = reader.field(node, NODE_A);
				const size = reader.listSize(list);

				/*
				 * `[...string[]]` is not a fixed-length tuple — it admits
				 * any length — and the checker normalizes it to the array
				 * type it spreads. So does this.
				 */
				if (
					size === 1 &&
					reader.kind(reader.listItem(list, 0)) === N_TSRestType
				) {
					return this.#convert(
						reader.field(reader.listItem(list, 0), NODE_A),
					);
				}

				const elements: number[] = [];

				for (let i = 0; i < size; i++) {
					elements.push(this.#tupleElement(reader.listItem(list, i)));
				}

				return this.#builder.addType(
					TYF_OBJECT,
					TYS_TUPLE,
					0,
					this.#builder.poolList(elements),
					0,
					0,
					0,
					this.#handle(node),
				);
			}

			case N_TSFunctionType:
				return this.#signatureType(
					reader.field(node, NODE_A),
					reader.field(node, NODE_B),
					reader.field(node, NODE_C),
					false,
					false,
					node,
				);

			case N_TSConstructorType: {
				const instance = this.#annotated(reader.field(node, NODE_B));

				return this.#builder.addType(
					TYF_OBJECT,
					TYS_FUNCTION | TYS_CONSTRUCTOR,
					0,
					this.#parameterPool(reader.field(node, NODE_A)),
					instance,
					0,
					0,
					this.#handle(node),
				);
			}

			case N_TSTypeLiteral: {
				const [first, count, extra] = this.#signatureMembers(
					reader.field(node, NODE_A),
				);

				return this.#builder.addType(
					TYF_OBJECT,
					TYS_ANONYMOUS | extra,
					0,
					0,
					0,
					first,
					count,
					this.#handle(node),
				);
			}

			case N_TSTypeReference:
				return this.#typeReference(node);

			/*
			 * A predicate signature returns a boolean — unless it asserts,
			 * in which case it returns nothing at all.
			 */
			case N_TSTypePredicate:
				return reader.field(node, NODE_C) === 1
					? TYPE_VOID
					: TYPE_BOOLEAN;

			/*
			 * Named, optional, and rest elements exist only inside tuples,
			 * and `#tupleElement()` unwraps them there; everything else
			 * unmodeled defers.
			 */
			default:
				return this.#deferred(node);
		}
	}

	/**
	 * The literal type a `TSLiteralType` wraps.
	 * @param literal The wrapped node's index.
	 * @returns The type ID.
	 */
	#literalType(literal: number): number {
		const reader = this.#reader;
		const kind = reader.kind(literal);

		if (kind === N_Literal) {
			return this.#literalValueType(literal);
		}

		if (kind === N_TemplateLiteral) {
			return this.#builder.internType(TYF_TEMPLATE_LITERAL, 0, 0, 0, 0);
		}

		if (kind === N_UnaryExpression) {
			// `-1` in type position: the literal is the whole written text.
			return this.#builder.internType(
				TYF_NUMBER_LITERAL,
				0,
				0,
				this.#builder.intern(reader.text(literal)),
				0,
			);
		}

		return this.#deferred(literal);
	}

	/**
	 * The literal type of a `Literal` node.
	 * @param literal The node index.
	 * @returns The type ID.
	 */
	#literalValueType(literal: number): number {
		const reader = this.#reader;
		const builder = this.#builder;
		const subtype = reader.field(literal, NODE_A);

		switch (subtype) {
			case LIT_STRING:
				return builder.internType(
					TYF_STRING_LITERAL,
					0,
					0,
					builder.intern(this.#ast.literalString(literal)),
					0,
				);

			case LIT_NUMBER:
				return builder.internType(
					TYF_NUMBER_LITERAL,
					0,
					0,
					builder.intern(reader.text(literal)),
					0,
				);

			case LIT_BOOLEAN:
				// `true` is four characters long; `false` is five.
				return reader.end(literal) - reader.start(literal) === 4
					? TYPE_TRUE
					: TYPE_FALSE;

			case LIT_NULL:
				return TYPE_NULL;

			case LIT_BIGINT:
				return builder.internType(
					TYF_BIGINT_LITERAL,
					0,
					0,
					builder.intern(reader.text(literal)),
					0,
				);

			case LIT_REGEXP:
				return builder.internType(
					TYF_OBJECT,
					TYS_REFERENCE,
					this.#libSymbol("RegExp") + 1,
					0,
					0,
				);

			default:
				return TYPE_STRING;
		}
	}

	/**
	 * One tuple element's type, unwrapping labels, optionality, and rest.
	 * @param element The element node's index.
	 * @returns The type ID.
	 */
	#tupleElement(element: number): number {
		const kind = this.#reader.kind(element);

		if (kind === N_TSNamedTupleMember) {
			return this.#convert(this.#reader.field(element, NODE_B));
		}

		if (kind === N_TSOptionalType || kind === N_TSRestType) {
			return this.#convert(this.#reader.field(element, NODE_A));
		}

		return this.#convert(element);
	}

	/**
	 * The type a `TSTypeReference` names.
	 * @param node The reference node's index.
	 * @returns The type ID.
	 */
	#typeReference(node: number): number {
		const reader = this.#reader;
		const builder = this.#builder;
		const typeName = reader.field(node, NODE_A);
		const argsNode = reader.field(node, NODE_B);
		const args: number[] = [];

		if (
			argsNode !== 0 &&
			reader.kind(argsNode) === N_TSTypeParameterInstantiation
		) {
			const list = reader.field(argsNode, NODE_A);
			const size = reader.listSize(list);

			for (let i = 0; i < size; i++) {
				args.push(this.#convert(reader.listItem(list, i)));
			}
		}

		let symbol: number;
		let shape = TYS_REFERENCE;

		if (reader.kind(typeName) === N_TSQualifiedName) {
			/*
			 * `A.B.C` names a member of a namespace this analysis does not
			 * model, so the reference keeps the written text and where its
			 * root came from, and claims nothing structural.
			 */
			let root = typeName;

			while (reader.kind(root) === N_TSQualifiedName) {
				root = reader.field(root, NODE_A);
			}

			const rootSymbol = this.#resolvedSymbol(root, RF_TYPE);
			const name = builder.intern(reader.text(typeName));

			if (rootSymbol !== -1) {
				const rootId = this.#symbolFor(rootSymbol);

				symbol = builder.internSymbol(
					name,
					builder.symbolField(rootId, SY_ORIGIN),
					builder.symbolField(rootId, SY_SPECIFIER),
					this.#handle(typeName),
					0,
				);
			} else {
				symbol = builder.internSymbol(name, TYO_GLOBAL, 0, 0, 0);
			}

			shape |= TYS_DEFERRED;
		} else {
			const name = this.#ast.name(typeName);
			const resolved = this.#resolvedSymbol(typeName, RF_TYPE);

			if (resolved !== -1) {
				symbol = this.#symbolFor(resolved);

				/*
				 * A type parameter's reference is the parameter itself, not a
				 * reference record: the declared type already is the answer.
				 */
				const declared = builder.declaredType(resolved);

				if (
					declared !== TYPE_NONE &&
					(builder.typeField(declared, TY_FLAGS) &
						TYF_TYPE_PARAMETER) !==
						0
				) {
					return declared;
				}
			} else if (isWellKnownLibType(name)) {
				symbol = this.#libSymbol(name);

				if (name === "Array" || name === "ReadonlyArray") {
					shape |= TYS_ARRAY;
				}
			} else {
				symbol = builder.internSymbol(
					builder.intern(name),
					TYO_GLOBAL,
					0,
					0,
					0,
				);
				shape |= TYS_UNRESOLVED;
			}
		}

		if (args.length === 0) {
			return builder.internType(TYF_OBJECT, shape, symbol + 1, 0, 0);
		}

		return builder.addType(
			TYF_OBJECT,
			shape,
			symbol + 1,
			builder.poolList(args),
			0,
			0,
			0,
			this.#handle(node),
		);
	}

	//-------------------------------------------------------------------------
	// Signatures and members
	//-------------------------------------------------------------------------

	/**
	 * Declares a list of type parameters, binding each name to its parameter
	 * type.
	 * @param declaration The `TSTypeParameterDeclaration` node, or `0`.
	 * @returns Nothing.
	 */
	#declareTypeParameters(declaration: number): void {
		if (declaration === 0) {
			return;
		}

		const reader = this.#reader;
		const list = reader.field(declaration, NODE_A);
		const size = reader.listSize(list);

		for (let i = 0; i < size; i++) {
			const parameter = reader.listItem(list, i);

			if (reader.kind(parameter) !== N_TSTypeParameter) {
				continue;
			}

			const name = reader.field(parameter, NODE_A);
			const constraintNode = reader.field(parameter, NODE_B);
			const defaultNode = reader.field(parameter, NODE_C);
			const constraint =
				constraintNode === 0
					? TYPE_NONE
					: this.#convert(constraintNode);
			const fallback =
				defaultNode === 0 ? TYPE_NONE : this.#convert(defaultNode);
			const symbol = this.#declaredSymbol(name);
			const type = this.#builder.addType(
				TYF_TYPE_PARAMETER,
				0,
				symbol === -1 ? 0 : this.#symbolFor(symbol) + 1,
				constraint,
				fallback,
				0,
				0,
				this.#handle(parameter),
			);

			if (symbol !== -1) {
				this.#builder.setDeclaredType(symbol, type);
			}

			this.#record(parameter, type);
		}
	}

	/**
	 * The pool of a parameter list's types, binding annotated parameter names
	 * along the way.
	 * @param params The parameter list handle.
	 * @returns The pool handle.
	 */
	#parameterPool(params: number): number {
		const reader = this.#reader;
		const size = reader.listSize(params);
		const types: number[] = [];

		for (let i = 0; i < size; i++) {
			types.push(this.#parameterType(reader.listItem(params, i)));
		}

		return this.#builder.poolList(types);
	}

	/**
	 * An annotated parameter's type with its optionality applied: `x?: T`
	 * admits `undefined` — the argument may simply be absent — so the
	 * recorded type is `T | undefined`, which is also the checker's answer.
	 * @param parameter The parameter node's index.
	 * @param type The annotation's type ID, `TYPE_NONE` when absent.
	 * @returns The type ID, widened to admit `undefined` when optional.
	 */
	#optionalParameter(parameter: number, type: number): number {
		if (
			type === TYPE_NONE ||
			(this.#reader.flags(parameter) & NF_OPTIONAL) === 0
		) {
			return type;
		}

		return this.#union([type, TYPE_UNDEFINED], parameter);
	}

	/**
	 * One parameter's written type, binding its name when it has one.
	 * @param parameter The parameter node's index.
	 * @returns The type ID, `TYPE_NONE` for an unannotated parameter.
	 */
	#parameterType(parameter: number): number {
		const reader = this.#reader;

		switch (reader.kind(parameter)) {
			case N_Identifier: {
				const type = this.#optionalParameter(
					parameter,
					this.#annotated(reader.field(parameter, NODE_B)),
				);

				if (type !== TYPE_NONE) {
					const symbol = this.#declaredSymbol(parameter);

					if (symbol !== -1) {
						this.#builder.setSymbolType(symbol, type);
					}

					this.#record(parameter, type);
				}

				return type;
			}

			case N_AssignmentPattern:
				return this.#parameterType(reader.field(parameter, NODE_A));

			case N_TSParameterProperty:
				return this.#parameterType(reader.field(parameter, NODE_A));

			case N_ObjectPattern:
			case N_ArrayPattern:
				return this.#optionalParameter(
					parameter,
					this.#annotated(reader.field(parameter, NODE_B)),
				);

			case N_RestElement: {
				const type = this.#annotated(reader.field(parameter, NODE_B));
				const argument = reader.field(parameter, NODE_A);

				if (
					type !== TYPE_NONE &&
					reader.kind(argument) === N_Identifier
				) {
					const symbol = this.#declaredSymbol(argument);

					if (symbol !== -1) {
						this.#builder.setSymbolType(symbol, type);
					}

					this.#record(argument, type);
				}

				return type;
			}

			default:
				return TYPE_NONE;
		}
	}

	/**
	 * A function or method type from its written signature.
	 * @param params The parameter list handle.
	 * @param returnAnnotation The return `TSTypeAnnotation` node, or `0`.
	 * @param typeParameters The `TSTypeParameterDeclaration` node, or `0`.
	 * @param isAsync Whether the function is `async`.
	 * @param isGenerator Whether the function is a generator.
	 * @param node The node the signature belongs to.
	 * @returns The type ID.
	 */
	#signatureType(
		params: number,
		returnAnnotation: number,
		typeParameters: number,
		isAsync: boolean,
		isGenerator: boolean,
		node: number,
	): number {
		this.#declareTypeParameters(typeParameters);

		const pool = this.#parameterPool(params);
		let returns = this.#annotated(returnAnnotation);

		/*
		 * An unannotated `async` function still returns a `Promise`; an
		 * async generator returns an `AsyncGenerator`, which this analysis
		 * leaves unclaimed.
		 */
		if (isAsync && !isGenerator && returns === TYPE_NONE) {
			returns = this.#promiseType(TYPE_UNKNOWN, node);
		}

		return this.#builder.addType(
			TYF_OBJECT,
			TYS_FUNCTION,
			0,
			pool,
			returns,
			0,
			0,
			this.#handle(node),
		);
	}

	/**
	 * The member run of an interface body or type literal.
	 * @param list The member list handle.
	 * @returns The run's first member ID, its count, and the extra `TYS_*`
	 *      shape bits the list earned — `TYS_INEXACT`, `TYS_CALLABLE`, or
	 *      both.
	 */
	#signatureMembers(list: number): [number, number, number] {
		const reader = this.#reader;
		const size = reader.listSize(list);
		const entries: MemberEntry[] = [];
		let shape = 0;

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(list, i);
			const kind = reader.kind(member);
			const flags = reader.flags(member);

			if (kind === N_TSPropertySignature) {
				if ((flags & NF_COMPUTED) !== 0) {
					shape |= TYS_INEXACT;
					continue;
				}

				entries.push({
					name: this.#memberName(reader.field(member, NODE_A)),
					type: this.#annotated(reader.field(member, NODE_B)),
					flags:
						((flags & NF_OPTIONAL) !== 0 ? TMF_OPTIONAL : 0) |
						((flags & NF_READONLY) !== 0 ? TMF_READONLY : 0),
				});
				continue;
			}

			if (kind === N_TSMethodSignature) {
				if ((flags & NF_COMPUTED) !== 0) {
					shape |= TYS_INEXACT;
					continue;
				}

				const methodKind = (flags & MKIND_MASK) >>> MKIND_SHIFT;
				const signature = this.#signatureType(
					reader.field(member, NODE_B),
					reader.field(member, NODE_C),
					reader.field(member, NODE_D),
					false,
					false,
					member,
				);

				entries.push(
					this.#accessorEntry(
						this.#memberName(reader.field(member, NODE_A)),
						signature,
						methodKind,
						(flags & NF_OPTIONAL) !== 0 ? TMF_OPTIONAL : 0,
					),
				);
				continue;
			}

			if (kind === N_TSIndexSignature) {
				entries.push({
					name: 0,
					type: this.#annotated(reader.field(member, NODE_B)),
					flags: this.#indexKindOf(reader.field(member, NODE_A)),
				});
				continue;
			}

			/*
			 * A call or construct signature is not recorded as a member,
			 * which makes the type inexact — and callable, which is what
			 * decides `typeof`: a value of the type answers `"function"`.
			 */
			if (
				kind === N_TSCallSignatureDeclaration ||
				kind === N_TSConstructSignatureDeclaration
			) {
				shape |= TYS_CALLABLE | TYS_INEXACT;
			}
		}

		const [first, count] = this.#writeMembers(entries);

		return [first, count, shape];
	}

	/**
	 * The index-signature flag for a parameter list's key type.
	 * @param parameters The index parameter list handle.
	 * @returns `TMF_INDEX_NUMBER` or `TMF_INDEX_STRING`.
	 */
	#indexKindOf(parameters: number): number {
		const reader = this.#reader;

		if (reader.listSize(parameters) > 0) {
			const parameter = reader.listItem(parameters, 0);

			if (reader.kind(parameter) === N_Identifier) {
				const annotation = reader.field(parameter, NODE_B);

				if (
					annotation !== 0 &&
					reader.kind(reader.field(annotation, NODE_A)) ===
						N_TSNumberKeyword
				) {
					return TMF_INDEX_NUMBER;
				}
			}
		}

		return TMF_INDEX_STRING;
	}

	/**
	 * A member entry for a method, getter, or setter.
	 * @param name The member name's string ID.
	 * @param signature The signature's type ID.
	 * @param methodKind The `MKIND_*` value.
	 * @param extraFlags Flags to carry through.
	 * @returns The entry.
	 */
	#accessorEntry(
		name: number,
		signature: number,
		methodKind: number,
		extraFlags: number,
	): MemberEntry {
		const builder = this.#builder;

		if (methodKind === MKIND_GET) {
			return {
				name,
				type: builder.typeField(signature, TY_DATA1),
				flags: TMF_GETTER | extraFlags,
			};
		}

		if (methodKind === MKIND_SET) {
			const pool = builder.typeField(signature, TY_DATA0);

			return {
				name,
				type:
					builder.poolCount(pool) > 0
						? builder.poolItem(pool, 0)
						: TYPE_NONE,
				flags: TMF_SETTER | extraFlags,
			};
		}

		return { name, type: signature, flags: TMF_METHOD | extraFlags };
	}

	/**
	 * The string ID of a member key.
	 * @param key The key node's index.
	 * @returns The string ID.
	 */
	#memberName(key: number): number {
		const reader = this.#reader;

		if (reader.kind(key) === N_Literal) {
			const subtype = reader.field(key, NODE_A);

			return this.#builder.intern(
				subtype === LIT_STRING
					? this.#ast.literalString(key)
					: reader.text(key),
			);
		}

		return this.#builder.intern(this.#ast.name(key));
	}

	/**
	 * Writes a collected member run contiguously.
	 * @param entries The entries, in source order.
	 * @returns The run's first member ID and its count.
	 */
	#writeMembers(entries: MemberEntry[]): [number, number] {
		const first = this.#builder.memberCount;

		for (let i = 0; i < entries.length; i++) {
			this.#builder.addMember(
				entries[i].name,
				entries[i].type,
				entries[i].flags,
			);
		}

		return [first, entries.length];
	}

	//-------------------------------------------------------------------------
	// Declarations
	//-------------------------------------------------------------------------

	/**
	 * The declaration pass: reads every signature and declared type, binding
	 * symbols along the way.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#declare(node: number): void {
		const reader = this.#reader;

		switch (reader.kind(node)) {
			case N_FunctionDeclaration:
			case N_TSDeclareFunction: {
				const type = this.#functionType(node);
				const id = reader.field(node, NODE_A);

				if (id !== 0) {
					const symbol = this.#declaredSymbol(id);

					if (symbol !== -1) {
						this.#builder.setSymbolType(symbol, type);
					}

					this.#record(id, type);
				}

				this.#record(node, type);
				break;
			}

			case N_FunctionExpression:
			case N_ArrowFunctionExpression:
			case N_TSEmptyBodyFunctionExpression:
				this.#record(node, this.#functionType(node));
				break;

			case N_ClassDeclaration:
			case N_ClassExpression:
				this.#classType(node);
				break;

			case N_TSInterfaceDeclaration:
				this.#interfaceType(node);
				return;

			case N_TSTypeAliasDeclaration: {
				this.#declareTypeParameters(reader.field(node, NODE_C));

				const type = this.#convert(reader.field(node, NODE_B));
				const symbol = this.#declaredSymbol(reader.field(node, NODE_A));

				if (symbol !== -1) {
					this.#builder.setDeclaredType(symbol, type);
				}

				this.#record(reader.field(node, NODE_A), type);
				return;
			}

			case N_TSEnumDeclaration:
				this.#enumType(node);
				return;

			case N_TSModuleDeclaration: {
				const id = reader.field(node, NODE_A);
				const symbol =
					reader.kind(id) === N_Identifier
						? this.#declaredSymbol(id)
						: -1;
				const type = this.#builder.addType(
					TYF_OBJECT,
					TYS_NAMESPACE,
					symbol === -1 ? 0 : this.#symbolFor(symbol) + 1,
					0,
					0,
					0,
					0,
					this.#handle(node),
				);

				/*
				 * A namespace can merge with a function, class, enum, or
				 * variable of the same name, and the merged value is that
				 * declaration's: `typeof getBindingIdentifiers` stays a
				 * function after `declare namespace getBindingIdentifiers`
				 * adds to it, wherever the two sit in the file. When such
				 * a declaration shares the symbol, the namespace types
				 * neither the symbol nor its own node beyond what the
				 * merge partner already recorded. The symbol's *declared
				 * type* is never the namespace object either way: a bare
				 * namespace name is not a type, and the interface, alias,
				 * or enum it merges with is what a type reference means.
				 */
				const merged = symbol !== -1 && this.#mergesWithValue(symbol);

				if (symbol !== -1 && !merged) {
					this.#builder.setSymbolType(symbol, type);
				}

				this.#record(
					node,
					merged ? this.#builder.symbolType(symbol) : type,
				);
				break;
			}

			case N_VariableDeclarator: {
				const id = reader.field(node, NODE_A);

				if (reader.kind(id) === N_Identifier) {
					const type = this.#annotated(reader.field(id, NODE_B));

					if (type !== TYPE_NONE) {
						const symbol = this.#declaredSymbol(id);

						if (symbol !== -1) {
							this.#builder.setSymbolType(symbol, type);
						}

						this.#record(id, type);
					}
				} else {
					// A destructuring pattern can still carry an annotation.
					const type = this.#annotated(reader.field(id, NODE_B));

					this.#record(id, type);
				}

				break;
			}

			case N_ImportDeclaration:
				this.#declareImports(node);
				return;

			case N_CatchClause: {
				const parameter = reader.field(node, NODE_A);

				if (
					parameter !== 0 &&
					reader.kind(parameter) === N_Identifier
				) {
					this.#parameterType(parameter);
				}

				break;
			}

			default:
				break;
		}

		this.#eachChild(node, child => this.#declare(child));
	}

	/**
	 * A function-like node's type, memoized so both passes agree.
	 * @param node The function node's index.
	 * @returns The type ID.
	 */
	#functionType(node: number): number {
		let type = this.#nodeTypeMemo.get(node);

		if (type !== undefined) {
			return type;
		}

		const reader = this.#reader;
		const flags = reader.flags(node);

		type = this.#signatureType(
			reader.field(node, NODE_B),
			reader.field(node, NODE_E),
			reader.field(node, NODE_D),
			(flags & NF_ASYNC) !== 0,
			(flags & NF_GENERATOR) !== 0,
			node,
		);
		this.#nodeTypeMemo.set(node, type);

		return type;
	}

	/**
	 * Declares a class: its constructor type, its instance type, and its
	 * instance members. Static members and parameter properties are not
	 * modeled; a constructor with parameter properties marks the instance
	 * inexact.
	 * @param node The class node's index.
	 * @returns The constructor type's ID.
	 */
	#classType(node: number): number {
		let memo = this.#nodeTypeMemo.get(node);

		if (memo !== undefined) {
			return memo;
		}

		const reader = this.#reader;
		const builder = this.#builder;
		const id = reader.field(node, NODE_A);
		const scopeSymbol = id === 0 ? -1 : this.#declaredSymbol(id);
		const symbol =
			scopeSymbol === -1
				? builder.internSymbol(
						builder.intern(id === 0 ? "" : this.#ast.name(id)),
						TYO_LOCAL,
						0,
						this.#handle(node),
						0,
					)
				: this.#symbolFor(scopeSymbol);

		this.#declareTypeParameters(reader.field(node, NODE_D));

		// The `extends` base, when it names a class this file declares.
		const superClass = reader.field(node, NODE_B);
		let heritage = 0;

		if (superClass !== 0 && reader.kind(superClass) === N_Identifier) {
			const baseSymbol = this.#resolvedSymbol(superClass, RF_VALUE);

			if (baseSymbol !== -1) {
				const base = builder.declaredType(baseSymbol);

				if (base !== TYPE_NONE) {
					heritage = builder.poolList([base]);
				}
			}
		}

		const instance = builder.addType(
			TYF_OBJECT,
			TYS_CLASS,
			symbol + 1,
			heritage,
			0,
			0,
			0,
			this.#handle(node),
		);
		const [first, count, inexact] = this.#classMembers(
			reader.field(node, NODE_C),
		);

		builder.patchType(instance, TY_MEMBER_FIRST, first);
		builder.patchType(instance, TY_MEMBER_COUNT, count);

		if (inexact) {
			builder.patchType(instance, TY_SHAPE, TYS_CLASS | TYS_INEXACT);
		}

		const constructor = builder.addType(
			TYF_OBJECT,
			TYS_FUNCTION | TYS_CONSTRUCTOR,
			symbol + 1,
			0,
			instance,
			0,
			0,
			this.#handle(node),
		);

		if (scopeSymbol !== -1) {
			builder.setSymbolType(scopeSymbol, constructor);
			builder.setDeclaredType(scopeSymbol, instance);
		}

		this.#nodeTypeMemo.set(node, constructor);
		this.#record(node, constructor);

		return constructor;
	}

	/**
	 * The instance member run of a class body.
	 * @param body The `ClassBody` node's index.
	 * @returns The run's first member ID, its count, and inexactness.
	 */
	#classMembers(body: number): [number, number, boolean] {
		const reader = this.#reader;
		const list = reader.field(body, NODE_A);
		const size = reader.listSize(list);
		const entries: MemberEntry[] = [];
		let inexact = false;

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(list, i);
			const kind = reader.kind(member);
			const flags = reader.flags(member);

			if ((flags & NF_STATIC) !== 0) {
				continue;
			}

			if (
				kind === N_MethodDefinition ||
				kind === N_TSAbstractMethodDefinition
			) {
				const methodKind = (flags & MKIND_MASK) >>> MKIND_SHIFT;
				const value = reader.field(member, NODE_B);

				if (methodKind === MKIND_CONSTRUCTOR) {
					if (this.#hasParameterProperties(value)) {
						inexact = true;
					}

					// The signature still binds its annotated parameters.
					this.#functionType(value);
					continue;
				}

				if ((flags & NF_COMPUTED) !== 0) {
					this.#functionType(value);
					inexact = true;
					continue;
				}

				entries.push(
					this.#accessorEntry(
						this.#memberName(reader.field(member, NODE_A)),
						this.#functionType(value),
						methodKind,
						0,
					),
				);
				continue;
			}

			if (
				kind === N_PropertyDefinition ||
				kind === N_TSAbstractPropertyDefinition ||
				kind === N_AccessorProperty ||
				kind === N_TSAbstractAccessorProperty
			) {
				if ((flags & NF_COMPUTED) !== 0) {
					inexact = true;
					continue;
				}

				entries.push({
					name: this.#memberName(reader.field(member, NODE_A)),
					type: this.#annotated(reader.field(member, NODE_D)),
					flags:
						((flags & NF_OPTIONAL) !== 0 ? TMF_OPTIONAL : 0) |
						((flags & NF_READONLY) !== 0 ? TMF_READONLY : 0),
				});
			}
		}

		const [first, count] = this.#writeMembers(entries);

		return [first, count, inexact];
	}

	/**
	 * Whether a constructor declares parameter properties.
	 * @param value The constructor's function node index.
	 * @returns `true` when any parameter is a `TSParameterProperty`.
	 */
	#hasParameterProperties(value: number): boolean {
		const reader = this.#reader;
		const params = reader.field(value, NODE_B);
		const size = reader.listSize(params);

		for (let i = 0; i < size; i++) {
			if (
				reader.kind(reader.listItem(params, i)) ===
				N_TSParameterProperty
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Declares an interface: its symbol, heritage, and members. When an
	 * interface is declared twice, the first declaration wins.
	 * @param node The `TSInterfaceDeclaration` node's index.
	 * @returns Nothing.
	 */
	#interfaceType(node: number): void {
		const reader = this.#reader;
		const builder = this.#builder;
		const id = reader.field(node, NODE_A);
		const scopeSymbol = this.#declaredSymbol(id);
		const symbol =
			scopeSymbol === -1
				? builder.internSymbol(
						builder.intern(this.#ast.name(id)),
						TYO_LOCAL,
						0,
						this.#handle(id),
						0,
					)
				: this.#symbolFor(scopeSymbol);

		this.#declareTypeParameters(reader.field(node, NODE_C));

		const extendsList = reader.field(node, NODE_D);
		const extendsSize = reader.listSize(extendsList);
		const bases: number[] = [];

		for (let i = 0; i < extendsSize; i++) {
			const heritage = reader.listItem(extendsList, i);

			if (reader.kind(heritage) !== N_TSInterfaceHeritage) {
				continue;
			}

			const expression = reader.field(heritage, NODE_A);

			/*
			 * A base named any other way — `extends React.FC<P>` — is a
			 * structure this analysis does not model, and dropping it
			 * would make the interface look self-contained: members it
			 * inherits would seem absent, and callability it inherits
			 * would seem ruled out. A deferred base keeps the unknown on
			 * the record.
			 */
			bases.push(
				reader.kind(expression) === N_Identifier
					? this.#heritageReference(expression)
					: this.#deferred(expression),
			);
		}

		const heritagePool = builder.poolList(bases);
		const body = reader.field(node, NODE_B);
		const [first, count, extra] = this.#signatureMembers(
			reader.field(body, NODE_A),
		);
		const type = builder.addType(
			TYF_OBJECT,
			TYS_INTERFACE | extra,
			symbol + 1,
			heritagePool,
			0,
			first,
			count,
			this.#handle(node),
		);

		if (scopeSymbol !== -1) {
			builder.setDeclaredType(scopeSymbol, type);
		}

		this.#record(node, type);
		this.#record(id, type);
	}

	/**
	 * A reference type for one `extends` clause name.
	 * @param expression The name's identifier node.
	 * @returns The type ID.
	 */
	#heritageReference(expression: number): number {
		const builder = this.#builder;
		const name = this.#ast.name(expression);
		const resolved = this.#resolvedSymbol(expression, RF_TYPE);
		let symbol: number;
		let shape = TYS_REFERENCE;

		if (resolved !== -1) {
			symbol = this.#symbolFor(resolved);
		} else if (isWellKnownLibType(name)) {
			symbol = this.#libSymbol(name);
		} else {
			symbol = builder.internSymbol(
				builder.intern(name),
				TYO_GLOBAL,
				0,
				0,
				0,
			);
			shape |= TYS_UNRESOLVED;
		}

		return builder.internType(TYF_OBJECT, shape, symbol + 1, 0, 0);
	}

	/**
	 * Declares an enum: one type for the enum, one literal type per member.
	 * @param node The `TSEnumDeclaration` node's index.
	 * @returns Nothing.
	 */
	#enumType(node: number): void {
		const reader = this.#reader;
		const builder = this.#builder;
		const id = reader.field(node, NODE_A);
		const scopeSymbol = this.#declaredSymbol(id);
		const symbol =
			scopeSymbol === -1
				? builder.internSymbol(
						builder.intern(this.#ast.name(id)),
						TYO_LOCAL,
						0,
						this.#handle(id),
						0,
					)
				: this.#symbolFor(scopeSymbol);
		const enumType = builder.addType(
			TYF_OBJECT | TYF_ENUM,
			0,
			symbol + 1,
			0,
			0,
			0,
			0,
			this.#handle(node),
		);
		const body = reader.field(node, NODE_B);
		const list = reader.field(body, NODE_A);
		const size = reader.listSize(list);
		const entries: MemberEntry[] = [];

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(list, i);

			if (reader.kind(member) !== N_TSEnumMember) {
				continue;
			}

			const memberId = reader.field(member, NODE_A);
			const nameId = this.#memberName(memberId);
			const initializer = reader.field(member, NODE_B);
			const isString =
				initializer !== 0 &&
				reader.kind(initializer) === N_Literal &&
				reader.field(initializer, NODE_A) === LIT_STRING;
			const memberType = builder.internType(
				(isString ? TYF_STRING_LITERAL : TYF_NUMBER_LITERAL) |
					TYF_ENUM_LITERAL,
				0,
				symbol + 1,
				nameId,
				enumType,
			);

			entries.push({ name: nameId, type: memberType, flags: 0 });
			this.#record(member, memberType);

			const memberSymbol = this.#declaredSymbol(memberId);

			if (memberSymbol !== -1) {
				builder.setSymbolType(memberSymbol, memberType);
			}
		}

		const [first, count] = this.#writeMembers(entries);

		builder.patchType(enumType, TY_MEMBER_FIRST, first);
		builder.patchType(enumType, TY_MEMBER_COUNT, count);

		/*
		 * The declaration binds two answers, the way a class does. The
		 * *type* `E` is the enum type above — a value of it is a member,
		 * so it classifies by the members' base. The *value* `E` is the
		 * object the declaration creates, whose properties are the members
		 * and whose `typeof` is `"object"`, never `"number"`. Both share
		 * one member run, so `E.A` resolves through either.
		 */
		const enumObject = builder.addType(
			TYF_OBJECT,
			TYS_NAMESPACE,
			symbol + 1,
			0,
			0,
			first,
			count,
			this.#handle(id),
		);

		if (scopeSymbol !== -1) {
			builder.setSymbolType(scopeSymbol, enumObject);
			builder.setDeclaredType(scopeSymbol, enumType);
		}

		this.#record(node, enumObject);
		this.#record(id, enumObject);
	}

	/**
	 * Declares every binding of an import declaration as a foreign type.
	 * @param node The `ImportDeclaration` node's index.
	 * @returns Nothing.
	 */
	#declareImports(node: number): void {
		const reader = this.#reader;
		const builder = this.#builder;
		const specifiers = reader.field(node, NODE_A);
		const size = reader.listSize(specifiers);

		for (let i = 0; i < size; i++) {
			const specifier = reader.listItem(specifiers, i);
			const local =
				reader.kind(specifier) === N_ImportSpecifier
					? reader.field(specifier, NODE_B)
					: reader.field(specifier, NODE_A);
			const symbol = this.#declaredSymbol(local);

			if (symbol === -1) {
				continue;
			}

			const type = builder.internType(
				0,
				TYS_REFERENCE | TYS_FOREIGN,
				this.#symbolFor(symbol) + 1,
				0,
				0,
			);

			builder.setSymbolType(symbol, type);
			builder.setDeclaredType(symbol, type);
			this.#record(local, type);
		}
	}

	//-------------------------------------------------------------------------
	// Expressions
	//-------------------------------------------------------------------------

	/**
	 * The expression pass: types what the rules can say something about and
	 * records every answer.
	 * @param node The node index.
	 * @returns The node's type ID, `TYPE_NONE` when nothing can be said.
	 */
	#express(node: number): number {
		const reader = this.#reader;

		switch (reader.kind(node)) {
			case N_Literal: {
				const type = this.#literalValueType(node);

				this.#record(node, type);

				return type;
			}

			case N_TemplateLiteral: {
				this.#eachChild(node, child => this.#express(child));
				this.#record(node, TYPE_STRING);

				return TYPE_STRING;
			}

			case N_Identifier:
				return this.#expressIdentifier(node);

			case N_ArrayExpression:
				return this.#expressArray(node);

			case N_ObjectExpression:
				return this.#expressObject(node);

			case N_FunctionExpression:
			case N_ArrowFunctionExpression:
			case N_TSEmptyBodyFunctionExpression:
			case N_FunctionDeclaration:
			case N_TSDeclareFunction: {
				const type = this.#functionType(node);

				this.#eachChild(node, child => this.#express(child));
				this.#record(node, type);

				return type;
			}

			case N_ClassDeclaration:
			case N_ClassExpression: {
				const type = this.#classType(node);

				this.#eachChild(node, child => this.#express(child));
				this.#record(node, type);

				return type;
			}

			case N_UnaryExpression:
				return this.#expressUnary(node);

			case N_UpdateExpression: {
				const operand = this.#express(reader.field(node, NODE_A));
				const type = this.#numericResult(operand, TYPE_NONE);

				this.#record(node, type);

				return type;
			}

			case N_BinaryExpression:
				return this.#expressBinary(node);

			case N_LogicalExpression:
			case N_ConditionalExpression: {
				let left: number;
				let right: number;

				if (reader.kind(node) === N_ConditionalExpression) {
					this.#express(reader.field(node, NODE_A));
					left = this.#express(reader.field(node, NODE_B));
					right = this.#express(reader.field(node, NODE_C));
				} else {
					left = this.#express(reader.field(node, NODE_A));
					right = this.#express(reader.field(node, NODE_B));
				}

				if (left === TYPE_NONE || right === TYPE_NONE) {
					return TYPE_NONE;
				}

				const type = this.#union([left, right], node);

				this.#record(node, type);

				return type;
			}

			case N_AssignmentExpression: {
				this.#express(reader.field(node, NODE_A));

				const right = this.#express(reader.field(node, NODE_B));
				const operator = reader.field(node, NODE_C);
				const type =
					operator === T_ASSIGN
						? right
						: this.#compoundResult(node, right);

				this.#record(node, type);

				return type;
			}

			case N_SequenceExpression: {
				const list = reader.field(node, NODE_A);
				const size = reader.listSize(list);
				let last = TYPE_NONE;

				for (let i = 0; i < size; i++) {
					last = this.#express(reader.listItem(list, i));
				}

				this.#record(node, last);

				return last;
			}

			case N_CallExpression:
				return this.#expressCall(node);

			case N_NewExpression:
				return this.#expressNew(node);

			case N_MemberExpression:
				return this.#expressMember(node);

			case N_ChainExpression: {
				const type = this.#express(reader.field(node, NODE_A));

				this.#record(node, type);

				return type;
			}

			case N_AwaitExpression: {
				const operand = this.#express(reader.field(node, NODE_A));
				const type = this.#awaited(operand, node);

				this.#record(node, type);

				return type;
			}

			case N_ImportExpression: {
				this.#eachChild(node, child => this.#express(child));

				const type = this.#promiseType(TYPE_UNKNOWN, node);

				this.#record(node, type);

				return type;
			}

			case N_TSAsExpression:
			case N_TSSatisfiesExpression: {
				const inner = this.#express(reader.field(node, NODE_A));
				const type =
					reader.kind(node) === N_TSAsExpression
						? this.#convert(reader.field(node, NODE_B))
						: inner;

				this.#record(node, type);

				return type;
			}

			case N_TSTypeAssertion: {
				this.#express(reader.field(node, NODE_B));

				const type = this.#convert(reader.field(node, NODE_A));

				this.#record(node, type);

				return type;
			}

			case N_TSNonNullExpression: {
				const inner = this.#express(reader.field(node, NODE_A));
				const type = this.#nonNullable(inner);

				this.#record(node, type);

				return type;
			}

			case N_TSInstantiationExpression: {
				const type = this.#express(reader.field(node, NODE_A));

				this.#record(node, type);

				return type;
			}

			case N_VariableDeclaration:
				this.#expressDeclaration(node);

				return TYPE_NONE;

			case N_TSInterfaceDeclaration:
			case N_TSTypeAliasDeclaration:
			case N_TSEnumDeclaration:
				return TYPE_NONE;

			/*
			 * Type-context subtrees a generic descent would otherwise walk
			 * into: annotations, generic parameter lists, type arguments,
			 * and heritage clauses. Everything inside them is a type, not a
			 * value — `#convert()` records the type nodes where a
			 * declaration asks for them — and an identifier inside them
			 * names a type, so the value rules must not read it as an
			 * expression: `MapSource` in a return annotation is the
			 * instance, not the function that constructs it.
			 */
			case N_TSTypeAnnotation:
			case N_TSTypeParameterDeclaration:
			case N_TSTypeParameterInstantiation:
			case N_TSClassImplements:
			case N_TSInterfaceHeritage:
				return TYPE_NONE;

			/*
			 * A type-only export names types, not values: the `Stack` in
			 * `export type { Stack }` means the declared type — the class
			 * instance — not the constructor the value rules would read.
			 * The same flag on one specifier is `export { type Stack }`.
			 */
			case N_ExportNamedDeclaration:
				if ((reader.flags(node) & NF_TYPE_ONLY) !== 0) {
					return TYPE_NONE;
				}

				this.#eachChild(node, child => this.#express(child));

				return TYPE_NONE;

			case N_ExportSpecifier:
				if ((reader.flags(node) & NF_TYPE_ONLY) === 0) {
					this.#eachChild(node, child => this.#express(child));
				}

				return TYPE_NONE;

			/*
			 * A module's name is a name, not an expression: the `"*.css"`
			 * in `declare module "*.css"` is never a string value at
			 * runtime. The body is ordinary code.
			 */
			case N_TSModuleDeclaration: {
				const body = reader.field(node, NODE_B);

				if (body !== 0) {
					this.#express(body);
				}

				return TYPE_NONE;
			}

			/*
			 * Class and pattern members: a non-computed key is a name, not
			 * an expression — the `"a"` in `class C { "a"() {} }` is never
			 * a string value at runtime — so only a computed key is
			 * expressed, along with every other child.
			 */
			case N_Property:
			case N_MethodDefinition:
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractMethodDefinition:
			case N_TSAbstractPropertyDefinition:
			case N_TSAbstractAccessorProperty: {
				const key = reader.field(node, NODE_A);
				const computed = (reader.flags(node) & NF_COMPUTED) !== 0;

				this.#eachChild(node, child => {
					if (computed || child !== key) {
						this.#express(child);
					}
				});

				return TYPE_NONE;
			}

			default:
				this.#eachChild(node, child => this.#express(child));

				return TYPE_NONE;
		}
	}

	/**
	 * Types an identifier read through its resolved symbol.
	 * @param node The identifier node's index.
	 * @returns The type ID.
	 */
	#expressIdentifier(node: number): number {
		const symbol = this.#resolvedSymbol(node, RF_VALUE);

		if (symbol === -1) {
			return TYPE_NONE;
		}

		const type = this.#builder.symbolType(symbol);

		this.#record(node, type);

		return type;
	}

	/**
	 * Types an array literal as `Array<union of its widened elements>`.
	 * @param node The `ArrayExpression` node's index.
	 * @returns The type ID.
	 */
	#expressArray(node: number): number {
		const reader = this.#reader;
		const list = reader.field(node, NODE_A);
		const size = reader.listSize(list);
		const parts: number[] = [];
		let unknown = size === 0;

		for (let i = 0; i < size; i++) {
			const element = reader.listItem(list, i);

			if (element === 0) {
				continue;
			}

			if (reader.kind(element) === N_SpreadElement) {
				const spread = this.#express(reader.field(element, NODE_A));
				const shape =
					spread === TYPE_NONE
						? 0
						: this.#builder.typeField(spread, TY_SHAPE);

				if (
					(shape & TYS_ARRAY) !== 0 &&
					this.#builder.poolCount(
						this.#builder.typeField(spread, TY_DATA0),
					) > 0
				) {
					parts.push(
						this.#builder.poolItem(
							this.#builder.typeField(spread, TY_DATA0),
							0,
						),
					);
				} else {
					unknown = true;
				}

				continue;
			}

			const type = this.#express(element);

			if (type === TYPE_NONE) {
				unknown = true;
			} else {
				parts.push(this.#widen(type));
			}
		}

		const element = unknown ? TYPE_UNKNOWN : this.#union(parts, 0);
		const type = this.#arrayType(element, node);

		this.#record(node, type);

		return type;
	}

	/**
	 * Types an object literal as an anonymous object with the properties it
	 * spells out.
	 * @param node The `ObjectExpression` node's index.
	 * @returns The type ID.
	 */
	#expressObject(node: number): number {
		const reader = this.#reader;
		const list = reader.field(node, NODE_A);
		const size = reader.listSize(list);
		const entries: MemberEntry[] = [];
		let inexact = false;

		for (let i = 0; i < size; i++) {
			const property = reader.listItem(list, i);

			if (reader.kind(property) !== N_Property) {
				// A spread: whatever it adds is not in the member list.
				this.#eachChild(property, child => this.#express(child));
				inexact = true;
				continue;
			}

			const flags = reader.flags(property);
			const value = reader.field(property, NODE_B);

			if ((flags & NF_COMPUTED) !== 0) {
				this.#express(reader.field(property, NODE_A));
				this.#express(value);
				inexact = true;
				continue;
			}

			const methodKind = (flags & MKIND_MASK) >>> MKIND_SHIFT;
			const valueType = this.#express(value);
			const name = this.#memberName(reader.field(property, NODE_A));

			if (methodKind === MKIND_GET || methodKind === MKIND_SET) {
				// The value is a function expression, so it always typed.
				entries.push(
					this.#accessorEntry(name, valueType, methodKind, 0),
				);
				continue;
			}

			entries.push({
				name,
				type: this.#widen(valueType),
				flags: (flags & NF_METHOD) !== 0 ? TMF_METHOD : 0,
			});
		}

		const [first, count] = this.#writeMembers(entries);
		const type = this.#builder.addType(
			TYF_OBJECT,
			TYS_ANONYMOUS | (inexact ? TYS_INEXACT : 0),
			0,
			0,
			0,
			first,
			count,
			this.#handle(node),
		);

		this.#record(node, type);

		return type;
	}

	/**
	 * Types a unary operator by its fixed result.
	 * @param node The `UnaryExpression` node's index.
	 * @returns The type ID.
	 */
	#expressUnary(node: number): number {
		const reader = this.#reader;
		const operand = this.#express(reader.field(node, NODE_A));
		const operator = reader.field(node, NODE_B);
		let type: number;

		switch (operator) {
			case T_NOT:
				type = TYPE_BOOLEAN;
				break;
			case T_typeof:
				type = TYPE_STRING;
				break;
			case T_void:
				type = TYPE_UNDEFINED;
				break;
			case T_delete:
				type = TYPE_BOOLEAN;
				break;
			case T_PLUS:
				// `+x` coerces to a number; a bigint operand throws instead.
				type = TYPE_NUMBER;
				break;
			case T_MINUS:
			case T_TILDE:
				type = this.#numericResult(operand, TYPE_NONE);
				break;
			default:
				type = TYPE_NONE;
				break;
		}

		this.#record(node, type);

		return type;
	}

	/**
	 * `bigint` when the operand is bigint-like, `number` when it is anything
	 * else known, the fallback when it is untyped.
	 * @param operand The operand's type ID.
	 * @param fallback What an untyped operand yields.
	 * @returns The type ID.
	 */
	#numericResult(operand: number, fallback: number): number {
		if (operand === TYPE_NONE) {
			return fallback;
		}

		return (this.#builder.typeField(operand, TY_FLAGS) &
			TYF_BIGINT_LIKE) !==
			0
			? TYPE_BIGINT
			: TYPE_NUMBER;
	}

	/**
	 * Types a binary operator by its fixed result.
	 * @param node The `BinaryExpression` node's index.
	 * @returns The type ID.
	 */
	#expressBinary(node: number): number {
		const reader = this.#reader;
		const left = this.#express(reader.field(node, NODE_A));
		const right = this.#express(reader.field(node, NODE_B));
		const operator = reader.field(node, NODE_C);
		const type = this.#binaryResult(operator, left, right);

		this.#record(node, type);

		return type;
	}

	/**
	 * The result type of a binary operator over two operand types.
	 * @param operator The operator's token kind.
	 * @param left The left operand's type ID.
	 * @param right The right operand's type ID.
	 * @returns The type ID.
	 */
	#binaryResult(operator: number, left: number, right: number): number {
		// Comparisons, `in`, and `instanceof` always produce a boolean.
		if (
			(operator >= T_EQ_EQ && operator <= T_GT_EQ) ||
			operator === T_in ||
			operator === T_instanceof
		) {
			return TYPE_BOOLEAN;
		}

		const builder = this.#builder;
		const leftFlags =
			left === TYPE_NONE ? 0 : builder.typeField(left, TY_FLAGS);
		const rightFlags =
			right === TYPE_NONE ? 0 : builder.typeField(right, TY_FLAGS);

		if (operator === T_PLUS) {
			if (((leftFlags | rightFlags) & TYF_STRING_LIKE) !== 0) {
				return TYPE_STRING;
			}

			if (left === TYPE_NONE || right === TYPE_NONE) {
				return TYPE_NONE;
			}

			return ((leftFlags | rightFlags) & TYF_BIGINT_LIKE) !== 0
				? TYPE_BIGINT
				: TYPE_NUMBER;
		}

		/*
		 * The remaining arithmetic never concatenates, but two untyped
		 * operands could still both be bigints, so at least one operand has
		 * to be known before the result is.
		 */
		if (left === TYPE_NONE && right === TYPE_NONE) {
			return TYPE_NONE;
		}

		return ((leftFlags | rightFlags) & TYF_BIGINT_LIKE) !== 0
			? TYPE_BIGINT
			: TYPE_NUMBER;
	}

	/**
	 * The result type of a compound assignment.
	 * @param node The `AssignmentExpression` node's index.
	 * @param right The right operand's type ID.
	 * @returns The type ID.
	 */
	#compoundResult(node: number, right: number): number {
		const reader = this.#reader;
		const operator = reader.field(node, NODE_C);

		/*
		 * `&&=`, `||=`, and `??=` assign the right operand or keep the
		 * target; the expression's type would need the target's, so only a
		 * typed target answers. The arithmetic compounds reuse the binary
		 * rules with the assignment token mapped back to its operator.
		 */
		if (operator >= T_ASSIGN_AMPAMP && operator <= T_ASSIGN_QQ) {
			return TYPE_NONE;
		}

		if (operator === T_ASSIGN_PLUS) {
			return this.#binaryResult(T_PLUS, TYPE_NONE, right);
		}

		return this.#numericResult(right, TYPE_NONE);
	}

	/**
	 * Types a call through its callee's declared return type.
	 * @param node The `CallExpression` node's index.
	 * @returns The type ID.
	 */
	#expressCall(node: number): number {
		const reader = this.#reader;
		const callee = this.#express(reader.field(node, NODE_A));
		const args = reader.field(node, NODE_B);
		const size = reader.listSize(args);

		for (let i = 0; i < size; i++) {
			this.#express(reader.listItem(args, i));
		}

		let type = TYPE_NONE;

		if (callee !== TYPE_NONE) {
			const shape = this.#builder.typeField(callee, TY_SHAPE);

			if (
				(shape & TYS_FUNCTION) !== 0 &&
				(shape & TYS_CONSTRUCTOR) === 0
			) {
				type = this.#builder.typeField(callee, TY_DATA1);
			}
		}

		if (type !== TYPE_NONE && (reader.flags(node) & NF_OPTIONAL) !== 0) {
			type = this.#union([type, TYPE_UNDEFINED], node);
		}

		this.#record(node, type);

		return type;
	}

	/**
	 * Types `new` through the constructed instance type.
	 * @param node The `NewExpression` node's index.
	 * @returns The type ID.
	 */
	#expressNew(node: number): number {
		const reader = this.#reader;
		const calleeNode = reader.field(node, NODE_A);
		const callee = this.#express(calleeNode);
		const args = reader.field(node, NODE_B);
		const size = reader.listSize(args);

		for (let i = 0; i < size; i++) {
			this.#express(reader.listItem(args, i));
		}

		let type = TYPE_NONE;

		if (callee !== TYPE_NONE) {
			const shape = this.#builder.typeField(callee, TY_SHAPE);

			if ((shape & TYS_CONSTRUCTOR) !== 0) {
				type = this.#builder.typeField(callee, TY_DATA1);
			}
		}

		/*
		 * `new Map()` with no local `Map`: the standard library's. The
		 * instance is a library reference carrying any written type
		 * arguments.
		 */
		if (
			type === TYPE_NONE &&
			reader.kind(calleeNode) === N_Identifier &&
			this.#isUnresolved(calleeNode)
		) {
			const name = this.#ast.name(calleeNode);

			if (isWellKnownLibType(name)) {
				const argsNode = reader.field(node, NODE_C);
				const argIds: number[] = [];

				if (argsNode !== 0) {
					const list = reader.field(argsNode, NODE_A);
					const listSize = reader.listSize(list);

					for (let i = 0; i < listSize; i++) {
						argIds.push(this.#convert(reader.listItem(list, i)));
					}
				}

				const symbol = this.#libSymbol(name);
				const shape =
					TYS_REFERENCE |
					(name === "Array" || name === "ReadonlyArray"
						? TYS_ARRAY
						: 0);

				type =
					argIds.length === 0
						? this.#builder.internType(
								TYF_OBJECT,
								shape,
								symbol + 1,
								0,
								0,
							)
						: this.#builder.addType(
								TYF_OBJECT,
								shape,
								symbol + 1,
								this.#builder.poolList(argIds),
								0,
								0,
								0,
								this.#handle(node),
							);
			}
		}

		this.#record(node, type);

		return type;
	}

	/**
	 * Types a member access through the object's members, tuples by index,
	 * arrays by element.
	 * @param node The `MemberExpression` node's index.
	 * @returns The type ID.
	 */
	#expressMember(node: number): number {
		const reader = this.#reader;
		const builder = this.#builder;
		const object = this.#express(reader.field(node, NODE_A));
		const property = reader.field(node, NODE_B);
		const flags = reader.flags(node);
		let type = TYPE_NONE;

		if ((flags & NF_COMPUTED) !== 0) {
			const index = this.#express(property);

			if (object !== TYPE_NONE) {
				const shape = builder.typeField(object, TY_SHAPE);

				if (
					(shape & TYS_TUPLE) !== 0 &&
					index !== TYPE_NONE &&
					(builder.typeField(index, TY_FLAGS) &
						TYF_NUMBER_LITERAL) !==
						0
				) {
					const pool = builder.typeField(object, TY_DATA0);
					const at = this.#numericLiteralValue(index);

					if (at >= 0 && at < builder.poolCount(pool)) {
						type = builder.poolItem(pool, at);
					}
				} else if ((shape & TYS_ARRAY) !== 0) {
					const pool = builder.typeField(object, TY_DATA0);

					if (builder.poolCount(pool) > 0) {
						type = builder.poolItem(pool, 0);
					}
				}
			}
		} else if (object !== TYPE_NONE) {
			type = this.#memberType(
				object,
				this.#ast.name(property),
				MEMBER_LOOKUP_DEPTH,
			);
		}

		if (type !== TYPE_NONE && (flags & NF_OPTIONAL) !== 0) {
			type = this.#union([type, TYPE_UNDEFINED], node);
		}

		this.#record(node, type);

		return type;
	}

	/**
	 * The integer a number-literal type spells, or `-1`.
	 * @param type The literal type's ID.
	 * @returns The value, or `-1` when it is not a small integer.
	 */
	#numericLiteralValue(type: number): number {
		const builder = this.#builder;
		const text = builder.stringAt(builder.typeField(type, TY_DATA0));
		let value = 0;

		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);

			if (code < 48 || code > 57) {
				return -1;
			}

			value = value * 10 + (code - 48);

			if (value > 0xffff) {
				return -1;
			}
		}

		return text.length === 0 ? -1 : value;
	}

	/**
	 * Types the declarators of a declaration, widening initializer types for
	 * mutable bindings.
	 * @param node The `VariableDeclaration` node's index.
	 * @returns Nothing.
	 */
	#expressDeclaration(node: number): void {
		const reader = this.#reader;
		const declKind = (reader.flags(node) & DECL_MASK) >>> DECL_SHIFT;
		const isConst =
			declKind === DECL_CONST ||
			declKind === DECL_USING ||
			declKind === DECL_AWAIT_USING;
		const list = reader.field(node, NODE_A);
		const size = reader.listSize(list);

		for (let i = 0; i < size; i++) {
			const declarator = reader.listItem(list, i);

			if (reader.kind(declarator) !== N_VariableDeclarator) {
				continue;
			}

			const id = reader.field(declarator, NODE_A);
			const init = reader.field(declarator, NODE_B);
			const initType = init === 0 ? TYPE_NONE : this.#express(init);

			if (reader.kind(id) !== N_Identifier) {
				continue;
			}

			const symbol = this.#declaredSymbol(id);

			if (symbol === -1) {
				continue;
			}

			if (
				this.#builder.symbolType(symbol) === TYPE_NONE &&
				initType !== TYPE_NONE
			) {
				const bound = isConst ? initType : this.#widen(initType);
				const valueFlags =
					this.#builder.typeField(bound, TY_FLAGS) &
					~(TYF_UNION | TYF_INTERSECTION);

				/*
				 * `let x = null` is an evolving binding: the checker types
				 * it by its later assignments, which one pass over the
				 * syntax cannot see, so claiming the initializer's nullish
				 * type at every use would be wrong the moment anything is
				 * assigned. A mutable nullish-initialized binding stays
				 * untyped.
				 */
				if (
					isConst ||
					valueFlags === 0 ||
					(valueFlags & ~TYF_NULLISH) !== 0
				) {
					this.#builder.setSymbolType(symbol, bound);
				}
			}

			this.#record(id, this.#builder.symbolType(symbol));
		}
	}
}
