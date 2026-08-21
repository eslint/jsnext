/**
 * @fileoverview The validation phase.
 *
 * Parsing accepts the union of everything JavaScript and TypeScript allow.
 * This pass walks the result and reports the problems that only become
 * problems once you know how the program is meant to be interpreted: the
 * source type, the dialect, whether strict mode is in effect, and what names
 * are already bound in the surrounding scope.
 */

import {
	LIT_BIGINT,
	LIT_NUMBER,
	LIT_REGEXP,
	LIT_STRING,
	DECL_AWAIT_USING,
	DECL_CONST,
	ACCESS_MASK,
	DECL_KIND_NAMES,
	DECL_USING,
	DECL_MASK,
	DECL_SHIFT,
	DECL_VAR,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_F,
	MKIND_CONSTRUCTOR,
	MKIND_GET,
	MKIND_MASK,
	MKIND_SET,
	MKIND_SHIFT,
	MODULE_KIND_MASK,
	MODULE_KIND_SHIFT,
	MODULE_MODULE,
	NF_ASYNC,
	NF_COMMA_AFTER_REST,
	NF_COMPUTED,
	NF_DECLARE,
	NF_DEFINITE,
	NF_GENERATOR,
	NF_IN,
	NF_READONLY,
	NF_IDENTIFIER_NAME,
	NF_INVALID_ESCAPE,
	NF_LEGACY_OCTAL,
	NF_METHOD,
	NF_OPTIONAL,
	NF_PARENTHESIZED,
	NF_SHORTHAND,
	NF_STATIC,
	NF_TYPE_ONLY,
	TS_FIRST,
	N_AccessorProperty,
	N_ArrayPattern,
	N_AssignmentExpression,
	N_AwaitExpression,
	N_YieldExpression,
	N_AssignmentPattern,
	N_BinaryExpression,
	N_BlockStatement,
	N_BreakStatement,
	N_CallExpression,
	N_ChainExpression,
	N_CatchClause,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ContinueStatement,
	N_DoWhileStatement,
	N_ExportAllDeclaration,
	N_ExportDefaultDeclaration,
	N_ExportNamedDeclaration,
	N_ExportSpecifier,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_ArrowFunctionExpression,
	N_Identifier,
	N_IfStatement,
	N_ImportDeclaration,
	N_ImportDefaultSpecifier,
	N_ImportSpecifier,
	N_JSXElement,
	N_JSXFragment,
	N_LabeledStatement,
	N_Literal,
	N_ObjectExpression,
	N_ObjectPattern,
	N_Program,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_ReturnStatement,
	N_StaticBlock,
	N_Super,
	N_SwitchStatement,
	N_TaggedTemplateExpression,
	N_TemplateLiteral,
	N_TSAbstractPropertyDefinition,
	N_TSAbstractAccessorProperty,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_TSEnumDeclaration,
	N_TSImportEqualsDeclaration,
	N_TSEnumMember,
	N_TSInterfaceDeclaration,
	N_TSIndexSignature,
	N_TSLiteralType,
	N_TSParameterProperty,
	N_TSModuleBlock,
	N_TSModuleDeclaration,
	N_TSTypeAliasDeclaration,
	N_TSTypeParameterDeclaration,
	N_TSTypeParameterInstantiation,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_WhileStatement,
	N_MemberExpression,
	N_MetaProperty,
	N_MethodDefinition,
	N_PrivateIdentifier,
	N_TSAbstractMethodDefinition,
	N_TSAsExpression,
	N_TSNonNullExpression,
	N_TSSatisfiesExpression,
	N_TSTypeAssertion,
	N_UnaryExpression,
	N_UpdateExpression,
	N_WithStatement,
	NODE_KIND_COUNT,
} from "./node-kinds.js";
import { AstReader } from "./reader.js";
import { RegExpValidator } from "./regexp.js";
import { decodeEscapes } from "./values.js";
import { SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE } from "./slots.js";
import {
	KEYWORD_FIRST,
	KEYWORD_LAST,
	KEYWORD_NAMES,
	KIND_KEYWORD_FLAGS,
	KW_RESERVED,
	KW_STRICT_RESERVED,
	T_ASSIGN,
	T_ASSIGN_AMPAMP,
	T_await,
	T_delete,
	T_in,
	T_this,
	T_yield,
	lookupKeyword,
	hashChar,
} from "./token-kinds.js";

/** A problem found during validation. */
export interface ValidationProblem {
	message: string;
	start: number;
}

/**
 * How a binding was introduced, which decides what may shadow it.
 *
 * `BINDING_VAR` never appears in a scope's `names`; a `var` is recorded in
 * `varNames` instead, because it is the only kind that binds somewhere other
 * than where it is written.
 */
const BINDING_VAR = 0;
const BINDING_LEXICAL = 1;
const BINDING_FUNCTION = 2;
const BINDING_PARAM = 3;
const BINDING_TYPE = 4;
const BINDING_SIGNATURE = 5;
const BINDING_CATCH = 6;

/**
 * An ambient class, which is a lexical binding that a signature may merge
 * with. `declare function f(): void; declare class f {}` declares one thing
 * twice over; drop either `declare` and TypeScript reports the pair.
 */
const BINDING_AMBIENT_CLASS = 7;

/**
 * A generator or async function declaration, which binds exactly as a plain
 * one does everywhere but Annex B. The web-legacy rule that lets two function
 * declarations share a block in sloppy code names `FunctionDeclaration`
 * alone, so a `function*` or an `async function` beside another declaration
 * of the same name is a redeclaration however the code is written.
 */
const BINDING_ASYNC_OR_GENERATOR = 8;

/** The character that hides a letter, as in `yield`. */
const CH_BACKSLASH = 0x5c;

/**
 * The letters `arguments` and `eval` begin with.
 *
 * Either word may be written with an escape, and one written that way begins
 * with the backslash that hides its first letter instead, so three characters
 * rule out every identifier that is neither word.
 */
const CH_a = 0x61;
const CH_e = 0x65;

/** The letter `this` begins with. */
const CH_t = 0x74;

/**
 * Which characters an identifier that might be a reserved word can start with.
 *
 * The words are `await`, `implements`, `interface`, `let`, `package`,
 * `private`, `protected`, `public`, `static`, and `yield`, so six letters
 * cover all of them — plus the backslash, for a first letter written as an
 * escape. Indexed by character code; anything outside ASCII cannot begin one.
 */
const RESERVED_INITIALS = /* @__PURE__ */ buildReservedInitials();

/**
 * Which node kinds `check()` has a case for, indexed by kind.
 *
 * The walk consults this before calling `check()` at all. Most nodes in a
 * real program — blocks, declarators, expressions with no rule of their own,
 * and every type node — have nothing to check, and the call and its fifty-arm
 * dispatch are a measurable share of a validation when they are paid on every
 * node. A kind missing from `buildCheckedKinds()` skips `check()` entirely
 * except under `dialect: "js"`, where every TypeScript kind still reaches the
 * report at the top; **a new `case` in `check()` must be added there too.**
 */
const CHECKED_KINDS = /* @__PURE__ */ buildCheckedKinds();

/**
 * Which node kinds `visit()` has a case of its own for, indexed by kind.
 *
 * Only twenty-nine kinds change the walk's state — functions, classes,
 * scopes, loops, labels, JSX — and everything else just descends into its
 * children. The dispatch below the table is a sparse switch, which compiles
 * to a chain of compares rather than a jump table, so the majority of nodes
 * skip it entirely via one table read. **A new `case` in `visit()`'s switch
 * must be added here too**; miss it and the case is silently never taken,
 * which the conformance suites catch.
 */
const VISIT_CASES = /* @__PURE__ */ buildVisitCases();

/**
 * Builds the table of node kinds `visit()` has a case for.
 * @returns The table, indexed by node kind.
 */
function buildVisitCases(): Uint8Array {
	const table = new Uint8Array(NODE_KIND_COUNT);

	for (const kind of [
		N_LabeledStatement,
		N_BlockStatement,
		N_StaticBlock,
		N_TSModuleBlock,
		N_SwitchStatement,
		N_ForStatement,
		N_ForInStatement,
		N_ForOfStatement,
		N_WhileStatement,
		N_DoWhileStatement,
		N_CatchClause,
		N_FunctionDeclaration,
		N_FunctionExpression,
		N_TSDeclareFunction,
		N_TSEmptyBodyFunctionExpression,
		N_ArrowFunctionExpression,
		N_MethodDefinition,
		N_TSAbstractMethodDefinition,
		N_Property,
		N_PropertyDefinition,
		N_TSAbstractPropertyDefinition,
		N_AccessorProperty,
		N_ClassDeclaration,
		N_ClassExpression,
		N_TSModuleDeclaration,
		N_TSLiteralType,
		N_TaggedTemplateExpression,
		N_JSXElement,
		N_JSXFragment,
	]) {
		table[kind] = 1;
	}

	return table;
}

/**
 * Builds the table of node kinds `check()` has a case for.
 *
 * One entry per `case` label in `check()`, in the order they appear there,
 * except the three listed beside `default` to say they are deliberate no-ops.
 * @returns The table, indexed by node kind.
 */
function buildCheckedKinds(): Uint8Array {
	const table = new Uint8Array(NODE_KIND_COUNT);

	for (const kind of [
		N_PropertyDefinition,
		N_AccessorProperty,
		N_TSAbstractPropertyDefinition,
		N_TSAbstractAccessorProperty,
		N_MethodDefinition,
		N_TSParameterProperty,
		N_TSIndexSignature,
		N_TSTypeParameterDeclaration,
		N_TSTypeParameterInstantiation,
		N_TSEnumMember,
		N_TSModuleDeclaration,
		N_ClassDeclaration,
		N_ClassExpression,
		N_TSInterfaceDeclaration,
		N_TSTypeAliasDeclaration,
		N_TSAbstractMethodDefinition,
		N_ImportDeclaration,
		N_ExportNamedDeclaration,
		N_ExportDefaultDeclaration,
		N_ExportAllDeclaration,
		N_BreakStatement,
		N_ContinueStatement,
		N_PrivateIdentifier,
		N_TemplateLiteral,
		N_WithStatement,
		N_IfStatement,
		N_LabeledStatement,
		N_WhileStatement,
		N_DoWhileStatement,
		N_ForStatement,
		N_MemberExpression,
		N_CallExpression,
		N_Super,
		N_BinaryExpression,
		N_UnaryExpression,
		N_AssignmentExpression,
		N_UpdateExpression,
		N_ForInStatement,
		N_ForOfStatement,
		N_Literal,
		N_Identifier,
		N_YieldExpression,
		N_AwaitExpression,
		N_Property,
		N_ObjectExpression,
		N_ChainExpression,
		N_MetaProperty,
		N_ImportSpecifier,
		N_ExportSpecifier,
		N_JSXElement,
		N_JSXFragment,
		N_ReturnStatement,
	]) {
		table[kind] = 1;
	}

	return table;
}

/**
 * Determines whether a node kind is an iteration statement.
 *
 * These are the four `for` forms plus `while` and `do-while` — the statements
 * a bare `continue` can be inside of, and the ones a label has to be on for
 * `continue` to name it.
 * @param kind The node kind.
 * @returns `true` when the kind loops.
 */
function isIteration(kind: number): boolean {
	return (
		kind === N_ForStatement ||
		kind === N_ForInStatement ||
		kind === N_ForOfStatement ||
		kind === N_WhileStatement ||
		kind === N_DoWhileStatement
	);
}

/**
 * Determines whether a binding is one a function declaration made.
 *
 * The two spellings differ only under Annex B, and everywhere else — merging
 * with an overload signature, colliding with a `var` — they answer alike.
 * @param binding How the name was introduced.
 * @returns `true` when a function declaration introduced it.
 */
function isFunctionBinding(binding: number): boolean {
	return (
		binding === BINDING_FUNCTION || binding === BINDING_ASYNC_OR_GENERATOR
	);
}

/**
 * Determines whether a string holds only paired surrogates.
 *
 * A module export name written as a string names something in another
 * module's namespace object, and a name that cannot be spelled in UTF-8 could
 * not be carried across a module boundary, so the grammar refuses one.
 * @param value The decoded string.
 * @returns `true` when every surrogate in it is half of a pair.
 */
function isWellFormedUnicode(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);

		if (code < 0xd800 || code > 0xdfff) {
			continue;
		}

		// A low surrogate here is one no high surrogate claimed.
		if (code > 0xdbff || i + 1 === value.length) {
			return false;
		}

		const next = value.charCodeAt(i + 1);

		if (next < 0xdc00 || next > 0xdfff) {
			return false;
		}

		i++;
	}

	return true;
}

/**
 * Builds the table of characters a reserved word can start with.
 * @returns The table, indexed by character code.
 */
function buildReservedInitials(): Uint8Array {
	const table = new Uint8Array(128);

	for (const letter of "ailpsy\\") {
		table[letter.charCodeAt(0)] = 1;
	}

	return table;
}

/**
 * One lexical scope's bindings.
 */
interface Scope {
	/**
	 * Names bound where they are written, mapped to how they were introduced.
	 *
	 * `null` until the first binding: most scopes in a real program — block
	 * statements, loop bodies, the braces of an `if` — declare nothing, and
	 * a `Map` allocated for each of them is measurable churn.
	 */
	names: Map<string, number> | null;

	/**
	 * Names `var`-declared in this scope or in any scope below it that a
	 * `var` climbs out of. A lexical declaration collides with one of these
	 * however the two are ordered, which is what makes `{ var a; let a; }`
	 * and `{ let a; var a; }` alike.
	 *
	 * `null` until the first one, for the same reason as `names`.
	 */
	varNames: Set<string> | null;

	/** Whether `var` declarations stop climbing here. */
	isFunctionScope: boolean;

	/**
	 * Whether a function declaration written directly in this scope binds
	 * here rather than in the nearest function scope. That is true of a
	 * block and of a module's top level, and false of a script's top level
	 * and of a function body — which is why `function a(){} var a;` is a
	 * redeclaration in a module and not in a script.
	 */
	functionsAreLexical: boolean;

	/** The enclosing scope, or `null` for the program scope. */
	parent: Scope | null;
}

/**
 * Walks a parsed program and reports context-dependent problems.
 * @param reader The reader over the AST buffer.
 * @param sourceType How the program should be interpreted.
 * @param dialect Whether TypeScript syntax is allowed.
 * @param jsx Whether JSX syntax is allowed.
 * @returns Every problem found, in the order they were encountered.
 */
export function validateAst(
	reader: AstReader,
	sourceType: "script" | "module" | "commonjs",
	dialect: "js" | "ts",
	jsx: boolean,
	declaration: boolean,
): ValidationProblem[] {
	const validator = new Validator(
		reader,
		sourceType,
		dialect,
		jsx,
		declaration,
	);

	validator.run();

	return validator.problems;
}

/**
 * Implements the validation walk.
 */
class Validator {
	/** Problems found so far. */
	readonly problems: ValidationProblem[] = [];

	/** The reader over the AST buffer. */
	private readonly reader: AstReader;

	/** How the program should be interpreted. */
	private readonly sourceType: "script" | "module" | "commonjs";

	/** Whether TypeScript syntax is allowed. */
	private readonly dialect: "js" | "ts";

	/**
	 * The type parameter lists whose parameters may carry `in` or `out`.
	 *
	 * A class, an interface, and a type alias each register their own list
	 * here before the walk descends into it, so by the time a list is
	 * checked the question of who owns it is already answered.
	 */
	private readonly variantTypeParameters = new Set<number>();

	/**
	 * The parameter properties a constructor implementation introduced.
	 *
	 * A constructor with a body registers its own before the walk descends
	 * into its parameter list, so a parameter property reached without
	 * having been registered is one written somewhere it may not be.
	 */
	private readonly permittedParameterProperties = new Set<number>();

	/**
	 * The one declaration that may be an unnamed class, registered by the
	 * `export default` above it before the walk reaches the class.
	 */
	private anonymousClassAllowed = 0;

	/** Whether JSX syntax is allowed. */
	private readonly jsx: boolean;

	/** Whether strict mode rules currently apply. */
	private strict: boolean;

	/**
	 * Depth of enclosing functions; `0` means top level.
	 *
	 * A CommonJS module starts at `1`: its text is the body of a function the
	 * host wraps it in, which is what makes `return` at the top level of one
	 * legal. Nothing else about the program changes, so this is the whole of
	 * what `"commonjs"` means beyond `"script"` here.
	 */
	private functionDepth: number;

	/**
	 * Whether the walk is inside a JSX element or fragment, so that a
	 * disallowed JSX tree is reported once at its root rather than once per
	 * node it contains.
	 */
	private inJsx = false;

	/** The innermost scope. */
	private scope: Scope;

	/**
	 * Whether the parameter list being declared may not repeat a name.
	 *
	 * Sloppy code lets a plain function repeat a *simple* parameter —
	 * `function f(a, a) {}` is legal and the last one wins. Every other
	 * combination bans it: strict code, any non-simple list, a method, and an
	 * arrow function.
	 */
	private uniqueParams = false;

	/**
	 * Whether the function being visited is a method, which its own node does
	 * not record — the method-ness belongs to the `MethodDefinition` or
	 * `Property` above it, and only reaches the function through here.
	 */
	private inMethod = false;

	/**
	 * The private names each enclosing class declares, outermost first.
	 *
	 * Empty at the top level, which is what makes a `#x` outside any class an
	 * error rather than an unresolved name.
	 */
	private readonly privateNames: Set<string>[] = [];

	/**
	 * The `PrivateIdentifier` nodes standing somewhere one may.
	 *
	 * A private name is not an expression: the three places it may be written
	 * are a class element's name, the property of a member access, and the
	 * left of `#x in o`. The parser accepts one wherever an expression can go,
	 * because telling those apart needs the tree, so every other position is
	 * reported here. Each of the three registers the node it permits before
	 * the walk reaches it, and the indices are unique, so a set of them needs
	 * no unwinding — it is only ever consulted for a node visited once.
	 */
	private permittedPrivateNames: Set<number> | null = null;

	/**
	 * Whether the function being visited is a generator, which reserves
	 * `yield` even in sloppy code.
	 */
	private inGenerator = false;

	/**
	 * Whether the function being visited is async, which reserves `await`.
	 *
	 * Separate from `awaitReserved` because it decides only the wording of the
	 * complaint: a module reserves `await` without any function being async.
	 */
	private inAsync = false;

	/**
	 * Whether `await` may not be an identifier here.
	 *
	 * True inside an async function, anywhere in a module, and inside a class
	 * static block — which is not async, but reserves the word anyway so that
	 * it can be given a meaning there later.
	 */
	private awaitReserved = false;

	/**
	 * Whether `super.x` may be written here.
	 *
	 * True inside any method — an accessor, a generator, and an async method
	 * included — and inside a class field initializer or a static block,
	 * because all of those have a home object to look the property up on. An
	 * ordinary function has none, so it turns this off however it is nested.
	 */
	private superPropertyAllowed = false;

	/**
	 * Whether `super()` may be written here.
	 *
	 * Only the constructor of a class that extends something may call it, so
	 * this is far narrower than `superPropertyAllowed`: a method of a derived
	 * class may read `super.x` and may not call `super()`.
	 */
	private superCallAllowed = false;

	/** Whether the class being visited has a heritage clause. */
	private inDerivedClass = false;

	/**
	 * Whether the method being visited is the constructor of a derived class,
	 * which the function node records no more than it records method-ness.
	 */
	private inDerivedConstructor = false;

	/**
	 * The one `Super` node that is allowed to be where it is.
	 *
	 * `super` is never an expression by itself: it has to be the callee of a
	 * call or the object of a member access, and only the parent knows which
	 * it is. Each parent sanctions its own `Super` before the walk descends
	 * into it, so any other one is a bare `super` and an error.
	 */
	private sanctionedSuper = 0;

	/**
	 * Whether a parameter list is being visited.
	 *
	 * A default value runs before the function's own body exists, so it may
	 * not suspend it: neither `yield` nor `await` may appear in one. A nested
	 * function's body clears this, because `f(x = async () => await 1)` is
	 * fine — the suspension belongs to the arrow, not to `f`.
	 */
	private inParameters = false;

	/**
	 * Whether the walk is inside a class static block, no function between.
	 *
	 * A static block runs while the class is being defined, so there is
	 * nothing for a `yield` or an `await` in one to suspend — the same reason
	 * a parameter list bans both.
	 */
	private inStaticBlock = false;

	/**
	 * Whether `new.target` may stand where the walk is.
	 *
	 * It names the constructor a call was made through, so it needs
	 * something that can be called: any function but an arrow, which has no
	 * `new.target` of its own and reads the enclosing one, plus the two
	 * class bodies that are compiled into functions — a static block and a
	 * field initializer.
	 */
	private newTargetAllowed = false;

	/**
	 * The labels a `break` may name, outermost first.
	 *
	 * Emptied at every function boundary and at a class static block, because
	 * a label names a statement rather than a place, and the statement it
	 * names is not one the code inside a nested function can leave.
	 */
	private readonly labels: { name: string; iteration: boolean }[] = [];

	/** How many iteration statements enclose the walk. */
	private iterationDepth = 0;

	/** How many `switch` statements enclose it, which only `break` may leave. */
	private switchDepth = 0;

	/**
	 * The one `TemplateLiteral` a tag is applied to, if the walk is inside a
	 * `TaggedTemplateExpression`.
	 *
	 * A tag is handed the raw text along with the cooked value, so a malformed
	 * escape leaves the cooked value `undefined` instead of ending the parse.
	 * Nothing else may hold one, and node indices are unique, so remembering
	 * the single template the tag reached is enough to tell the two apart.
	 */
	private taggedQuasi = 0;

	/**
	 * The one `TemplateLiteral` a `TSLiteralType` holds, if the walk has
	 * reached one.
	 *
	 * A template with no substitutions in type position is a string literal
	 * type written with backticks, and the parser gives it the same
	 * `TemplateLiteral` node an expression would get. TypeScript reads what
	 * the escapes spell rather than applying ECMAScript's rule about an
	 * untagged template, so the node has to be exempted the way a tag's quasi
	 * is — and for the same reason one slot is enough: a template cannot be
	 * both.
	 */
	private typeQuasi = 0;

	/**
	 * Whether the class body being walked has declared its constructor.
	 *
	 * Saved and restored around each class, so a constructor in a nested one
	 * does not count against the class outside it.
	 */
	private sawConstructor = false;

	/**
	 * Whether the node being checked sits directly in a statement list.
	 *
	 * Only the labelled-function rule reads it, and a `LabeledStatement` can
	 * only ever be a statement — so every list `visitList()` walks that could
	 * hold one is a statement list, and marking them all is exact.
	 */
	private inStatementList = false;

	/**
	 * Whether an `import` or `export` declaration may stand where the walk is.
	 *
	 * Only two lists take one: the top level of a module, and the body of a
	 * namespace or an ambient module. `visit()` clears this the moment it
	 * descends past a statement, and `visitModuleItems()` sets it again for
	 * each item of a list that does take them, so a declaration nested inside
	 * one of those statements is reported while its siblings are not.
	 */
	private moduleItemsAllowed = false;

	/**
	 * Whether what is being visited declares nothing at run time.
	 *
	 * A TypeScript overload signature, anything under a `declare`, and every
	 * line of a `.d.ts` describe something that exists elsewhere rather than
	 * bringing it into being. Two rules read this. A binding that names
	 * nothing is not held to what a name may be — `declare function
	 * eval(x: string): any` is TypeScript's own declaration of `eval`, in
	 * `lib.es5.d.ts` — and a `const` that initializes nothing needs no
	 * initializer.
	 */
	private ambient: boolean;

	/**
	 * Whether the source could hold an `arguments` at all.
	 *
	 * A class field initializer and a static block each need a search of
	 * their own for one, and almost no program has anything to find. Two
	 * scans of the text settle it once for the whole program: the word
	 * itself, or the `\u` that any escape hiding a letter of it must carry.
	 */
	private readonly mentionsArguments: boolean;

	/**
	 * The reader for regular expression patterns, made on first use.
	 *
	 * Most programs have no regular expression literal at all, and the one
	 * instance is reused by every literal in the ones that do.
	 */
	private regexp: RegExpValidator | null = null;

	/**
	 * Creates a validator.
	 * @param reader The reader over the AST buffer.
	 * @param sourceType How the program should be interpreted.
	 * @param dialect Whether TypeScript syntax is allowed.
	 * @param jsx Whether JSX syntax is allowed.
	 * @param declaration Whether the whole file is ambient.
	 */
	constructor(
		reader: AstReader,
		sourceType: "script" | "module" | "commonjs",
		dialect: "js" | "ts",
		jsx: boolean,
		declaration: boolean,
	) {
		this.reader = reader;
		this.sourceType = sourceType;
		this.dialect = dialect;
		this.jsx = jsx;
		this.ambient = declaration;
		this.strict = sourceType === "module";
		this.functionDepth = sourceType === "commonjs" ? 1 : 0;
		this.mentionsArguments =
			reader.source.includes("arguments") ||
			reader.source.includes("\\u");

		// A module reserves `await` everywhere in it, function or no function.
		this.awaitReserved = sourceType === "module";
		this.scope = {
			names: null,
			varNames: null,
			isFunctionScope: true,
			functionsAreLexical: sourceType === "module",
			parent: null,
		};
	}

	/**
	 * Runs every check over the whole program.
	 * @returns Nothing.
	 */
	run(): void {
		const root = this.reader.root;

		if (!this.strict && this.hasUseStrictDirective(root)) {
			this.strict = true;
		}

		this.hoist(
			this.reader.field(root, NODE_A),
			this.sourceType === "module",
		);
		this.visitModuleItems(this.reader.field(root, NODE_A));

		if (this.sourceType === "module") {
			this.checkModuleExports(this.reader.field(root, NODE_A));
		}
	}

	/**
	 * Reports a problem.
	 * @param message A description of the problem.
	 * @param start The offset where the problem begins.
	 * @returns Nothing.
	 */
	private report(message: string, start: number): void {
		this.problems.push({ message, start });
	}

	/**
	 * Determines whether a body begins with a `"use strict"` directive.
	 * @param node The `Program` or function body node.
	 * @returns `true` when the directive is present.
	 */
	private hasUseStrictDirective(node: number): boolean {
		const body = this.reader.field(node, NODE_A);
		const size = this.reader.listSize(body);

		for (let i = 0; i < size; i++) {
			const statement = this.reader.listItem(body, i);

			// The prologue ends at the first non-directive statement.
			if (this.reader.field(statement, NODE_B) !== 1) {
				return false;
			}

			const raw = this.reader.text(this.reader.field(statement, NODE_A));

			if (raw === '"use strict"' || raw === "'use strict'") {
				return true;
			}
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Traversal
	//-------------------------------------------------------------------------

	/**
	 * Visits a node and everything below it.
	 * @param node The node index, or `0`.
	 * @returns Nothing.
	 */
	private visit(node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		/*
		 * Most kinds have no case in `check()`, and the call plus its
		 * dispatch cost real time when paid on every node. The one thing
		 * `check()` does for a kind outside the table is the TypeScript
		 * report under `dialect: "js"`, which is why that half of the test
		 * still sends every TypeScript kind through.
		 */
		if (
			CHECKED_KINDS[kind] !== 0 ||
			(kind >= TS_FIRST && this.dialect === "js")
		) {
			this.check(node, kind);
		}

		/*
		 * `check()` has had its look at this node, so anything below it is
		 * nested: it takes no module item, and it is not a statement list.
		 * A sibling gets both answers back from the list walk, which sets
		 * them again for each item.
		 */
		const wasInStatementList = this.inStatementList;

		this.moduleItemsAllowed = false;
		this.inStatementList = false;

		// Most kinds only descend; see `VISIT_CASES`.
		if (VISIT_CASES[kind] === 0) {
			this.visitChildren(node, kind);
			return;
		}

		switch (kind) {
			/*
			 * A chain of labels is one position rather than several, so
			 * `l: m: function f() {}` is as legal as `l: function f() {}`
			 * and as illegal as it wherever that one is.
			 */
			case N_LabeledStatement: {
				const body = reader.field(node, NODE_B);
				const name = this.identifierName(reader.field(node, NODE_A));

				for (const entry of this.labels) {
					if (entry.name === name) {
						this.report(
							`Label '${name}' has already been declared.`,
							reader.start(node),
						);

						break;
					}
				}

				/*
				 * `continue` may only name a label that is on a loop, and a
				 * chain of labels is all on whatever the chain ends at — so
				 * `a: b: while (0) continue a;` works.
				 */
				let target = body;

				while (
					target !== 0 &&
					reader.kind(target) === N_LabeledStatement
				) {
					target = reader.field(target, NODE_B);
				}

				this.labels.push({
					name,
					iteration: target !== 0 && isIteration(reader.kind(target)),
				});
				this.visit(reader.field(node, NODE_A));
				this.inStatementList = wasInStatementList;
				this.visit(body);
				this.inStatementList = false;
				this.labels.pop();
				return;
			}

			/*
			 * The tag has to be walked before the template it is applied to
			 * is marked as tagged, because the tag may end in a tagged
			 * template of its own — `` tag`a`.b`c` `` — and that one would
			 * otherwise take the mark meant for this one.
			 */
			case N_TaggedTemplateExpression:
				this.visit(reader.field(node, NODE_A));
				this.visit(reader.field(node, NODE_C));
				this.taggedQuasi = reader.field(node, NODE_B);
				this.visit(this.taggedQuasi);
				return;

			case N_TSLiteralType: {
				const literal = reader.field(node, NODE_A);

				if (reader.kind(literal) === N_TemplateLiteral) {
					this.typeQuasi = literal;
				}

				this.visit(literal);
				return;
			}

			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_ArrowFunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				this.visitFunction(node);
				return;

			case N_BlockStatement:
				this.enterScope(false);
				this.hoist(reader.field(node, NODE_A), true);
				this.visitChildren(node, kind);
				this.exitScope();
				return;

			/*
			 * `declare namespace N { ... }` makes everything inside it
			 * ambient, and so does `declare module "m" { ... }`. A namespace
			 * written without the keyword does not — TypeScript rejects a
			 * `const` with no initializer in one exactly as it does at the
			 * top level of an ordinary file — which is why this is inherited
			 * rather than assumed of every namespace.
			 */
			case N_TSModuleDeclaration: {
				const previousAmbient = this.ambient;

				this.ambient =
					previousAmbient || (reader.flags(node) & NF_DECLARE) !== 0;
				this.visitChildren(node, kind);
				this.ambient = previousAmbient;
				return;
			}

			/*
			 * A `var` cannot escape a static block or a namespace body, so
			 * both stop the climb the way a function body does, and a
			 * function declared in either one binds there.
			 */
			case N_StaticBlock:
			case N_TSModuleBlock: {
				const wasAwait = this.awaitReserved;
				const wasGenerator = this.inGenerator;

				/*
				 * A static block is not async, but it reserves `await` so that
				 * the word is free to be given a meaning there later. It is
				 * not a generator either, and `yield` inside one is reserved
				 * only because a class body is strict.
				 */
				const wasSuperProperty = this.superPropertyAllowed;
				const wasSuperCall = this.superCallAllowed;

				const outerLabels =
					kind === N_StaticBlock
						? this.labels.splice(0, this.labels.length)
						: null;
				const previousIterationDepth = this.iterationDepth;
				const previousSwitchDepth = this.switchDepth;
				const previousFunctionDepth = this.functionDepth;
				const previousStaticBlock = this.inStaticBlock;
				const previousNewTarget = this.newTargetAllowed;

				if (kind === N_StaticBlock) {
					this.awaitReserved = true;
					this.inGenerator = false;

					/*
					 * A static block runs while the class is being defined,
					 * which leaves it nothing to return from and nothing to
					 * suspend — and gives it a `new.target` of its own, which
					 * is `undefined`.
					 */
					this.functionDepth = 0;
					this.inStaticBlock = true;
					this.newTargetAllowed = true;

					/*
					 * A static block is a boundary for `break` and `continue`
					 * as much as a function is: it runs when the class is
					 * defined, not where the class is written, so a loop
					 * around the class is nothing it can leave.
					 */
					this.iterationDepth = 0;
					this.switchDepth = 0;

					// A static block has a home object but no constructor.
					this.superPropertyAllowed = true;
					this.superCallAllowed = false;
					this.checkNoArguments(
						this.findArgumentsInList(reader.field(node, NODE_A)),
						"a class static block",
					);
				}

				this.enterScope(true);
				this.hoist(reader.field(node, NODE_A), true);

				/*
				 * A namespace body is the one place other than the top level
				 * of a module where an `import` or `export` may be written.
				 * A static block is not.
				 */
				if (kind === N_TSModuleBlock) {
					this.visitModuleItems(reader.field(node, NODE_A));
				} else {
					this.visitChildren(node, kind);
				}

				this.exitScope();

				if (outerLabels !== null) {
					this.labels.push(...outerLabels);
					this.iterationDepth = previousIterationDepth;
					this.switchDepth = previousSwitchDepth;
					this.functionDepth = previousFunctionDepth;
					this.inStaticBlock = previousStaticBlock;
					this.newTargetAllowed = previousNewTarget;
				}

				this.awaitReserved = wasAwait;
				this.inGenerator = wasGenerator;
				this.superPropertyAllowed = wasSuperProperty;
				this.superCallAllowed = wasSuperCall;
				return;
			}

			/*
			 * Every case shares the switch's one block scope, so a lexical
			 * declaration in one case collides with the same name in
			 * another.
			 */
			case N_SwitchStatement: {
				const cases = reader.field(node, NODE_B);
				const size = reader.listSize(cases);
				let sawDefault = false;

				this.enterScope(false);

				for (let i = 0; i < size; i++) {
					const clause = reader.listItem(cases, i);

					/*
					 * A `default` clause is the one with no test, and a
					 * second would be unreachable: the switch runs the first
					 * it finds and there is no order in which the other could
					 * win.
					 */
					if (reader.field(clause, NODE_A) === 0) {
						if (sawDefault) {
							this.report(
								"A switch statement may only have one default clause.",
								reader.start(clause),
							);
						}

						sawDefault = true;
					}

					this.hoist(reader.field(clause, NODE_B), false);
				}

				this.switchDepth++;
				this.visitChildren(node, kind);
				this.switchDepth--;
				this.exitScope();
				return;
			}

			/*
			 * A `let` or `const` in the head binds in a scope of its own, so
			 * that a `var` of the same name in the body is a redeclaration
			 * while a `let` is not.
			 */
			case N_ForStatement:
			case N_ForInStatement:
			case N_ForOfStatement: {
				const head = reader.field(node, NODE_A);

				this.enterScope(false);

				if (head !== 0 && reader.kind(head) === N_VariableDeclaration) {
					// Only a C-style head has a place to put an initializer.
					this.declareVariableDeclaration(
						head,
						kind === N_ForStatement,
					);
				}

				this.iterationDepth++;
				this.visitChildren(node, kind);
				this.iterationDepth--;
				this.exitScope();
				return;
			}

			case N_WhileStatement:
			case N_DoWhileStatement:
				this.iterationDepth++;
				this.visitChildren(node, kind);
				this.iterationDepth--;
				return;

			/*
			 * The clause and its block share one scope, because a lexical
			 * declaration in the block collides with the parameter even
			 * though the block is a scope of its own everywhere else.
			 */
			case N_CatchClause: {
				const param = reader.field(node, NODE_A);
				const body = reader.field(node, NODE_B);

				this.enterScope(false);

				/*
				 * A `var` may reuse the name of a simple parameter but not of
				 * one picked out of a pattern, so only the simple one gets a
				 * binding kind that a `var` passes through.
				 */
				this.declarePattern(
					param,
					param !== 0 && reader.kind(param) === N_Identifier
						? BINDING_CATCH
						: BINDING_LEXICAL,
				);
				this.visit(param);

				if (body !== 0) {
					this.hoist(reader.field(body, NODE_A), true);
					this.visitList(reader.field(body, NODE_A));
				}

				this.exitScope();
				return;
			}

			/*
			 * A method's parameters may never repeat a name, however sloppy
			 * the surrounding code is, and an accessor's list has a fixed
			 * shape. Neither fact is recorded on the function itself, so both
			 * are settled here and the first is handed down for the value
			 * alone — a computed key holding a function is not a method.
			 */
			case N_MethodDefinition:
			case N_TSAbstractMethodDefinition:
			case N_Property: {
				const flags = reader.flags(node);
				const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;
				const value = reader.field(node, NODE_B);

				if (accessor === MKIND_GET || accessor === MKIND_SET) {
					this.checkAccessorParameters(value, accessor);
				}

				this.visit(reader.field(node, NODE_A));

				const wasMethod = this.inMethod;

				this.inMethod =
					kind !== N_Property ||
					(flags & NF_METHOD) !== 0 ||
					accessor === MKIND_GET ||
					accessor === MKIND_SET;

				/*
				 * The key is visited above, outside all of this, because a
				 * computed key is evaluated where the class is written rather
				 * than inside it: `class C { [super.x]() {} }` has no home
				 * object to read from.
				 */
				this.inDerivedConstructor =
					kind === N_MethodDefinition &&
					accessor === MKIND_CONSTRUCTOR &&
					this.inDerivedClass;
				this.visit(value);
				this.inDerivedConstructor = false;
				this.inMethod = wasMethod;
				this.visitList(reader.field(node, NODE_C));
				return;
			}

			/*
			 * A field initializer runs with the instance as its home object,
			 * so it may read `super.x` — but it is not the constructor, so it
			 * may not call `super()`. Its key is visited first and separately,
			 * a computed one being evaluated outside the class body.
			 */
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractPropertyDefinition: {
				const wasSuperProperty = this.superPropertyAllowed;
				const wasSuperCall = this.superCallAllowed;

				this.visit(reader.field(node, NODE_A));
				this.checkNoArguments(
					this.findArguments(reader.field(node, NODE_B)),
					"a class field initializer",
				);
				const wasNewTarget = this.newTargetAllowed;

				this.superPropertyAllowed = true;
				this.superCallAllowed = false;

				// An initializer is compiled into a function of its own.
				this.newTargetAllowed = true;
				this.visit(reader.field(node, NODE_B));
				this.newTargetAllowed = wasNewTarget;
				this.superPropertyAllowed = wasSuperProperty;
				this.superCallAllowed = wasSuperCall;
				this.visitList(reader.field(node, NODE_C));
				return;
			}

			/*
			 * A class opens a private environment that covers its body and
			 * nothing else. The heritage clause is deliberately visited before
			 * the push, because the specification evaluates it in the *outer*
			 * environment: `class C extends this.#x { #x; }` does not resolve.
			 */
			case N_ClassDeclaration:
			case N_ClassExpression: {
				const body = reader.field(node, NODE_C);
				const wasStrict = this.strict;

				/*
				 * Every part of a class is strict mode code, its name and its
				 * heritage clause included, whatever surrounds it. So
				 * `class C { m() { var yield; } }` is an error in a sloppy
				 * script, where the same method written outside a class is
				 * not.
				 */
				this.strict = true;
				this.checkRestrictedName(reader.field(node, NODE_A), "bound");
				this.visit(reader.field(node, NODE_A));
				this.visit(reader.field(node, NODE_B));

				/*
				 * The type parameters, the type arguments on the heritage
				 * clause, and the `implements` list, all of which sit outside
				 * the body and so are missed by the walk below it. Without
				 * these, `class C<T> {}` and `class C implements I {}` pass
				 * unexamined -- including under `dialect: "js"`, where the
				 * whole point is to refuse them.
				 */
				this.visit(reader.field(node, NODE_D));
				this.visit(reader.field(node, NODE_E));
				this.visitList(reader.field(node, NODE_F));

				const wasDerived = this.inDerivedClass;
				const wasSawConstructor = this.sawConstructor;

				this.sawConstructor = false;

				/*
				 * Only a class that extends something has a `super()` to call,
				 * and the heritage clause above is deliberately visited before
				 * this is set — it is evaluated outside the class body.
				 */
				this.inDerivedClass = reader.field(node, NODE_B) !== 0;

				if (body !== 0) {
					this.privateNames.push(this.collectPrivateNames(body));
					this.visitChildren(body, reader.kind(body));
					this.privateNames.pop();
				}

				this.inDerivedClass = wasDerived;
				this.sawConstructor = wasSawConstructor;
				this.strict = wasStrict;
				return;
			}

			/*
			 * Everything below a JSX element or fragment is JSX too, so the
			 * subtree is marked to keep `check()` from reporting a disallowed
			 * tree again at every element nested inside it.
			 */
			case N_JSXElement:
			case N_JSXFragment: {
				const wasInJsx = this.inJsx;

				this.inJsx = true;
				this.visitChildren(node, kind);
				this.inJsx = wasInJsx;
				return;
			}

			default:
				this.visitChildren(node, kind);
		}
	}

	/**
	 * Visits every child of a node using the slot descriptor table.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: number, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitList(this.reader.field(node, NODE_A + slot));
			}
		}
	}

	/**
	 * Visits every element of a list.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	/**
	 * Visits a list whose items may be `import` and `export` declarations.
	 *
	 * The permission is granted one item at a time rather than for the list,
	 * because `visit()` takes it away as soon as it descends: `import x from
	 * "m";` at the top level is a module item, and the same line inside the
	 * block on the next line is not.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	private visitModuleItems(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.moduleItemsAllowed = true;
			this.inStatementList = true;
			this.visit(this.reader.listItem(handle, i));
		}

		this.moduleItemsAllowed = false;
		this.inStatementList = false;
	}

	private visitList(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.inStatementList = true;
			this.visit(this.reader.listItem(handle, i));
		}

		this.inStatementList = false;
	}

	/**
	 * Visits a function, giving its parameters and body a fresh scope.
	 * @param node The function node index.
	 * @returns Nothing.
	 */
	private visitFunction(node: number): void {
		const reader = this.reader;
		const previousStrict = this.strict;
		const previousUnique = this.uniqueParams;
		const previousGenerator = this.inGenerator;
		const previousAsync = this.inAsync;
		const previousAwait = this.awaitReserved;
		const previousParameters = this.inParameters;
		const previousAmbient = this.ambient;
		const isMethod = this.inMethod;
		const isDerivedConstructor = this.inDerivedConstructor;
		const previousSuperProperty = this.superPropertyAllowed;
		const previousSuperCall = this.superCallAllowed;
		const body = reader.field(node, NODE_C);
		const kind = reader.kind(node);
		const flags = reader.flags(node);
		const isArrow = kind === N_ArrowFunctionExpression;
		const isGenerator = (flags & NF_GENERATOR) !== 0;
		const isAsync = (flags & NF_ASYNC) !== 0;

		/*
		 * Method-ness reaches exactly one function, the one it was set for.
		 * A function nested inside a method is an ordinary function again.
		 */
		this.inMethod = false;
		this.inDerivedConstructor = false;
		this.functionDepth++;
		this.enterScope(true);

		const previousStaticBlock = this.inStaticBlock;
		const previousNewTarget = this.newTargetAllowed;

		this.inStaticBlock = false;

		/*
		 * An arrow has no `new.target` of its own and reads the enclosing
		 * one, so it neither grants the permission nor takes it away.
		 */
		if (!isArrow) {
			this.newTargetAllowed = true;
		}

		/*
		 * A label names a statement, and nothing inside a nested function can
		 * leave a statement outside it, so the whole set is put aside for the
		 * duration along with the loops and switches it sits in.
		 */
		const outerLabels = this.labels.splice(0, this.labels.length);
		const previousIterationDepth = this.iterationDepth;
		const previousSwitchDepth = this.switchDepth;

		this.iterationDepth = 0;
		this.switchDepth = 0;

		const directive =
			body !== 0 &&
			reader.kind(body) === N_BlockStatement &&
			this.hasUseStrictDirective(body);

		if (directive) {
			this.strict = true;
		}

		// A function with no body is a signature, not a definition.
		this.ambient = previousAmbient || body === 0;

		this.checkAmbientFunction(node, kind, flags, body);

		/*
		 * A function's name is checked here rather than where it is bound,
		 * because a `"use strict"` directive in the body reaches back over
		 * it: `function eval() { "use strict"; }` is an error although the
		 * `eval` it binds lands in a scope that is not strict at all.
		 */
		this.checkRestrictedName(reader.field(node, NODE_A), "bound");

		const params = reader.field(node, NODE_B);
		const size = reader.listSize(params);
		const simple = this.hasSimpleParameters(params, size);

		/*
		 * A `"use strict"` directive cannot make strict something the engine
		 * would have to evaluate to know — a default expression runs in the
		 * function's own scope, so whether *it* is strict would depend on the
		 * directive it precedes. The language sidesteps the question by
		 * banning the combination outright.
		 */
		if (directive && !simple) {
			this.report(
				"Illegal 'use strict' directive in a function with a non-simple parameter list.",
				reader.start(node),
			);
		}

		this.uniqueParams = this.strict || !simple || isMethod || isArrow;

		const isDeclaration =
			kind === N_FunctionDeclaration || kind === N_TSDeclareFunction;

		/*
		 * A function's own name is read where the function is written, not
		 * inside it — so `function* yield() {}` is legal in sloppy code while
		 * `(function* yield() {})` is not, an expression's name being the one
		 * thing about it that is in scope within its own body.
		 */
		if (isDeclaration) {
			this.visit(reader.field(node, NODE_A));
		}

		/*
		 * An arrow reads its parameters in the enclosing context and its body
		 * in a fresh one, which no other function does. So
		 * `async function f() { (await) => 1; }` is an error while
		 * `async function f() { () => { var await; }; }` is not.
		 */
		this.inGenerator = isArrow ? previousGenerator : isGenerator;
		this.inAsync = isArrow ? previousAsync || isAsync : isAsync;
		this.awaitReserved =
			this.inAsync ||
			(isArrow && previousAwait) ||
			this.sourceType === "module";

		/*
		 * An arrow has no home object of its own and so borrows the enclosing
		 * one, which is what lets `constructor() { () => super(); }` work.
		 * Every other function brings its own, or brings none: only a method
		 * may read `super.x`, and only a derived constructor may call it.
		 */
		if (!isArrow) {
			this.superPropertyAllowed = isMethod;
			this.superCallAllowed = isDerivedConstructor;
		}

		for (let i = 0; i < size; i++) {
			const param = reader.listItem(params, i);

			if (reader.kind(param) === N_RestElement && i !== size - 1) {
				this.report(
					"A rest parameter must be the last parameter.",
					reader.start(param),
				);
			}

			this.declarePattern(param, BINDING_PARAM);
		}

		this.uniqueParams = previousUnique;

		if (!isDeclaration) {
			this.visit(reader.field(node, NODE_A));
		}

		this.inParameters = true;
		this.visitList(params);
		this.inParameters = false;

		// The body of an arrow is the one place the enclosing context stops.
		if (isArrow) {
			this.inGenerator = false;
			this.inAsync = isAsync;
			this.awaitReserved = isAsync || this.sourceType === "module";
		}

		if (body !== 0 && reader.kind(body) === N_BlockStatement) {
			this.hoist(reader.field(body, NODE_A), true);
			this.visitList(reader.field(body, NODE_A));
		} else {
			this.visit(body);
		}

		this.visit(reader.field(node, 7));
		this.visit(reader.field(node, 8));
		this.exitScope();
		this.functionDepth--;
		this.strict = previousStrict;
		this.inGenerator = previousGenerator;
		this.inAsync = previousAsync;
		this.awaitReserved = previousAwait;
		this.inParameters = previousParameters;
		this.inStaticBlock = previousStaticBlock;
		this.newTargetAllowed = previousNewTarget;
		this.labels.push(...outerLabels);
		this.iterationDepth = previousIterationDepth;
		this.switchDepth = previousSwitchDepth;
		this.ambient = previousAmbient;
		this.superPropertyAllowed = previousSuperProperty;
		this.superCallAllowed = previousSuperCall;
	}

	/**
	 * Determines whether every parameter is a plain binding identifier.
	 *
	 * That is the specification's `IsSimpleParameterList`, and it decides two
	 * separate things: whether the list may repeat a name in sloppy code, and
	 * whether the body may open with a `"use strict"` directive.
	 * @param params The parameter list handle.
	 * @param size How many parameters it holds.
	 * @returns `true` when no parameter is a pattern, a default, or a rest.
	 */
	private hasSimpleParameters(params: number, size: number): boolean {
		const reader = this.reader;

		for (let i = 0; i < size; i++) {
			let param = reader.listItem(params, i);

			/*
			 * A parameter property is an accessibility modifier written on an
			 * ordinary parameter, and the modifier is what a class does with
			 * the binding rather than part of the binding form. What the
			 * function receives is still the parameter underneath, so
			 * `constructor(public x) { "use strict"; }` is as simple a list
			 * as `constructor(x)` is.
			 */
			if (reader.kind(param) === N_TSParameterProperty) {
				param = reader.field(param, NODE_A);
			}

			if (reader.kind(param) !== N_Identifier) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Reports an accessor whose parameter list is not the shape it must be.
	 *
	 * A getter takes nothing and a setter takes exactly one thing, and neither
	 * may collect a rest — the two are called with a fixed shape by the
	 * property machinery, so there is nothing for the extra parameters to be.
	 * @param value The function node index, or `0`.
	 * @param accessor The packed method kind.
	 * @returns Nothing.
	 */
	private checkAccessorParameters(value: number, accessor: number): void {
		if (value === 0) {
			return;
		}

		const reader = this.reader;
		const params = reader.field(value, NODE_B);
		const size = reader.listSize(params);

		if (accessor === MKIND_GET) {
			if (size > 0) {
				this.report(
					"A getter must have no parameters.",
					reader.start(reader.listItem(params, 0)),
				);
			}

			return;
		}

		if (size !== 1) {
			this.report(
				"A setter must have exactly one parameter.",
				reader.start(size === 0 ? value : reader.listItem(params, 1)),
			);

			return;
		}

		const only = reader.listItem(params, 0);

		if (reader.kind(only) === N_RestElement) {
			this.report(
				"A setter cannot have a rest parameter.",
				reader.start(only),
			);
		}
	}

	//-------------------------------------------------------------------------
	// Scopes
	//-------------------------------------------------------------------------

	/**
	 * The name an identifier spells, with any escape in it decoded.
	 *
	 * An `Identifier` runs to the end of whatever TypeScript hung off it — an
	 * `x!` or an `x: number` — so slot A carries where the name itself stops
	 * when that is not the end of the node.
	 * @param node The `Identifier` node index.
	 * @returns The name.
	 */
	private identifierName(node: number): string {
		const reader = this.reader;
		const nameEnd = reader.field(node, NODE_A);
		const raw = reader.source.slice(
			reader.start(node),
			nameEnd === 0 ? reader.end(node) : nameEnd,
		);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * Pushes a new scope.
	 * @param isFunctionScope Whether `var` declarations stop here.
	 * @returns Nothing.
	 */
	private enterScope(isFunctionScope: boolean): void {
		this.scope = {
			names: null,
			varNames: null,
			isFunctionScope,
			functionsAreLexical: !isFunctionScope,
			parent: this.scope,
		};
	}

	/**
	 * Pops the innermost scope.
	 * @returns Nothing.
	 */
	private exitScope(): void {
		this.scope = this.scope.parent!;
	}

	/**
	 * Declares the block-scoped names of a statement list before visiting it,
	 * which is what lets a redeclaration be reported at either occurrence.
	 * @param handle The list handle of the statements.
	 * @returns Nothing.
	 */
	private hoist(handle: number, usingAllowed: boolean): void {
		const reader = this.reader;
		const size = reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			let statement = reader.listItem(handle, i);
			let kind = reader.kind(statement);

			// Look through `export` to the declaration it wraps.
			if (
				kind === N_ExportNamedDeclaration ||
				kind === N_ExportDefaultDeclaration
			) {
				statement = reader.field(statement, NODE_A);

				if (statement === 0) {
					continue;
				}

				kind = reader.kind(statement);
			}

			switch (kind) {
				case N_VariableDeclaration:
					if (!usingAllowed) {
						this.checkUsingPlacement(statement);
					}

					this.declareVariableDeclaration(statement, true);
					break;

				case N_ImportDeclaration:
					this.declareImportDeclaration(statement);
					break;

				case N_FunctionDeclaration:
					this.declare(
						reader.field(statement, NODE_A),
						this.scope.functionsAreLexical
							? (reader.flags(statement) &
									(NF_ASYNC | NF_GENERATOR)) !==
								0
								? BINDING_ASYNC_OR_GENERATOR
								: BINDING_FUNCTION
							: BINDING_VAR,
					);
					break;

				/*
				 * A body-less function declaration is either a TypeScript
				 * overload signature or an ambient one, and both merge with
				 * the other declarations of the same name instead of
				 * redeclaring it.
				 */
				case N_TSDeclareFunction:
					this.declare(
						reader.field(statement, NODE_A),
						this.scope.functionsAreLexical
							? BINDING_SIGNATURE
							: BINDING_VAR,
					);
					break;

				case N_ClassDeclaration:
					this.declare(
						reader.field(statement, NODE_A),
						this.ambient ||
							(reader.flags(statement) & NF_DECLARE) !== 0
							? BINDING_AMBIENT_CLASS
							: BINDING_LEXICAL,
					);
					break;

				/*
				 * `import a = require("m")` is here for the same reason the
				 * type declarations are: it binds a name that may stand for a
				 * value, a type, or a namespace, and which of the three it is
				 * is a question about the other module. A type binding is the
				 * reading that merges with anything, which is the one to take
				 * when the answer is not here to be had.
				 */
				case N_TSInterfaceDeclaration:
				case N_TSTypeAliasDeclaration:
				case N_TSEnumDeclaration:
				case N_TSModuleDeclaration:
				case N_TSImportEqualsDeclaration:
					this.declare(reader.field(statement, NODE_A), BINDING_TYPE);
					break;

				default:
					break;
			}
		}
	}

	/**
	 * Reports a `using` declaration written where none may stand.
	 *
	 * A `using` is a `Declaration` with a shorter reach than the others. In a
	 * script it has to be inside something — a block, a function body, a
	 * `for` head, a class static block — because the top level of a script is
	 * not a scope anything is disposed at the end of. A module has such an
	 * end, so the top level of one takes it. And a `CaseClause` never does,
	 * in either goal: the cases of a `switch` share one scope, so a `using`
	 * in the first would be disposed at a point the later ones run past.
	 * @param node The `VariableDeclaration` node index.
	 * @returns Nothing.
	 */
	private checkUsingPlacement(node: number): void {
		const reader = this.reader;
		const declarationKind = (reader.flags(node) & DECL_MASK) >>> DECL_SHIFT;

		if (
			declarationKind === DECL_USING ||
			declarationKind === DECL_AWAIT_USING
		) {
			this.report(
				`A '${DECL_KIND_NAMES[declarationKind]}' declaration may only appear inside a block, a function body, a for head, or the top level of a module.`,
				reader.start(node),
			);
		}
	}

	/**
	 * Declares every name introduced by a variable declaration.
	 * @param node The `VariableDeclaration` node index.
	 * @param checkInitializer Whether a `const` here needs an initializer,
	 *      which a `for...in` or `for...of` head does not.
	 * @returns Nothing.
	 */
	private declareVariableDeclaration(
		node: number,
		checkInitializer: boolean,
	): void {
		const reader = this.reader;
		const flags = reader.flags(node);
		const declarationKind = (flags & DECL_MASK) >>> DECL_SHIFT;
		const binding =
			declarationKind === DECL_VAR ? BINDING_VAR : BINDING_LEXICAL;
		const isUsing =
			declarationKind === DECL_USING ||
			declarationKind === DECL_AWAIT_USING;
		const declarations = reader.field(node, NODE_A);
		const size = reader.listSize(declarations);
		const previousAmbient = this.ambient;

		this.ambient = previousAmbient || (flags & NF_DECLARE) !== 0;

		for (let i = 0; i < size; i++) {
			const declarator = reader.listItem(declarations, i);

			const target = reader.field(declarator, NODE_A);

			this.declarePattern(target, binding);
			const initializer = reader.field(declarator, NODE_B);
			const annotation =
				reader.kind(target) === N_Identifier
					? reader.field(target, NODE_B)
					: 0;

			this.checkDefiniteAssertion(
				declarator,
				initializer,
				annotation,
				(flags & NF_DECLARE) !== 0 ||
					declarationKind === DECL_CONST ||
					isUsing,
			);

			/*
			 * An ambient declaration names something defined elsewhere, so
			 * an initializer here would be defining it twice. The one that
			 * stands is `declare const x = 1` with no type written, where
			 * the value is what says what the type is and TypeScript keeps
			 * it for that.
			 */
			if (
				(flags & NF_DECLARE) !== 0 &&
				initializer !== 0 &&
				(declarationKind !== DECL_CONST || annotation !== 0)
			) {
				this.report(
					"An ambient declaration may not have an initializer.",
					reader.start(declarator),
				);
			}

			/*
			 * A `using` disposes of what its name holds when the scope ends,
			 * so it needs one name and one value: `BindingList` for these two
			 * kinds is written `~Pattern`, and every element of it carries an
			 * `Initializer`.
			 */
			if (isUsing) {
				if (reader.kind(target) !== N_Identifier) {
					this.report(
						`A '${DECL_KIND_NAMES[declarationKind]}' declaration may only bind an identifier.`,
						reader.start(target),
					);
				}
			} else if (declarationKind !== DECL_CONST) {
				continue;
			}

			/*
			 * An ambient `const` names something declared elsewhere, so it
			 * has nothing to initialize, and a definite assignment assertion
			 * promises an initializer that TypeScript cannot see.
			 */
			if (
				checkInitializer &&
				reader.field(declarator, NODE_B) === 0 &&
				(reader.flags(declarator) & NF_DEFINITE) === 0 &&
				!this.ambient
			) {
				this.report(
					`Missing initializer in ${DECL_KIND_NAMES[declarationKind]} declaration.`,
					reader.start(declarator),
				);
			}
		}

		this.ambient = previousAmbient;
	}

	/**
	 * Reports a modifier a method may not carry.
	 *
	 * `readonly` describes a property that cannot be assigned, and a method
	 * is not assigned in the first place; `declare` describes a member
	 * defined elsewhere, which for a method is what an overload signature is
	 * already for. Both are dropped by the decoder rather than emitted, so
	 * nothing downstream would show they were written.
	 * @param node The method node index.
	 * @returns Nothing.
	 */
	private checkMethodModifiers(node: number): void {
		const flags = this.reader.flags(node);

		if ((flags & NF_READONLY) !== 0) {
			this.report(
				"A method may not be marked 'readonly'.",
				this.reader.start(node),
			);
		}

		if ((flags & NF_DECLARE) !== 0) {
			this.report(
				"A method may not be marked 'declare'.",
				this.reader.start(node),
			);
		}
	}

	/**
	 * Reports an accessibility modifier on an index signature.
	 *
	 * An index signature names no member, so there is nothing for `public`,
	 * `private`, or `protected` to describe the visibility of. `static` and
	 * `readonly` are the two that do mean something here and are left alone.
	 * @param node The index signature node index.
	 * @returns Nothing.
	 */
	private checkIndexSignature(node: number): void {
		if ((this.reader.flags(node) & ACCESS_MASK) !== 0) {
			this.report(
				"An index signature may not have an accessibility modifier.",
				this.reader.start(node),
			);
		}
	}

	/**
	 * Reports a type-only import that brings in a name two ways at once.
	 *
	 * `import type` imports types, and the form allows either a default or a
	 * set of named bindings so that the one name it introduces is
	 * unambiguous. Writing both would be two imports under one `type`.
	 * @param node The import declaration node index.
	 * @returns Nothing.
	 */
	private checkTypeOnlyImport(node: number): void {
		const reader = this.reader;

		if ((reader.flags(node) & NF_TYPE_ONLY) === 0) {
			return;
		}

		const specifiers = reader.field(node, NODE_A);
		const size = reader.listSize(specifiers);
		let sawDefault = false;
		let sawOther = false;

		for (let i = 0; i < size; i++) {
			if (
				reader.kind(reader.listItem(specifiers, i)) ===
				N_ImportDefaultSpecifier
			) {
				sawDefault = true;
			} else {
				sawOther = true;
			}
		}

		if (sawDefault && sawOther) {
			this.report(
				"A type-only import may have a default import or named bindings, but not both.",
				reader.start(node),
			);
		}
	}

	/**
	 * Reports a decorator on an overload signature.
	 *
	 * A decorator wraps the function it is written on, and an overload
	 * signature has no function to wrap — the implementation below it is
	 * what runs, and that is where the decorator belongs.
	 * @param node The method node index.
	 * @returns Nothing.
	 */
	private checkDecoratedOverload(node: number): void {
		const reader = this.reader;
		const value = reader.field(node, NODE_B);

		if (
			reader.listSize(reader.field(node, NODE_C)) > 0 &&
			(value === 0 || reader.field(value, NODE_C) === 0)
		) {
			this.report(
				"A decorator may not appear on an overload signature.",
				reader.start(node),
			);
		}
	}

	/**
	 * Reports an object literal method written without a body.
	 *
	 * A body-less method is an overload signature, which describes something
	 * declared elsewhere. An object literal declares its members as it goes,
	 * so there is nothing for a signature in one to describe.
	 * @param node The property node index.
	 * @returns Nothing.
	 */
	private checkObjectMethodBody(node: number): void {
		const reader = this.reader;
		const value = reader.field(node, NODE_B);

		if (
			value !== 0 &&
			reader.kind(value) === N_TSEmptyBodyFunctionExpression
		) {
			this.report(
				"An object literal method must have a body.",
				reader.start(node),
			);
		}
	}

	/**
	 * Reports a `<>` written with nothing between the angle brackets.
	 *
	 * The brackets are the whole of what the list is, so an empty one says
	 * nothing that leaving it out would not have said, and the grammar
	 * requires at least one entry rather than allowing the shorter spelling
	 * to mean something else.
	 * @param node The type parameter or type argument list node index.
	 * @param message What to report.
	 * @returns Nothing.
	 */
	private checkEmptyTypeList(node: number, message: string): void {
		const reader = this.reader;

		if (reader.listSize(reader.field(node, NODE_A)) === 0) {
			this.report(message, reader.start(node));
		}
	}

	/**
	 * Reports an enum member named in a way an enum member may not be.
	 *
	 * An enum maps names to values and its members are read back by name, so
	 * the name has to be one the reader can write: a computed key is not
	 * known until the program runs, and a numeric one would collide with the
	 * reverse mapping an enum already keeps from value to name.
	 * @param node The enum member node index.
	 * @returns Nothing.
	 */
	private checkEnumMember(node: number): void {
		const reader = this.reader;

		if ((reader.flags(node) & NF_COMPUTED) !== 0) {
			this.report(
				"An enum member name may not be computed.",
				reader.start(node),
			);
			return;
		}

		const name = reader.field(node, NODE_A);

		if (
			name !== 0 &&
			reader.kind(name) === N_Literal &&
			(reader.field(name, NODE_A) === LIT_NUMBER ||
				reader.field(name, NODE_A) === LIT_BIGINT)
		) {
			this.report(
				"An enum member may not have a numeric name.",
				reader.start(name),
			);
		}
	}

	/**
	 * Reports a namespace named by a string.
	 *
	 * `declare module "m"` names another file, which is why a string stands
	 * there. A `namespace` names a binding in this one, and a string is not
	 * a binding.
	 * @param node The module declaration node index.
	 * @returns Nothing.
	 */
	private checkModuleName(node: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);

		if (id === 0 || reader.kind(id) !== N_Literal) {
			return;
		}

		const kind =
			(reader.flags(node) & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT;

		if (kind !== MODULE_MODULE) {
			this.report(
				"A namespace may not be named by a string.",
				reader.start(id),
			);
		}
	}

	/**
	 * Records the parameter properties a constructor implementation may have.
	 *
	 * Only a constructor with a body may declare them, because a parameter
	 * property is an assignment the constructor performs, and a signature
	 * performs nothing. That rules out every other method, every plain
	 * function, and a constructor overload signature alike.
	 * @param node The method node index.
	 * @returns Nothing.
	 */
	private permitParameterProperties(node: number): void {
		const reader = this.reader;
		const flags = reader.flags(node);

		if ((flags & MKIND_MASK) >>> MKIND_SHIFT !== MKIND_CONSTRUCTOR) {
			return;
		}

		const value = reader.field(node, NODE_B);

		if (value === 0 || reader.field(value, NODE_C) === 0) {
			return;
		}

		const params = reader.field(value, NODE_B);
		const size = reader.listSize(params);

		for (let i = 0; i < size; i++) {
			const param = reader.listItem(params, i);

			if (reader.kind(param) === N_TSParameterProperty) {
				this.permittedParameterProperties.add(param);
			}
		}
	}

	/**
	 * Reports a parameter property written where none may stand.
	 *
	 * Beyond the constructor it needs, the modifier names a field to copy
	 * the parameter into, so the parameter has to be one thing with one
	 * name: a rest parameter is a list, and a binding pattern names no
	 * single thing at all.
	 * @param node The parameter property node index.
	 * @returns Nothing.
	 */
	private checkParameterProperty(node: number): void {
		const reader = this.reader;

		if (!this.permittedParameterProperties.has(node)) {
			this.report(
				"A parameter property may only appear in a constructor implementation.",
				reader.start(node),
			);
			return;
		}

		const parameter = reader.field(node, NODE_A);
		const kind = reader.kind(parameter);

		if (kind === N_RestElement) {
			this.report(
				"A parameter property may not be a rest parameter.",
				reader.start(node),
			);
		} else if (kind === N_ObjectPattern || kind === N_ArrayPattern) {
			this.report(
				"A parameter property may not use a binding pattern.",
				reader.start(node),
			);
		}
	}

	/**
	 * Records a type parameter list whose parameters may carry variance.
	 * @param node The type parameter declaration node index, or `0`.
	 * @returns Nothing.
	 */
	private permitVariance(node: number): void {
		if (node !== 0) {
			this.variantTypeParameters.add(node);
		}
	}

	/**
	 * Reports `in` or `out` on a type parameter that may not vary.
	 *
	 * Variance annotations say how a parameterized type relates to another
	 * with a different argument, which only a named type has to answer for.
	 * A function's type parameter is solved at the call rather than related
	 * to anything, so the annotation has nothing to say there.
	 *
	 * The four declarations that may carry them register their list before
	 * the walk descends into it, which is the same order the private-name
	 * check relies on.
	 * @param node The type parameter declaration node index.
	 * @returns Nothing.
	 */
	private checkTypeParameterVariance(node: number): void {
		if (this.variantTypeParameters.has(node)) {
			return;
		}

		const reader = this.reader;
		const size = reader.listSize(reader.field(node, NODE_A));
		const params = reader.field(node, NODE_A);

		for (let i = 0; i < size; i++) {
			const param = reader.listItem(params, i);

			if ((reader.flags(param) & (NF_IN | NF_STATIC)) !== 0) {
				this.report(
					"A variance annotation may only appear on a type parameter of a class, an interface, or a type alias.",
					reader.start(param),
				);
			}
		}
	}

	/**
	 * Reports a function declaration that says two things at once.
	 *
	 * `declare` says the function is defined elsewhere, so a body contradicts
	 * it outright, and `async` and `function*` describe how a body runs — a
	 * declaration with neither has nothing to say about either. A body-less
	 * generator is the same objection from the other side: a signature
	 * describes a call, and being a generator is a fact about the body it
	 * does not have.
	 *
	 * The `declare` read here is the keyword on the declaration itself, not
	 * the ambient context it may sit in, which is what the reference parser
	 * reads: `declare namespace N { function f() {} }` is accepted.
	 * @param node The function node index.
	 * @param kind The function node kind.
	 * @param flags The function node flags.
	 * @param body The body node index, or `0` for a signature.
	 * @returns Nothing.
	 */
	private checkAmbientFunction(
		node: number,
		kind: number,
		flags: number,
		body: number,
	): void {
		if (kind !== N_FunctionDeclaration && kind !== N_TSDeclareFunction) {
			return;
		}

		const start = this.reader.start(node);

		if ((flags & NF_DECLARE) !== 0) {
			if (body !== 0) {
				this.report(
					"An ambient function declaration may not have a body.",
					start,
				);
			} else if ((flags & NF_ASYNC) !== 0) {
				this.report(
					"An ambient function declaration may not be async.",
					start,
				);
			} else if ((flags & NF_GENERATOR) !== 0) {
				this.report(
					"An ambient function declaration may not be a generator.",
					start,
				);
			}

			return;
		}

		if (body === 0 && (flags & NF_GENERATOR) !== 0) {
			this.report("A function signature may not be a generator.", start);
		}
	}

	/**
	 * Reports a definite assignment assertion that promises nothing.
	 *
	 * `!` tells TypeScript a binding is assigned before it is read, which is
	 * a claim about code the declaration does not contain. It is therefore
	 * only meaningful where an initializer is absent and a type is written,
	 * and only where the binding could have been left unassigned at all — a
	 * `const`, a `using`, an ambient declaration, and an abstract member each
	 * settle that question already.
	 * @param node The declarator or class property.
	 * @param initializer The initializer node index, or `0`.
	 * @param typeAnnotation The type annotation node index, or `0`.
	 * @param settled Whether the binding's assignment is already decided.
	 * @returns Nothing.
	 */
	private checkDefiniteAssertion(
		node: number,
		initializer: number,
		typeAnnotation: number,
		settled: boolean,
	): void {
		const reader = this.reader;

		if ((reader.flags(node) & NF_DEFINITE) === 0) {
			return;
		}

		if (settled) {
			this.report(
				"A definite assignment assertion is not allowed here.",
				reader.start(node),
			);
			return;
		}

		if (initializer !== 0) {
			this.report(
				"A definite assignment assertion may not be combined with an initializer.",
				reader.start(node),
			);
			return;
		}

		if (typeAnnotation === 0) {
			this.report(
				"A definite assignment assertion requires a type annotation.",
				reader.start(node),
			);
		}
	}

	/**
	 * Reports an import attribute key written twice.
	 *
	 * A `with` clause is a set of keys, and the key may be written as an
	 * identifier or as a string, so `{ type: "json", "typ\\u0065": "" }` is one
	 * key twice over. Comparing what the two spell rather than how they are
	 * spelled is the whole of it.
	 * @param handle The list handle of the attributes.
	 * @returns Nothing.
	 */
	private checkImportAttributes(handle: number): void {
		const reader = this.reader;
		const size = reader.listSize(handle);

		if (size < 2) {
			return;
		}

		const seen = new Set<string>();

		for (let i = 0; i < size; i++) {
			const attribute = reader.listItem(handle, i);
			const key = reader.field(attribute, NODE_A);

			if (key === 0) {
				continue;
			}

			const name =
				reader.kind(key) === N_Literal
					? decodeEscapes(reader.text(key).slice(1, -1), false)
					: this.identifierName(key);

			if (seen.has(name)) {
				this.report(
					`Duplicate import attribute '${name}'.`,
					reader.start(key),
				);

				continue;
			}

			seen.add(name);
		}
	}

	/**
	 * Checks the names a module exports.
	 *
	 * Three rules meet at the top level of a module and nowhere else, which
	 * is why this is a pass of its own rather than a case in the walk. Two
	 * exports may not name the same thing, since an importer asking for the
	 * name would have no way to say which it meant. An export written
	 * without a `from` clause names something the module itself declares, so
	 * a name nothing declares is an error rather than a re-export — and a
	 * string can never be the name of a local binding. And a module export
	 * name written as a string has to be well-formed Unicode.
	 *
	 * It runs after the walk because the second rule needs the whole module
	 * scope: a `var` inside a block at the top level binds here too, and
	 * hoisting alone does not see it.
	 * @param handle The list handle of the module's items.
	 * @returns Nothing.
	 */
	private checkModuleExports(handle: number): void {
		const reader = this.reader;
		const size = reader.listSize(handle);
		const exported = new Set<string>();
		const scope = this.scope;

		for (let i = 0; i < size; i++) {
			const item = reader.listItem(handle, i);

			switch (reader.kind(item)) {
				case N_ImportDeclaration: {
					const specifiers = reader.field(item, NODE_A);
					const count = reader.listSize(specifiers);

					for (let j = 0; j < count; j++) {
						const specifier = reader.listItem(specifiers, j);

						if (reader.kind(specifier) === N_ImportSpecifier) {
							this.moduleExportName(
								reader.field(specifier, NODE_A),
							);
						}
					}

					break;
				}

				/*
				 * Two kinds of default export do not occupy the slot. A
				 * body-less function is a TypeScript overload signature,
				 * which describes the export rather than being it, so
				 * `export default function f(): T;` may be written as many
				 * times as there are overloads. An interface exports a type
				 * and nothing else, so it merges with whatever exports the
				 * value — the same reason `addDeclaredExports` leaves the
				 * TypeScript declaration kinds alone.
				 */
				case N_ExportDefaultDeclaration: {
					const exportedKind = reader.kind(
						reader.field(item, NODE_A),
					);

					if (
						exportedKind !== N_TSDeclareFunction &&
						exportedKind !== N_TSInterfaceDeclaration
					) {
						this.addExportedName(
							exported,
							"default",
							reader.start(item),
						);
					}

					break;
				}

				case N_ExportAllDeclaration: {
					const alias = reader.field(item, NODE_A);

					if (alias !== 0) {
						this.addExportedName(
							exported,
							this.moduleExportName(alias),
							reader.start(alias),
						);
					}

					break;
				}

				case N_ExportNamedDeclaration: {
					const declaration = reader.field(item, NODE_A);

					if (declaration !== 0) {
						this.addDeclaredExports(exported, declaration);
						break;
					}

					const specifiers = reader.field(item, NODE_B);
					const count = reader.listSize(specifiers);
					const reexport = reader.field(item, NODE_C) !== 0;

					for (let j = 0; j < count; j++) {
						const specifier = reader.listItem(specifiers, j);
						const local = reader.field(specifier, NODE_A);
						const alias = reader.field(specifier, NODE_B);
						const name = this.moduleExportName(local);

						this.addExportedName(
							exported,
							alias === local
								? name
								: this.moduleExportName(alias),
							reader.start(alias === 0 ? local : alias),
						);

						/*
						 * A re-export names something in the other module, so
						 * only a bare `export { x }` has to resolve here.
						 */
						if (reexport || name === null) {
							continue;
						}

						/*
						 * A local binding's name is an identifier, so a string
						 * on this side never resolves however it is spelled —
						 * `export { "foo" }` is an error even in a module that
						 * declares `foo`.
						 */
						if (reader.kind(local) === N_Literal) {
							this.report(
								"A module export name written as a string may only name an export of another module.",
								reader.start(local),
							);

							continue;
						}

						if (
							scope.names?.has(name) === true ||
							scope.varNames?.has(name) === true
						) {
							continue;
						}

						this.report(
							`Export '${name}' is not defined in the module.`,
							reader.start(local),
						);
					}

					break;
				}

				default:
					break;
			}
		}
	}

	/**
	 * Records the names an exported declaration binds.
	 *
	 * The TypeScript declaration kinds are deliberately absent. Two of them
	 * with one name are a merge rather than a redeclaration — an `interface`
	 * beside a `const`, an `enum` beside a `namespace` — so counting their
	 * names as exports would report code TypeScript accepts.
	 * @param exported The names exported so far.
	 * @param declaration The declaration the `export` wraps.
	 * @returns Nothing.
	 */
	private addDeclaredExports(
		exported: Set<string>,
		declaration: number,
	): void {
		const reader = this.reader;
		const kind = reader.kind(declaration);

		if (kind === N_VariableDeclaration) {
			const declarations = reader.field(declaration, NODE_A);
			const size = reader.listSize(declarations);

			for (let i = 0; i < size; i++) {
				this.addPatternExports(
					exported,
					reader.field(reader.listItem(declarations, i), NODE_A),
				);
			}

			return;
		}

		if (kind !== N_FunctionDeclaration && kind !== N_ClassDeclaration) {
			return;
		}

		const id = reader.field(declaration, NODE_A);

		if (id !== 0) {
			this.addExportedName(
				exported,
				this.identifierName(id),
				reader.start(id),
			);
		}
	}

	/**
	 * Records every name a binding pattern binds.
	 * @param exported The names exported so far.
	 * @param node The pattern node index, or `0`.
	 * @returns Nothing.
	 */
	private addPatternExports(exported: Set<string>, node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;

		switch (reader.kind(node)) {
			case N_Identifier:
				this.addExportedName(
					exported,
					this.identifierName(node),
					reader.start(node),
				);
				return;

			case N_ArrayPattern: {
				const elements = reader.field(node, NODE_A);
				const size = reader.listSize(elements);

				for (let i = 0; i < size; i++) {
					this.addPatternExports(
						exported,
						reader.listItem(elements, i),
					);
				}

				return;
			}

			case N_ObjectPattern: {
				const properties = reader.field(node, NODE_A);
				const size = reader.listSize(properties);

				for (let i = 0; i < size; i++) {
					const property = reader.listItem(properties, i);

					this.addPatternExports(
						exported,
						reader.field(
							property,
							reader.kind(property) === N_Property
								? NODE_B
								: NODE_A,
						),
					);
				}

				return;
			}

			case N_AssignmentPattern:
			case N_RestElement:
				this.addPatternExports(exported, reader.field(node, NODE_A));
				return;

			default:
				return;
		}
	}

	/**
	 * Records one exported name, reporting a second export of it.
	 * @param exported The names exported so far.
	 * @param name The name, or `null` when there is none to record.
	 * @param start The offset to report a duplicate at.
	 * @returns Nothing.
	 */
	private addExportedName(
		exported: Set<string>,
		name: string | null,
		start: number,
	): void {
		if (name === null) {
			return;
		}

		if (exported.has(name)) {
			this.report(`Duplicate export of '${name}'.`, start);
			return;
		}

		exported.add(name);
	}

	/**
	 * Reads a `ModuleExportName`, which is an identifier or a string literal.
	 * @param node The name node index, or `0`.
	 * @returns The name it spells, or `null` when there is no node.
	 */
	private moduleExportName(node: number): string | null {
		if (node === 0) {
			return null;
		}

		const reader = this.reader;

		if (reader.kind(node) !== N_Literal) {
			return this.identifierName(node);
		}

		const raw = reader.text(node);
		const value = decodeEscapes(raw.slice(1, -1), false);

		if (!isWellFormedUnicode(value)) {
			this.report(
				"A module export name written as a string must be well-formed Unicode.",
				reader.start(node),
			);
		}

		return value;
	}

	/**
	 * Declares the local name of every specifier of an import declaration.
	 * @param node The `ImportDeclaration` node index.
	 * @returns Nothing.
	 */
	private declareImportDeclaration(node: number): void {
		const reader = this.reader;
		const specifiers = reader.field(node, NODE_A);
		const size = reader.listSize(specifiers);

		/*
		 * `import type { A } from "m"` brings in a name that exists only in
		 * type space, so a value of the same name may sit beside it. Whether
		 * it really may depends on what the other module exports — TypeScript
		 * allows the pair above and rejects it when `A` is imported by
		 * default, because a default export is a value — and that is a
		 * question about the module graph, which nothing here can see. Binding
		 * it as a type is the reading that errs toward accepting: it can miss
		 * a collision, where the other reading reports working code.
		 */
		const typeOnly = (reader.flags(node) & NF_TYPE_ONLY) !== 0;

		for (let i = 0; i < size; i++) {
			const specifier = reader.listItem(specifiers, i);

			/*
			 * A named specifier carries the imported name first and the local
			 * one second; a default or namespace specifier has only the local
			 * name.
			 */
			const local = reader.field(
				specifier,
				reader.kind(specifier) === N_ImportSpecifier ? NODE_B : NODE_A,
			);

			this.checkRestrictedName(local, "bound");
			this.declare(
				local,
				typeOnly || (reader.flags(specifier) & NF_TYPE_ONLY) !== 0
					? BINDING_TYPE
					: BINDING_LEXICAL,
			);
		}
	}

	/**
	 * Declares every identifier inside a binding pattern, and reports a
	 * pattern that is not a shape a pattern may take.
	 *
	 * The shape rules are the same ones `checkArrayPattern()` and
	 * `checkObjectPattern()` apply on the left of an assignment, because a
	 * rest element collects what is left over either way and there is nothing
	 * left over after it. They are checked here rather than there because
	 * this is the walk that reaches a binding: `[...a, b] = c` and
	 * `var [...a, b] = c` are the same mistake arrived at down two paths.
	 * @param node The pattern node index.
	 * @param binding How the names are being introduced.
	 * @returns Nothing.
	 */
	private declarePattern(node: number, binding: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				this.checkRestrictedName(node, "bound");

				/*
				 * `let let` is banned outright, sloppy code included, because
				 * a lexical declaration reading its own keyword back as the
				 * name it binds is exactly the ambiguity `let` was given a
				 * lookahead restriction to avoid. `var let` stays legal — a
				 * `var` never had the problem — and so does `catch (let)`,
				 * which binds without declaring.
				 */
				if (
					binding === BINDING_LEXICAL &&
					this.identifierName(node) === "let"
				) {
					this.report(
						"'let' may not be the name a lexical declaration binds.",
						reader.start(node),
					);
				}

				/*
				 * `this` gets this far only because a parameter list may bind
				 * it: TypeScript's `this` parameter names the receiver rather
				 * than an argument. Everywhere else it is a name no reference
				 * could reach, since `this` in the body would still mean the
				 * receiver. Written with an escape it never arrives at all —
				 * the tokenizer refuses that outright — so the first letter
				 * rules out every other name.
				 */
				if (
					binding !== BINDING_PARAM &&
					reader.source.charCodeAt(reader.start(node)) === CH_t &&
					this.keywordAt(node) === T_this
				) {
					this.report(
						"'this' may not be bound as a name.",
						reader.start(node),
					);
				}

				this.declare(node, binding);
				return;

			case N_ArrayPattern: {
				const elements = reader.field(node, NODE_A);
				const size = reader.listSize(elements);

				for (let i = 0; i < size; i++) {
					const element = reader.listItem(elements, i);

					/*
					 * A hole is written as a missing element, so a `null`
					 * after the rest is `[...a, ,]` — an element, and one the
					 * rest has already swallowed.
					 */
					if (
						element !== 0 &&
						reader.kind(element) === N_RestElement
					) {
						if (i === size - 1) {
							this.checkCommaAfterRest(node, element);
						} else {
							this.report(
								"A rest element must be the last element.",
								reader.start(element),
							);
						}
					}

					this.declarePattern(element, binding);
				}

				return;
			}

			case N_ObjectPattern: {
				const properties = reader.field(node, NODE_A);
				const size = reader.listSize(properties);

				for (let i = 0; i < size; i++) {
					const property = reader.listItem(properties, i);
					const isProperty = reader.kind(property) === N_Property;
					const target = reader.field(
						property,
						isProperty ? NODE_B : NODE_A,
					);

					if (!isProperty) {
						if (i === size - 1) {
							this.checkCommaAfterRest(node, property);
						} else {
							this.report(
								"A rest element must be the last element.",
								reader.start(property),
							);
						}

						/*
						 * `{ ...rest }` binds one plain name: there is no
						 * iterator to take apart here, only the properties
						 * nothing else claimed, and they arrive as an object
						 * that has to go somewhere whole. The assignment form
						 * is wider — `({ ...a.b } = c)` is legal — because it
						 * stores into a target rather than binding a name.
						 */
						if (
							target !== 0 &&
							reader.kind(target) !== N_Identifier
						) {
							this.report(
								"A rest element in an object pattern must be an identifier.",
								reader.start(target),
							);
						}
					}

					this.declarePattern(target, binding);
				}

				return;
			}

			case N_AssignmentPattern:
			case N_RestElement:
				this.declarePattern(reader.field(node, NODE_A), binding);
				return;

			default:
				return;
		}
	}

	/**
	 * Binds a name in the current scope and reports illegal redeclarations.
	 * @param identifier The `Identifier` node index, or `0`.
	 * @param binding How the name is being introduced.
	 * @returns Nothing.
	 */
	private declare(identifier: number, binding: number): void {
		if (identifier === 0) {
			return;
		}

		const reader = this.reader;

		if (reader.kind(identifier) !== N_Identifier) {
			return;
		}

		/*
		 * Two bindings collide when their `StringValue`s match, which is what
		 * the escapes in them mean rather than how they are spelled, and
		 * which stops at the name — an `Identifier` node runs on through
		 * whatever TypeScript hung off it. Reading the node's text instead
		 * would let `let x: number` and `let x: string` pass for different
		 * names, and `\u0061` for something other than `a`.
		 */
		const name = this.identifierName(identifier);
		const start = reader.start(identifier);

		/*
		 * Nothing checks the word here. Every binding identifier is also
		 * reached by the walk, which checks all of them in one place —
		 * references and labels included — so doing it here too would report
		 * a binding twice.
		 */

		if (binding === BINDING_VAR) {
			this.declareVar(name, start);
			return;
		}

		const scope = this.scope;
		const existing = scope.names?.get(name);

		if (
			existing !== undefined
				? this.conflicts(existing, binding)
				: scope.varNames?.has(name) === true &&
					!this.tolerantOfVar(binding)
		) {
			this.report(
				`Identifier '${name}' has already been declared.`,
				start,
			);

			return;
		}

		/*
		 * A signature written after the implementation must not erase the
		 * record of the implementation, or a second implementation would go
		 * unreported.
		 */
		if (
			binding === BINDING_SIGNATURE &&
			existing !== undefined &&
			isFunctionBinding(existing)
		) {
			return;
		}

		(scope.names ??= new Map()).set(name, binding);
	}

	/**
	 * Binds a name that climbs to the nearest function scope, recording it in
	 * every scope it passes through so that a lexical declaration written
	 * later in any of them is still caught.
	 * @param name The name being bound.
	 * @param start The offset of the identifier.
	 * @returns Nothing.
	 */
	private declareVar(name: string, start: number): void {
		let scope = this.scope;

		for (;;) {
			const existing = scope.names?.get(name);

			if (existing !== undefined && !this.tolerantOfVar(existing)) {
				this.report(
					`Identifier '${name}' has already been declared.`,
					start,
				);

				return;
			}

			(scope.varNames ??= new Set()).add(name);

			if (scope.isFunctionScope || scope.parent === null) {
				return;
			}

			scope = scope.parent;
		}
	}

	/**
	 * Determines whether a binding may share its scope with a `var` of the
	 * same name.
	 * @param binding How the name was introduced.
	 * @returns `true` when the two may coexist.
	 */
	private tolerantOfVar(binding: number): boolean {
		return (
			binding !== BINDING_LEXICAL &&
			binding !== BINDING_AMBIENT_CLASS &&
			!isFunctionBinding(binding)
		);
	}

	/**
	 * Determines whether two bindings of the same name may coexist.
	 * @param existing How the name was first introduced.
	 * @param incoming How the name is being introduced now.
	 * @returns `true` when the pair is an illegal redeclaration.
	 */
	private conflicts(existing: number, incoming: number): boolean {
		// Types may merge freely with each other and with values.
		if (existing === BINDING_TYPE || incoming === BINDING_TYPE) {
			return false;
		}

		if (existing === BINDING_PARAM && incoming === BINDING_PARAM) {
			return this.uniqueParams;
		}

		/*
		 * Overload signatures merge with each other and with the
		 * implementation they belong to, so only two implementations of the
		 * same name are a redeclaration — and then only where a function
		 * declaration binds lexically, since two of them in a function scope
		 * are as legal as two `var`s.
		 */
		/*
		 * An ambient class is what a signature describes when the thing
		 * described is a class, so the two are one declaration. It merges
		 * with a function implementation for the same reason, which
		 * TypeScript states from the other side: "Function with bodies can
		 * only merge with classes that are ambient." Drop the `declare` and
		 * the pair is a redeclaration again, and a `var`, a `let`, or a
		 * second class beside either is a collision however it is written.
		 */
		if (
			(existing === BINDING_AMBIENT_CLASS &&
				(incoming === BINDING_SIGNATURE ||
					isFunctionBinding(incoming))) ||
			(incoming === BINDING_AMBIENT_CLASS &&
				(existing === BINDING_SIGNATURE || isFunctionBinding(existing)))
		) {
			return false;
		}

		if (
			(isFunctionBinding(existing) || existing === BINDING_SIGNATURE) &&
			(isFunctionBinding(incoming) || incoming === BINDING_SIGNATURE)
		) {
			/*
			 * Two implementations of the same name in one block are what
			 * Annex B forgives, and only as it is written there: the rule
			 * names `FunctionDeclaration`, so a generator or an async
			 * function on either side takes the pair back out of it.
			 */
			return (
				isFunctionBinding(existing) &&
				isFunctionBinding(incoming) &&
				(this.strict ||
					existing === BINDING_ASYNC_OR_GENERATOR ||
					incoming === BINDING_ASYNC_OR_GENERATOR)
			);
		}

		return true;
	}

	/**
	 * Reports a word that may not be an identifier where it was written.
	 *
	 * Three rules meet here. Strict mode reserves a fixed list. A generator
	 * reserves `yield`, and an async function — or a module, or a class static
	 * block — reserves `await`; those two are reserved by *position* rather
	 * than by strict mode, which is why a sloppy script may still name a
	 * variable `yield` outside a generator.
	 * @param kind The keyword kind the word matched, if any.
	 * @param start Where the word is, as an offset into the program text.
	 * @returns Nothing.
	 */
	private checkReservedWord(kind: number, start: number): void {
		if (kind < KEYWORD_FIRST || kind > KEYWORD_LAST) {
			return;
		}

		if (kind === T_yield && this.inGenerator) {
			this.report(
				"'yield' cannot be used as an identifier inside a generator.",
				start,
			);

			return;
		}

		if (kind === T_await && this.awaitReserved) {
			this.report(
				this.sourceType === "module" && !this.inAsync
					? "'await' cannot be used as an identifier in a module."
					: "'await' cannot be used as an identifier here.",
				start,
			);

			return;
		}

		if (
			this.strict &&
			(KIND_KEYWORD_FLAGS[kind] & KW_STRICT_RESERVED) !== 0
		) {
			this.report(
				`Unexpected reserved word '${KEYWORD_NAMES[kind - KEYWORD_FIRST]}' in strict mode.`,
				start,
			);
		}
	}

	/**
	 * Checks one `Identifier` for a word that is reserved where it is written.
	 *
	 * This runs on every identifier in the program, so it opens with the
	 * cheapest test that can rule one out. Every word it looks for begins with
	 * one of six letters, and one that is written with an escape begins either
	 * with its own first letter or with the backslash that hides it — so a
	 * single table lookup on the first character settles the great majority.
	 * @param node The `Identifier` node index.
	 * @returns Nothing.
	 */
	private checkIdentifierWord(node: number): void {
		/*
		 * An `IdentifierName` may be any word at all. `o.await` and
		 * `({ yield: 1 })` are names rather than references, and the parser is
		 * the only thing that can tell, so it says so.
		 */
		if ((this.reader.flags(node) & NF_IDENTIFIER_NAME) !== 0) {
			return;
		}

		this.checkWordAt(node);
	}

	/**
	 * Checks a `super` used as the operand of a call or a member access.
	 *
	 * Sanctioning the node is what keeps the bare-`super` rule from firing on
	 * the legal ones: `check()` runs on a parent before the walk descends into
	 * it, so the operand is marked by the time it is reached.
	 * @param operand The callee or object node index, which may be anything.
	 * @param allowed Whether `super` is allowed to be used this way here.
	 * @param message What to report when it is not.
	 * @returns Nothing.
	 */
	private checkSuperOperand(
		operand: number,
		allowed: boolean,
		message: string,
	): void {
		if (operand === 0 || this.reader.kind(operand) !== N_Super) {
			return;
		}

		this.sanctionedSuper = operand;

		if (!allowed) {
			this.report(message, this.reader.start(operand));
		}
	}

	/**
	 * Checks the identifier a node uses as a name and as a reference at once.
	 *
	 * `({ await })`, `import { await }`, and `export { await }` each hold one
	 * `Identifier` in both slots, and the parser read it down the name path
	 * because that is what it looked like. The reference half still has to be
	 * checked, and this is where the double duty is visible.
	 * @param node The `Property`, `ImportSpecifier`, or `ExportSpecifier`.
	 * @returns Nothing.
	 */
	private checkSharedName(node: number): void {
		const reader = this.reader;
		const first = reader.field(node, NODE_A);

		if (
			first !== 0 &&
			first === reader.field(node, NODE_B) &&
			reader.kind(first) === N_Identifier
		) {
			this.checkWordAt(first);
		}
	}

	/**
	 * Checks an identifier's text for a word reserved where it is written.
	 * @param node The `Identifier` node index.
	 * @returns Nothing.
	 */
	private checkWordAt(node: number): void {
		const source = this.reader.source;
		const start = this.reader.start(node);
		const first = source.charCodeAt(start);

		if (
			first >= RESERVED_INITIALS.length ||
			RESERVED_INITIALS[first] === 0
		) {
			return;
		}

		this.checkReservedWord(this.keywordAt(node), start);
	}

	/**
	 * Reads which keyword an identifier's text spells, if it spells one.
	 * @param node The `Identifier` node index.
	 * @returns The keyword kind, or a value outside the keyword range.
	 */
	private keywordAt(node: number): number {
		const reader = this.reader;
		const source = reader.source;
		const start = reader.start(node);
		const nameEnd = reader.field(node, NODE_A);
		const end = nameEnd === 0 ? reader.end(node) : nameEnd;
		let hash = 0;
		let escaped = false;

		for (let i = start; i < end; i++) {
			const code = source.charCodeAt(i);

			if (code === CH_BACKSLASH) {
				escaped = true;
			}

			hash = hashChar(hash, code);
		}

		if (!escaped) {
			return lookupKeyword(source, start, end, hash);
		}

		/*
		 * A word written with an escape is the word it spells, so `yield`
		 * is `yield` and is reserved wherever `yield` is. Decoding costs a
		 * string, which is why it waits until an escape is known to be there.
		 */
		const name = decodeEscapes(source.slice(start, end), false);
		let decodedHash = 0;

		for (let i = 0; i < name.length; i++) {
			decodedHash = hashChar(decodedHash, name.charCodeAt(i));
		}

		return lookupKeyword(name, 0, name.length, decodedHash);
	}

	/**
	 * Checks the name a shorthand property is written with.
	 *
	 * `{ a }` means `{ a: a }`, so the one word is a name and a reference at
	 * once and has to be able to be both. A computed key, a string, and a
	 * number are names the shorthand cannot spell back out as a reference,
	 * and a reserved word is a name that is not one.
	 * @param node The `Property` node index.
	 * @returns Nothing.
	 */
	private checkShorthandName(node: number): void {
		const reader = this.reader;
		const key = reader.field(node, NODE_A);

		if (
			(reader.flags(node) & NF_COMPUTED) !== 0 ||
			key === 0 ||
			reader.kind(key) !== N_Identifier
		) {
			this.report(
				"A shorthand property must be written as a plain identifier.",
				reader.start(node),
			);

			return;
		}

		const keyword = this.keywordAt(key);

		if (
			keyword >= KEYWORD_FIRST &&
			keyword <= KEYWORD_LAST &&
			(KIND_KEYWORD_FLAGS[keyword] & KW_RESERVED) !== 0
		) {
			this.report(
				`Unexpected reserved word '${KEYWORD_NAMES[keyword - KEYWORD_FIRST]}'.`,
				reader.start(key),
			);

			return;
		}

		this.checkReservedWord(keyword, reader.start(key));
	}

	/**
	 * Checks the properties of an object literal.
	 *
	 * Two rules need to know that the literal was never reparsed as a
	 * pattern. `{ a = 1 }` is a `CoverInitializedName`, which only means
	 * something once the cover grammar is refined into a pattern; and
	 * `__proto__: v` sets the prototype rather than a property, so writing it
	 * twice is writing two different things into one place.
	 * @param node The `ObjectExpression` node index.
	 * @returns Nothing.
	 */
	private checkObjectLiteral(node: number): void {
		const reader = this.reader;
		const properties = reader.field(node, NODE_A);
		const size = reader.listSize(properties);
		let sawProto = false;

		for (let i = 0; i < size; i++) {
			const property = reader.listItem(properties, i);

			// A spread carries no name of its own.
			if (reader.kind(property) !== N_Property) {
				continue;
			}

			const flags = reader.flags(property);

			if ((flags & NF_SHORTHAND) !== 0) {
				const value = reader.field(property, NODE_B);

				if (value !== 0 && reader.kind(value) === N_AssignmentPattern) {
					this.report(
						"A shorthand property may only take a default inside a destructuring pattern.",
						reader.start(property),
					);
				}

				continue;
			}

			/*
			 * Only `__proto__: v` sets the prototype. A computed key does not,
			 * because the name is not known until the literal is evaluated,
			 * and neither a method nor an accessor does — those define an
			 * ordinary property that happens to be spelled that way.
			 */
			const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;

			if (
				(flags & (NF_COMPUTED | NF_METHOD)) !== 0 ||
				accessor === MKIND_GET ||
				accessor === MKIND_SET ||
				this.propertyName(property) !== "__proto__"
			) {
				continue;
			}

			if (sawProto) {
				this.report(
					"An object literal may only set '__proto__' once.",
					reader.start(property),
				);
			}

			sawProto = true;
		}
	}

	//-------------------------------------------------------------------------
	// `eval` and `arguments`
	//-------------------------------------------------------------------------

	/*
	 * Neither word is reserved, so both are ordinary names to read: `eval(x)`
	 * and `arguments[0]` are legal in the strictest code there is. What strict
	 * mode bans is putting a value *into* one — binding it or assigning to it
	 * — because an engine that could not see which `eval` a call names could
	 * not optimize anything around it.
	 *
	 * A class field initializer and a class static block ban `arguments`
	 * outright, mention included. Both are compiled into a function of their
	 * own that the surrounding code never calls, so an `arguments` written
	 * there would name that hidden function's argument list rather than the
	 * enclosing method's, which is never what anyone meant.
	 */

	/**
	 * Reports `eval` or `arguments` where strict mode will not have it.
	 * @param node The `Identifier` node index, or `0`.
	 * @param verb What is being done to it, for the message.
	 * @returns Nothing.
	 */
	private checkRestrictedName(node: number, verb: string): void {
		if (node === 0 || !this.strict || this.ambient) {
			return;
		}

		const reader = this.reader;
		const start = reader.start(node);
		const first = reader.source.charCodeAt(start);

		if (first !== CH_a && first !== CH_e && first !== CH_BACKSLASH) {
			return;
		}

		const name = this.identifierName(node);

		if (name === "eval" || name === "arguments") {
			this.report(`'${name}' cannot be ${verb} in strict mode.`, start);
		}
	}

	/**
	 * Finds the `arguments` that bans a field initializer or a static block.
	 *
	 * This is the specification's `ContainsArguments`, which is a search
	 * rather than a state the walk could carry: it crosses an arrow function,
	 * because an arrow has no argument list of its own to name, and stops at
	 * every other kind of function, because one written here would answer for
	 * its own `arguments`. A method contributes only its name, the key being
	 * evaluated outside the body it belongs to.
	 *
	 * What it looks for is the word rather than a reference to it, so a
	 * `var arguments` or a statement labelled `arguments` counts as well.
	 * The specification counts an `IdentifierReference` alone, but both
	 * `espree` and V8 read it this way, and telling the two apart would mean
	 * naming every position that binds a name in either language for the sake
	 * of programs no engine accepts. A binding is reported twice for it —
	 * once here and once by the strict mode rule that a class body always
	 * turns on — which is the whole of the difference in practice.
	 * @param node The node to search, or `0`.
	 * @returns The offending `Identifier`, or `0` if there is none.
	 */
	private findArguments(node: number): number {
		if (node === 0 || !this.mentionsArguments) {
			return 0;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				return (reader.flags(node) & NF_IDENTIFIER_NAME) === 0 &&
					this.identifierName(node) === "arguments"
					? node
					: 0;

			/*
			 * A function of its own brings its own `arguments`, so nothing
			 * inside one belongs to the initializer being searched. An arrow
			 * is missing from this list on purpose.
			 */
			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				return 0;

			/*
			 * A nested field or static block is searched on its own account,
			 * so only what sits outside its value — the key, and any
			 * decorator — is this one's to answer for. Reporting it twice is
			 * what this avoids; the specification counts it for both.
			 */
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractPropertyDefinition:
				return (
					this.findArguments(reader.field(node, NODE_A)) ||
					this.findArgumentsInList(reader.field(node, NODE_C))
				);

			case N_StaticBlock:
				return 0;

			default:
				break;
		}

		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];
			let found = 0;

			if (descriptor === SLOT_NODE) {
				found = this.findArguments(reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				found = this.findArgumentsInList(
					reader.field(node, NODE_A + slot),
				);
			}

			if (found !== 0) {
				return found;
			}
		}

		return 0;
	}

	/**
	 * Searches every element of a list for a banned `arguments`.
	 * @param handle The list handle.
	 * @returns The offending `Identifier`, or `0` if there is none.
	 */
	private findArgumentsInList(handle: number): number {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			const found = this.findArguments(this.reader.listItem(handle, i));

			if (found !== 0) {
				return found;
			}
		}

		return 0;
	}

	/**
	 * Reports an `arguments` written where it can only mean the wrong thing.
	 * @param found The offending `Identifier`, or `0` if there is none.
	 * @param where What contains it, for the message.
	 * @returns Nothing.
	 */
	private checkNoArguments(found: number, where: string): void {
		if (found !== 0) {
			this.report(
				`'arguments' cannot be used in ${where}.`,
				this.reader.start(found),
			);
		}
	}

	//-------------------------------------------------------------------------
	// JSX
	//-------------------------------------------------------------------------

	/**
	 * Reports a JSX element or fragment written where JSX is not enabled.
	 *
	 * `parse()` reads JSX unconditionally, because whether it is allowed is
	 * exactly the kind of question the text alone cannot answer. Only the
	 * outermost element or fragment is reported, so a whole tree costs one
	 * problem rather than one per node.
	 * @param node The `JSXElement` or `JSXFragment` node index.
	 * @returns Nothing.
	 */
	private checkJsxNotAllowed(node: number): void {
		if (!this.jsx && !this.inJsx) {
			this.report(
				"JSX syntax is not allowed unless the jsx option is enabled.",
				this.reader.start(node),
			);
		}
	}

	/**
	 * Reports a closing tag whose name does not match its opening tag.
	 *
	 * A mismatched pair still forms a well-shaped tree, so it is reported here
	 * rather than thrown during parsing.
	 * @param node The `JSXElement` node index.
	 * @returns Nothing.
	 */
	private checkJsxTagsMatch(node: number): void {
		const reader = this.reader;
		const closing = reader.field(node, NODE_B);

		if (closing === 0) {
			return;
		}

		const opening = reader.field(node, NODE_A);
		const openingName = this.jsxTagName(reader.field(opening, NODE_A));
		const closingName = this.jsxTagName(reader.field(closing, NODE_A));

		if (openingName !== closingName) {
			this.report(
				`JSX element <${openingName}> is closed by </${closingName}>.`,
				reader.start(closing),
			);
		}
	}

	/**
	 * Reads a JSX tag name with its internal whitespace removed, so that
	 * `<A.B>` and `</A . B>` compare equal.
	 * @param name The name node index.
	 * @returns The tag name as written, without whitespace.
	 */
	private jsxTagName(name: number): string {
		return name === 0 ? "" : this.reader.text(name).replace(/\s+/gu, "");
	}

	//-------------------------------------------------------------------------
	// Private Names
	//-------------------------------------------------------------------------

	/*
	 * A `#x` is not a property name but a binding, and the thing it binds in is
	 * the class body — one private environment per class, nested inside the
	 * environments of any enclosing classes. A reference resolves against that
	 * whole stack, which is what lets an inner class reach an outer class's
	 * `#x`, and what makes a reference with no class around it an error.
	 *
	 * Two things make this unlike the ordinary scope walk. A class may refer to
	 * a name declared *later* in its own body, so every name has to be
	 * collected before any member is visited. And the heritage clause is
	 * outside its own class's environment — `class C extends this.#x { #x; }`
	 * does not resolve — which is why `extends` is visited before the push.
	 */

	/**
	 * Collects the private names a class body declares, reporting the ones it
	 * may not declare twice.
	 *
	 * A name may appear twice only as a getter/setter pair on the same side of
	 * `static`, so what is remembered per name is enough to tell that pair from
	 * every other repeat.
	 * @param body The `ClassBody` node index.
	 * @returns The names it declares.
	 */
	private collectPrivateNames(body: number): Set<string> {
		const reader = this.reader;
		const members = reader.field(body, NODE_A);
		const size = reader.listSize(members);
		const names = new Set<string>();

		/** What has been seen for a name so far, to allow one getter/setter pair. */
		const seen = new Map<string, number>();

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(members, i);

			/*
			 * Not every member of a class body has a key. `StaticBlock` and
			 * `TSIndexSignature` both hold a *list* in slot A — the block's
			 * statements and the signature's parameters — and reading that
			 * list's offset as if it were a node index lands on whichever node
			 * happens to sit at that index. That is a silent misread rather
			 * than a crash: it usually names a node of some other kind and is
			 * skipped below, but a program large enough for the offset to
			 * reach a `PrivateIdentifier` elsewhere in the file reports a
			 * duplicate private name that was never written.
			 */
			const memberKind = reader.kind(member);

			if (
				memberKind === N_StaticBlock ||
				memberKind === N_TSIndexSignature
			) {
				continue;
			}

			const key = reader.field(member, NODE_A);

			if (
				key === 0 ||
				reader.kind(key) !== N_PrivateIdentifier ||
				(reader.flags(member) & NF_COMPUTED) !== 0
			) {
				continue;
			}

			this.permitPrivateName(key);

			const name = this.privateName(key);

			if (name === "#constructor") {
				this.report(
					"Classes may not have a private element named '#constructor'.",
					reader.start(key),
				);
				continue;
			}

			names.add(name);

			/*
			 * A getter and a setter pair up only with each other. Encoding the
			 * accessor kind and the `static` side in one number makes "have I
			 * already seen something this cannot sit beside?" a single lookup.
			 */
			const flags = reader.flags(member);
			const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;
			const isStatic = (flags & NF_STATIC) !== 0;
			const descriptor =
				accessor === MKIND_GET || accessor === MKIND_SET
					? accessor | (isStatic ? 4 : 0)
					: -1;
			const previous = seen.get(name);

			if (previous === undefined) {
				seen.set(name, descriptor);
				continue;
			}

			const pairs =
				descriptor >= 0 &&
				previous >= 0 &&
				(descriptor & 4) === (previous & 4) &&
				(descriptor & 3) !== (previous & 3);

			if (!pairs) {
				this.report(
					`Identifier '${name}' has already been declared.`,
					reader.start(key),
				);
				continue;
			}

			// A completed pair may not take a third member.
			seen.set(name, -1);
		}

		return names;
	}

	/**
	 * Reads a private name, resolving any escapes in it.
	 *
	 * Two private names are the same name when their `StringValue`s match, and
	 * `StringValue` is what the escapes mean rather than how they are spelled —
	 * `#℘` declares the same field `#℘` refers to. Comparing source text
	 * would report every escaped name as undeclared.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns The name, `#` included.
	 */
	private privateName(key: number): string {
		const raw = this.reader.text(key);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * Determines whether an expression reads a private field.
	 *
	 * Parentheses and an optional chain both wrap the member access without
	 * changing what is being deleted, so `delete (o?.#x)` has to be seen
	 * through to be reported.
	 * @param node The expression node index.
	 * @returns `true` when the expression is a private reference.
	 */
	private isPrivateReference(node: number): boolean {
		const reader = this.reader;
		let current = node;

		while (reader.kind(current) === N_ChainExpression) {
			current = reader.field(current, NODE_A);

			if (current === 0) {
				return false;
			}
		}

		if (reader.kind(current) !== N_MemberExpression) {
			return false;
		}

		const property = reader.field(current, NODE_B);

		return property !== 0 && reader.kind(property) === N_PrivateIdentifier;
	}

	/**
	 * Records that a `PrivateIdentifier` stands somewhere one may.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns Nothing.
	 */
	private permitPrivateName(key: number): void {
		if (this.permittedPrivateNames === null) {
			this.permittedPrivateNames = new Set();
		}

		this.permittedPrivateNames.add(key);
	}

	/**
	 * Reports a private name that no enclosing class declares.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns Nothing.
	 */
	private checkPrivateReference(key: number): void {
		const name = this.privateName(key);

		for (let i = this.privateNames.length - 1; i >= 0; i--) {
			if (this.privateNames[i].has(name)) {
				return;
			}
		}

		this.report(
			`Private field '${name}' must be declared in an enclosing class.`,
			this.reader.start(key),
		);
	}

	//-------------------------------------------------------------------------
	// Assignment Targets
	//-------------------------------------------------------------------------

	/*
	 * The spec calls this a node's `AssignmentTargetType`, and it is `simple`
	 * for exactly two things: a reference to a name, and a member access.
	 * Everything else is `invalid`, and assigning to it, incrementing it, or
	 * naming it in a `for-in`/`for-of` head is an early error.
	 *
	 * Destructuring widens that for `=` alone. `[a, b] = c` assigns through a
	 * pattern, so a pattern is allowed on the left of a plain assignment and
	 * of a `for-of` head, and each of its elements is then a target in its own
	 * right. It is *not* allowed on the left of `+=`, which has nothing to
	 * destructure.
	 *
	 * The parser has already done the hard half: it rewrites the left of a
	 * plain assignment into `ArrayPattern` and `ObjectPattern` where that
	 * reading works, so a bare `ArrayExpression` surviving to here is one that
	 * could not be reinterpreted.
	 */

	/**
	 * Reports an expression being assigned to that cannot be.
	 * @param node The target node index, or `0`.
	 * @param pattern Whether a destructuring pattern is allowed here, which it
	 *      is for `=` and a `for-of` head but not for `+=` or `++`.
	 * @param webCompat Whether a call may be assigned to in sloppy code, which
	 *      it may everywhere but in `&&=`, `||=`, and `??=`.
	 * @returns Nothing.
	 */
	private checkAssignmentTarget(
		node: number,
		pattern: boolean,
		webCompat = true,
	): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;

		switch (reader.kind(node)) {
			case N_Identifier:
				this.checkRestrictedName(node, "assigned to");
				return;

			case N_MemberExpression:
				return;

			/*
			 * A TypeScript wrapper is transparent here. `x! = 1` and
			 * `(x as T) = 1` are the parser's shape for an assignment to `x`,
			 * and `@typescript-eslint/parser` accepts both, so looking through
			 * keeps this from reporting real TypeScript.
			 */
			case N_TSNonNullExpression:
			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
			case N_TSTypeAssertion:
				this.checkAssignmentTarget(
					reader.field(node, NODE_A),
					pattern,
					webCompat,
				);
				return;

			/*
			 * Parentheses are what tell a pattern from a literal. `{a} = b`
			 * assigns through a pattern because the cover grammar is reparsed
			 * as one; `({a}) = b` cannot be, since what is parenthesized is
			 * an `ObjectLiteral` and its `AssignmentTargetType` is invalid.
			 * The parser rewrites both into a pattern, so the parenthesis is
			 * the only thing left that says which was written.
			 */
			case N_ArrayPattern:
				if (pattern && (reader.flags(node) & NF_PARENTHESIZED) === 0) {
					this.checkArrayPattern(node);
					return;
				}

				break;

			case N_ObjectPattern:
				if (pattern && (reader.flags(node) & NF_PARENTHESIZED) === 0) {
					this.checkObjectPattern(node);
					return;
				}

				break;

			/*
			 * `f() = 1` is an early error in strict code and, for web
			 * compatibility, only a runtime `ReferenceError` in sloppy code —
			 * the spec spells the sloppy answer `~web-compat~` rather than
			 * `~invalid~`. `espree` reports it either way, which is the one
			 * deviation this check carries; see `docs/deviations.md`.
			 *
			 * The carve-out reaches only as far as it is written. `&&=`,
			 * `||=`, and `??=` each ask for an `AssignmentTargetType` of
			 * `simple`, and `~web-compat~` is not that, so `f() &&= 1` is an
			 * early error in sloppy code as well.
			 */
			case N_CallExpression:
				if (!this.strict && webCompat) {
					return;
				}

				break;

			/*
			 * An optional chain is never a target: `a?.b = c` is an error even
			 * though `a.b = c` is fine, because the chain may produce
			 * `undefined` and there would be nothing to assign to.
			 */
			default:
				break;
		}

		this.report("Invalid assignment target.", reader.start(node));
	}

	/**
	 * Checks the elements of an array destructuring pattern.
	 *
	 * A rest element has to come last and take no default, since there is
	 * nothing after it to collect and nothing to be absent.
	 * @param node The `ArrayPattern` node index.
	 * @returns Nothing.
	 */
	private checkArrayPattern(node: number): void {
		const reader = this.reader;
		const elements = reader.field(node, NODE_A);
		const size = reader.listSize(elements);

		for (let i = 0; i < size; i++) {
			const element = reader.listItem(elements, i);

			// A hole is written as a missing element and targets nothing.
			if (element === 0) {
				continue;
			}

			if (reader.kind(element) !== N_RestElement) {
				this.checkPatternElement(element);
				continue;
			}

			if (i === size - 1) {
				this.checkCommaAfterRest(node, element);
			} else {
				this.report(
					"A rest element must be the last element.",
					reader.start(element),
				);
			}

			this.checkRestTarget(element);
		}
	}

	/**
	 * Checks the properties of an object destructuring pattern.
	 * @param node The `ObjectPattern` node index.
	 * @returns Nothing.
	 */
	private checkObjectPattern(node: number): void {
		const reader = this.reader;
		const properties = reader.field(node, NODE_A);
		const size = reader.listSize(properties);

		for (let i = 0; i < size; i++) {
			const property = reader.listItem(properties, i);

			if (reader.kind(property) === N_RestElement) {
				if (i === size - 1) {
					this.checkCommaAfterRest(node, property);
				} else {
					this.report(
						"A rest element must be the last element.",
						reader.start(property),
					);
				}

				this.checkRestTarget(property);
				continue;
			}

			this.checkPatternElement(reader.field(property, NODE_B));
		}
	}

	/**
	 * Reports a comma written after the rest element that ends a pattern.
	 * @param pattern The `ArrayPattern` or `ObjectPattern` node index.
	 * @param rest The `RestElement` that ends it.
	 * @returns Nothing.
	 */
	private checkCommaAfterRest(pattern: number, rest: number): void {
		if ((this.reader.flags(pattern) & NF_COMMA_AFTER_REST) !== 0) {
			this.report(
				"A comma is not allowed after a rest element.",
				this.reader.start(rest),
			);
		}
	}

	/**
	 * Checks one element of a pattern, seeing past its default.
	 * @param node The element node index, or `0`.
	 * @returns Nothing.
	 */
	private checkPatternElement(node: number): void {
		if (node === 0) {
			return;
		}

		this.checkAssignmentTarget(
			this.reader.kind(node) === N_AssignmentPattern
				? this.reader.field(node, NODE_A)
				: node,
			true,
		);
	}

	/**
	 * Checks what a rest element collects into.
	 * @param node The `RestElement` node index.
	 * @returns Nothing.
	 */
	private checkRestTarget(node: number): void {
		const target = this.reader.field(node, NODE_A);

		if (target !== 0 && this.reader.kind(target) === N_AssignmentPattern) {
			this.report(
				"A rest element cannot have an initializer.",
				this.reader.start(target),
			);

			return;
		}

		this.checkAssignmentTarget(target, true);
	}

	//-------------------------------------------------------------------------
	// `break` and `continue`
	//-------------------------------------------------------------------------

	/**
	 * Reports a `break` or `continue` with nothing to act on.
	 *
	 * Without a label, `break` needs a loop or a `switch` around it and
	 * `continue` needs a loop; with one, both need a labelled statement of
	 * that name, and `continue` needs that statement to be a loop. Either way
	 * the target has to be in the same function: a label is a name for a
	 * statement, and a nested function cannot leave a statement it is inside
	 * of rather than part of.
	 * @param node The `BreakStatement` or `ContinueStatement` node index.
	 * @param isContinue Whether it is a `continue`, which a `switch` and a
	 *      label on anything but a loop do not answer.
	 * @returns Nothing.
	 */
	private checkBreakOrContinue(node: number, isContinue: boolean): void {
		const reader = this.reader;
		const label = reader.field(node, NODE_A);
		const word = isContinue ? "continue" : "break";

		if (label === 0) {
			if (
				this.iterationDepth === 0 &&
				(isContinue || this.switchDepth === 0)
			) {
				this.report(
					isContinue
						? "'continue' must be inside a loop."
						: "'break' must be inside a loop or a switch.",
					reader.start(node),
				);
			}

			return;
		}

		const name = this.identifierName(label);

		for (const entry of this.labels) {
			if (entry.name !== name) {
				continue;
			}

			if (!isContinue || entry.iteration) {
				return;
			}

			this.report(
				`Label '${name}' is not on a loop, so 'continue' cannot name it.`,
				reader.start(node),
			);

			return;
		}

		this.report(
			`Label '${name}' is not enclosing this '${word}'.`,
			reader.start(node),
		);
	}

	//-------------------------------------------------------------------------
	// `for` Statement Heads
	//-------------------------------------------------------------------------

	/**
	 * Reports a `for-in` or `for-of` head that declares more than it may.
	 *
	 * A C-style head runs its initializer once and then tests; these two take
	 * their values from something else entirely, so a binding with an
	 * initializer has nowhere for the value to go and a second binding has
	 * nothing to bind. Annex B keeps the one spelling the web already had —
	 * `for (var x = 1 in y)` in sloppy code, and only for a plain name, since
	 * a pattern would have to be destructured before the loop could start.
	 * @param node The `ForInStatement` or `ForOfStatement` node index.
	 * @param isForOf Whether it is a `for-of`, which Annex B does not reach.
	 * @returns Nothing.
	 */
	private checkForHead(node: number, isForOf: boolean): void {
		const reader = this.reader;
		const left = reader.field(node, NODE_A);

		if (left === 0) {
			return;
		}

		if (reader.kind(left) !== N_VariableDeclaration) {
			/*
			 * `for (async of x)` is the one thing the grammar looks ahead to
			 * rule out, so that it never has to be told from the `for await`
			 * that was arriving at the same time. It is a restriction on the
			 * *token*, so all three ways out of it are lexical: parentheses
			 * make it an expression rather than the lookahead, an escape
			 * makes it a different token, and `for await (async of x)` is a
			 * production the restriction was never put on.
			 */
			if (
				isForOf &&
				(reader.flags(node) & NF_ASYNC) === 0 &&
				reader.kind(left) === N_Identifier &&
				(reader.flags(left) & NF_PARENTHESIZED) === 0 &&
				reader.text(left) === "async"
			) {
				this.report(
					"'async' may not be the target of a for-of loop.",
					reader.start(left),
				);
			}

			return;
		}

		const declarations = reader.field(left, NODE_A);
		const size = reader.listSize(declarations);

		if (size > 1) {
			this.report(
				"A for-in or for-of head may declare only one binding.",
				reader.start(reader.listItem(declarations, 1)),
			);

			return;
		}

		/*
		 * A `for-of` head hands each value to the binding, which is what a
		 * `using` needs; a `for-in` head hands it a key, and disposing of a
		 * property name is not a thing to want.
		 */
		if (!isForOf) {
			const headKind = (reader.flags(left) & DECL_MASK) >>> DECL_SHIFT;

			if (headKind === DECL_USING || headKind === DECL_AWAIT_USING) {
				this.report(
					`A '${DECL_KIND_NAMES[headKind]}' declaration may not head a for-in loop.`,
					reader.start(left),
				);
			}
		}

		const declarator = size === 0 ? 0 : reader.listItem(declarations, 0);

		if (declarator === 0) {
			return;
		}

		/*
		 * The loop is what says what the binding holds — an element of the
		 * iterable, or a key of the object — so writing a type for it is
		 * describing something the head has already settled.
		 */
		const target = reader.field(declarator, NODE_A);

		if (
			reader.kind(target) === N_Identifier &&
			reader.field(target, NODE_B) !== 0
		) {
			this.report(
				"A for-in or for-of head may not annotate its binding.",
				reader.start(reader.field(target, NODE_B)),
			);
		}

		if (reader.field(declarator, NODE_B) === 0) {
			return;
		}

		const declarationKind = (reader.flags(left) & DECL_MASK) >>> DECL_SHIFT;

		if (
			!isForOf &&
			declarationKind === DECL_VAR &&
			!this.strict &&
			reader.kind(reader.field(declarator, NODE_A)) === N_Identifier
		) {
			return;
		}

		this.report(
			"A for-in or for-of head may not have an initializer.",
			reader.start(reader.field(declarator, NODE_B)),
		);
	}

	//-------------------------------------------------------------------------
	// Class Element Names
	//-------------------------------------------------------------------------

	/*
	 * Three names are spoken for inside a class body. `constructor` names the
	 * one method the `new` operator runs, so it may not also be a field, and
	 * it may not be a method of a kind that could not be run that way — a
	 * getter, a setter, a generator, or an async function. `prototype` is
	 * already a property of the constructor function itself, so no static
	 * element may take it. And a class has one constructor.
	 *
	 * All three are rules about the *name*, which a computed key does not
	 * have: `class C { static ["prototype"]() {} }` is legal, because nothing
	 * can know what the brackets will produce until the class is evaluated.
	 */

	/**
	 * The name a class element is written with.
	 * @param node The element node index.
	 * @returns The name, or `null` for a computed or private one.
	 */
	private propertyName(node: number): string | null {
		const reader = this.reader;

		if ((reader.flags(node) & NF_COMPUTED) !== 0) {
			return null;
		}

		const key = reader.field(node, NODE_A);

		if (key === 0) {
			return null;
		}

		switch (reader.kind(key)) {
			case N_Identifier:
				return this.identifierName(key);

			/*
			 * A string key is the string it denotes, so
			 * `class C { "constructor"; }` is the same mistake written
			 * differently. A numeric one can never spell either name.
			 */
			case N_Literal:
				return reader.field(key, NODE_A) === LIT_STRING
					? decodeEscapes(reader.text(key).slice(1, -1), false)
					: null;

			default:
				return null;
		}
	}

	/**
	 * Reports a class element whose name it may not have.
	 * @param node The element node index.
	 * @param kind The element's node kind.
	 * @returns Nothing.
	 */
	private checkClassElementName(node: number, kind: number): void {
		const reader = this.reader;
		const flags = reader.flags(node);
		const isStatic = (flags & NF_STATIC) !== 0;
		const name = this.propertyName(node);

		if (name === null) {
			return;
		}

		if (isStatic && name === "prototype") {
			this.report(
				"A static class element may not be named 'prototype'.",
				reader.start(node),
			);

			return;
		}

		if (name !== "constructor") {
			return;
		}

		/*
		 * A field takes the name nowhere: there is no `constructor` field to
		 * be had, static or not, because the name belongs to the method that
		 * `new` runs and to the property that points back at the class.
		 */
		if (
			kind !== N_MethodDefinition &&
			kind !== N_TSAbstractMethodDefinition
		) {
			this.report(
				"A class field may not be named 'constructor'.",
				reader.start(node),
			);

			return;
		}

		/*
		 * A *static* method called `constructor` is an ordinary static member
		 * and escapes the rest of this — the name is only spoken for on the
		 * prototype side.
		 */
		if (isStatic) {
			return;
		}

		const value = reader.field(node, NODE_B);
		const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;

		if (
			accessor !== MKIND_CONSTRUCTOR ||
			(value !== 0 &&
				(reader.flags(value) & (NF_GENERATOR | NF_ASYNC)) !== 0)
		) {
			this.report(
				"A class constructor may not be a getter, a setter, a generator, or async.",
				reader.start(node),
			);

			return;
		}

		/*
		 * A body-less constructor is a TypeScript overload signature, and
		 * signatures describe the one implementation rather than adding
		 * another — so only an implementation is counted, and two of those
		 * are what a class may not have.
		 */
		if (
			value === 0 ||
			reader.kind(value) === N_TSEmptyBodyFunctionExpression
		) {
			return;
		}

		if (this.sawConstructor) {
			this.report(
				"A class may not have more than one constructor.",
				reader.start(node),
			);

			return;
		}

		this.sawConstructor = true;
	}

	//-------------------------------------------------------------------------
	// Single-Statement Contexts
	//-------------------------------------------------------------------------

	/**
	 * Reports a declaration written where only a statement may go.
	 *
	 * The body of an `if`, a loop, a `with`, or a label is a `Statement`, and
	 * a `Declaration` is not one — there is nowhere for `let x = 1;` to bind
	 * when the only thing that can reach it is a branch that may not be
	 * taken. Annex B carves out the one case the web already depended on: a
	 * plain function declaration as the body of an `if`, or under a label, in
	 * sloppy code. Neither carve-out survives strict mode, and neither
	 * stretches to a generator or an async function, both of which Annex B
	 * predates.
	 * @param body The body node index, or `0`.
	 * @param allowFunction Whether Annex B's function carve-out reaches here.
	 * @returns Nothing.
	 */
	private checkStatementBody(body: number, allowFunction: boolean): void {
		if (body === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(body);

		if (kind === N_VariableDeclaration) {
			// `var` is the one declaration that is also a statement.
			if ((reader.flags(body) & DECL_MASK) >>> DECL_SHIFT === DECL_VAR) {
				return;
			}
		} else if (
			kind !== N_ClassDeclaration &&
			kind !== N_FunctionDeclaration
		) {
			return;
		}

		if (
			allowFunction &&
			!this.strict &&
			kind === N_FunctionDeclaration &&
			(reader.flags(body) & (NF_GENERATOR | NF_ASYNC)) === 0
		) {
			return;
		}

		this.report(
			"A declaration may not appear in a single-statement context.",
			reader.start(body),
		);
	}

	//-------------------------------------------------------------------------
	// Node Checks
	//-------------------------------------------------------------------------

	/**
	 * Applies the checks that belong to a single node.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private check(node: number, kind: number): void {
		if (this.dialect === "js" && kind >= TS_FIRST) {
			this.report(
				`TypeScript syntax is not allowed when the dialect is "js".`,
				this.reader.start(node),
			);
		}

		switch (kind) {
			case N_PropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractPropertyDefinition:
			case N_TSAbstractAccessorProperty: {
				const isAbstract =
					kind === N_TSAbstractPropertyDefinition ||
					kind === N_TSAbstractAccessorProperty;
				const value = this.reader.field(node, NODE_B);

				this.checkDefiniteAssertion(
					node,
					value,
					this.reader.field(node, NODE_D),
					isAbstract,
				);

				/*
				 * `abstract` says a derived class supplies the member, so
				 * supplying it here is the one thing the modifier rules out.
				 */
				if (isAbstract && value !== 0) {
					this.report(
						"An abstract class element may not have an initializer.",
						this.reader.start(node),
					);
				}

				this.checkClassElementName(node, kind);
				return;
			}

			case N_MethodDefinition:
				this.checkMethodModifiers(node);
				this.checkDecoratedOverload(node);
				this.permitParameterProperties(node);
				this.checkClassElementName(node, kind);
				return;

			case N_TSParameterProperty:
				this.checkParameterProperty(node);
				return;

			case N_TSIndexSignature:
				this.checkIndexSignature(node);
				return;

			case N_TSTypeParameterDeclaration:
				this.checkEmptyTypeList(
					node,
					"A type parameter list may not be empty.",
				);
				this.checkTypeParameterVariance(node);
				return;

			case N_TSTypeParameterInstantiation:
				this.checkEmptyTypeList(
					node,
					"A type argument list may not be empty.",
				);
				return;

			case N_TSEnumMember:
				this.checkEnumMember(node);
				return;

			case N_TSModuleDeclaration:
				this.checkModuleName(node);
				return;

			case N_ClassDeclaration:
			case N_ClassExpression:
				this.permitVariance(this.reader.field(node, NODE_D));

				if (
					kind === N_ClassDeclaration &&
					this.reader.field(node, NODE_A) === 0 &&
					this.anonymousClassAllowed !== node
				) {
					this.report(
						"A class declaration must have a name unless it is the default export.",
						this.reader.start(node),
					);
				}

				return;

			case N_TSInterfaceDeclaration:
			case N_TSTypeAliasDeclaration:
				this.permitVariance(this.reader.field(node, NODE_C));
				return;

			case N_TSAbstractMethodDefinition: {
				const value = this.reader.field(node, NODE_B);

				this.checkMethodModifiers(node);

				if (value !== 0 && this.reader.field(value, NODE_C) !== 0) {
					this.report(
						"An abstract class element may not have an implementation.",
						this.reader.start(node),
					);
				}

				this.checkClassElementName(node, kind);
				return;
			}

			case N_ImportDeclaration:
			case N_ExportNamedDeclaration:
			case N_ExportDefaultDeclaration:
			case N_ExportAllDeclaration:
				if (kind === N_ImportDeclaration) {
					this.checkTypeOnlyImport(node);
				}

				/*
				 * A class declaration needs a name to bind, except as the
				 * default export, where the export itself is the binding.
				 */
				if (kind === N_ExportDefaultDeclaration) {
					this.anonymousClassAllowed = this.reader.field(
						node,
						NODE_A,
					);
				}

				if (kind !== N_ExportDefaultDeclaration) {
					this.checkImportAttributes(
						this.reader.field(
							node,
							kind === N_ExportNamedDeclaration ? NODE_D : NODE_C,
						),
					);
				}

				if (this.sourceType !== "module") {
					this.report(
						"'import' and 'export' may only appear when sourceType is \"module\".",
						this.reader.start(node),
					);
				} else if (!this.moduleItemsAllowed) {
					/*
					 * A `ModuleItem` is not a `Statement`, so there is no
					 * production that puts one inside a block, a function, or
					 * the body of an `if`. TypeScript adds exactly one place:
					 * the body of a namespace or an ambient module.
					 */
					this.report(
						"'import' and 'export' may only appear at the top level of a module or a namespace.",
						this.reader.start(node),
					);
				}

				return;

			case N_BreakStatement:
			case N_ContinueStatement:
				this.checkBreakOrContinue(node, kind === N_ContinueStatement);
				return;

			/*
			 * Reached only where nothing above registered this node, since
			 * each of the three positions a private name may take does so
			 * before the walk descends to it.
			 */
			case N_PrivateIdentifier:
				if (this.permittedPrivateNames?.has(node) !== true) {
					this.report(
						"A private name may only be a class element's name, the property of a member access, or the left operand of 'in'.",
						this.reader.start(node),
					);
				}

				return;

			/*
			 * `\u`, `\x`, and a legacy octal escape all have readings a
			 * template may not take, and the tokenizer marks the element it
			 * found one in rather than throwing, because a *tagged* template
			 * may take them: its tag is handed the raw text, and the cooked
			 * value is `undefined`. Untagged, there is nothing to hand it to.
			 */
			case N_TemplateLiteral: {
				if (node === this.taggedQuasi || node === this.typeQuasi) {
					return;
				}

				const reader = this.reader;
				const quasis = reader.field(node, NODE_A);
				const size = reader.listSize(quasis);

				for (let i = 0; i < size; i++) {
					const quasi = reader.listItem(quasis, i);

					if ((reader.flags(quasi) & NF_INVALID_ESCAPE) !== 0) {
						this.report(
							"Invalid escape sequence in untagged template literal.",
							reader.start(quasi),
						);

						return;
					}
				}

				return;
			}

			case N_WithStatement:
				if (this.strict) {
					this.report(
						"Strict mode code may not include a with statement.",
						this.reader.start(node),
					);
				}

				this.checkStatementBody(this.reader.field(node, NODE_B), false);
				return;

			/*
			 * Annex B's carve-out reaches the two branches of an `if` and the
			 * body of a label, and nothing else: an iteration statement would
			 * declare the function afresh on every turn.
			 */
			case N_IfStatement:
				this.checkStatementBody(this.reader.field(node, NODE_B), true);
				this.checkStatementBody(this.reader.field(node, NODE_C), true);
				return;

			case N_LabeledStatement:
				this.checkStatementBody(
					this.reader.field(node, NODE_B),
					this.inStatementList,
				);
				return;

			case N_WhileStatement:
				this.checkStatementBody(this.reader.field(node, NODE_B), false);
				return;

			case N_DoWhileStatement:
				this.checkStatementBody(this.reader.field(node, NODE_A), false);
				return;

			case N_ForStatement:
				this.checkStatementBody(this.reader.field(node, NODE_D), false);
				return;

			/*
			 * The two places a private name is *used*: `o.#x`, and the
			 * `#x in o` form that exists to ask whether an object has one
			 * without throwing.
			 */
			case N_MemberExpression: {
				const property = this.reader.field(node, NODE_B);

				if (
					property !== 0 &&
					this.reader.kind(property) === N_PrivateIdentifier
				) {
					this.permitPrivateName(property);
					this.checkPrivateReference(property);

					/*
					 * A private name is looked up on the object itself, and
					 * `super` names the prototype rather than an object, so
					 * there is nothing for `super.#x` to read.
					 */
					if (
						this.reader.kind(this.reader.field(node, NODE_A)) ===
						N_Super
					) {
						this.report(
							"A private name may not be read on 'super'.",
							this.reader.start(node),
						);
					}
				}

				this.checkSuperOperand(
					this.reader.field(node, NODE_A),
					this.superPropertyAllowed,
					"'super' may only be read inside a method, a field initializer, or a static block.",
				);
				return;
			}

			/*
			 * The other half of `super`. A call is far more restricted than a
			 * property access: every method of a derived class may read
			 * `super.x`, and only its constructor may call `super()`.
			 */
			case N_CallExpression:
				this.checkSuperOperand(
					this.reader.field(node, NODE_A),
					this.superCallAllowed,
					"'super' may only be called inside the constructor of a derived class.",
				);
				return;

			/*
			 * Anything that reaches here is a `super` the walk arrived at
			 * without passing through a call or a member access above it, and
			 * `super` is not an expression on its own.
			 */
			case N_Super:
				if (node !== this.sanctionedSuper) {
					this.report(
						"'super' must be followed by an argument list or a property access.",
						this.reader.start(node),
					);
				}

				return;

			case N_BinaryExpression: {
				const left = this.reader.field(node, NODE_A);

				if (
					this.reader.field(node, NODE_C) === T_in &&
					left !== 0 &&
					this.reader.kind(left) === N_PrivateIdentifier
				) {
					this.permitPrivateName(left);
					this.checkPrivateReference(left);
				}

				return;
			}

			/*
			 * Two things `delete` may not be given. A private field cannot be
			 * removed however the reference is written; and strict mode
			 * refuses a bare name, because deleting one would reach into the
			 * scope chain, which is exactly the reasoning an engine relies on
			 * to resolve names ahead of time. Parentheses do not help — they
			 * are transparent to `UnaryExpression : delete UnaryExpression`.
			 */
			case N_UnaryExpression: {
				const argument = this.reader.field(node, NODE_A);

				if (
					this.reader.field(node, NODE_B) !== T_delete ||
					argument === 0
				) {
					return;
				}

				if (this.isPrivateReference(argument)) {
					this.report(
						"Private fields cannot be deleted.",
						this.reader.start(node),
					);

					return;
				}

				if (
					this.strict &&
					this.reader.kind(argument) === N_Identifier
				) {
					this.report(
						"Deleting a local variable is not allowed in strict mode.",
						this.reader.start(node),
					);
				}

				return;
			}

			case N_AssignmentExpression: {
				const operator = this.reader.field(node, NODE_C);

				this.checkAssignmentTarget(
					this.reader.field(node, NODE_A),
					operator === T_ASSIGN,
					operator < T_ASSIGN_AMPAMP,
				);
				return;
			}

			case N_UpdateExpression:
				this.checkAssignmentTarget(
					this.reader.field(node, NODE_A),
					false,
				);
				return;

			/*
			 * A `for` head either declares its binding, in which case the
			 * declaration is what is checked, or assigns to an existing
			 * target. `for-in` takes a pattern too — `for ([a, b] in c)` is
			 * legal, if odd.
			 */
			case N_ForInStatement:
			case N_ForOfStatement: {
				const left = this.reader.field(node, NODE_A);

				if (
					left !== 0 &&
					this.reader.kind(left) !== N_VariableDeclaration
				) {
					this.checkAssignmentTarget(left, true);
				}

				this.checkForHead(node, kind === N_ForOfStatement);
				this.checkStatementBody(this.reader.field(node, NODE_C), false);
				return;
			}

			/*
			 * Two rules about a literal, and they cannot both be about the
			 * same one. `01` and `"\1"` are Annex B's, legal in sloppy code
			 * and not in strict, and the walk is what settles which this is —
			 * a function's own `"use strict"` may come after the literal,
			 * which is why the tokenizer only records what it saw.
			 *
			 * The other is the pattern between the slashes: `parse()` found
			 * where the literal ends, which is all the lexical grammar
			 * covers, and whether the text in between is a pattern at all is
			 * an early error on the literal.
			 */
			case N_Literal: {
				/*
				 * TypeScript has no sloppy code to carve out for, so it
				 * refuses the legacy spelling wherever it appears. The
				 * carve-out is JavaScript's alone and stays exactly as it
				 * was under `dialect: "js"`, where test262 depends on it.
				 */
				if (
					(this.strict || this.dialect === "ts") &&
					(this.reader.flags(node) & NF_LEGACY_OCTAL) !== 0
				) {
					this.report(
						this.strict
							? "Octal literals are not allowed in strict mode."
							: "Octal literals are not allowed in TypeScript.",
						this.reader.start(node),
					);

					return;
				}

				if (this.reader.field(node, NODE_A) !== LIT_REGEXP) {
					return;
				}

				this.regexp ??= new RegExpValidator();

				const problem = this.regexp.validate(
					this.reader.source,
					this.reader.start(node),
					this.reader.field(node, NODE_B),
					this.reader.end(node),
				);

				if (problem !== null) {
					this.report(problem.message, problem.start);
				}

				return;
			}

			case N_Identifier:
				this.checkIdentifierWord(node);
				return;

			/*
			 * A default value is evaluated as the call sets up the function's
			 * own scope, before there is anything to suspend, so neither form
			 * of suspension may appear in one.
			 */
			case N_YieldExpression:
			case N_AwaitExpression: {
				const where = this.inParameters
					? "a parameter list"
					: this.inStaticBlock
						? "a class static block"
						: null;

				if (where !== null) {
					this.report(
						kind === N_YieldExpression
							? `A yield expression may not appear in ${where}.`
							: `An await expression may not appear in ${where}.`,
						this.reader.start(node),
					);
				}

				return;
			}

			/*
			 * Shorthand reuses one node for both halves, and that node was
			 * read as a property name — but in `({ await })` it is also the
			 * reference, so it is checked here where the shorthand is known.
			 * `import { await }` and `export { await }` have the same shape.
			 */
			case N_Property:
				if ((this.reader.flags(node) & NF_SHORTHAND) !== 0) {
					this.checkShorthandName(node);
				}

				this.checkObjectMethodBody(node);

				return;

			case N_ObjectExpression:
				this.checkObjectLiteral(node);
				return;

			/*
			 * `OptionalChain TemplateLiteral` is a production the grammar
			 * writes down only to call it an error. A tag receives the raw
			 * text whether or not it is a function, so there is nothing for
			 * `a?.fn` to short-circuit *to* when `a` is nullish — the
			 * template would have to be evaluated regardless.
			 *
			 * The tree tells the two apart on its own: an unparenthesized
			 * chain ending in a tag is `ChainExpression(TaggedTemplate…)`,
			 * while `(a?.fn)` ends the chain and comes back the other way
			 * round.
			 */
			case N_ChainExpression: {
				const reader = this.reader;
				let current = reader.field(node, NODE_A);
				let tag = 0;

				/*
				 * The tag, the object, and the callee are all the first slot,
				 * so one loop walks the whole spine of the chain, outermost
				 * link first. A parenthesized link would have ended the chain
				 * and begun one of its own, so it is where the walk stops.
				 *
				 * A tag is only a problem when an optional link turns up
				 * *below* it, since that is what makes the thing being tagged
				 * an `OptionalChain`. `` f`x`?.a `` has the two the other way
				 * round and is fine.
				 */
				while (
					current !== 0 &&
					(reader.flags(current) & NF_PARENTHESIZED) === 0
				) {
					const linkKind = reader.kind(current);

					if (
						tag !== 0 &&
						(reader.flags(current) & NF_OPTIONAL) !== 0
					) {
						this.report(
							"A template literal may not be tagged with an optional chain.",
							reader.start(tag),
						);

						return;
					}

					if (linkKind === N_TaggedTemplateExpression) {
						tag = current;
					} else if (
						linkKind !== N_MemberExpression &&
						linkKind !== N_CallExpression
					) {
						return;
					}

					current = reader.field(current, NODE_A);
				}

				return;
			}

			/*
			 * `new.target` and `import.meta` are each spelled out in the
			 * grammar as two literal words rather than derived from an
			 * identifier, so an escape in the second half spells nothing at
			 * all. Where each may stand is the other question: `new.target`
			 * names the constructor a call was made through, and
			 * `import.meta` is the module record, which a script has none of.
			 */
			case N_MetaProperty: {
				const reader = this.reader;
				const property = reader.field(node, NODE_B);
				const isImport =
					reader.text(reader.field(node, NODE_A)) === "import";

				if (reader.text(property).indexOf("\\") !== -1) {
					this.report(
						`'${isImport ? "import.meta" : "new.target"}' may not be written with an escape.`,
						reader.start(property),
					);

					return;
				}

				if (isImport) {
					/*
					 * `import` has exactly one meta-property. Anything else
					 * after the dot is a property of a keyword that has
					 * none, with nowhere to resolve.
					 */
					if (reader.text(property) !== "meta") {
						this.report(
							"'import' has no meta-property but 'import.meta'.",
							reader.start(node),
						);

						return;
					}

					if (this.sourceType !== "module") {
						this.report(
							`'import.meta' may only appear when sourceType is "module".`,
							reader.start(node),
						);
					}

					return;
				}

				if (!this.newTargetAllowed) {
					this.report(
						"'new.target' may only appear inside a function, a class field initializer, or a class static block.",
						reader.start(node),
					);
				}

				return;
			}

			case N_ImportSpecifier:
			case N_ExportSpecifier:
				this.checkSharedName(node);
				return;

			case N_JSXElement:
				this.checkJsxNotAllowed(node);
				this.checkJsxTagsMatch(node);
				return;

			case N_JSXFragment:
				this.checkJsxNotAllowed(node);
				return;

			case N_ReturnStatement:
				if (this.functionDepth === 0) {
					this.report(
						"'return' outside of function.",
						this.reader.start(node),
					);
				}

				return;

			/*
			 * Top-level `await` is not checked here. Whether `await` is an
			 * operator at all is settled in `parse()`, which is told the
			 * source type: in a script it is an ordinary name, so no
			 * `AwaitExpression` can reach the top level of one to be
			 * complained about.
			 */

			case N_Program:
			case N_VariableDeclarator:
			case N_VariableDeclaration:
			default:
				return;
		}
	}
}

/** Re-exported for callers that want the node constant. */
export { N_Program };
