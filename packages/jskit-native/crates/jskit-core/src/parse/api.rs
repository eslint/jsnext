//! The public entry point: `parse()`.
//!
//! Port of the `parse()` half of `packages/jskit/src/parse/api.ts`. The
//! returned bytes are the parse buffer, identical to the `ArrayBuffer` the
//! TypeScript implementation builds for the same source and options.

use super::binary::{
    build_parse_buffer, ParseBufferInput, SOURCE_TYPE_COMMONJS, SOURCE_TYPE_MODULE,
    SOURCE_TYPE_SCRIPT,
};
use super::errors::ParseError;
use super::parser::Parser;

/// Which reading of the text the parser is given.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum SourceType {
    #[default]
    Module,
    Script,
    CommonJs,
}

impl SourceType {
    fn encoded(self) -> u32 {
        match self {
            SourceType::Module => SOURCE_TYPE_MODULE,
            SourceType::Script => SOURCE_TYPE_SCRIPT,
            SourceType::CommonJs => SOURCE_TYPE_COMMONJS,
        }
    }
}

/// How the buffers `parse()` produces should be built.
#[derive(Clone, Copy, Default)]
pub struct ParseOptions {
    /// Whether to read the text as a script, an ES module, or a CommonJS
    /// module. Defaults to `Module`.
    pub source_type: SourceType,

    /// How a `<` in expression position reads; `None` accepts the union.
    pub jsx: Option<bool>,

    /// Whether to copy the source text into the parse buffer.
    pub source: bool,

    /// Whether to store the token records (comments included) in the buffer.
    pub tokens: bool,

    /// Whether to derive the parent of every node and store it.
    pub parents: bool,
}

/// Parses source text into one binary buffer.
pub fn parse(code: &[u16], options: &ParseOptions) -> Result<Vec<u8>, ParseError> {
    let is_module = options.source_type == SourceType::Module;
    let mut parser = Parser::new(code, is_module, options.jsx)?;
    let root = parser.parse_program()?;

    Ok(build_parse_buffer(&ParseBufferInput {
        nodes: &parser.writer.nodes,
        node_count: parser.writer.count,
        lists: &parser.writer.lists,
        root,
        tokens: &parser.tokenizer.records,
        token_count: parser.tokenizer.count,
        store_tokens: options.tokens,
        line_starts: &parser.tokenizer.line_starts,
        line_count: parser.tokenizer.line_count,
        source: code,
        embed_source: options.source,
        parents: options.parents,
        source_type: options.source_type.encoded(),
    }))
}
