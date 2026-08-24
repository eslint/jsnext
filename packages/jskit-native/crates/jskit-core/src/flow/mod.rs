//! The control flow analyzer: one walk over the parse and scope buffers,
//! producing the binary flow format.
//!
//! Port of `packages/jskit/src/flow/` — `createGraph()` only. The reading
//! layers (`FlowBufferReader`, `toGraphTree()`) stay in TypeScript.

pub mod buffer;
pub mod builder;
pub mod walker;

use crate::scope::binary_ast::BinaryAst;
use builder::FlowBuilder;
use walker::FlowWalker;

/// Builds the control flow graph of a parsed program.
///
/// `parse_words` is the parse buffer viewed as words, `source` the text it
/// was parsed from, and `scope_words` the scope buffer `analyze()` produced
/// over the same parse result. The result is the flow buffer, byte-identical
/// to the TypeScript `createGraph()`.
pub fn create_graph(parse_words: &[u32], source: &[u16], scope_words: &[u32]) -> Vec<u8> {
    let reader = BinaryAst::new(parse_words, source);
    let mut builder = FlowBuilder::new();

    FlowWalker::new(&reader, scope_words, &mut builder).build();

    builder.finish()
}
