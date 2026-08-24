//! The options an analysis runs with.
//!
//! Port of `packages/jskit/src/scope/options.ts`, with every default filled
//! in. Names are UTF-16 code units, because they are compared against and
//! interned beside names sliced from the source text.

use super::buffer::*;

/// Whether the program is a script, an ES module, or a CommonJS module.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum ScopeSourceType {
    Script,
    #[default]
    Module,
    CommonJs,
}

/// The analysis options with every default filled in.
#[derive(Clone, Default)]
pub struct ResolvedOptions {
    pub source_type: ScopeSourceType,

    /// Whether TypeScript syntax carries meaning (`dialect: "ts"`).
    pub dialect_ts: bool,

    /// Whether a JSX identifier counts as a reference.
    pub jsx: bool,

    /// Whether strict mode applies without a directive saying so.
    pub implied_strict: bool,

    /// Whether an extra function scope wraps the program.
    pub global_return: bool,

    /// Whether a direct call to `eval` should be ignored.
    pub ignore_eval: bool,

    /// Names to declare in the global scope, or `None`.
    pub globals: Option<Vec<Vec<u16>>>,

    /// The name a JSX element compiles a call to, or `None`.
    pub jsx_pragma: Option<Vec<u16>>,

    /// The name a JSX fragment compiles a call to, or `None`.
    pub jsx_fragment_name: Option<Vec<u16>>,
}

impl ResolvedOptions {
    /// The TypeScript defaults: `sourceType: "module"`, `dialect: "ts"`,
    /// `jsx: true`, everything else off.
    pub fn defaults() -> Self {
        ResolvedOptions {
            source_type: ScopeSourceType::Module,
            dialect_ts: true,
            jsx: true,
            implied_strict: false,
            global_return: false,
            ignore_eval: false,
            globals: None,
            jsx_pragma: None,
            jsx_fragment_name: None,
        }
    }

    /// The `SCOPE_H_OPTIONS` header word.
    pub fn encoded(&self) -> u32 {
        (match self.source_type {
            ScopeSourceType::Module => OPT_SOURCE_TYPE_MODULE,
            ScopeSourceType::CommonJs => OPT_SOURCE_TYPE_COMMONJS,
            ScopeSourceType::Script => OPT_SOURCE_TYPE_SCRIPT,
        }) | (if self.dialect_ts { OPT_DIALECT_TS } else { 0 })
            | (if self.jsx { OPT_JSX } else { 0 })
            | (if self.implied_strict { OPT_IMPLIED_STRICT } else { 0 })
            | (if self.global_return { OPT_GLOBAL_RETURN } else { 0 })
            | (if self.ignore_eval { OPT_IGNORE_EVAL } else { 0 })
    }
}
