/**
 * @fileoverview Verifies that a node kind is registered everywhere it has to
 * be, and that it survives a round trip through both packages.
 *
 * Adding a node kind means touching seven files across two packages, and the
 * failure mode for most of them is silence: the parser emits the node, the
 * decoder produces the right tree, and something downstream quietly stops
 * descending into it. This checks every site at once and then proves the node
 * works by running it.
 *
 *     node .agents/skills/add-node-type/check-node-kind.mjs <TypeName>
 *     node .agents/skills/add-node-type/check-node-kind.mjs <TypeName> --code '<source>'
 *
 * Run from the repository root, after `npm run build`.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../../", import.meta.url);

/** Every registration site, in the order the skill walks them. */
const SITES = [
	{
		file: "packages/jskit/src/parse/node-kinds.ts",
		label: "kind constant",
		always: true,
		test: (src, kind) =>
			new RegExp(`^export const ${kind} = (\\d+);`, "mu").test(src),
	},
	{
		file: "packages/jskit/src/parse/node-kinds.ts",
		label: "kind name",
		always: true,
		test: (src, kind, type) =>
			new RegExp(`names\\[${kind}\\]\\s*=\\s*\n?\\s*"${type}";`, "u").test(
				src,
			),
	},
	{
		file: "packages/jskit/src/parse/slots.ts",
		label: "slot layout",
		always: false,
		note: "only needed when the node has child slots",
		test: (src, kind) => referencedInDefine(src, kind),
	},
	{
		file: "packages/jskit/src/parse/parser.ts",
		label: "parser emits it",
		always: true,
		alsoSearch: [
			"packages/jskit/src/parse/parser-expressions.ts",
			"packages/jskit/src/parse/parser-types.ts",
			"packages/jskit/src/parse/parser-jsx.ts",
		],

		/*
		 * Not `alloc(N_Foo)`: the keyword types go through
		 * `parseKeywordType(N_Foo)` and others are passed to a shared helper,
		 * so the test is any mention outside the import list.
		 */
		test: (src, kind) =>
			new RegExp(`\\b${kind}\\b`, "u").test(withoutImports(src)),
	},
	{
		file: "packages/jskit/src/parse/to-ast.ts",
		label: "decoder case",
		always: false,
		note: "only needed when the node carries properties",
		test: (src, kind) => new RegExp(`case ${kind}:`, "u").test(src),
	},
	{
		file: "packages/jskit/src/parse/ast-types.ts",
		label: "type declaration",
		always: true,
		test: (src, kind, type) =>
			new RegExp(`\ttype: "${type}";`, "u").test(src),
	},
	{
		file: "packages/jskit/src/scope/slot-names.ts",
		label: "scope slot names",
		always: false,
		note: "only needed when the node has child slots",
		test: (src, kind) => referencedInDefine(src, kind),
	},
];

/**
 * Strips the import statements from a source file.
 *
 * Every one of these files imports the kind constants it uses, so a bare
 * search for the name matches even when nothing references it.
 * @param src The file's contents.
 * @returns The same source with its `import` statements removed.
 */
function withoutImports(src) {
	return src.replace(/^import [\s\S]*?;$/gmu, "");
}

/**
 * Reports whether a kind appears inside a `define(...)` call rather than only
 * in the import list at the top of the file.
 * @param src The file's contents.
 * @param kind The `N_Foo` constant to look for.
 * @returns `true` when some `define(...)` names the kind.
 */
function referencedInDefine(src, kind) {
	for (const match of src.matchAll(/define\(([\s\S]*?)\)\s*;/gu)) {
		if (new RegExp(`\\b${kind}\\b`, "u").test(match[1])) {
			return true;
		}
	}

	return false;
}

/**
 * Reads a file from the repository.
 * @param path The path, relative to the repository root.
 * @returns The file's contents, or an empty string when it cannot be read.
 */
function read(path) {
	try {
		return readFileSync(new URL(path, ROOT), "utf8");
	} catch {
		return "";
	}
}

/**
 * Collects every node of one type from a tree.
 * @param node The value to search.
 * @param type The `type` string to collect.
 * @param out Where to collect the matches.
 * @returns The matching nodes.
 */
function collect(node, type, out = []) {
	if (Array.isArray(node)) {
		for (const item of node) {
			collect(item, type, out);
		}

		return out;
	}

	if (!node || typeof node !== "object" || typeof node.type !== "string") {
		return out;
	}

	if (node.type === type) {
		out.push(node);
	}

	for (const key of Object.keys(node)) {
		if (key !== "tokens" && key !== "comments" && key !== "parent") {
			collect(node[key], type, out);
		}
	}

	return out;
}

/**
 * Reduces a tree so that two parsers' output can be compared.
 * @param value The value to reduce.
 * @returns The value with unstable and navigational fields removed.
 */
function stable(value) {
	if (value === undefined) {
		return null;
	}

	if (value === null || typeof value !== "object") {
		return typeof value === "bigint" ? `#${value}` : value;
	}

	if (Array.isArray(value)) {
		return value.map(stable);
	}

	const flat = {};

	for (const key of Object.keys(value)) {
		if (["tokens", "comments", "loc", "range", "parent"].includes(key)) {
			continue;
		}

		flat[key] = value[key];
	}

	if (Array.isArray(value.range)) {
		flat.start = value.range[0];
		flat.end = value.range[1];
	}

	const out = {};

	for (const key of Object.keys(flat).sort()) {
		out[key] = stable(flat[key]);
	}

	return out;
}

/*
 * The two entry points do not represent a node the same way -- the binary walk
 * works in node indices and the tree walk in objects -- so the graphs cannot
 * be compared field by field. The scope conformance scripts already solve
 * this, and reusing their serializer keeps this honest with them.
 */
const { serializeBinary, serializeReference, firstDifference } = await import(
	pathToFileURL(new URL("packages/jskit/scripts/scope/serialize.mjs", ROOT).pathname)
);

/** What the JavaScript conformance run compares. */
const JS_FLAGS = { index: true, partial: true, typeRefs: false };

/** What the TypeScript run compares; the binary side needs one adjustment. */
const TS_FLAGS = {
	index: false,
	partial: false,
	typeRefs: true,
	dropLibVariables: true,
};

/**
 * Names the properties of a decoded node that hold children.
 * @param node The decoded node.
 * @returns The property names holding a child node or a list of them.
 */
function childProps(node) {
	return Object.keys(node).filter(key => {
		const value = node[key];

		if (Array.isArray(value)) {
			return value.some(
				item => item && typeof item?.type === "string",
			);
		}

		return value && typeof value === "object" && typeof value.type === "string";
	});
}

const args = process.argv.slice(2);
const type = args.find(arg => !arg.startsWith("--"));
const codeIndex = args.indexOf("--code");
const code = codeIndex === -1 ? null : args[codeIndex + 1];

// `with` and a bare `delete x` are only legal in a script.
const sourceType = args.includes("--script") ? "script" : "module";

if (!type) {
	console.error(
		"usage: node .agents/skills/add-node-type/check-node-kind.mjs <TypeName> [--code '<source>'] [--script]",
	);
	process.exit(2);
}

const kind = `N_${type}`;
let failures = 0;

/** Conditional sites that were absent, keyed by label. */
const absent = new Set();

console.log(`# ${type}\n`);
console.log("## Registration sites\n");

for (const site of SITES) {
	const sources = [site.file, ...(site.alsoSearch ?? [])].map(read);
	const found = sources.some(src => site.test(src, kind, type));

	if (found) {
		console.log(`  ok    ${site.label.padEnd(18)} ${site.file}`);
	} else if (site.always) {
		failures++;
		console.log(`  FAIL  ${site.label.padEnd(18)} ${site.file}`);
	} else {
		absent.add(site.label);
		console.log(
			`  --    ${site.label.padEnd(18)} ${site.file}  (${site.note})`,
		);
	}
}

if (!code) {
	console.log(
		"\nPass --code '<source>' to parse a sample and check the node end to end.",
	);
	process.exit(failures > 0 ? 1 : 0);
}

const jskit = await import(
	pathToFileURL(new URL("packages/jskit/dist/jskit.js", ROOT).pathname)
);

console.log("\n## Round trip\n");

const isTypeScript = type.startsWith("TS");
const dialect = isTypeScript ? "ts" : "js";
let result;

try {
	result = jskit.parse(code, { sourceType });
	console.log("  ok    parse");
} catch (error) {
	console.log(`  FAIL  parse: ${error.message}`);
	process.exit(1);
}

const { ast, errors } = jskit.toAST(result, { sourceType, dialect });
const found = collect(ast, type);

if (found.length === 0) {
	failures++;
	console.log(`  FAIL  decode: no ${type} node in the tree`);
} else {
	console.log(
		`  ok    decode: ${found.length} node(s), keys ${Object.keys(found[0]).join(", ")}`,
	);

	/*
	 * The decoded node settles what the static pass could only guess at. A node
	 * with children needs both slot tables, and a missing `slot-names.ts` entry
	 * is the quiet one: the binary walk keeps working while the tree walk stops
	 * descending, so the two entry points drift apart.
	 */
	const children = childProps(found[0]);

	if (children.length > 0) {
		console.log(`        children: ${children.join(", ")}`);

		for (const label of ["slot layout", "scope slot names"]) {
			if (absent.has(label)) {
				failures++;
				console.log(
					`  FAIL  ${label}: required, because this node has children`,
				);
			}
		}
	}
}

if (errors.length > 0) {
	failures++;
	console.log(`  FAIL  validate (${dialect}): ${errors[0].message}`);
} else {
	console.log(`  ok    validate (${dialect}): no problems`);
}

/*
 * A TypeScript-only kind sits at or above `TS_FIRST`, and `validate()` rejects
 * every one of those under `dialect: "js"`. A kind that is numbered as
 * TypeScript but accepted in JavaScript is in the wrong partition.
 */
if (isTypeScript) {
	const asJs = jskit.toAST(result, { sourceType, dialect: "js" });

	if (asJs.errors.length === 0) {
		failures++;
		console.log(
			"  FAIL  validate (js): accepted, but a TS kind must be rejected",
		);
	} else {
		console.log(`  ok    validate (js): rejected`);
	}
}

const options = { sourceType, dialect };
const flags = isTypeScript ? TS_FLAGS : JS_FLAGS;

try {
	const binary = serializeBinary(
		jskit.toScopeManager(jskit.analyze(result, options), result),
		{
			...flags,
			...(isTypeScript ? { tsProgramExtent: true } : {}),
		},
	);
	const tree = serializeReference(
		jskit.toScopeManager(jskit.analyzeTree(ast, options), ast),
		flags,
	);
	const diff = firstDifference(binary, tree);

	if (diff === null) {
		console.log("  ok    scope: both entry points produce the same graph");
	} else {
		failures++;
		console.log(`  FAIL  scope entry points disagree:\n        ${diff}`);
	}
} catch (error) {
	failures++;
	console.log(`  FAIL  scope analysis threw: ${error.message}`);
}

/*
 * The reference parsers are the actual contract. If the sample parses there
 * too, the node has to match theirs exactly.
 */
console.log("\n## Against the reference parser\n");

try {
	const reference = isTypeScript
		? (await import("@typescript-eslint/parser")).parse(code, {
				sourceType,
				range: true,
				loc: false,
			})
		: (await import("espree")).parse(code, {
				ecmaVersion: "latest",
				sourceType,
				range: true,
				ecmaFeatures: { jsx: true },
			});

	const theirs = collect(reference, type);

	if (theirs.length === 0) {
		console.log(
			`  --    reference parser produces no ${type} for this sample`,
		);
	} else {
		const a = JSON.stringify(stable(theirs[0]));
		const b = JSON.stringify(stable(found[0]));

		if (a === b) {
			console.log("  ok    node matches the reference parser exactly");
		} else {
			failures++;
			console.log(`  FAIL  node differs\n        ref  ${a}\n        ours ${b}`);
		}
	}
} catch (error) {
	console.log(`  --    reference parser cannot parse this sample: ${error.message}`);
}

console.log(
	failures > 0
		? `\n${failures} problem(s). See .agents/skills/add-node-type/SKILL.md`
		: "\nAll checks passed. Now run the corpus checks:\n  npm run conformance --workspace=@eslint/jskit",
);

process.exit(failures > 0 ? 1 : 0);
