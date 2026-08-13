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
 */

import { N_Identifier } from "@eslint/jsparse";
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
	V_REFERENCES,
	V_SCOPE,
} from "./scope-buffer.js";
import type { DefinitionType, ScopeType } from "./kinds.js";

/** The global scope's ID, which is always the first scope created. */
const GLOBAL_SCOPE = 0;

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
	 * The global scope's symbols by name, built the first time a name lookup
	 * happens. Implicit globals are excluded, matching `Scope#set`.
	 */
	private globalNames: Map<string, number> | null = null;

	/**
	 * Which symbols a consumer has marked as used — the `eslintUsed`
	 * protocol. The buffer itself is immutable, so this lives beside it,
	 * keyed by symbol ID.
	 */
	private used: Uint8Array | null = null;

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
	 * @param node The node.
	 * @param inner Whether to prefer the innermost scope the node opened.
	 * @returns The scope ID, or `null` when the node opened none.
	 */
	getScope(node: TNode, inner = false): number | null {
		const ids = this.buffer.scopesOfNode(this.nodes.handleOf(node));

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
		return this.buffer.listItems(this.buffer.scopeField(scope, S_VARIABLES));
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
	 * @param node The `Identifier` node.
	 * @returns `true` for a reference to an unshadowed configured global.
	 */
	isGlobalReference(node: TNode): boolean {
		if (this.nodes.ast.kind(node) !== N_Identifier) {
			return false;
		}

		const refs = this.buffer.referencesAtIdentifier(
			this.nodes.handleOf(node),
		);

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
		if (this.globalNames === null) {
			this.globalNames = new Map();

			for (const symbol of this.scopeSymbols(GLOBAL_SCOPE)) {
				const symbolName = this.symbolName(symbol);

				if (!this.globalNames.has(symbolName)) {
					this.globalNames.set(symbolName, symbol);
				}
			}
		}

		return this.globalNames.get(name) ?? null;
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
	 * The symbols a declaration node declares.
	 * @param node The declaring node.
	 * @returns The symbol IDs, in declaration order.
	 */
	getDeclaredSymbols(node: TNode): number[] {
		return this.buffer.declaredSymbolsOfNode(this.nodes.handleOf(node));
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
	 * @param node The `Identifier` node.
	 * @returns The reference ID, or `null` when the identifier is not a
	 *      reference — a property name, a label, a declaration-only
	 *      occurrence.
	 */
	resolveReference(node: TNode): number | null {
		const refs = this.buffer.referencesAtIdentifier(
			this.nodes.handleOf(node),
		);

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
		return (
			(this.buffer.referenceField(reference, R_FLAGS) & RF_READ) !== 0
		);
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
		return (
			(this.buffer.referenceField(reference, R_FLAGS) & RF_INIT) !== 0
		);
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
