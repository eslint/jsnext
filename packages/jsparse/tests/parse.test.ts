/**
 * @fileoverview Tests for the `parse()` entry point and the binary buffer.
 */

import { describe, expect, it } from "vitest";
import {
	ParseError,
	parse,
	readLineStarts,
	readParents,
	toAST,
} from "../src/index.js";
import { AstReader, TokenReader } from "../src/reader.js";
import {
	NODE_A,
	NODE_B,
	NODE_C,
	NO_NODE,
	N_BinaryExpression,
	N_NewExpression,
	N_Program,
} from "../src/node-kinds.js";
import { SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE } from "../src/slots.js";

describe("parse()", () => {
	it("returns one buffer holding everything the parse produced", () => {
		const result = parse("var a = 1;");

		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(new AstReader(result).nodeCount).toBeGreaterThan(1);
		expect(new TokenReader(result).count).toBeGreaterThan(1);
		expect(readLineStarts(result)).toBeInstanceOf(Uint32Array);
	});

	it("records the offset of every line start", () => {
		const result = parse("a;\nb;\r\nc; d;");

		expect(Array.from(readLineStarts(result))).toEqual([0, 3, 7, 10]);
	});

	it("counts a lone carriage return as one line break", () => {
		const result = parse("a;\rb;");

		expect(Array.from(readLineStarts(result))).toEqual([0, 3]);
	});

	it("produces a readable binary AST rooted at a Program", () => {
		const reader = new AstReader(parse("a;"));

		expect(reader.kind(reader.root)).toBe(N_Program);
		expect(reader.source).toBe("a;");
	});

	it("includes comments in the token region", () => {
		const result = parse("// one\na; /* two */");
		const reader = new TokenReader(result);

		expect(reader.count).toBeGreaterThan(3);
	});

	it("rejects a buffer that is not a parse buffer", () => {
		const foreign = new ArrayBuffer(64);

		expect(() => new AstReader(foreign)).toThrow(TypeError);
		expect(() => new TokenReader(foreign)).toThrow(TypeError);
		expect(() => readLineStarts(foreign)).toThrow(TypeError);
		expect(() => readParents(foreign)).toThrow(TypeError);
	});
});

describe("parent lookup", () => {
	it("is not built unless it is asked for", () => {
		const result = parse("a + b;");
		const reader = new AstReader(result);

		/*
		 * Reporting `NO_NODE` instead would say every node is unreachable,
		 * which is a legitimate answer for a record that is not in the tree
		 * and would be indistinguishable from one.
		 */
		expect(() => readParents(result)).toThrow(/carries no parent table/u);
		expect(() => reader.parent(reader.root)).toThrow(
			/carries no parent table/u,
		);

		// Everything else about the buffer still works.
		expect(reader.kind(reader.root)).toBe(N_Program);
		expect(reader.text(reader.root)).toBe("a + b;");
	});

	it("costs the buffer nothing when it is off", () => {
		const code = "const answer = 42;";
		const nodeCount = new AstReader(parse(code)).nodeCount;

		expect(
			parse(code, { parents: true }).byteLength -
				parse(code).byteLength,
		).toBe(nodeCount * 4);
	});

	/*
	 * Reaches the shapes the table is built from: list slots, an array hole,
	 * a node aliased into two slots by a shorthand specifier, and TypeScript
	 * kinds whose children sit in the later slots.
	 */
	const PROGRAM = `
		import { a } from "./m.js";
		const [x, , z] = [1, 2, 3];
		class C<T> extends D implements E { #p: T; m(q = 2) { return this.#p; } }
		label: for (const k of items) { if (k) continue label; }
		export default async (): Promise<void> => { await new Promise<void>(r => r()); };
	`;

	it("points every node at the one that holds it", () => {
		const reader = new AstReader(parse("a + b;", { parents: true }));
		const program = reader.root;
		const statement = reader.listItem(reader.field(program, NODE_A), 0);
		const binary = reader.field(statement, NODE_A);

		/*
		 * The list slot of a `Program` and the node slots below it are both
		 * followed, so the chain is complete from the deepest identifier up.
		 */
		expect(reader.kind(binary)).toBe(N_BinaryExpression);
		expect(reader.parent(reader.field(binary, NODE_A))).toBe(binary);
		expect(reader.parent(reader.field(binary, NODE_B))).toBe(binary);
		expect(reader.parent(binary)).toBe(statement);
		expect(reader.parent(statement)).toBe(program);
	});

	it("leaves the root without a parent", () => {
		const reader = new AstReader(parse("a;", { parents: true }));

		expect(reader.parent(reader.root)).toBe(NO_NODE);
	});

	it("agrees with the table the buffer carries", () => {
		const result = parse(PROGRAM, { parents: true });
		const reader = new AstReader(result);
		const parents = readParents(result);

		expect(parents).toHaveLength(reader.nodeCount);

		for (let node = 1; node < reader.nodeCount; node++) {
			expect(reader.parent(node)).toBe(parents[node]);
		}
	});

	it("gives every node a parent whose extent contains it", () => {
		const reader = new AstReader(parse(PROGRAM, { parents: true }));

		for (let node = 1; node < reader.nodeCount; node++) {
			const parent = reader.parent(node);

			if (parent === NO_NODE) {
				continue;
			}

			expect(reader.start(parent)).toBeLessThanOrEqual(
				reader.start(node),
			);
			expect(reader.end(parent)).toBeGreaterThanOrEqual(reader.end(node));
		}
	});

	it("reaches the root from every node the tree contains", () => {
		const reader = new AstReader(parse(PROGRAM, { parents: true }));
		const visit = (node: number, expected: number): void => {
			expect(reader.parent(node)).toBe(expected);

			const base = reader.kind(node) * SLOT_COUNT;

			for (let slot = 0; slot < SLOT_COUNT; slot++) {
				const descriptor = SLOT_TABLE[base + slot];
				const value = reader.field(node, NODE_A + slot);

				if (descriptor === SLOT_NODE && value !== NO_NODE) {
					visit(value, node);
				} else if (descriptor === SLOT_LIST) {
					for (let i = 0; i < reader.listSize(value); i++) {
						const item = reader.listItem(value, i);

						if (item !== NO_NODE) {
							visit(item, node);
						}
					}
				}
			}
		};

		visit(reader.root, NO_NODE);
	});

	it("never names a node the parser abandoned", () => {
		/*
		 * `new Map<string, number>()` parses its callee as an instantiation
		 * expression and then unwraps it, so the abandoned wrapper is the one
		 * record whose slots could still name children that now belong to
		 * something else. It is discarded for exactly that reason.
		 */
		const reader = new AstReader(parse("new Map<string, number>();", {
			parents: true,
		}));

		for (let node = 1; node < reader.nodeCount; node++) {
			if (reader.kind(node) !== N_NewExpression) {
				continue;
			}

			const callee = reader.field(node, NODE_A);
			const typeArguments = reader.field(node, NODE_C);

			expect(reader.parent(callee)).toBe(node);
			expect(reader.parent(typeArguments)).toBe(node);
		}

		for (let node = 1; node < reader.nodeCount; node++) {
			const parent = reader.parent(node);

			expect(parent === NO_NODE || reader.kind(parent) !== 0).toBe(true);
		}
	});

	it("survives a transfer, since the table is in the buffer", () => {
		const transferred = parse(PROGRAM, { embedSource: true, parents: true }).slice(0);
		const reader = new AstReader(transferred);
		const first = reader.listItem(reader.field(reader.root, NODE_A), 0);

		expect(reader.parent(reader.root)).toBe(NO_NODE);
		expect(reader.parent(first)).toBe(reader.root);
	});
});

describe("syntax errors", () => {
	it("throws a ParseError with a line and column", () => {
		let thrown: unknown;

		try {
			parse("var a = ;");
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(ParseError);

		const error = thrown as ParseError;

		expect(error.lineNumber).toBe(1);
		expect(error.column).toBe(9);
		expect(error.index).toBe(8);
		expect(error.message).toContain("(1:9)");
	});

	it("reports the position on a later line", () => {
		let thrown: ParseError | undefined;

		try {
			parse("a;\nb;\nc d e");
		} catch (error) {
			thrown = error as ParseError;
		}

		expect(thrown?.lineNumber).toBe(3);
	});

	it("throws for an unterminated string", () => {
		expect(() => parse('"abc')).toThrow(/Unterminated string/u);
	});

	it("throws for an unterminated comment", () => {
		expect(() => parse("/* abc")).toThrow(/Unterminated comment/u);
	});

	it("throws for an unterminated regular expression", () => {
		expect(() => parse("var re = /abc")).toThrow(
			/Unterminated regular expression/u,
		);
	});

	it("throws for an unexpected character", () => {
		expect(() => parse("a   b")).toThrow(/Unexpected character/u);
	});

	it("throws for a number that runs into an identifier", () => {
		expect(() => parse("3in")).toThrow(/Identifier directly after number/u);
	});

	/*
	 * A string has no reading in which a malformed `\x` or `\u` is legal, so
	 * the tokenizer is where this ends. A template is the other case: an
	 * escape it cannot read leaves the parse standing, because a tag may
	 * still be applied to it.
	 */
	it("throws for a malformed escape in a string", () => {
		for (const escape of [
			"\\u1",
			"\\u",
			"\\u000G",
			"\\u{}",
			"\\u{1F_639}",
			"\\u{110000}",
			"\\x1",
			"\\xZZ",
		]) {
			expect(() => parse(`"${escape}"`)).toThrow(
				/Invalid escape sequence/u,
			);
		}
	});

	it("accepts the escapes a string may hold", () => {
		for (const escape of [
			"\\u0041",
			"\\x41",
			"\\u{41}",
			"\\u{0000000041}",
			"\\u{10FFFF}",
			"\\1",
			"\\8",
		]) {
			expect(() =>
				parse(`"${escape}"`, { sourceType: "script" }),
			).not.toThrow();
		}
	});

	it("does not throw for a malformed escape in a template", () => {
		expect(() => parse("tag`\\u1`")).not.toThrow();
	});

	/*
	 * An escape inside an identifier stands for a letter and only for a
	 * letter, so it is held to the same tables the character would have been:
	 * `IdentifierStart` where the word begins, `IdentifierPart` after that.
	 * This is what stops `\\u0023x` from being another way to write `#x`.
	 */
	it("throws for an identifier escape that names a character it may not", () => {
		for (const code of [
			"var \\u0000;",
			"var \\u200D_x;",
			"var \\u{110000};",
			"var \\u{7F};",
			"class C { \\u0023f; }",
			"class C { #\\u0023x; }",
			"a.\\u0023b;",
		]) {
			expect(() => parse(code, { sourceType: "script" })).toThrow(
				/Invalid escape sequence in identifier/u,
			);
		}
	});

	/*
	 * `ClassHeritage : extends LeftHandSideExpression`, and an arrow is an
	 * `AssignmentExpression`. Only the async form gets far enough to need
	 * this: `class C extends x => x {}` stops at the `=>` on its own.
	 */
	it("throws for a class extending an arrow function", () => {
		expect(() => parse("class C extends async () => {} {}")).toThrow(
			/may not extend an arrow function/u,
		);
	});

	it("still takes the heritage clauses that are expressions", () => {
		for (const code of [
			"class C extends (async () => {}) {}",
			"class C extends Mix(A, B) {}",
			"class C extends a.b {}",
		]) {
			expect(() => parse(code)).not.toThrow();
		}
	});

	/*
	 * Three places the grammar writes `[no LineTerminator here]`. Each one
	 * exists so that automatic semicolon insertion cannot reach across and
	 * change what the line means.
	 */
	it("throws for a line terminator the grammar forbids", () => {
		for (const code of [
			"function* g() { yield\n* 1; }",
			"var af = ()\n=> {};",
			"var f = (x)\n=> {};",
			"var f = x\n=> {};",
			"({ async\nfoo() {} });",
			"async\n() => 1;",
		]) {
			expect(() => parse(code, { sourceType: "script" })).toThrow();
		}
	});

	/*
	 * Only `async` carries the restriction among the property-name prefixes,
	 * and a class body sidesteps it: `async` on a line of its own is a field
	 * called `async`, with the method after it.
	 */
	it("accepts a line terminator where none is forbidden", () => {
		for (const code of [
			"function* g() { yield\n1; }",
			"({ get\nx() {} });",
			"({ set\nx(v) {} });",
			"({ *\ng() {} });",
			"class C { async\nx() {} }",
		]) {
			expect(() => parse(code, { sourceType: "script" })).not.toThrow();
		}
	});

	/*
	 * `ExponentiationExpression` takes an `UpdateExpression` on the left, and
	 * `CoalesceExpression` takes a `BitwiseORExpression` on either side. Both
	 * refuse an operand whose reading would be a guess, and parentheses are
	 * what settle it.
	 */
	it("throws for a unary expression as the base of an exponentiation", () => {
		for (const code of [
			"-a ** b;",
			"+a ** b;",
			"!a ** b;",
			"~a ** b;",
			"typeof a ** b;",
			"void a ** b;",
			"delete a.b ** c;",
			"async function f() { await a ** b; }",
		]) {
			expect(() => parse(code, { sourceType: "script" })).toThrow(
				/may not be the base of an exponentiation/u,
			);
		}
	});

	it("throws for '??' mixed with '||' or '&&'", () => {
		for (const code of [
			"a ?? b || c;",
			"a ?? b && c;",
			"a || b ?? c;",
			"a && b ?? c;",
		]) {
			expect(() => parse(code, { sourceType: "script" })).toThrow(
				/may not be mixed with/u,
			);
		}
	});

	it("accepts each of them once parentheses settle the reading", () => {
		for (const code of [
			"(-a) ** b;",
			"a ** -b;",
			"a-- ** b;",
			"a ** b ** c;",
			"(a ?? b) || c;",
			"a ?? (b || c);",
			"a ?? (b && c);",
			"a ?? b ?? c;",
			"a && b || c;",
		]) {
			expect(() => parse(code, { sourceType: "script" })).not.toThrow();
		}
	});

	/*
	 * `DecimalIntegerLiteral` admits a separator only after a `NonZeroDigit`,
	 * so a lone `0` ends the integer part. The other bases are unaffected:
	 * `0x1_0` separates hex digits rather than the leading zero.
	 */
	it("throws for a numeric separator against a leading zero", () => {
		for (const code of ["0_0;", "0_9;", "0_1n;", "0_;"]) {
			expect(() => parse(code, { sourceType: "script" })).toThrow(
				/Numeric separator is not allowed after a leading 0/u,
			);
		}
	});

	it("accepts a separator everywhere one may go", () => {
		for (const code of [
			"1_0;",
			"1_000;",
			"0x1_0;",
			"0b1_0;",
			"0o1_0;",
			"0.1_1;",
			"1_0e1_0;",
			"0;",
			"0n;",
		]) {
			expect(() => parse(code, { sourceType: "script" })).not.toThrow();
		}
	});

	it("accepts an identifier escape that names one it may", () => {
		for (const code of [
			"var \\u0061;",
			"var \\u{61};",
			"var \\u{0000000061};",
			"var \\u0041a;",
			"var a\\u200D;",
			"var a\\u200C;",
			"class C { #\\u0061; }",
		]) {
			expect(() => parse(code, { sourceType: "script" })).not.toThrow();
		}
	});

	/*
	 * `new` takes a `MemberExpression` and `import(...)` is a call, so there
	 * is no tree to build for the pair — which is what puts this in `parse()`
	 * rather than beside the other rules about `import`.
	 */
	it("throws for new applied to a dynamic import", () => {
		expect(() => parse("new import('m');")).toThrow(
			/'new' cannot be applied to a dynamic import/u,
		);
	});

	it("does not throw when parentheses give the call its own expression", () => {
		expect(() => parse("new (import('m'));")).not.toThrow();
		expect(() => parse("new import.meta.Foo();")).not.toThrow();
	});

	it("does not throw for problems that validation handles", () => {
		expect(() => parse("with (a) { b; }")).not.toThrow();
		expect(() => parse("let a; let a;")).not.toThrow();
		expect(() => parse("let a: number = 1;")).not.toThrow();
	});
});

describe("toAST()", () => {
	it("attaches tokens and comments to the program", () => {
		const { ast } = toAST(parse("// hi\na;"), { dialect: "js" });

		expect(ast.sourceType).toBe("module");
		expect(ast.comments).toHaveLength(1);
		expect(ast.tokens).toHaveLength(2);
	});

	it("reports the requested source type", () => {
		const { ast } = toAST(parse("a;", { sourceType: "script" }));

		expect(ast.sourceType).toBe("script");
	});

	it("takes the source type from the buffer when none is given", () => {
		expect(toAST(parse("a;")).ast.sourceType).toBe("module");
		expect(
			toAST(parse("a;", { sourceType: "commonjs" })).ast.sourceType,
		).toBe("commonjs");
	});

	it("narrows script to commonjs, which parse the same way", () => {
		const { ast } = toAST(parse("a;", { sourceType: "script" }), {
			sourceType: "commonjs",
		});

		expect(ast.sourceType).toBe("commonjs");
	});

	it("refuses a source type the buffer was not parsed as", () => {
		expect(() =>
			toAST(parse("a;", { sourceType: "module" }), {
				sourceType: "script",
			}),
		).toThrow(/cannot be read as "script"/u);
	});

	it("returns validation errors alongside the AST", () => {
		const { ast, errors } = toAST(
			parse("import a from 'b';", { sourceType: "script" }),
		);

		expect(ast.type).toBe("Program");
		expect(errors).toHaveLength(1);
	});
});

describe("program extent", () => {
	/**
	 * The offsets a program covers in one dialect.
	 * @param code The source text to parse.
	 * @param dialect Which dialect to decode in.
	 * @returns The program's start and end.
	 */
	function extent(
		code: string,
		dialect: "js" | "ts",
	): [number | undefined, number | undefined] {
		const { ast } = toAST(parse(code), { dialect });

		return [ast.start, ast.end];
	}

	/*
	 * `@typescript-eslint/parser` runs a program to the end of the source and
	 * `espree` trims it to its statements. Both dialects report `espree`'s
	 * answer here; see `docs/deviations.md`.
	 */
	it("trims a program to its first and last statement", () => {
		expect(extent("  a;  ", "js")).toEqual([2, 4]);
		expect(extent("  a;  ", "ts")).toEqual([2, 4]);
	});

	it("excludes a leading comment and a trailing one", () => {
		expect(extent("/* a */ b; // c", "js")).toEqual([8, 10]);
		expect(extent("/* a */ b; // c", "ts")).toEqual([8, 10]);
	});

	it("excludes a hashbang", () => {
		expect(extent("#!/usr/bin/env node\na;", "ts")).toEqual([20, 22]);
	});

	it("gives an empty program the whole text", () => {
		expect(extent("// only a comment", "js")).toEqual([0, 17]);
		expect(extent("// only a comment", "ts")).toEqual([0, 17]);
		expect(extent("", "ts")).toEqual([0, 0]);
	});

	it("agrees between the two dialects", () => {
		for (const code of ["a;", "  a;  ", "\n\na;\n\n", "", "/* c */"]) {
			expect(extent(code, "ts")).toEqual(extent(code, "js"));
		}
	});
});

describe("embedSource", () => {
	/** A program with a name and a string worth reading back. */
	const CODE = "const answer = \"forty-two\";";

	/**
	 * Copies a buffer's bytes into a fresh `ArrayBuffer`, which is what a
	 * consumer sees after a transfer or a round trip through disk: the same
	 * bytes, a different object, and nothing left in the source cache.
	 * @param buffer The buffer to copy.
	 * @returns An equivalent buffer that this process never parsed into.
	 */
	function asIfTransferred(buffer: ArrayBuffer): ArrayBuffer {
		return buffer.slice(0);
	}

	it("leaves the text out by default", () => {
		const bare = parse(CODE);
		const embedded = parse(CODE, { embedSource: true });

		// Two bytes per code unit, rounded up to keep the buffer word-aligned.
		expect(embedded.byteLength - bare.byteLength).toBe(
			Math.ceil((CODE.length * 2) / 4) * 4,
		);
	});

	it("reads text off either buffer in the parsing process", () => {
		for (const result of [parse(CODE), parse(CODE, { embedSource: true })]) {
			const reader = new AstReader(result);

			expect(reader.source).toBe(CODE);
			expect(reader.text(reader.root)).toBe(CODE);
		}
	});

	it("survives a transfer when the text was embedded", () => {
		const result = parse(CODE, { embedSource: true });
		const reader = new AstReader(asIfTransferred(result));

		expect(reader.source).toBe(CODE);
	});

	it("refuses loudly after a transfer when it was not", () => {
		const result = parse(CODE);
		const reader = new AstReader(asIfTransferred(result));

		expect(() => reader.source).toThrow(/carries no source text/u);
		expect(() => reader.source).toThrow(/embedSource/u);
	});

	it("still walks structure after a transfer without the text", () => {
		const result = parse(CODE);
		const reader = new AstReader(asIfTransferred(result));

		/*
		 * Kinds, extents, and child slots are all integers, so a consumer that
		 * never asks for text works on a buffer that carries none. This is why
		 * the source is resolved on first use rather than in the constructor.
		 */
		expect(reader.kind(reader.root)).toBe(N_Program);
		expect(reader.start(reader.root)).toBe(0);
		expect(reader.end(reader.root)).toBe(CODE.length);
		expect(reader.nodeCount).toBeGreaterThan(1);
	});

	it("produces the same nodes either way", () => {
		const bare = new AstReader(parse(CODE));
		const embedded = new AstReader(parse(CODE, { embedSource: true }));

		expect(bare.nodeCount).toBe(embedded.nodeCount);

		for (let node = 1; node < bare.nodeCount; node++) {
			expect(bare.kind(node)).toBe(embedded.kind(node));
			expect(bare.start(node)).toBe(embedded.start(node));
			expect(bare.end(node)).toBe(embedded.end(node));
		}
	});

	it("decodes to the same tree either way", () => {
		expect(toAST(parse(CODE)).ast).toEqual(
			toAST(parse(CODE, { embedSource: true })).ast,
		);
	});

	it("caches the text where another copy of this module can find it", () => {
		/*
		 * `@eslint/jsscope` bundles its own copy of the reader, so the cache
		 * has to be reachable from a different module instance in the same
		 * realm — otherwise `analyze(parse(code))` across the two packages
		 * would look like a transfer and refuse a buffer that is right there.
		 * The registry symbol is what makes that work; a `WeakMap` would not.
		 */
		const key = Symbol.for("@eslint/jsparse.source");
		const result = parse(CODE);

		expect((result as ArrayBuffer & Record<symbol, string>)[key]).toBe(
			CODE,
		);

		// And it does not survive the crossings that really do lose the text.
		expect(
			(
				result.slice(0) as ArrayBuffer &
					Record<symbol, string | undefined>
			)[key],
		).toBeUndefined();
	});
});

describe("modifiers with nowhere to go", () => {
	/*
	 * One node holds one accessibility, in two bits, so `public private x`
	 * would pack to the value `protected` and read back as a member the
	 * program never wrote. There is no tree for it, which is what puts these
	 * two in `parse()` rather than in `validate()`.
	 */
	it("rejects a repeated accessibility modifier", () => {
		expect(() => parse("class C { public private x = 1; }")).toThrow(
			/accessibility modifier may only be written once/u,
		);
	});

	it("rejects accessor on a method", () => {
		expect(() => parse("class C { accessor m() {} }")).toThrow(
			/'accessor' modifier may only appear on a class field/u,
		);
	});

	it("still accepts one accessibility modifier", () => {
		expect(() => parse("class C { private x = 1; }")).not.toThrow();
	});

	it("still accepts accessor on a field", () => {
		expect(() => parse("class C { accessor x = 1; }")).not.toThrow();
	});
});
