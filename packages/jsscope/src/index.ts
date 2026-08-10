/**
 * @fileoverview The public API: `analyze()` and the scope graph it returns.
 */

import { AstReader, type ParseResult } from "jsparse";
import { resolveOptions, type AnalyzeOptions } from "./options.js";
import { Referencer } from "./referencer.js";
import { ScopeManager } from "./scope-manager.js";

export { Definition } from "./definition.js";
export { Reference } from "./reference.js";
export { Scope } from "./scope.js";
export { ScopeManager } from "./scope-manager.js";
export { Variable } from "./variable.js";
export { PatternVisitor } from "./pattern-visitor.js";
export * from "./kinds.js";
export type { AnalyzeOptions, ResolvedOptions } from "./options.js";
export type { ImplicitGlobals } from "./scope.js";
export type { MaybeImplicitGlobal } from "./reference.js";
export type { PatternCallback, PatternInfo } from "./pattern-visitor.js";
export type { DefinitionType, ScopeType } from "./kinds.js";

/**
 * Finds the scopes of a parsed program and resolves every identifier in it.
 *
 * The analysis runs on the binary buffers `parse()` produced, so nothing is
 * decoded into ESTree objects along the way. Every node the result refers to —
 * a scope's `block`, a reference's `identifier`, a definition's `name` — is a
 * node index into that buffer, and `0` means there is no node. `AstReader`, or
 * the `nodeType` and `nodeRange` helpers on the returned manager, turn an index
 * back into something a caller can read.
 * @param result The value returned by `jsparse`'s `parse()`.
 * @param options How the program should be interpreted.
 * @returns Every scope in the program, with each reference resolved to the
 *      variable it names wherever one could be found.
 * @throws {TypeError} When the buffer is not a jsparse AST buffer.
 */
export function analyze(
	result: ParseResult,
	options: AnalyzeOptions = {},
): ScopeManager {
	const resolved = resolveOptions(options);
	const reader = new AstReader(result.ast);
	const scopeManager = new ScopeManager(reader, resolved);
	const referencer = new Referencer(scopeManager);

	referencer.visit(reader.root);

	if (resolved.globals !== null) {
		scopeManager.addGlobals(resolved.globals);
	}

	return scopeManager;
}

export default { analyze };
