//! The parser: tokenizer, parser chain, and binary parse buffer.
//!
//! Port of `packages/jskit/src/parse/` — the `parse()` phase only. The
//! validation, ESTree decoding, and reading layers stay in TypeScript; they
//! consume the buffer this module produces.

pub mod api;
pub mod binary;
pub mod chars;
pub mod errors;
pub mod node_kinds;
pub mod node_writer;
pub mod parser;
pub mod regexp;
pub mod slots;
pub mod token_kinds;
pub mod tokenizer;
pub mod unicode_properties;
pub mod validator;
pub mod values;

pub use api::{parse, ParseOptions, SourceType};
pub use errors::ParseError;
pub use validator::{validate_ast, ValidateSourceType, ValidationProblem};
