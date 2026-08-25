//! The type analyzer: two passes over the parse and scope buffers, producing
//! the binary type format.
//!
//! Port of `packages/jskit/src/types/` — `inferTypes()` only. The reading
//! layers (`Types`, `TypesBufferReader`, `toTypeTree()`) stay in TypeScript.

pub mod buffer;
pub mod builder;
pub mod walker;
pub mod well_known;

use crate::scope::binary_ast::BinaryAst;
use crate::scope::buffer::SCOPE_H_SYMBOL_COUNT;
use builder::TypesBuilder;
use walker::TypesWalker;

/// Infers what types a parsed program states, without checking anything.
///
/// `parse_words` is the parse buffer viewed as words, `source` the text it
/// was parsed from, and `scope_words` the scope buffer `analyze()` produced
/// over the same parse result. The result is the type buffer, byte-identical
/// to the TypeScript `inferTypes()`.
pub fn infer_types(parse_words: &[u32], source: &[u16], scope_words: &[u32]) -> Vec<u8> {
    let ast = BinaryAst::new(parse_words, source);
    let mut builder = TypesBuilder::new(scope_words[SCOPE_H_SYMBOL_COUNT] as usize);

    TypesWalker::new(&ast, scope_words, &mut builder).build();

    builder.finish()
}
