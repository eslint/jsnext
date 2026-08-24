//! The regular expression pattern grammar.
//!
//! Port of `packages/jskit/src/parse/regexp.ts`. The tokenizer found where
//! the literal ends; whether the text between the slashes can be recognized
//! using the goal symbol `Pattern` is an early error on the literal, which is
//! why this lives with validation. The walk mirrors the TypeScript reader
//! function for function; where that code throws a `PatternError`, this
//! returns `Err`, and `?` is the unwinding.

use super::chars::{
    char_flags, is_non_ascii_id_part, is_non_ascii_id_start, ASCII_LIMIT, CH_0, CH_7, CH_9, CH_AMP,
    CH_AT, CH_A_LOWER, CH_A_UPPER, CH_BACKSLASH, CH_BACKTICK, CH_BANG, CH_BRACE_CLOSE,
    CH_BRACE_OPEN, CH_BRACKET_CLOSE, CH_BRACKET_OPEN, CH_B_LOWER, CH_B_UPPER, CH_CARET, CH_COLON,
    CH_COMMA, CH_DOLLAR, CH_DOT, CH_EQ, CH_F_LOWER, CH_GT, CH_HASH, CH_LT, CH_MINUS, CH_N_LOWER,
    CH_PAREN_CLOSE, CH_PAREN_OPEN, CH_PERCENT, CH_PIPE, CH_PLUS, CH_QUESTION, CH_R_LOWER,
    CH_SLASH, CH_STAR, CH_TILDE, CH_T_LOWER, CH_UNDERSCORE, CH_U_LOWER, CH_V_LOWER, CH_ZWJ,
    CH_ZWNJ, CH_Z_LOWER, CH_Z_UPPER, MASK_DIGIT, MASK_HEX_DIGIT, MASK_ID_PART, MASK_ID_START,
};
use super::unicode_properties::{
    set_has, BINARY_PROPERTIES, BINARY_PROPERTIES_OF_STRINGS, GENERAL_CATEGORY_VALUES,
    SCRIPT_VALUES,
};
use std::collections::HashMap;

/// A problem found in a regular expression literal.
pub struct RegExpProblem {
    /// What is wrong.
    pub message: &'static str,

    /// Where it is, as an offset into the program text.
    pub start: u32,
}

/// Nothing was parsed.
const SET_NONE: u8 = 0;

/// A construct was parsed, and it matches single code points only.
const SET_CHARS: u8 = 1;

/// A construct was parsed, and it can match a sequence of code points.
const SET_STRINGS: u8 = 2;

/// The flags a regular expression literal may carry.
const VALID_FLAGS: [i32; 8] = [0x64, 0x67, 0x69, 0x6d, 0x73, 0x75, 0x76, 0x79];

/// The unwinding error: what is wrong and where.
struct PatternError {
    message: &'static str,
    start: usize,
}

/// The result the walk's readers thread through `?`.
type PResult<T> = Result<T, PatternError>;

/// Determines whether a code point may start an identifier.
fn is_id_start(code: i32) -> bool {
    if code < ASCII_LIMIT {
        code >= 0 && (char_flags(code) & MASK_ID_START) != 0
    } else {
        is_non_ascii_id_start(code as u32)
    }
}

/// Determines whether a code point may continue an identifier.
fn is_id_part(code: i32) -> bool {
    if code < ASCII_LIMIT {
        code >= 0 && (char_flags(code) & MASK_ID_PART) != 0
    } else {
        is_non_ascii_id_part(code as u32)
    }
}

/// Determines whether a code point is a decimal digit.
fn is_digit(code: i32) -> bool {
    (CH_0..=CH_9).contains(&code)
}

/// Determines whether a code point is a hexadecimal digit.
fn is_hex_digit(code: i32) -> bool {
    code >= 0 && code < ASCII_LIMIT && (char_flags(code) & MASK_HEX_DIGIT) != 0
}

/// Converts a hexadecimal digit to its value.
fn hex_value(code: i32) -> f64 {
    if (char_flags(code) & MASK_DIGIT) != 0 {
        (code - CH_0) as f64
    } else {
        ((code | 0x20) - CH_A_LOWER + 10) as f64
    }
}

/// Determines whether a code point is an ASCII letter.
fn is_control_letter(code: i32) -> bool {
    (CH_A_UPPER..=CH_Z_UPPER).contains(&code) || (CH_A_LOWER..=CH_Z_LOWER).contains(&code)
}

/// Determines whether a code point is a `SyntaxCharacter`.
fn is_syntax_character(code: i32) -> bool {
    code == CH_DOLLAR
        || (CH_PAREN_OPEN..=CH_PLUS).contains(&code)
        || code == CH_DOT
        || code == CH_QUESTION
        || (CH_BRACKET_OPEN..=CH_CARET).contains(&code)
        || (CH_BRACE_OPEN..=CH_BRACE_CLOSE).contains(&code)
}

/// Determines whether a code point is a `ClassSetSyntaxCharacter`.
fn is_class_set_syntax_character(code: i32) -> bool {
    code == CH_PAREN_OPEN
        || code == CH_PAREN_CLOSE
        || code == CH_MINUS
        || code == CH_SLASH
        || (CH_BRACKET_OPEN..=CH_BRACKET_CLOSE).contains(&code)
        || (CH_BRACE_OPEN..=CH_BRACE_CLOSE).contains(&code)
}

/// Determines whether a code point may be escaped inside a `v`-mode class.
fn is_class_set_reserved_punctuator(code: i32) -> bool {
    code == CH_BANG
        || code == CH_HASH
        || code == CH_PERCENT
        || code == CH_AMP
        || code == CH_COMMA
        || code == CH_MINUS
        || (CH_COLON..=CH_GT).contains(&code)
        || code == CH_AT
        || code == CH_BACKTICK
        || code == CH_TILDE
}

/// Determines whether a code point may not be doubled inside a `v`-mode class.
fn is_class_set_reserved_double_punctuator(code: i32) -> bool {
    code == CH_BANG
        || (CH_HASH..=CH_AMP).contains(&code)
        || (CH_STAR..=CH_COMMA).contains(&code)
        || code == CH_DOT
        || (CH_COLON..=CH_AT).contains(&code)
        || code == CH_CARET
        || code == CH_BACKTICK
        || code == CH_TILDE
}

/// One branch of one disjunction, held in an arena; see the TypeScript
/// `Branch` class for the duplicate-group-name rule it encodes.
struct BranchNode {
    /// The branch this one is nested inside, or `None` at the top.
    parent: Option<u32>,

    /// The index of the node shared by every alternative of this disjunction.
    base: u32,
}

/// Checks the pattern and flags of a regular expression literal.
pub struct RegExpValidator<'a> {
    /// The program text. Patterns are read in place rather than sliced out.
    source: &'a [u16],

    /// How far reading has got, as an offset into the program text.
    pos: usize,

    /// The first character of the pattern.
    pattern_start: usize,

    /// One past the last character of the pattern — the closing slash.
    pattern_end: usize,

    /// Whether the `u` or the `v` flag is set.
    unicode: bool,

    /// Whether the `v` flag is set.
    unicode_sets: bool,

    /// Whether `\k` introduces a named backreference rather than a `k`.
    named_groups: bool,

    /// How many capturing groups have been seen.
    capturing_parens: f64,

    /// The largest numeric backreference seen, which may run ahead.
    max_back_reference: f64,

    /// Every group name, mapped to the branches that declare it.
    group_names: HashMap<String, Vec<Option<u32>>>,

    /// The names `\k<…>` referred to, resolved once the walk is done.
    back_reference_names: Vec<String>,

    /// Where each of those references was written.
    back_reference_starts: Vec<usize>,

    /// The branch arena.
    branches: Vec<BranchNode>,

    /// The branch being parsed, or `None` outside any disjunction.
    branch: Option<u32>,

    /// The value of the last thing read, for range and reference checks.
    last_value: f64,

    /// The text of the last name read.
    last_name: String,

    /// Whether the last assertion read may carry a quantifier under Annex B.
    quantifiable: bool,
}

impl<'a> RegExpValidator<'a> {
    /// Checks one regular expression literal.
    ///
    /// `start` is the offset of the opening slash, `pattern_end` the offset
    /// of the closing slash, and `end` one past the last flag. The result is
    /// the first problem found, or `None` when the literal is valid.
    pub fn validate(
        source: &'a [u16],
        start: usize,
        pattern_end: usize,
        end: usize,
    ) -> Option<RegExpProblem> {
        let mut v = RegExpValidator {
            source,
            pos: 0,
            pattern_start: start + 1,
            pattern_end,
            unicode: false,
            unicode_sets: false,
            named_groups: false,
            capturing_parens: 0.0,
            max_back_reference: 0.0,
            group_names: HashMap::new(),
            back_reference_names: Vec::new(),
            back_reference_starts: Vec::new(),
            branches: Vec::new(),
            branch: None,
            last_value: 0.0,
            last_name: String::new(),
            quantifiable: false,
        };

        let result = (|| -> PResult<()> {
            v.read_flags(pattern_end + 1, end)?;
            let unicode = v.unicode;
            v.parse(unicode)?;

            if !v.named_groups && !v.group_names.is_empty() {
                v.parse(true)?;
            }

            Ok(())
        })();

        match result {
            Ok(()) => None,
            Err(error) => Some(RegExpProblem {
                message: error.message,
                start: error.start as u32,
            }),
        }
    }

    //-------------------------------------------------------------------------
    // Reading
    //-------------------------------------------------------------------------

    /// Reports a problem at the current position and abandons the walk.
    fn raise<T>(&self, message: &'static str) -> PResult<T> {
        Err(PatternError {
            message,
            start: self.pos,
        })
    }

    /// Reads the code point at an offset, or `-1` past the end.
    fn at(&self, index: usize, force_unicode: bool) -> i32 {
        if index >= self.pattern_end {
            return -1;
        }

        let code = self.source[index] as i32;

        if !(force_unicode || self.unicode)
            || !(0xd800..=0xdbff).contains(&code)
            || index + 1 >= self.pattern_end
        {
            return code;
        }

        let next = self.source[index + 1] as i32;

        if (0xdc00..=0xdfff).contains(&next) {
            (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000
        } else {
            code
        }
    }

    /// Finds the offset after the character at an offset.
    fn next(&self, index: usize, force_unicode: bool) -> usize {
        if index >= self.pattern_end {
            return self.pattern_end;
        }

        let code = self.source[index] as i32;

        if !(force_unicode || self.unicode)
            || !(0xd800..=0xdbff).contains(&code)
            || index + 1 >= self.pattern_end
        {
            return index + 1;
        }

        let next = self.source[index + 1] as i32;

        if (0xdc00..=0xdfff).contains(&next) {
            index + 2
        } else {
            index + 1
        }
    }

    /// Reads the code point at the current position without consuming it.
    fn current(&self) -> i32 {
        self.at(self.pos, false)
    }

    /// Reads it pairing surrogates whatever the flags say.
    fn current_forced(&self) -> i32 {
        self.at(self.pos, true)
    }

    /// Reads the code point after the current one without consuming either.
    fn lookahead(&self) -> i32 {
        self.at(self.next(self.pos, false), false)
    }

    /// Consumes the character at the current position.
    fn advance(&mut self) {
        self.pos = self.next(self.pos, false);
    }

    /// Consumes it pairing surrogates whatever the flags say.
    fn advance_forced(&mut self) {
        self.pos = self.next(self.pos, true);
    }

    /// Consumes the character at the current position when it is the one given.
    fn eat(&mut self, code: i32) -> bool {
        if self.current() != code {
            return false;
        }

        self.advance();
        true
    }

    /// Consumes two characters when both match.
    fn eat_pair(&mut self, first: i32, second: i32) -> bool {
        if self.pos + 2 > self.pattern_end
            || self.source[self.pos] as i32 != first
            || self.source[self.pos + 1] as i32 != second
        {
            return false;
        }

        self.pos += 2;
        true
    }

    //-------------------------------------------------------------------------
    // Flags
    //-------------------------------------------------------------------------

    /// Checks the flags, which decide which language the pattern is written in.
    fn read_flags(&mut self, start: usize, end: usize) -> PResult<()> {
        let mut unicode = false;
        let mut unicode_sets = false;

        for i in start..end {
            let flag = self.source[i] as i32;

            if !VALID_FLAGS.contains(&flag) {
                return Err(PatternError {
                    message: "Invalid regular expression flag.",
                    start: i,
                });
            }

            let repeat = self.source[i + 1..]
                .iter()
                .position(|&unit| unit as i32 == flag)
                .map(|found| i + 1 + found);

            if let Some(repeat) = repeat {
                if repeat < end {
                    return Err(PatternError {
                        message: "Duplicate regular expression flag.",
                        start: i,
                    });
                }
            }

            unicode = unicode || flag == 0x75;
            unicode_sets = unicode_sets || flag == 0x76;
        }

        if unicode && unicode_sets {
            return Err(PatternError {
                message: "The 'u' and 'v' flags are mutually exclusive.",
                start,
            });
        }

        self.unicode = unicode || unicode_sets;
        self.unicode_sets = unicode_sets;
        Ok(())
    }

    //-------------------------------------------------------------------------
    // Pattern
    //-------------------------------------------------------------------------

    /// Reads the whole pattern once and resolves what the walk deferred.
    fn parse(&mut self, named_groups: bool) -> PResult<()> {
        self.pos = self.pattern_start;
        self.named_groups = named_groups;
        self.capturing_parens = 0.0;
        self.max_back_reference = 0.0;
        self.group_names.clear();
        self.back_reference_names.clear();
        self.back_reference_starts.clear();
        self.branches.clear();
        self.branch = None;

        self.disjunction()?;

        if self.pos != self.pattern_end {
            if self.eat(CH_PAREN_CLOSE) {
                return self.raise("Unmatched ')'.");
            }

            if self.eat(CH_BRACKET_CLOSE) || self.eat(CH_BRACE_CLOSE) {
                return self.raise("Lone quantifier brackets.");
            }
        }

        if self.max_back_reference > self.capturing_parens {
            return self.raise("Invalid backreference.");
        }

        for i in 0..self.back_reference_names.len() {
            if !self.group_names.contains_key(&self.back_reference_names[i]) {
                return Err(PatternError {
                    message: "Invalid named capture referenced.",
                    start: self.back_reference_starts[i],
                });
            }
        }

        Ok(())
    }

    /// Determines whether two branches are alternatives of one disjunction.
    fn separated_from(&self, a: Option<u32>, b: Option<u32>) -> bool {
        let mut own = a;

        while let Some(own_index) = own {
            let mut other = b;

            while let Some(other_index) = other {
                if self.branches[own_index as usize].base == self.branches[other_index as usize].base
                    && own_index != other_index
                {
                    return true;
                }

                other = self.branches[other_index as usize].parent;
            }

            own = self.branches[own_index as usize].parent;
        }

        false
    }

    /// Reads `Disjunction`, the alternatives separated by `|`.
    fn disjunction(&mut self) -> PResult<()> {
        let index = self.branches.len() as u32;

        self.branches.push(BranchNode {
            parent: self.branch,
            base: index,
        });
        self.branch = Some(index);
        self.alternative()?;

        while self.eat(CH_PIPE) {
            let parent = self.branches[self.branch.unwrap() as usize].parent;
            let base = self.branches[self.branch.unwrap() as usize].base;
            let sibling = self.branches.len() as u32;

            self.branches.push(BranchNode { parent, base });
            self.branch = Some(sibling);
            self.alternative()?;
        }

        self.branch = self.branches[self.branch.unwrap() as usize].parent;

        if self.eat_quantifier(true)? {
            return self.raise("Nothing to repeat.");
        }

        if self.eat(CH_BRACE_OPEN) {
            return self.raise("Lone quantifier brackets.");
        }

        Ok(())
    }

    /// Reads `Alternative`, a run of terms.
    fn alternative(&mut self) -> PResult<()> {
        while self.pos < self.pattern_end && self.term()? {
            // Every term is read for its side effects.
        }

        Ok(())
    }

    /// Reads one `Term`: an assertion, or an atom with an optional quantifier.
    fn term(&mut self) -> PResult<bool> {
        if self.eat_assertion()? {
            if self.quantifiable && self.eat_quantifier(false)? && self.unicode {
                return self.raise("Invalid quantifier.");
            }

            return Ok(true);
        }

        let atom = if self.unicode {
            self.eat_atom()?
        } else {
            self.eat_extended_atom()?
        };

        if atom {
            self.eat_quantifier(false)?;
            return Ok(true);
        }

        Ok(false)
    }

    /// Reads `Assertion`: an anchor, a word boundary, or a lookaround.
    fn eat_assertion(&mut self) -> PResult<bool> {
        let start = self.pos;

        self.quantifiable = false;

        if self.eat(CH_CARET) || self.eat(CH_DOLLAR) {
            return Ok(true);
        }

        if self.eat(CH_BACKSLASH) {
            if self.eat(CH_B_UPPER) || self.eat(CH_B_LOWER) {
                return Ok(true);
            }

            self.pos = start;
        }

        if self.eat(CH_PAREN_OPEN) && self.eat(CH_QUESTION) {
            let behind = self.eat(CH_LT);

            if self.eat(CH_EQ) || self.eat(CH_BANG) {
                self.disjunction()?;

                if !self.eat(CH_PAREN_CLOSE) {
                    return self.raise("Unterminated group.");
                }

                self.quantifiable = !behind;
                return Ok(true);
            }
        }

        self.pos = start;
        Ok(false)
    }

    /// Reads `Quantifier`, greedy or lazy.
    fn eat_quantifier(&mut self, silent: bool) -> PResult<bool> {
        if self.eat(CH_STAR)
            || self.eat(CH_PLUS)
            || self.eat(CH_QUESTION)
            || self.eat_braced_quantifier(silent)?
        {
            self.eat(CH_QUESTION);
            return Ok(true);
        }

        Ok(false)
    }

    /// Reads `{n}`, `{n,}`, or `{n,m}`.
    fn eat_braced_quantifier(&mut self, silent: bool) -> PResult<bool> {
        let start = self.pos;

        if self.eat(CH_BRACE_OPEN) {
            if self.eat_decimal_digits() {
                let min = self.last_value;
                let mut max = -1.0;

                if self.eat(CH_COMMA) && self.eat_decimal_digits() {
                    max = self.last_value;
                }

                if self.eat(CH_BRACE_CLOSE) {
                    if max != -1.0 && max < min && !silent {
                        return self.raise("Numbers out of order in {} quantifier.");
                    }

                    return Ok(true);
                }
            }

            if self.unicode && !silent {
                return self.raise("Incomplete quantifier.");
            }

            self.pos = start;
        }

        Ok(false)
    }

    /// Reads `Atom` under `u` or `v`.
    fn eat_atom(&mut self) -> PResult<bool> {
        Ok(self.eat_pattern_characters()
            || self.eat(CH_DOT)
            || self.eat_atom_escape()?
            || self.eat_character_class()?
            || self.eat_group(false)?
            || self.eat_group(true)?)
    }

    /// Reads `ExtendedAtom`, the Annex B atom for a pattern without `u`.
    fn eat_extended_atom(&mut self) -> PResult<bool> {
        Ok(self.eat(CH_DOT)
            || self.eat_atom_escape()?
            || self.eat_character_class()?
            || self.eat_group(false)?
            || self.eat_group(true)?
            || self.eat_invalid_braced_quantifier()?
            || self.eat_extended_pattern_character())
    }

    /// Reports a quantifier that follows nothing.
    fn eat_invalid_braced_quantifier(&mut self) -> PResult<bool> {
        if self.eat_braced_quantifier(true)? {
            return self.raise("Nothing to repeat.");
        }

        Ok(false)
    }

    /// Reads a run of ordinary characters, as many as there are.
    fn eat_pattern_characters(&mut self) -> bool {
        let start = self.pos;
        let mut code = self.current();

        while code != -1 && !is_syntax_character(code) {
            self.advance();
            code = self.current();
        }

        self.pos != start
    }

    /// Reads one `ExtendedPatternCharacter`.
    fn eat_extended_pattern_character(&mut self) -> bool {
        let code = self.current();

        if code != -1
            && code != CH_DOLLAR
            && !(CH_PAREN_OPEN..=CH_PLUS).contains(&code)
            && code != CH_DOT
            && code != CH_QUESTION
            && code != CH_BRACKET_OPEN
            && code != CH_CARET
            && code != CH_PIPE
        {
            self.advance();
            return true;
        }

        false
    }

    //-------------------------------------------------------------------------
    // Groups
    //-------------------------------------------------------------------------

    /// Reads a group, capturing or not.
    fn eat_group(&mut self, capturing: bool) -> PResult<bool> {
        let start = self.pos;

        if !self.eat(CH_PAREN_OPEN) {
            return Ok(false);
        }

        if !capturing {
            if self.eat(CH_QUESTION) {
                self.read_modifiers()?;

                if self.eat(CH_COLON) {
                    self.disjunction()?;

                    if self.eat(CH_PAREN_CLOSE) {
                        return Ok(true);
                    }

                    return self.raise("Unterminated group.");
                }
            }

            self.pos = start;
            return Ok(false);
        }

        self.read_group_specifier()?;
        self.disjunction()?;

        if !self.eat(CH_PAREN_CLOSE) {
            return self.raise("Unterminated group.");
        }

        self.capturing_parens += 1.0;
        Ok(true)
    }

    /// Reads the modifiers of `(?ims-ims:…)`, if there are any.
    fn read_modifiers(&mut self) -> PResult<()> {
        let added = self.read_modifier_run();
        let hyphen = self.eat(CH_MINUS);

        if added.is_empty() && !hyphen {
            return Ok(());
        }

        let added_bytes = added.as_bytes();

        for i in 0..added_bytes.len() {
            if added_bytes[i + 1..].contains(&added_bytes[i]) {
                return self.raise("Duplicate regular expression modifiers.");
            }
        }

        if !hyphen {
            return Ok(());
        }

        let removed = self.read_modifier_run();

        if added.is_empty() && removed.is_empty() && self.current() == CH_COLON {
            return self.raise("Invalid regular expression modifiers.");
        }

        let removed_bytes = removed.as_bytes();

        for i in 0..removed_bytes.len() {
            if removed_bytes[i + 1..].contains(&removed_bytes[i])
                || added_bytes.contains(&removed_bytes[i])
            {
                return self.raise("Duplicate regular expression modifiers.");
            }
        }

        Ok(())
    }

    /// Reads a run of modifier letters.
    fn read_modifier_run(&mut self) -> String {
        let start = self.pos;
        let mut code = self.current();

        while code == 0x69 || code == 0x6d || code == 0x73 {
            self.advance();
            code = self.current();
        }

        String::from_utf16_lossy(&self.source[start..self.pos])
    }

    /// Reads the `?<name>` of a named capturing group, if there is one.
    fn read_group_specifier(&mut self) -> PResult<()> {
        if !self.eat(CH_QUESTION) {
            return Ok(());
        }

        let start = self.pos;

        if !self.eat_group_name()? {
            return self.raise("Invalid group.");
        }

        let name = self.last_name.clone();
        let branch = self.branch;

        if let Some(declared) = self.group_names.get(&name) {
            for i in 0..declared.len() {
                if !self.separated_from(declared[i], branch) {
                    return Err(PatternError {
                        message: "Duplicate capture group name.",
                        start,
                    });
                }
            }

            self.group_names.get_mut(&name).unwrap().push(branch);
        } else {
            self.group_names.insert(name, vec![branch]);
        }

        Ok(())
    }

    /// Reads `<name>`, leaving the name in `last_name`.
    fn eat_group_name(&mut self) -> PResult<bool> {
        self.last_name.clear();

        if !self.eat(CH_LT) {
            return Ok(false);
        }

        if self.eat_identifier_name()? && self.eat(CH_GT) {
            return Ok(true);
        }

        self.raise("Invalid capture group name.")
    }

    /// Reads a `RegExpIdentifierName`, leaving it in `last_name`.
    fn eat_identifier_name(&mut self) -> PResult<bool> {
        self.last_name.clear();

        if !self.eat_identifier_character(true)? {
            return Ok(false);
        }

        self.push_last_value_onto_name();

        while self.eat_identifier_character(false)? {
            self.push_last_value_onto_name();
        }

        Ok(true)
    }

    /// Appends the code point in `last_value` to `last_name`.
    fn push_last_value_onto_name(&mut self) {
        if let Some(character) = char::from_u32(self.last_value as u32) {
            self.last_name.push(character);
        }
    }

    /// Reads one character of a group name, escaped or not.
    fn eat_identifier_character(&mut self, first: bool) -> PResult<bool> {
        let start = self.pos;
        let mut code = self.current_forced();

        self.advance_forced();

        if code == CH_BACKSLASH && self.eat_unicode_escape(true)? {
            code = self.last_value as i32;
        }

        let accepted = if first {
            is_id_start(code)
        } else {
            is_id_part(code) || code == CH_ZWNJ || code == CH_ZWJ
        };

        if accepted {
            self.last_value = code as f64;
            return Ok(true);
        }

        self.pos = start;
        Ok(false)
    }

    //-------------------------------------------------------------------------
    // Escapes
    //-------------------------------------------------------------------------

    /// Reads `\` followed by an `AtomEscape`.
    fn eat_atom_escape(&mut self) -> PResult<bool> {
        let start = self.pos;

        if !self.eat(CH_BACKSLASH) {
            return Ok(false);
        }

        if self.eat_back_reference()?
            || self.eat_character_class_escape()? != SET_NONE
            || self.eat_character_escape()?
            || (self.named_groups && self.eat_named_back_reference()?)
        {
            return Ok(true);
        }

        if self.unicode {
            if self.current() == 0x63 {
                return self.raise("Invalid unicode escape.");
            }

            return self.raise("Invalid escape.");
        }

        self.pos = start;
        Ok(false)
    }

    /// Reads a numeric backreference.
    fn eat_back_reference(&mut self) -> PResult<bool> {
        let start = self.pos;

        if !self.eat_decimal_escape() {
            return Ok(false);
        }

        let value = self.last_value;

        if self.unicode {
            if value > self.max_back_reference {
                self.max_back_reference = value;
            }

            return Ok(true);
        }

        if value <= self.capturing_parens {
            return Ok(true);
        }

        self.pos = start;
        Ok(false)
    }

    /// Reads `\k<name>`.
    fn eat_named_back_reference(&mut self) -> PResult<bool> {
        let start = self.pos;

        if !self.eat(0x6b) {
            return Ok(false);
        }

        if self.eat_group_name()? {
            self.back_reference_names.push(self.last_name.clone());
            self.back_reference_starts.push(start);
            return Ok(true);
        }

        self.raise("Invalid named reference.")
    }

    /// Reads `\1` through `\9…`, leaving the value in `last_value`.
    fn eat_decimal_escape(&mut self) -> bool {
        let mut code = self.current();

        if !(0x31..=0x39).contains(&code) {
            return false;
        }

        let mut value = 0.0f64;

        loop {
            value = value * 10.0 + (code - CH_0) as f64;
            self.advance();
            code = self.current();

            if !is_digit(code) {
                break;
            }
        }

        self.last_value = value;
        true
    }

    /// Reads `\d`, `\s`, `\w`, their negations, and `\p{…}`.
    fn eat_character_class_escape(&mut self) -> PResult<u8> {
        let code = self.current();

        if code == 0x64 || code == 0x44 || code == 0x73 || code == 0x53 || code == 0x77
            || code == 0x57
        {
            self.last_value = -1.0;
            self.advance();
            return Ok(SET_CHARS);
        }

        if !self.unicode || (code != 0x70 && code != 0x50) {
            return Ok(SET_NONE);
        }

        let negated = code == 0x50;

        self.last_value = -1.0;
        self.advance();

        if self.eat(CH_BRACE_OPEN) {
            let result = self.eat_property_expression()?;

            if result != SET_NONE && self.eat(CH_BRACE_CLOSE) {
                if negated && result == SET_STRINGS {
                    return self.raise("Invalid property name.");
                }

                return Ok(result);
            }
        }

        self.raise("Invalid property name.")
    }

    /// Reads the inside of `\p{…}`: either `Name=Value` or a lone name.
    fn eat_property_expression(&mut self) -> PResult<u8> {
        let start = self.pos;

        if self.eat_property_characters(false) && self.eat(CH_EQ) {
            let name = self.last_name.clone();

            if self.eat_property_characters(true) {
                let values = match name.as_str() {
                    "General_Category" | "gc" => Some(GENERAL_CATEGORY_VALUES),
                    "Script" | "sc" | "Script_Extensions" | "scx" => Some(SCRIPT_VALUES),
                    _ => None,
                };

                let Some(values) = values else {
                    return self.raise("Invalid property name.");
                };

                if !set_has(values, &self.last_name) {
                    return self.raise("Invalid property value.");
                }

                return Ok(SET_CHARS);
            }
        }

        self.pos = start;

        if !self.eat_property_characters(true) {
            return Ok(SET_NONE);
        }

        if set_has(BINARY_PROPERTIES, &self.last_name)
            || set_has(GENERAL_CATEGORY_VALUES, &self.last_name)
        {
            return Ok(SET_CHARS);
        }

        if self.unicode_sets && set_has(BINARY_PROPERTIES_OF_STRINGS, &self.last_name) {
            return Ok(SET_STRINGS);
        }

        self.raise("Invalid property name.")
    }

    /// Reads a run of property name or value characters into `last_name`.
    fn eat_property_characters(&mut self, digits: bool) -> bool {
        let start = self.pos;
        let mut code = self.current();

        while is_control_letter(code) || code == CH_UNDERSCORE || (digits && is_digit(code)) {
            self.advance();
            code = self.current();
        }

        self.last_name = String::from_utf16_lossy(&self.source[start..self.pos]);
        self.pos != start
    }

    /// Reads a `CharacterEscape`, leaving the character in `last_value`.
    fn eat_character_escape(&mut self) -> PResult<bool> {
        Ok(self.eat_control_escape()
            || self.eat_control_letter_escape()
            || self.eat_nul()
            || self.eat_hex_escape()?
            || self.eat_unicode_escape(false)?
            || (!self.unicode && self.eat_legacy_octal_escape())
            || self.eat_identity_escape())
    }

    /// Reads `\f`, `\n`, `\r`, `\t`, or `\v`.
    fn eat_control_escape(&mut self) -> bool {
        let value = match self.current() {
            code if code == CH_T_LOWER => 0x09,
            code if code == CH_N_LOWER => 0x0a,
            code if code == CH_V_LOWER => 0x0b,
            code if code == CH_F_LOWER => 0x0c,
            code if code == CH_R_LOWER => 0x0d,
            _ => return false,
        };

        self.last_value = value as f64;
        self.advance();
        true
    }

    /// Reads `\cX`, the control character named by a letter.
    fn eat_control_letter_escape(&mut self) -> bool {
        let start = self.pos;

        if self.eat(0x63) {
            if is_control_letter(self.current()) {
                self.last_value = (self.current() % 0x20) as f64;
                self.advance();
                return true;
            }

            self.pos = start;
        }

        false
    }

    /// Reads `\0`, which is the null character only when no digit follows.
    fn eat_nul(&mut self) -> bool {
        if self.current() == CH_0 && !is_digit(self.lookahead()) {
            self.last_value = 0.0;
            self.advance();
            return true;
        }

        false
    }

    /// Reads `\xHH`.
    fn eat_hex_escape(&mut self) -> PResult<bool> {
        let start = self.pos;

        if self.eat(0x78) {
            if self.eat_fixed_hex_digits(2) {
                return Ok(true);
            }

            if self.unicode {
                return self.raise("Invalid escape.");
            }

            self.pos = start;
        }

        Ok(false)
    }

    /// Reads `\uHHHH`, a surrogate pair, or `\u{…}`.
    fn eat_unicode_escape(&mut self, force_unicode: bool) -> PResult<bool> {
        let start = self.pos;
        let unicode = force_unicode || self.unicode;

        if !self.eat(CH_U_LOWER) {
            return Ok(false);
        }

        if self.eat_fixed_hex_digits(4) {
            let lead = self.last_value;

            if unicode && lead >= 55296.0 && lead <= 56319.0 {
                let after_lead = self.pos;

                if self.eat(CH_BACKSLASH) && self.eat(CH_U_LOWER) && self.eat_fixed_hex_digits(4) {
                    let trail = self.last_value;

                    if trail >= 56320.0 && trail <= 57343.0 {
                        self.last_value = (lead - 55296.0) * 1024.0 + (trail - 56320.0) + 65536.0;
                        return Ok(true);
                    }
                }

                self.pos = after_lead;
                self.last_value = lead;
            }

            return Ok(true);
        }

        if unicode
            && self.eat(CH_BRACE_OPEN)
            && self.eat_hex_digits()
            && self.eat(CH_BRACE_CLOSE)
            && self.last_value <= 1114111.0
        {
            return Ok(true);
        }

        if unicode {
            return self.raise("Invalid unicode escape.");
        }

        self.pos = start;
        Ok(false)
    }

    /// Reads a legacy octal escape, which only a pattern without `u` may have.
    fn eat_legacy_octal_escape(&mut self) -> bool {
        if !self.eat_octal_digit() {
            return false;
        }

        let first = self.last_value;

        if !self.eat_octal_digit() {
            self.last_value = first;
            return true;
        }

        let second = self.last_value;

        if first <= 3.0 && self.eat_octal_digit() {
            self.last_value = first * 64.0 + second * 8.0 + self.last_value;
        } else {
            self.last_value = first * 8.0 + second;
        }

        true
    }

    /// Reads one octal digit into `last_value`.
    fn eat_octal_digit(&mut self) -> bool {
        let code = self.current();

        if (CH_0..=CH_7).contains(&code) {
            self.last_value = (code - CH_0) as f64;
            self.advance();
            return true;
        }

        false
    }

    /// Reads `IdentityEscape`, a `\` in front of a character that means itself.
    fn eat_identity_escape(&mut self) -> bool {
        let code = self.current();

        if self.unicode {
            if is_syntax_character(code) || code == CH_SLASH {
                self.last_value = code as f64;
                self.advance();
                return true;
            }

            return false;
        }

        if code != -1 && code != 0x63 && !(self.named_groups && code == 0x6b) {
            self.last_value = code as f64;
            self.advance();
            return true;
        }

        false
    }

    //-------------------------------------------------------------------------
    // Character classes
    //-------------------------------------------------------------------------

    /// Reads `[…]`.
    fn eat_character_class(&mut self) -> PResult<bool> {
        if !self.eat(CH_BRACKET_OPEN) {
            return Ok(false);
        }

        let negated = self.eat(CH_CARET);
        let result = self.class_contents()?;

        if !self.eat(CH_BRACKET_CLOSE) {
            return self.raise("Unterminated character class.");
        }

        if negated && result == SET_STRINGS {
            return self.raise("Negated character class may contain strings.");
        }

        Ok(true)
    }

    /// Reads the inside of a class, in whichever of the two grammars applies.
    fn class_contents(&mut self) -> PResult<u8> {
        if self.current() == CH_BRACKET_CLOSE {
            return Ok(SET_CHARS);
        }

        if self.unicode_sets {
            return self.class_set_expression();
        }

        self.class_ranges()?;
        Ok(SET_CHARS)
    }

    /// Reads the ranges and atoms of a class without `v`.
    fn class_ranges(&mut self) -> PResult<()> {
        while self.eat_class_atom()? {
            let left = self.last_value;

            if self.eat(CH_MINUS) && self.eat_class_atom()? {
                let right = self.last_value;

                if self.unicode && (left == -1.0 || right == -1.0) {
                    return self.raise("Invalid character class.");
                }

                if left != -1.0 && right != -1.0 && left > right {
                    return self.raise("Range out of order in character class.");
                }
            }
        }

        Ok(())
    }

    /// Reads one atom of a class without `v`.
    fn eat_class_atom(&mut self) -> PResult<bool> {
        let start = self.pos;

        if self.eat(CH_BACKSLASH) {
            if self.eat_class_escape()? {
                return Ok(true);
            }

            if self.unicode {
                let code = self.current();

                if code == 0x63 || (CH_0..=CH_7).contains(&code) {
                    return self.raise("Invalid class escape.");
                }

                return self.raise("Invalid escape.");
            }

            self.pos = start;
        }

        let code = self.current();

        if code != CH_BRACKET_CLOSE && code != -1 {
            self.last_value = code as f64;
            self.advance();
            return Ok(true);
        }

        Ok(false)
    }

    /// Reads what may follow `\` inside a class without `v`.
    fn eat_class_escape(&mut self) -> PResult<bool> {
        let start = self.pos;

        if self.eat(CH_B_LOWER) {
            self.last_value = 8.0;
            return Ok(true);
        }

        if self.unicode && self.eat(CH_MINUS) {
            self.last_value = CH_MINUS as f64;
            return Ok(true);
        }

        if !self.unicode && self.eat(0x63) {
            let code = self.current();

            if is_digit(code) || code == CH_UNDERSCORE {
                self.last_value = (code % 0x20) as f64;
                self.advance();
                return Ok(true);
            }

            self.pos = start;
        }

        Ok(self.eat_character_class_escape()? != SET_NONE || self.eat_character_escape()?)
    }

    //-------------------------------------------------------------------------
    // Character classes under `v`
    //-------------------------------------------------------------------------

    /// Reads a `ClassSetExpression`: a union, an intersection, or a difference.
    fn class_set_expression(&mut self) -> PResult<u8> {
        let mut result = SET_CHARS;

        if self.eat_class_set_range()? {
            // A range opens a union, handled below.
        } else {
            let operand = self.eat_class_set_operand()?;

            if operand == SET_NONE {
                return self.raise("Invalid character in character class.");
            }

            if operand == SET_STRINGS {
                result = SET_STRINGS;
            }

            let start = self.pos;

            while self.eat_pair(CH_AMP, CH_AMP) {
                if self.current() == CH_AMP {
                    return self.raise("Invalid character in character class.");
                }

                let next = self.eat_class_set_operand()?;

                if next == SET_NONE {
                    return self.raise("Invalid character in character class.");
                }

                if next != SET_STRINGS {
                    result = SET_CHARS;
                }
            }

            if start != self.pos {
                return Ok(result);
            }

            while self.eat_pair(CH_MINUS, CH_MINUS) {
                if self.eat_class_set_operand()? == SET_NONE {
                    return self.raise("Invalid character in character class.");
                }
            }

            if start != self.pos {
                return Ok(result);
            }
        }

        loop {
            if self.eat_class_set_range()? {
                continue;
            }

            let operand = self.eat_class_set_operand()?;

            if operand == SET_NONE {
                return Ok(result);
            }

            if operand == SET_STRINGS {
                result = SET_STRINGS;
            }
        }
    }

    /// Reads `a-z` inside a `v`-mode class.
    fn eat_class_set_range(&mut self) -> PResult<bool> {
        let start = self.pos;

        if self.eat_class_set_character()? {
            let left = self.last_value;

            if self.eat(CH_MINUS) && self.eat_class_set_character()? {
                if left != -1.0 && self.last_value != -1.0 && left > self.last_value {
                    return self.raise("Range out of order in character class.");
                }

                return Ok(true);
            }

            self.pos = start;
        }

        Ok(false)
    }

    /// Reads one operand of a `v`-mode set expression.
    fn eat_class_set_operand(&mut self) -> PResult<u8> {
        if self.eat_class_set_character()? {
            return Ok(SET_CHARS);
        }

        let strings = self.eat_class_string_disjunction()?;

        if strings != SET_NONE {
            return Ok(strings);
        }

        self.eat_nested_class()
    }

    /// Reads a class nested inside another, or a `\p{…}` standing alone.
    fn eat_nested_class(&mut self) -> PResult<u8> {
        let start = self.pos;

        if self.eat(CH_BRACKET_OPEN) {
            let negated = self.eat(CH_CARET);
            let result = self.class_contents()?;

            if self.eat(CH_BRACKET_CLOSE) {
                if negated && result == SET_STRINGS {
                    return self.raise("Negated character class may contain strings.");
                }

                return Ok(result);
            }

            self.pos = start;
        }

        if self.eat(CH_BACKSLASH) {
            let result = self.eat_character_class_escape()?;

            if result != SET_NONE {
                return Ok(result);
            }

            self.pos = start;
        }

        Ok(SET_NONE)
    }

    /// Reads `\q{a|bc}`, the literal strings a `v`-mode class may hold.
    fn eat_class_string_disjunction(&mut self) -> PResult<u8> {
        let start = self.pos;

        if !self.eat_pair(CH_BACKSLASH, 0x71) {
            return Ok(SET_NONE);
        }

        if !self.eat(CH_BRACE_OPEN) {
            return self.raise("Invalid escape.");
        }

        let mut result = self.class_string()?;

        while self.eat(CH_PIPE) {
            if self.class_string()? == SET_STRINGS {
                result = SET_STRINGS;
            }
        }

        if self.eat(CH_BRACE_CLOSE) {
            return Ok(result);
        }

        self.pos = start;
        Ok(SET_NONE)
    }

    /// Reads one alternative of a `\q{…}`.
    fn class_string(&mut self) -> PResult<u8> {
        let mut count = 0;

        while self.eat_class_set_character()? {
            count += 1;
        }

        Ok(if count == 1 { SET_CHARS } else { SET_STRINGS })
    }

    /// Reads one character of a `v`-mode class.
    fn eat_class_set_character(&mut self) -> PResult<bool> {
        let start = self.pos;

        if self.eat(CH_BACKSLASH) {
            if self.eat_character_escape()? || self.eat_class_set_punctuator() {
                return Ok(true);
            }

            if self.eat(CH_B_LOWER) {
                self.last_value = 8.0;
                return Ok(true);
            }

            self.pos = start;
            return Ok(false);
        }

        let code = self.current();

        if code == -1 {
            return Ok(false);
        }

        if code == self.lookahead() && is_class_set_reserved_double_punctuator(code) {
            return Ok(false);
        }

        if is_class_set_syntax_character(code) {
            return Ok(false);
        }

        self.advance();
        self.last_value = code as f64;
        Ok(true)
    }

    /// Reads a punctuator that `v` mode requires be escaped.
    fn eat_class_set_punctuator(&mut self) -> bool {
        let code = self.current();

        if is_class_set_reserved_punctuator(code) {
            self.last_value = code as f64;
            self.advance();
            return true;
        }

        false
    }

    //-------------------------------------------------------------------------
    // Digits
    //-------------------------------------------------------------------------

    /// Reads a run of decimal digits into `last_value`.
    fn eat_decimal_digits(&mut self) -> bool {
        let start = self.pos;
        let mut value = 0.0f64;
        let mut code = self.current();

        while is_digit(code) {
            value = value * 10.0 + (code - CH_0) as f64;
            self.advance();
            code = self.current();
        }

        self.last_value = value;
        self.pos != start
    }

    /// Reads a run of hexadecimal digits into `last_value`.
    fn eat_hex_digits(&mut self) -> bool {
        let start = self.pos;
        let mut value = 0.0f64;
        let mut code = self.current();

        while is_hex_digit(code) {
            value = value * 16.0 + hex_value(code);
            self.advance();
            code = self.current();
        }

        self.last_value = value;
        self.pos != start
    }

    /// Reads exactly as many hexadecimal digits as asked for.
    fn eat_fixed_hex_digits(&mut self, count: usize) -> bool {
        let start = self.pos;
        let mut value = 0.0f64;

        for _ in 0..count {
            let code = self.current();

            if !is_hex_digit(code) {
                self.pos = start;
                return false;
            }

            value = value * 16.0 + hex_value(code);
            self.advance();
        }

        self.last_value = value;
        true
    }
}
