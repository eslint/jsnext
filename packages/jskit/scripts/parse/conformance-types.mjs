/**
 * @fileoverview Differential test of `src/ast-types.ts` against the decoder's
 * output.
 *
 * The types are hand-written, so nothing but this stops them drifting from
 * `to-ast.ts`. Every `.js`/`.jsx` file is decoded in `js` mode and every
 * `.ts`/`.tsx` file in `ts` mode, and the properties seen on each node are
 * compared against the ones declared for it, in both directions. Four things
 * are reported:
 *
 * - `MISSING` — a property the decoder emits that nothing declares.
 * - `SHOULD-OPT` — a property declared required that some node lacks.
 * - `SHOULD-REQ` — a property declared optional that every node carries.
 * - `CLAIM` and `NULL` — a value outside what the declared type allows.
 *
 * The corpus cannot reach everything, so the test fixtures and a short list of
 * inline snippets are checked first. A node kind with no declaration is
 * skipped, which is what let this run while the types were being written.
 *
 * `derive-shapes.mjs` is the other half of the check: it reads the decoder's
 * source rather than its output, so it catches what no corpus happens to
 * exercise.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, toAST } from "../../dist/jskit.js";

/** Where the declarations being checked live. */
const TYPES_FILE = new URL("../../src/parse/ast-types.ts", import.meta.url);

/** How many distinct problems to print before giving up. */
const MAX_REPORTED = 25;

/** How many offending files to name per failed value check. */
const MAX_EXAMPLES = 10;

/** How deep an alias may point at another before the search gives up. */
const MAX_ALIAS_DEPTH = 4;

/**
 * The properties `NodeBase` supplies, which no interface repeats and only the
 * ESLint parser fills in.
 */
const POSITION_PROPS = ["range", "loc"];

/**
 * Collects every JavaScript and TypeScript file under a directory.
 * @param dir The directory to walk.
 * @param out Where to collect the paths.
 * @param depth How deep the walk already is.
 * @returns The collected paths.
 */
function walk(dir, out = [], depth = 0) {
	if (depth > 7) {
		return out;
	}

	let entries;

	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}

	for (const name of entries) {
		const full = join(dir, name);
		let stats;

		try {
			stats = statSync(full);
		} catch {
			continue;
		}

		if (stats.isDirectory()) {
			walk(full, out, depth + 1);
		} else if (
			/\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/u.test(name) &&
			stats.size < 400_000
		) {
			out.push(full);
		}
	}

	return out;
}

/**
 * Reports how far a line opens or closes an object type.
 * @param text The line to measure.
 * @returns How many braces it leaves open, negative when it closes more.
 */
function countBraces(text) {
	return (
		(text.match(/\{/gu) ?? []).length - (text.match(/\}/gu) ?? []).length
	);
}

/**
 * The set of values a type allows, when it allows only literals.
 *
 * A property declared `false` or `null` or `"value"` is a claim about every
 * instance, and the whole point of writing it that way is that it can be
 * checked.
 * @param text The declared type, as written.
 * @returns Every value the type permits, or `null` if it permits more than a
 *      fixed set of literals.
 */
function literalsOf(text) {
	const parts = text.split("|").map(part => part.trim());
	const values = [];

	for (const part of parts) {
		if (part === "null") {
			values.push(null);
		} else if (part === "true") {
			values.push(true);
		} else if (part === "false") {
			values.push(false);
		} else if (/^"[^"]*"$/u.test(part)) {
			values.push(part.slice(1, -1));
		} else {
			return null;
		}
	}

	return values;
}

/**
 * Collects the file's type aliases so that a named type can be looked through.
 * @param src The contents of the types file.
 * @returns Each alias name mapped to the type it stands for.
 */
function readAliases(src) {
	const aliases = new Map();

	for (const match of src.matchAll(/export type (\w+) =([^;]+);/gu)) {
		aliases.set(match[1], match[2]);
	}

	return aliases;
}

/**
 * Reports whether a declared type admits `null`.
 *
 * Aliases have to be followed to answer this: `Accessibility` and
 * `JSXAttributeValue` both end in `| null`, so a property typed with either is
 * nullable without saying so itself.
 * @param text The declared type, as written.
 * @param aliases Every alias the file defines.
 * @param depth How many aliases have been followed already.
 * @returns `true` when some spelling of the type is `null`.
 */
function isNullable(text, aliases, depth = 0) {
	if (depth > MAX_ALIAS_DEPTH) {
		return false;
	}

	return text.split("|").some(part => {
		const name = part.trim();

		return (
			name === "null" ||
			(aliases.has(name) &&
				isNullable(aliases.get(name), aliases, depth + 1))
		);
	});
}

/**
 * Reads the declared shape of every node type.
 *
 * Several interfaces can pin the same `type` — `Literal` is split three ways —
 * so each entry holds a list of variants rather than one shape.
 * @returns Each `type` string mapped to the variants declared for it.
 */
function readDeclared() {
	const src = readFileSync(TYPES_FILE, "utf8");
	const aliases = readAliases(src);
	const declared = new Map();

	for (const match of src.matchAll(
		/export interface (\w+) extends NodeBase \{([\s\S]*?)\n\}/gu,
	)) {
		const body = match[2];
		const pinned = body.match(/\n\ttype: "(\w+)";/u);

		if (!pinned) {
			continue;
		}

		/*
		 * Line-based rather than one regular expression, because a property's
		 * type can span lines -- `TemplateElement.value` is an object type
		 * written open. Only one leading tab counts, so nested properties are
		 * skipped along with the braces that hold them.
		 */
		const props = new Map();
		const lines = body.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const start = /^\t(\w+)(\??): (.*)$/u.exec(lines[i]);

			if (!start) {
				continue;
			}

			let text = start[3];
			let depth = countBraces(text);

			while (depth > 0 && i + 1 < lines.length) {
				i++;
				text += ` ${lines[i].trim()}`;
				depth += countBraces(lines[i]);
			}

			const type = text.replace(/;$/u, "");

			props.set(start[1], {
				optional: start[2] === "?",
				literals: literalsOf(type),
				nullable: isNullable(type, aliases),
			});
		}

		for (const key of ["type", "start", "end"]) {
			if (!props.has(key)) {
				props.set(key, {
					optional: false,
					literals: null,
					nullable: false,
				});
			}
		}

		const group = declared.get(pinned[1]) ?? [];

		group.push({ name: match[1], props });
		declared.set(pinned[1], group);
	}

	return declared;
}

const declared = readDeclared();

/** How often each property was seen on each node type, per dialect. */
const stats = { js: new Map(), ts: new Map() };

/** Values that fell outside a type declared as a fixed set of literals. */
const claimBreaks = [];

/** Nulls found where the declared type does not admit one. */
const nullBreaks = [];

/**
 * Checks one node's values against the shape declared for it.
 *
 * A type split across several interfaces has variants that disagree about both
 * of these, so only a single-variant type can be checked this way.
 * @param node The node to check.
 * @param file Where it came from, for the report.
 * @returns Nothing.
 */
function checkValues(node, file) {
	const group = declared.get(node.type);

	if (group?.length !== 1) {
		return;
	}

	for (const [key, { literals, nullable }] of group[0].props) {
		if (!(key in node)) {
			continue;
		}

		if (literals && !literals.includes(node[key])) {
			claimBreaks.push([
				file,
				`${node.type}.${key} claims ${JSON.stringify(literals)}, saw ${JSON.stringify(node[key])}`,
			]);
		}

		if (!nullable && node[key] === null) {
			nullBreaks.push([
				file,
				`${node.type}.${key} is not declared nullable, saw null`,
			]);
		}
	}
}

/**
 * Records every property of every node in one tree.
 * @param ast The `Program` node to walk.
 * @param dialect Which dialect produced it.
 * @param file Where it came from, for the report.
 * @returns Nothing.
 */
function record(ast, dialect, file) {
	const byType = stats[dialect];

	/**
	 * Visits one value, which may be a node, a list, or a leaf.
	 * @param node The value to visit.
	 * @param fromProgram Whether its parent is the `Program` node.
	 * @returns Nothing.
	 */
	const visit = (node, fromProgram) => {
		if (Array.isArray(node)) {
			for (const item of node) {
				visit(item, false);
			}

			return;
		}

		if (
			!node ||
			typeof node !== "object" ||
			typeof node.type !== "string"
		) {
			return;
		}

		const seen = byType.get(node.type) ?? {
			instances: 0,
			props: new Map(),
		};

		seen.instances++;

		for (const key of Object.keys(node)) {
			seen.props.set(key, (seen.props.get(key) ?? 0) + 1);
		}

		byType.set(node.type, seen);
		checkValues(node, file);

		for (const key of Object.keys(node)) {
			// `Program.tokens` and `.comments` hold tokens, which are not nodes.
			if (fromProgram && (key === "tokens" || key === "comments")) {
				continue;
			}

			visit(node[key], false);
		}
	};

	visit(ast, true);
}

let done = 0;
let threw = 0;

/*
 * The corpus reaches almost everything, but not syntax no published package
 * uses: `with`, decorators, `accessor`, import attributes, and every JSX node.
 * Those live in the test fixtures, so they are checked from there.
 */
for (const [name, dialect] of [
	["javascript", "js"],
	["jsx", "js"],
	["typescript", "ts"],
	["tsx", "ts"],
]) {
	const path = new URL(
		`../../tests/parse/fixtures/${name}.json`,
		import.meta.url,
	);
	let snippets;

	try {
		snippets = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		continue;
	}

	for (const [i, code] of snippets.entries()) {
		for (const sourceType of ["module", "script"]) {
			let ast;

			try {
				ast = toAST(parse(code, { sourceType, tokens: true }), {
					sourceType,
					dialect,
				}).ast;
			} catch {
				continue;
			}

			record(ast, dialect, `fixtures/${name}.json#${i}`);
			done++;
		}
	}
}

/*
 * What neither the corpus nor the fixtures reach. These are not in
 * `tests/fixtures` because the conformance tests parse every fixture as a
 * module, and `with` is a syntax error there.
 */
for (const [code, dialect, sourceType] of [
	["with (o) { x; }", "js", "script"],
	['import a from "m" with { type: "json" };', "js", "module"],
	['export * from "n" with { type: "json" };', "js", "module"],
	[
		"const C = class Foo<T> extends B implements I { declare x: number; };",
		"ts",
		"module",
	],
	["abstract class A { abstract accessor x: number; }", "ts", "module"],
	["const a = <T>b;", "ts", "module"],
	["const f = g<string>;", "ts", "module"],
]) {
	let ast;

	try {
		ast = toAST(parse(code, { sourceType, tokens: true }), {
			sourceType,
			dialect,
		}).ast;
	} catch {
		threw++;
		continue;
	}

	record(ast, dialect, `inline: ${code}`);
	done++;
}

const files = walk(process.argv[2] ?? "../../node_modules").slice(
	0,
	Number(process.argv[3] ?? 400),
);

for (const file of files) {
	const dialect = /\.(ts|mts|cts|tsx)$/u.test(file) ? "ts" : "js";
	let code;

	try {
		code = readFileSync(file, "utf8");
	} catch {
		continue;
	}

	let ast;

	try {
		ast = toAST(parse(code, { sourceType: "module", tokens: true }), {
			sourceType: "module",
			dialect,
		}).ast;
	} catch {
		threw++;
		continue;
	}

	record(ast, dialect, file);
	done++;
}

const problems = [];

/*
 * A declared property no file happened to produce. Not a defect on its own --
 * a TypeScript-only property is absent from every `.js` file by design, so
 * this only means the corpus never reached it -- but a name that stays here
 * after a wide run is usually a typo.
 */
const unseen = [];

for (const [type, group] of declared) {
	const union = new Set(group.flatMap(variant => [...variant.props.keys()]));
	const everSeen = new Set();

	for (const dialect of ["js", "ts"]) {
		const seen = stats[dialect].get(type);

		if (!seen) {
			continue;
		}

		for (const key of seen.props.keys()) {
			everSeen.add(key);

			if (!union.has(key)) {
				problems.push(
					`MISSING    ${type}.${key} emitted in ${dialect}, not declared`,
				);
			}
		}

		/*
		 * A `type` shared by several interfaces is a union split on a property
		 * only one variant carries, so an instance missing it may simply
		 * belong to a sibling. Presence is still checked above.
		 */
		if (group.length > 1) {
			continue;
		}

		for (const [key, { optional }] of group[0].props) {
			if (POSITION_PROPS.includes(key)) {
				continue;
			}

			const count = seen.props.get(key) ?? 0;

			if (!optional && count < seen.instances) {
				problems.push(
					`SHOULD-OPT ${type}.${key} declared required, on ${count}/${seen.instances} in ${dialect}`,
				);
			}
		}
	}

	/*
	 * An optional property is justified when some instance somewhere lacks it.
	 * Checking that per dialect would be wrong in both directions: a
	 * TypeScript-only property is on every node in `ts`, and the two
	 * properties `espree` puts on a `JSXOpeningFragment` are on every node in
	 * `js`. Only a property present on every instance of a type that appears
	 * in both dialects is really required.
	 */
	if (group.length === 1 && stats.js.has(type) && stats.ts.has(type)) {
		for (const [key, { optional }] of group[0].props) {
			if (!optional || POSITION_PROPS.includes(key)) {
				continue;
			}

			const always = ["js", "ts"].every(dialect => {
				const seen = stats[dialect].get(type);

				return (seen.props.get(key) ?? 0) === seen.instances;
			});

			if (always) {
				problems.push(
					`SHOULD-REQ ${type}.${key} declared optional, present on every instance in both dialects`,
				);
			}
		}
	}

	for (const key of union) {
		if (POSITION_PROPS.includes(key)) {
			continue;
		}

		if (everSeen.size > 0 && !everSeen.has(key)) {
			unseen.push(`${type}.${key}`);
		}
	}
}

for (const [file, message] of claimBreaks.slice(0, MAX_EXAMPLES)) {
	problems.push(`CLAIM      ${message} (${file})`);
}

for (const [file, message] of nullBreaks.slice(0, MAX_EXAMPLES)) {
	problems.push(`NULL       ${message} (${file})`);
}

const kinds = [...declared.keys()];
const exercised = kinds.filter(
	type => stats.js.has(type) || stats.ts.has(type),
);

console.log(
	`files=${done} threw=${threw} kinds=${kinds.length} ` +
		`exercised=${exercised.length} problems=${problems.length} ` +
		`unseen=${unseen.length}`,
);

const reported = new Set();

for (const problem of problems) {
	if (reported.has(problem)) {
		continue;
	}

	reported.add(problem);
	console.log(problem);

	if (reported.size > MAX_REPORTED) {
		break;
	}
}

const missed = kinds.filter(type => !stats.js.has(type) && !stats.ts.has(type));

if (missed.length > 0) {
	console.log(`kinds not exercised: ${missed.join(", ")}`);
}

if (unseen.length > 0) {
	console.log(`properties not exercised: ${unseen.join(", ")}`);
}
