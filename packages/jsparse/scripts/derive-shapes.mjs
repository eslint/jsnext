/**
 * @fileoverview Checks `src/ast-types.ts` against the decoder's source.
 *
 * `conformance-types.mjs` checks the declarations against what the decoder
 * *emits*, which leaves it at the mercy of the corpus: a property nothing
 * happens to produce is a property nothing checks. This reads `to-ast.ts`
 * instead, with jsparse itself, so coverage is not a question.
 *
 * The decoder is regular enough to read mechanically: a case label names the
 * kind and the body assigns properties, either directly or through one of a
 * handful of helpers. A `Program` picks up three more in `buildAst()`, which
 * is why `api.ts` is read too.
 *
 * What cannot be read this way is which node types belong in a slot —
 * `this.node(a)` says a child goes there, not which children — so the unions
 * in `ast-types.ts` are written by hand and checked by neither script.
 *
 *     node scripts/derive-shapes.mjs          compare against ast-types.ts
 *     node scripts/derive-shapes.mjs --list   print shapes not yet declared
 */

import { readFileSync } from "node:fs";
import { parse, toAST, NODE_KIND_NAMES } from "../dist/jsparse.js";

/** Where the parser's sources live. */
const SRC = new URL("../src/", import.meta.url);

/**
 * The helpers the decoder calls instead of assigning directly.
 *
 * Each writes a property that `js` mode leaves off entirely, so everything
 * they contribute is optional.
 */
const HELPERS = {
	addOptional: call => [
		[call.arguments[1].value, { optional: true, kind: "node" }],
	],
	addListIfPresent: call => [
		[call.arguments[1].value, { optional: true, kind: "node[]" }],
	],
	addKind: call => [
		[call.arguments[1].value, { optional: true, kind: "string union" }],
	],
	addTypeMembers: () => [
		["typeParameters", { optional: true, kind: "node" }],
		["returnType", { optional: true, kind: "node" }],
	],
	addPatternModifiers: () => [
		["decorators", { optional: true, kind: "node[]" }],
		["optional", { optional: true, kind: "boolean" }],
	],
};

/** Constructs the reader could not account for, named for the report. */
const irregular = new Set();

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
	return toAST(parse(code, { sourceType: "module" }), {
		sourceType: "module",
		dialect: "ts",
	}).ast;
}

const toAstSource = read("to-ast.ts");
const toAstTree = treeOf(toAstSource);

/** Each `N_Foo` constant mapped to the kind number it stands for. */
const kindNumbers = new Map();

for (const match of read("node-kinds.ts").matchAll(
	/^export const (N_\w+) = (\d+);/gmu,
)) {
	kindNumbers.set(match[1], Number(match[2]));
}

/**
 * Resolves a kind constant to the ESTree `type` it produces.
 * @param id The name of the constant, such as `N_Program`.
 * @returns The `type` string, or `null` when the name is not a kind or the
 *      kind number is unassigned.
 */
function typeOf(id) {
	return NODE_KIND_NAMES[kindNumbers.get(id)] || null;
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
 * Finds a method of a class by name.
 * @param tree The tree to search.
 * @param name The method's name.
 * @returns The `MethodDefinition` node, or `undefined` when there is none.
 */
function method(tree, name) {
	return find(
		tree,
		node => node.type === "MethodDefinition" && node.key.name === name,
	)[0];
}

/**
 * Describes the value an assignment produces, from the expression alone.
 *
 * This is as far as reading the source gets: a slot holding a child can be
 * told from one holding a flag, but not which children the slot admits.
 * @param expr The assigned expression.
 * @param source The source the expression was parsed from.
 * @returns A short description of the value's type.
 */
function valueKind(expr, source) {
	const text = source.slice(expr.start, expr.end);

	if (/^this\.node\(/u.test(text)) {
		return "node";
	}

	if (/^this\.list\(/u.test(text)) {
		return "node[]";
	}

	if (/!==\s*0$/u.test(text) || /^\(flags &/u.test(text)) {
		return "boolean";
	}

	if (/^(true|false|null|\[\])$/u.test(text)) {
		return `= ${text}`;
	}

	if (/_NAMES\[/u.test(text)) {
		return "string union";
	}

	if (/^this\.accessibility\(/u.test(text)) {
		return "Accessibility";
	}

	if (/^this\.operator\(/u.test(text)) {
		return "operator union";
	}

	if (/^this\.identifierName\(/u.test(text)) {
		return "string";
	}

	return "unknown";
}

/**
 * Reads a `kind === N_Foo` test.
 * @param test The condition to inspect.
 * @returns The `type` the test pins, or `null` when it is some other test.
 */
function kindTest(test) {
	if (test.type !== "BinaryExpression" || test.left.name !== "kind") {
		return null;
	}

	return typeOf(test.right.name);
}

/**
 * Reads a computed property name of the form `node[kind === N_Foo ? a : b]`.
 * @param key The computed key expression.
 * @returns The name for the pinned kind and the name for the rest of the
 *      group, or `null` when the key has some other shape.
 */
function conditionalName(key) {
	if (key.type !== "ConditionalExpression") {
		return null;
	}

	const pinned = kindTest(key.test);

	if (
		!pinned ||
		key.consequent.type !== "Literal" ||
		key.alternate.type !== "Literal"
	) {
		return null;
	}

	return {
		pinned,
		whenPinned: key.consequent.value,
		otherwise: key.alternate.value,
	};
}

/**
 * Pulls the properties one case body assigns.
 *
 * A property is optional unless it is assigned unconditionally, which turns
 * out to cover every reason one can be absent: the `dialect: "js"` guards, the
 * `espree`-only guard on a fragment's attributes, a flag test such as the one
 * on a directive, and the helpers that write only when there is something to
 * write. The one condition that does *not* make a property optional is
 * `kind === N_Foo`, which picks which kind gets it rather than whether it
 * appears.
 * @param statements The statements of the case body.
 * @param source The source they were parsed from.
 * @returns Each property name paired with what was learned about it.
 */
function propsOf(statements, source) {
	const props = [];

	/**
	 * Reads a run of statements, carrying down what their position implies.
	 * @param nodes The statements to read.
	 * @param optional Whether a condition already governs them.
	 * @param kindGuard Which kind they are restricted to, if any.
	 * @returns Nothing.
	 */
	const scan = (nodes, optional, kindGuard) => {
		for (const stmt of nodes) {
			if (!stmt) {
				continue;
			}

			if (stmt.type === "IfStatement") {
				const pinned = kindTest(stmt.test);
				const branchOptional = optional || pinned === null;
				const body =
					stmt.consequent.type === "BlockStatement"
						? stmt.consequent.body
						: [stmt.consequent];

				scan(body, branchOptional, pinned ?? kindGuard);

				if (stmt.alternate) {
					const alternate =
						stmt.alternate.type === "BlockStatement"
							? stmt.alternate.body
							: [stmt.alternate];

					scan(alternate, true, kindGuard);
				}

				continue;
			}

			if (stmt.type === "BlockStatement") {
				scan(stmt.body, optional, kindGuard);
				continue;
			}

			/*
			 * Only `fillLiteral` holds one, and each of its branches is a
			 * variant of the same node type, so nothing it writes is certain.
			 */
			if (stmt.type === "SwitchStatement") {
				for (const branch of stmt.cases) {
					scan(branch.consequent, true, kindGuard);
				}

				continue;
			}

			if (stmt.type !== "ExpressionStatement") {
				continue;
			}

			const expr = stmt.expression;

			if (
				expr.type === "AssignmentExpression" &&
				expr.left.type === "MemberExpression" &&
				expr.left.object.name === "node"
			) {
				const kind = valueKind(expr.right, source);

				if (!expr.left.computed) {
					props.push([
						expr.left.property.name,
						{ optional, kindGuard, kind },
					]);
					continue;
				}

				const names = conditionalName(expr.left.property);

				if (names) {
					props.push([
						names.whenPinned,
						{ optional, kindGuard: names.pinned, kind },
					]);
					props.push([
						names.otherwise,
						{ optional, kindNot: names.pinned, kind },
					]);
				} else {
					irregular.add("computed property name");
				}

				continue;
			}

			if (
				expr.type === "CallExpression" &&
				expr.callee.type === "MemberExpression" &&
				expr.callee.object.type === "ThisExpression"
			) {
				const name = expr.callee.property.name;

				if (HELPERS[name]) {
					for (const [prop, info] of HELPERS[name](expr)) {
						props.push([prop, { ...info, kindGuard }]);
					}
				} else if (name === "fillLiteral") {
					props.push(
						...propsOf(
							method(toAstTree, "fillLiteral").value.body.body,
							source,
						),
					);
				} else if (name !== "fillTypeNode") {
					irregular.add(`helper ${name}`);
				}
			}
		}
	};

	scan(statements, false, null);

	return props;
}

/**
 * Walks one switch, mapping each case label to the properties it fills.
 *
 * Case labels stack up until a body is reached, so that kinds sharing one body
 * all receive its properties.
 * @param node The `SwitchStatement` to read.
 * @param source The source it was parsed from.
 * @param into Where to collect each type's shape.
 * @returns Nothing.
 */
function readSwitch(node, source, into) {
	let pending = [];

	for (const branch of node.cases) {
		if (branch.test) {
			pending.push(branch.test.name);
		}

		if (branch.consequent.length === 0) {
			continue;
		}

		const props = propsOf(branch.consequent, source);

		for (const id of pending) {
			const type = typeOf(id);

			if (!type) {
				continue;
			}

			const shape = into.get(type) ?? new Map();

			for (const [name, info] of props) {
				if (info.kindGuard && info.kindGuard !== type) {
					continue;
				}

				if (info.kindNot && info.kindNot === type) {
					continue;
				}

				shape.set(name, info);
			}

			into.set(type, shape);
		}

		pending = [];
	}
}

/**
 * Adds the properties `buildAst()` puts on a `Program` after decoding.
 *
 * Only that function knows the source type and the token stream, so the
 * decoder cannot have written them.
 * @param shape The `Program` shape derived from the decoder.
 * @returns The same shape with the three late properties added.
 */
function addProgramExtras(shape) {
	const source = read("api.ts");
	const buildAst = find(
		treeOf(source),
		node =>
			node.type === "FunctionDeclaration" && node.id?.name === "buildAst",
	)[0];

	const assignments = find(
		buildAst,
		node =>
			node.type === "AssignmentExpression" &&
			node.left.type === "MemberExpression" &&
			node.left.object.name === "program" &&
			!node.left.computed,
	);

	for (const assignment of assignments) {
		const name = assignment.left.property.name;

		// The rest of what it restamps is position, which `NodeBase` supplies.
		if (["start", "end", "range", "loc"].includes(name)) {
			continue;
		}

		shape.set(name, {
			optional: false,
			kind: valueKind(assignment.right, source),
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
 * @param shape What the decoder was read to assign, or `undefined` when it
 *      assigns nothing.
 * @returns A description of the disagreement, or `null` when they agree.
 */
function compare(type, declaration, shape) {
	const { variants, props } = declaration;

	if (!shape) {
		/*
		 * A kind with no case of its own falls through to the `default:` in
		 * `fillTypeNode` and is left with nothing but its position, which is
		 * exactly what a keyword type such as `TSStringKeyword` should be.
		 * Deriving nothing and declaring nothing agree.
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

const derived = new Map();

for (const name of ["fill", "fillTypeNode"]) {
	readSwitch(
		find(method(toAstTree, name), node => node.type === "SwitchStatement")[0],
		toAstSource,
		derived,
	);
}

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

	console.log(
		`irregular constructs: ${[...irregular].join(", ") || "(none)"}`,
	);
}
