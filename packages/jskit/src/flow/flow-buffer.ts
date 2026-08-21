/**
 * @fileoverview The binary control flow graph format, field by field.
 *
 * `createGraph()` returns one `ArrayBuffer` in this format. Everything in it
 * is a little-endian 32-bit word, the same convention the parser's AST
 * buffer and the scope analyzer's scope buffer use, and every consumer reads
 * it through the constants below rather than through magic numbers of its own.
 *
 * The format is shaped by how ESLint rules actually consume code path
 * analysis, which falls into four jobs in order of frequency:
 *
 * 1. **"Is this point reachable?"** — the dominant question, so reachability
 *    is a precomputed bit on every block and the node-block index turns any
 *    visited node into its block with one binary search. No consumer has to
 *    maintain a current-segment set of its own.
 * 2. **Enumerating execution units** — several rules use code paths only as a
 *    correct function stack, so graphs are their own record section with an
 *    origin code (`program`, `function`, `class-field-initializer`,
 *    `class-static-block`) readable without touching a single block.
 * 3. **"On every path" vs. "on some path" at function exit** — each graph
 *    stores its returned and thrown block lists and its implicit-exit block.
 * 4. **Dataflow along edges** — blocks carry ordered variable writes tied to
 *    scope references, and edges carry the branch condition that was taken,
 *    which is also what future type narrowing needs.
 *
 * Node references are **handles**: the byte offset of the node's record in
 * the parse buffer the graph was built from, exactly as the scope buffer's
 * binary path stores them. Scope references are byte offsets of reference
 * records in the scope buffer. Handle `0` means "none" for both.
 *
 * IDs are stable and immutable: a graph, block, edge, or write is its
 * zero-based index into its own record section. Where a record field holds an
 * optional ID, it is stored as `id + 1` so that `0` can mean "none". A
 * graph's blocks are contiguous, so a graph is also a slice of the block
 * section.
 *
 * The enum code tables here are part of the format and are **append-only**:
 * repositioning an entry changes what every previously written buffer means.
 */

//-----------------------------------------------------------------------------
// Header
//-----------------------------------------------------------------------------

/** The first word of every flow buffer: "JCFG" read as little-endian bytes. */
export const FLOW_BUFFER_MAGIC = 0x4746434a;

/** The format version this module writes and reads. */
export const FLOW_BUFFER_VERSION = 1;

export const FLOW_H_MAGIC = 0;
export const FLOW_H_VERSION = 1;
export const FLOW_H_FLAGS = 2;
export const FLOW_H_GRAPH_COUNT = 3;
export const FLOW_H_BLOCK_COUNT = 4;
export const FLOW_H_EDGE_COUNT = 5;
export const FLOW_H_WRITE_COUNT = 6;
export const FLOW_H_GRAPHS_BASE = 7;
export const FLOW_H_BLOCKS_BASE = 8;
export const FLOW_H_EDGES_BASE = 9;
export const FLOW_H_PREDS_BASE = 10;
export const FLOW_H_WRITES_BASE = 11;
export const FLOW_H_POOL_BASE = 12;
export const FLOW_H_NODE_BLOCK_BASE = 13;
export const FLOW_H_NODE_BLOCK_COUNT = 14;
export const FLOW_H_RESERVED = 15;

/** How many words the header occupies. */
export const FLOW_HEADER_WORDS = 16;

//-----------------------------------------------------------------------------
// Records
//-----------------------------------------------------------------------------

/*
 * Every list-valued field holds a **pool handle**: a word offset into the
 * pool section where `[count, item0, item1, ...]` sits. Handle `0` is the
 * empty list.
 */

/** Words per graph record. */
export const GRAPH_WORDS = 9;
export const G_ORIGIN = 0; // origin code
export const G_NODE = 1; // node handle: Program, function, field value, block
export const G_UPPER = 2; // graph ID + 1, 0 for the program graph
export const G_INITIAL = 3; // block ID of the entry block
export const G_FIRST_BLOCK = 4; // first block ID belonging to this graph
export const G_BLOCK_COUNT = 5; // how many contiguous blocks it owns
export const G_RETURNED = 6; // pool handle: block IDs that exit normally
export const G_THROWN = 7; // pool handle: block IDs that exit on a throw
export const G_IMPLICIT = 8; // block ID + 1 of the implicit-exit block

/** Words per block record. */
export const BLOCK_WORDS = 8;
export const B_FLAGS = 0;
export const B_GRAPH = 1; // graph ID of the owning graph
export const B_SUCC_FIRST = 2; // first outgoing edge ID
export const B_SUCC_COUNT = 3; // edges are grouped by source block
export const B_PRED_FIRST = 4; // first entry in the predecessor section
export const B_PRED_COUNT = 5;
export const B_WRITE_FIRST = 6; // first write ID
export const B_WRITE_COUNT = 7; // writes are grouped by block

/** Control can reach this block from its graph's entry. */
export const BF_REACHABLE = 1;

/** The block is the target of at least one loop back edge. */
export const BF_LOOP_HEAD = 2;

/** The block ends in an explicit `return`. */
export const BF_RETURNS = 4;

/** The block ends in an explicit `throw`. */
export const BF_THROWS = 8;

/** Words per edge record. */
export const EDGE_WORDS = 4;
export const E_FROM = 0; // block ID
export const E_TO = 1; // block ID
export const E_FLAGS = 2; // kind in the low bits, flags above them
export const E_COND = 3; // node handle of the branch condition, 0 for none

/** Mask extracting the edge kind from `E_FLAGS`. */
export const EDGE_KIND_MASK = 15;

/** The edge is a loop back edge. */
export const EF_BACK = 16;

/*
 * Edge kinds. `E_COND` holds the expression the kind refines: the condition
 * for the four branch kinds, the suspension point for `resume`, and `0` for
 * the rest. Append-only.
 */
export const EK_NORMAL = 0;
export const EK_TRUE = 1; // taken when the condition is truthy
export const EK_FALSE = 2; // taken when the condition is falsy
export const EK_NULLISH = 3; // taken when the condition is null or undefined
export const EK_NOT_NULLISH = 4; // taken when it is anything else
export const EK_EXCEPTION = 5; // control moved because something threw
export const EK_RESUME = 6; // execution resumed after an await or yield
export const EK_ITERATE = 7; // a for-in/for-of produced another value
export const EK_DONE = 8; // the iteration was exhausted
export const EK_ABRUPT = 9; // an abrupt completion routed through a finally

/** Names of the edge kinds, indexed by kind code. Append-only. */
export const EDGE_KIND_NAMES: readonly string[] = [
	"normal",
	"true",
	"false",
	"nullish",
	"not-nullish",
	"exception",
	"resume",
	"iterate",
	"done",
	"abrupt",
];

/** Words per write record. Writes are grouped by block, in execution order. */
export const WRITE_WORDS = 4;
export const W_REF = 0; // byte offset of the scope reference record, 0 = none
export const W_TARGET = 1; // node handle of the written identifier or member
export const W_EXPR = 2; // node handle of the value written, 0 for none
export const W_FLAGS = 3;

/** The write is a declarator or parameter-less initialization. */
export const WF_INIT = 1;

/** The write came from a compound assignment operator. */
export const WF_COMPOUND = 2;

/** The write came from `++` or `--`. */
export const WF_UPDATE = 4;

/** The target is a member expression, so `W_REF` is `0`. */
export const WF_MEMBER = 8;

//-----------------------------------------------------------------------------
// Origins
//-----------------------------------------------------------------------------

/*
 * Graph origin codes, spelled the way ESLint's `codePath.origin` spells
 * them so a consumer keyed on those strings ports over directly.
 * Append-only.
 */
export const ORIGIN_PROGRAM = 0;
export const ORIGIN_FUNCTION = 1;
export const ORIGIN_CLASS_FIELD_INITIALIZER = 2;
export const ORIGIN_CLASS_STATIC_BLOCK = 3;

/** Names of the graph origins, indexed by origin code. Append-only. */
export const ORIGIN_NAMES: readonly string[] = [
	"program",
	"function",
	"class-field-initializer",
	"class-static-block",
];

//-----------------------------------------------------------------------------
// Indexes
//-----------------------------------------------------------------------------

/*
 * Two derived sections make the common queries cheap without a scan:
 *
 * - The **predecessor section** holds edge IDs grouped by target block, so a
 *   dataflow pass merges incoming state without inverting the edge list
 *   itself. `B_PRED_FIRST`/`B_PRED_COUNT` slice into it.
 * - The **node-block index** is `(node handle, block ID)` word pairs sorted
 *   by handle, one per node the walk visited, answered by binary search.
 *   "Which block holds this node" and "is this node reachable" are the two
 *   questions nearly every code-path rule asks, and this index answers both
 *   without any consumer-side segment tracking. Nodes that never execute —
 *   type annotations, unvisited declaration scaffolding — have no entry.
 */

/** Words per node-block index entry. Entries are sorted by node handle. */
export const NODE_BLOCK_WORDS = 2;
export const NB_NODE = 0; // node handle
export const NB_BLOCK = 1; // block ID the node executes in
