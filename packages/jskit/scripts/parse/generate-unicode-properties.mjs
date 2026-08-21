/**
 * @fileoverview Regenerates `src/unicode-properties.ts` from test262.
 *
 * `\p{…}` names the parser must accept are a fact about the Unicode Character
 * Database, not a decision, so they are derived rather than written by hand.
 * The source is test262's `built-ins/RegExp/property-escapes/generated/`
 * directory: one file per property, machine-generated from the UCD by
 * <https://github.com/mathiasbynens/unicode-property-escapes-tests>, and every
 * spelling the specification accepts — long name, short alias, and value
 * alias — appears literally in a `\p{…}` in it.
 *
 * Deriving from that directory rather than from the UCD directly means the
 * table agrees with the corpus the parser is graded against by construction.
 * The 163 files under `property-escapes/` are the reason this exists.
 *
 *     node scripts/generate-unicode-properties.mjs ../../test262
 *
 * The written file is committed. Rerun this when test262 moves to a new
 * Unicode version, and commit the result with the baseline.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the generated table is written. */
const OUTPUT = new URL(
	"../../src/parse/unicode-properties.ts",
	import.meta.url,
);

/**
 * Every `\p{…}` and `\P{…}` in a test file, captured whole.
 *
 * Held to the grammar's own character set — `UnicodePropertyNameCharacters`
 * are letters and `_`, and a value adds the digits — so that a `\p{…}` written
 * in a prose comment is not mistaken for a property.
 */
const ESCAPE_PATTERN = /\\[pP]\{(\w+(?:=\w+)?)\}/gu;

/**
 * Collects every property escape written in a directory of tests.
 * @param dir The directory to read.
 * @returns The contents of every `\p{…}` found, deduplicated.
 */
function escapesIn(dir) {
	const found = new Set();

	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".js")) {
			continue;
		}

		const text = readFileSync(join(dir, name), "utf8");

		for (const [, body] of text.matchAll(ESCAPE_PATTERN)) {
			found.add(body);
		}
	}

	return found;
}

/**
 * Splits a set of escapes into the lone names and the name/value pairs.
 * @param escapes The escape bodies to split.
 * @returns The lone names, and value sets by property name.
 */
function partition(escapes) {
	const lone = new Set();
	const byName = new Map();

	for (const body of escapes) {
		const equals = body.indexOf("=");

		if (equals === -1) {
			lone.add(body);
			continue;
		}

		const name = body.slice(0, equals);
		const value = body.slice(equals + 1);

		if (!byName.has(name)) {
			byName.set(name, new Set());
		}

		byName.get(name).add(value);
	}

	return { lone, byName };
}

/**
 * Renders one table as a source-level declaration.
 *
 * The names are stored as one space-separated string and split at load, which
 * is both smaller in the bundle and faster to build than an array literal of
 * several hundred short strings.
 * @param name The constant to declare.
 * @param doc The doc comment body.
 * @param values The names the table holds.
 * @returns The declaration, as TypeScript source.
 */
function table(name, doc, values) {
	const sorted = [...values].sort();
	const lines = [];
	let line = "";

	for (const value of sorted) {
		if (line.length + value.length + 1 > 68) {
			lines.push(line);
			line = "";
		}

		line += (line === "" ? "" : " ") + value;
	}

	if (line !== "") {
		lines.push(line);
	}

	const body = lines
		.map((text, index) => (index === lines.length - 1 ? text : `${text} `))
		.map(text => `\t\t"${text}"`)
		.join(" +\n");

	return `/**\n * ${doc}\n */\nexport const ${name} = /* @__PURE__ */ new Set(\n\t(\n${body}\n\t).split(" "),\n);\n`;
}

const root = process.argv[2] ?? "./test262";
const generated = join(
	root,
	"test/built-ins/RegExp/property-escapes/generated",
);

const all = escapesIn(generated);
const strings = escapesIn(join(generated, "strings"));

// The `strings/` tests use the string properties and nothing else.
for (const body of strings) {
	all.delete(body);
}

const { lone, byName } = partition(all);
const scripts = new Set([
	...(byName.get("Script") ?? []),
	...(byName.get("sc") ?? []),
	...(byName.get("Script_Extensions") ?? []),
	...(byName.get("scx") ?? []),
]);
const categories = new Set([
	...(byName.get("General_Category") ?? []),
	...(byName.get("gc") ?? []),
]);

/*
 * A lone name is either a binary property or a General_Category value —
 * `\p{Lu}` and `\p{Alphabetic}` are both legal — so what is left after the
 * category values are removed is the binary properties.
 */
const binary = new Set([...lone].filter(name => !categories.has(name)));

/*
 * Advisory only. A property added in a Unicode version newer than the host's
 * ICU is still one the parser must accept, so a miss here is reported and
 * kept rather than dropped.
 */
let unknown = 0;

for (const body of [...all, ...strings]) {
	try {
		void new RegExp(`\\p{${body}}`, strings.has(body) ? "v" : "u");
	} catch {
		unknown++;
	}
}

const header = `/**
 * @fileoverview Unicode property names and values that \`\\p{…}\` may name.
 *
 * **Generated by \`scripts/generate-unicode-properties.mjs\`. Do not edit.**
 * Derived from test262's \`built-ins/RegExp/property-escapes/generated/\`,
 * which is itself generated from the Unicode Character Database.
 *
 * Every spelling the specification accepts is here, long and short: \`Script\`
 * and \`sc\`, \`Uppercase_Letter\` and \`Lu\`. A name absent from these tables is
 * an early error, so a table that falls behind the corpus rejects valid
 * patterns — which is why it is derived rather than maintained.
 */

`;

const source =
	header +
	table(
		"BINARY_PROPERTIES",
		"Binary property names, which `\\p{…}` may name on their own.",
		binary,
	) +
	"\n" +
	table(
		"BINARY_PROPERTIES_OF_STRINGS",
		"Binary properties that match strings rather than single code points.\n *\n * Legal only under the `v` flag, and only unnegated: a property that can\n * match a sequence has no complement, so `\\P{RGI_Emoji}` and\n * `[^\\p{RGI_Emoji}]` are both early errors.",
		strings,
	) +
	"\n" +
	table(
		"GENERAL_CATEGORY_VALUES",
		"Values of `General_Category`, which may also be written on their own.",
		categories,
	) +
	"\n" +
	table(
		"SCRIPT_VALUES",
		"Values of `Script` and `Script_Extensions`.",
		scripts,
	);

writeFileSync(OUTPUT, source);

console.log(
	`binary=${binary.size} strings=${strings.size} categories=${categories.size} scripts=${scripts.size} unknown-to-host=${unknown}`,
);
