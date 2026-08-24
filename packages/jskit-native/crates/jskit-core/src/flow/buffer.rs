//! The binary control flow graph format, field by field.
//!
//! Port of the constants in `packages/jskit/src/flow/flow-buffer.ts`.

/// The first word of every flow buffer: "JCFG" read as little-endian bytes.
pub const FLOW_BUFFER_MAGIC: u32 = 0x4746434a;

/// The format version this module writes.
pub const FLOW_BUFFER_VERSION: u32 = 1;

pub const FLOW_H_MAGIC: usize = 0;
pub const FLOW_H_VERSION: usize = 1;
pub const FLOW_H_FLAGS: usize = 2;
pub const FLOW_H_GRAPH_COUNT: usize = 3;
pub const FLOW_H_BLOCK_COUNT: usize = 4;
pub const FLOW_H_EDGE_COUNT: usize = 5;
pub const FLOW_H_WRITE_COUNT: usize = 6;
pub const FLOW_H_GRAPHS_BASE: usize = 7;
pub const FLOW_H_BLOCKS_BASE: usize = 8;
pub const FLOW_H_EDGES_BASE: usize = 9;
pub const FLOW_H_PREDS_BASE: usize = 10;
pub const FLOW_H_WRITES_BASE: usize = 11;
pub const FLOW_H_POOL_BASE: usize = 12;
pub const FLOW_H_NODE_BLOCK_BASE: usize = 13;
pub const FLOW_H_NODE_BLOCK_COUNT: usize = 14;

/// How many words the header occupies.
pub const FLOW_HEADER_WORDS: usize = 16;

/// Words per graph record.
pub const GRAPH_WORDS: usize = 9;
pub const G_ORIGIN: usize = 0;
pub const G_NODE: usize = 1;
pub const G_UPPER: usize = 2;
pub const G_INITIAL: usize = 3;
pub const G_FIRST_BLOCK: usize = 4;
pub const G_BLOCK_COUNT: usize = 5;
pub const G_RETURNED: usize = 6;
pub const G_THROWN: usize = 7;
pub const G_IMPLICIT: usize = 8;

/// Words per block record.
pub const BLOCK_WORDS: usize = 8;
pub const B_FLAGS: usize = 0;
pub const B_GRAPH: usize = 1;
pub const B_SUCC_FIRST: usize = 2;
pub const B_SUCC_COUNT: usize = 3;
pub const B_PRED_FIRST: usize = 4;
pub const B_PRED_COUNT: usize = 5;
pub const B_WRITE_FIRST: usize = 6;
pub const B_WRITE_COUNT: usize = 7;

pub const BF_REACHABLE: u32 = 1;
pub const BF_LOOP_HEAD: u32 = 2;
pub const BF_RETURNS: u32 = 4;
pub const BF_THROWS: u32 = 8;

/// Words per edge record.
pub const EDGE_WORDS: usize = 4;
pub const E_FROM: usize = 0;
pub const E_TO: usize = 1;
pub const E_FLAGS: usize = 2;
pub const E_COND: usize = 3;

/// The edge is a loop back edge.
pub const EF_BACK: u32 = 16;

pub const EK_NORMAL: u32 = 0;
pub const EK_TRUE: u32 = 1;
pub const EK_FALSE: u32 = 2;
pub const EK_NULLISH: u32 = 3;
pub const EK_NOT_NULLISH: u32 = 4;
pub const EK_EXCEPTION: u32 = 5;
pub const EK_RESUME: u32 = 6;
pub const EK_ITERATE: u32 = 7;
pub const EK_DONE: u32 = 8;
pub const EK_ABRUPT: u32 = 9;

/// Words per write record.
pub const WRITE_WORDS: usize = 4;
pub const W_REF: usize = 0;
pub const W_TARGET: usize = 1;
pub const W_EXPR: usize = 2;
pub const W_FLAGS: usize = 3;

pub const WF_INIT: u32 = 1;
pub const WF_COMPOUND: u32 = 2;
pub const WF_UPDATE: u32 = 4;
pub const WF_MEMBER: u32 = 8;

pub const ORIGIN_PROGRAM: u32 = 0;
pub const ORIGIN_FUNCTION: u32 = 1;
pub const ORIGIN_CLASS_FIELD_INITIALIZER: u32 = 2;
pub const ORIGIN_CLASS_STATIC_BLOCK: u32 = 3;
