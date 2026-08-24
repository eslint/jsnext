//! The scope analyzer: one walk over the parse buffer, producing the binary
//! scope format.
//!
//! Port of the binary path of `packages/jskit/src/scope/` — `analyze()` only.
//! The tree entry point (`analyzeTree()`), the rehydrated object graph, and
//! the query views stay in TypeScript; they consume the buffer this module
//! produces.

pub mod binary_ast;
pub mod buffer;
pub mod builder;
pub mod options;
pub mod pattern;
pub mod referencer;

use binary_ast::BinaryAst;
use builder::ScopeBuilder;
use options::ResolvedOptions;
use referencer::Referencer;

pub use options::ScopeSourceType;

/// Finds the scopes of a parsed program and resolves every identifier in it.
///
/// `parse_words` is the parse buffer viewed as little-endian words, and
/// `source` is the exact text it was parsed from, as UTF-16 code units. The
/// result is the scope buffer, byte-identical to the TypeScript `analyze()`.
pub fn analyze(parse_words: &[u32], source: &[u16], options: ResolvedOptions) -> Vec<u8> {
    let ast = BinaryAst::new(parse_words, source);
    let root = ast.root;
    let globals = options.globals.clone();
    let mut builder = ScopeBuilder::new(ast, options);

    Referencer::new(&mut builder).visit(root);

    if let Some(globals) = globals {
        builder.add_globals(&globals);
    }

    builder.finish()
}

/// Views a parse buffer's bytes as words, copying to guarantee alignment.
pub fn words_of(buffer: &[u8]) -> Vec<u32> {
    buffer
        .chunks_exact(4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}
