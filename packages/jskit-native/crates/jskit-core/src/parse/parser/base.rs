//! Shared parser state, token plumbing, and small helpers.
//!
//! Port of `packages/jskit/src/parse/parser-base.ts`.

use super::{PRes, Parser};
use crate::parse::binary::{TF_HAS_ESCAPE, TF_LEGACY_OCTAL, TF_NEWLINE_BEFORE};
use crate::parse::errors::ParseError;
use crate::parse::node_kinds::*;
use crate::parse::token_kinds::*;
use crate::parse::values::decode_escapes;

impl<'a> Parser<'a> {
    //-------------------------------------------------------------------------
    // Token Access
    //-------------------------------------------------------------------------

    /// The kind of the current token.
    #[inline]
    pub fn kind(&self) -> u32 {
        self.tokenizer.kind
    }

    /// The start offset of the current token.
    #[inline]
    pub fn start(&self) -> u32 {
        self.tokenizer.start
    }

    /// The end offset of the current token.
    #[inline]
    pub fn end(&self) -> u32 {
        self.tokenizer.end
    }

    /// The end offset of the token before the current one.
    #[inline]
    pub fn last_end(&self) -> u32 {
        self.tokenizer.prev_end
    }

    /// Whether a line terminator precedes the current token.
    #[inline]
    pub fn newline_before(&self) -> bool {
        (self.tokenizer.flags & TF_NEWLINE_BEFORE) != 0
    }

    /// Advances to the next token.
    #[inline]
    pub fn next(&mut self) -> PRes<()> {
        self.tokenizer.next()
    }

    /// Tests the current token's kind.
    #[inline]
    pub fn at(&self, kind: u32) -> bool {
        self.tokenizer.kind == kind
    }

    /// Consumes the current token when it has the expected kind.
    pub fn eat(&mut self, kind: u32) -> PRes<bool> {
        if self.tokenizer.kind == kind {
            self.tokenizer.next()?;

            return Ok(true);
        }

        Ok(false)
    }

    /// Consumes the current token, which must have the expected kind.
    pub fn expect(&mut self, kind: u32) -> PRes<()> {
        if self.tokenizer.kind != kind {
            return Err(self.error(format!(
                "Expected '{}' but found '{}'",
                describe_kind(kind),
                self.token_text()
            )));
        }

        self.tokenizer.next()
    }

    /// Consumes a `{` and tells the scanner whether it opened a block.
    pub fn enter_brace(&mut self, is_block: bool) -> PRes<()> {
        self.tokenizer.mark_brace(is_block);
        self.tokenizer.next()
    }

    /// Consumes the `(` of a statement head.
    pub fn enter_statement_paren(&mut self) -> PRes<()> {
        self.tokenizer.mark_statement_paren();
        self.tokenizer.next()
    }

    /// The text of the current token, used only for error messages.
    pub fn token_text(&self) -> String {
        if self.tokenizer.kind == T_EOF {
            return "end of input".to_string();
        }

        String::from_utf16_lossy(
            &self.source[self.tokenizer.start as usize..self.tokenizer.end as usize],
        )
    }

    //-------------------------------------------------------------------------
    // Errors
    //-------------------------------------------------------------------------

    /// Creates a fatal syntax error at the current token.
    pub fn error(&self, message: impl Into<String>) -> ParseError {
        self.error_at(message, self.tokenizer.start)
    }

    /// Creates a fatal syntax error at an explicit offset.
    pub fn error_at(&self, message: impl Into<String>, index: u32) -> ParseError {
        self.tokenizer.error(message, index)
    }

    /// Creates a fatal error for a token that cannot appear here.
    pub fn unexpected(&self) -> ParseError {
        if self.tokenizer.prev_kind == T_AWAIT && !self.in_async {
            return self.error(
                "'await' is only an operator inside an async function, or at the top level of a module.",
            );
        }

        self.error(format!("Unexpected token '{}'", self.token_text()))
    }

    //-------------------------------------------------------------------------
    // Automatic Semicolon Insertion
    //-------------------------------------------------------------------------

    /// Whether a semicolon may be inserted before the current token.
    pub fn can_insert_semicolon(&self) -> bool {
        self.tokenizer.kind == T_EOF
            || self.tokenizer.kind == T_BRACE_CLOSE
            || self.newline_before()
    }

    /// Consumes a statement-terminating semicolon, inserting one if allowed.
    pub fn semicolon(&mut self) -> PRes<()> {
        if self.eat(T_SEMICOLON)? {
            return Ok(());
        }

        if !self.can_insert_semicolon() {
            return Err(self.unexpected());
        }

        Ok(())
    }

    //-------------------------------------------------------------------------
    // Identifiers and Literals
    //-------------------------------------------------------------------------

    /// Whether the current token can be used as a binding name.
    #[inline]
    pub fn at_binding_name(&self) -> bool {
        is_binding_name_kind(self.tokenizer.kind)
    }

    /// Parses an identifier used as a binding or reference.
    pub fn parse_identifier(&mut self) -> PRes {
        if !self.at_binding_name() {
            return Err(self.unexpected());
        }

        // A reserved word written with an escape is still that word.
        if (self.tokenizer.flags & TF_HAS_ESCAPE) != 0 {
            self.check_escaped_word(self.tokenizer.start, self.tokenizer.end)?;
        }

        let kind = self.tokenizer.kind;
        let node = self.writer.alloc(N_IDENTIFIER, self.tokenizer.start);
        let end = self.tokenizer.end;

        self.writer.set(node, NODE_A, end);

        // The tokenizer already knows whether this word is a keyword, and
        // `validate()` wants that answer back.
        if kind != T_IDENT {
            self.writer.add_flags(
                node,
                (KIND_IDWORD_CODES[kind as usize] as u32) << IDWORD_SHIFT,
            );
        } else if (self.tokenizer.flags & TF_HAS_ESCAPE) != 0 {
            self.writer.add_flags(node, NF_IDENTIFIER_ESCAPED);
        }

        self.tokenizer.next()?;

        Ok(self.writer.finish(node, end))
    }

    /// Rejects a reserved word that was written with an escape.
    pub fn check_escaped_word(&self, start: u32, end: u32) -> PRes<()> {
        let raw = &self.source[start as usize..end as usize];
        let name = decode_escapes(raw);
        let mut hash = 0i32;

        for &unit in &name {
            hash = hash_char(hash, unit as i32);
        }

        let kind = lookup_keyword(&name, 0, name.len(), hash);

        if (KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind)
            && (KIND_KEYWORD_FLAGS[kind as usize] & KW_RESERVED) != 0
        {
            return Err(self.error_at(
                format!(
                    "Keyword '{}' cannot be written with an escape sequence.",
                    String::from_utf16_lossy(&name)
                ),
                start,
            ));
        }

        Ok(())
    }

    /// Parses any identifier-like word, including reserved words, for use as
    /// a property name or member access.
    pub fn parse_identifier_name(&mut self) -> PRes {
        let kind = self.tokenizer.kind;

        if kind != T_IDENT && !(KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind) {
            return Err(self.unexpected());
        }

        self.tokenizer.demote_keyword_to_identifier();

        // The demote just rewrote the token's kind, so the word's identity is
        // handed down rather than read back.
        self.parse_word_as_identifier_kind(kind)
    }

    /// Consumes the current word as an `Identifier` without changing how it
    /// is reported in the token stream.
    pub fn parse_word_as_identifier(&mut self) -> PRes {
        let kind = self.tokenizer.kind;

        self.parse_word_as_identifier_kind(kind)
    }

    pub fn parse_word_as_identifier_kind(&mut self, kind: u32) -> PRes {
        let node = self.writer.alloc(N_IDENTIFIER, self.tokenizer.start);
        let end = self.tokenizer.end;

        // A type annotation extends an identifier's range past its name, so
        // the end of the name itself is recorded separately.
        self.writer.set(node, NODE_A, end);

        // Every word that reaches here is an `IdentifierName`.
        self.writer.add_flags(node, NF_IDENTIFIER_NAME);

        if kind != T_IDENT {
            self.writer.add_flags(
                node,
                (KIND_IDWORD_CODES[kind as usize] as u32) << IDWORD_SHIFT,
            );
        } else if (self.tokenizer.flags & TF_HAS_ESCAPE) != 0 {
            self.writer.add_flags(node, NF_IDENTIFIER_ESCAPED);
        }

        self.tokenizer.next()?;

        Ok(self.writer.finish(node, end))
    }

    /// Parses a `#name` private identifier.
    pub fn parse_private_identifier(&mut self) -> PRes {
        if self.tokenizer.kind != T_PRIVATE_IDENT {
            return Err(self.unexpected());
        }

        let node = self.writer.alloc(N_PRIVATE_IDENTIFIER, self.tokenizer.start);
        let end = self.tokenizer.end;

        self.tokenizer.next()?;

        Ok(self.writer.finish(node, end))
    }

    /// Whether the current token starts a literal value.
    pub fn at_literal(&self) -> bool {
        let kind = self.tokenizer.kind;

        kind == T_STRING
            || kind == T_NUMBER
            || kind == T_BIGINT
            || kind == T_REGEXP
            || kind == T_TRUE
            || kind == T_FALSE
            || kind == T_NULL
    }

    /// Parses a literal token into a `Literal` node.
    pub fn parse_literal(&mut self) -> PRes {
        let kind = self.tokenizer.kind;
        let subtype = match kind {
            k if k == T_STRING => LIT_STRING,
            k if k == T_NUMBER => LIT_NUMBER,
            k if k == T_BIGINT => LIT_BIGINT,
            k if k == T_REGEXP => LIT_REGEXP,
            k if k == T_TRUE || k == T_FALSE => LIT_BOOLEAN,
            k if k == T_NULL => LIT_NULL,
            _ => return Err(self.unexpected()),
        };

        let node = self.writer.alloc(N_LITERAL, self.tokenizer.start);
        let end = self.tokenizer.end;

        self.writer.set(node, NODE_A, subtype);

        // `01` and `"\1"` are legal in sloppy code and not in strict; what
        // the tokenizer saw is carried across for `validate()` to judge.
        if (self.tokenizer.flags & TF_LEGACY_OCTAL) != 0 {
            self.writer.add_flags(node, NF_LEGACY_OCTAL);
        }

        // Regular expressions record where the pattern ends so that the
        // pattern and flags can be split apart without rescanning.
        if subtype == LIT_REGEXP {
            self.writer.set(node, NODE_B, self.tokenizer.extra);
        }

        self.tokenizer.next()?;

        Ok(self.writer.finish(node, end))
    }
}
