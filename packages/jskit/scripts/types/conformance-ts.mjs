/**
 * @fileoverview Spot-check of the type analysis' claims against
 * `ts.TypeChecker`.
 *
 * The type analysis has no reference implementation to diff buffers against,
 * but its *claims* are checkable: every positive answer `Types` gives —
 * `isTypeOf()`, `isNullish()`, `isArray()`, `isTuple()`, `isAwaitable()` —
 * is a statement about runtime behavior that TypeScript's own checker can
 * confirm or contradict. This script runs a corpus through `inferTypes()`,
 * asks `Types` about every node the analysis recorded a type for, and holds
 * each positive claim up against `checker.getTypeAtLocation()` on the same
 * span.
 *
 * The comparison is one-directional by design. The analysis is syntax-
 * directed and conservative — silence is its answer whenever the program
 * does not state a type — so a node TypeScript can type and this analysis
 * cannot is correct behavior, not a miss. Only a positive claim the checker
 * contradicts is a defect.
 *
 * The checker runs with `noResolve`, so imports stay unresolved on both
 * sides: the analysis marks them foreign and claims nothing, and the
 * checker types them `any`, which this script skips as unjudgeable. That
 * keeps the comparison about what one file states, which is the analysis'
 * whole contract. Claims the checker cannot judge — a type involving
 * `any`, `unknown`, a type parameter, or a type-level operator — are
 * counted as `skipped` rather than graded.
 */

import ts from "typescript";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	analyze,
	AstReader,
	inferTypes,
	NODE_KIND_NAMES,
	NT_NODE,
	NT_TYPE,
	parse,
	Types,
	TypesBufferReader,
} from "../../dist/jskit.js";

/** The `typeof` answers `Types.isTypeOf()` accepts. */
const TYPEOF_NAMES = [
	"string",
	"number",
	"bigint",
	"boolean",
	"symbol",
	"undefined",
	"object",
	"function",
];

/**
 * Type flags the checker cannot be graded on: `any` and `unknown` admit
 * everything, `never` admits nothing, and the rest are type-level
 * machinery whose runtime category depends on an instantiation this
 * single-file view never sees.
 */
const UNJUDGEABLE =
	ts.TypeFlags.Any |
	ts.TypeFlags.Unknown |
	ts.TypeFlags.Never |
	ts.TypeFlags.TypeParameter |
	ts.TypeFlags.Index |
	ts.TypeFlags.IndexedAccess |
	ts.TypeFlags.Conditional |
	ts.TypeFlags.Substitution;

/**
 * Collects every TypeScript file under a directory.
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
		} else if (/\.(ts|mts|cts|tsx)$/u.test(name) && stats.size < 900_000) {
			out.push(full);
		}
	}

	return out;
}

/**
 * The `typeof` category of one non-union type, or `null` when the checker
 * cannot commit to one.
 * @param type The checker's type.
 * @param checker The checker it came from.
 * @returns The `typeof` answer values of the type produce, or `null`.
 */
function categoryOf(type, checker) {
	const flags = type.flags;

	if ((flags & UNJUDGEABLE) !== 0) {
		return null;
	}

	if ((flags & ts.TypeFlags.StringLike) !== 0) {
		return "string";
	}

	if ((flags & ts.TypeFlags.NumberLike) !== 0) {
		return "number";
	}

	if ((flags & ts.TypeFlags.BigIntLike) !== 0) {
		return "bigint";
	}

	if ((flags & ts.TypeFlags.BooleanLike) !== 0) {
		return "boolean";
	}

	if ((flags & ts.TypeFlags.ESSymbolLike) !== 0) {
		return "symbol";
	}

	if ((flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
		return "undefined";
	}

	if ((flags & ts.TypeFlags.Null) !== 0) {
		return "object";
	}

	/*
	 * An intersection with a callable member — `{ kind: K } & Validator` —
	 * is a function at runtime, and the checker resolves the combined
	 * signatures when asked about the intersection itself. Otherwise a
	 * primitive constituent pins the answer — `string & Brand` is a
	 * string, whichever side the brand is written on — and only an
	 * all-object intersection is an object.
	 */
	if (type.isIntersection()) {
		if (callableOf(type, checker)) {
			return "function";
		}

		let sawObject = false;

		for (const part of type.types) {
			const category = categoryOf(part, checker);

			if (category === null) {
				continue;
			}

			if (category === "object" || category === "function") {
				sawObject = true;
				continue;
			}

			return category;
		}

		return sawObject ? "object" : null;
	}

	if ((flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) !== 0) {
		return callableOf(type, checker) ? "function" : "object";
	}

	return null;
}

/**
 * Whether values of a type can be called or constructed, which is what
 * makes `typeof` answer `"function"`.
 * @param type The checker's type.
 * @param checker The checker it came from.
 * @returns `true` when the type has a call or construct signature.
 */
function callableOf(type, checker) {
	return (
		checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
		checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
	);
}

/**
 * The union constituents of a checker type, or the type itself.
 * @param type The checker's type.
 * @returns The constituents.
 */
function partsOf(type) {
	return type.isUnion() ? type.types : [type];
}

/**
 * Grades one `typeof` claim.
 * @param name The claimed `typeof` answer.
 * @param type The checker's type at the same node.
 * @param checker The checker it came from.
 * @returns `"agree"`, `"disagree"`, or `"skip"`.
 */
function gradeTypeOf(name, type, checker) {
	for (const part of partsOf(type)) {
		/*
		 * Declaration merging is outside the analysis' single-file
		 * contract: `interface ArrayConstructor` in one lib file gains its
		 * construct signatures from another, so what the checker knows
		 * about a multiply-declared symbol's structure is not what one
		 * file states. Structural claims on such a type are ungradeable.
		 */
		if (
			(name === "object" || name === "function") &&
			mergedElsewhere(part)
		) {
			return "skip";
		}

		const category = categoryOf(part, checker);

		if (category === null) {
			return "skip";
		}

		if (category !== name) {
			return "disagree";
		}
	}

	return "agree";
}

/**
 * Whether a type's symbol has more than one declaration — declaration
 * merging a single-file analysis never promises to see.
 * @param type The checker's type.
 * @returns `true` when the symbol is multiply declared.
 */
function mergedElsewhere(type) {
	const symbol = type.aliasSymbol ?? type.symbol;

	return Boolean(
		symbol !== undefined &&
		symbol.declarations !== undefined &&
		symbol.declarations.length > 1,
	);
}

/**
 * Grades a nullishness claim: every constituent must be `null`,
 * `undefined`, or `void`.
 * @param type The checker's type at the same node.
 * @returns `"agree"`, `"disagree"`, or `"skip"`.
 */
function gradeNullish(type) {
	const nullish =
		ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

	for (const part of partsOf(type)) {
		if ((part.flags & UNJUDGEABLE) !== 0) {
			return "skip";
		}

		if ((part.flags & nullish) === 0) {
			return "disagree";
		}
	}

	return "agree";
}

/**
 * Grades an array or tuple claim. A tuple counts as an array — that is what
 * `Array.isArray()` says — but not the other way around.
 * @param type The checker's type at the same node.
 * @param checker The checker it came from.
 * @param tuple Whether the claim was `isTuple()` rather than `isArray()`.
 * @returns `"agree"`, `"disagree"`, or `"skip"`.
 */
function gradeArray(type, checker, tuple) {
	for (const part of partsOf(type)) {
		if ((part.flags & UNJUDGEABLE) !== 0) {
			return "skip";
		}

		if (
			tuple
				? !checker.isTupleType(part)
				: !checker.isArrayType(part) && !checker.isTupleType(part)
		) {
			return "disagree";
		}
	}

	return "agree";
}

/**
 * Grades an awaitability claim: the non-nullable type must have a `then`
 * member, which is both what the analysis looked for and what `await`
 * dispatches on.
 * @param type The checker's type at the same node.
 * @param checker The checker it came from.
 * @returns `"agree"`, `"disagree"`, or `"skip"`.
 */
function gradeAwaitable(type, checker) {
	for (const part of partsOf(type)) {
		if ((part.flags & UNJUDGEABLE) !== 0) {
			return "skip";
		}
	}

	const then = checker.getNonNullableType(type).getProperty("then");

	return then === undefined ? "disagree" : "agree";
}

/**
 * Whether a node is a class or enum declaration, whose name binds a value
 * *and* declares a type.
 * @param tsNode The checker's node.
 * @returns `true` for a class or enum declaration.
 */
function declaresBoth(tsNode) {
	return (
		ts.isClassDeclaration(tsNode) ||
		ts.isClassExpression(tsNode) ||
		ts.isEnumDeclaration(tsNode)
	);
}

/**
 * The checker's type for a node, with one reconciliation: at a class or
 * enum declaration — and on its name — the checker answers with the *type*
 * the declaration declares, while the analysis records the binding's
 * *value*: the constructor, or the enum object. The symbol's value type is
 * the checker's spelling of the same answer.
 * @param tsNode The checker's node.
 * @param checker The checker it belongs to.
 * @returns The type to grade against.
 */
function typeAt(tsNode, checker) {
	let name = null;

	if (declaresBoth(tsNode) && tsNode.name !== undefined) {
		name = tsNode.name;
	} else if (
		ts.isIdentifier(tsNode) &&
		declaresBoth(tsNode.parent) &&
		tsNode.parent.name === tsNode
	) {
		name = tsNode;
	}

	if (name === null && ts.isIdentifier(tsNode)) {
		/*
		 * `class X extends Base` — the analysis reads `Base` as the value
		 * expression it is, the constructor, while the checker reports the
		 * heritage type. The symbol's value type is the checker's spelling
		 * of the constructor.
		 */
		const parent = tsNode.parent;

		if (
			(ts.isExpressionWithTypeArguments(parent) &&
				parent.expression === tsNode) ||
			ts.isExportAssignment(parent)
		) {
			name = tsNode;
		}
	}

	if (name !== null) {
		const symbol = checker.getSymbolAtLocation(name);

		if (symbol !== undefined) {
			return checker.getTypeOfSymbolAtLocation(symbol, tsNode);
		}
	}

	return checker.getTypeAtLocation(tsNode);
}

/**
 * Maps every span in a TypeScript source file to the deepest node covering
 * exactly that span, which is how a typed node in the buffer finds its
 * counterpart: children are visited after their parents, so the last node
 * written for a span is the innermost one — the `Identifier` rather than
 * the `ExpressionStatement` wrapped around it.
 * @param sourceFile The checker's source file.
 * @returns Spans (`start:end`) to nodes.
 */
function spansOf(sourceFile) {
	const spans = new Map();

	const visit = node => {
		spans.set(`${node.getStart(sourceFile)}:${node.getEnd()}`, node);
		node.forEachChild(visit);
	};

	visit(sourceFile);

	return spans;
}

const root = resolve(process.argv[2] ?? "../../node_modules");
const files = walk(root).slice(0, Number(process.argv[3] ?? 400));

const options = {
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	jsx: ts.JsxEmit.Preserve,
	strict: true,
	noResolve: true,
	skipLibCheck: true,
};

/*
 * One program per file, because the analysis is per-file by contract: one
 * shared program would let the checker see cross-file interface merging —
 * `interface BufferConstructor` gaining its construct signatures from a
 * sibling declaration file — that a single-file analysis never promises
 * to know about. The host caches parsed source files, so the standard
 * library is parsed and bound once rather than per program.
 */
const host = ts.createCompilerHost(options);
const sourceCache = new Map();
const uncachedGetSourceFile = host.getSourceFile.bind(host);

host.getSourceFile = (name, languageVersion, ...rest) => {
	let cached = sourceCache.get(name);

	if (cached === undefined) {
		cached = uncachedGetSourceFile(name, languageVersion, ...rest);
		sourceCache.set(name, cached);
	}

	return cached;
};

const tally = {
	files: 0,
	claims: 0,
	agree: 0,
	disagree: 0,
	skipped: 0,
	unmatched: 0,
	threw: 0,
};
const seen = new Set();

/**
 * Records one graded claim, printing the first case of each distinct
 * disagreement.
 * @param grade How the claim came out.
 * @param detail What to print when it disagreed.
 * @returns Nothing.
 */
function record(grade, detail) {
	tally.claims++;

	if (grade === "agree") {
		tally.agree++;
		return;
	}

	if (grade === "skip") {
		tally.skipped++;
		return;
	}

	tally.disagree++;

	const key = detail().replace(/^DIFF \S+/u, "");

	if (!seen.has(key)) {
		seen.add(key);
		console.log(detail());
	}
}

for (const file of files) {
	const program = ts.createProgram([file], options, host);
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(file);

	if (sourceFile === undefined) {
		continue;
	}

	/*
	 * A file TypeScript itself cannot parse cleanly is out of scope: its
	 * recovered tree types nothing trustworthy, and the parser rejecting
	 * it outright is not a defect. `threw` below then means what it
	 * should — a file the checker parses and this toolkit does not.
	 */
	if (program.getSyntacticDiagnostics(sourceFile).length > 0) {
		continue;
	}

	const code = sourceFile.text;
	const jsx = /\.tsx$/u.test(file);
	let queries;
	let buffer;
	let ast;

	try {
		const parsed = parse(code, { sourceType: "module", jsx });
		const scope = analyze(parsed, {
			sourceType: "module",
			dialect: "ts",
			jsx,
		});
		const types = inferTypes(parsed, scope);

		queries = new Types(types, parsed);
		buffer = new TypesBufferReader(types);
		ast = new AstReader(parsed);
	} catch (error) {
		tally.threw++;

		const key = `T${error.message.slice(0, 80)}`;

		if (!seen.has(key)) {
			seen.add(key);
			console.log(`THROW ${file}: ${error.message}`);
		}

		continue;
	}

	tally.files++;

	let spans = null;

	for (let entry = 0; entry < buffer.nodeTypeCount; entry++) {
		const handle = buffer.nodeTypeField(entry, NT_NODE);
		const typeId = buffer.nodeTypeField(entry, NT_TYPE);
		const node = (handle / 4 - ast.nodesBase) / ast.nodeWords;

		/*
		 * Collect the positive claims first: most recorded types make at
		 * least one, but a node that makes none needs no checker time.
		 */
		const typeofClaims = TYPEOF_NAMES.filter(name =>
			queries.isTypeOfById(typeId, name),
		);
		const nullish = queries.isNullishById(typeId);
		const array = queries.isArrayById(typeId);
		const tuple = queries.isTupleById(typeId);
		const awaitable = queries.isAwaitableById(typeId);

		if (
			typeofClaims.length === 0 &&
			!nullish &&
			!array &&
			!tuple &&
			!awaitable
		) {
			continue;
		}

		spans ??= spansOf(sourceFile);

		const start = ast.start(node);
		const end = ast.end(node);
		const tsNode = spans.get(`${start}:${end}`);

		if (tsNode === undefined) {
			tally.unmatched++;
			continue;
		}

		const tsType = typeAt(tsNode, checker);

		const detail = claim => () =>
			`DIFF ${file}:${start}-${end} ${NODE_KIND_NAMES[ast.kind(node)]} ` +
			`claim=${claim} jskit=${queries.typeToStringById(typeId)} ` +
			`ts=${checker.typeToString(tsType)}`;

		for (const name of typeofClaims) {
			record(
				gradeTypeOf(name, tsType, checker),
				detail(`typeof-${name}`),
			);
		}

		if (nullish) {
			record(gradeNullish(tsType), detail("nullish"));
		}

		if (array) {
			record(gradeArray(tsType, checker, false), detail("array"));
		}

		if (tuple) {
			record(gradeArray(tsType, checker, true), detail("tuple"));
		}

		if (awaitable) {
			record(gradeAwaitable(tsType, checker), detail("awaitable"));
		}
	}
}

console.log(
	`files=${tally.files} claims=${tally.claims} agree=${tally.agree} ` +
		`disagree=${tally.disagree} skipped=${tally.skipped} ` +
		`unmatched=${tally.unmatched} threw=${tally.threw}`,
);

if (tally.disagree > 0) {
	process.exitCode = 1;
}
