/**
 * @fileoverview Turns `toGraphTree()`'s output into a Mermaid flowchart.
 *
 * The tree view already shows every field of every block; the diagram
 * answers the other question — how control moves between them. So this
 * keeps only what an edge picture needs: one node per basic block labeled
 * with the writes it performs and the condition it branches on, and one
 * link per edge labeled with the branch that was taken.
 *
 * One execution unit is drawn at a time. Control never crosses from one
 * graph into another — a call is an edge to nothing, not an edge into the
 * callee — so a chart holding all of them is a chart of disconnected
 * pieces, which the layout engine is free to arrange in any order it
 * likes. Drawing them one at a time is both smaller and better laid out,
 * and `graphLabel()` names each one for whatever picks between them.
 *
 * Blocks carry no source text of their own, only handles into the program,
 * so every label here is cut from the same source string the analyses ran
 * over. Passing a different one produces a diagram that lies, which is why
 * `toFlowDiagram()` takes the text rather than reading it from anywhere.
 */

import type {
	FlowTreeBlock,
	FlowTreeGraph,
	FlowTreeNode,
	FlowTreeWrite,
} from "@eslint/jskit";

/** How many basic blocks the diagram draws before it declines to. */
const MAX_BLOCKS = 400;

/** How many lines a block's body runs to before the rest become a count. */
const MAX_LINES = 4;

/** How long a source excerpt in a block label runs before it is elided. */
const MAX_EXCERPT = 44;

/** How long the code in an execution unit's name runs before it is elided. */
const MAX_NAME = 40;

/**
 * A Mermaid rendering of one execution unit's control flow graph.
 */
export interface FlowDiagram {
	/** The flowchart definition, or `null` when there are too many blocks. */
	definition: string | null;

	/** How many basic blocks the unit has. */
	blockCount: number;

	/** The most blocks a diagram is drawn for. */
	limit: number;
}

/**
 * Escapes text so Mermaid treats it as a label rather than as syntax.
 *
 * Mermaid spells the characters that would otherwise end a label as
 * numeric entities, so `#` has to go first: every replacement after it
 * introduces one.
 * @param text The text to escape.
 * @returns The escaped text.
 */
function escapeLabel(text: string): string {
	return text
		.replace(/#/gu, "#35;")
		.replace(/"/gu, "#quot;")
		.replace(/</gu, "#lt;")
		.replace(/>/gu, "#gt;");
}

/**
 * Cuts the source text a node covers down to one short line.
 * @param source The program the graph was built from.
 * @param start The first offset to take.
 * @param end The offset to stop at.
 * @param limit How long the result may run before it is elided.
 * @returns The excerpt, collapsed onto one line and elided if long.
 */
function excerpt(
	source: string,
	start: number,
	end: number,
	limit = MAX_EXCERPT,
): string {
	const text = source.slice(start, end).replace(/\s+/gu, " ").trim();

	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Describes one write the way the source spells it.
 *
 * A write with a value spans from its target to the end of that value, so
 * the source itself supplies the operator — `=`, `+=`, or the `of` of a
 * `for`. A write without one has no operator to show, and the flow format
 * does not record which way an update went, so both say only that the
 * variable was written.
 * @param write The write to describe.
 * @param source The program the graph was built from.
 * @returns The one-line description.
 */
function writeLine(write: FlowTreeWrite, source: string): string {
	if (write.value !== null) {
		return excerpt(source, write.target.start, write.value.end);
	}

	const target = excerpt(source, write.target.start, write.target.end);

	return write.update ? `${target} (update)` : `${target} = …`;
}

/**
 * The statements a block runs, at the granularity a reader thinks in.
 *
 * A block holds every node the walk placed in it, down to each identifier,
 * which is far more than a box can show. Keeping only statements, dropping
 * the block containers that would swallow them, and dropping the graph's
 * own node — the function is not a statement *of* its own entry block —
 * leaves the lines someone would recognize as the code. The nodes arrive
 * outermost first, so anything nested inside a statement already kept is
 * part of it.
 * @param block The block to read.
 * @param graph The graph the block belongs to.
 * @returns The statement nodes, in source order.
 */
function statementsOf(
	block: FlowTreeBlock,
	graph: FlowTreeGraph,
): FlowTreeNode[] {
	const kept: FlowTreeNode[] = [];

	for (const node of block.nodes) {
		const isStatement =
			/(?:Statement|Declaration)$/u.test(node.type) &&
			node.type !== "BlockStatement";

		if (
			!isStatement ||
			(node.start === graph.node.start && node.end === graph.node.end)
		) {
			continue;
		}

		const nested = kept.some(
			outer => node.start >= outer.start && node.end <= outer.end,
		);

		if (!nested) {
			kept.push(node);
		}
	}

	return kept;
}

/**
 * Names what is notable about a block: where it sits in its graph and how
 * control leaves it.
 * @param block The block to describe.
 * @param graph The graph the block belongs to.
 * @returns The markers, in reading order, possibly empty.
 */
function markersOf(block: FlowTreeBlock, graph: FlowTreeGraph): string[] {
	const markers: string[] = [];

	if (block.blockId === graph.initial) {
		markers.push("entry");
	}

	if (block.blockId === graph.implicit) {
		markers.push("implicit exit");
	}

	if (block.loopHead) {
		markers.push("loop");
	}

	if (block.returns) {
		markers.push("returns");
	}

	if (block.throws) {
		markers.push("throws");
	}

	if (!block.reachable) {
		markers.push("unreachable");
	}

	return markers;
}

/**
 * The condition every outgoing edge of a block branches on.
 *
 * A branch records the same test on each edge it produced, so showing it
 * once on the block is both shorter and truer to the code than repeating
 * it on `true` and `false` alike. A block whose edges disagree — or that
 * has none — gets nothing.
 * @param block The block to read.
 * @param source The program the graph was built from.
 * @returns The condition's source text, or `null` when there is no single one.
 */
function conditionOf(block: FlowTreeBlock, source: string): string | null {
	let found: string | null = null;

	for (const edge of block.successors) {
		if (edge.condition === null) {
			continue;
		}

		const text = excerpt(source, edge.condition.start, edge.condition.end);

		if (found !== null && found !== text) {
			return null;
		}

		found = text;
	}

	return found;
}

/**
 * Builds one block's label: a header naming the block, the writes it
 * performs, and the condition it leaves on.
 * @param block The block to label.
 * @param graph The graph the block belongs to.
 * @param source The program the graph was built from.
 * @returns The escaped label, with `<br/>` between its lines.
 */
function labelOf(
	block: FlowTreeBlock,
	graph: FlowTreeGraph,
	source: string,
): string {
	const markers = markersOf(block, graph);
	const header =
		markers.length > 0
			? `#${block.blockId} · ${markers.join(", ")}`
			: `#${block.blockId}`;
	const lines = [header];

	/*
	 * Writes are what this analysis records about a block, so they are
	 * what a block shows. But a block that assigns nothing still runs
	 * code — a bare call, a `return` — and showing nothing for it is what
	 * made an unreachable `hi();` look like an empty box, so its
	 * statements stand in when there are no writes to show.
	 */
	const body =
		block.writes.length > 0
			? block.writes.map(write => writeLine(write, source))
			: statementsOf(block, graph).map(node =>
					excerpt(source, node.start, node.end),
				);

	lines.push(...body.slice(0, MAX_LINES));

	if (body.length > MAX_LINES) {
		lines.push(`… ${body.length - MAX_LINES} more`);
	}

	const condition = conditionOf(block, source);

	if (condition !== null) {
		lines.push(`? ${condition}`);
	}

	return lines.map(escapeLabel).join("<br/>");
}

/**
 * Wraps a label in the shape that says what the block is: a stadium for
 * the way in and the ways out, a hexagon for a loop head, a box for the
 * rest.
 * @param block The block to shape.
 * @param graph The graph the block belongs to.
 * @param label The block's escaped label.
 * @returns The Mermaid node declaration, without its id.
 */
function shapeOf(
	block: FlowTreeBlock,
	graph: FlowTreeGraph,
	label: string,
): string {
	if (block.blockId === graph.initial || block.returns || block.throws) {
		return `(["${label}"])`;
	}

	if (block.loopHead) {
		return `{{"${label}"}}`;
	}

	return `["${label}"]`;
}

/**
 * Names an execution unit the way something choosing between them wants to
 * read it: its number, what kind of unit it is, and the code it covers.
 *
 * The flow tree names the unit's node by kind and extent alone, so the
 * name that identifies it to a reader — the function's own signature — has
 * to come out of the source. The program has no signature to show and its
 * extent is the whole file, so it is named by what it is.
 * @param graph The graph to name.
 * @param source The program the graph was built from.
 * @returns The name, as plain text rather than as a Mermaid label.
 */
export function graphLabel(graph: FlowTreeGraph, source: string): string {
	if (graph.origin === "program") {
		return `#${graph.graphId} program`;
	}

	const nested = graph.upper === null ? "" : ` in #${graph.upper}`;
	const code = excerpt(source, graph.node.start, graph.node.end, MAX_NAME);

	return `#${graph.graphId} ${graph.origin}${nested} — ${code}`;
}

/**
 * Renders one execution unit's control flow graph as a Mermaid flowchart.
 *
 * Links are emitted after every block rather than beside the block they
 * leave, so that a block is declared with its own shape and label before
 * anything else names it. Back edges are dotted, and every edge but a
 * plain `normal` one carries its kind as a label.
 *
 * A block with no edges at all — the empty one a `return` leaves behind is
 * the common case — has nothing to place it by, so the layout is free to
 * park it anywhere, which reads as debris rather than as the tail of the
 * unit. Those are chained under the last block that does have a place,
 * with invisible links, which pins them where they belong without drawing
 * an arrow that does not exist.
 *
 * Only blocks with no edges qualify, and the narrowness is the point.
 * Dead code can fall back into live code — the block after a `return`
 * inside an `if` runs into the join the other branch also reaches — so a
 * block that merely has no predecessors can still have a successor that
 * places it, and pinning it under a descendant of its own would hand the
 * layout a cycle to break. A block with no edges can be in no such loop.
 * @param graph One graph from the tree `toGraphTree()` returned.
 * @param source The program the graph was built from.
 * @returns The definition, or a `null` one when the unit has more blocks
 *      than a readable diagram can hold.
 */
export function toFlowDiagram(
	graph: FlowTreeGraph,
	source: string,
): FlowDiagram {
	const blockCount = graph.blocks.length;

	if (blockCount > MAX_BLOCKS) {
		return { definition: null, blockCount, limit: MAX_BLOCKS };
	}

	const lines = ["flowchart TD"];
	const links: string[] = [];
	const unreachable: string[] = [];
	const loose: number[] = [];

	/*
	 * What the loose blocks get pinned under: the last one the edges
	 * themselves place. The entry block always counts as one, so there is
	 * always an anchor even when nothing else qualifies.
	 */
	let anchor = graph.initial;

	for (const block of graph.blocks) {
		const label = labelOf(block, graph, source);

		lines.push(`b${block.blockId}${shapeOf(block, graph, label)}`);

		if (!block.reachable) {
			unreachable.push(`b${block.blockId}`);
		}

		if (
			block.predecessors.length === 0 &&
			block.successors.length === 0 &&
			block.blockId !== graph.initial
		) {
			loose.push(block.blockId);
		} else {
			anchor = block.blockId;
		}

		for (const edge of block.successors) {
			const arrow = edge.back ? "-.->" : "-->";
			const kind =
				edge.kind === "normal" ? "" : `|"${escapeLabel(edge.kind)}"|`;

			links.push(`b${block.blockId} ${arrow}${kind} b${edge.to}`);
		}
	}

	/*
	 * Chained rather than all hung off the anchor, so that several of them
	 * stack in build order instead of spreading into a row.
	 */
	for (const block of loose) {
		links.push(`b${anchor} ~~~ b${block}`);
		anchor = block;
	}

	lines.push(...links);
	lines.push("classDef unreachable stroke-dasharray:4 3,opacity:0.55");

	if (unreachable.length > 0) {
		lines.push(`class ${unreachable.join(",")} unreachable`);
	}

	return {
		definition: lines.join("\n"),
		blockCount,
		limit: MAX_BLOCKS,
	};
}
