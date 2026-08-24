/**
 * @fileoverview The generated decoders behind `toAST()`.
 *
 * GENERATED CODE — DO NOT EDIT. `scripts/parse/to-ast-shapes.mjs` is the
 * source of truth and `npm run build:to-ast` rewrites this file from it.
 *
 * Each node kind decodes through its own function so that every kind builds
 * its ESTree node as one object literal — one hidden class per kind, no
 * property-by-property shape transitions. The four tables are the four
 * outputs `toAST()` and the ESLint parser ask for: each dialect, with and
 * without `range`/`loc`. Kinds whose shape is identical across variants
 * share one function, which is why some carry no suffix.
 */

import {
	ACCESSIBILITY_NAMES,
	ACCESS_MASK,
	ACCESS_SHIFT,
	DECL_KIND_NAMES,
	DECL_MASK,
	DECL_SHIFT,
	LIT_BIGINT,
	LIT_BOOLEAN,
	LIT_JSX_STRING,
	LIT_NUMBER,
	LIT_REGEXP,
	LIT_STRING,
	MKIND_MASK,
	MKIND_NAMES,
	MKIND_SHIFT,
	MODULE_GLOBAL,
	MODULE_KIND_MASK,
	MODULE_KIND_NAMES,
	MODULE_KIND_SHIFT,
	NF_ABSTRACT,
	NF_ASYNC,
	NF_COMPUTED,
	NF_CONST,
	NF_DECLARE,
	NF_DEFINITE,
	NF_DELEGATE,
	NF_EXPRESSION_BODY,
	NF_GENERATOR,
	NF_IN,
	NF_INVALID_ESCAPE,
	NF_METHOD,
	NF_OPTIONAL,
	NF_OVERRIDE,
	NF_PREFIX,
	NF_READONLY,
	NF_SELF_CLOSING,
	NF_SHORTHAND,
	NF_STATIC,
	NF_TAIL,
	NF_TYPE_ONLY,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_F,
	NODE_G,
	NODE_END,
	NODE_FLAGS,
	NODE_KIND,
	NODE_KIND_NAMES,
	NODE_START,
} from "./node-kinds.js";
import {
	directiveOf,
	identifierName,
	list,
	locOf,
	mappedModifier,
	node,
	nodeWords,
	nodesBase,
	operator,
	source,
	words,
	type EsNode,
} from "./to-ast.js";
import { decodeEscapes, decodeNumber } from "./values.js";
import { decodeEntities } from "./entities.js";

/** A generated decoder: one node record in, one ESTree node out. */
export type Decoder = (pos: number) => EsNode;

function bare(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: NODE_KIND_NAMES[w[pos + NODE_KIND]],
		start,
		end,
	};
}

function bareL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: NODE_KIND_NAMES[w[pos + NODE_KIND]],
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
	};
}

function Program_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "Program",
		start,
		end,
		body: list(a),
	};
}

function Program_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "Program",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: list(a),
	};
}

function Identifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "Identifier",
		start,
		end,
		name: identifierName(start, end, a),
	};
}

function Identifier_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "Identifier",
		start,
		end,
		name: identifierName(start, end, a),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
		typeAnnotation: node(b),
	};
}

function Identifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "Identifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: identifierName(start, end, a),
	};
}

function Identifier_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "Identifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: identifierName(start, end, a),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
		typeAnnotation: node(b),
	};
}

function PrivateIdentifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "PrivateIdentifier",
		start,
		end,
		name: identifierName(start, end, a).slice(1),
	};
}

function PrivateIdentifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "PrivateIdentifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: identifierName(start, end, a).slice(1),
	};
}

function Literal_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const raw = source.slice(start, end);

	switch (w[pos + NODE_A]) {
		case LIT_STRING:
			return {
				type: "Literal",
				start,
				end,
				raw,
				value: decodeEscapes(raw.slice(1, -1), false),
			};

		case LIT_NUMBER:
			return {
				type: "Literal",
				start,
				end,
				raw,
				value: decodeNumber(raw),
			};

		case LIT_BOOLEAN:
			return {
				type: "Literal",
				start,
				end,
				raw,
				value: raw === "true",
			};

		case LIT_JSX_STRING:
			/*
			 * A JSX attribute value has no escape sequences; the only thing
			 * that resolves is an entity reference.
			 */
			return {
				type: "Literal",
				start,
				end,
				raw,
				value: decodeEntities(raw.slice(1, -1)),
			};

		case LIT_BIGINT: {
			/*
			 * `bigint` is the value written in decimal, whatever base the
			 * source used, which is what both reference parsers report.
			 */
			const value = BigInt(raw.slice(0, -1).replace(/_/gu, ""));

			return {
				type: "Literal",
				start,
				end,
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
				// A pattern the host cannot compile is reported as `null`,
				// which is what other ESTree parsers do.
			}

			return {
				type: "Literal",
				start,
				end,
				raw,
				regex: { pattern, flags: flagText },
				value,
			};
		}

		default:
			return {
				type: "Literal",
				start,
				end,
				raw,
				value: null,
			};
	}
}

function Literal_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const raw = source.slice(start, end);

	switch (w[pos + NODE_A]) {
		case LIT_STRING:
			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
				raw,
				value: decodeEscapes(raw.slice(1, -1), false),
			};

		case LIT_NUMBER:
			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
				raw,
				value: decodeNumber(raw),
			};

		case LIT_BOOLEAN:
			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
				raw,
				value: raw === "true",
			};

		case LIT_JSX_STRING:
			/*
			 * A JSX attribute value has no escape sequences; the only thing
			 * that resolves is an entity reference.
			 */
			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
				raw,
				value: decodeEntities(raw.slice(1, -1)),
			};

		case LIT_BIGINT: {
			/*
			 * `bigint` is the value written in decimal, whatever base the
			 * source used, which is what both reference parsers report.
			 */
			const value = BigInt(raw.slice(0, -1).replace(/_/gu, ""));

			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
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
				// A pattern the host cannot compile is reported as `null`,
				// which is what other ESTree parsers do.
			}

			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
				raw,
				regex: { pattern, flags: flagText },
				value,
			};
		}

		default:
			return {
				type: "Literal",
				start,
				end,
				range: [start, end],
				loc: locOf(start, end),
				raw,
				value: null,
			};
	}
}

function TemplateLiteral_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TemplateLiteral",
		start,
		end,
		quasis: list(a),
		expressions: list(b),
	};
}

function TemplateLiteral_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TemplateLiteral",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		quasis: list(a),
		expressions: list(b),
	};
}

function TemplateElement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const raw = source.slice(w[pos + NODE_A], w[pos + NODE_B]);

	return {
		type: "TemplateElement",
		start,
		end,
		value: {
			raw,
			cooked:
				(flags & NF_INVALID_ESCAPE) !== 0
					? null
					: decodeEscapes(raw, true),
		},
		tail: (flags & NF_TAIL) !== 0,
	};
}

function TemplateElement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const raw = source.slice(w[pos + NODE_A], w[pos + NODE_B]);

	return {
		type: "TemplateElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		value: {
			raw,
			cooked:
				(flags & NF_INVALID_ESCAPE) !== 0
					? null
					: decodeEscapes(raw, true),
		},
		tail: (flags & NF_TAIL) !== 0,
	};
}

function TaggedTemplateExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TaggedTemplateExpression",
		start,
		end,
		tag: node(a),
		quasi: node(b),
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function TaggedTemplateExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TaggedTemplateExpression",
		start,
		end,
		tag: node(a),
		quasi: node(b),
		typeArguments: c === 0 ? null : node(c),
	};
}

function TaggedTemplateExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TaggedTemplateExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		tag: node(a),
		quasi: node(b),
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function TaggedTemplateExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TaggedTemplateExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		tag: node(a),
		quasi: node(b),
		typeArguments: c === 0 ? null : node(c),
	};
}

function ExpressionStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "ExpressionStatement",
		start,
		end,
		expression: node(a),
	};

	if (b === 1) {
		n.directive = directiveOf(a);
	}

	return n;
}

function ExpressionStatement_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];

	return {
		type: "ExpressionStatement",
		start,
		end,
		expression: node(a),
		directive: b === 1 ? directiveOf(a) : null,
	};
}

function ExpressionStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "ExpressionStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};

	if (b === 1) {
		n.directive = directiveOf(a);
	}

	return n;
}

function ExpressionStatement_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];

	return {
		type: "ExpressionStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
		directive: b === 1 ? directiveOf(a) : null,
	};
}

function BlockStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "BlockStatement",
		start,
		end,
		body: list(a),
	};
}

function BlockStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "BlockStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: list(a),
	};
}

function StaticBlock_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "StaticBlock",
		start,
		end,
		body: list(a),
	};
}

function StaticBlock_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "StaticBlock",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: list(a),
	};
}

function WithStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "WithStatement",
		start,
		end,
		object: node(a),
		body: node(b),
	};
}

function WithStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "WithStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		object: node(a),
		body: node(b),
	};
}

function ReturnStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ReturnStatement",
		start,
		end,
		argument: node(a),
	};
}

function ReturnStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ReturnStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
	};
}

function LabeledStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "LabeledStatement",
		start,
		end,
		label: node(a),
		body: node(b),
	};
}

function LabeledStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "LabeledStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		label: node(a),
		body: node(b),
	};
}

function BreakStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "BreakStatement",
		start,
		end,
		label: node(a),
	};
}

function BreakStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "BreakStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		label: node(a),
	};
}

function ContinueStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ContinueStatement",
		start,
		end,
		label: node(a),
	};
}

function ContinueStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ContinueStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		label: node(a),
	};
}

function IfStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "IfStatement",
		start,
		end,
		test: node(a),
		consequent: node(b),
		alternate: node(c),
	};
}

function IfStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "IfStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		test: node(a),
		consequent: node(b),
		alternate: node(c),
	};
}

function SwitchStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "SwitchStatement",
		start,
		end,
		discriminant: node(a),
		cases: list(b),
	};
}

function SwitchStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "SwitchStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		discriminant: node(a),
		cases: list(b),
	};
}

function SwitchCase_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "SwitchCase",
		start,
		end,
		test: node(a),
		consequent: list(b),
	};
}

function SwitchCase_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "SwitchCase",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		test: node(a),
		consequent: list(b),
	};
}

function ThrowStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ThrowStatement",
		start,
		end,
		argument: node(a),
	};
}

function ThrowStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ThrowStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
	};
}

function TryStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TryStatement",
		start,
		end,
		block: node(a),
		handler: node(b),
		finalizer: node(c),
	};
}

function TryStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TryStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		block: node(a),
		handler: node(b),
		finalizer: node(c),
	};
}

function CatchClause_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "CatchClause",
		start,
		end,
		param: node(a),
		body: node(b),
	};
}

function CatchClause_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "CatchClause",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		param: node(a),
		body: node(b),
	};
}

function WhileStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "WhileStatement",
		start,
		end,
		test: node(a),
		body: node(b),
	};
}

function WhileStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "WhileStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		test: node(a),
		body: node(b),
	};
}

function DoWhileStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "DoWhileStatement",
		start,
		end,
		body: node(a),
		test: node(b),
	};
}

function DoWhileStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "DoWhileStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: node(a),
		test: node(b),
	};
}

function ForStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "ForStatement",
		start,
		end,
		init: node(a),
		test: node(b),
		update: node(c),
		body: node(d),
	};
}

function ForStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "ForStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		init: node(a),
		test: node(b),
		update: node(c),
		body: node(d),
	};
}

function ForInStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ForInStatement",
		start,
		end,
		left: node(a),
		right: node(b),
		body: node(c),
	};
}

function ForInStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ForInStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		left: node(a),
		right: node(b),
		body: node(c),
	};
}

function ForOfStatement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ForOfStatement",
		start,
		end,
		left: node(a),
		right: node(b),
		body: node(c),
		await: (flags & NF_ASYNC) !== 0,
	};
}

function ForOfStatement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ForOfStatement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		left: node(a),
		right: node(b),
		body: node(c),
		await: (flags & NF_ASYNC) !== 0,
	};
}

function VariableDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	return {
		type: "VariableDeclaration",
		start,
		end,
		declarations: list(a),
		kind: DECL_KIND_NAMES[(flags & DECL_MASK) >>> DECL_SHIFT],
	};
}

function VariableDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	return {
		type: "VariableDeclaration",
		start,
		end,
		declarations: list(a),
		kind: DECL_KIND_NAMES[(flags & DECL_MASK) >>> DECL_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function VariableDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	return {
		type: "VariableDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		declarations: list(a),
		kind: DECL_KIND_NAMES[(flags & DECL_MASK) >>> DECL_SHIFT],
	};
}

function VariableDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	return {
		type: "VariableDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		declarations: list(a),
		kind: DECL_KIND_NAMES[(flags & DECL_MASK) >>> DECL_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function VariableDeclarator_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "VariableDeclarator",
		start,
		end,
		id: node(a),
		init: node(b),
	};
}

function VariableDeclarator_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "VariableDeclarator",
		start,
		end,
		id: node(a),
		init: node(b),
		definite: (flags & NF_DEFINITE) !== 0,
	};
}

function VariableDeclarator_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "VariableDeclarator",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		init: node(b),
	};
}

function VariableDeclarator_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "VariableDeclarator",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		init: node(b),
		definite: (flags & NF_DEFINITE) !== 0,
	};
}

function FunctionDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "FunctionDeclaration",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function FunctionDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "FunctionDeclaration",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function FunctionDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "FunctionDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function FunctionDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "FunctionDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function FunctionExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "FunctionExpression",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function FunctionExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "FunctionExpression",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function FunctionExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "FunctionExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function FunctionExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "FunctionExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function ArrowFunctionExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "ArrowFunctionExpression",
		start,
		end,
		id: null,
		params: list(b),
		body: node(c),
		async: (flags & NF_ASYNC) !== 0,
		expression: (flags & NF_EXPRESSION_BODY) !== 0,
		generator: false,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function ArrowFunctionExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "ArrowFunctionExpression",
		start,
		end,
		id: null,
		params: list(b),
		body: node(c),
		async: (flags & NF_ASYNC) !== 0,
		expression: (flags & NF_EXPRESSION_BODY) !== 0,
		generator: false,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
	};
}

function ArrowFunctionExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "ArrowFunctionExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: null,
		params: list(b),
		body: node(c),
		async: (flags & NF_ASYNC) !== 0,
		expression: (flags & NF_EXPRESSION_BODY) !== 0,
		generator: false,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function ArrowFunctionExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "ArrowFunctionExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: null,
		params: list(b),
		body: node(c),
		async: (flags & NF_ASYNC) !== 0,
		expression: (flags & NF_EXPRESSION_BODY) !== 0,
		generator: false,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
	};
}

function ClassDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	const n: EsNode = {
		type: "ClassDeclaration",
		start,
		end,
		id: node(a),
		superClass: node(b),
		body: node(c),
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.superTypeArguments = node(e);
	}
	if (f !== 0) {
		n.implements = list(f);
	}
	if (g !== 0) {
		n.decorators = list(g);
	}
	return n;
}

function ClassDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	return {
		type: "ClassDeclaration",
		start,
		end,
		id: node(a),
		superClass: node(b),
		body: node(c),
		typeParameters: d === 0 ? null : node(d),
		superTypeArguments: e === 0 ? null : node(e),
		implements: list(f),
		decorators: list(g),
		abstract: (flags & NF_ABSTRACT) !== 0,
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function ClassDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	const n: EsNode = {
		type: "ClassDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		superClass: node(b),
		body: node(c),
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.superTypeArguments = node(e);
	}
	if (f !== 0) {
		n.implements = list(f);
	}
	if (g !== 0) {
		n.decorators = list(g);
	}
	return n;
}

function ClassDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	return {
		type: "ClassDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		superClass: node(b),
		body: node(c),
		typeParameters: d === 0 ? null : node(d),
		superTypeArguments: e === 0 ? null : node(e),
		implements: list(f),
		decorators: list(g),
		abstract: (flags & NF_ABSTRACT) !== 0,
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function ClassExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	const n: EsNode = {
		type: "ClassExpression",
		start,
		end,
		id: node(a),
		superClass: node(b),
		body: node(c),
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.superTypeArguments = node(e);
	}
	if (f !== 0) {
		n.implements = list(f);
	}
	if (g !== 0) {
		n.decorators = list(g);
	}
	return n;
}

function ClassExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	return {
		type: "ClassExpression",
		start,
		end,
		id: node(a),
		superClass: node(b),
		body: node(c),
		typeParameters: d === 0 ? null : node(d),
		superTypeArguments: e === 0 ? null : node(e),
		implements: list(f),
		decorators: list(g),
		abstract: (flags & NF_ABSTRACT) !== 0,
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function ClassExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	const n: EsNode = {
		type: "ClassExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		superClass: node(b),
		body: node(c),
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.superTypeArguments = node(e);
	}
	if (f !== 0) {
		n.implements = list(f);
	}
	if (g !== 0) {
		n.decorators = list(g);
	}
	return n;
}

function ClassExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const f = w[pos + NODE_F];
	const g = w[pos + NODE_G];
	return {
		type: "ClassExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		superClass: node(b),
		body: node(c),
		typeParameters: d === 0 ? null : node(d),
		superTypeArguments: e === 0 ? null : node(e),
		implements: list(f),
		decorators: list(g),
		abstract: (flags & NF_ABSTRACT) !== 0,
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function ClassBody_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ClassBody",
		start,
		end,
		body: list(a),
	};
}

function ClassBody_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ClassBody",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: list(a),
	};
}

function MethodDefinition_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "MethodDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	return n;
}

function MethodDefinition_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "MethodDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
	};
}

function MethodDefinition_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "MethodDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	return n;
}

function MethodDefinition_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "MethodDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
	};
}

function PropertyDefinition_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "PropertyDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function PropertyDefinition_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "PropertyDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function PropertyDefinition_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "PropertyDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function PropertyDefinition_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "PropertyDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function AccessorProperty_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "AccessorProperty",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function AccessorProperty_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "AccessorProperty",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function AccessorProperty_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "AccessorProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function AccessorProperty_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "AccessorProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function ArrayExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ArrayExpression",
		start,
		end,
		elements: list(a),
	};
}

function ArrayExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ArrayExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		elements: list(a),
	};
}

function ObjectExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ObjectExpression",
		start,
		end,
		properties: list(a),
	};
}

function ObjectExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ObjectExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		properties: list(a),
	};
}

function Property_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "Property",
		start,
		end,
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		method: (flags & NF_METHOD) !== 0,
		shorthand: (flags & NF_SHORTHAND) !== 0,
	};
}

function Property_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "Property",
		start,
		end,
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		method: (flags & NF_METHOD) !== 0,
		shorthand: (flags & NF_SHORTHAND) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function Property_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "Property",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		method: (flags & NF_METHOD) !== 0,
		shorthand: (flags & NF_SHORTHAND) !== 0,
	};
}

function Property_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "Property",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		method: (flags & NF_METHOD) !== 0,
		shorthand: (flags & NF_SHORTHAND) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function SequenceExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "SequenceExpression",
		start,
		end,
		expressions: list(a),
	};
}

function SequenceExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "SequenceExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expressions: list(a),
	};
}

function UnaryExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "UnaryExpression",
		start,
		end,
		operator: operator(b),
		prefix: (flags & NF_PREFIX) !== 0,
		argument: node(a),
	};
}

function UnaryExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "UnaryExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		operator: operator(b),
		prefix: (flags & NF_PREFIX) !== 0,
		argument: node(a),
	};
}

function UpdateExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "UpdateExpression",
		start,
		end,
		operator: operator(b),
		prefix: (flags & NF_PREFIX) !== 0,
		argument: node(a),
	};
}

function UpdateExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "UpdateExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		operator: operator(b),
		prefix: (flags & NF_PREFIX) !== 0,
		argument: node(a),
	};
}

function BinaryExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "BinaryExpression",
		start,
		end,
		operator: operator(c),
		left: node(a),
		right: node(b),
	};
}

function BinaryExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "BinaryExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		operator: operator(c),
		left: node(a),
		right: node(b),
	};
}

function AssignmentExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "AssignmentExpression",
		start,
		end,
		operator: operator(c),
		left: node(a),
		right: node(b),
	};
}

function AssignmentExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "AssignmentExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		operator: operator(c),
		left: node(a),
		right: node(b),
	};
}

function LogicalExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "LogicalExpression",
		start,
		end,
		operator: operator(c),
		left: node(a),
		right: node(b),
	};
}

function LogicalExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "LogicalExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		operator: operator(c),
		left: node(a),
		right: node(b),
	};
}

function ConditionalExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ConditionalExpression",
		start,
		end,
		test: node(a),
		consequent: node(b),
		alternate: node(c),
	};
}

function ConditionalExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ConditionalExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		test: node(a),
		consequent: node(b),
		alternate: node(c),
	};
}

function CallExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "CallExpression",
		start,
		end,
		callee: node(a),
		arguments: list(b),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function CallExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "CallExpression",
		start,
		end,
		callee: node(a),
		arguments: list(b),
		optional: (flags & NF_OPTIONAL) !== 0,
		typeArguments: c === 0 ? null : node(c),
	};
}

function CallExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "CallExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		callee: node(a),
		arguments: list(b),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function CallExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "CallExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		callee: node(a),
		arguments: list(b),
		optional: (flags & NF_OPTIONAL) !== 0,
		typeArguments: c === 0 ? null : node(c),
	};
}

function NewExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "NewExpression",
		start,
		end,
		callee: node(a),
		arguments: list(b),
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function NewExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "NewExpression",
		start,
		end,
		callee: node(a),
		arguments: list(b),
		typeArguments: c === 0 ? null : node(c),
	};
}

function NewExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "NewExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		callee: node(a),
		arguments: list(b),
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function NewExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "NewExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		callee: node(a),
		arguments: list(b),
		typeArguments: c === 0 ? null : node(c),
	};
}

function MemberExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "MemberExpression",
		start,
		end,
		object: node(a),
		property: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function MemberExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "MemberExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		object: node(a),
		property: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function YieldExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	return {
		type: "YieldExpression",
		start,
		end,
		delegate: (flags & NF_DELEGATE) !== 0,
		argument: node(a),
	};
}

function YieldExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	return {
		type: "YieldExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		delegate: (flags & NF_DELEGATE) !== 0,
		argument: node(a),
	};
}

function AwaitExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "AwaitExpression",
		start,
		end,
		argument: node(a),
	};
}

function AwaitExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "AwaitExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
	};
}

function ImportExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportExpression",
		start,
		end,
		source: node(a),
		options: node(b),
	};
}

function ImportExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		source: node(a),
		options: node(b),
	};
}

function ChainExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ChainExpression",
		start,
		end,
		expression: node(a),
	};
}

function ChainExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ChainExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function MetaProperty_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "MetaProperty",
		start,
		end,
		meta: node(a),
		property: node(b),
	};
}

function MetaProperty_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "MetaProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		meta: node(a),
		property: node(b),
	};
}

function SpreadElement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "SpreadElement",
		start,
		end,
		argument: node(a),
	};
}

function SpreadElement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "SpreadElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
	};
}

function RestElement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "RestElement",
		start,
		end,
		argument: node(a),
	};
	if (b !== 0) {
		n.typeAnnotation = node(b);
	}
	return n;
}

function RestElement_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "RestElement",
		start,
		end,
		argument: node(a),
		typeAnnotation: b === 0 ? null : node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
		value: null,
	};
}

function RestElement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "RestElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
	};
	if (b !== 0) {
		n.typeAnnotation = node(b);
	}
	return n;
}

function RestElement_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "RestElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
		typeAnnotation: b === 0 ? null : node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
		value: null,
	};
}

function AssignmentPattern_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "AssignmentPattern",
		start,
		end,
		left: node(a),
		right: node(b),
	};
}

function AssignmentPattern_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "AssignmentPattern",
		start,
		end,
		left: node(a),
		right: node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
		typeAnnotation: null,
	};
}

function AssignmentPattern_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "AssignmentPattern",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		left: node(a),
		right: node(b),
	};
}

function AssignmentPattern_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "AssignmentPattern",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		left: node(a),
		right: node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
		typeAnnotation: null,
	};
}

function ArrayPattern_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "ArrayPattern",
		start,
		end,
		elements: list(a),
	};
	if (b !== 0) {
		n.typeAnnotation = node(b);
	}
	return n;
}

function ArrayPattern_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ArrayPattern",
		start,
		end,
		elements: list(a),
		typeAnnotation: b === 0 ? null : node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function ArrayPattern_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "ArrayPattern",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		elements: list(a),
	};
	if (b !== 0) {
		n.typeAnnotation = node(b);
	}
	return n;
}

function ArrayPattern_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ArrayPattern",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		elements: list(a),
		typeAnnotation: b === 0 ? null : node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function ObjectPattern_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "ObjectPattern",
		start,
		end,
		properties: list(a),
	};
	if (b !== 0) {
		n.typeAnnotation = node(b);
	}
	return n;
}

function ObjectPattern_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ObjectPattern",
		start,
		end,
		properties: list(a),
		typeAnnotation: b === 0 ? null : node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function ObjectPattern_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "ObjectPattern",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		properties: list(a),
	};
	if (b !== 0) {
		n.typeAnnotation = node(b);
	}
	return n;
}

function ObjectPattern_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ObjectPattern",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		properties: list(a),
		typeAnnotation: b === 0 ? null : node(b),
		decorators: list(c),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function ImportDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ImportDeclaration",
		start,
		end,
		specifiers: list(a),
		source: node(b),
		attributes: list(c),
	};
}

function ImportDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ImportDeclaration",
		start,
		end,
		specifiers: list(a),
		source: node(b),
		attributes: list(c),
		importKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
		phase: null,
	};
}

function ImportDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ImportDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		specifiers: list(a),
		source: node(b),
		attributes: list(c),
	};
}

function ImportDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ImportDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		specifiers: list(a),
		source: node(b),
		attributes: list(c),
		importKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
		phase: null,
	};
}

function ImportSpecifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportSpecifier",
		start,
		end,
		imported: node(a),
		local: node(b),
	};
}

function ImportSpecifier_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportSpecifier",
		start,
		end,
		imported: node(a),
		local: node(b),
		importKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ImportSpecifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportSpecifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		imported: node(a),
		local: node(b),
	};
}

function ImportSpecifier_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportSpecifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		imported: node(a),
		local: node(b),
		importKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ImportDefaultSpecifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ImportDefaultSpecifier",
		start,
		end,
		local: node(a),
	};
}

function ImportDefaultSpecifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ImportDefaultSpecifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		local: node(a),
	};
}

function ImportNamespaceSpecifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ImportNamespaceSpecifier",
		start,
		end,
		local: node(a),
	};
}

function ImportNamespaceSpecifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ImportNamespaceSpecifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		local: node(a),
	};
}

function ImportAttribute_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportAttribute",
		start,
		end,
		key: node(a),
		value: node(b),
	};
}

function ImportAttribute_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ImportAttribute",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
	};
}

function ExportNamedDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "ExportNamedDeclaration",
		start,
		end,
		declaration: node(a),
		specifiers: list(b),
		source: node(c),
		attributes: list(d),
	};
}

function ExportNamedDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "ExportNamedDeclaration",
		start,
		end,
		declaration: node(a),
		specifiers: list(b),
		source: node(c),
		attributes: list(d),
		exportKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ExportNamedDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "ExportNamedDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		declaration: node(a),
		specifiers: list(b),
		source: node(c),
		attributes: list(d),
	};
}

function ExportNamedDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "ExportNamedDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		declaration: node(a),
		specifiers: list(b),
		source: node(c),
		attributes: list(d),
		exportKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ExportSpecifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ExportSpecifier",
		start,
		end,
		local: node(a),
		exported: node(b),
	};
}

function ExportSpecifier_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ExportSpecifier",
		start,
		end,
		local: node(a),
		exported: node(b),
		exportKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ExportSpecifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ExportSpecifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		local: node(a),
		exported: node(b),
	};
}

function ExportSpecifier_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "ExportSpecifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		local: node(a),
		exported: node(b),
		exportKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ExportDefaultDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ExportDefaultDeclaration",
		start,
		end,
		declaration: node(a),
	};
}

function ExportDefaultDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ExportDefaultDeclaration",
		start,
		end,
		declaration: node(a),
		exportKind: "value",
	};
}

function ExportDefaultDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ExportDefaultDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		declaration: node(a),
	};
}

function ExportDefaultDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "ExportDefaultDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		declaration: node(a),
		exportKind: "value",
	};
}

function ExportAllDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ExportAllDeclaration",
		start,
		end,
		exported: node(a),
		source: node(b),
		attributes: list(c),
	};
}

function ExportAllDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ExportAllDeclaration",
		start,
		end,
		exported: node(a),
		source: node(b),
		attributes: list(c),
		exportKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function ExportAllDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ExportAllDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		exported: node(a),
		source: node(b),
		attributes: list(c),
	};
}

function ExportAllDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "ExportAllDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		exported: node(a),
		source: node(b),
		attributes: list(c),
		exportKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function Decorator_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "Decorator",
		start,
		end,
		expression: node(a),
	};
}

function Decorator_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "Decorator",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function JSXElement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "JSXElement",
		start,
		end,
		openingElement: node(a),
		closingElement: node(b),
		children: list(c),
	};
}

function JSXElement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "JSXElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		openingElement: node(a),
		closingElement: node(b),
		children: list(c),
	};
}

function JSXFragment_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "JSXFragment",
		start,
		end,
		openingFragment: node(a),
		closingFragment: node(b),
		children: list(c),
	};
}

function JSXFragment_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "JSXFragment",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		openingFragment: node(a),
		closingFragment: node(b),
		children: list(c),
	};
}

function JSXOpeningElement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXOpeningElement",
		start,
		end,
		name: node(a),
		attributes: list(b),
		selfClosing: (flags & NF_SELF_CLOSING) !== 0,
	};
}

function JSXOpeningElement_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const d = w[pos + NODE_D];
	return {
		type: "JSXOpeningElement",
		start,
		end,
		name: node(a),
		attributes: list(b),
		selfClosing: (flags & NF_SELF_CLOSING) !== 0,
		typeArguments: node(d),
	};
}

function JSXOpeningElement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXOpeningElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: node(a),
		attributes: list(b),
		selfClosing: (flags & NF_SELF_CLOSING) !== 0,
	};
}

function JSXOpeningElement_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const d = w[pos + NODE_D];
	return {
		type: "JSXOpeningElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: node(a),
		attributes: list(b),
		selfClosing: (flags & NF_SELF_CLOSING) !== 0,
		typeArguments: node(d),
	};
}

function JSXClosingElement_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXClosingElement",
		start,
		end,
		name: node(a),
	};
}

function JSXClosingElement_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXClosingElement",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: node(a),
	};
}

function JSXOpeningFragment_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: "JSXOpeningFragment",
		start,
		end,
		attributes: [],
		selfClosing: false,
	};
}

function JSXOpeningFragment_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: "JSXOpeningFragment",
		start,
		end,
	};
}

function JSXOpeningFragment_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: "JSXOpeningFragment",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		attributes: [],
		selfClosing: false,
	};
}

function JSXOpeningFragment_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: "JSXOpeningFragment",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
	};
}

function JSXAttribute_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXAttribute",
		start,
		end,
		name: node(a),
		value: node(b),
	};
}

function JSXAttribute_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXAttribute",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: node(a),
		value: node(b),
	};
}

function JSXSpreadAttribute_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXSpreadAttribute",
		start,
		end,
		argument: node(a),
	};
}

function JSXSpreadAttribute_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXSpreadAttribute",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		argument: node(a),
	};
}

function JSXIdentifier_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: "JSXIdentifier",
		start,
		end,
		name: source.slice(start, end),
	};
}

function JSXIdentifier_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	return {
		type: "JSXIdentifier",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: source.slice(start, end),
	};
}

function JSXNamespacedName_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXNamespacedName",
		start,
		end,
		namespace: node(a),
		name: node(b),
	};
}

function JSXNamespacedName_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXNamespacedName",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		namespace: node(a),
		name: node(b),
	};
}

function JSXMemberExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXMemberExpression",
		start,
		end,
		object: node(a),
		property: node(b),
	};
}

function JSXMemberExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "JSXMemberExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		object: node(a),
		property: node(b),
	};
}

function JSXExpressionContainer_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXExpressionContainer",
		start,
		end,
		expression: node(a),
	};
}

function JSXExpressionContainer_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXExpressionContainer",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function JSXSpreadChild_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXSpreadChild",
		start,
		end,
		expression: node(a),
	};
}

function JSXSpreadChild_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "JSXSpreadChild",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function JSXText_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const raw = source.slice(start, end);

	return {
		type: "JSXText",
		start,
		end,
		value: decodeEntities(raw),
		raw,
	};
}

function JSXText_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const raw = source.slice(start, end);

	return {
		type: "JSXText",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		value: decodeEntities(raw),
		raw,
	};
}

function TSTypeAnnotation_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeAnnotation",
		start,
		end,
		typeAnnotation: node(a),
	};
}

function TSTypeAnnotation_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeAnnotation",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeAnnotation: node(a),
	};
}

function TSTypeParameterDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeParameterDeclaration",
		start,
		end,
		params: list(a),
	};
}

function TSTypeParameterDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeParameterDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
	};
}

function TSTypeParameter_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSTypeParameter",
		start,
		end,
		name: node(a),
		constraint: node(b),
		default: node(c),
		in: (flags & NF_IN) !== 0,
		out: (flags & NF_STATIC) !== 0,
		const: (flags & NF_CONST) !== 0,
	};
}

function TSTypeParameter_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSTypeParameter",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		name: node(a),
		constraint: node(b),
		default: node(c),
		in: (flags & NF_IN) !== 0,
		out: (flags & NF_STATIC) !== 0,
		const: (flags & NF_CONST) !== 0,
	};
}

function TSTypeParameterInstantiation_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeParameterInstantiation",
		start,
		end,
		params: list(a),
	};
}

function TSTypeParameterInstantiation_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeParameterInstantiation",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
	};
}

function TSArrayType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSArrayType",
		start,
		end,
		elementType: node(a),
	};
}

function TSArrayType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSArrayType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		elementType: node(a),
	};
}

function TSTupleType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTupleType",
		start,
		end,
		elementTypes: list(a),
	};
}

function TSTupleType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTupleType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		elementTypes: list(a),
	};
}

function TSNamedTupleMember_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSNamedTupleMember",
		start,
		end,
		label: node(a),
		elementType: node(b),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function TSNamedTupleMember_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSNamedTupleMember",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		label: node(a),
		elementType: node(b),
		optional: (flags & NF_OPTIONAL) !== 0,
	};
}

function TSRestType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSRestType",
		start,
		end,
		typeAnnotation: node(a),
	};
}

function TSRestType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSRestType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeAnnotation: node(a),
	};
}

function TSOptionalType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSOptionalType",
		start,
		end,
		typeAnnotation: node(a),
	};
}

function TSOptionalType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSOptionalType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeAnnotation: node(a),
	};
}

function TSUnionType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSUnionType",
		start,
		end,
		types: list(a),
	};
}

function TSUnionType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSUnionType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		types: list(a),
	};
}

function TSIntersectionType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSIntersectionType",
		start,
		end,
		types: list(a),
	};
}

function TSIntersectionType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSIntersectionType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		types: list(a),
	};
}

function TSConditionalType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSConditionalType",
		start,
		end,
		checkType: node(a),
		extendsType: node(b),
		trueType: node(c),
		falseType: node(d),
	};
}

function TSConditionalType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSConditionalType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		checkType: node(a),
		extendsType: node(b),
		trueType: node(c),
		falseType: node(d),
	};
}

function TSInferType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSInferType",
		start,
		end,
		typeParameter: node(a),
	};
}

function TSInferType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSInferType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeParameter: node(a),
	};
}

function TSTypeOperator_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeOperator",
		start,
		end,
		operator: operator(b),
		typeAnnotation: node(a),
	};
}

function TSTypeOperator_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeOperator",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		operator: operator(b),
		typeAnnotation: node(a),
	};
}

function TSIndexedAccessType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSIndexedAccessType",
		start,
		end,
		objectType: node(a),
		indexType: node(b),
	};
}

function TSIndexedAccessType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSIndexedAccessType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		objectType: node(a),
		indexType: node(b),
	};
}

function TSMappedType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const tp = nodesBase + w[pos + NODE_A] * nodeWords;

	return {
		type: "TSMappedType",
		start,
		end,
		key: node(w[tp + NODE_A]),
		constraint: node(w[tp + NODE_B]),
		nameType: node(w[pos + NODE_C]),
		typeAnnotation: node(w[pos + NODE_D]),
		optional: mappedModifier(w[pos + NODE_E]) ?? false,
		readonly: mappedModifier(w[pos + NODE_F]) ?? null,
	};
}

function TSMappedType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const tp = nodesBase + w[pos + NODE_A] * nodeWords;

	return {
		type: "TSMappedType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(w[tp + NODE_A]),
		constraint: node(w[tp + NODE_B]),
		nameType: node(w[pos + NODE_C]),
		typeAnnotation: node(w[pos + NODE_D]),
		optional: mappedModifier(w[pos + NODE_E]) ?? false,
		readonly: mappedModifier(w[pos + NODE_F]) ?? null,
	};
}

function TSLiteralType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSLiteralType",
		start,
		end,
		literal: node(a),
	};
}

function TSLiteralType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSLiteralType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		literal: node(a),
	};
}

function TSTemplateLiteralType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTemplateLiteralType",
		start,
		end,
		quasis: list(a),
		types: list(b),
	};
}

function TSTemplateLiteralType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTemplateLiteralType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		quasis: list(a),
		types: list(b),
	};
}

function TSTypeReference_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSTypeReference",
		start,
		end,
		typeName: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSTypeReference_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeReference",
		start,
		end,
		typeName: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSTypeReference_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSTypeReference",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeName: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSTypeReference_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeReference",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeName: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSQualifiedName_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSQualifiedName",
		start,
		end,
		left: node(a),
		right: node(b),
	};
}

function TSQualifiedName_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSQualifiedName",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		left: node(a),
		right: node(b),
	};
}

function TSTypeQuery_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSTypeQuery",
		start,
		end,
		exprName: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSTypeQuery_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeQuery",
		start,
		end,
		exprName: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSTypeQuery_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSTypeQuery",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		exprName: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSTypeQuery_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeQuery",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		exprName: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSTypePredicate_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSTypePredicate",
		start,
		end,
		parameterName: node(a),
		typeAnnotation: node(b),
		asserts: c === 1,
	};
}

function TSTypePredicate_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSTypePredicate",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		parameterName: node(a),
		typeAnnotation: node(b),
		asserts: c === 1,
	};
}

function TSFunctionType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSFunctionType",
		start,
		end,
		params: list(a),
		returnType: node(b),
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSFunctionType_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSFunctionType",
		start,
		end,
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
	};
}

function TSFunctionType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSFunctionType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSFunctionType_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSFunctionType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
	};
}

function TSConstructorType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSConstructorType",
		start,
		end,
		params: list(a),
		returnType: node(b),
		abstract: (flags & NF_ABSTRACT) !== 0,
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSConstructorType_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSConstructorType",
		start,
		end,
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
		abstract: (flags & NF_ABSTRACT) !== 0,
	};
}

function TSConstructorType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSConstructorType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
		abstract: (flags & NF_ABSTRACT) !== 0,
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSConstructorType_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSConstructorType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
		abstract: (flags & NF_ABSTRACT) !== 0,
	};
}

function TSTypeLiteral_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeLiteral",
		start,
		end,
		members: list(a),
	};
}

function TSTypeLiteral_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSTypeLiteral",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		members: list(a),
	};
}

function TSImportType_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSImportType",
		start,
		end,
		source: node(a),
		qualifier: node(b),
		options: node(d),
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function TSImportType_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSImportType",
		start,
		end,
		source: node(a),
		qualifier: node(b),
		typeArguments: c === 0 ? null : node(c),
		options: node(d),
	};
}

function TSImportType_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSImportType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		source: node(a),
		qualifier: node(b),
		options: node(d),
	};
	if (c !== 0) {
		n.typeArguments = node(c);
	}
	return n;
}

function TSImportType_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSImportType",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		source: node(a),
		qualifier: node(b),
		typeArguments: c === 0 ? null : node(c),
		options: node(d),
	};
}

function TSPropertySignature_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSPropertySignature",
		start,
		end,
		key: node(a),
		typeAnnotation: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
}

function TSPropertySignature_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSPropertySignature",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		typeAnnotation: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
}

function TSMethodSignature_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSMethodSignature",
		start,
		end,
		key: node(a),
		params: list(b),
		returnType: node(c),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		kind:
			(flags & MKIND_MASK) === 0
				? "method"
				: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	return n;
}

function TSMethodSignature_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSMethodSignature",
		start,
		end,
		key: node(a),
		params: list(b),
		returnType: node(c),
		typeParameters: d === 0 ? null : node(d),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		kind:
			(flags & MKIND_MASK) === 0
				? "method"
				: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
	};
}

function TSMethodSignature_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSMethodSignature",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		params: list(b),
		returnType: node(c),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		kind:
			(flags & MKIND_MASK) === 0
				? "method"
				: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	return n;
}

function TSMethodSignature_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSMethodSignature",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		params: list(b),
		returnType: node(c),
		typeParameters: d === 0 ? null : node(d),
		computed: (flags & NF_COMPUTED) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		kind:
			(flags & MKIND_MASK) === 0
				? "method"
				: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
	};
}

function TSIndexSignature_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSIndexSignature",
		start,
		end,
		parameters: list(a),
		typeAnnotation: node(b),
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
}

function TSIndexSignature_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSIndexSignature",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		parameters: list(a),
		typeAnnotation: node(b),
		readonly: (flags & NF_READONLY) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
}

function TSCallSignatureDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSCallSignatureDeclaration",
		start,
		end,
		params: list(a),
		returnType: node(b),
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSCallSignatureDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSCallSignatureDeclaration",
		start,
		end,
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
	};
}

function TSCallSignatureDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSCallSignatureDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSCallSignatureDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSCallSignatureDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
	};
}

function TSConstructSignatureDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSConstructSignatureDeclaration",
		start,
		end,
		params: list(a),
		returnType: node(b),
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSConstructSignatureDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSConstructSignatureDeclaration",
		start,
		end,
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
	};
}

function TSConstructSignatureDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSConstructSignatureDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSConstructSignatureDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSConstructSignatureDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		params: list(a),
		returnType: node(b),
		typeParameters: c === 0 ? null : node(c),
	};
}

function TSInterfaceDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSInterfaceDeclaration",
		start,
		end,
		id: node(a),
		body: node(b),
		extends: list(d),
		declare: (flags & NF_DECLARE) !== 0,
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSInterfaceDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSInterfaceDeclaration",
		start,
		end,
		id: node(a),
		body: node(b),
		typeParameters: c === 0 ? null : node(c),
		extends: list(d),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSInterfaceDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSInterfaceDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		body: node(b),
		extends: list(d),
		declare: (flags & NF_DECLARE) !== 0,
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSInterfaceDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSInterfaceDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		body: node(b),
		typeParameters: c === 0 ? null : node(c),
		extends: list(d),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSInterfaceBody_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSInterfaceBody",
		start,
		end,
		body: list(a),
	};
}

function TSInterfaceBody_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSInterfaceBody",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: list(a),
	};
}

function TSInterfaceHeritage_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSInterfaceHeritage",
		start,
		end,
		expression: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSInterfaceHeritage_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSInterfaceHeritage",
		start,
		end,
		expression: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSInterfaceHeritage_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSInterfaceHeritage",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSInterfaceHeritage_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSInterfaceHeritage",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSClassImplements_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSClassImplements",
		start,
		end,
		expression: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSClassImplements_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSClassImplements",
		start,
		end,
		expression: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSClassImplements_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSClassImplements",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
	if (b !== 0) {
		n.typeArguments = node(b);
	}
	return n;
}

function TSClassImplements_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSClassImplements",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
		typeArguments: b === 0 ? null : node(b),
	};
}

function TSTypeAliasDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSTypeAliasDeclaration",
		start,
		end,
		id: node(a),
		typeAnnotation: node(b),
		declare: (flags & NF_DECLARE) !== 0,
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSTypeAliasDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSTypeAliasDeclaration",
		start,
		end,
		id: node(a),
		typeAnnotation: node(b),
		typeParameters: c === 0 ? null : node(c),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSTypeAliasDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSTypeAliasDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		typeAnnotation: node(b),
		declare: (flags & NF_DECLARE) !== 0,
	};
	if (c !== 0) {
		n.typeParameters = node(c);
	}
	return n;
}

function TSTypeAliasDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSTypeAliasDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		typeAnnotation: node(b),
		typeParameters: c === 0 ? null : node(c),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSEnumDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSEnumDeclaration",
		start,
		end,
		id: node(a),
		body: node(b),
		const: (flags & NF_CONST) !== 0,
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSEnumDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSEnumDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		body: node(b),
		const: (flags & NF_CONST) !== 0,
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSEnumBody_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSEnumBody",
		start,
		end,
		members: list(a),
	};
}

function TSEnumBody_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSEnumBody",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		members: list(a),
	};
}

function TSEnumMember_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSEnumMember",
		start,
		end,
		id: node(a),
		initializer: node(b),
	};
}

function TSEnumMember_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSEnumMember",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		initializer: node(b),
	};
}

function TSModuleDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSModuleDeclaration",
		start,
		end,
		id: node(a),
		body: node(b),
		kind: MODULE_KIND_NAMES[
			(flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT
		],
		declare: (flags & NF_DECLARE) !== 0,
		global:
			(flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT === MODULE_GLOBAL,
	};
}

function TSModuleDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSModuleDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		body: node(b),
		kind: MODULE_KIND_NAMES[
			(flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT
		],
		declare: (flags & NF_DECLARE) !== 0,
		global:
			(flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT === MODULE_GLOBAL,
	};
}

function TSModuleBlock_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSModuleBlock",
		start,
		end,
		body: list(a),
	};
}

function TSModuleBlock_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSModuleBlock",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		body: list(a),
	};
}

function TSDeclareFunction_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "TSDeclareFunction",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function TSDeclareFunction_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "TSDeclareFunction",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSDeclareFunction_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "TSDeclareFunction",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function TSDeclareFunction_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "TSDeclareFunction",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSAbstractMethodDefinition_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSAbstractMethodDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	return n;
}

function TSAbstractMethodDefinition_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSAbstractMethodDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
	};
}

function TSAbstractMethodDefinition_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const n: EsNode = {
		type: "TSAbstractMethodDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	return n;
}

function TSAbstractMethodDefinition_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	return {
		type: "TSAbstractMethodDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		kind: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT],
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
	};
}

function TSAbstractPropertyDefinition_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSAbstractPropertyDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function TSAbstractPropertyDefinition_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSAbstractPropertyDefinition",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function TSAbstractPropertyDefinition_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSAbstractPropertyDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function TSAbstractPropertyDefinition_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSAbstractPropertyDefinition",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function TSAbstractAccessorProperty_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSAbstractAccessorProperty",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function TSAbstractAccessorProperty_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSAbstractAccessorProperty",
		start,
		end,
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function TSAbstractAccessorProperty_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const n: EsNode = {
		type: "TSAbstractAccessorProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
	};
	if (c !== 0) {
		n.decorators = list(c);
	}
	if (d !== 0) {
		n.typeAnnotation = node(d);
	}
	return n;
}

function TSAbstractAccessorProperty_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	return {
		type: "TSAbstractAccessorProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		key: node(a),
		value: node(b),
		computed: (flags & NF_COMPUTED) !== 0,
		static: (flags & NF_STATIC) !== 0,
		decorators: list(c),
		typeAnnotation: d === 0 ? null : node(d),
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
		declare: (flags & NF_DECLARE) !== 0,
		definite: (flags & NF_DEFINITE) !== 0,
		optional: (flags & NF_OPTIONAL) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		readonly: (flags & NF_READONLY) !== 0,
	};
}

function TSParameterProperty_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSParameterProperty",
		start,
		end,
		parameter: node(a),
		readonly: (flags & NF_READONLY) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
	if (b !== 0) {
		n.decorators = list(b);
	}
	return n;
}

function TSParameterProperty_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSParameterProperty",
		start,
		end,
		parameter: node(a),
		decorators: list(b),
		readonly: (flags & NF_READONLY) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
}

function TSParameterProperty_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const n: EsNode = {
		type: "TSParameterProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		parameter: node(a),
		readonly: (flags & NF_READONLY) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
	if (b !== 0) {
		n.decorators = list(b);
	}
	return n;
}

function TSParameterProperty_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSParameterProperty",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		parameter: node(a),
		decorators: list(b),
		readonly: (flags & NF_READONLY) !== 0,
		override: (flags & NF_OVERRIDE) !== 0,
		static: (flags & NF_STATIC) !== 0,
		accessibility:
			ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT],
	};
}

function TSEmptyBodyFunctionExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "TSEmptyBodyFunctionExpression",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function TSEmptyBodyFunctionExpression_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "TSEmptyBodyFunctionExpression",
		start,
		end,
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSEmptyBodyFunctionExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	const n: EsNode = {
		type: "TSEmptyBodyFunctionExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
	};
	if (d !== 0) {
		n.typeParameters = node(d);
	}
	if (e !== 0) {
		n.returnType = node(e);
	}
	return n;
}

function TSEmptyBodyFunctionExpression_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	const c = w[pos + NODE_C];
	const d = w[pos + NODE_D];
	const e = w[pos + NODE_E];
	return {
		type: "TSEmptyBodyFunctionExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		params: list(b),
		body: node(c),
		generator: (flags & NF_GENERATOR) !== 0,
		expression: false,
		async: (flags & NF_ASYNC) !== 0,
		typeParameters: d === 0 ? null : node(d),
		returnType: e === 0 ? null : node(e),
		declare: (flags & NF_DECLARE) !== 0,
	};
}

function TSAsExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSAsExpression",
		start,
		end,
		expression: node(a),
		typeAnnotation: node(b),
	};
}

function TSAsExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSAsExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
		typeAnnotation: node(b),
	};
}

function TSSatisfiesExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSSatisfiesExpression",
		start,
		end,
		expression: node(a),
		typeAnnotation: node(b),
	};
}

function TSSatisfiesExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSSatisfiesExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
		typeAnnotation: node(b),
	};
}

function TSNonNullExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSNonNullExpression",
		start,
		end,
		expression: node(a),
	};
}

function TSNonNullExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSNonNullExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function TSTypeAssertion_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeAssertion",
		start,
		end,
		typeAnnotation: node(a),
		expression: node(b),
	};
}

function TSTypeAssertion_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSTypeAssertion",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		typeAnnotation: node(a),
		expression: node(b),
	};
}

function TSInstantiationExpression_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSInstantiationExpression",
		start,
		end,
		expression: node(a),
		typeArguments: node(b),
	};
}

function TSInstantiationExpression_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSInstantiationExpression",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
		typeArguments: node(b),
	};
}

function TSExportAssignment_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSExportAssignment",
		start,
		end,
		expression: node(a),
	};
}

function TSExportAssignment_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSExportAssignment",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function TSImportEqualsDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSImportEqualsDeclaration",
		start,
		end,
		id: node(a),
		moduleReference: node(b),
	};
}

function TSImportEqualsDeclaration_ts(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSImportEqualsDeclaration",
		start,
		end,
		id: node(a),
		moduleReference: node(b),
		importKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function TSImportEqualsDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSImportEqualsDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		moduleReference: node(b),
	};
}

function TSImportEqualsDeclaration_tsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const flags = w[pos + NODE_FLAGS];
	const a = w[pos + NODE_A];
	const b = w[pos + NODE_B];
	return {
		type: "TSImportEqualsDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
		moduleReference: node(b),
		importKind: (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value",
	};
}

function TSExternalModuleReference_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSExternalModuleReference",
		start,
		end,
		expression: node(a),
	};
}

function TSExternalModuleReference_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSExternalModuleReference",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		expression: node(a),
	};
}

function TSNamespaceExportDeclaration_js(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSNamespaceExportDeclaration",
		start,
		end,
		id: node(a),
	};
}

function TSNamespaceExportDeclaration_jsL(pos: number): EsNode {
	const w = words;
	const start = w[pos + NODE_START];
	const end = w[pos + NODE_END];
	const a = w[pos + NODE_A];
	return {
		type: "TSNamespaceExportDeclaration",
		start,
		end,
		range: [start, end],
		loc: locOf(start, end),
		id: node(a),
	};
}

/** `js` dialect. */
export const DECODE_JS: readonly Decoder[] = [
	bare,
	Program_js,
	Identifier_js,
	PrivateIdentifier_js,
	Literal_js,
	TemplateLiteral_js,
	TemplateElement_js,
	TaggedTemplateExpression_js,
	ExpressionStatement_js,
	BlockStatement_js,
	StaticBlock_js,
	bare,
	bare,
	WithStatement_js,
	ReturnStatement_js,
	LabeledStatement_js,
	BreakStatement_js,
	ContinueStatement_js,
	IfStatement_js,
	SwitchStatement_js,
	SwitchCase_js,
	ThrowStatement_js,
	TryStatement_js,
	CatchClause_js,
	WhileStatement_js,
	DoWhileStatement_js,
	ForStatement_js,
	ForInStatement_js,
	ForOfStatement_js,
	VariableDeclaration_js,
	VariableDeclarator_js,
	FunctionDeclaration_js,
	FunctionExpression_js,
	ArrowFunctionExpression_js,
	ClassDeclaration_js,
	ClassExpression_js,
	ClassBody_js,
	MethodDefinition_js,
	PropertyDefinition_js,
	AccessorProperty_js,
	bare,
	ArrayExpression_js,
	ObjectExpression_js,
	Property_js,
	SequenceExpression_js,
	UnaryExpression_js,
	UpdateExpression_js,
	BinaryExpression_js,
	AssignmentExpression_js,
	LogicalExpression_js,
	ConditionalExpression_js,
	CallExpression_js,
	NewExpression_js,
	MemberExpression_js,
	YieldExpression_js,
	AwaitExpression_js,
	ImportExpression_js,
	ChainExpression_js,
	MetaProperty_js,
	bare,
	SpreadElement_js,
	RestElement_js,
	AssignmentPattern_js,
	ArrayPattern_js,
	ObjectPattern_js,
	ImportDeclaration_js,
	ImportSpecifier_js,
	ImportDefaultSpecifier_js,
	ImportNamespaceSpecifier_js,
	ImportAttribute_js,
	ExportNamedDeclaration_js,
	ExportSpecifier_js,
	ExportDefaultDeclaration_js,
	ExportAllDeclaration_js,
	Decorator_js,
	JSXElement_js,
	JSXFragment_js,
	JSXOpeningElement_js,
	JSXClosingElement_js,
	JSXOpeningFragment_js,
	bare,
	JSXAttribute_js,
	JSXSpreadAttribute_js,
	JSXIdentifier_js,
	JSXNamespacedName_js,
	JSXMemberExpression_js,
	JSXExpressionContainer_js,
	bare,
	JSXSpreadChild_js,
	JSXText_js,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	TSTypeAnnotation_js,
	TSTypeParameterDeclaration_js,
	TSTypeParameter_js,
	TSTypeParameterInstantiation_js,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	TSArrayType_js,
	TSTupleType_js,
	TSNamedTupleMember_js,
	TSRestType_js,
	TSOptionalType_js,
	TSUnionType_js,
	TSIntersectionType_js,
	TSConditionalType_js,
	TSInferType_js,
	TSTypeOperator_js,
	TSIndexedAccessType_js,
	TSMappedType_js,
	TSLiteralType_js,
	TSTemplateLiteralType_js,
	TSTypeReference_js,
	TSQualifiedName_js,
	TSTypeQuery_js,
	TSTypePredicate_js,
	TSFunctionType_js,
	TSConstructorType_js,
	TSTypeLiteral_js,
	TSImportType_js,
	TSPropertySignature_js,
	TSMethodSignature_js,
	TSIndexSignature_js,
	TSCallSignatureDeclaration_js,
	TSConstructSignatureDeclaration_js,
	TSInterfaceDeclaration_js,
	TSInterfaceBody_js,
	TSInterfaceHeritage_js,
	TSClassImplements_js,
	TSTypeAliasDeclaration_js,
	TSEnumDeclaration_js,
	TSEnumBody_js,
	TSEnumMember_js,
	TSModuleDeclaration_js,
	TSModuleBlock_js,
	TSDeclareFunction_js,
	TSAbstractMethodDefinition_js,
	TSAbstractPropertyDefinition_js,
	TSAbstractAccessorProperty_js,
	TSParameterProperty_js,
	TSEmptyBodyFunctionExpression_js,
	TSAsExpression_js,
	TSSatisfiesExpression_js,
	TSNonNullExpression_js,
	TSTypeAssertion_js,
	TSInstantiationExpression_js,
	TSExportAssignment_js,
	TSImportEqualsDeclaration_js,
	TSExternalModuleReference_js,
	bare,
	bare,
	bare,
	TSNamespaceExportDeclaration_js,
];

/** `ts` dialect. */
export const DECODE_TS: readonly Decoder[] = [
	bare,
	Program_js,
	Identifier_ts,
	PrivateIdentifier_js,
	Literal_js,
	TemplateLiteral_js,
	TemplateElement_js,
	TaggedTemplateExpression_ts,
	ExpressionStatement_ts,
	BlockStatement_js,
	StaticBlock_js,
	bare,
	bare,
	WithStatement_js,
	ReturnStatement_js,
	LabeledStatement_js,
	BreakStatement_js,
	ContinueStatement_js,
	IfStatement_js,
	SwitchStatement_js,
	SwitchCase_js,
	ThrowStatement_js,
	TryStatement_js,
	CatchClause_js,
	WhileStatement_js,
	DoWhileStatement_js,
	ForStatement_js,
	ForInStatement_js,
	ForOfStatement_js,
	VariableDeclaration_ts,
	VariableDeclarator_ts,
	FunctionDeclaration_ts,
	FunctionExpression_ts,
	ArrowFunctionExpression_ts,
	ClassDeclaration_ts,
	ClassExpression_ts,
	ClassBody_js,
	MethodDefinition_ts,
	PropertyDefinition_ts,
	AccessorProperty_ts,
	bare,
	ArrayExpression_js,
	ObjectExpression_js,
	Property_ts,
	SequenceExpression_js,
	UnaryExpression_js,
	UpdateExpression_js,
	BinaryExpression_js,
	AssignmentExpression_js,
	LogicalExpression_js,
	ConditionalExpression_js,
	CallExpression_ts,
	NewExpression_ts,
	MemberExpression_js,
	YieldExpression_js,
	AwaitExpression_js,
	ImportExpression_js,
	ChainExpression_js,
	MetaProperty_js,
	bare,
	SpreadElement_js,
	RestElement_ts,
	AssignmentPattern_ts,
	ArrayPattern_ts,
	ObjectPattern_ts,
	ImportDeclaration_ts,
	ImportSpecifier_ts,
	ImportDefaultSpecifier_js,
	ImportNamespaceSpecifier_js,
	ImportAttribute_js,
	ExportNamedDeclaration_ts,
	ExportSpecifier_ts,
	ExportDefaultDeclaration_ts,
	ExportAllDeclaration_ts,
	Decorator_js,
	JSXElement_js,
	JSXFragment_js,
	JSXOpeningElement_ts,
	JSXClosingElement_js,
	JSXOpeningFragment_ts,
	bare,
	JSXAttribute_js,
	JSXSpreadAttribute_js,
	JSXIdentifier_js,
	JSXNamespacedName_js,
	JSXMemberExpression_js,
	JSXExpressionContainer_js,
	bare,
	JSXSpreadChild_js,
	JSXText_js,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	TSTypeAnnotation_js,
	TSTypeParameterDeclaration_js,
	TSTypeParameter_js,
	TSTypeParameterInstantiation_js,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	bare,
	TSArrayType_js,
	TSTupleType_js,
	TSNamedTupleMember_js,
	TSRestType_js,
	TSOptionalType_js,
	TSUnionType_js,
	TSIntersectionType_js,
	TSConditionalType_js,
	TSInferType_js,
	TSTypeOperator_js,
	TSIndexedAccessType_js,
	TSMappedType_js,
	TSLiteralType_js,
	TSTemplateLiteralType_js,
	TSTypeReference_ts,
	TSQualifiedName_js,
	TSTypeQuery_ts,
	TSTypePredicate_js,
	TSFunctionType_ts,
	TSConstructorType_ts,
	TSTypeLiteral_js,
	TSImportType_ts,
	TSPropertySignature_js,
	TSMethodSignature_ts,
	TSIndexSignature_js,
	TSCallSignatureDeclaration_ts,
	TSConstructSignatureDeclaration_ts,
	TSInterfaceDeclaration_ts,
	TSInterfaceBody_js,
	TSInterfaceHeritage_ts,
	TSClassImplements_ts,
	TSTypeAliasDeclaration_ts,
	TSEnumDeclaration_js,
	TSEnumBody_js,
	TSEnumMember_js,
	TSModuleDeclaration_js,
	TSModuleBlock_js,
	TSDeclareFunction_ts,
	TSAbstractMethodDefinition_ts,
	TSAbstractPropertyDefinition_ts,
	TSAbstractAccessorProperty_ts,
	TSParameterProperty_ts,
	TSEmptyBodyFunctionExpression_ts,
	TSAsExpression_js,
	TSSatisfiesExpression_js,
	TSNonNullExpression_js,
	TSTypeAssertion_js,
	TSInstantiationExpression_js,
	TSExportAssignment_js,
	TSImportEqualsDeclaration_ts,
	TSExternalModuleReference_js,
	bare,
	bare,
	bare,
	TSNamespaceExportDeclaration_js,
];

/** `js` dialect, with `range` and `loc`. */
export const DECODE_JS_LOC: readonly Decoder[] = [
	bareL,
	Program_jsL,
	Identifier_jsL,
	PrivateIdentifier_jsL,
	Literal_jsL,
	TemplateLiteral_jsL,
	TemplateElement_jsL,
	TaggedTemplateExpression_jsL,
	ExpressionStatement_jsL,
	BlockStatement_jsL,
	StaticBlock_jsL,
	bareL,
	bareL,
	WithStatement_jsL,
	ReturnStatement_jsL,
	LabeledStatement_jsL,
	BreakStatement_jsL,
	ContinueStatement_jsL,
	IfStatement_jsL,
	SwitchStatement_jsL,
	SwitchCase_jsL,
	ThrowStatement_jsL,
	TryStatement_jsL,
	CatchClause_jsL,
	WhileStatement_jsL,
	DoWhileStatement_jsL,
	ForStatement_jsL,
	ForInStatement_jsL,
	ForOfStatement_jsL,
	VariableDeclaration_jsL,
	VariableDeclarator_jsL,
	FunctionDeclaration_jsL,
	FunctionExpression_jsL,
	ArrowFunctionExpression_jsL,
	ClassDeclaration_jsL,
	ClassExpression_jsL,
	ClassBody_jsL,
	MethodDefinition_jsL,
	PropertyDefinition_jsL,
	AccessorProperty_jsL,
	bareL,
	ArrayExpression_jsL,
	ObjectExpression_jsL,
	Property_jsL,
	SequenceExpression_jsL,
	UnaryExpression_jsL,
	UpdateExpression_jsL,
	BinaryExpression_jsL,
	AssignmentExpression_jsL,
	LogicalExpression_jsL,
	ConditionalExpression_jsL,
	CallExpression_jsL,
	NewExpression_jsL,
	MemberExpression_jsL,
	YieldExpression_jsL,
	AwaitExpression_jsL,
	ImportExpression_jsL,
	ChainExpression_jsL,
	MetaProperty_jsL,
	bareL,
	SpreadElement_jsL,
	RestElement_jsL,
	AssignmentPattern_jsL,
	ArrayPattern_jsL,
	ObjectPattern_jsL,
	ImportDeclaration_jsL,
	ImportSpecifier_jsL,
	ImportDefaultSpecifier_jsL,
	ImportNamespaceSpecifier_jsL,
	ImportAttribute_jsL,
	ExportNamedDeclaration_jsL,
	ExportSpecifier_jsL,
	ExportDefaultDeclaration_jsL,
	ExportAllDeclaration_jsL,
	Decorator_jsL,
	JSXElement_jsL,
	JSXFragment_jsL,
	JSXOpeningElement_jsL,
	JSXClosingElement_jsL,
	JSXOpeningFragment_jsL,
	bareL,
	JSXAttribute_jsL,
	JSXSpreadAttribute_jsL,
	JSXIdentifier_jsL,
	JSXNamespacedName_jsL,
	JSXMemberExpression_jsL,
	JSXExpressionContainer_jsL,
	bareL,
	JSXSpreadChild_jsL,
	JSXText_jsL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	TSTypeAnnotation_jsL,
	TSTypeParameterDeclaration_jsL,
	TSTypeParameter_jsL,
	TSTypeParameterInstantiation_jsL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	TSArrayType_jsL,
	TSTupleType_jsL,
	TSNamedTupleMember_jsL,
	TSRestType_jsL,
	TSOptionalType_jsL,
	TSUnionType_jsL,
	TSIntersectionType_jsL,
	TSConditionalType_jsL,
	TSInferType_jsL,
	TSTypeOperator_jsL,
	TSIndexedAccessType_jsL,
	TSMappedType_jsL,
	TSLiteralType_jsL,
	TSTemplateLiteralType_jsL,
	TSTypeReference_jsL,
	TSQualifiedName_jsL,
	TSTypeQuery_jsL,
	TSTypePredicate_jsL,
	TSFunctionType_jsL,
	TSConstructorType_jsL,
	TSTypeLiteral_jsL,
	TSImportType_jsL,
	TSPropertySignature_jsL,
	TSMethodSignature_jsL,
	TSIndexSignature_jsL,
	TSCallSignatureDeclaration_jsL,
	TSConstructSignatureDeclaration_jsL,
	TSInterfaceDeclaration_jsL,
	TSInterfaceBody_jsL,
	TSInterfaceHeritage_jsL,
	TSClassImplements_jsL,
	TSTypeAliasDeclaration_jsL,
	TSEnumDeclaration_jsL,
	TSEnumBody_jsL,
	TSEnumMember_jsL,
	TSModuleDeclaration_jsL,
	TSModuleBlock_jsL,
	TSDeclareFunction_jsL,
	TSAbstractMethodDefinition_jsL,
	TSAbstractPropertyDefinition_jsL,
	TSAbstractAccessorProperty_jsL,
	TSParameterProperty_jsL,
	TSEmptyBodyFunctionExpression_jsL,
	TSAsExpression_jsL,
	TSSatisfiesExpression_jsL,
	TSNonNullExpression_jsL,
	TSTypeAssertion_jsL,
	TSInstantiationExpression_jsL,
	TSExportAssignment_jsL,
	TSImportEqualsDeclaration_jsL,
	TSExternalModuleReference_jsL,
	bareL,
	bareL,
	bareL,
	TSNamespaceExportDeclaration_jsL,
];

/** `ts` dialect, with `range` and `loc`. */
export const DECODE_TS_LOC: readonly Decoder[] = [
	bareL,
	Program_jsL,
	Identifier_tsL,
	PrivateIdentifier_jsL,
	Literal_jsL,
	TemplateLiteral_jsL,
	TemplateElement_jsL,
	TaggedTemplateExpression_tsL,
	ExpressionStatement_tsL,
	BlockStatement_jsL,
	StaticBlock_jsL,
	bareL,
	bareL,
	WithStatement_jsL,
	ReturnStatement_jsL,
	LabeledStatement_jsL,
	BreakStatement_jsL,
	ContinueStatement_jsL,
	IfStatement_jsL,
	SwitchStatement_jsL,
	SwitchCase_jsL,
	ThrowStatement_jsL,
	TryStatement_jsL,
	CatchClause_jsL,
	WhileStatement_jsL,
	DoWhileStatement_jsL,
	ForStatement_jsL,
	ForInStatement_jsL,
	ForOfStatement_jsL,
	VariableDeclaration_tsL,
	VariableDeclarator_tsL,
	FunctionDeclaration_tsL,
	FunctionExpression_tsL,
	ArrowFunctionExpression_tsL,
	ClassDeclaration_tsL,
	ClassExpression_tsL,
	ClassBody_jsL,
	MethodDefinition_tsL,
	PropertyDefinition_tsL,
	AccessorProperty_tsL,
	bareL,
	ArrayExpression_jsL,
	ObjectExpression_jsL,
	Property_tsL,
	SequenceExpression_jsL,
	UnaryExpression_jsL,
	UpdateExpression_jsL,
	BinaryExpression_jsL,
	AssignmentExpression_jsL,
	LogicalExpression_jsL,
	ConditionalExpression_jsL,
	CallExpression_tsL,
	NewExpression_tsL,
	MemberExpression_jsL,
	YieldExpression_jsL,
	AwaitExpression_jsL,
	ImportExpression_jsL,
	ChainExpression_jsL,
	MetaProperty_jsL,
	bareL,
	SpreadElement_jsL,
	RestElement_tsL,
	AssignmentPattern_tsL,
	ArrayPattern_tsL,
	ObjectPattern_tsL,
	ImportDeclaration_tsL,
	ImportSpecifier_tsL,
	ImportDefaultSpecifier_jsL,
	ImportNamespaceSpecifier_jsL,
	ImportAttribute_jsL,
	ExportNamedDeclaration_tsL,
	ExportSpecifier_tsL,
	ExportDefaultDeclaration_tsL,
	ExportAllDeclaration_tsL,
	Decorator_jsL,
	JSXElement_jsL,
	JSXFragment_jsL,
	JSXOpeningElement_tsL,
	JSXClosingElement_jsL,
	JSXOpeningFragment_tsL,
	bareL,
	JSXAttribute_jsL,
	JSXSpreadAttribute_jsL,
	JSXIdentifier_jsL,
	JSXNamespacedName_jsL,
	JSXMemberExpression_jsL,
	JSXExpressionContainer_jsL,
	bareL,
	JSXSpreadChild_jsL,
	JSXText_jsL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	TSTypeAnnotation_jsL,
	TSTypeParameterDeclaration_jsL,
	TSTypeParameter_jsL,
	TSTypeParameterInstantiation_jsL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	bareL,
	TSArrayType_jsL,
	TSTupleType_jsL,
	TSNamedTupleMember_jsL,
	TSRestType_jsL,
	TSOptionalType_jsL,
	TSUnionType_jsL,
	TSIntersectionType_jsL,
	TSConditionalType_jsL,
	TSInferType_jsL,
	TSTypeOperator_jsL,
	TSIndexedAccessType_jsL,
	TSMappedType_jsL,
	TSLiteralType_jsL,
	TSTemplateLiteralType_jsL,
	TSTypeReference_tsL,
	TSQualifiedName_jsL,
	TSTypeQuery_tsL,
	TSTypePredicate_jsL,
	TSFunctionType_tsL,
	TSConstructorType_tsL,
	TSTypeLiteral_jsL,
	TSImportType_tsL,
	TSPropertySignature_jsL,
	TSMethodSignature_tsL,
	TSIndexSignature_jsL,
	TSCallSignatureDeclaration_tsL,
	TSConstructSignatureDeclaration_tsL,
	TSInterfaceDeclaration_tsL,
	TSInterfaceBody_jsL,
	TSInterfaceHeritage_tsL,
	TSClassImplements_tsL,
	TSTypeAliasDeclaration_tsL,
	TSEnumDeclaration_jsL,
	TSEnumBody_jsL,
	TSEnumMember_jsL,
	TSModuleDeclaration_jsL,
	TSModuleBlock_jsL,
	TSDeclareFunction_tsL,
	TSAbstractMethodDefinition_tsL,
	TSAbstractPropertyDefinition_tsL,
	TSAbstractAccessorProperty_tsL,
	TSParameterProperty_tsL,
	TSEmptyBodyFunctionExpression_tsL,
	TSAsExpression_jsL,
	TSSatisfiesExpression_jsL,
	TSNonNullExpression_jsL,
	TSTypeAssertion_jsL,
	TSInstantiationExpression_jsL,
	TSExportAssignment_jsL,
	TSImportEqualsDeclaration_tsL,
	TSExternalModuleReference_jsL,
	bareL,
	bareL,
	bareL,
	TSNamespaceExportDeclaration_jsL,
];
