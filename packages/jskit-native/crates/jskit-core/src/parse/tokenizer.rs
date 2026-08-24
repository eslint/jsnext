//! The scanner that turns source text into binary token records.
//!
//! Port of `packages/jskit/src/parse/tokenizer.ts`. The tokenizer is driven
//! by the parser one token at a time; every token scanned — comments
//! included — is appended to a growable word buffer in source order.

use super::binary::{
    TF_HAS_ESCAPE, TF_INVALID_ESCAPE, TF_LEGACY_OCTAL, TF_NEWLINE_BEFORE, WordBuffer,
};
use super::chars::*;
use super::errors::{locate, ParseError};
use super::token_kinds::*;

/// A `{` that opened a statement block; an expression may follow its `}`.
const CTX_BLOCK: u8 = 1;

/// A `{` that opened an object literal or class body.
const CTX_OBJECT: u8 = 2;

/// A `(` that belongs to `if`, `while`, `for`, `with`, or `switch`.
const CTX_PAREN_STMT: u8 = 3;

/// A `(` that opened a parenthesized expression or argument list.
const CTX_PAREN_EXPR: u8 = 4;

/// A `${` inside a template literal.
const CTX_TEMPLATE: u8 = 5;

/// Words per token record.
const TOKEN_WORDS: usize = 4;

/// The token kinds `update_context()` treats specially, indexed by kind.
const CONTEXT_SPECIAL: [u8; 256] = build_context_special();

const fn build_context_special() -> [u8; 256] {
    let mut table = [0u8; 256];
    let kinds = [
        T_PAREN_CLOSE,
        T_BRACE_CLOSE,
        T_PLUS_PLUS,
        T_MINUS_MINUS,
        T_YIELD,
        T_AWAIT,
        T_OF,
    ];
    let mut i = 0;

    while i < kinds.len() {
        table[kinds[i] as usize] = 1;
        i += 1;
    }

    table
}

/// Token kinds for the punctuators that are one character long no matter what
/// follows, indexed by character code.
const SIMPLE_PUNCTUATORS: [u8; 128] = build_simple_punctuators();

const fn build_simple_punctuators() -> [u8; 128] {
    let mut table = [0u8; 128];

    table[CH_PAREN_CLOSE as usize] = T_PAREN_CLOSE as u8;
    table[CH_BRACKET_OPEN as usize] = T_BRACKET_OPEN as u8;
    table[CH_BRACKET_CLOSE as usize] = T_BRACKET_CLOSE as u8;
    table[CH_SEMICOLON as usize] = T_SEMICOLON as u8;
    table[CH_COMMA as usize] = T_COMMA as u8;
    table[CH_COLON as usize] = T_COLON as u8;
    table[CH_AT as usize] = T_AT as u8;
    table[CH_TILDE as usize] = T_TILDE as u8;

    table
}

/// The largest code point a `\u{...}` escape may name.
const MAX_CODE_POINT: u32 = 0x10ffff;

/// Reads one hexadecimal digit, which the caller has already classified.
#[inline]
fn hex_value(code: i32) -> u32 {
    if code <= CH_9 {
        (code - CH_0) as u32
    } else {
        ((code | 0x20) - CH_A_LOWER + 10) as u32
    }
}

pub type ScanResult<T = ()> = Result<T, ParseError>;

/// A snapshot of tokenizer state, used to rewind after speculative scanning.
#[derive(Clone, Copy)]
pub struct TokenizerState {
    pos: usize,
    count: u32,
    kind: u32,
    start: u32,
    end: u32,
    flags: u32,
    extra: u32,
    prev_kind: u32,
    prev_end: u32,
    expr_allowed: bool,
    context_depth: usize,
    line_count: u32,
}

/// Scans source text into binary token records.
pub struct Tokenizer<'a> {
    /// The source text being scanned, as UTF-16 code units.
    pub source: &'a [u16],

    /// Length of the source text.
    pub length: usize,

    /// The offset of the next character to read.
    pub pos: usize,

    /// Token records, four words each.
    pub records: WordBuffer,

    /// Number of complete token records written.
    pub count: u32,

    /// Offsets at which each line begins; `line_count` entries are valid.
    pub line_starts: Vec<u32>,

    /// Number of valid entries in `line_starts`.
    pub line_count: u32,

    /// Kind of the current token.
    pub kind: u32,

    /// Start offset of the current token.
    pub start: u32,

    /// End offset of the current token.
    pub end: u32,

    /// Flags of the current token.
    pub flags: u32,

    /// Auxiliary data for the current token; meaning depends on the kind.
    pub extra: u32,

    /// Kind of the token before the current one, ignoring comments.
    pub prev_kind: u32,

    /// End offset of the token before the current one.
    pub prev_end: u32,

    /// Whether a `/` at the current position begins a regular expression.
    pub expr_allowed: bool,

    /// Whether the scanner is inside the angle brackets of a JSX tag.
    pub in_jsx_tag: bool,

    /// Whether the parser is currently inside a generator function body.
    pub in_generator: bool,

    /// Whether the parser is currently inside an async function body.
    pub in_async: bool,

    /// Whether the text is being read as an ES module.
    pub is_module: bool,

    /// Stack of open braces, parentheses, and template substitutions.
    context: Vec<u8>,

    /// Number of entries on the context stack.
    context_depth: usize,

    /// Whether a line terminator preceded the token `peek()` last scanned.
    pub peek_newline_before: bool,

    // The one-token lookahead cache; see the TypeScript source for why the
    // guards below are complete. `peek_pos` of `None` means no cache.
    peek_pos: Option<usize>,
    peek_expr_allowed: bool,
    peek_context_depth: usize,
    peek_context_top: u8,
    peek_in_jsx_tag: bool,
    peek_kind: u32,
    peek_start: u32,
    peek_flags: u32,
    peek_extra: u32,
    peek_end_pos: usize,
    peek_line_count: u32,
    peek_count: u32,
    peek_records_length: usize,
    peek_context_after_depth: usize,
    peek_context_after_top: u8,
}

impl<'a> Tokenizer<'a> {
    /// Creates a tokenizer for a source text and scans the hashbang, if any.
    /// The caller must invoke `next()` once before reading the first token,
    /// exactly as the TypeScript constructor does.
    pub fn new(source: &'a [u16], is_module: bool) -> Self {
        let length = source.len();
        let mut tokenizer = Tokenizer {
            source,
            length,
            pos: 0,
            records: WordBuffer::new(1024usize.max(((length * 3) >> 3) * TOKEN_WORDS)),
            count: 0,
            line_starts: vec![0; 64usize.max(length >> 4)],
            line_count: 1,
            kind: T_EOF,
            start: 0,
            end: 0,
            flags: 0,
            extra: 0,
            prev_kind: T_EOF,
            prev_end: 0,
            expr_allowed: true,
            in_jsx_tag: false,
            in_generator: false,
            in_async: false,
            is_module,
            context: vec![0; 256],
            context_depth: 0,
            peek_newline_before: false,
            peek_pos: None,
            peek_expr_allowed: false,
            peek_context_depth: 0,
            peek_context_top: 0,
            peek_in_jsx_tag: false,
            peek_kind: T_EOF,
            peek_start: 0,
            peek_flags: 0,
            peek_extra: 0,
            peek_end_pos: 0,
            peek_line_count: 0,
            peek_count: 0,
            peek_records_length: 0,
            peek_context_after_depth: 0,
            peek_context_after_top: 0,
        };

        // A byte order mark is not part of the program text.
        if tokenizer.cc(0) == CH_BOM {
            tokenizer.pos = 1;
        }

        tokenizer.scan_hashbang();

        tokenizer
    }

    /// The character code at an offset, `-1` past the end of the input, which
    /// compares the way JavaScript's `NaN` does everywhere the scanner looks.
    #[inline]
    fn cc(&self, i: usize) -> i32 {
        if i < self.length {
            self.source[i] as i32
        } else {
            -1
        }
    }

    /// The code point at an offset, combining a surrogate pair.
    fn cp(&self, i: usize) -> u32 {
        let unit = self.source[i] as u32;

        if (0xd800..0xdc00).contains(&unit) && i + 1 < self.length {
            let next = self.source[i + 1] as u32;

            if (0xdc00..0xe000).contains(&next) {
                return 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
            }
        }

        unit
    }

    //-------------------------------------------------------------------------
    // Errors
    //-------------------------------------------------------------------------

    /// Creates a fatal syntax error positioned at a source offset.
    pub fn error(&self, message: impl Into<String>, index: u32) -> ParseError {
        let (line, column) = locate(&self.line_starts, self.line_count as usize, index);

        ParseError {
            message: message.into(),
            index,
            line_number: line,
            column,
        }
    }

    //-------------------------------------------------------------------------
    // State Management
    //-------------------------------------------------------------------------

    /// Captures the current state so that speculative scanning can be undone.
    pub fn save(&self) -> TokenizerState {
        TokenizerState {
            pos: self.pos,
            count: self.count,
            kind: self.kind,
            start: self.start,
            end: self.end,
            flags: self.flags,
            extra: self.extra,
            prev_kind: self.prev_kind,
            prev_end: self.prev_end,
            expr_allowed: self.expr_allowed,
            context_depth: self.context_depth,
            line_count: self.line_count,
        }
    }

    /// Restores a snapshot taken by `save()`.
    pub fn restore(&mut self, state: &TokenizerState) {
        self.pos = state.pos;
        self.count = state.count;
        self.records.length = state.count as usize * TOKEN_WORDS;
        self.kind = state.kind;
        self.start = state.start;
        self.end = state.end;
        self.flags = state.flags;
        self.extra = state.extra;
        self.prev_kind = state.prev_kind;
        self.prev_end = state.prev_end;
        self.expr_allowed = state.expr_allowed;
        self.context_depth = state.context_depth;
        self.line_count = state.line_count;
    }

    /// Reads the kind of the token after the current one without advancing.
    pub fn peek(&mut self) -> ScanResult<u32> {
        // A second peek from the same spot reads the cache like next() does.
        if self.peek_usable() {
            self.peek_newline_before = (self.peek_flags & TF_NEWLINE_BEFORE) != 0;

            return Ok(self.peek_kind);
        }

        let pos = self.pos;
        let count = self.count;
        let records_length = self.records.length;
        let line_count = self.line_count;
        let kind = self.kind;
        let start = self.start;
        let end = self.end;
        let flags = self.flags;
        let extra = self.extra;
        let context_depth = self.context_depth;

        self.peek_pos = None;

        let token_flags = self.skip_trivia()?;
        let mut peeked = T_EOF;

        if self.pos < self.length {
            self.flags = token_flags;
            self.extra = 0;
            self.start = self.pos as u32;

            let scanned = self.scan_token();

            // Roll the scanner back before propagating a failure, exactly as
            // the TypeScript version's caller-visible state demands.
            if let Err(error) = scanned {
                self.pos = pos;
                self.count = count;
                self.records.length = records_length;
                self.line_count = line_count;
                self.kind = kind;
                self.start = start;
                self.end = end;
                self.flags = flags;
                self.extra = extra;
                self.context_depth = context_depth;

                return Err(error);
            }

            peeked = self.kind;

            self.peek_pos = Some(pos);
            self.peek_expr_allowed = self.expr_allowed;
            self.peek_context_depth = context_depth;
            self.peek_context_top = if context_depth == 0 {
                0
            } else {
                self.context[context_depth - 1]
            };
            self.peek_in_jsx_tag = self.in_jsx_tag;
            self.peek_kind = peeked;
            self.peek_start = self.start;
            self.peek_flags = self.flags;
            self.peek_extra = self.extra;
            self.peek_end_pos = self.pos;
            self.peek_line_count = self.line_count;

            self.peek_context_after_depth = self.context_depth;
            self.peek_context_after_top = if self.context_depth == 0 {
                0
            } else {
                self.context[self.context_depth - 1]
            };

            self.peek_count = self.count;
            self.peek_records_length = self.records.length;
        }

        self.peek_newline_before = (token_flags & TF_NEWLINE_BEFORE) != 0;

        self.pos = pos;
        self.count = count;
        self.records.length = records_length;
        self.line_count = line_count;
        self.kind = kind;
        self.start = start;
        self.end = end;
        self.flags = flags;
        self.extra = extra;
        self.context_depth = context_depth;

        Ok(peeked)
    }

    /// Determines whether the cached peek still describes the next token.
    fn peek_usable(&self) -> bool {
        self.peek_pos == Some(self.pos)
            && self.peek_expr_allowed == self.expr_allowed
            && self.peek_context_depth == self.context_depth
            && (self.context_depth == 0
                || self.peek_context_top == self.context[self.context_depth - 1])
            && self.peek_in_jsx_tag == self.in_jsx_tag
    }

    /// Tells the tokenizer which kind of `{` was just consumed.
    pub fn mark_brace(&mut self, is_block: bool) {
        if self.context_depth > 0 {
            self.context[self.context_depth - 1] =
                if is_block { CTX_BLOCK } else { CTX_OBJECT };
        }
    }

    /// Tells the tokenizer the `(` just consumed belongs to a statement head.
    pub fn mark_statement_paren(&mut self) {
        if self.context_depth > 0 {
            self.context[self.context_depth - 1] = CTX_PAREN_STMT;
        }
    }

    //-------------------------------------------------------------------------
    // Line Tracking
    //-------------------------------------------------------------------------

    /// Records the start of a new line.
    fn add_line(&mut self, offset: usize) {
        if self.line_count as usize == self.line_starts.len() {
            let grown = self.line_starts.len() * 2;

            self.line_starts.resize(grown, 0);
        }

        self.line_starts[self.line_count as usize] = offset as u32;
        self.line_count += 1;
    }

    //-------------------------------------------------------------------------
    // Token Recording
    //-------------------------------------------------------------------------

    /// Appends a token record to the buffer.
    fn record(&mut self, kind: u32, start: u32, end: u32, flags: u32, extra: u32) {
        let index = self.records.reserve(TOKEN_WORDS);

        self.records.words[index] = start;
        self.records.words[index + 1] = end;
        self.records.words[index + 2] = kind | (flags << 16);
        self.records.words[index + 3] = extra;

        self.count += 1;
    }

    //-------------------------------------------------------------------------
    // Scanning
    //-------------------------------------------------------------------------

    /// Scans a `#!` comment, legal only as the very first thing in the text.
    fn scan_hashbang(&mut self) {
        if self.pos + 1 < self.length
            && self.cc(self.pos) == CH_HASH
            && self.cc(self.pos + 1) == CH_BANG
        {
            let start = self.pos;

            self.pos += 2;

            while self.pos < self.length {
                let code = self.cc(self.pos);

                if code == CH_LF
                    || code == CH_CR
                    || code == CH_LINE_SEPARATOR
                    || code == CH_PARAGRAPH_SEPARATOR
                {
                    break;
                }

                self.pos += 1;
            }

            self.record(T_HASHBANG, start as u32, self.pos as u32, 0, 0);
        }
    }

    /// Skips whitespace and comments, recording comment tokens as it goes.
    /// Returns the flags that apply to the next token.
    fn skip_trivia(&mut self) -> ScanResult<u32> {
        let mut token_flags = 0u32;

        while self.pos < self.length {
            let code = self.source[self.pos] as i32;

            if code < ASCII_LIMIT {
                let classification = CHAR_FLAGS[code as usize];

                if (classification & MASK_SPACE) != 0 {
                    self.pos += 1;
                    continue;
                }

                if (classification & MASK_NEWLINE) != 0 {
                    self.pos += 1;

                    // Treat CRLF as a single line break.
                    if code == CH_CR && self.cc(self.pos) == CH_LF {
                        self.pos += 1;
                    }

                    self.add_line(self.pos);
                    token_flags |= TF_NEWLINE_BEFORE;
                    continue;
                }

                if code == CH_SLASH {
                    let next = self.cc(self.pos + 1);

                    if next == CH_SLASH {
                        self.scan_line_comment(2);
                        continue;
                    }

                    if next == CH_STAR {
                        if self.scan_block_comment()? {
                            token_flags |= TF_NEWLINE_BEFORE;
                        }

                        continue;
                    }
                }

                // Annex B's HTML-like comments, which exist only in script
                // code — in a module `<!--` is three operators and `-->` two.
                if (code == CH_LT || code == CH_MINUS) && !self.is_module {
                    if code == CH_LT
                        && self.cc(self.pos + 1) == CH_BANG
                        && self.cc(self.pos + 2) == CH_MINUS
                        && self.cc(self.pos + 3) == CH_MINUS
                    {
                        self.scan_line_comment(4);
                        continue;
                    }

                    if code == CH_MINUS
                        && self.cc(self.pos + 1) == CH_MINUS
                        && self.cc(self.pos + 2) == CH_GT
                        && (self.prev_end == 0 || (token_flags & TF_NEWLINE_BEFORE) != 0)
                    {
                        self.scan_line_comment(3);
                        continue;
                    }
                }

                break;
            }

            if code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR {
                self.pos += 1;
                self.add_line(self.pos);
                token_flags |= TF_NEWLINE_BEFORE;
                continue;
            }

            if is_non_ascii_space(code) {
                self.pos += 1;
                continue;
            }

            break;
        }

        Ok(token_flags)
    }

    /// Scans a comment that ends at the next line terminator.
    fn scan_line_comment(&mut self, opener_length: usize) {
        let start = self.pos;

        self.pos += opener_length;

        while self.pos < self.length {
            let code = self.source[self.pos] as i32;

            if code == CH_LF
                || code == CH_CR
                || code == CH_LINE_SEPARATOR
                || code == CH_PARAGRAPH_SEPARATOR
            {
                break;
            }

            self.pos += 1;
        }

        self.record(T_LINE_COMMENT, start as u32, self.pos as u32, 0, 0);
    }

    /// Scans a `/* ... */` comment; `true` when it contained a line break.
    fn scan_block_comment(&mut self) -> ScanResult<bool> {
        let start = self.pos;
        let mut saw_newline = false;

        self.pos += 2;

        loop {
            if self.pos >= self.length {
                return Err(self.error("Unterminated comment", start as u32));
            }

            let code = self.source[self.pos] as i32;

            if code == CH_STAR && self.cc(self.pos + 1) == CH_SLASH {
                self.pos += 2;
                break;
            }

            if code == CH_LF
                || code == CH_CR
                || code == CH_LINE_SEPARATOR
                || code == CH_PARAGRAPH_SEPARATOR
            {
                self.pos += 1;

                if code == CH_CR && self.cc(self.pos) == CH_LF {
                    self.pos += 1;
                }

                self.add_line(self.pos);
                saw_newline = true;
                continue;
            }

            self.pos += 1;
        }

        self.record(T_BLOCK_COMMENT, start as u32, self.pos as u32, 0, 0);

        Ok(saw_newline)
    }

    /// Advances to the next significant token, recording it and any comments
    /// that precede it.
    pub fn next(&mut self) -> ScanResult {
        self.prev_kind = self.kind;
        self.prev_end = self.end;

        // When a `peek()` already scanned this very token, advancing is a
        // matter of moving its result into place.
        if self.peek_usable() {
            self.pos = self.peek_end_pos;
            self.count = self.peek_count;
            self.records.length = self.peek_records_length;
            self.line_count = self.peek_line_count;
            self.kind = self.peek_kind;
            self.start = self.peek_start;
            self.end = self.peek_end_pos as u32;
            self.flags = self.peek_flags;
            self.extra = self.peek_extra;
            self.context_depth = self.peek_context_after_depth;

            if self.peek_context_after_depth > 0 {
                self.context[self.peek_context_after_depth - 1] = self.peek_context_after_top;
            }

            self.peek_pos = None;
            self.record(self.kind, self.start, self.end, self.flags, self.extra);
            self.update_context();

            return Ok(());
        }

        self.peek_pos = None;

        let token_flags = self.skip_trivia()?;

        self.flags = token_flags;
        self.extra = 0;
        self.start = self.pos as u32;

        if self.pos >= self.length {
            self.kind = T_EOF;
            self.end = self.pos as u32;
            self.record(T_EOF, self.pos as u32, self.pos as u32, self.flags, 0);
            self.expr_allowed = false;

            return Ok(());
        }

        self.scan_token()?;
        self.end = self.pos as u32;
        self.record(self.kind, self.start, self.end, self.flags, self.extra);
        self.update_context();

        Ok(())
    }

    /// Reads a single token starting at the current position.
    fn scan_token(&mut self) -> ScanResult {
        let code = self.source[self.pos] as i32;

        // Identifiers and keywords are by far the most common tokens.
        if code < ASCII_LIMIT {
            let classification = CHAR_FLAGS[code as usize];

            if (classification & MASK_ID_START) != 0 {
                return self.scan_identifier();
            }

            if (classification & MASK_DIGIT) != 0 {
                return self.scan_number();
            }

            let simple = SIMPLE_PUNCTUATORS[code as usize];

            if simple != 0 {
                self.pos += 1;
                self.kind = simple as u32;

                return Ok(());
            }
        } else if is_non_ascii_id_start(self.cp(self.pos)) {
            return self.scan_identifier();
        }

        match code {
            c if c == CH_QUOTE_DOUBLE || c == CH_QUOTE_SINGLE => self.scan_string(code),
            c if c == CH_BACKTICK => {
                self.pos += 1;
                self.scan_template_part(self.start as usize, true)
            }
            c if c == CH_DOT => {
                let next = self.cc(self.pos + 1);

                if (char_flags(next) & MASK_DIGIT) != 0 {
                    return self.scan_number();
                }

                if next == CH_DOT && self.cc(self.pos + 2) == CH_DOT {
                    self.pos += 3;
                    self.kind = T_ELLIPSIS;

                    return Ok(());
                }

                self.pos += 1;
                self.kind = T_DOT;

                Ok(())
            }
            c if c == CH_SLASH => self.scan_slash(),
            c if c == CH_HASH => self.scan_private_identifier(),
            // An identifier may begin with a unicode escape sequence.
            c if c == CH_BACKSLASH => self.scan_identifier(),
            _ => self.scan_punctuator(code),
        }
    }

    /// Scans an identifier, keyword, or escaped identifier.
    fn scan_identifier(&mut self) -> ScanResult {
        let start = self.pos;
        let mut hash = 0i32;
        let mut has_escape = false;

        while self.pos < self.length {
            let code = self.source[self.pos] as i32;

            if code < ASCII_LIMIT {
                if (CHAR_FLAGS[code as usize] & MASK_ID_PART) != 0 {
                    hash = hash_char(hash, code);
                    self.pos += 1;
                    continue;
                }

                if code == CH_BACKSLASH {
                    has_escape = true;
                    self.scan_identifier_escape(self.pos == start)?;
                    continue;
                }

                break;
            }

            let point = self.cp(self.pos);

            if !is_non_ascii_id_part(point) {
                break;
            }

            hash = hash_char(hash, code);
            self.pos += if point > 0xffff { 2 } else { 1 };
        }

        if has_escape {
            // A word written with escapes is never a keyword.
            self.flags |= TF_HAS_ESCAPE;
            self.kind = T_IDENT;

            return Ok(());
        }

        self.kind = lookup_keyword(self.source, start, self.pos, hash);

        Ok(())
    }

    /// Consumes a `\uXXXX` or `\u{...}` escape inside an identifier.
    fn scan_identifier_escape(&mut self, at_start: bool) -> ScanResult {
        let escape_start = self.pos;

        if self.cc(self.pos + 1) != CH_U_LOWER {
            return Err(self.error(
                "Invalid escape sequence in identifier",
                escape_start as u32,
            ));
        }

        self.pos += 2;

        let mut point: u32 = 0;

        if self.cc(self.pos) == CH_BRACE_OPEN {
            self.pos += 1;

            let digits_start = self.pos;

            while self.pos < self.length
                && (char_flags(self.cc(self.pos)) & MASK_HEX_DIGIT) != 0
            {
                point = point * 16 + hex_value(self.cc(self.pos));

                // Held down so a long run of digits cannot lose precision.
                if point > MAX_CODE_POINT {
                    point = MAX_CODE_POINT + 1;
                }

                self.pos += 1;
            }

            if self.pos == digits_start || self.cc(self.pos) != CH_BRACE_CLOSE {
                return Err(self.error(
                    "Invalid escape sequence in identifier",
                    escape_start as u32,
                ));
            }

            self.pos += 1;
        } else {
            for _ in 0..4 {
                let code = self.cc(self.pos);

                if code >= ASCII_LIMIT || (char_flags(code) & MASK_HEX_DIGIT) == 0 {
                    return Err(self.error(
                        "Invalid escape sequence in identifier",
                        escape_start as u32,
                    ));
                }

                point = point * 16 + hex_value(code);
                self.pos += 1;
            }
        }

        let legal = if point < ASCII_LIMIT as u32 {
            (CHAR_FLAGS[point as usize]
                & (if at_start { MASK_ID_START } else { MASK_ID_PART }))
                != 0
        } else {
            point <= MAX_CODE_POINT
                && (if at_start {
                    is_non_ascii_id_start(point)
                } else {
                    is_non_ascii_id_part(point)
                })
        };

        if !legal {
            return Err(self.error(
                "Invalid escape sequence in identifier",
                escape_start as u32,
            ));
        }

        Ok(())
    }

    /// Scans a `#name` private identifier.
    fn scan_private_identifier(&mut self) -> ScanResult {
        let start = self.pos;

        self.pos += 1;

        let code = self.cc(self.pos);
        let is_start = if (0..ASCII_LIMIT).contains(&code) {
            (CHAR_FLAGS[code as usize] & MASK_ID_START) != 0 || code == CH_BACKSLASH
        } else if self.pos < self.length {
            is_non_ascii_id_start(self.cp(self.pos))
        } else {
            false
        };

        if !is_start {
            return Err(self.error("Unexpected character '#'", start as u32));
        }

        self.scan_identifier()?;
        self.kind = T_PRIVATE_IDENT;

        Ok(())
    }

    /// Scans a numeric literal in any of its forms.
    fn scan_number(&mut self) -> ScanResult {
        let start = self.pos;
        let code = self.source[self.pos] as i32;

        self.kind = T_NUMBER;

        if code == CH_0 {
            let next = self.cc(self.pos + 1);

            if next == CH_X_LOWER || next == CH_X_UPPER {
                self.pos += 2;
                self.scan_digits(MASK_HEX_DIGIT, 16)?;

                return self.finish_number();
            }

            if next == CH_O_LOWER || next == CH_O_UPPER {
                self.pos += 2;
                self.scan_digits(MASK_DIGIT, 8)?;

                return self.finish_number();
            }

            if next == CH_B_LOWER || next == CH_B_UPPER {
                self.pos += 2;
                self.scan_digits(MASK_DIGIT, 2)?;

                return self.finish_number();
            }

            // `DecimalIntegerLiteral` admits a separator only after a
            // `NonZeroDigit`, so a lone `0` ends the integer part.
            if next == CH_UNDERSCORE {
                return Err(self.error(
                    "Numeric separator is not allowed after a leading 0",
                    (self.pos + 1) as u32,
                ));
            }

            // A leading zero followed by more digits is a legacy octal or a
            // non-octal decimal literal; both are recorded for `validate()`.
            if (char_flags(next) & MASK_DIGIT) != 0 {
                let mut octal = true;

                self.pos += 1;

                while (char_flags(self.cc(self.pos)) & MASK_DIGIT) != 0 {
                    if self.cc(self.pos) > CH_7 {
                        octal = false;
                    }

                    self.pos += 1;
                }

                self.flags |= TF_LEGACY_OCTAL;

                if !octal {
                    self.scan_fraction_and_exponent(start)?;
                }

                return self.check_number_boundary();
            }
        }

        self.scan_decimal_digits()?;

        if self.cc(self.pos) == CH_N_LOWER {
            self.pos += 1;
            self.kind = T_BIGINT;

            return self.check_number_boundary();
        }

        self.scan_fraction_and_exponent(start)?;
        self.check_number_boundary()
    }

    /// Consumes the fraction and the exponent of a decimal literal.
    fn scan_fraction_and_exponent(&mut self, start: usize) -> ScanResult {
        let mut code = self.cc(self.pos);

        if code == CH_DOT {
            self.pos += 1;
            self.scan_decimal_digits()?;

            code = self.cc(self.pos);
        }

        if code != CH_E_LOWER && code != CH_E_UPPER {
            return Ok(());
        }

        self.pos += 1;

        let sign = self.cc(self.pos);

        if sign == CH_PLUS || sign == CH_MINUS {
            self.pos += 1;
        }

        if (char_flags(self.cc(self.pos)) & MASK_DIGIT) == 0 {
            return Err(self.error("Invalid number", start as u32));
        }

        self.scan_decimal_digits()
    }

    /// Consumes a run of decimal digits, with `_` allowed between two.
    fn scan_decimal_digits(&mut self) -> ScanResult {
        while (char_flags(self.cc(self.pos)) & MASK_DIGIT) != 0 {
            self.pos += 1;

            if self.cc(self.pos) != CH_UNDERSCORE {
                continue;
            }

            self.pos += 1;

            if (char_flags(self.cc(self.pos)) & MASK_DIGIT) == 0 {
                return Err(self.error(
                    "Numeric separator must be between two digits",
                    (self.pos - 1) as u32,
                ));
            }
        }

        Ok(())
    }

    /// Consumes the digits of a radix-prefixed numeric literal.
    fn scan_digits(&mut self, mask: u8, radix: i32) -> ScanResult {
        let start = self.pos;

        loop {
            let code = self.cc(self.pos);

            // A separator has to sit between two digits.
            if code == CH_UNDERSCORE {
                let next = self.cc(self.pos + 1);

                if self.pos == start
                    || next >= ASCII_LIMIT
                    || (char_flags(next) & mask) == 0
                    || (radix < 10 && next - CH_0 >= radix)
                {
                    break;
                }

                self.pos += 1;
                continue;
            }

            if code >= ASCII_LIMIT || (char_flags(code) & mask) == 0 {
                break;
            }

            if radix < 10 && code - CH_0 >= radix {
                break;
            }

            self.pos += 1;
        }

        if self.pos == start {
            return Err(self.error("Invalid number", (start - 2) as u32));
        }

        Ok(())
    }

    /// Applies the optional `n` suffix and checks what follows the literal.
    fn finish_number(&mut self) -> ScanResult {
        if self.cc(self.pos) == CH_N_LOWER {
            self.pos += 1;
            self.kind = T_BIGINT;
        }

        self.check_number_boundary()
    }

    /// Rejects a numeric literal that runs directly into an identifier.
    fn check_number_boundary(&mut self) -> ScanResult {
        if self.pos >= self.length {
            return Ok(());
        }

        let code = self.source[self.pos] as i32;
        let is_identifier_char = if code < ASCII_LIMIT {
            (CHAR_FLAGS[code as usize] & MASK_ID_PART) != 0
        } else {
            is_non_ascii_id_start(self.cp(self.pos))
        };

        if is_identifier_char {
            return Err(self.error("Identifier directly after number", self.pos as u32));
        }

        Ok(())
    }

    /// Scans a single- or double-quoted string literal.
    fn scan_string(&mut self, quote: i32) -> ScanResult {
        let start = self.pos;

        self.pos += 1;

        loop {
            if self.pos >= self.length {
                return Err(self.error("Unterminated string constant", start as u32));
            }

            let code = self.source[self.pos] as i32;

            if code == quote {
                self.pos += 1;
                break;
            }

            if code == CH_BACKSLASH {
                self.flags |= TF_HAS_ESCAPE;
                self.scan_string_escape()?;
                continue;
            }

            if code == CH_LF || code == CH_CR {
                return Err(self.error("Unterminated string constant", start as u32));
            }

            self.pos += 1;
        }

        self.kind = T_STRING;

        Ok(())
    }

    /// Consumes one escape sequence inside a string literal.
    fn scan_string_escape(&mut self) -> ScanResult {
        let escape_start = self.pos;

        self.pos += 1;

        if self.pos >= self.length {
            return Err(self.error("Unterminated string constant", self.pos as u32));
        }

        let code = self.source[self.pos] as i32;

        // A backslash before a line terminator continues the string.
        if code == CH_CR {
            self.pos += 1;

            if self.cc(self.pos) == CH_LF {
                self.pos += 1;
            }

            self.add_line(self.pos);

            return Ok(());
        }

        if code == CH_LF || code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR {
            self.pos += 1;
            self.add_line(self.pos);

            return Ok(());
        }

        // Legacy octal escapes are only errors in strict mode, so they are
        // recorded rather than rejected here.
        if (CH_0..=CH_9).contains(&code) {
            let next = self.cc(self.pos + 1);

            if code != CH_0 || (char_flags(next) & MASK_DIGIT) != 0 {
                self.flags |= TF_LEGACY_OCTAL;
            }
        }

        self.pos += 1;

        // A string has no reading in which a malformed `\x` or `\u` is legal.
        if (code == CH_X_LOWER || code == CH_U_LOWER) && !self.scan_character_escape(code) {
            return Err(self.error(
                "Invalid escape sequence in string",
                escape_start as u32,
            ));
        }

        Ok(())
    }

    /// Consumes a `\x` or `\u` escape, starting just past the `x` or the `u`.
    /// Returns `true` when the escape was well formed.
    fn scan_character_escape(&mut self, code: i32) -> bool {
        if code == CH_X_LOWER {
            return self.consume_hex_digits(2);
        }

        if self.cc(self.pos) != CH_BRACE_OPEN {
            return self.consume_hex_digits(4);
        }

        self.pos += 1;

        let digits_start = self.pos;

        while self.pos < self.length && (char_flags(self.cc(self.pos)) & MASK_HEX_DIGIT) != 0 {
            self.pos += 1;
        }

        if self.pos == digits_start || self.cc(self.pos) != CH_BRACE_CLOSE {
            return false;
        }

        let digits = self.pos - digits_start;

        self.pos += 1;

        // `\u{...}` names a code point, so it stops at `0x10FFFF` however it
        // is written; only a run long enough to be out of range is read.
        if digits < 6 {
            return true;
        }

        let mut value: u64 = 0;

        for i in digits_start..digits_start + digits {
            value = value * 16 + hex_value(self.source[i] as i32) as u64;

            if value > MAX_CODE_POINT as u64 {
                return false;
            }
        }

        true
    }

    /// Scans one piece of a template literal, starting just past the `` ` ``
    /// or `}` that opened it.
    fn scan_template_part(&mut self, start: usize, is_head: bool) -> ScanResult {
        loop {
            if self.pos >= self.length {
                return Err(self.error("Unterminated template", start as u32));
            }

            let code = self.source[self.pos] as i32;

            if code == CH_BACKTICK {
                self.pos += 1;
                self.kind = if is_head { T_TEMPLATE_FULL } else { T_TEMPLATE_TAIL };

                return Ok(());
            }

            if code == CH_DOLLAR && self.cc(self.pos + 1) == CH_BRACE_OPEN {
                self.pos += 2;
                self.kind = if is_head { T_TEMPLATE_HEAD } else { T_TEMPLATE_MIDDLE };
                self.push_context(CTX_TEMPLATE);

                return Ok(());
            }

            if code == CH_BACKSLASH {
                self.flags |= TF_HAS_ESCAPE;
                self.scan_template_escape()?;
                continue;
            }

            if code == CH_CR {
                self.pos += 1;

                if self.cc(self.pos) == CH_LF {
                    self.pos += 1;
                }

                self.add_line(self.pos);
                continue;
            }

            if code == CH_LF || code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR {
                self.pos += 1;
                self.add_line(self.pos);
                continue;
            }

            self.pos += 1;
        }
    }

    /// Consumes one escape sequence inside a template literal, marking the
    /// escapes that are only legal in tagged templates.
    fn scan_template_escape(&mut self) -> ScanResult {
        self.pos += 1;

        if self.pos >= self.length {
            return Err(self.error("Unterminated template", self.pos as u32));
        }

        let code = self.source[self.pos] as i32;

        if code == CH_CR {
            self.pos += 1;

            if self.cc(self.pos) == CH_LF {
                self.pos += 1;
            }

            self.add_line(self.pos);

            return Ok(());
        }

        if code == CH_LF || code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR {
            self.pos += 1;
            self.add_line(self.pos);

            return Ok(());
        }

        self.pos += 1;

        if code == CH_X_LOWER || code == CH_U_LOWER {
            if !self.scan_character_escape(code) {
                self.flags |= TF_INVALID_ESCAPE;
            }

            return Ok(());
        }

        if (CH_0..=CH_9).contains(&code) {
            let next = self.cc(self.pos);

            if code != CH_0 || (char_flags(next) & MASK_DIGIT) != 0 {
                self.flags |= TF_INVALID_ESCAPE;
            }
        }

        Ok(())
    }

    /// Consumes an exact number of hexadecimal digits.
    fn consume_hex_digits(&mut self, count: usize) -> bool {
        for _ in 0..count {
            let code = self.cc(self.pos);

            if code >= ASCII_LIMIT || (char_flags(code) & MASK_HEX_DIGIT) == 0 {
                return false;
            }

            self.pos += 1;
        }

        true
    }

    /// Scans a token that begins with `/`.
    fn scan_slash(&mut self) -> ScanResult {
        if self.expr_allowed && !self.in_jsx_tag {
            return self.scan_reg_exp();
        }

        if self.cc(self.pos + 1) == CH_EQ {
            self.pos += 2;
            self.kind = T_ASSIGN_SLASH;

            return Ok(());
        }

        self.pos += 1;
        self.kind = T_SLASH;

        Ok(())
    }

    /// Rescans the current token as a regular expression literal.
    pub fn re_scan_as_reg_exp(&mut self) -> ScanResult {
        self.pos = self.start as usize;
        self.count -= 1;
        self.records.length = self.count as usize * TOKEN_WORDS;
        self.flags &= !(TF_HAS_ESCAPE | TF_INVALID_ESCAPE);

        self.scan_reg_exp()?;
        self.end = self.pos as u32;
        self.record(self.kind, self.start, self.end, self.flags, self.extra);
        self.update_context();

        Ok(())
    }

    //-------------------------------------------------------------------------
    // JSX Scanning
    //-------------------------------------------------------------------------

    /// Reads the next child of a JSX element: a run of literal text, or an
    /// ordinary token when the next character opens a tag or an expression.
    pub fn next_jsx_text(&mut self) -> ScanResult {
        let code = self.cc(self.pos);

        if self.pos >= self.length || code == CH_LT || code == CH_BRACE_OPEN {
            return self.next();
        }

        self.prev_kind = self.kind;
        self.prev_end = self.end;

        // Whitespace is part of the text, so no trivia is skipped here.
        self.flags = 0;
        self.extra = 0;
        self.start = self.pos as u32;
        self.scan_jsx_text();
        self.end = self.pos as u32;
        self.record(self.kind, self.start, self.end, self.flags, self.extra);
        self.expr_allowed = false;

        Ok(())
    }

    /// Reads the next JSX element or attribute name, or an ordinary token
    /// when the next character cannot start one.
    pub fn next_jsx_name(&mut self) -> ScanResult {
        self.prev_kind = self.kind;
        self.prev_end = self.end;

        let token_flags = self.skip_trivia()?;
        let code = self.cc(self.pos);
        let is_name_start = if (0..ASCII_LIMIT).contains(&code) {
            (CHAR_FLAGS[code as usize] & MASK_ID_START) != 0
        } else if self.pos < self.length {
            is_non_ascii_id_start(self.cp(self.pos))
        } else {
            false
        };

        if self.pos >= self.length || !is_name_start {
            self.finish_skipped_token(token_flags)?;

            // A `>` inside a tag always closes it, so a run of them can never
            // be the shift operator the ordinary scanner just produced.
            self.re_scan_greater_than();

            return Ok(());
        }

        self.flags = token_flags;
        self.extra = 0;
        self.start = self.pos as u32;
        self.scan_jsx_identifier();
        self.end = self.pos as u32;
        self.record(self.kind, self.start, self.end, self.flags, self.extra);
        self.expr_allowed = false;

        Ok(())
    }

    /// Reads the value of a JSX attribute: a quoted string with no escape
    /// processing, or an ordinary token when the value is an expression.
    pub fn next_jsx_attribute_value(&mut self) -> ScanResult {
        self.prev_kind = self.kind;
        self.prev_end = self.end;

        let token_flags = self.skip_trivia()?;
        let code = self.cc(self.pos);

        if code != CH_QUOTE_DOUBLE && code != CH_QUOTE_SINGLE {
            return self.finish_skipped_token(token_flags);
        }

        self.flags = token_flags;
        self.extra = 0;
        self.start = self.pos as u32;
        self.scan_jsx_string(code)?;
        self.end = self.pos as u32;
        self.record(self.kind, self.start, self.end, self.flags, self.extra);
        self.expr_allowed = false;

        Ok(())
    }

    /// Re-reads the current token as a JSX name.
    pub fn re_scan_as_jsx_name(&mut self) -> ScanResult {
        let prev_kind = self.prev_kind;
        let prev_end = self.prev_end;

        self.pos = self.start as usize;
        self.count -= 1;
        self.records.length = self.count as usize * TOKEN_WORDS;
        self.next_jsx_name()?;
        self.prev_kind = prev_kind;
        self.prev_end = prev_end;

        Ok(())
    }

    /// Finishes an ordinary token after trivia has already been skipped.
    fn finish_skipped_token(&mut self, token_flags: u32) -> ScanResult {
        // Inside JSX a `/` always closes a tag, so the regular expression
        // rule that would otherwise apply after `<` is turned off first.
        self.expr_allowed = false;
        self.flags = token_flags;
        self.extra = 0;
        self.start = self.pos as u32;

        if self.pos >= self.length {
            self.kind = T_EOF;
            self.end = self.pos as u32;
            self.record(T_EOF, self.pos as u32, self.pos as u32, self.flags, 0);
            self.expr_allowed = false;

            return Ok(());
        }

        self.scan_token()?;
        self.end = self.pos as u32;
        self.record(self.kind, self.start, self.end, self.flags, self.extra);
        self.update_context();

        Ok(())
    }

    /// Scans a run of literal text between JSX tags.
    fn scan_jsx_text(&mut self) {
        while self.pos < self.length {
            let code = self.source[self.pos] as i32;

            if code == CH_LT || code == CH_BRACE_OPEN {
                break;
            }

            if code == CH_CR {
                self.pos += 1;

                if self.cc(self.pos) == CH_LF {
                    self.pos += 1;
                }

                self.add_line(self.pos);
                continue;
            }

            if code == CH_LF || code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR {
                self.pos += 1;
                self.add_line(self.pos);
                continue;
            }

            self.pos += 1;
        }

        self.kind = T_JSX_TEXT;
    }

    /// Scans a JSX element or attribute name, which may contain `-`.
    fn scan_jsx_identifier(&mut self) {
        while self.pos < self.length {
            let code = self.source[self.pos] as i32;

            if code < ASCII_LIMIT {
                if (CHAR_FLAGS[code as usize] & MASK_ID_PART) != 0 || code == CH_MINUS {
                    self.pos += 1;
                    continue;
                }

                break;
            }

            let point = self.cp(self.pos);

            if !is_non_ascii_id_part(point) {
                break;
            }

            self.pos += if point > 0xffff { 2 } else { 1 };
        }

        self.kind = T_JSX_IDENT;
    }

    /// Scans a quoted JSX attribute value; backslashes are literal here.
    fn scan_jsx_string(&mut self, quote: i32) -> ScanResult {
        let start = self.pos;

        self.pos += 1;

        loop {
            if self.pos >= self.length {
                return Err(self.error("Unterminated JSX attribute value", start as u32));
            }

            let code = self.source[self.pos] as i32;

            if code == quote {
                self.pos += 1;
                break;
            }

            if code == CH_CR {
                self.pos += 1;

                if self.cc(self.pos) == CH_LF {
                    self.pos += 1;
                }

                self.add_line(self.pos);
                continue;
            }

            if code == CH_LF || code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR {
                self.pos += 1;
                self.add_line(self.pos);
                continue;
            }

            self.pos += 1;
        }

        self.kind = T_JSX_STRING;

        Ok(())
    }

    /// Records that the current keyword token is being used as a plain
    /// identifier. `let`, `static`, and `yield` keep their keyword identity.
    pub fn demote_keyword_to_identifier(&mut self) {
        let kind = self.kind;

        if !(KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind)
            || kind == T_LET
            || kind == T_STATIC
            || kind == T_YIELD
        {
            return;
        }

        self.kind = T_IDENT;

        let index = (self.count - 1) as usize * TOKEN_WORDS;

        self.records.words[index + 2] = T_IDENT | (self.flags << 16);

        // An identifier is never followed by a regular expression literal.
        self.expr_allowed = false;
    }

    /// Splits a token that starts with `>` so that only a single `>` remains.
    /// Returns `true` when the current token was split.
    pub fn re_scan_greater_than(&mut self) -> bool {
        let kind = self.kind;

        if kind != T_SAR
            && kind != T_SHR
            && kind != T_GT_EQ
            && kind != T_ASSIGN_SAR
            && kind != T_ASSIGN_SHR
        {
            return false;
        }

        self.pos = self.start as usize + 1;
        self.end = self.pos as u32;
        self.kind = T_GT;

        // Rewrite the record in place rather than appending a new one.
        let index = (self.count - 1) as usize * TOKEN_WORDS;

        self.records.words[index + 1] = self.end;
        self.records.words[index + 2] = T_GT | (self.flags << 16);

        self.update_context();

        true
    }

    /// Scans a regular expression literal, including its flags.
    fn scan_reg_exp(&mut self) -> ScanResult {
        let start = self.pos;
        let mut in_class = false;

        self.pos += 1;

        loop {
            if self.pos >= self.length {
                return Err(self.error("Unterminated regular expression", start as u32));
            }

            let code = self.source[self.pos] as i32;

            if code == CH_LF
                || code == CH_CR
                || code == CH_LINE_SEPARATOR
                || code == CH_PARAGRAPH_SEPARATOR
            {
                return Err(self.error("Unterminated regular expression", start as u32));
            }

            // A backslash escapes only a `RegularExpressionNonTerminator`.
            if code == CH_BACKSLASH {
                let next = self.cc(self.pos + 1);

                if self.pos + 1 >= self.length
                    || next == CH_LF
                    || next == CH_CR
                    || next == CH_LINE_SEPARATOR
                    || next == CH_PARAGRAPH_SEPARATOR
                {
                    return Err(self.error("Unterminated regular expression", start as u32));
                }

                self.pos += 2;
                continue;
            }

            if code == CH_BRACKET_OPEN {
                in_class = true;
            } else if code == CH_BRACKET_CLOSE {
                in_class = false;
            } else if code == CH_SLASH && !in_class {
                break;
            }

            self.pos += 1;
        }

        // Remember where the pattern ended so the flags can be split out.
        self.extra = self.pos as u32;
        self.pos += 1;

        while self.pos < self.length {
            let code = self.source[self.pos] as i32;

            if code >= ASCII_LIMIT || (CHAR_FLAGS[code as usize] & MASK_ID_PART) == 0 {
                break;
            }

            self.pos += 1;
        }

        self.kind = T_REGEXP;

        Ok(())
    }

    /// Scans an operator or delimiter.
    fn scan_punctuator(&mut self, code: i32) -> ScanResult {
        let next = self.cc(self.pos + 1);

        match code {
            c if c == CH_BRACE_OPEN => {
                self.pos += 1;
                self.kind = T_BRACE_OPEN;

                let context = if self.expr_allowed { CTX_OBJECT } else { CTX_BLOCK };

                self.push_context(context);

                Ok(())
            }
            c if c == CH_BRACE_CLOSE => {
                if self.context_depth > 0 && self.context[self.context_depth - 1] == CTX_TEMPLATE
                {
                    self.context_depth -= 1;
                    self.pos += 1;

                    return self.scan_template_part(self.start as usize, false);
                }

                self.pos += 1;
                self.kind = T_BRACE_CLOSE;

                Ok(())
            }
            c if c == CH_PAREN_OPEN => {
                self.pos += 1;
                self.kind = T_PAREN_OPEN;
                self.push_context(CTX_PAREN_EXPR);

                Ok(())
            }
            c if c == CH_QUESTION => {
                if next == CH_DOT {
                    // `?.5` is a conditional followed by a number.
                    let after = self.cc(self.pos + 2);

                    if (char_flags(after) & MASK_DIGIT) == 0 {
                        self.pos += 2;
                        self.kind = T_QUESTION_DOT;

                        return Ok(());
                    }
                }

                if next == CH_QUESTION {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_ASSIGN_QQ;

                        return Ok(());
                    }

                    self.pos += 2;
                    self.kind = T_QQ;

                    return Ok(());
                }

                self.pos += 1;
                self.kind = T_QUESTION;

                Ok(())
            }
            c if c == CH_PLUS => {
                if next == CH_PLUS {
                    self.pos += 2;
                    self.kind = T_PLUS_PLUS;
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_PLUS;
                } else {
                    self.pos += 1;
                    self.kind = T_PLUS;
                }

                Ok(())
            }
            c if c == CH_MINUS => {
                if next == CH_MINUS {
                    self.pos += 2;
                    self.kind = T_MINUS_MINUS;
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_MINUS;
                } else {
                    self.pos += 1;
                    self.kind = T_MINUS;
                }

                Ok(())
            }
            c if c == CH_STAR => {
                if next == CH_STAR {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_ASSIGN_STARSTAR;
                    } else {
                        self.pos += 2;
                        self.kind = T_STARSTAR;
                    }
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_STAR;
                } else {
                    self.pos += 1;
                    self.kind = T_STAR;
                }

                Ok(())
            }
            c if c == CH_PERCENT => {
                if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_PERCENT;
                } else {
                    self.pos += 1;
                    self.kind = T_PERCENT;
                }

                Ok(())
            }
            c if c == CH_CARET => {
                if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_CARET;
                } else {
                    self.pos += 1;
                    self.kind = T_CARET;
                }

                Ok(())
            }
            c if c == CH_AMP => {
                if next == CH_AMP {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_ASSIGN_AMPAMP;
                    } else {
                        self.pos += 2;
                        self.kind = T_AMPAMP;
                    }
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_AMP;
                } else {
                    self.pos += 1;
                    self.kind = T_AMP;
                }

                Ok(())
            }
            c if c == CH_PIPE => {
                if next == CH_PIPE {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_ASSIGN_PIPEPIPE;
                    } else {
                        self.pos += 2;
                        self.kind = T_PIPEPIPE;
                    }
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_ASSIGN_PIPE;
                } else {
                    self.pos += 1;
                    self.kind = T_PIPE;
                }

                Ok(())
            }
            c if c == CH_EQ => {
                if next == CH_EQ {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_EQ_EQ_EQ;
                    } else {
                        self.pos += 2;
                        self.kind = T_EQ_EQ;
                    }
                } else if next == CH_GT {
                    self.pos += 2;
                    self.kind = T_ARROW;
                } else {
                    self.pos += 1;
                    self.kind = T_ASSIGN;
                }

                Ok(())
            }
            c if c == CH_BANG => {
                if next == CH_EQ {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_NOT_EQ_EQ;
                    } else {
                        self.pos += 2;
                        self.kind = T_NOT_EQ;
                    }
                } else {
                    self.pos += 1;
                    self.kind = T_NOT;
                }

                Ok(())
            }
            c if c == CH_LT => {
                if next == CH_LT {
                    if self.cc(self.pos + 2) == CH_EQ {
                        self.pos += 3;
                        self.kind = T_ASSIGN_SHL;
                    } else {
                        self.pos += 2;
                        self.kind = T_SHL;
                    }
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_LT_EQ;
                } else {
                    self.pos += 1;
                    self.kind = T_LT;
                }

                Ok(())
            }
            c if c == CH_GT => {
                if next == CH_GT {
                    let third = self.cc(self.pos + 2);

                    if third == CH_GT {
                        if self.cc(self.pos + 3) == CH_EQ {
                            self.pos += 4;
                            self.kind = T_ASSIGN_SHR;
                        } else {
                            self.pos += 3;
                            self.kind = T_SHR;
                        }
                    } else if third == CH_EQ {
                        self.pos += 3;
                        self.kind = T_ASSIGN_SAR;
                    } else {
                        self.pos += 2;
                        self.kind = T_SAR;
                    }
                } else if next == CH_EQ {
                    self.pos += 2;
                    self.kind = T_GT_EQ;
                } else {
                    self.pos += 1;
                    self.kind = T_GT;
                }

                Ok(())
            }
            _ => {
                let point = self.cp(self.pos);
                let spelled = char::from_u32(point).unwrap_or('\u{fffd}');

                Err(self.error(
                    format!("Unexpected character '{spelled}'"),
                    self.pos as u32,
                ))
            }
        }
    }

    //-------------------------------------------------------------------------
    // Context Tracking
    //-------------------------------------------------------------------------

    /// Pushes an entry onto the lexical context stack.
    fn push_context(&mut self, context: u8) {
        if self.context_depth == self.context.len() {
            let grown = self.context.len() * 2;

            self.context.resize(grown, 0);
        }

        self.context[self.context_depth] = context;
        self.context_depth += 1;
    }

    /// Updates whether a regular expression may begin at the new position,
    /// based on the token that was just scanned.
    fn update_context(&mut self) {
        let kind = self.kind;

        if (kind as usize) < 256 && CONTEXT_SPECIAL[kind as usize] == 0 {
            self.expr_allowed = KIND_BEFORE_EXPR[kind as usize] != 0;

            return;
        }

        match kind {
            k if k == T_PAREN_CLOSE => {
                let mut closed = CTX_PAREN_EXPR;

                if self.context_depth > 0 {
                    self.context_depth -= 1;
                    closed = self.context[self.context_depth];
                }

                self.expr_allowed = closed == CTX_PAREN_STMT;
            }
            k if k == T_BRACE_CLOSE => {
                let mut closed = CTX_OBJECT;

                if self.context_depth > 0 {
                    self.context_depth -= 1;
                    closed = self.context[self.context_depth];
                }

                self.expr_allowed = closed == CTX_BLOCK;
            }
            // Increment and decrement leave the previous decision alone.
            k if k == T_PLUS_PLUS || k == T_MINUS_MINUS => {}
            k if k == T_YIELD => {
                self.expr_allowed = self.in_generator && self.prev_kind != T_DOT;
            }
            k if k == T_AWAIT => {
                self.expr_allowed = self.in_async && self.prev_kind != T_DOT;
            }
            k if k == T_OF => {
                self.expr_allowed = !self.expr_allowed && self.prev_kind != T_DOT;
            }
            _ => {
                self.expr_allowed = KIND_BEFORE_EXPR[kind as usize] != 0;
            }
        }
    }
}
