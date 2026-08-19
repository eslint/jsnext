/**
 * @fileoverview The options an analysis runs with.
 */

/**
 * How a program should be interpreted while its scopes are built.
 */
export interface AnalyzeOptions {
	/** Whether the program is a script, an ES module, or a CommonJS module. */
	sourceType?: "script" | "module" | "commonjs";

	/**
	 * Whether TypeScript syntax carries meaning.
	 *
	 * A valid JavaScript program contains no TypeScript nodes, so the type
	 * rules have nothing to fire on either way. What this actually decides is
	 * the one construct the two reference implementations disagree about:
	 * `export { a }` names both a value and a type under `"ts"`, and only a
	 * value under `"js"`, which is what `eslint-scope` reports.
	 */
	dialect?: "js" | "ts";

	/** Whether a JSX identifier counts as a reference. */
	jsx?: boolean;

	/** Whether strict mode applies without a directive saying so. */
	impliedStrict?: boolean;

	/**
	 * Whether an extra function scope wraps the program, which is what makes
	 * top-level `return` legal. Implied by `sourceType: "commonjs"`.
	 */
	globalReturn?: boolean;

	/**
	 * Whether a direct call to `eval` should be ignored rather than making its
	 * enclosing scopes dynamic.
	 */
	ignoreEval?: boolean;

	/**
	 * Names to declare in the global scope, which is how a host's built-ins
	 * are supplied. References waiting for them resolve once they exist.
	 */
	globals?: Iterable<string>;

	/**
	 * The name a JSX element compiles a call to, referenced once per element
	 * when set. `@typescript-eslint/scope-manager` defaults this to `"React"`;
	 * here it defaults to `null`, because `eslint-scope` creates no such
	 * reference and `eslint-scope` is the tiebreaker.
	 */
	jsxPragma?: string | null;

	/** The name a JSX fragment compiles a call to, referenced when set. */
	jsxFragmentName?: string | null;
}

/**
 * The same options with every default filled in.
 */
export interface ResolvedOptions {
	sourceType: "script" | "module" | "commonjs";
	dialect: "js" | "ts";
	jsx: boolean;
	impliedStrict: boolean;
	globalReturn: boolean;
	ignoreEval: boolean;
	globals: Iterable<string> | null;
	jsxPragma: string | null;
	jsxFragmentName: string | null;
}

/**
 * Fills in the defaults an analysis was not given.
 * @param options The options the caller supplied.
 * @returns The options with every field present.
 */
export function resolveOptions(options: AnalyzeOptions = {}): ResolvedOptions {
	return {
		sourceType: options.sourceType ?? "module",
		dialect: options.dialect ?? "ts",
		jsx: options.jsx ?? true,
		impliedStrict: options.impliedStrict ?? false,
		globalReturn: options.globalReturn ?? false,
		ignoreEval: options.ignoreEval ?? false,
		globals: options.globals ?? null,
		jsxPragma: options.jsxPragma ?? null,
		jsxFragmentName: options.jsxFragmentName ?? null,
	};
}
