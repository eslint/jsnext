/**
 * @fileoverview Generates `src/parse/to-ast-decode.ts` from the shape schema.
 *
 * The decoder is generated rather than written because speed here is a
 * property of the code's *shape*: each node kind gets its own function that
 * builds the whole ESTree node as a single object literal, so V8 gives every
 * kind one hidden class and never replays the property-by-property map
 * transitions a shared `fill()` switch forces. That takes four variants —
 * `js`/`ts` dialect, each with and without `range`/`loc` — and nobody should
 * hand-maintain four copies of 170 node kinds. This is the same trade
 * `oxc-parser` makes in its generated `deserialize/*.js` files.
 *
 *     node scripts/parse/generate-to-ast.mjs
 *
 * or `npm run build:to-ast`, which also formats the output. The schema in
 * `to-ast-shapes.mjs` is the file to edit; `derive-shapes.mjs` checks it
 * against `ast-types.ts`, and the conformance suite checks the emitted trees
 * against the reference parsers.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { SHAPES } from "./to-ast-shapes.mjs";

/** Where the parser's sources live. */
const SRC = new URL("../../src/parse/", import.meta.url);

/** Where the generated decoder is written. */
const OUT = new URL("to-ast-decode.ts", SRC);

/** The word offset each slot letter names. */
const SLOT_WORDS = {
	A: "NODE_A",
	B: "NODE_B",
	C: "NODE_C",
	D: "NODE_D",
	E: "NODE_E",
	F: "NODE_F",
	G: "NODE_G",
};

/** Each node kind name mapped to its kind number, read from the source. */
const kindNumbers = new Map();

for (const match of readFileSync(
	new URL("node-kinds.ts", SRC),
	"utf8",
).matchAll(/^export const N_(\w+) = (\d+);/gmu)) {
	kindNumbers.set(match[1], Number(match[2]));
}

const kindCount = Math.max(...kindNumbers.values()) + 1;

for (const name of Object.keys(SHAPES)) {
	if (!kindNumbers.has(name)) {
		throw new Error(`schema entry ${name} is not a node kind`);
	}
}

/**
 * The `type`, `start`, `end` head every node begins with, plus the position
 * properties of the ESLint variants.
 * @param name The node type name, or `null` to read it from the record.
 * @param loc Whether the variant carries `range` and `loc`.
 * @returns The lines of the literal's head.
 */
function head(name, loc) {
	const lines = [
		name === null
			? `\t\ttype: NODE_KIND_NAMES[w[pos + NODE_KIND]],`
			: `\t\ttype: "${name}",`,
		"\t\tstart,",
		"\t\tend,",
	];

	if (loc) {
		lines.push("\t\trange: [start, end],", "\t\tloc: locOf(start, end),");
	}

	return lines;
}

/**
 * Renders the expression a spec's property holds in the literal.
 * @param spec The property spec.
 * @param typescript Whether the `ts` dialect is being generated.
 * @param use Records which record words the expression reads.
 * @returns The expression, or `null` when the property is written after the
 *      literal instead.
 */
function valueOf(spec, typescript, use) {
	const slot = spec.slot ? spec.slot.toLowerCase() : null;

	if (slot) {
		use.add(spec.slot);
	}

	switch (spec.op) {
		case "child":
			return `node(${slot})`;

		case "children":
			return `list(${slot})`;

		case "optChild":
			if (!typescript) {
				return null;
			}

			return `${slot} === 0 ? null : node(${slot})`;

		case "optChildren":
			if (!typescript) {
				return null;
			}

			return `list(${slot})`;

		case "flag":
			use.add("flags");
			return `(flags & ${spec.flag}) !== 0`;

		case "constant":
			return spec.value;

		case "operator":
			return `operator(${slot})`;

		case "mkind":
			use.add("flags");
			return "MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT]";

		case "methodKind":
			use.add("flags");
			return '(flags & MKIND_MASK) === 0 ? "method" : MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT]';

		case "declKind":
			use.add("flags");
			return "DECL_KIND_NAMES[(flags & DECL_MASK) >>> DECL_SHIFT]";

		case "moduleKind":
			use.add("flags");
			return "MODULE_KIND_NAMES[(flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT]";

		case "moduleGlobal":
			use.add("flags");
			return "((flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT) === MODULE_GLOBAL";

		case "accessibility":
			use.add("flags");
			return "ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT]";

		case "typeOnly":
			use.add("flags");
			return '(flags & NF_TYPE_ONLY) !== 0 ? "type" : "value"';

		case "eq1":
			return `${slot} === 1`;

		case "identifierName":
			use.add("A");
			return "identifierName(start, end, a)";

		case "privateName":
			use.add("A");
			return "identifierName(start, end, a).slice(1)";

		case "rawText":
			return "source.slice(start, end)";

		default:
			throw new Error(`unknown op ${spec.op}`);
	}
}

/**
 * Renders the statement a `js`-mode conditional property is written by.
 * @param spec The property spec.
 * @returns The statement's lines.
 */
function postAddOf(spec) {
	const slot = spec.slot.toLowerCase();
	const make = spec.op === "optChild" ? "node" : "list";

	return [
		`\tif (${slot} !== 0) {`,
		`\t\tn.${spec.p} = ${make}(${slot});`,
		"\t}",
	];
}

/**
 * Renders the `const` hoists a body needs.
 * @param use The record words the body reads.
 * @returns The lines declaring them.
 */
function hoists(use) {
	const lines = [
		"\tconst w = words;",
		"\tconst start = w[pos + NODE_START];",
		"\tconst end = w[pos + NODE_END];",
	];

	if (use.has("flags")) {
		lines.push("\tconst flags = w[pos + NODE_FLAGS];");
	}

	for (const slot of Object.keys(SLOT_WORDS)) {
		if (use.has(slot)) {
			lines.push(
				`\tconst ${slot.toLowerCase()} = w[pos + ${SLOT_WORDS[slot]}];`,
			);
		}
	}

	return lines;
}

/**
 * Renders the body of one generated decoder.
 * @param name The node type name, or `null` for the shared bare decoder.
 * @param specs The property specs, or `null` for the bare decoder.
 * @param typescript Whether the `ts` dialect is being generated.
 * @param loc Whether the variant carries `range` and `loc`.
 * @returns The function body's lines.
 */
function bodyOf(name, specs, typescript, loc) {
	const use = new Set();
	const props = [];
	const posts = [];

	for (const spec of specs ?? []) {
		if ((spec.ts && !typescript) || (spec.js && typescript)) {
			continue;
		}

		const value = valueOf(spec, typescript, use);

		if (value === null) {
			use.add(spec.slot);
			posts.push(...postAddOf(spec));
		} else {
			props.push(`\t\t${spec.p}: ${value},`);
		}
	}

	const literal = [...head(name, loc), ...props];

	if (posts.length === 0) {
		return [...hoists(use), "\treturn {", ...literal, "\t};"];
	}

	return [
		...hoists(use),
		"\tconst n: EsNode = {",
		...literal,
		"\t};",
		...posts,
		"\treturn n;",
	];
}

/** The bodies of the kinds no operation vocabulary describes. */
const CUSTOM = {
	/**
	 * A literal's `value` depends on its subtype, and two subtypes carry an
	 * extra property, so each branch is its own literal — and its own shape.
	 * @param loc Whether the variant carries `range` and `loc`.
	 * @returns The function body's lines.
	 */
	Literal(loc) {
		const h = head("Literal", loc).join("\n\t");

		return `	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const raw = source.slice(start, end);

	switch (w[pos + NODE_A]) {
		case LIT_STRING:
			return {
			${h}
				raw,
				value: decodeEscapes(raw.slice(1, -1), false),
			};

		case LIT_NUMBER:
			return {
			${h}
				raw,
				value: decodeNumber(raw),
			};

		case LIT_BOOLEAN:
			return {
			${h}
				raw,
				value: raw === "true",
			};

		case LIT_JSX_STRING:
			/*
			 * A JSX attribute value has no escape sequences; the only thing
			 * that resolves is an entity reference.
			 */
			return {
			${h}
				raw,
				value: decodeEntities(raw.slice(1, -1)),
			};

		case LIT_BIGINT: {
			/*
			 * \`bigint\` is the value written in decimal, whatever base the
			 * source used, which is what both reference parsers report.
			 */
			const value = BigInt(raw.slice(0, -1).replace(/_/gu, ""));

			return {
			${h}
				raw,
				value,
				bigint: String(value),
			};
		}

		case LIT_REGEXP: {
			const patternEnd = w[pos + NODE_B];
			const pattern = source.slice(start + 1, patternEnd);
			const flagText = source.slice(patternEnd + 1, end);
			let value: unknown = null;

			try {
				value = new RegExp(pattern, flagText);
			} catch {
				// A pattern the host cannot compile is reported as \`null\`,
				// which is what other ESTree parsers do.
			}

			return {
			${h}
				raw,
				regex: { pattern, flags: flagText },
				value,
			};
		}

		default:
			return {
			${h}
				raw,
				value: null,
			};
	}`.split("\n");
	},

	/**
	 * A template element's extent is its quasi, while its cooked text spans
	 * the slots.
	 * @param loc Whether the variant carries `range` and `loc`.
	 * @returns The function body's lines.
	 */
	TemplateElement(loc) {
		return `	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const raw = source.slice(w[pos + NODE_A], w[pos + NODE_B]);

	return {
	${head("TemplateElement", loc).join("\n\t")}
		value: {
			raw,
			cooked:
				(flags & NF_INVALID_ESCAPE) !== 0
					? null
					: decodeEscapes(raw, true),
		},
		tail: (flags & NF_TAIL) !== 0,
	};`.split("\n");
	},

	/**
	 * An expression statement reports the directive it states, which only the
	 * `ts` dialect spells out as `null` when there is none.
	 * @param loc Whether the variant carries `range` and `loc`.
	 * @param typescript Whether the `ts` dialect is being generated.
	 * @returns The function body's lines.
	 */
	ExpressionStatement(loc, typescript) {
		const shared = `	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];`;

		if (typescript) {
			return `${shared}

	return {
	${head("ExpressionStatement", loc).join("\n\t")}
		expression: node(a),
		directive: b === 1 ? directiveOf(a) : null,
	};`.split("\n");
		}

		return `${shared}
	const n: EsNode = {
	${head("ExpressionStatement", loc).join("\n\t")}
		expression: node(a),
	};

	if (b === 1) {
		n.directive = directiveOf(a);
	}

	return n;`.split("\n");
	},

	/**
	 * JSX text is reported with its entity references resolved.
	 * @param loc Whether the variant carries `range` and `loc`.
	 * @returns The function body's lines.
	 */
	JSXText(loc) {
		return `	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const raw = source.slice(start, end);

	return {
	${head("JSXText", loc).join("\n\t")}
		value: decodeEntities(raw),
		raw,
	};`.split("\n");
	},

	/**
	 * A mapped type flattens its type parameter record into `key` and
	 * `constraint`, and reports its modifiers as `true`, a sign, or absence.
	 * @param loc Whether the variant carries `range` and `loc`.
	 * @returns The function body's lines.
	 */
	TSMappedType(loc) {
		return `	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const tp = nodesBase + w[pos + NODE_A] * nodeWords;

	return {
	${head("TSMappedType", loc).join("\n\t")}
		key: node(w[tp + NODE_A]),
		constraint: node(w[tp + NODE_B]),
		nameType: node(w[pos + NODE_C]),
		typeAnnotation: node(w[pos + NODE_D]),
		optional: mappedModifier(w[pos + NODE_E]) ?? false,
		readonly: mappedModifier(w[pos + NODE_F]) ?? null,
	};`.split("\n");
	},
};

/** The four variants, in the order the tables are emitted. */
const VARIANTS = [
	{ table: "DECODE_JS", typescript: false, loc: false, suffix: "_js" },
	{ table: "DECODE_TS", typescript: true, loc: false, suffix: "_ts" },
	{ table: "DECODE_JS_LOC", typescript: false, loc: true, suffix: "_jsL" },
	{ table: "DECODE_TS_LOC", typescript: true, loc: true, suffix: "_tsL" },
];

/** Every emitted function, in emission order. */
const functions = [];

/** Each emitted body mapped to the name of the function holding it. */
const byBody = new Map();

/**
 * Emits a decoder function, reusing an earlier one with the same body.
 * @param preferredName The name to use if the body is new.
 * @param body The function body's lines.
 * @returns The name of the function holding the body.
 */
function emit(preferredName, body) {
	const text = body.join("\n");
	const existing = byBody.get(text);

	if (existing) {
		return existing;
	}

	functions.push(
		`function ${preferredName}(pos: number): EsNode {\n${text}\n}`,
	);
	byBody.set(text, preferredName);

	return preferredName;
}

// The shared fallback for kinds that carry nothing but their extent.
const bareNames = {};

for (const variant of VARIANTS) {
	bareNames[variant.suffix] = emit(
		`bare${variant.loc ? "L" : ""}`,
		bodyOf(null, null, variant.typescript, variant.loc),
	);
}

/** The table entries, one array of names per variant. */
const tables = new Map(VARIANTS.map(v => [v.table, []]));

for (let kind = 0; kind < kindCount; kind++) {
	let name = null;

	for (const [n, number] of kindNumbers) {
		if (number === kind) {
			name = n;
		}
	}

	for (const variant of VARIANTS) {
		const entries = tables.get(variant.table);

		if (name === null || name === "NONE") {
			entries.push(bareNames[variant.suffix]);
			continue;
		}

		const shape = SHAPES[name];

		if (shape === undefined) {
			entries.push(bareNames[variant.suffix]);
			continue;
		}

		const body = shape.custom
			? CUSTOM[name](variant.loc, variant.typescript)
			: bodyOf(name, shape, variant.typescript, variant.loc);

		entries.push(emit(`${name}${variant.suffix}`, body));
	}
}

/** The generated code so far, for deciding which imports it needs. */
const generated = functions.join("\n\n");

/**
 * Keeps only the names the generated code actually references.
 * @param names The candidate import names.
 * @returns The names in use, in the given order.
 */
function used(names) {
	return names.filter(name =>
		new RegExp(`\\b${name}\\b`, "u").test(generated),
	);
}

const kindImports = used([
	"ACCESSIBILITY_NAMES",
	"ACCESS_MASK",
	"ACCESS_SHIFT",
	"DECL_KIND_NAMES",
	"DECL_MASK",
	"DECL_SHIFT",
	"LIT_BIGINT",
	"LIT_BOOLEAN",
	"LIT_JSX_STRING",
	"LIT_NUMBER",
	"LIT_REGEXP",
	"LIT_STRING",
	"MKIND_MASK",
	"MKIND_NAMES",
	"MKIND_SHIFT",
	"MODULE_GLOBAL",
	"MODULE_KIND_MASK",
	"MODULE_KIND_NAMES",
	"MODULE_KIND_SHIFT",
	...Object.keys(SHAPES)
		.flatMap(name =>
			SHAPES[name].custom ? [] : SHAPES[name].map(spec => spec.flag),
		)
		.filter(Boolean)
		.concat(["NF_INVALID_ESCAPE", "NF_TAIL", "NF_TYPE_ONLY"])
		.sort(),
	"NODE_A",
	"NODE_B",
	"NODE_C",
	"NODE_D",
	"NODE_E",
	"NODE_F",
	"NODE_G",
	"NODE_END",
	"NODE_FLAGS",
	"NODE_KIND",
	"NODE_KIND_NAMES",
	"NODE_START",
]).filter((name, index, all) => all.indexOf(name) === index);

const helperImports = used([
	"directiveOf",
	"identifierName",
	"list",
	"locOf",
	"mappedModifier",
	"node",
	"nodeWords",
	"nodesBase",
	"operator",
	"source",
	"words",
]);

const valueImports = used(["decodeEscapes", "decodeNumber"]);
const entityImports = used(["decodeEntities"]);

const header = `/**
 * @fileoverview The generated decoders behind \`toAST()\`.
 *
 * GENERATED CODE — DO NOT EDIT. \`scripts/parse/to-ast-shapes.mjs\` is the
 * source of truth and \`npm run build:to-ast\` rewrites this file from it.
 *
 * Each node kind decodes through its own function so that every kind builds
 * its ESTree node as one object literal — one hidden class per kind, no
 * property-by-property shape transitions. The four tables are the four
 * outputs \`toAST()\` and the ESLint parser ask for: each dialect, with and
 * without \`range\`/\`loc\`. Kinds whose shape is identical across variants
 * share one function, which is why some carry no suffix.
 */

import {
${kindImports.map(name => `\t${name},`).join("\n")}
} from "./node-kinds.js";
import {
${helperImports.map(name => `\t${name},`).join("\n")}
	type EsNode,
} from "./to-ast.js";
${valueImports.length > 0 ? `import { ${valueImports.join(", ")} } from "./values.js";\n` : ""}${entityImports.length > 0 ? `import { ${entityImports.join(", ")} } from "./entities.js";\n` : ""}
/** A generated decoder: one node record in, one ESTree node out. */
export type Decoder = (pos: number) => EsNode;
`;

const tableCode = VARIANTS.map(variant => {
	const entries = tables.get(variant.table);

	return `/** ${variant.typescript ? "`ts`" : "`js`"} dialect${variant.loc ? ", with `range` and `loc`" : ""}. */
export const DECODE${variant.table.slice("DECODE".length)}: readonly Decoder[] = [
${entries.map(name => `\t${name},`).join("\n")}
];`;
}).join("\n\n");

writeFileSync(OUT, `${header}\n${generated}\n\n${tableCode}\n`);

console.log(
	`to-ast-decode.ts: ${functions.length} decoders, ${kindCount} kinds, 4 tables`,
);
