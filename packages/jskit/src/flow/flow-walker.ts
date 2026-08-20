/**
 * @fileoverview The walk that turns a binary AST and a scope buffer into a
 * control flow graph.
 *
 * One pass over every value-position node, in evaluation order. Statements
 * and expressions accumulate into the current basic block until control can
 * fork or land, which is where blocks end and edges carry the condition that
 * decided the direction. Nested functions are not walked inline: meeting one
 * queues a task, and each queued graph is built after the enclosing graph
 * finishes, which is what keeps a graph's blocks contiguous in the block
 * section.
 *
 * Variable writes are not rediscovered here. The scope buffer already
 * records a reference for every identifier that writes, keyed by the
 * identifier's node handle, so the walk carries a map from those handles to
 * their reference IDs and every visited identifier does one lookup. A hit
 * means this very node is a write target — a read of the same variable is a
 * different node — so destructuring, compound assignment, and loop heads all
 * fall out of the ordinary descent. Only member-expression targets, which
 * bind no variable and so have no reference, are recorded by hand.
 *
 * Three places trade precision for simplicity, deliberately:
 *
 * - **`finally` is one block**, however control entered it. Abrupt
 *   completions route through it with `abrupt` edges and continue from its
 *   end, rather than duplicating the finalizer per completion kind.
 * - **Exception edges are per-region.** Every block in a `try` region gets
 *   an `exception` edge to the handler, rather than modeling which
 *   operations can actually throw.
 * - **Default values in patterns and parameters are walked as if always
 *   evaluated**, without the fork on `undefined`.
 */

import {
	AstReader,
	LIT_BOOLEAN,
	LIT_NULL,
	NF_COMPUTED,
	NF_OPTIONAL,
	NF_SHORTHAND,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_G,
	N_ArrayPattern,
	N_ArrowFunctionExpression,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_AwaitExpression,
	N_BreakStatement,
	N_CallExpression,
	N_ChainExpression,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ConditionalExpression,
	N_ContinueStatement,
	N_DoWhileStatement,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_Identifier,
	N_IfStatement,
	N_LabeledStatement,
	N_Literal,
	N_LogicalExpression,
	N_MemberExpression,
	N_MethodDefinition,
	N_ObjectPattern,
	N_Property,
	N_PropertyDefinition,
	N_AccessorProperty,
	N_RestElement,
	N_ReturnStatement,
	N_SequenceExpression,
	N_StaticBlock,
	N_SwitchStatement,
	N_ThrowStatement,
	N_TryStatement,
	N_UnaryExpression,
	N_UpdateExpression,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_WhileStatement,
	N_YieldExpression,
	N_TSAbstractMethodDefinition,
	N_TSAsExpression,
	N_TSEnumBody,
	N_TSEnumDeclaration,
	N_TSEnumMember,
	N_TSExportAssignment,
	N_TSInstantiationExpression,
	N_TSModuleBlock,
	N_TSModuleDeclaration,
	N_TSNonNullExpression,
	N_TSParameterProperty,
	N_TSSatisfiesExpression,
	N_TSTypeAssertion,
	SLOT_COUNT,
	SLOT_LIST,
	SLOT_NODE,
	SLOT_TABLE,
	TS_FIRST,
	T_ASSIGN,
	T_ASSIGN_AMPAMP,
	T_ASSIGN_PIPEPIPE,
	T_ASSIGN_QQ,
	T_AMPAMP,
	T_PIPEPIPE,
	T_NOT,
} from "../parse/index.js";
import {
	SCOPE_H_REFERENCES_BASE,
	REFERENCE_WORDS,
	RF_INIT,
	RF_WRITE,
	R_FLAGS,
	R_IDENTIFIER,
	R_WRITE_EXPR,
	ScopeBufferReader,
} from "../scope/index.js";
import {
	BF_RETURNS,
	BF_THROWS,
	EF_BACK,
	EK_ABRUPT,
	EK_DONE,
	EK_EXCEPTION,
	EK_FALSE,
	EK_ITERATE,
	EK_NORMAL,
	EK_NOT_NULLISH,
	EK_NULLISH,
	EK_RESUME,
	EK_TRUE,
	ORIGIN_CLASS_FIELD_INITIALIZER,
	ORIGIN_CLASS_STATIC_BLOCK,
	ORIGIN_FUNCTION,
	ORIGIN_PROGRAM,
	WF_COMPOUND,
	WF_INIT,
	WF_MEMBER,
	WF_UPDATE,
} from "./flow-buffer.js";
import { FlowBuilder } from "./flow-builder.js";
import { nodeHandle } from "./handles.js";

//-----------------------------------------------------------------------------
// Contexts
//-----------------------------------------------------------------------------

const CTX_LOOP = 0;
const CTX_BREAKABLE = 1;
const CTX_LABEL = 2;
const CTX_TRY = 3;

const PHASE_TRY = 0;
const PHASE_CATCH = 1;
const PHASE_FINALLY = 2;

/** A jump that must run a `finally` before reaching its target. */
interface PendingJump {
	/** The block the jump ultimately lands on. */
	target: number;

	/** The context-stack index of the construct that owns the target. */
	contextIndex: number;

	/** Extra edge flags for the final hop, `EF_BACK` for a `continue`. */
	flags: number;
}

/**
 * One enclosing construct a jump or throw can interact with. Every entry
 * carries every field so the shape stays monomorphic.
 */
interface FlowContext {
	kind: number;
	breakTarget: number;
	continueTarget: number;

	/** The loop head; an edge into it from inside the loop is a back edge. */
	backTarget: number;

	/** Label identifier node indices naming this construct, or `null`. */
	labels: number[] | null;
	phase: number;
	hasFinally: boolean;
	finallyEntry: number;
	pendingJumps: PendingJump[] | null;
	pendingReturn: boolean;
}

/** A nested graph discovered by the walk, built after the current one. */
interface GraphTask {
	/** The node the graph runs: a function, a field value, a static block. */
	node: number;
	origin: number;

	/** The graph ID of the enclosing graph. */
	upper: number;
}

/**
 * Creates a context entry with every field present.
 * @param kind The context kind.
 * @returns The entry, with no targets set.
 */
function newContext(kind: number): FlowContext {
	return {
		kind,
		breakTarget: -1,
		continueTarget: -1,
		backTarget: -1,
		labels: null,
		phase: PHASE_TRY,
		hasFinally: false,
		finallyEntry: -1,
		pendingJumps: null,
		pendingReturn: false,
	};
}

//-----------------------------------------------------------------------------
// The walk
//-----------------------------------------------------------------------------

/**
 * Builds every graph in a program, one walk per execution unit.
 */
export class FlowWalker {
	/** The reader over the parse buffer. */
	readonly #reader: AstReader;

	/** The reader over the scope buffer. */
	readonly #scope: ScopeBufferReader;

	/** The graph being recorded. */
	readonly #builder: FlowBuilder;

	/** Identifier node handle to the ID of its writing reference. */
	readonly #writeRefs = new Map<number, number>();

	/** Word index of the scope buffer's reference records. */
	readonly #referencesBase: number;

	/** Nested graphs discovered but not yet built. */
	readonly #tasks: GraphTask[] = [];

	/** The enclosing constructs of the position being walked. */
	readonly #contexts: FlowContext[] = [];

	/** Labels waiting to attach to the loop or switch they precede. */
	readonly #pendingLabels: number[] = [];

	/** The block statements and expressions currently accumulate into. */
	#current = 0;

	/** The graph currently being built. */
	#graph = 0;

	/** Blocks that exit the current graph normally. */
	#returned: number[] = [];

	/** Blocks that exit the current graph on an uncaught throw. */
	#thrown: number[] = [];

	/** Write flags to add to the next identifier write, then cleared. */
	#writeFlags = 0;

	/**
	 * Creates a walker over one program.
	 * @param reader The reader over the parse buffer.
	 * @param scope The reader over the scope buffer.
	 * @param builder The builder that records the graph.
	 */
	constructor(
		reader: AstReader,
		scope: ScopeBufferReader,
		builder: FlowBuilder,
	) {
		this.#reader = reader;
		this.#scope = scope;
		this.#builder = builder;
		this.#referencesBase = scope.words[SCOPE_H_REFERENCES_BASE];

		/*
		 * Every write the program performs on a variable already exists as a
		 * reference record keyed by the written identifier's handle. One pass
		 * here turns "is this identifier a write target" into a map lookup
		 * during the walk.
		 */
		for (let ref = 0; ref < scope.referenceCount; ref++) {
			if ((scope.referenceField(ref, R_FLAGS) & RF_WRITE) !== 0) {
				this.#writeRefs.set(
					scope.referenceField(ref, R_IDENTIFIER),
					ref,
				);
			}
		}
	}

	/**
	 * Builds the program graph and every nested graph it queues.
	 * @returns Nothing.
	 */
	build(): void {
		this.#tasks.push({
			node: this.#reader.root,
			origin: ORIGIN_PROGRAM,
			upper: -1,
		});

		while (this.#tasks.length > 0) {
			this.#buildGraph(this.#tasks.shift()!);
		}
	}

	/**
	 * Builds one graph from entry to exit.
	 * @param task What to build and where it hangs.
	 * @returns Nothing.
	 */
	#buildGraph(task: GraphTask): void {
		const reader = this.#reader;
		const node = task.node;

		this.#graph = this.#builder.beginGraph(
			task.origin,
			nodeHandle(reader, node),
			task.upper,
		);
		this.#returned = [];
		this.#thrown = [];

		const entry = this.#builder.newBlock();

		this.#builder.seedReachable(entry);
		this.#current = entry;
		this.#record(node);

		if (task.origin === ORIGIN_FUNCTION) {
			// Parameters run first: patterns bind, defaults evaluate.
			const params = reader.field(node, NODE_B);
			const paramCount = reader.listSize(params);

			for (let i = 0; i < paramCount; i++) {
				this.#maybeVisit(reader.listItem(params, i));
			}

			const body = reader.field(node, NODE_C);

			if (body !== 0) {
				this.#maybeVisit(body);
			}
		} else if (task.origin === ORIGIN_CLASS_FIELD_INITIALIZER) {
			// The graph's node is the field's value expression.
			this.#maybeVisit(node);
		} else {
			// A Program or a static block: a statement list either way.
			this.#visitList(reader.field(node, NODE_A));
		}

		const implicit = this.#current;

		if (this.#builder.isReachable(implicit)) {
			this.#returned.push(implicit);
		}

		this.#builder.endGraph(entry, implicit, this.#returned, this.#thrown);
	}

	//-------------------------------------------------------------------------
	// Small helpers
	//-------------------------------------------------------------------------

	/**
	 * Records which block a node executes in.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#record(node: number): void {
		this.#builder.addNode(nodeHandle(this.#reader, node), this.#current);
	}

	/**
	 * The handle of a node.
	 * @param node The node index.
	 * @returns The byte offset of its record.
	 */
	#handle(node: number): number {
		return nodeHandle(this.#reader, node);
	}

	/**
	 * Ends the current block after a jump or exit; whatever follows is
	 * unreachable until an edge says otherwise.
	 * @returns Nothing.
	 */
	#terminate(): void {
		this.#current = this.#builder.newBlock();
	}

	/**
	 * Visits every node in a list.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	#visitList(handle: number): void {
		const count = this.#reader.listSize(handle);

		for (let i = 0; i < count; i++) {
			const item = this.#reader.listItem(handle, i);

			if (item !== 0) {
				this.#maybeVisit(item);
			}
		}
	}

	/**
	 * Visits a node, routing TypeScript kinds to the type-aware dispatcher.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#maybeVisit(node: number): void {
		const kind = this.#reader.kind(node);

		if (kind >= TS_FIRST) {
			this.#visitTs(node, kind);
		} else {
			this.#visit(node, kind);
		}
	}

	/**
	 * Whether an identifier node spells the same name as another.
	 * @param a One identifier node index.
	 * @param b Another identifier node index.
	 * @returns `true` when the names match.
	 */
	#sameName(a: number, b: number): boolean {
		const reader = this.#reader;
		const aStart = reader.start(a);
		const aEnd = reader.field(a, NODE_A);
		const bStart = reader.start(b);
		const bEnd = reader.field(b, NODE_A);

		if (aEnd - aStart !== bEnd - bStart) {
			return false;
		}

		const source = reader.source;

		for (let i = 0; i < aEnd - aStart; i++) {
			if (
				source.charCodeAt(aStart + i) !== source.charCodeAt(bStart + i)
			) {
				return false;
			}
		}

		return true;
	}

	//-------------------------------------------------------------------------
	// Jump routing
	//-------------------------------------------------------------------------

	/**
	 * Routes a jump to its target, detouring through every `finally` that
	 * must run first.
	 * @param target The block the jump lands on.
	 * @param contextIndex The stack index of the construct being jumped to.
	 * @param flags Extra edge flags for the final hop.
	 * @returns Nothing.
	 */
	#routeJump(target: number, contextIndex: number, flags: number): void {
		const contexts = this.#contexts;

		for (let i = contexts.length - 1; i > contextIndex; i--) {
			const ctx = contexts[i];

			if (
				ctx.kind === CTX_TRY &&
				ctx.hasFinally &&
				ctx.phase !== PHASE_FINALLY
			) {
				this.#builder.addEdge(
					this.#current,
					ctx.finallyEntry,
					EK_ABRUPT,
					0,
				);

				const pending = (ctx.pendingJumps ??= []);

				for (let j = 0; j < pending.length; j++) {
					if (pending[j].target === target) {
						return;
					}
				}

				pending.push({ target, contextIndex, flags });

				return;
			}
		}

		this.#builder.addEdge(this.#current, target, EK_NORMAL | flags, 0);
	}

	/**
	 * Routes a `return`, detouring through every `finally` that must run
	 * first, and records the exiting block on the graph.
	 * @returns Nothing.
	 */
	#routeReturn(): void {
		const contexts = this.#contexts;

		for (let i = contexts.length - 1; i >= 0; i--) {
			const ctx = contexts[i];

			if (
				ctx.kind === CTX_TRY &&
				ctx.hasFinally &&
				ctx.phase !== PHASE_FINALLY
			) {
				this.#builder.addEdge(
					this.#current,
					ctx.finallyEntry,
					EK_ABRUPT,
					0,
				);
				ctx.pendingReturn = true;

				return;
			}
		}

		this.#returned.push(this.#current);
	}

	/**
	 * Whether an exception raised at the current position is routed by an
	 * enclosing `try` in this graph.
	 * @returns `true` when a handler or finalizer will receive it.
	 */
	#isProtected(): boolean {
		const contexts = this.#contexts;

		for (let i = contexts.length - 1; i >= 0; i--) {
			const ctx = contexts[i];

			if (ctx.kind !== CTX_TRY) {
				continue;
			}

			if (ctx.phase === PHASE_TRY) {
				return true;
			}

			if (ctx.phase === PHASE_CATCH && ctx.hasFinally) {
				return true;
			}

			// A throw inside catch or finally keeps propagating outward.
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Writes
	//-------------------------------------------------------------------------

	/**
	 * Records the write an identifier performs, when it performs one.
	 * @param handle The identifier's handle.
	 * @returns Nothing.
	 */
	#maybeWrite(handle: number): void {
		const ref = this.#writeRefs.get(handle);

		if (ref === undefined) {
			return;
		}

		const scope = this.#scope;
		const flags =
			(scope.referenceField(ref, R_FLAGS) & RF_INIT) !== 0
				? WF_INIT | this.#writeFlags
				: this.#writeFlags;

		this.#builder.addWrite(
			this.#current,
			(this.#referencesBase + ref * REFERENCE_WORDS) * 4,
			handle,
			scope.referenceField(ref, R_WRITE_EXPR),
			flags,
		);
	}

	/**
	 * Walks an assignment target, recording writes for member expressions,
	 * which have no scope reference to speak for them. Identifier targets go
	 * through the ordinary visit, where the reference map records them.
	 * @param node The target node index.
	 * @param expr The handle of the value written, for member targets.
	 * @param flags Write flags for member targets.
	 * @returns Nothing.
	 */
	#visitTarget(node: number, expr: number, flags: number): void {
		const reader = this.#reader;
		let kind = reader.kind(node);

		// Unwrap `(a as T).b = c`, `a!.b = c`, and `(<T>a).b = c`.
		while (true) {
			if (
				kind === N_TSAsExpression ||
				kind === N_TSSatisfiesExpression ||
				kind === N_TSNonNullExpression
			) {
				this.#record(node);
				node = reader.field(node, NODE_A);
			} else if (kind === N_TSTypeAssertion) {
				this.#record(node);
				node = reader.field(node, NODE_B);
			} else {
				break;
			}

			kind = reader.kind(node);
		}

		switch (kind) {
			case N_MemberExpression: {
				this.#record(node);
				this.#maybeVisit(reader.field(node, NODE_A));

				if ((reader.flags(node) & NF_COMPUTED) !== 0) {
					this.#maybeVisit(reader.field(node, NODE_B));
				}

				this.#builder.addWrite(
					this.#current,
					0,
					this.#handle(node),
					expr,
					WF_MEMBER | flags,
				);
				break;
			}

			case N_ArrayPattern: {
				this.#record(node);

				const elements = reader.field(node, NODE_A);
				const count = reader.listSize(elements);

				for (let i = 0; i < count; i++) {
					const element = reader.listItem(elements, i);

					if (element !== 0) {
						this.#visitTarget(element, expr, flags);
					}
				}

				break;
			}

			case N_ObjectPattern: {
				this.#record(node);

				const properties = reader.field(node, NODE_A);
				const count = reader.listSize(properties);

				for (let i = 0; i < count; i++) {
					const property = reader.listItem(properties, i);

					if (reader.kind(property) === N_Property) {
						this.#record(property);

						if ((reader.flags(property) & NF_COMPUTED) !== 0) {
							this.#maybeVisit(reader.field(property, NODE_A));
						}

						this.#visitTarget(
							reader.field(property, NODE_B),
							expr,
							flags,
						);
					} else {
						// A rest element.
						this.#visitTarget(property, expr, flags);
					}
				}

				break;
			}

			case N_AssignmentPattern: {
				this.#record(node);
				this.#maybeVisit(reader.field(node, NODE_B));
				this.#visitTarget(reader.field(node, NODE_A), expr, flags);
				break;
			}

			case N_RestElement: {
				this.#record(node);
				this.#visitTarget(reader.field(node, NODE_A), expr, flags);
				break;
			}

			default: {
				this.#maybeVisit(node);
			}
		}
	}

	//-------------------------------------------------------------------------
	// Conditions
	//-------------------------------------------------------------------------

	/**
	 * Whether a node is a literal with a fixed truthiness.
	 * @param node The node index.
	 * @returns `1` for constant-true, `0` for constant-false, `-1` neither.
	 */
	#foldedTruth(node: number): number {
		const reader = this.#reader;

		if (reader.kind(node) !== N_Literal) {
			return -1;
		}

		// A literal's subtype lives in slot A.
		const subtype = reader.field(node, NODE_A);

		if (subtype === LIT_BOOLEAN) {
			// `true` is four characters long; `false` is five.
			return reader.end(node) - reader.start(node) === 4 ? 1 : 0;
		}

		if (subtype === LIT_NULL) {
			return 0;
		}

		return -1;
	}

	/**
	 * Compiles an expression as a branch condition, distributing `&&`, `||`,
	 * `!`, and nested conditionals so that every edge carries the innermost
	 * condition it actually tests.
	 * @param node The condition expression.
	 * @param trueTarget The block control reaches when it is truthy.
	 * @param falseTarget The block control reaches when it is falsy.
	 * @param trueFlags Extra edge flags for edges into the true target.
	 * @param falseFlags Extra edge flags for edges into the false target.
	 * @returns Nothing.
	 */
	#visitCondition(
		node: number,
		trueTarget: number,
		falseTarget: number,
		trueFlags: number,
		falseFlags: number,
	): void {
		const reader = this.#reader;
		const kind = reader.kind(node);

		if (kind === N_LogicalExpression) {
			const operator = reader.field(node, NODE_C);

			if (operator === T_AMPAMP) {
				this.#record(node);

				const mid = this.#builder.newBlock();

				this.#visitCondition(
					reader.field(node, NODE_A),
					mid,
					falseTarget,
					0,
					falseFlags,
				);
				this.#current = mid;
				this.#visitCondition(
					reader.field(node, NODE_B),
					trueTarget,
					falseTarget,
					trueFlags,
					falseFlags,
				);

				return;
			}

			if (operator === T_PIPEPIPE) {
				this.#record(node);

				const mid = this.#builder.newBlock();

				this.#visitCondition(
					reader.field(node, NODE_A),
					trueTarget,
					mid,
					trueFlags,
					0,
				);
				this.#current = mid;
				this.#visitCondition(
					reader.field(node, NODE_B),
					trueTarget,
					falseTarget,
					trueFlags,
					falseFlags,
				);

				return;
			}

			// `??` keeps its value semantics; fall through to the default.
		} else if (kind === N_UnaryExpression) {
			if (reader.field(node, NODE_B) === T_NOT) {
				this.#record(node);
				this.#visitCondition(
					reader.field(node, NODE_A),
					falseTarget,
					trueTarget,
					falseFlags,
					trueFlags,
				);

				return;
			}
		} else if (kind === N_ConditionalExpression) {
			this.#record(node);

			const thenBlock = this.#builder.newBlock();
			const elseBlock = this.#builder.newBlock();

			this.#visitCondition(
				reader.field(node, NODE_A),
				thenBlock,
				elseBlock,
				0,
				0,
			);
			this.#current = thenBlock;
			this.#visitCondition(
				reader.field(node, NODE_B),
				trueTarget,
				falseTarget,
				trueFlags,
				falseFlags,
			);
			this.#current = elseBlock;
			this.#visitCondition(
				reader.field(node, NODE_C),
				trueTarget,
				falseTarget,
				trueFlags,
				falseFlags,
			);

			return;
		} else if (kind === N_SequenceExpression) {
			this.#record(node);

			const expressions = reader.field(node, NODE_A);
			const count = reader.listSize(expressions);

			for (let i = 0; i < count - 1; i++) {
				this.#maybeVisit(reader.listItem(expressions, i));
			}

			this.#visitCondition(
				reader.listItem(expressions, count - 1),
				trueTarget,
				falseTarget,
				trueFlags,
				falseFlags,
			);

			return;
		}

		const truth = this.#foldedTruth(node);

		if (truth >= 0) {
			// A constant condition takes exactly one direction.
			this.#record(node);
			this.#builder.addEdge(
				this.#current,
				truth === 1 ? trueTarget : falseTarget,
				truth === 1 ? EK_TRUE | trueFlags : EK_FALSE | falseFlags,
				this.#handle(node),
			);

			return;
		}

		this.#maybeVisit(node);

		const handle = this.#handle(node);

		this.#builder.addEdge(
			this.#current,
			trueTarget,
			EK_TRUE | trueFlags,
			handle,
		);
		this.#builder.addEdge(
			this.#current,
			falseTarget,
			EK_FALSE | falseFlags,
			handle,
		);
	}

	//-------------------------------------------------------------------------
	// Dispatch
	//-------------------------------------------------------------------------

	/**
	 * Visits one JavaScript-kind node in the current block.
	 * @param node The node index.
	 * @param kind The node's kind, already read.
	 * @returns Nothing.
	 */
	#visit(node: number, kind: number): void {
		const reader = this.#reader;

		this.#record(node);

		switch (kind) {
			case N_Identifier: {
				this.#maybeWrite(this.#handle(node));
				break;
			}

			case N_Property: {
				/*
				 * A shorthand property's key and value are the same
				 * identifier; walking both slots would visit it twice and
				 * record its write twice.
				 */
				if ((reader.flags(node) & NF_SHORTHAND) === 0) {
					this.#maybeVisit(reader.field(node, NODE_A));
				}

				this.#maybeVisit(reader.field(node, NODE_B));
				break;
			}

			case N_IfStatement: {
				this.#visitIf(node);
				break;
			}

			case N_LogicalExpression: {
				this.#visitLogical(node);
				break;
			}

			case N_ConditionalExpression: {
				const thenBlock = this.#builder.newBlock();
				const elseBlock = this.#builder.newBlock();
				const join = this.#builder.newBlock();

				this.#visitCondition(
					reader.field(node, NODE_A),
					thenBlock,
					elseBlock,
					0,
					0,
				);
				this.#current = thenBlock;
				this.#maybeVisit(reader.field(node, NODE_B));
				this.#builder.addEdge(this.#current, join, EK_NORMAL, 0);
				this.#current = elseBlock;
				this.#maybeVisit(reader.field(node, NODE_C));
				this.#builder.addEdge(this.#current, join, EK_NORMAL, 0);
				this.#current = join;
				break;
			}

			case N_AssignmentExpression: {
				this.#visitAssignment(node);
				break;
			}

			case N_UpdateExpression: {
				this.#visitUpdate(node);
				break;
			}

			case N_VariableDeclarator: {
				const init = reader.field(node, NODE_B);

				if (init !== 0) {
					this.#maybeVisit(init);
				}

				// The id comes second: the value exists before the binding.
				this.#maybeVisit(reader.field(node, NODE_A));
				break;
			}

			case N_WhileStatement: {
				this.#visitWhile(node);
				break;
			}

			case N_DoWhileStatement: {
				this.#visitDoWhile(node);
				break;
			}

			case N_ForStatement: {
				this.#visitFor(node);
				break;
			}

			case N_ForInStatement:
			case N_ForOfStatement: {
				this.#visitForEach(node);
				break;
			}

			case N_SwitchStatement: {
				this.#visitSwitch(node);
				break;
			}

			case N_TryStatement: {
				this.#visitTry(node);
				break;
			}

			case N_LabeledStatement: {
				this.#visitLabeled(node);
				break;
			}

			case N_BreakStatement: {
				this.#visitBreak(node);
				break;
			}

			case N_ContinueStatement: {
				this.#visitContinue(node);
				break;
			}

			case N_ReturnStatement: {
				const argument = reader.field(node, NODE_A);

				if (argument !== 0) {
					this.#maybeVisit(argument);
				}

				this.#builder.addBlockFlags(this.#current, BF_RETURNS);
				this.#routeReturn();
				this.#terminate();
				break;
			}

			case N_ThrowStatement: {
				this.#maybeVisit(reader.field(node, NODE_A));
				this.#builder.addBlockFlags(this.#current, BF_THROWS);

				if (!this.#isProtected()) {
					this.#thrown.push(this.#current);
				}

				this.#terminate();
				break;
			}

			case N_AwaitExpression:
			case N_YieldExpression: {
				const argument = reader.field(node, NODE_A);

				if (argument !== 0) {
					this.#maybeVisit(argument);
				}

				const resumed = this.#builder.newBlock();

				this.#builder.addEdge(
					this.#current,
					resumed,
					EK_RESUME,
					this.#handle(node),
				);
				this.#current = resumed;
				break;
			}

			case N_ChainExpression: {
				const join = this.#builder.newBlock();

				this.#visitChainStep(reader.field(node, NODE_A), join);
				this.#builder.addEdge(this.#current, join, EK_NORMAL, 0);
				this.#current = join;
				break;
			}

			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_ArrowFunctionExpression: {
				this.#tasks.push({
					node,
					origin: ORIGIN_FUNCTION,
					upper: this.#graph,
				});
				break;
			}

			case N_ClassDeclaration:
			case N_ClassExpression: {
				this.#visitClass(node);
				break;
			}

			default: {
				this.#visitChildren(node, kind);
			}
		}
	}

	/**
	 * Visits a node's children generically, in slot order.
	 * @param node The node index.
	 * @param kind The node's kind.
	 * @returns Nothing.
	 */
	#visitChildren(node: number, kind: number): void {
		const reader = this.#reader;
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const type = SLOT_TABLE[base + slot];

			if (type === SLOT_NODE) {
				const child = reader.field(node, NODE_A + slot);

				if (child !== 0) {
					this.#maybeVisit(child);
				}
			} else if (type === SLOT_LIST) {
				this.#visitList(reader.field(node, NODE_A + slot));
			}
		}
	}

	/**
	 * Visits the TypeScript kinds that contain runtime code, and skips the
	 * rest — type positions have no control flow.
	 * @param node The node index.
	 * @param kind The node's kind.
	 * @returns Nothing.
	 */
	#visitTs(node: number, kind: number): void {
		const reader = this.#reader;

		switch (kind) {
			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
			case N_TSNonNullExpression:
			case N_TSInstantiationExpression:
			case N_TSExportAssignment: {
				this.#record(node);
				this.#maybeVisit(reader.field(node, NODE_A));
				break;
			}

			case N_TSTypeAssertion: {
				this.#record(node);
				this.#maybeVisit(reader.field(node, NODE_B));
				break;
			}

			case N_TSParameterProperty: {
				this.#record(node);
				this.#maybeVisit(reader.field(node, NODE_A));
				break;
			}

			case N_TSModuleDeclaration: {
				const body = reader.field(node, NODE_B);

				if (body !== 0) {
					this.#record(node);
					this.#visitTs(body, reader.kind(body));
				}

				break;
			}

			case N_TSModuleBlock: {
				this.#record(node);
				this.#visitList(reader.field(node, NODE_A));
				break;
			}

			case N_TSEnumDeclaration: {
				this.#record(node);
				this.#visitTs(
					reader.field(node, NODE_B),
					N_TSEnumBody,
				);
				break;
			}

			case N_TSEnumBody: {
				this.#record(node);
				this.#visitList(reader.field(node, NODE_A));
				break;
			}

			case N_TSEnumMember: {
				const initializer = reader.field(node, NODE_B);

				if (initializer !== 0) {
					this.#record(node);
					this.#maybeVisit(initializer);
				}

				break;
			}

			default: {
				// A type position: nothing here executes.
			}
		}
	}

	//-------------------------------------------------------------------------
	// Statements
	//-------------------------------------------------------------------------

	/**
	 * Visits an `if` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitIf(node: number): void {
		const reader = this.#reader;
		const alternate = reader.field(node, NODE_C);
		const thenBlock = this.#builder.newBlock();
		const elseBlock = alternate !== 0 ? this.#builder.newBlock() : -1;
		const after = this.#builder.newBlock();

		this.#visitCondition(
			reader.field(node, NODE_A),
			thenBlock,
			alternate !== 0 ? elseBlock : after,
			0,
			0,
		);
		this.#current = thenBlock;
		this.#maybeVisit(reader.field(node, NODE_B));
		this.#builder.addEdge(this.#current, after, EK_NORMAL, 0);

		if (alternate !== 0) {
			this.#current = elseBlock;
			this.#maybeVisit(alternate);
			this.#builder.addEdge(this.#current, after, EK_NORMAL, 0);
		}

		this.#current = after;
	}

	/**
	 * Visits a logical expression in value position.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitLogical(node: number): void {
		const reader = this.#reader;
		const operator = reader.field(node, NODE_C);
		const left = reader.field(node, NODE_A);
		const right = this.#builder.newBlock();
		const join = this.#builder.newBlock();

		if (operator === T_AMPAMP) {
			this.#visitCondition(left, right, join, 0, 0);
		} else if (operator === T_PIPEPIPE) {
			this.#visitCondition(left, join, right, 0, 0);
		} else {
			// `??` forks on nullishness, not truthiness.
			this.#maybeVisit(left);

			const handle = this.#handle(left);

			this.#builder.addEdge(this.#current, right, EK_NULLISH, handle);
			this.#builder.addEdge(
				this.#current,
				join,
				EK_NOT_NULLISH,
				handle,
			);
		}

		this.#current = right;
		this.#maybeVisit(reader.field(node, NODE_B));
		this.#builder.addEdge(this.#current, join, EK_NORMAL, 0);
		this.#current = join;
	}

	/**
	 * Visits an assignment expression, forking for the logical operators.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitAssignment(node: number): void {
		const reader = this.#reader;
		const operator = reader.field(node, NODE_C);
		const left = reader.field(node, NODE_A);
		const right = reader.field(node, NODE_B);

		if (
			operator === T_ASSIGN_AMPAMP ||
			operator === T_ASSIGN_PIPEPIPE ||
			operator === T_ASSIGN_QQ
		) {
			this.#visitLogicalAssignment(operator, left, right);

			return;
		}

		// The value exists before the target receives it.
		this.#maybeVisit(right);

		if (operator === T_ASSIGN) {
			this.#visitTarget(left, this.#handle(right), 0);
		} else {
			this.#writeFlags = WF_COMPOUND;
			this.#visitTarget(left, this.#handle(right), WF_COMPOUND);
			this.#writeFlags = 0;
		}
	}

	/**
	 * Visits `&&=`, `||=`, or `??=`, whose right side and write are
	 * conditional.
	 * @param operator The operator's token kind.
	 * @param left The target node index.
	 * @param right The value node index.
	 * @returns Nothing.
	 */
	#visitLogicalAssignment(
		operator: number,
		left: number,
		right: number,
	): void {
		const reader = this.#reader;
		const leftKind = reader.kind(left);
		const isMember = leftKind === N_MemberExpression;

		// Read the target without letting the reference map record a write.
		this.#record(left);

		if (isMember) {
			this.#maybeVisit(reader.field(left, NODE_A));

			if ((reader.flags(left) & NF_COMPUTED) !== 0) {
				this.#maybeVisit(reader.field(left, NODE_B));
			}
		}

		const leftHandle = this.#handle(left);
		const rightBlock = this.#builder.newBlock();
		const join = this.#builder.newBlock();

		if (operator === T_ASSIGN_AMPAMP) {
			this.#builder.addEdge(this.#current, rightBlock, EK_TRUE, leftHandle);
			this.#builder.addEdge(this.#current, join, EK_FALSE, leftHandle);
		} else if (operator === T_ASSIGN_PIPEPIPE) {
			this.#builder.addEdge(this.#current, rightBlock, EK_FALSE, leftHandle);
			this.#builder.addEdge(this.#current, join, EK_TRUE, leftHandle);
		} else {
			this.#builder.addEdge(
				this.#current,
				rightBlock,
				EK_NULLISH,
				leftHandle,
			);
			this.#builder.addEdge(
				this.#current,
				join,
				EK_NOT_NULLISH,
				leftHandle,
			);
		}

		this.#current = rightBlock;
		this.#maybeVisit(right);

		if (isMember) {
			this.#builder.addWrite(
				this.#current,
				0,
				leftHandle,
				this.#handle(right),
				WF_MEMBER | WF_COMPOUND,
			);
		} else {
			this.#writeFlags = WF_COMPOUND;
			this.#maybeWrite(leftHandle);
			this.#writeFlags = 0;
		}

		this.#builder.addEdge(this.#current, join, EK_NORMAL, 0);
		this.#current = join;
	}

	/**
	 * Visits an update expression.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitUpdate(node: number): void {
		const reader = this.#reader;
		const argument = reader.field(node, NODE_A);

		if (reader.kind(argument) === N_Identifier) {
			this.#writeFlags = WF_UPDATE;
			this.#maybeVisit(argument);
			this.#writeFlags = 0;
		} else {
			this.#visitTarget(argument, 0, WF_UPDATE);
		}
	}

	/**
	 * Visits a `while` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitWhile(node: number): void {
		const reader = this.#reader;
		const test = this.#builder.newBlock();

		this.#builder.addEdge(this.#current, test, EK_NORMAL, 0);

		const body = this.#builder.newBlock();
		const after = this.#builder.newBlock();

		this.#current = test;
		this.#visitCondition(reader.field(node, NODE_A), body, after, 0, 0);

		const ctx = newContext(CTX_LOOP);

		ctx.breakTarget = after;
		ctx.continueTarget = test;
		ctx.backTarget = test;
		ctx.labels = this.#takeLabels();
		this.#contexts.push(ctx);
		this.#current = body;
		this.#maybeVisit(reader.field(node, NODE_B));
		this.#builder.addEdge(this.#current, test, EK_NORMAL | EF_BACK, 0);
		this.#contexts.pop();
		this.#current = after;
	}

	/**
	 * Visits a `do...while` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitDoWhile(node: number): void {
		const reader = this.#reader;
		const body = this.#builder.newBlock();

		this.#builder.addEdge(this.#current, body, EK_NORMAL, 0);

		const test = this.#builder.newBlock();
		const after = this.#builder.newBlock();
		const ctx = newContext(CTX_LOOP);

		ctx.breakTarget = after;
		ctx.continueTarget = test;
		ctx.backTarget = body;
		ctx.labels = this.#takeLabels();
		this.#contexts.push(ctx);
		this.#current = body;
		this.#maybeVisit(reader.field(node, NODE_A));
		this.#builder.addEdge(this.#current, test, EK_NORMAL, 0);
		this.#current = test;
		this.#visitCondition(reader.field(node, NODE_B), body, after, EF_BACK, 0);
		this.#contexts.pop();
		this.#current = after;
	}

	/**
	 * Visits a `for` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitFor(node: number): void {
		const reader = this.#reader;
		const init = reader.field(node, NODE_A);
		const testExpr = reader.field(node, NODE_B);
		const updateExpr = reader.field(node, NODE_C);

		if (init !== 0) {
			this.#maybeVisit(init);
		}

		const test = this.#builder.newBlock();

		this.#builder.addEdge(this.#current, test, EK_NORMAL, 0);

		const body = this.#builder.newBlock();
		const update = updateExpr !== 0 ? this.#builder.newBlock() : -1;
		const after = this.#builder.newBlock();

		this.#current = test;

		if (testExpr !== 0) {
			this.#visitCondition(testExpr, body, after, 0, 0);
		} else {
			// `for (;;)` iterates unconditionally.
			this.#builder.addEdge(this.#current, body, EK_NORMAL, 0);
		}

		const ctx = newContext(CTX_LOOP);

		ctx.breakTarget = after;
		ctx.continueTarget = updateExpr !== 0 ? update : test;
		ctx.backTarget = test;
		ctx.labels = this.#takeLabels();
		this.#contexts.push(ctx);
		this.#current = body;
		this.#maybeVisit(reader.field(node, NODE_D));

		if (updateExpr !== 0) {
			this.#builder.addEdge(this.#current, update, EK_NORMAL, 0);
			this.#current = update;
			this.#maybeVisit(updateExpr);
		}

		this.#builder.addEdge(this.#current, test, EK_NORMAL | EF_BACK, 0);
		this.#contexts.pop();
		this.#current = after;
	}

	/**
	 * Visits a `for...in` or `for...of` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitForEach(node: number): void {
		const reader = this.#reader;
		const left = reader.field(node, NODE_A);
		const right = reader.field(node, NODE_B);

		this.#maybeVisit(right);

		const head = this.#builder.newBlock();

		this.#builder.addEdge(this.#current, head, EK_NORMAL, 0);

		const body = this.#builder.newBlock();
		const after = this.#builder.newBlock();
		const rightHandle = this.#handle(right);

		this.#builder.addEdge(head, body, EK_ITERATE, rightHandle);
		this.#builder.addEdge(head, after, EK_DONE, rightHandle);

		const ctx = newContext(CTX_LOOP);

		ctx.breakTarget = after;
		ctx.continueTarget = head;
		ctx.backTarget = head;
		ctx.labels = this.#takeLabels();
		this.#contexts.push(ctx);
		this.#current = body;

		// Each iteration writes the left side before the body runs.
		if (reader.kind(left) === N_VariableDeclaration) {
			this.#maybeVisit(left);
		} else {
			this.#visitTarget(left, rightHandle, 0);
		}

		this.#maybeVisit(reader.field(node, NODE_C));
		this.#builder.addEdge(this.#current, head, EK_NORMAL | EF_BACK, 0);
		this.#contexts.pop();
		this.#current = after;
	}

	/**
	 * Visits a `switch` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitSwitch(node: number): void {
		const reader = this.#reader;

		this.#maybeVisit(reader.field(node, NODE_A));

		const after = this.#builder.newBlock();
		const cases = reader.field(node, NODE_B);
		const caseCount = reader.listSize(cases);

		if (caseCount === 0) {
			this.#builder.addEdge(this.#current, after, EK_NORMAL, 0);
			this.#current = after;

			return;
		}

		const ctx = newContext(CTX_BREAKABLE);

		ctx.breakTarget = after;
		ctx.labels = this.#takeLabels();
		this.#contexts.push(ctx);

		// Every case body gets its block up front; tests chain into them.
		const bodies = new Array<number>(caseCount);

		for (let i = 0; i < caseCount; i++) {
			bodies[i] = this.#builder.newBlock();
		}

		let previous = this.#current;
		let previousCond = 0;
		let defaultIndex = -1;

		for (let i = 0; i < caseCount; i++) {
			const caseNode = reader.listItem(cases, i);
			const test = reader.field(caseNode, NODE_A);

			if (test === 0) {
				defaultIndex = i;
				continue;
			}

			const testBlock = this.#builder.newBlock();

			this.#builder.addEdge(
				previous,
				testBlock,
				previousCond === 0 ? EK_NORMAL : EK_FALSE,
				previousCond,
			);
			this.#current = testBlock;
			this.#maybeVisit(test);

			const testHandle = this.#handle(test);

			this.#builder.addEdge(
				this.#current,
				bodies[i],
				EK_TRUE,
				testHandle,
			);
			previous = this.#current;
			previousCond = testHandle;
		}

		this.#builder.addEdge(
			previous,
			defaultIndex >= 0 ? bodies[defaultIndex] : after,
			previousCond === 0 ? EK_NORMAL : EK_FALSE,
			previousCond,
		);

		for (let i = 0; i < caseCount; i++) {
			if (i > 0) {
				// Falling through the end of the previous body.
				this.#builder.addEdge(this.#current, bodies[i], EK_NORMAL, 0);
			}

			this.#current = bodies[i];

			const caseNode = reader.listItem(cases, i);

			this.#record(caseNode);
			this.#visitList(reader.field(caseNode, NODE_B));
		}

		this.#builder.addEdge(this.#current, after, EK_NORMAL, 0);
		this.#contexts.pop();
		this.#current = after;
	}

	/**
	 * Visits a `try` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitTry(node: number): void {
		const reader = this.#reader;
		const block = reader.field(node, NODE_A);
		const handler = reader.field(node, NODE_B);
		const finalizer = reader.field(node, NODE_C);
		const hasFinally = finalizer !== 0;
		const builder = this.#builder;

		/*
		 * The continuation blocks come first so that the try region — every
		 * block created while walking the protected code — is one contiguous
		 * run after them.
		 */
		const finallyEntry = hasFinally ? builder.newBlock() : -1;
		const handlerEntry = handler !== 0 ? builder.newBlock() : -1;
		const after = builder.newBlock();
		const ctx = newContext(CTX_TRY);

		ctx.hasFinally = hasFinally;
		ctx.finallyEntry = finallyEntry;
		this.#contexts.push(ctx);

		const tryEntry = builder.newBlock();

		builder.addEdge(this.#current, tryEntry, EK_NORMAL, 0);
		this.#current = tryEntry;
		this.#maybeVisit(block);

		const tryEnd = this.#current;
		const regionEnd = builder.blockCount;

		// Anything in the region can throw into the handler or finalizer.
		const exceptionTarget = handler !== 0 ? handlerEntry : finallyEntry;

		for (let b = tryEntry; b < regionEnd; b++) {
			builder.addEdge(b, exceptionTarget, EK_EXCEPTION, 0);
		}

		builder.addEdge(
			tryEnd,
			hasFinally ? finallyEntry : after,
			EK_NORMAL,
			0,
		);

		// Whether the protected code can complete without jumping or throwing.
		let completes = builder.isReachable(tryEnd);

		if (handler !== 0) {
			ctx.phase = PHASE_CATCH;
			this.#current = handlerEntry;
			this.#record(handler);

			const param = reader.field(handler, NODE_A);

			if (param !== 0) {
				this.#maybeVisit(param);
			}

			const catchRegionStart = builder.blockCount;

			this.#maybeVisit(reader.field(handler, NODE_B));

			const catchEnd = this.#current;

			if (hasFinally) {
				// The catch can throw too, and the finalizer still runs.
				builder.addEdge(handlerEntry, finallyEntry, EK_EXCEPTION, 0);

				for (let b = catchRegionStart; b < builder.blockCount; b++) {
					builder.addEdge(b, finallyEntry, EK_EXCEPTION, 0);
				}
			}

			builder.addEdge(
				catchEnd,
				hasFinally ? finallyEntry : after,
				EK_NORMAL,
				0,
			);
			completes ||= builder.isReachable(catchEnd);
		}

		if (hasFinally) {
			ctx.phase = PHASE_FINALLY;
			this.#current = finallyEntry;
			this.#maybeVisit(finalizer);

			const finallyEnd = this.#current;

			/*
			 * The finalizer falls through to what follows only when the
			 * protected code can complete normally. When every path out of
			 * the try and catch returns, throws, or jumps, the finalizer
			 * only ever forwards those completions, and adding the normal
			 * exit would make the code after the statement look reachable.
			 */
			if (completes) {
				builder.addEdge(finallyEnd, after, EK_NORMAL, 0);
			}

			this.#contexts.pop();

			/*
			 * The finalizer ran for a reason. Abrupt completions that were
			 * parked on the context resume from its end, and the exception
			 * path keeps propagating: an enclosing region covers these
			 * blocks, so only an unprotected finalizer reports the graph
			 * exit itself.
			 */
			this.#current = finallyEnd;

			if (ctx.pendingJumps !== null) {
				for (let i = 0; i < ctx.pendingJumps.length; i++) {
					const jump = ctx.pendingJumps[i];

					this.#routeJump(jump.target, jump.contextIndex, jump.flags);
				}
			}

			if (ctx.pendingReturn) {
				this.#routeReturn();
			}

			if (!this.#isProtected()) {
				this.#thrown.push(finallyEnd);
			}
		} else {
			this.#contexts.pop();
		}

		this.#current = after;
	}

	/**
	 * Visits a labeled statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitLabeled(node: number): void {
		const reader = this.#reader;
		const label = reader.field(node, NODE_A);
		const body = reader.field(node, NODE_B);
		const bodyKind = reader.kind(body);

		if (
			bodyKind === N_WhileStatement ||
			bodyKind === N_DoWhileStatement ||
			bodyKind === N_ForStatement ||
			bodyKind === N_ForInStatement ||
			bodyKind === N_ForOfStatement ||
			bodyKind === N_SwitchStatement ||
			bodyKind === N_LabeledStatement
		) {
			// The loop or switch takes the label onto its own context.
			this.#pendingLabels.push(label);
			this.#visit(body, bodyKind);

			return;
		}

		const after = this.#builder.newBlock();
		const ctx = newContext(CTX_LABEL);

		ctx.breakTarget = after;
		ctx.labels = [label, ...this.#pendingLabels];
		this.#pendingLabels.length = 0;
		this.#contexts.push(ctx);
		this.#maybeVisit(body);
		this.#builder.addEdge(this.#current, after, EK_NORMAL, 0);
		this.#contexts.pop();
		this.#current = after;
	}

	/**
	 * Takes the labels waiting for the construct being entered.
	 * @returns The label node indices, or `null` when there are none.
	 */
	#takeLabels(): number[] | null {
		if (this.#pendingLabels.length === 0) {
			return null;
		}

		const labels = this.#pendingLabels.slice();

		this.#pendingLabels.length = 0;

		return labels;
	}

	/**
	 * Whether a context answers to a label.
	 * @param ctx The context.
	 * @param label The label identifier node index.
	 * @returns `true` when one of the context's labels matches.
	 */
	#hasLabel(ctx: FlowContext, label: number): boolean {
		if (ctx.labels === null) {
			return false;
		}

		for (let i = 0; i < ctx.labels.length; i++) {
			if (this.#sameName(ctx.labels[i], label)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Visits a `break` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitBreak(node: number): void {
		const label = this.#reader.field(node, NODE_A);
		const contexts = this.#contexts;

		for (let i = contexts.length - 1; i >= 0; i--) {
			const ctx = contexts[i];
			const matches =
				label !== 0
					? ctx.breakTarget >= 0 && this.#hasLabel(ctx, label)
					: ctx.kind === CTX_LOOP || ctx.kind === CTX_BREAKABLE;

			if (matches) {
				this.#routeJump(ctx.breakTarget, i, 0);
				break;
			}
		}

		this.#terminate();
	}

	/**
	 * Visits a `continue` statement.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitContinue(node: number): void {
		const label = this.#reader.field(node, NODE_A);
		const contexts = this.#contexts;

		for (let i = contexts.length - 1; i >= 0; i--) {
			const ctx = contexts[i];

			if (
				ctx.kind === CTX_LOOP &&
				(label === 0 || this.#hasLabel(ctx, label))
			) {
				this.#routeJump(
					ctx.continueTarget,
					i,
					ctx.continueTarget === ctx.backTarget ? EF_BACK : 0,
				);
				break;
			}
		}

		this.#terminate();
	}

	//-------------------------------------------------------------------------
	// Expressions
	//-------------------------------------------------------------------------

	/**
	 * Walks one step of an optional chain, short-circuiting to the join
	 * block wherever a `?.` finds nothing.
	 * @param node The node index within the chain.
	 * @param join The block the chain's value lands in either way.
	 * @returns Nothing.
	 */
	#visitChainStep(node: number, join: number): void {
		const reader = this.#reader;
		const kind = reader.kind(node);

		if (kind === N_MemberExpression) {
			this.#record(node);

			const object = reader.field(node, NODE_A);

			this.#visitChainStep(object, join);

			if ((reader.flags(node) & NF_OPTIONAL) !== 0) {
				this.#fork(this.#handle(object), join);
			}

			if ((reader.flags(node) & NF_COMPUTED) !== 0) {
				this.#maybeVisit(reader.field(node, NODE_B));
			}

			return;
		}

		if (kind === N_CallExpression) {
			this.#record(node);

			const callee = reader.field(node, NODE_A);

			this.#visitChainStep(callee, join);

			if ((reader.flags(node) & NF_OPTIONAL) !== 0) {
				this.#fork(this.#handle(callee), join);
			}

			this.#visitList(reader.field(node, NODE_B));

			return;
		}

		if (kind === N_TSNonNullExpression) {
			this.#record(node);
			this.#visitChainStep(reader.field(node, NODE_A), join);

			return;
		}

		this.#maybeVisit(node);
	}

	/**
	 * Splits the current block on a nullish check: nullish exits to the
	 * join, anything else continues in a fresh block.
	 * @param condition The handle of the value being tested.
	 * @param join The block a nullish value short-circuits to.
	 * @returns Nothing.
	 */
	#fork(condition: number, join: number): void {
		const next = this.#builder.newBlock();

		this.#builder.addEdge(this.#current, next, EK_NOT_NULLISH, condition);
		this.#builder.addEdge(this.#current, join, EK_NULLISH, condition);
		this.#current = next;
	}

	/**
	 * Visits a class, deferring everything that runs later: method bodies,
	 * field initializers, and static blocks each become their own graph.
	 * @param node The node index.
	 * @returns Nothing.
	 */
	#visitClass(node: number): void {
		const reader = this.#reader;

		this.#visitList(reader.field(node, NODE_G));

		const superClass = reader.field(node, NODE_B);

		if (superClass !== 0) {
			this.#maybeVisit(superClass);
		}

		const body = reader.field(node, NODE_C);

		this.#record(body);

		const members = reader.field(body, NODE_A);
		const count = reader.listSize(members);

		for (let i = 0; i < count; i++) {
			const member = reader.listItem(members, i);
			const memberKind = reader.kind(member);

			if (
				memberKind === N_MethodDefinition ||
				memberKind === N_TSAbstractMethodDefinition
			) {
				this.#record(member);
				this.#visitList(reader.field(member, NODE_C));

				if ((reader.flags(member) & NF_COMPUTED) !== 0) {
					this.#maybeVisit(reader.field(member, NODE_A));
				}

				const value = reader.field(member, NODE_B);

				if (
					value !== 0 &&
					reader.kind(value) === N_FunctionExpression
				) {
					/*
					 * Evaluating the class creates the method's closure,
					 * so the function node executes here even though its
					 * body is a graph of its own. Without this record the
					 * only one it has is its own entry block, which is
					 * seeded reachable — and a method of a class in dead
					 * code would read as reachable.
					 */
					this.#record(value);
					this.#tasks.push({
						node: value,
						origin: ORIGIN_FUNCTION,
						upper: this.#graph,
					});
				}
			} else if (
				memberKind === N_PropertyDefinition ||
				memberKind === N_AccessorProperty
			) {
				this.#record(member);
				this.#visitList(reader.field(member, NODE_C));

				if ((reader.flags(member) & NF_COMPUTED) !== 0) {
					this.#maybeVisit(reader.field(member, NODE_A));
				}

				const value = reader.field(member, NODE_B);

				if (value !== 0) {
					this.#tasks.push({
						node: value,
						origin: ORIGIN_CLASS_FIELD_INITIALIZER,
						upper: this.#graph,
					});
				}
			} else if (memberKind === N_StaticBlock) {
				// A static block runs when the class is evaluated.
				this.#record(member);
				this.#tasks.push({
					node: member,
					origin: ORIGIN_CLASS_STATIC_BLOCK,
					upper: this.#graph,
				});
			}

			// Abstract members and index signatures have nothing to run.
		}
	}
}
