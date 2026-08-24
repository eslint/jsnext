/**
 * @fileoverview Checks `src/ast-types.ts` against the decoder's schema.
 *
 * `conformance-types.mjs` checks the declarations against what the decoder
 * *emits*, which leaves it at the mercy of the corpus: a property nothing
 * happens to produce is a property nothing checks. This reads
 * `to-ast-shapes.mjs` instead — the schema `to-ast-decode.ts` is generated
 * from — so coverage is not a question: every property of every kind is
 * compared, in both directions.
 *
 * What the schema cannot say is which node types belong in a slot —
 * `child("test", "A")` says a child goes there, not which children — so the
 * unions in `ast-types.ts` are written by hand and checked by neither script.
 *
 * A `Program` picks up three more properties in `buildAst()`, which is why
 * `api.ts` is still read with the parser itself.
 *
 *     node scripts/derive-shapes.mjs          compare against ast-types.ts
 *     node scripts/derive-shapes.mjs --list   print shapes not yet declared
 */

import { readFileSync } from "node:fs";
import { parse, toAST } from "../../dist/jskit.js";
import { SHAPES } from "./to-ast-shapes.mjs";

/** Where the parser's sources live. */
const SRC = new URL("../../src/parse/", import.meta.url);

/** The value kind each schema operation produces, in this report's terms. */
const OP_KINDS = {
	child: "node",
	optChild: "node",
	children: "node[]",
	optChildren: "node[]",
	flag: "boolean",
	eq1: "boolean",
	moduleGlobal: "boolean",
	operator: "operator union",
	mkind: "string union",
	methodKind: "string union",
	declKind: "string union",
	moduleKind: "string union",
	typeOnly: "string union",
	accessibility: "Accessibility",
	identifierName: "string",
	privateName: "string",
	rawText: "string",
};

/**
 * Reads one of the parser's source files.
 * @param name The file name, relative to `src/`.
 * @returns The file's contents.
 * @throws {Error} When the file cannot be read.
 */
function read(name) {
	return readFileSync(new URL(name, SRC), "utf8");
}

/**
 * Parses TypeScript source with the parser this script is checking.
 * @param code The source to parse.
 * @returns The `Program` node.
 * @throws {ParseError} When the source cannot be parsed.
 */
function treeOf(code) {
	return toAST(parse(code, { sourceType: "module", tokens: true }), {
		sourceType: "module",
		dialect: "ts",
	});
}

/**
 * Collects every node in a tree that a predicate accepts.
 * @param node The value to search, which may be a node, a list, or a leaf.
 * @param pred Decides whether a node belongs in the result.
 * @param out Where to collect the matches.
 * @returns The matching nodes, outermost first.
 */
function find(node, pred, out = []) {
	if (Array.isArray(node)) {
		for (const item of node) {
			find(item, pred, out);
		}

		return out;
	}

	if (!node || typeof node !== "object" || typeof node.type !== "string") {
		return out;
	}

	if (pred(node)) {
		out.push(node);
	}

	for (const key of Object.keys(node)) {
		if (key !== "tokens" && key !== "comments") {
			find(node[key], pred, out);
		}
	}

	return out;
}

/**
 * Derives each node type's shape from the schema.
 *
 * A property is optional when some decode leaves it off, which the schema
 * states directly: the `ts`/`js` dialect restrictions and the `opt*`
 * operations are the ways a property can be absent, and a `custom` entry
 * declares what its generator-held body emits.
 * @returns Each `type` string mapped to its properties.
 */
function deriveShapes() {
	const derived = new Map();

	for (const [type, entry] of Object.entries(SHAPES)) {
		const shape = new Map();

		if (entry.custom) {
			for (const { p, kind, optional } of entry.shape) {
				shape.set(p, { optional, kind });
			}
		} else {
			for (const spec of entry) {
				shape.set(spec.p, {
					optional:
						Boolean(spec.ts || spec.js) ||
						spec.op === "optChild" ||
						spec.op === "optChildren",
					kind:
						spec.op === "constant"
							? `= ${spec.value}`
							: (OP_KINDS[spec.op] ?? "unknown"),
				});
			}
		}

		derived.set(type, shape);
	}

	return derived;
}

/**
 * Adds the properties `buildAst()` puts on a `Program` after decoding.
 *
 * Only that function knows the source type and the token stream, so the
 * decoder cannot have written them.
 * @param shape The `Program` shape derived from the schema.
 * @returns The same shape with the three late properties added.
 */
function addProgramExtras(shape) {
	const source = read("api.ts");
	const buildAst = find(
		treeOf(source),
		node =>
			node.type === "FunctionDeclaration" && node.id?.name === "buildAst",
	)[0];

	const isProgramAssignment = node =>
		node.type === "AssignmentExpression" &&
		node.left.type === "MemberExpression" &&
		node.left.object.name === "program" &&
		!node.left.computed;
	const assignments = find(buildAst, isProgramAssignment);

	// An assignment behind a condition — the token and comment lists, which
	// only a token-carrying buffer gets — declares an optional property.
	const conditional = new Set(
		find(buildAst, node => node.type === "IfStatement").flatMap(branch =>
			find(branch, isProgramAssignment),
		),
	);

	for (const assignment of assignments) {
		const name = assignment.left.property.name;

		// The rest of what it restamps is position, which `NodeBase` supplies.
		if (["start", "end", "range", "loc"].includes(name)) {
			continue;
		}

		shape.set(name, {
			optional: conditional.has(assignment),
			kind: "unknown",
		});
	}

	return shape;
}

/**
 * Reads what `ast-types.ts` declares, keyed by the `type` each interface pins.
 * @returns Each `type` string mapped to how many interfaces declare it and the
 *      properties they declare between them.
 */
function readDeclared() {
	const src = read("ast-types.ts");
	const declared = new Map();

	for (const match of src.matchAll(
		/export interface (\w+) extends NodeBase \{([\s\S]*?)\n\}/gu,
	)) {
		const pinned = match[2].match(/\n\ttype: "(\w+)";/u);

		if (!pinned) {
			continue;
		}

		const entry = declared.get(pinned[1]) ?? {
			variants: 0,
			props: new Map(),
		};

		entry.variants++;

		for (const prop of match[2].matchAll(/\n\t(\w+)(\??): /gu)) {
			if (prop[1] !== "type") {
				entry.props.set(prop[1], prop[2] === "?");
			}
		}

		declared.set(pinned[1], entry);
	}

	return declared;
}

/**
 * Compares one declared shape against the derived one.
 * @param type The `type` string being compared.
 * @param declaration How many interfaces declare it and what they declare.
 * @param shape What the schema says the decoder emits, or `undefined` when it
 *      emits nothing.
 * @returns A description of the disagreement, or `null` when they agree.
 */
function compare(type, declaration, shape) {
	const { variants, props } = declaration;

	if (!shape) {
		/*
		 * A kind with no schema entry decodes to nothing but its position,
		 * which is exactly what a keyword type such as `TSStringKeyword`
		 * should be. Deriving nothing and declaring nothing agree.
		 */
		return props.size === 0 ? null : `${type}: nothing derived`;
	}

	const missing = [...props.keys()].filter(key => !shape.has(key));
	const extra = [...shape.keys()].filter(key => !props.has(key));

	/*
	 * A type split across several interfaces is a union whose variants each
	 * require a property the others lack, so only the names can be compared.
	 */
	const optionality =
		variants > 1
			? []
			: [...shape]
					.filter(
						([key, info]) =>
							props.has(key) &&
							props.get(key) !== Boolean(info.optional),
					)
					.map(([key]) => key);

	if (
		missing.length === 0 &&
		extra.length === 0 &&
		optionality.length === 0
	) {
		return null;
	}

	const parts = [];

	if (missing.length > 0) {
		parts.push(` missing ${missing.join(",")}`);
	}

	if (extra.length > 0) {
		parts.push(` extra ${extra.join(",")}`);
	}

	if (optionality.length > 0) {
		parts.push(` optionality ${optionality.join(",")}`);
	}

	return `${type}:${parts.join("")}`;
}

const derived = deriveShapes();

derived.set("Program", addProgramExtras(derived.get("Program") ?? new Map()));

const declared = readDeclared();
const diffs = [];
let agree = 0;

for (const [type, declaration] of declared) {
	const diff = compare(type, declaration, derived.get(type));

	if (diff === null) {
		agree++;
	} else {
		diffs.push(diff);
	}
}

const undeclared = [...derived.keys()]
	.filter(type => !declared.has(type))
	.sort();

if (process.argv.includes("--list")) {
	console.log(`${undeclared.length} node types derived but not declared:\n`);

	for (const type of undeclared) {
		console.log(type);

		for (const [name, info] of derived.get(type)) {
			console.log(`\t${name}${info.optional ? "?" : ""}: ${info.kind}`);
		}

		console.log();
	}
} else {
	console.log(
		`derived=${derived.size} declared=${declared.size} ` +
			`identical=${agree} differ=${diffs.length} ` +
			`undeclared=${undeclared.length}`,
	);

	for (const diff of diffs) {
		console.log(`  ${diff}`);
	}
}
