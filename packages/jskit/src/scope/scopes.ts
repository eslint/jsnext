/**
 * @fileoverview Query methods over a scope buffer, without materializing the
 * object graph.
 *
 * This is an exploratory API: a way to find out which questions the binary
 * format answers well, not a planned replacement for the rule-facing scope
 * API. Its method set follows the survey of what ESLint core rules actually
 * ask (see `docs/requirements.md`), most-common first: global identity
 * checks, declaration-to-bindings, reference iteration with read/write
 * flags, unresolved references, and scope-chain walking.
 *
 * Scopes, symbols, references, and definitions are all identified by the
 * stable integer IDs assigned when the buffer was written. Methods hand back
 * IDs and primitives; nothing here allocates a graph.
 *
 * A node can be named two ways: as the representation the buffer was analyzed
 * over — an index on the binary path, the tree's own object on the tree
 * path — or as a `NodeRef`, a `{ type, start }` position. The latter is what
 * lets a consumer holding only decoded ESTree nodes, an ESLint rule above
 * all, ask about a node it has no buffer index for.
 */

import { N_Identifier } from "../parse/index.js";
import {
	resolveNodeSource,
	type NodeSource,
	type ScopeSource,
} from "./node-source.js";
import { ScopeBufferReader } from "./scope-buffer-reader.js";
import {
	D_TYPE,
	DEFINITION_TYPE_CODES,
	R_FLAGS,
	R_FROM,
	R_IDENTIFIER,
	R_NAME,
	R_RESOLVED,
	RF_INIT,
	RF_READ,
	RF_WRITE,
	S_BLOCK,
	S_FLAGS,
	S_THROUGH,
	S_TYPE,
	S_UPPER,
	S_VARIABLE_SCOPE,
	S_VARIABLES,
	SCOPE_TYPE_CODES,
	SF_FUNCTION_EXPRESSION_SCOPE,
	SF_STRICT,
	V_DEFINITIONS,
	V_NAME,
	V_READ_COUNT,
	V_REFERENCES,
	V_WRITE_COUNT,
	V_SCOPE,
} from "./scope-buffer.js";
import type { DefinitionType, ScopeType } from "./kinds.js";

/** The global scope's ID, which is always the first scope created. */
const GLOBAL_SCOPE = 0;

/**
 * A node named by position rather than by the representation the buffer was
 * analyzed over.
 *
 * A consumer holding an ESTree tree decoded from the same program — an ESLint
 * rule, say — has node objects, not buffer indexes, and no way to get one
 * from the other. Every ESTree node already answers to this shape, since
 * `type`, `start`, and `end` are all on it, so such a node can be passed to
 * any query that takes one and is matched to the analyzed node at the same
 * position. `end` narrows the match when given; `type` and `start` alone are
 * unambiguous for everything the buffer stores except where one node opens a
 * scope exactly where another starts, which `type` settles.
 */
export interface NodeRef {
	/** The ESTree `type` string. */
	type: string;

	/** The offset the node starts at. */
	start: number;

	/** The offset just past the node, checked when given. */
	end?: number;
}

/**
 * Looks scope data up straight out of a scope buffer.
 *
 * @template TNode How one node is represented: an index into the binary AST
 *      buffer, or an ESTree object.
 */
export class Scopes<TNode = number> {
	/** The reader over the scope buffer. */
	private readonly buffer: ScopeBufferReader;

	/** Turns stored handles back into nodes and nodes into handles. */
	private readonly nodes: NodeSource<TNode>;

	/**
	 * Each queried scope's own symbols by name, built the first time a name
	 * lookup reaches that scope and kept for the next one. Implicit globals
	 * are excluded, matching `Scope#set`.
	 */
	private readonly namesByScope = new Map<number, Map<string, number>>();

	/**
	 * Which symbols a consumer has marked as used — the `eslintUsed`
	 * protocol. The buffer itself is immutable, so this lives beside it,
	 * keyed by symbol ID.
	 */
	private used: Uint8Array | null = null;

	/**
	 * The buffer's stored handles by the start offset of their node, built
	 * the first time a query is given a `NodeRef` and kept for the next one.
	 */
	private handlesByStart: Map<number, number[]> | null = null;

	/**
	 * Creates the query view over a scope buffer.
	 * @param scopes The buffer `analyze()` or `analyzeTree()` returned.
	 * @param source The parse result the buffer was produced from, or the
	 *      `Program` node when it came from `analyzeTree()`.
	 */
	constructor(scopes: ArrayBuffer, source: ScopeSource) {
		this.buffer = new ScopeBufferReader(scopes);
		this.nodes = resolveNodeSource(
			source,
			this.buffer.treeHandles,
		) as NodeSource<TNode>;
	}

	//-------------------------------------------------------------------------
	// Node Resolution
	//-------------------------------------------------------------------------

	/**
	 * The handle a query should look up for a node given either way.
	 * @param node The node, or a positional reference to it.
	 * @returns The handle, or `0` when nothing the buffer stores matches.
	 */
	private resolve(node: TNode | NodeRef): number {
		if (typeof node !== "object" || node === null) {
			return this.nodes.handleOf(node as TNode);
		}

		/*
		 * On the tree path an object may be the very node the walk visited,
		 * so identity is tried first. On the binary path — recognizable by
		 * its reader — no object can be a node, and identity would do
		 * arithmetic on one.
		 */
		if (this.nodes.reader === null) {
			const direct = this.nodes.handleOf(node as TNode);

			if (direct !== 0) {
				return direct;
			}
		}

		return this.handleAt(node as NodeRef);
	}

	/**
	 * Finds the stored handle for a node named by position.
	 *
	 * Only the handles the buffer stores are indexed — the nodes that opened
	 * scopes, the declaring nodes, and the referenced identifiers — because
	 * they are the only nodes any query can say something about. A position
	 * naming any other node resolves to `0`, and the query answers the same
	 * way it does for a node with nothing recorded.
	 * @param ref The position and type to look up.
	 * @returns The handle, or `0` when nothing the buffer stores matches.
	 */
	private handleAt(ref: NodeRef): number {
		let index = this.handlesByStart;

		if (index === null) {
			index = new Map();

			for (const handle of this.buffer.storedHandles()) {
				const start = this.nodes.ast.start(this.nodes.nodeAt(handle));
				const bucket = index.get(start);

				if (bucket === undefined) {
					index.set(start, [handle]);
				} else {
					bucket.push(handle);
				}
			}

			this.handlesByStart = index;
		}

		const bucket = index.get(ref.start);

		if (bucket !== undefined) {
			for (const handle of bucket) {
				const node = this.nodes.nodeAt(handle);

				if (
					this.nodes.ast.typeName(node) === ref.type &&
					(ref.end === undefined ||
						this.nodes.ast.end(node) === ref.end)
				) {
					return handle;
				}
			}
		}

		return 0;
	}

	//-------------------------------------------------------------------------
	// Scopes
	//-------------------------------------------------------------------------

	/** The number of scopes. Scope IDs are `0` to `scopeCount - 1`. */
	get scopeCount(): number {
		return this.buffer.scopeCount;
	}

	/** The number of symbols. Symbol IDs are `0` to `symbolCount - 1`. */
	get symbolCount(): number {
		return this.buffer.symbolCount;
	}

	/** The number of references. */
	get referenceCount(): number {
		return this.buffer.referenceCount;
	}

	/** The global scope's ID. */
	get globalScope(): number {
		return GLOBAL_SCOPE;
	}

	/**
	 * The scope a node opened, skipping the scope that exists only to hold a
	 * function expression's name.
	 * @param node The node, or a positional reference to it.
	 * @param inner Whether to prefer the innermost scope the node opened.
	 * @returns The scope ID, or `null` when the node opened none.
	 */
	getScope(node: TNode | NodeRef, inner = false): number | null {
		const ids = this.buffer.scopesOfNode(this.resolve(node));

		if (inner) {
			for (let i = ids.length - 1; i >= 0; i--) {
				if (!this.isFunctionExpressionNameScope(ids[i])) {
					return ids[i];
				}
			}
		} else {
			for (let i = 0; i < ids.length; i++) {
				if (!this.isFunctionExpressionNameScope(ids[i])) {
					return ids[i];
				}
			}
		}

		return null;
	}

	/**
	 * The kind of a scope.
	 * @param scope The scope ID.
	 * @returns The scope type, spelled the way the reference analyzers spell
	 *      it.
	 */
	scopeType(scope: number): ScopeType {
		return SCOPE_TYPE_CODES[this.buffer.scopeField(scope, S_TYPE)];
	}

	/**
	 * The enclosing scope.
	 * @param scope The scope ID.
	 * @returns The enclosing scope's ID, or `null` for the global scope.
	 */
	upper(scope: number): number | null {
		const stored = this.buffer.scopeField(scope, S_UPPER);

		return stored === 0 ? null : stored - 1;
	}

	/**
	 * The nearest enclosing scope that a `var` declaration binds in.
	 * @param scope The scope ID.
	 * @returns That scope's ID.
	 */
	variableScope(scope: number): number {
		return this.buffer.scopeField(scope, S_VARIABLE_SCOPE);
	}

	/**
	 * Whether strict mode rules apply in a scope.
	 * @param scope The scope ID.
	 * @returns `true` when the scope is strict.
	 */
	isStrict(scope: number): boolean {
		return (this.buffer.scopeField(scope, S_FLAGS) & SF_STRICT) !== 0;
	}

	/**
	 * The node of the syntax that opened a scope.
	 * @param scope The scope ID.
	 * @returns The block node.
	 */
	scopeBlock(scope: number): TNode {
		return this.nodes.nodeAt(this.buffer.scopeField(scope, S_BLOCK));
	}

	/**
	 * The symbols bound in a scope, in the order they were bound.
	 * @param scope The scope ID.
	 * @returns The symbol IDs.
	 */
	scopeSymbols(scope: number): number[] {
		return this.buffer.listItems(
			this.buffer.scopeField(scope, S_VARIABLES),
		);
	}

	/**
	 * The references a scope could not resolve — its `through` list. For the
	 * global scope that is every reference that resolved to nothing anywhere,
	 * which is exactly what `no-undef` reports; for a function scope it is
	 * everything the function closes over.
	 * @param scope The scope ID.
	 * @returns The reference IDs.
	 */
	getUnresolvedReferences(scope: number): number[] {
		return this.buffer.listItems(this.buffer.scopeField(scope, S_THROUGH));
	}

	/**
	 * Whether a scope exists only to hold a function expression's name.
	 * @param scope The scope ID.
	 * @returns `true` for a function-expression-name scope.
	 */
	private isFunctionExpressionNameScope(scope: number): boolean {
		return (
			(this.buffer.scopeField(scope, S_FLAGS) &
				SF_FUNCTION_EXPRESSION_SCOPE) !==
			0
		);
	}

	//-------------------------------------------------------------------------
	// Globals
	//-------------------------------------------------------------------------

	/**
	 * Whether an identifier is a reference to a configured global — a global
	 * scope binding with no definitions in code — with the exact semantics of
	 * ESLint's `SourceCode#isGlobalReference()`. An identifier that resolves
	 * to nothing at all returns `false`; those are served by
	 * `getGlobalReferences()` and `getUnresolvedReferences()` instead.
	 * @param node The `Identifier` node, or a positional reference to it.
	 * @returns `true` for a reference to an unshadowed configured global.
	 */
	isGlobalReference(node: TNode | NodeRef): boolean {
		const handle = this.resolve(node);

		if (
			handle === 0 ||
			this.nodes.ast.kind(this.nodes.nodeAt(handle)) !== N_Identifier
		) {
			return false;
		}

		const refs = this.buffer.referencesAtIdentifier(handle);

		for (const ref of refs) {
			const resolved = this.buffer.referenceField(ref, R_RESOLVED);

			if (resolved !== 0 && this.symbolIsConfiguredGlobal(resolved - 1)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Every reference to a global name: the resolved references to its global
	 * scope binding first, then the unresolved references that would reach it
	 * if the host declared it.
	 * @param name The global's name.
	 * @returns The reference IDs.
	 */
	getGlobalReferences(name: string): number[] {
		const references: number[] = [];
		const symbol = this.globalSymbol(name);

		if (symbol !== null) {
			references.push(...this.getReferences(symbol));
		}

		for (const ref of this.getUnresolvedReferences(GLOBAL_SCOPE)) {
			if (this.referenceName(ref) === name) {
				references.push(ref);
			}
		}

		return references;
	}

	/**
	 * The global scope's binding for a name.
	 * @param name The name to look up.
	 * @returns The symbol ID, or `null` when the global scope has no such
	 *      binding.
	 */
	globalSymbol(name: string): number | null {
		return this.getOwnSymbolByName(GLOBAL_SCOPE, name);
	}

	/**
	 * Whether a symbol is a configured global: bound in the global scope with
	 * no definitions in code.
	 * @param symbol The symbol ID.
	 * @returns `true` for a configured global.
	 */
	private symbolIsConfiguredGlobal(symbol: number): boolean {
		return (
			this.buffer.symbolField(symbol, V_SCOPE) === GLOBAL_SCOPE &&
			this.buffer.listCount(
				this.buffer.symbolField(symbol, V_DEFINITIONS),
			) === 0
		);
	}

	//-------------------------------------------------------------------------
	// Symbols
	//-------------------------------------------------------------------------

	/**
	 * One scope's own binding for a name, without climbing the chain.
	 * @param scope The scope ID.
	 * @param name The name to look up.
	 * @returns The symbol ID, or `null` when the scope binds no such name.
	 */
	getOwnSymbolByName(scope: number, name: string): number | null {
		let names = this.namesByScope.get(scope);

		if (names === undefined) {
			names = new Map();

			for (const symbol of this.scopeSymbols(scope)) {
				const symbolName = this.symbolName(symbol);

				if (!names.has(symbolName)) {
					names.set(symbolName, symbol);
				}
			}

			this.namesByScope.set(scope, names);
		}

		return names.get(name) ?? null;
	}

	/**
	 * The binding a name resolves to from a scope, climbing outward the way
	 * a reference does. This is `getVariableByName()`: the second-most-asked
	 * question in the rule survey, and what the shadowing rules walk.
	 * @param scope The scope the name is written in.
	 * @param name The name to resolve.
	 * @returns The symbol ID, or `null` when nothing in the chain binds it.
	 */
	getSymbolByName(scope: number, name: string): number | null {
		for (let at: number | null = scope; at !== null; at = this.upper(at)) {
			const symbol = this.getOwnSymbolByName(at, name);

			if (symbol !== null) {
				return symbol;
			}
		}

		return null;
	}

	/**
	 * How many references read a symbol, counted when the buffer was written.
	 * A read-write such as `x += 1` counts here and as a write, so this and
	 * `getSymbolWriteCount()` do not sum to the reference count.
	 * @param symbol The symbol ID.
	 * @returns The number of reads.
	 */
	getSymbolReadCount(symbol: number): number {
		return this.buffer.symbolField(symbol, V_READ_COUNT);
	}

	/**
	 * How many references write a symbol, counted when the buffer was
	 * written. `prefer-const` is the shape this exists for: a binding written
	 * more than once is settled without touching its reference list at all.
	 * @param symbol The symbol ID.
	 * @returns The number of writes, initializers included.
	 */
	getSymbolWriteCount(symbol: number): number {
		return this.buffer.symbolField(symbol, V_WRITE_COUNT);
	}

	/**
	 * How many references resolved to a symbol.
	 * @param symbol The symbol ID.
	 * @returns The number of references.
	 */
	getSymbolReferenceCount(symbol: number): number {
		return this.buffer.listCount(
			this.buffer.symbolField(symbol, V_REFERENCES),
		);
	}

	/**
	 * The symbols a declaration node declares.
	 * @param node The declaring node, or a positional reference to it.
	 * @returns The symbol IDs, in declaration order.
	 */
	getDeclaredSymbols(node: TNode | NodeRef): number[] {
		return this.buffer.declaredSymbolsOfNode(this.resolve(node));
	}

	/**
	 * Every reference that resolved to a symbol, in resolution order.
	 * @param symbol The symbol ID.
	 * @returns The reference IDs.
	 */
	getReferences(symbol: number): number[] {
		return this.buffer.listItems(
			this.buffer.symbolField(symbol, V_REFERENCES),
		);
	}

	/**
	 * The name a symbol binds.
	 * @param symbol The symbol ID.
	 * @returns The name.
	 */
	symbolName(symbol: number): string {
		return this.buffer.string(this.buffer.symbolField(symbol, V_NAME));
	}

	/**
	 * The scope a symbol is bound in.
	 * @param symbol The symbol ID.
	 * @returns The scope ID.
	 */
	symbolScope(symbol: number): number {
		return this.buffer.symbolField(symbol, V_SCOPE);
	}

	/**
	 * Whether a symbol has any definitions in code. A configured global has
	 * none, which is the single bit half the scope-consulting rules test.
	 * @param symbol The symbol ID.
	 * @returns `true` when at least one declaration binds the symbol.
	 */
	symbolHasDefinitions(symbol: number): boolean {
		return (
			this.buffer.listCount(
				this.buffer.symbolField(symbol, V_DEFINITIONS),
			) > 0
		);
	}

	/**
	 * The kinds of declaration that bind a symbol.
	 * @param symbol The symbol ID.
	 * @returns One definition type per declaration, in declaration order.
	 */
	symbolDefinitionTypes(symbol: number): DefinitionType[] {
		return this.buffer
			.listItems(this.buffer.symbolField(symbol, V_DEFINITIONS))
			.map(
				definition =>
					DEFINITION_TYPE_CODES[
						this.buffer.definitionField(definition, D_TYPE)
					],
			);
	}

	//-------------------------------------------------------------------------
	// References
	//-------------------------------------------------------------------------

	/**
	 * The reference recorded at an identifier.
	 * @param node The `Identifier` node, or a positional reference to it.
	 * @returns The reference ID, or `null` when the identifier is not a
	 *      reference — a property name, a label, a declaration-only
	 *      occurrence.
	 */
	resolveReference(node: TNode | NodeRef): number | null {
		const refs = this.buffer.referencesAtIdentifier(this.resolve(node));

		return refs.length === 0 ? null : refs[0];
	}

	/**
	 * The identifier node a reference occurred at.
	 * @param reference The reference ID.
	 * @returns The node.
	 */
	referenceIdentifier(reference: number): TNode {
		return this.nodes.nodeAt(
			this.buffer.referenceField(reference, R_IDENTIFIER),
		);
	}

	/**
	 * The name a reference spells.
	 * @param reference The reference ID.
	 * @returns The name.
	 */
	referenceName(reference: number): string {
		return this.buffer.string(
			this.buffer.referenceField(reference, R_NAME),
		);
	}

	/**
	 * The scope a reference was written in.
	 * @param reference The reference ID.
	 * @returns The scope ID.
	 */
	referenceScope(reference: number): number {
		return this.buffer.referenceField(reference, R_FROM);
	}

	/**
	 * The symbol a reference resolved to.
	 * @param reference The reference ID.
	 * @returns The symbol ID, or `null` when nothing resolved it.
	 */
	referenceResolved(reference: number): number | null {
		const stored = this.buffer.referenceField(reference, R_RESOLVED);

		return stored === 0 ? null : stored - 1;
	}

	/**
	 * Whether a reference reads its variable.
	 * @param reference The reference ID.
	 * @returns `true` for a read or a read-write.
	 */
	referenceIsRead(reference: number): boolean {
		return (this.buffer.referenceField(reference, R_FLAGS) & RF_READ) !== 0;
	}

	/**
	 * Whether a reference writes its variable.
	 * @param reference The reference ID.
	 * @returns `true` for a write or a read-write.
	 */
	referenceIsWrite(reference: number): boolean {
		return (
			(this.buffer.referenceField(reference, R_FLAGS) & RF_WRITE) !== 0
		);
	}

	/**
	 * Whether a write is the initialization of a declaration.
	 * @param reference The reference ID.
	 * @returns `true` for an initializer.
	 */
	referenceIsInit(reference: number): boolean {
		return (this.buffer.referenceField(reference, R_FLAGS) & RF_INIT) !== 0;
	}

	//-------------------------------------------------------------------------
	// Usage marks
	//-------------------------------------------------------------------------

	/**
	 * Marks a symbol as used — the `eslintUsed` protocol. The buffer itself
	 * never changes; the mark lives in a side table keyed by symbol ID.
	 * @param symbol The symbol ID.
	 * @returns Nothing.
	 */
	markSymbolAsUsed(symbol: number): void {
		if (this.used === null) {
			this.used = new Uint8Array(this.buffer.symbolCount);
		}

		this.used[symbol] = 1;
	}

	/**
	 * Whether a symbol has been marked as used.
	 * @param symbol The symbol ID.
	 * @returns `true` once `markSymbolAsUsed()` has been called for it.
	 */
	isSymbolUsed(symbol: number): boolean {
		return this.used !== null && this.used[symbol] === 1;
	}
}
