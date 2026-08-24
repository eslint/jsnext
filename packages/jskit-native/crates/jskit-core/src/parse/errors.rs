//! The error type produced for fatal syntax errors.
//!
//! Port of `packages/jskit/src/parse/errors.ts`, with `Result` in place of
//! exceptions.

use std::fmt;

/// A fatal syntax error detected during `parse()`.
#[derive(Debug, Clone)]
pub struct ParseError {
    /// A description of the problem, without position info.
    pub message: String,

    /// The 0-based offset in the source text where the error was detected.
    pub index: u32,

    /// The 1-based line number where the error was detected.
    pub line_number: u32,

    /// The 1-based column number where the error was detected.
    pub column: u32,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({}:{})", self.message, self.line_number, self.column)
    }
}

impl std::error::Error for ParseError {}

/// Converts a source offset into a 1-based line and column pair.
pub fn locate(line_starts: &[u32], line_count: usize, index: u32) -> (u32, u32) {
    let mut low = 0usize;
    let mut high = line_count - 1;

    // Binary search for the last line start at or before `index`.
    while low < high {
        let middle = (low + high + 1) >> 1;

        if line_starts[middle] <= index {
            low = middle;
        } else {
            high = middle - 1;
        }
    }

    ((low + 1) as u32, index - line_starts[low] + 1)
}
