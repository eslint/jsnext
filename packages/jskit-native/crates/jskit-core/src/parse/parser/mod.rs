//! The parser: one struct whose implementation is split across modules the
//! way the TypeScript sources split one object across an inheritance chain.
//!
//! - `base.rs`  — token plumbing, identifiers, literals (`parser-base.ts`)
//! - `types.rs` — the TypeScript type grammar (`parser-types.ts`)
//! - `expressions.rs` — expressions, patterns, functions, classes
//!   (`parser-expressions.ts`)
//! - `jsx.rs`   — the JSX grammar (`parser-jsx.ts`)
//! - `statements.rs` — statements, declarations, modules, and
//!   `parse_program()` (`parser.ts`)

mod base;
mod expressions;
mod jsx;
mod statements;
mod types;

use super::errors::ParseError;
use super::node_writer::NodeWriter;
use super::tokenizer::Tokenizer;

/// The element stands in an ordinary expression, so the next token is code.
pub const AFTER_JSX_EXPRESSION: u8 = 0;

/// The element is a child of another, so what follows is more child text.
pub const AFTER_JSX_CHILDREN: u8 = 1;

/// The element is an attribute's value; what follows is the rest of the tag.
pub const AFTER_JSX_ATTRIBUTE: u8 = 2;

/// The result of a parse step: a node index or list handle on success.
pub type PRes<T = u32> = Result<T, ParseError>;

/// The complete parser.
pub struct Parser<'a> {
    /// The scanner feeding this parser.
    pub tokenizer: Tokenizer<'a>,

    /// The binary node builder.
    pub writer: NodeWriter,

    /// The source text, as UTF-16 code units.
    pub source: &'a [u16],

    /// Whether `await` is currently an operator rather than an identifier.
    pub in_async: bool,

    /// Whether `yield` is currently an operator rather than an identifier.
    pub in_generator: bool,

    /// Whether the `in` operator may appear in the current expression.
    pub allow_in: bool,

    /// Whether `super.x` is currently legal.
    pub allow_super_property: bool,

    /// Whether `super()` is currently legal.
    pub allow_super_call: bool,

    /// How a `<` in expression position reads, when the caller said.
    pub jsx: Option<bool>,

    /// Whether a conditional type is currently out of reach — inside the
    /// `extends` type of an enclosing conditional.
    pub(crate) no_conditional_types: bool,

    /// Whether a line terminator preceded the token
    /// `kind_after_matching_paren()` last reported.
    pub(crate) newline_after_matching_paren: bool,
}

impl<'a> Parser<'a> {
    /// Creates a parser over a source text and scans the first token.
    pub fn new(source: &'a [u16], is_module: bool, jsx: Option<bool>) -> PRes<Self> {
        let mut tokenizer = Tokenizer::new(source, is_module);

        tokenizer.in_async = is_module;

        let mut parser = Parser {
            tokenizer,
            writer: NodeWriter::new(source.len()),
            source,
            in_async: is_module,
            in_generator: false,
            allow_in: true,
            allow_super_property: false,
            allow_super_call: false,
            jsx,
            no_conditional_types: false,
            newline_after_matching_paren: false,
        };

        parser.tokenizer.next()?;

        Ok(parser)
    }

    /// Runs a parse that may fail, undoing everything it wrote if it does.
    /// Returns `0` when the attempt failed, like the TypeScript original.
    pub(crate) fn speculate(
        &mut self,
        attempt: impl FnOnce(&mut Self) -> PRes,
    ) -> PRes {
        let state = self.tokenizer.save();
        let snapshot = self.writer.mark();

        match attempt(self) {
            Ok(node) => Ok(node),
            Err(_) => {
                self.writer.rewind(snapshot);
                self.tokenizer.restore(&state);

                Ok(0)
            }
        }
    }
}
