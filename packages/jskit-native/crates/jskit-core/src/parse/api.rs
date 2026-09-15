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
use super::node_kinds::{N_JSX_ELEMENT, N_JSX_FRAGMENT, NODE_KIND, NODE_START, NODE_WORDS};
use super::parser::Dialect;
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

    /// How a `<` in expression position reads: `true` as JSX, the way a
    /// `.tsx` file does, and `false` — the default — as a type assertion, the
    /// way a `.ts` file does.
    pub jsx: bool,

    /// How a `<` after an expression reads. Defaults to `Ts`, which takes a
    /// type argument list wherever one fits and a call can follow it; `Js`
    /// never takes one, so `f<A, B>(a + b)` stays two comparisons.
    pub dialect: Dialect,

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
    let mut parser = Parser::new(code, is_module, options.jsx, options.dialect)?;
    let root = match parser.parse_program() {
        Ok(root) => root,
        Err(error) if !options.jsx => {
            return Err(explain_missing_jsx(code, is_module, options.dialect, error));
        }
        Err(error) => return Err(error),
    };

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

/// Decides what a parse that failed without `jsx: true` should report.
///
/// Read the `.ts` way, an element is a broken type assertion whose diagnostic
/// describes the symptom, so the text is parsed once more the `.tsx` way.
/// When that succeeds with an element in the tree, the missing option is
/// reported at the first element, in the words `validate()` uses; anything
/// else keeps the original error. Mirrors `explainMissingJsx()` in
/// `packages/jskit/src/parse/api.ts`.
fn explain_missing_jsx(
    code: &[u16],
    is_module: bool,
    dialect: Dialect,
    error: ParseError,
) -> ParseError {
    let Ok(mut parser) = Parser::new(code, is_module, true, dialect) else {
        return error;
    };

    if parser.parse_program().is_err() {
        return error;
    }

    let words = &parser.writer.nodes.words;
    let last = parser.writer.count as usize * NODE_WORDS;
    let mut first: Option<u32> = None;

    // Node 0 is reserved; an outer element always starts before its children.
    for base in (NODE_WORDS..last).step_by(NODE_WORDS) {
        let kind = words[base + NODE_KIND];

        if kind == N_JSX_ELEMENT || kind == N_JSX_FRAGMENT {
            let start = words[base + NODE_START];

            if first.is_none_or(|first| start < first) {
                first = Some(start);
            }
        }
    }

    match first {
        Some(start) => parser.tokenizer.error(
            "JSX syntax is not allowed unless the jsx option is enabled.",
            start,
        ),
        None => error,
    }
}
