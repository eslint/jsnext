/**
 * @fileoverview Runs a program through all three analyses and collects what
 * each one produced, keeping the failures separate so one analysis breaking
 * does not blank the others.
 */

import {
	analyze,
	createGraph,
	parse,
	toAST,
	toGraphTree,
	toScopeTree,
	type FlowTree,
	type ParseResult,
	type ValidationError,
} from "@eslint/jskit";

/**
 * How the program should be interpreted, shared by `toAST()` and
 * `analyze()`. Parsing itself takes none of these: phase 1 accepts the
 * union of everything JavaScript and TypeScript allow.
 */
export interface InspectionOptions {
	sourceType: "script" | "module" | "commonjs";
	dialect: "js" | "ts";
	jsx: boolean;
}

/**
 * One tab's worth of output: the serialized data, or the reason there is
 * none.
 *
 * The tree view reads any of these as plain JSON, so most panes leave the
 * data untyped. The control flow one names its type, because its second
 * view — the diagram — reads the fields rather than walking them.
 */
export interface PaneResult<T = unknown> {
	data: T | null;
	error: string | null;
}

/**
 * Everything the inspector shows for one program.
 */
export interface Inspection {
	/** The fatal syntax error, when the program could not be parsed at all. */
	parseError: string | null;

	/** The non-fatal problems `validate()` found via `toAST()`. */
	validationErrors: ValidationError[];

	ast: PaneResult;
	scopes: PaneResult;
	flow: PaneResult<FlowTree>;
}

/**
 * Renders a thrown value as a message.
 * @param error The thrown value.
 * @returns The message to show.
 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Builds a pane that has no data.
 * @param message Why there is no data.
 * @returns The pane result.
 */
function failed(message: string): PaneResult<never> {
	return { data: null, error: message };
}

/**
 * Parses a program and runs the AST, scope, and control flow analyses over
 * it, entirely in this process.
 * @param code The source text to inspect.
 * @param options How the program should be interpreted.
 * @returns What each analysis produced.
 */
export function inspect(code: string, options: InspectionOptions): Inspection {
	let result: ParseResult;

	try {
		// `tokens: true` because the AST pane's `toAST()` reports them.
		result = parse(code, { sourceType: options.sourceType, tokens: true });
	} catch (error) {
		const message = messageOf(error);

		return {
			parseError: message,
			validationErrors: [],
			ast: failed(message),
			scopes: failed(message),
			flow: failed(message),
		};
	}

	let astPane: PaneResult;
	let validationErrors: ValidationError[] = [];

	try {
		const { ast, errors } = toAST(result, options);

		validationErrors = errors;
		astPane = { data: ast, error: null };
	} catch (error) {
		astPane = failed(messageOf(error));
	}

	let scopeBuffer: ArrayBuffer | null = null;
	let scopesPane: PaneResult;

	try {
		scopeBuffer = analyze(result, options);
		scopesPane = { data: toScopeTree(scopeBuffer, result), error: null };
	} catch (error) {
		scopesPane = failed(messageOf(error));
	}

	let flowPane: PaneResult<FlowTree>;

	if (scopeBuffer === null) {
		flowPane = failed(
			"The control flow graph needs the scope analysis, which failed.",
		);
	} else {
		try {
			const flow = createGraph(result, scopeBuffer);

			flowPane = {
				data: toGraphTree(flow, result, scopeBuffer),
				error: null,
			};
		} catch (error) {
			flowPane = failed(messageOf(error));
		}
	}

	return {
		parseError: null,
		validationErrors,
		ast: astPane,
		scopes: scopesPane,
		flow: flowPane,
	};
}
