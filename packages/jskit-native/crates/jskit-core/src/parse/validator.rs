//! The validation phase.
//!
//! Port of `packages/jskit/src/parse/validate.ts`, method for method, so the
//! two implementations can be read side by side. Parsing accepts the union
//! of everything JavaScript and TypeScript allow; this pass walks the buffer
//! and reports the problems that only become problems once you know how the
//! program is meant to be interpreted. The problems come back in the same
//! order, with the same messages, as the TypeScript validator produces —
//! that equivalence is what the differential tooling checks.

use super::binary::{
    PARSE_HEADER_LIST_OFFSET, PARSE_HEADER_NODES_OFFSET, PARSE_HEADER_NODE_BYTES,
    PARSE_HEADER_ROOT,
};
use super::chars::{
    char_flags, is_non_ascii_space, ASCII_LIMIT, CH_BACKSLASH, CH_LINE_SEPARATOR,
    CH_PARAGRAPH_SEPARATOR, CH_QUOTE_DOUBLE, CH_QUOTE_SINGLE, CH_UNDERSCORE, MASK_NEWLINE,
    MASK_SPACE,
};
use super::node_kinds::{
    ACCESS_MASK, DECL_AWAIT_USING, DECL_CONST, DECL_SHIFT, DECL_USING, DECL_VAR, IDWORD_SHIFT,
    LIT_BIGINT, LIT_NUMBER, LIT_REGEXP, LIT_STRING, MKIND_CONSTRUCTOR, MKIND_GET, MKIND_SET,
    MKIND_SHIFT, MODULE_MODULE, NF_ASYNC, NF_COMMA_AFTER_REST, NF_COMPUTED, NF_DECLARE,
    NF_DEFINITE, NF_GENERATOR, NF_IDENTIFIER_ESCAPED, NF_IDENTIFIER_NAME, NF_IN,
    NF_INVALID_ESCAPE, NF_LEGACY_OCTAL, NF_METHOD, NF_OPTIONAL, NF_PARENTHESIZED, NF_READONLY,
    NF_SHORTHAND, NF_STATIC, NF_TYPE_ONLY, NF_USE_STRICT, NODE_A, NODE_B, NODE_C, NODE_D, NODE_E,
    NODE_END, NODE_F, NODE_FLAGS, NODE_KIND, NODE_KIND_COUNT, NODE_START, N_ACCESSOR_PROPERTY,
    N_ARRAY_PATTERN, N_ARROW_FUNCTION_EXPRESSION, N_ASSIGNMENT_EXPRESSION, N_ASSIGNMENT_PATTERN,
    N_AWAIT_EXPRESSION, N_BINARY_EXPRESSION, N_BLOCK_STATEMENT, N_BREAK_STATEMENT,
    N_CALL_EXPRESSION, N_CATCH_CLAUSE, N_CHAIN_EXPRESSION, N_CLASS_DECLARATION,
    N_CLASS_EXPRESSION, N_CONTINUE_STATEMENT, N_DO_WHILE_STATEMENT, N_EXPORT_ALL_DECLARATION,
    N_EXPORT_DEFAULT_DECLARATION, N_EXPORT_NAMED_DECLARATION, N_EXPORT_SPECIFIER,
    N_EXPRESSION_STATEMENT, N_FOR_IN_STATEMENT, N_FOR_OF_STATEMENT, N_FOR_STATEMENT,
    N_FUNCTION_DECLARATION, N_FUNCTION_EXPRESSION, N_IDENTIFIER, N_IF_STATEMENT,
    N_IMPORT_DECLARATION, N_IMPORT_DEFAULT_SPECIFIER, N_IMPORT_SPECIFIER, N_JSX_ELEMENT,
    N_JSX_FRAGMENT, N_LABELED_STATEMENT, N_LITERAL, N_MEMBER_EXPRESSION, N_META_PROPERTY,
    N_METHOD_DEFINITION, N_OBJECT_EXPRESSION, N_OBJECT_PATTERN, N_PRIVATE_IDENTIFIER, N_PROPERTY,
    N_PROPERTY_DEFINITION, N_REST_ELEMENT, N_RETURN_STATEMENT, N_STATIC_BLOCK, N_SUPER,
    N_SWITCH_STATEMENT, N_TAGGED_TEMPLATE_EXPRESSION, N_TEMPLATE_LITERAL,
    N_TS_ABSTRACT_ACCESSOR_PROPERTY, N_TS_ABSTRACT_METHOD_DEFINITION,
    N_TS_ABSTRACT_PROPERTY_DEFINITION, N_TS_AS_EXPRESSION, N_TS_DECLARE_FUNCTION,
    N_TS_EMPTY_BODY_FUNCTION_EXPRESSION, N_TS_ENUM_DECLARATION, N_TS_ENUM_MEMBER,
    N_TS_IMPORT_EQUALS_DECLARATION, N_TS_INDEX_SIGNATURE, N_TS_INTERFACE_DECLARATION,
    N_TS_LITERAL_TYPE, N_TS_MODULE_BLOCK, N_TS_MODULE_DECLARATION, N_TS_NON_NULL_EXPRESSION,
    N_TS_PARAMETER_PROPERTY, N_TS_SATISFIES_EXPRESSION, N_TS_TYPE_ALIAS_DECLARATION,
    N_TS_TYPE_ASSERTION, N_TS_TYPE_PARAMETER_DECLARATION, N_TS_TYPE_PARAMETER_INSTANTIATION,
    N_UNARY_EXPRESSION, N_UPDATE_EXPRESSION, N_VARIABLE_DECLARATION, N_WHILE_STATEMENT,
    N_WITH_STATEMENT, N_YIELD_EXPRESSION,
};
use super::regexp::RegExpValidator;
use super::slots::{SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE};
use super::token_kinds::{
    hash_char, lookup_keyword, KEYWORD_FIRST, KEYWORD_LAST, KEYWORD_NAMES, KIND_COUNT,
    KIND_IDWORD_CODES, KIND_KEYWORD_FLAGS, KW_RESERVED, KW_STRICT_RESERVED, T_ASSIGN,
    T_ASSIGN_AMPAMP, T_AWAIT, T_DELETE, T_IN, T_LET, T_THIS, T_YIELD,
};
use super::values::decode_escapes;
use std::collections::{HashMap, HashSet};

/// A problem found during validation.
pub struct ValidationProblem {
    /// A description of the problem, as UTF-16 code units.
    ///
    /// UTF-16 rather than a `String` because a message can quote a name the
    /// program wrote as a string literal, and a string literal can spell a
    /// lone surrogate — which a JavaScript string represents and a Rust
    /// `String` cannot. The binding turns the units into a JavaScript string
    /// directly, so the message crosses without loss.
    pub message: Vec<u16>,

    /// The offset where the problem begins.
    pub start: u32,
}

/// How the program should be interpreted.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ValidateSourceType {
    Script,
    Module,
    CommonJs,
}

/// The kind of the first TypeScript-only node kind.
const TS_FIRST: u32 = 100;

/// The packed-field masks `node-kinds.ts` derives from the shifts.
const IDWORD_MASK: u32 = 15 << IDWORD_SHIFT;
const DECL_MASK: u32 = 7 << DECL_SHIFT;
const MKIND_MASK: u32 = 7 << MKIND_SHIFT;
const MODULE_KIND_MASK: u32 = 7 << MKIND_SHIFT;

/// The declaration keyword spellings, indexed by the packed value.
const DECL_KIND_NAMES: [&str; 5] = ["var", "let", "const", "using", "await using"];

/// How a binding was introduced, which decides what may shadow it.
const BINDING_VAR: u32 = 0;
const BINDING_LEXICAL: u32 = 1;
const BINDING_FUNCTION: u32 = 2;
const BINDING_PARAM: u32 = 3;
const BINDING_TYPE: u32 = 4;
const BINDING_SIGNATURE: u32 = 5;
const BINDING_CATCH: u32 = 6;
const BINDING_AMBIENT_CLASS: u32 = 7;
const BINDING_ASYNC_OR_GENERATOR: u32 = 8;

/// The letters `arguments` and `eval` begin with, plus `1` for `let` checks.
const CH_A_SMALL: i32 = 0x61;
const CH_E_SMALL: i32 = 0x65;

/// The bits of a name's info word holding the binding kind, plus one.
const NAME_BINDING: i32 = 0xff;

/// The bit of a name's info word saying a `var` of the name climbs through.
const NAME_VAR: i32 = 1 << 8;

/// Which keyword an identifier word code stands for; the inverse of
/// `KIND_IDWORD_CODES`, matching `IDWORD_KINDS` in `token-kinds.ts`.
const IDWORD_KINDS: [u32; 64] = build_idword_kinds();

/// The code `KIND_IDWORD_CODES` gives every plain `ReservedWord`.
const IDWORD_RESERVED: u32 = 1;

const fn build_idword_kinds() -> [u32; 64] {
    let mut table = [0u32; 64];
    let mut kind = 0;

    while kind < KIND_COUNT {
        let code = KIND_IDWORD_CODES[kind];

        if code > 1 {
            table[code as usize] = kind as u32;
        }

        kind += 1;
    }

    table
}

/// Which node kinds `visit()` has a case of its own for, indexed by kind.
const VISIT_CASES: [u8; NODE_KIND_COUNT] = build_visit_cases();

const fn build_visit_cases() -> [u8; NODE_KIND_COUNT] {
    let mut table = [0u8; NODE_KIND_COUNT];
    let kinds = [
        N_LABELED_STATEMENT,
        N_BLOCK_STATEMENT,
        N_STATIC_BLOCK,
        N_TS_MODULE_BLOCK,
        N_SWITCH_STATEMENT,
        N_FOR_STATEMENT,
        N_FOR_IN_STATEMENT,
        N_FOR_OF_STATEMENT,
        N_WHILE_STATEMENT,
        N_DO_WHILE_STATEMENT,
        N_CATCH_CLAUSE,
        N_FUNCTION_DECLARATION,
        N_FUNCTION_EXPRESSION,
        N_TS_DECLARE_FUNCTION,
        N_TS_EMPTY_BODY_FUNCTION_EXPRESSION,
        N_ARROW_FUNCTION_EXPRESSION,
        N_METHOD_DEFINITION,
        N_TS_ABSTRACT_METHOD_DEFINITION,
        N_PROPERTY,
        N_PROPERTY_DEFINITION,
        N_TS_ABSTRACT_PROPERTY_DEFINITION,
        N_ACCESSOR_PROPERTY,
        N_CLASS_DECLARATION,
        N_CLASS_EXPRESSION,
        N_TS_MODULE_DECLARATION,
        N_TS_LITERAL_TYPE,
        N_TAGGED_TEMPLATE_EXPRESSION,
        N_JSX_ELEMENT,
        N_JSX_FRAGMENT,
    ];
    let mut i = 0;

    while i < kinds.len() {
        table[kinds[i] as usize] = 1;
        i += 1;
    }

    table
}

/// Which node kinds `check()` has a case for, indexed by kind.
const CHECKED_KINDS: [u8; NODE_KIND_COUNT] = build_checked_kinds();

const fn build_checked_kinds() -> [u8; NODE_KIND_COUNT] {
    let mut table = [0u8; NODE_KIND_COUNT];
    let kinds = [
        N_PROPERTY_DEFINITION,
        N_ACCESSOR_PROPERTY,
        N_TS_ABSTRACT_PROPERTY_DEFINITION,
        N_TS_ABSTRACT_ACCESSOR_PROPERTY,
        N_METHOD_DEFINITION,
        N_TS_PARAMETER_PROPERTY,
        N_TS_INDEX_SIGNATURE,
        N_TS_TYPE_PARAMETER_DECLARATION,
        N_TS_TYPE_PARAMETER_INSTANTIATION,
        N_TS_ENUM_MEMBER,
        N_TS_MODULE_DECLARATION,
        N_CLASS_DECLARATION,
        N_CLASS_EXPRESSION,
        N_TS_INTERFACE_DECLARATION,
        N_TS_TYPE_ALIAS_DECLARATION,
        N_TS_ABSTRACT_METHOD_DEFINITION,
        N_IMPORT_DECLARATION,
        N_EXPORT_NAMED_DECLARATION,
        N_EXPORT_DEFAULT_DECLARATION,
        N_EXPORT_ALL_DECLARATION,
        N_BREAK_STATEMENT,
        N_CONTINUE_STATEMENT,
        N_PRIVATE_IDENTIFIER,
        N_TEMPLATE_LITERAL,
        N_WITH_STATEMENT,
        N_IF_STATEMENT,
        N_LABELED_STATEMENT,
        N_WHILE_STATEMENT,
        N_DO_WHILE_STATEMENT,
        N_FOR_STATEMENT,
        N_MEMBER_EXPRESSION,
        N_CALL_EXPRESSION,
        N_SUPER,
        N_BINARY_EXPRESSION,
        N_UNARY_EXPRESSION,
        N_ASSIGNMENT_EXPRESSION,
        N_UPDATE_EXPRESSION,
        N_FOR_IN_STATEMENT,
        N_FOR_OF_STATEMENT,
        N_LITERAL,
        N_YIELD_EXPRESSION,
        N_AWAIT_EXPRESSION,
        N_PROPERTY,
        N_OBJECT_EXPRESSION,
        N_CHAIN_EXPRESSION,
        N_META_PROPERTY,
        N_IMPORT_SPECIFIER,
        N_EXPORT_SPECIFIER,
        N_JSX_ELEMENT,
        N_JSX_FRAGMENT,
        N_RETURN_STATEMENT,
    ];
    let mut i = 0;

    while i < kinds.len() {
        table[kinds[i] as usize] = 1;
        i += 1;
    }

    table
}

/// Determines whether a character is JSX tag-name whitespace.
fn is_jsx_name_space(code: i32) -> bool {
    if code < ASCII_LIMIT {
        return (char_flags(code) & (MASK_SPACE | MASK_NEWLINE)) != 0;
    }

    code == CH_LINE_SEPARATOR || code == CH_PARAGRAPH_SEPARATOR || is_non_ascii_space(code)
}

/// Determines whether a node kind is an iteration statement.
fn is_iteration(kind: u32) -> bool {
    kind == N_FOR_STATEMENT
        || kind == N_FOR_IN_STATEMENT
        || kind == N_FOR_OF_STATEMENT
        || kind == N_WHILE_STATEMENT
        || kind == N_DO_WHILE_STATEMENT
}

/// Determines whether a binding is one a function declaration made.
fn is_function_binding(binding: u32) -> bool {
    binding == BINDING_FUNCTION || binding == BINDING_ASYNC_OR_GENERATOR
}

/// Determines whether a string holds only paired surrogates.
fn is_well_formed_unicode(value: &[u16]) -> bool {
    let mut i = 0;

    while i < value.len() {
        let code = value[i];

        if !(0xd800..=0xdfff).contains(&code) {
            i += 1;
            continue;
        }

        if code > 0xdbff || i + 1 == value.len() {
            return false;
        }

        let next = value[i + 1];

        if !(0xdc00..=0xdfff).contains(&next) {
            return false;
        }

        i += 2;
    }

    true
}

/// Determines whether the source contains an ASCII sequence.
fn contains_ascii(source: &[u16], needle: &[u8]) -> bool {
    if source.len() < needle.len() {
        return false;
    }

    'outer: for start in 0..=(source.len() - needle.len()) {
        for (offset, &byte) in needle.iter().enumerate() {
            if source[start + offset] != byte as u16 {
                continue 'outer;
            }
        }

        return true;
    }

    false
}

/// Determines whether a UTF-16 slice spells an ASCII string.
fn eq_ascii(text: &[u16], ascii: &[u8]) -> bool {
    text.len() == ascii.len() && text.iter().zip(ascii).all(|(&unit, &byte)| unit == byte as u16)
}

/// Renders a UTF-16 name for a message.
///
/// Lossy conversion is exact here: every caller quotes an identifier, and an
/// identifier can never contain a lone surrogate. The two messages that can
/// quote a *string* use `compose()` instead.
fn name_of(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// Builds a message quoting a name, keeping the name's exact code units.
fn compose(prefix: &str, name: &[u16], suffix: &str) -> Vec<u16> {
    let mut message: Vec<u16> = prefix.encode_utf16().collect();

    message.extend_from_slice(name);
    message.extend(suffix.encode_utf16());
    message
}

/// The slice of `AstReader` the walk needs, over the raw buffer words.
#[derive(Clone, Copy)]
struct Ast<'a> {
    words: &'a [u32],
    source: &'a [u16],
    nodes_base: usize,
    lists_base: usize,
    node_words: usize,
    root: u32,
}

impl<'a> Ast<'a> {
    fn new(words: &'a [u32], source: &'a [u16]) -> Self {
        Ast {
            words,
            source,
            nodes_base: (words[PARSE_HEADER_NODES_OFFSET] / 4) as usize,
            lists_base: (words[PARSE_HEADER_LIST_OFFSET] / 4) as usize,
            node_words: (words[PARSE_HEADER_NODE_BYTES] / 4) as usize,
            root: words[PARSE_HEADER_ROOT],
        }
    }

    #[inline]
    fn field(&self, node: u32, word: usize) -> u32 {
        self.words[self.nodes_base + node as usize * self.node_words + word]
    }

    #[inline]
    fn kind(&self, node: u32) -> u32 {
        self.field(node, NODE_KIND)
    }

    #[inline]
    fn start(&self, node: u32) -> u32 {
        self.field(node, NODE_START)
    }

    #[inline]
    fn end(&self, node: u32) -> u32 {
        self.field(node, NODE_END)
    }

    #[inline]
    fn flags(&self, node: u32) -> u32 {
        self.field(node, NODE_FLAGS)
    }

    #[inline]
    fn list_size(&self, handle: u32) -> u32 {
        if handle == 0 {
            0
        } else {
            self.words[self.lists_base + handle as usize]
        }
    }

    #[inline]
    fn list_item(&self, handle: u32, index: u32) -> u32 {
        self.words[self.lists_base + handle as usize + 1 + index as usize]
    }

    fn text(&self, node: u32) -> &'a [u16] {
        &self.source[self.start(node) as usize..self.end(node) as usize]
    }
}

/// One scope's bindings, keyed by spelling without making the spellings
/// strings — see `NameTable` in `validate.ts` for the design.
struct NameTable {
    /// Slot words: hash, start, end, info.
    slots: Vec<i32>,

    /// How many slots are occupied.
    used: usize,

    /// Decoded spellings of escaped names; a negative start indexes here.
    spill: Vec<Vec<u16>>,

    /// The slot the last `find()` landed on, or `-1`.
    last_slot: i32,
}

impl NameTable {
    fn new() -> Self {
        NameTable {
            slots: vec![0; 8 * 4],
            used: 0,
            spill: Vec::new(),
            last_slot: -1,
        }
    }

    /// Empties the table so another scope can use it.
    fn reset(&mut self) {
        if self.used != 0 {
            self.slots.fill(0);
            self.used = 0;
            self.spill.clear();
        }

        self.last_slot = -1;
    }

    /// Looks a name up, returning its info word or `0`.
    fn find(&mut self, source: &[u16], hash: i32, start: i32, end: i32, name: Option<&[u16]>) -> i32 {
        let slot = self.probe(source, hash, start, end, name);

        self.last_slot = slot as i32;
        self.slots[slot + 3]
    }

    /// Records how a name is introduced, keeping any `var` bit it carries.
    fn bind(
        &mut self,
        source: &[u16],
        hash: i32,
        start: i32,
        end: i32,
        name: Option<&[u16]>,
        binding: u32,
    ) {
        let slot = self.insert(source, hash, start, end, name);

        self.slots[slot + 3] = (self.slots[slot + 3] & NAME_VAR) | (binding as i32 + 1);
    }

    /// Records that a `var` of the name binds here, keeping any binding kind.
    fn add_var(&mut self, source: &[u16], hash: i32, start: i32, end: i32, name: Option<&[u16]>) {
        let slot = self.insert(source, hash, start, end, name);

        self.slots[slot + 3] |= NAME_VAR;
    }

    /// Determines whether a name, given as text, is bound here at all.
    fn has_name(&mut self, source: &[u16], name: &[u16]) -> bool {
        let mut hash = 0;

        for &unit in name {
            hash = hash_char(hash, unit as i32);
        }

        let slot = self.probe(source, hash, 0, 0, Some(name));

        self.slots[slot + 3] != 0
    }

    /// Finds the slot a name lives in, or the empty slot it would go into.
    fn probe(&self, source: &[u16], hash: i32, start: i32, end: i32, name: Option<&[u16]>) -> usize {
        let mask = (self.slots.len() - 4) as i32;
        let mut slot = (hash.wrapping_shl(2) & mask) as usize;

        loop {
            if self.slots[slot + 3] == 0 {
                return slot;
            }

            if self.slots[slot] == hash && self.matches(source, slot, start, end, name) {
                return slot;
            }

            slot = ((slot as i32 + 4) & mask) as usize;
        }
    }

    /// Compares a slot's name against the one being probed for.
    fn matches(
        &self,
        source: &[u16],
        slot: usize,
        start: i32,
        end: i32,
        name: Option<&[u16]>,
    ) -> bool {
        let entry_start = self.slots[slot + 1];

        if entry_start < 0 {
            let spelled = &self.spill[!entry_start as usize];

            if let Some(name) = name {
                return spelled == name;
            }

            if spelled.len() != (end - start) as usize {
                return false;
            }

            for (i, &unit) in spelled.iter().enumerate() {
                if unit != source[start as usize + i] {
                    return false;
                }
            }

            return true;
        }

        let entry_end = self.slots[slot + 2];

        if let Some(name) = name {
            if name.len() != (entry_end - entry_start) as usize {
                return false;
            }

            for (i, &unit) in name.iter().enumerate() {
                if unit != source[entry_start as usize + i] {
                    return false;
                }
            }

            return true;
        }

        if entry_end - entry_start != end - start {
            return false;
        }

        let mut i = start as usize;
        let mut j = entry_start as usize;

        while i < end as usize {
            if source[i] != source[j] {
                return false;
            }

            i += 1;
            j += 1;
        }

        true
    }

    /// Finds a name's slot, claiming an empty one for it if it has none yet.
    fn insert(&mut self, source: &[u16], hash: i32, start: i32, end: i32, name: Option<&[u16]>) -> usize {
        let mut slot;

        if self.last_slot == -1 {
            slot = self.probe(source, hash, start, end, name);
        } else {
            slot = self.last_slot as usize;
            self.last_slot = -1;
        }

        if self.slots[slot + 3] != 0 {
            return slot;
        }

        // Grow at three quarters full, before the probe chains stretch.
        if (self.used + 1) * 16 > self.slots.len() * 3 {
            self.grow();
            slot = self.probe(source, hash, start, end, name);
        }

        self.used += 1;
        self.slots[slot] = hash;

        match name {
            None => {
                self.slots[slot + 1] = start;
                self.slots[slot + 2] = end;
            }
            Some(name) => {
                self.slots[slot + 1] = !(self.spill.len() as i32);
                self.slots[slot + 2] = 0;
                self.spill.push(name.to_vec());
            }
        }

        slot
    }

    /// Doubles the table, redistributing every occupied slot.
    fn grow(&mut self) {
        let old = std::mem::replace(&mut self.slots, vec![0; 0]);
        let mut grown = vec![0i32; old.len() * 2];
        let mask = (grown.len() - 4) as i32;

        for i in (0..old.len()).step_by(4) {
            if old[i + 3] == 0 {
                continue;
            }

            let mut slot = (old[i].wrapping_shl(2) & mask) as usize;

            while grown[slot + 3] != 0 {
                slot = ((slot as i32 + 4) & mask) as usize;
            }

            grown[slot] = old[i];
            grown[slot + 1] = old[i + 1];
            grown[slot + 2] = old[i + 2];
            grown[slot + 3] = old[i + 3];
        }

        self.slots = grown;
    }
}

/// One lexical scope's bindings.
struct Scope {
    /// Names bound where they are written; `None` until the first binding.
    names: Option<NameTable>,

    /// Whether `var` declarations stop climbing here.
    is_function_scope: bool,

    /// Whether a function declaration written directly here binds here.
    functions_are_lexical: bool,
}

/// A label a `break` may name.
struct Label {
    name: Vec<u16>,
    iteration: bool,
}

/// Walks a parsed program and reports context-dependent problems.
pub fn validate_ast(
    parse_words: &[u32],
    source: &[u16],
    source_type: ValidateSourceType,
    dialect_js: bool,
    jsx: bool,
    declaration: bool,
) -> Vec<ValidationProblem> {
    let ast = Ast::new(parse_words, source);
    let mut validator = Validator::new(ast, source_type, dialect_js, jsx, declaration);

    validator.run();
    validator.problems
}

/// Implements the validation walk. Field for field, this is the TypeScript
/// `Validator` class; see `validate.ts` for the commentary on each rule.
struct Validator<'a> {
    problems: Vec<ValidationProblem>,
    ast: Ast<'a>,
    source_type: ValidateSourceType,
    dialect_js: bool,
    variant_type_parameters: HashSet<u32>,
    permitted_parameter_properties: HashSet<u32>,
    anonymous_class_allowed: u32,
    jsx: bool,
    strict: bool,
    function_depth: u32,
    in_jsx: bool,
    scopes: Vec<Scope>,
    unique_params: bool,
    in_method: bool,
    private_names: Vec<HashSet<Vec<u16>>>,
    permitted_private_names: HashSet<u32>,
    in_generator: bool,
    in_async: bool,
    await_reserved: bool,
    super_property_allowed: bool,
    super_call_allowed: bool,
    in_derived_class: bool,
    in_derived_constructor: bool,
    sanctioned_super: u32,
    in_parameters: bool,
    in_static_block: bool,
    new_target_allowed: bool,
    labels: Vec<Label>,
    label_floor: usize,
    iteration_depth: u32,
    switch_depth: u32,
    tagged_quasi: u32,
    type_quasi: u32,
    saw_constructor: bool,
    in_statement_list: bool,
    module_items_allowed: bool,
    ambient: bool,
    mentions_arguments: Option<bool>,
    hashed_name: Option<Vec<u16>>,
    table_pool: Vec<NameTable>,
}

impl<'a> Validator<'a> {
    fn new(
        ast: Ast<'a>,
        source_type: ValidateSourceType,
        dialect_js: bool,
        jsx: bool,
        declaration: bool,
    ) -> Self {
        Validator {
            problems: Vec::new(),
            ast,
            source_type,
            dialect_js,
            variant_type_parameters: HashSet::new(),
            permitted_parameter_properties: HashSet::new(),
            anonymous_class_allowed: 0,
            jsx,
            strict: source_type == ValidateSourceType::Module,
            function_depth: if source_type == ValidateSourceType::CommonJs {
                1
            } else {
                0
            },
            in_jsx: false,
            scopes: vec![Scope {
                names: None,
                is_function_scope: true,
                functions_are_lexical: source_type == ValidateSourceType::Module,
            }],
            unique_params: false,
            in_method: false,
            private_names: Vec::new(),
            permitted_private_names: HashSet::new(),
            in_generator: false,
            in_async: false,
            // A module reserves `await` everywhere in it.
            await_reserved: source_type == ValidateSourceType::Module,
            super_property_allowed: false,
            super_call_allowed: false,
            in_derived_class: false,
            in_derived_constructor: false,
            sanctioned_super: 0,
            in_parameters: false,
            in_static_block: false,
            new_target_allowed: false,
            labels: Vec::new(),
            label_floor: 0,
            iteration_depth: 0,
            switch_depth: 0,
            tagged_quasi: 0,
            type_quasi: 0,
            saw_constructor: false,
            in_statement_list: false,
            module_items_allowed: false,
            ambient: declaration,
            mentions_arguments: None,
            hashed_name: None,
            table_pool: Vec::new(),
        }
    }

    /// Runs every check over the whole program.
    fn run(&mut self) {
        let root = self.ast.root;

        if !self.strict && self.has_use_strict_directive(root) {
            self.strict = true;
        }

        let body = self.ast.field(root, NODE_A);

        self.hoist(body, self.source_type == ValidateSourceType::Module);
        self.visit_module_items(body);

        if self.source_type == ValidateSourceType::Module {
            self.check_module_exports(body);
        }
    }

    /// Reports a problem.
    fn report(&mut self, message: Vec<u16>, start: u32) {
        self.problems.push(ValidationProblem { message, start });
    }

    /// Reports a problem whose message is a fixed string.
    fn report_str(&mut self, message: &str, start: u32) {
        self.report(message.encode_utf16().collect(), start);
    }

    /// Reports a problem whose message was formatted from ASCII-safe parts.
    fn report_string(&mut self, message: String, start: u32) {
        self.report(message.encode_utf16().collect(), start);
    }

    /// Determines whether a body begins with a `"use strict"` directive.
    fn has_use_strict_directive(&self, node: u32) -> bool {
        let ast = self.ast;
        let body = ast.field(node, NODE_A);
        let size = ast.list_size(body);

        for i in 0..size {
            let statement = ast.list_item(body, i);

            if ast.kind(statement) != N_EXPRESSION_STATEMENT || ast.field(statement, NODE_B) != 1 {
                return false;
            }

            if (ast.flags(statement) & NF_USE_STRICT) != 0 {
                return true;
            }
        }

        false
    }

    //-------------------------------------------------------------------------
    // Traversal
    //-------------------------------------------------------------------------

    /// Visits a node and everything below it.
    fn visit(&mut self, node: u32) {
        if node == 0 {
            return;
        }

        let ast = self.ast;
        let kind = ast.kind(node);

        if kind == N_IDENTIFIER {
            let flags = ast.flags(node);

            if (flags & (NF_IDENTIFIER_NAME | IDWORD_MASK | NF_IDENTIFIER_ESCAPED)) != 0
                && (flags & NF_IDENTIFIER_NAME) == 0
            {
                let word = if (flags & IDWORD_MASK) != 0 {
                    IDWORD_KINDS[((flags & IDWORD_MASK) >> IDWORD_SHIFT) as usize]
                } else {
                    self.keyword_at(node)
                };

                self.check_reserved_word(word, ast.start(node));
            }
        } else if CHECKED_KINDS[kind as usize] != 0 || (kind >= TS_FIRST && self.dialect_js) {
            self.check(node, kind);
        }

        let was_in_statement_list = self.in_statement_list;

        self.module_items_allowed = false;
        self.in_statement_list = false;

        // Most kinds only descend; see `VISIT_CASES`.
        if VISIT_CASES[kind as usize] == 0 {
            self.visit_children(node, kind);
            return;
        }

        match kind {
            N_LABELED_STATEMENT => {
                let body = ast.field(node, NODE_B);
                let name = self.identifier_name(ast.field(node, NODE_A));

                for i in self.label_floor..self.labels.len() {
                    if self.labels[i].name == name {
                        self.report_string(
                            format!("Label '{}' has already been declared.", name_of(&name)),
                            ast.start(node),
                        );

                        break;
                    }
                }

                let mut target = body;

                while target != 0 && ast.kind(target) == N_LABELED_STATEMENT {
                    target = ast.field(target, NODE_B);
                }

                self.labels.push(Label {
                    name,
                    iteration: target != 0 && is_iteration(ast.kind(target)),
                });
                self.visit(ast.field(node, NODE_A));
                self.in_statement_list = was_in_statement_list;
                self.visit(body);
                self.in_statement_list = false;
                self.labels.pop();
            }

            N_TAGGED_TEMPLATE_EXPRESSION => {
                self.visit(ast.field(node, NODE_A));
                self.visit(ast.field(node, NODE_C));
                self.tagged_quasi = ast.field(node, NODE_B);
                self.visit(self.tagged_quasi);
            }

            N_TS_LITERAL_TYPE => {
                let literal = ast.field(node, NODE_A);

                if ast.kind(literal) == N_TEMPLATE_LITERAL {
                    self.type_quasi = literal;
                }

                self.visit(literal);
            }

            N_FUNCTION_DECLARATION
            | N_FUNCTION_EXPRESSION
            | N_ARROW_FUNCTION_EXPRESSION
            | N_TS_DECLARE_FUNCTION
            | N_TS_EMPTY_BODY_FUNCTION_EXPRESSION => {
                self.visit_function(node);
            }

            N_BLOCK_STATEMENT => {
                self.enter_scope(false);
                self.hoist(ast.field(node, NODE_A), true);
                self.visit_children(node, kind);
                self.exit_scope();
            }

            N_TS_MODULE_DECLARATION => {
                let previous_ambient = self.ambient;

                self.ambient = previous_ambient || (ast.flags(node) & NF_DECLARE) != 0;
                self.visit_children(node, kind);
                self.ambient = previous_ambient;
            }

            N_STATIC_BLOCK | N_TS_MODULE_BLOCK => {
                let was_await = self.await_reserved;
                let was_generator = self.in_generator;
                let was_super_property = self.super_property_allowed;
                let was_super_call = self.super_call_allowed;
                let previous_label_floor = self.label_floor;

                if kind == N_STATIC_BLOCK {
                    self.label_floor = self.labels.len();
                }

                let previous_iteration_depth = self.iteration_depth;
                let previous_switch_depth = self.switch_depth;
                let previous_function_depth = self.function_depth;
                let previous_static_block = self.in_static_block;
                let previous_new_target = self.new_target_allowed;

                if kind == N_STATIC_BLOCK {
                    self.await_reserved = true;
                    self.in_generator = false;
                    self.function_depth = 0;
                    self.in_static_block = true;
                    self.new_target_allowed = true;
                    self.iteration_depth = 0;
                    self.switch_depth = 0;
                    self.super_property_allowed = true;
                    self.super_call_allowed = false;

                    let found = self.find_arguments_in_list(ast.field(node, NODE_A));

                    self.check_no_arguments(found, "a class static block");
                }

                self.enter_scope(true);
                self.hoist(ast.field(node, NODE_A), true);

                if kind == N_TS_MODULE_BLOCK {
                    self.visit_module_items(ast.field(node, NODE_A));
                } else {
                    self.visit_children(node, kind);
                }

                self.exit_scope();

                if kind == N_STATIC_BLOCK {
                    self.label_floor = previous_label_floor;
                    self.iteration_depth = previous_iteration_depth;
                    self.switch_depth = previous_switch_depth;
                    self.function_depth = previous_function_depth;
                    self.in_static_block = previous_static_block;
                    self.new_target_allowed = previous_new_target;
                }

                self.await_reserved = was_await;
                self.in_generator = was_generator;
                self.super_property_allowed = was_super_property;
                self.super_call_allowed = was_super_call;
            }

            N_SWITCH_STATEMENT => {
                let cases = ast.field(node, NODE_B);
                let size = ast.list_size(cases);
                let mut saw_default = false;

                self.enter_scope(false);

                for i in 0..size {
                    let clause = ast.list_item(cases, i);

                    if ast.field(clause, NODE_A) == 0 {
                        if saw_default {
                            self.report_str(
                                "A switch statement may only have one default clause.",
                                ast.start(clause),
                            );
                        }

                        saw_default = true;
                    }

                    self.hoist(ast.field(clause, NODE_B), false);
                }

                self.switch_depth += 1;
                self.visit_children(node, kind);
                self.switch_depth -= 1;
                self.exit_scope();
            }

            N_FOR_STATEMENT | N_FOR_IN_STATEMENT | N_FOR_OF_STATEMENT => {
                let head = ast.field(node, NODE_A);

                self.enter_scope(false);

                if head != 0 && ast.kind(head) == N_VARIABLE_DECLARATION {
                    self.declare_variable_declaration(head, kind == N_FOR_STATEMENT);
                }

                self.iteration_depth += 1;
                self.visit_children(node, kind);
                self.iteration_depth -= 1;
                self.exit_scope();
            }

            N_WHILE_STATEMENT | N_DO_WHILE_STATEMENT => {
                self.iteration_depth += 1;
                self.visit_children(node, kind);
                self.iteration_depth -= 1;
            }

            N_CATCH_CLAUSE => {
                let param = ast.field(node, NODE_A);
                let body = ast.field(node, NODE_B);

                self.enter_scope(false);
                self.declare_pattern(
                    param,
                    if param != 0 && ast.kind(param) == N_IDENTIFIER {
                        BINDING_CATCH
                    } else {
                        BINDING_LEXICAL
                    },
                );
                self.visit(param);

                if body != 0 {
                    self.hoist(ast.field(body, NODE_A), true);
                    self.visit_list(ast.field(body, NODE_A));
                }

                self.exit_scope();
            }

            N_METHOD_DEFINITION | N_TS_ABSTRACT_METHOD_DEFINITION | N_PROPERTY => {
                let flags = ast.flags(node);
                let accessor = (flags & MKIND_MASK) >> MKIND_SHIFT;
                let value = ast.field(node, NODE_B);

                if accessor == MKIND_GET || accessor == MKIND_SET {
                    self.check_accessor_parameters(value, accessor);
                }

                self.visit(ast.field(node, NODE_A));

                let was_method = self.in_method;

                self.in_method = kind != N_PROPERTY
                    || (flags & NF_METHOD) != 0
                    || accessor == MKIND_GET
                    || accessor == MKIND_SET;

                self.in_derived_constructor = kind == N_METHOD_DEFINITION
                    && accessor == MKIND_CONSTRUCTOR
                    && self.in_derived_class;
                self.visit(value);
                self.in_derived_constructor = false;
                self.in_method = was_method;
                self.visit_list(ast.field(node, NODE_C));
            }

            N_PROPERTY_DEFINITION | N_ACCESSOR_PROPERTY | N_TS_ABSTRACT_PROPERTY_DEFINITION => {
                let was_super_property = self.super_property_allowed;
                let was_super_call = self.super_call_allowed;

                self.visit(ast.field(node, NODE_A));

                let found = self.find_arguments(ast.field(node, NODE_B));

                self.check_no_arguments(found, "a class field initializer");

                let was_new_target = self.new_target_allowed;

                self.super_property_allowed = true;
                self.super_call_allowed = false;
                self.new_target_allowed = true;
                self.visit(ast.field(node, NODE_B));
                self.new_target_allowed = was_new_target;
                self.super_property_allowed = was_super_property;
                self.super_call_allowed = was_super_call;
                self.visit_list(ast.field(node, NODE_C));
            }

            N_CLASS_DECLARATION | N_CLASS_EXPRESSION => {
                let body = ast.field(node, NODE_C);
                let was_strict = self.strict;

                self.strict = true;
                self.check_restricted_name(ast.field(node, NODE_A), "bound");
                self.visit(ast.field(node, NODE_A));
                self.visit(ast.field(node, NODE_B));
                self.visit(ast.field(node, NODE_D));
                self.visit(ast.field(node, NODE_E));
                self.visit_list(ast.field(node, NODE_F));

                let was_derived = self.in_derived_class;
                let was_saw_constructor = self.saw_constructor;

                self.saw_constructor = false;
                self.in_derived_class = ast.field(node, NODE_B) != 0;

                if body != 0 {
                    let names = self.collect_private_names(body);

                    self.private_names.push(names);
                    self.visit_children(body, ast.kind(body));
                    self.private_names.pop();
                }

                self.in_derived_class = was_derived;
                self.saw_constructor = was_saw_constructor;
                self.strict = was_strict;
            }

            N_JSX_ELEMENT | N_JSX_FRAGMENT => {
                let was_in_jsx = self.in_jsx;

                self.in_jsx = true;
                self.visit_children(node, kind);
                self.in_jsx = was_in_jsx;
            }

            _ => {
                self.visit_children(node, kind);
            }
        }
    }

    /// Visits every child of a node using the slot descriptor table.
    fn visit_children(&mut self, node: u32, kind: u32) {
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let descriptor = SLOT_TABLE[base + slot] as u32;

            if descriptor == SLOT_NODE {
                self.visit(self.ast.field(node, NODE_A + slot));
            } else if descriptor == SLOT_LIST {
                self.visit_list(self.ast.field(node, NODE_A + slot));
            }
        }
    }

    /// Visits a list whose items may be `import` and `export` declarations.
    fn visit_module_items(&mut self, handle: u32) {
        let size = self.ast.list_size(handle);

        for i in 0..size {
            self.module_items_allowed = true;
            self.in_statement_list = true;
            self.visit(self.ast.list_item(handle, i));
        }

        self.module_items_allowed = false;
        self.in_statement_list = false;
    }

    /// Visits every element of a list.
    fn visit_list(&mut self, handle: u32) {
        let size = self.ast.list_size(handle);

        for i in 0..size {
            self.in_statement_list = true;
            self.visit(self.ast.list_item(handle, i));
        }

        self.in_statement_list = false;
    }

    /// Visits a function, giving its parameters and body a fresh scope.
    fn visit_function(&mut self, node: u32) {
        let ast = self.ast;
        let previous_strict = self.strict;
        let previous_unique = self.unique_params;
        let previous_generator = self.in_generator;
        let previous_async = self.in_async;
        let previous_await = self.await_reserved;
        let previous_parameters = self.in_parameters;
        let previous_ambient = self.ambient;
        let is_method = self.in_method;
        let is_derived_constructor = self.in_derived_constructor;
        let previous_super_property = self.super_property_allowed;
        let previous_super_call = self.super_call_allowed;
        let body = ast.field(node, NODE_C);
        let kind = ast.kind(node);
        let flags = ast.flags(node);
        let is_arrow = kind == N_ARROW_FUNCTION_EXPRESSION;
        let is_generator = (flags & NF_GENERATOR) != 0;
        let is_async = (flags & NF_ASYNC) != 0;

        self.in_method = false;
        self.in_derived_constructor = false;
        self.function_depth += 1;
        self.enter_scope(true);

        let previous_static_block = self.in_static_block;
        let previous_new_target = self.new_target_allowed;

        self.in_static_block = false;

        if !is_arrow {
            self.new_target_allowed = true;
        }

        let previous_label_floor = self.label_floor;

        self.label_floor = self.labels.len();

        let previous_iteration_depth = self.iteration_depth;
        let previous_switch_depth = self.switch_depth;

        self.iteration_depth = 0;
        self.switch_depth = 0;

        let directive = body != 0
            && ast.kind(body) == N_BLOCK_STATEMENT
            && self.has_use_strict_directive(body);

        if directive {
            self.strict = true;
        }

        // A function with no body is a signature, not a definition.
        self.ambient = previous_ambient || body == 0;

        self.check_ambient_function(node, kind, flags, body);
        self.check_restricted_name(ast.field(node, NODE_A), "bound");

        let params = ast.field(node, NODE_B);
        let size = ast.list_size(params);
        let simple = self.has_simple_parameters(params, size);

        if directive && !simple {
            self.report_str(
                "Illegal 'use strict' directive in a function with a non-simple parameter list.",
                ast.start(node),
            );
        }

        self.unique_params = self.strict || !simple || is_method || is_arrow;

        let is_declaration = kind == N_FUNCTION_DECLARATION || kind == N_TS_DECLARE_FUNCTION;

        if is_declaration {
            self.visit(ast.field(node, NODE_A));
        }

        self.in_generator = if is_arrow {
            previous_generator
        } else {
            is_generator
        };
        self.in_async = if is_arrow {
            previous_async || is_async
        } else {
            is_async
        };
        self.await_reserved = self.in_async
            || (is_arrow && previous_await)
            || self.source_type == ValidateSourceType::Module;

        if !is_arrow {
            self.super_property_allowed = is_method;
            self.super_call_allowed = is_derived_constructor;
        }

        for i in 0..size {
            let param = ast.list_item(params, i);

            if ast.kind(param) == N_REST_ELEMENT && i != size - 1 {
                self.report_str("A rest parameter must be the last parameter.", ast.start(param));
            }

            self.declare_pattern(param, BINDING_PARAM);
        }

        self.unique_params = previous_unique;

        if !is_declaration {
            self.visit(ast.field(node, NODE_A));
        }

        self.in_parameters = true;
        self.visit_list(params);
        self.in_parameters = false;

        // The body of an arrow is the one place the enclosing context stops.
        if is_arrow {
            self.in_generator = false;
            self.in_async = is_async;
            self.await_reserved = is_async || self.source_type == ValidateSourceType::Module;
        }

        if body != 0 && ast.kind(body) == N_BLOCK_STATEMENT {
            self.hoist(ast.field(body, NODE_A), true);
            self.visit_list(ast.field(body, NODE_A));
        } else {
            self.visit(body);
        }

        self.visit(ast.field(node, NODE_D));
        self.visit(ast.field(node, NODE_E));
        self.exit_scope();
        self.function_depth -= 1;
        self.strict = previous_strict;
        self.in_generator = previous_generator;
        self.in_async = previous_async;
        self.await_reserved = previous_await;
        self.in_parameters = previous_parameters;
        self.in_static_block = previous_static_block;
        self.new_target_allowed = previous_new_target;
        self.label_floor = previous_label_floor;
        self.iteration_depth = previous_iteration_depth;
        self.switch_depth = previous_switch_depth;
        self.ambient = previous_ambient;
        self.super_property_allowed = previous_super_property;
        self.super_call_allowed = previous_super_call;
    }

    /// Determines whether every parameter is a plain binding identifier.
    fn has_simple_parameters(&self, params: u32, size: u32) -> bool {
        let ast = self.ast;

        for i in 0..size {
            let mut param = ast.list_item(params, i);

            if ast.kind(param) == N_TS_PARAMETER_PROPERTY {
                param = ast.field(param, NODE_A);
            }

            if ast.kind(param) != N_IDENTIFIER {
                return false;
            }
        }

        true
    }

    /// Reports an accessor whose parameter list is not the shape it must be.
    fn check_accessor_parameters(&mut self, value: u32, accessor: u32) {
        if value == 0 {
            return;
        }

        let ast = self.ast;
        let params = ast.field(value, NODE_B);
        let size = ast.list_size(params);

        if accessor == MKIND_GET {
            if size > 0 {
                self.report_str(
                    "A getter must have no parameters.",
                    ast.start(ast.list_item(params, 0)),
                );
            }

            return;
        }

        if size != 1 {
            self.report_str(
                "A setter must have exactly one parameter.",
                ast.start(if size == 0 {
                    value
                } else {
                    ast.list_item(params, 1)
                }),
            );

            return;
        }

        let only = ast.list_item(params, 0);

        if ast.kind(only) == N_REST_ELEMENT {
            self.report_str("A setter cannot have a rest parameter.", ast.start(only));
        }
    }

    //-------------------------------------------------------------------------
    // Scopes
    //-------------------------------------------------------------------------

    /// Hashes the characters of a name the way `NameTable` keys names.
    fn hash_name(&mut self, start: usize, end: usize) -> i32 {
        let source = self.ast.source;
        let mut hash = 0;

        self.hashed_name = None;

        for i in start..end {
            let code = source[i] as i32;

            if code == CH_BACKSLASH {
                let name = decode_escapes(&source[start..end]);

                hash = 0;

                for &unit in &name {
                    hash = hash_char(hash, unit as i32);
                }

                self.hashed_name = Some(name);
                return hash;
            }

            hash = hash_char(hash, code);
        }

        hash
    }

    /// The name an identifier spells, with any escape in it decoded.
    fn identifier_name(&self, node: u32) -> Vec<u16> {
        let ast = self.ast;
        let name_end = ast.field(node, NODE_A);
        let end = if name_end == 0 { ast.end(node) } else { name_end };
        let raw = &ast.source[ast.start(node) as usize..end as usize];

        if raw.iter().any(|&unit| unit as i32 == CH_BACKSLASH) {
            decode_escapes(raw)
        } else {
            raw.to_vec()
        }
    }

    /// Produces an empty name table, reusing an exited scope's if one is free.
    fn take_table(&mut self) -> NameTable {
        self.table_pool.pop().unwrap_or_else(NameTable::new)
    }

    /// Pushes a new scope.
    fn enter_scope(&mut self, is_function_scope: bool) {
        self.scopes.push(Scope {
            names: None,
            is_function_scope,
            functions_are_lexical: !is_function_scope,
        });
    }

    /// Pops the innermost scope.
    fn exit_scope(&mut self) {
        let scope = self.scopes.pop().unwrap();

        if let Some(mut names) = scope.names {
            names.reset();
            self.table_pool.push(names);
        }
    }

    /// Declares the block-scoped names of a statement list before visiting it.
    fn hoist(&mut self, handle: u32, using_allowed: bool) {
        let ast = self.ast;
        let size = ast.list_size(handle);

        for i in 0..size {
            let mut statement = ast.list_item(handle, i);
            let mut kind = ast.kind(statement);

            // Look through `export` to the declaration it wraps.
            if kind == N_EXPORT_NAMED_DECLARATION || kind == N_EXPORT_DEFAULT_DECLARATION {
                statement = ast.field(statement, NODE_A);

                if statement == 0 {
                    continue;
                }

                kind = ast.kind(statement);
            }

            match kind {
                k if k == N_VARIABLE_DECLARATION => {
                    if !using_allowed {
                        self.check_using_placement(statement);
                    }

                    self.declare_variable_declaration(statement, true);
                }

                k if k == N_IMPORT_DECLARATION => {
                    self.declare_import_declaration(statement);
                }

                k if k == N_FUNCTION_DECLARATION => {
                    let binding = if self.scopes.last().unwrap().functions_are_lexical {
                        if (ast.flags(statement) & (NF_ASYNC | NF_GENERATOR)) != 0 {
                            BINDING_ASYNC_OR_GENERATOR
                        } else {
                            BINDING_FUNCTION
                        }
                    } else {
                        BINDING_VAR
                    };

                    self.declare(ast.field(statement, NODE_A), binding);
                }

                k if k == N_TS_DECLARE_FUNCTION => {
                    let binding = if self.scopes.last().unwrap().functions_are_lexical {
                        BINDING_SIGNATURE
                    } else {
                        BINDING_VAR
                    };

                    self.declare(ast.field(statement, NODE_A), binding);
                }

                k if k == N_CLASS_DECLARATION => {
                    let binding = if self.ambient || (ast.flags(statement) & NF_DECLARE) != 0 {
                        BINDING_AMBIENT_CLASS
                    } else {
                        BINDING_LEXICAL
                    };

                    self.declare(ast.field(statement, NODE_A), binding);
                }

                k if k == N_TS_INTERFACE_DECLARATION
                    || k == N_TS_TYPE_ALIAS_DECLARATION
                    || k == N_TS_ENUM_DECLARATION
                    || k == N_TS_MODULE_DECLARATION
                    || k == N_TS_IMPORT_EQUALS_DECLARATION =>
                {
                    self.declare(ast.field(statement, NODE_A), BINDING_TYPE);
                }

                _ => {}
            }
        }
    }

    /// Reports a `using` declaration written where none may stand.
    fn check_using_placement(&mut self, node: u32) {
        let ast = self.ast;
        let declaration_kind = (ast.flags(node) & DECL_MASK) >> DECL_SHIFT;

        if declaration_kind == DECL_USING || declaration_kind == DECL_AWAIT_USING {
            self.report_string(
                format!(
                    "A '{}' declaration may only appear inside a block, a function body, a for head, or the top level of a module.",
                    DECL_KIND_NAMES[declaration_kind as usize]
                ),
                ast.start(node),
            );
        }
    }

    /// Declares every name introduced by a variable declaration.
    fn declare_variable_declaration(&mut self, node: u32, check_initializer: bool) {
        let ast = self.ast;
        let flags = ast.flags(node);
        let declaration_kind = (flags & DECL_MASK) >> DECL_SHIFT;
        let binding = if declaration_kind == DECL_VAR {
            BINDING_VAR
        } else {
            BINDING_LEXICAL
        };
        let is_using = declaration_kind == DECL_USING || declaration_kind == DECL_AWAIT_USING;
        let declarations = ast.field(node, NODE_A);
        let size = ast.list_size(declarations);
        let previous_ambient = self.ambient;

        self.ambient = previous_ambient || (flags & NF_DECLARE) != 0;

        for i in 0..size {
            let declarator = ast.list_item(declarations, i);
            let target = ast.field(declarator, NODE_A);

            self.declare_pattern(target, binding);

            let initializer = ast.field(declarator, NODE_B);
            let annotation = if ast.kind(target) == N_IDENTIFIER {
                ast.field(target, NODE_B)
            } else {
                0
            };

            self.check_definite_assertion(
                declarator,
                initializer,
                annotation,
                (flags & NF_DECLARE) != 0 || declaration_kind == DECL_CONST || is_using,
            );

            if (flags & NF_DECLARE) != 0
                && initializer != 0
                && (declaration_kind != DECL_CONST || annotation != 0)
            {
                self.report_str(
                    "An ambient declaration may not have an initializer.",
                    ast.start(declarator),
                );
            }

            if is_using {
                if ast.kind(target) != N_IDENTIFIER {
                    self.report_string(
                        format!(
                            "A '{}' declaration may only bind an identifier.",
                            DECL_KIND_NAMES[declaration_kind as usize]
                        ),
                        ast.start(target),
                    );
                }
            } else if declaration_kind != DECL_CONST {
                continue;
            }

            if check_initializer
                && ast.field(declarator, NODE_B) == 0
                && (ast.flags(declarator) & NF_DEFINITE) == 0
                && !self.ambient
            {
                self.report_string(
                    format!(
                        "Missing initializer in {} declaration.",
                        DECL_KIND_NAMES[declaration_kind as usize]
                    ),
                    ast.start(declarator),
                );
            }
        }

        self.ambient = previous_ambient;
    }

    /// Reports a modifier a method may not carry.
    fn check_method_modifiers(&mut self, node: u32) {
        let flags = self.ast.flags(node);

        if (flags & NF_READONLY) != 0 {
            self.report_str("A method may not be marked 'readonly'.", self.ast.start(node));
        }

        if (flags & NF_DECLARE) != 0 {
            self.report_str("A method may not be marked 'declare'.", self.ast.start(node));
        }
    }

    /// Reports an accessibility modifier on an index signature.
    fn check_index_signature(&mut self, node: u32) {
        if (self.ast.flags(node) & ACCESS_MASK) != 0 {
            self.report_str(
                "An index signature may not have an accessibility modifier.",
                self.ast.start(node),
            );
        }
    }

    /// Reports a type-only import that brings in a name two ways at once.
    fn check_type_only_import(&mut self, node: u32) {
        let ast = self.ast;

        if (ast.flags(node) & NF_TYPE_ONLY) == 0 {
            return;
        }

        let specifiers = ast.field(node, NODE_A);
        let size = ast.list_size(specifiers);
        let mut saw_default = false;
        let mut saw_other = false;

        for i in 0..size {
            if ast.kind(ast.list_item(specifiers, i)) == N_IMPORT_DEFAULT_SPECIFIER {
                saw_default = true;
            } else {
                saw_other = true;
            }
        }

        if saw_default && saw_other {
            self.report_str(
                "A type-only import may have a default import or named bindings, but not both.",
                ast.start(node),
            );
        }
    }

    /// Reports a decorator on an overload signature.
    fn check_decorated_overload(&mut self, node: u32) {
        let ast = self.ast;
        let value = ast.field(node, NODE_B);

        if ast.list_size(ast.field(node, NODE_C)) > 0
            && (value == 0 || ast.field(value, NODE_C) == 0)
        {
            self.report_str(
                "A decorator may not appear on an overload signature.",
                ast.start(node),
            );
        }
    }

    /// Reports an object literal method written without a body.
    fn check_object_method_body(&mut self, node: u32) {
        let ast = self.ast;
        let value = ast.field(node, NODE_B);

        if value != 0 && ast.kind(value) == N_TS_EMPTY_BODY_FUNCTION_EXPRESSION {
            self.report_str("An object literal method must have a body.", ast.start(node));
        }
    }

    /// Reports a `<>` written with nothing between the angle brackets.
    fn check_empty_type_list(&mut self, node: u32, message: &str) {
        let ast = self.ast;

        if ast.list_size(ast.field(node, NODE_A)) == 0 {
            self.report_str(message, ast.start(node));
        }
    }

    /// Reports an enum member named in a way an enum member may not be.
    fn check_enum_member(&mut self, node: u32) {
        let ast = self.ast;

        if (ast.flags(node) & NF_COMPUTED) != 0 {
            self.report_str("An enum member name may not be computed.", ast.start(node));
            return;
        }

        let name = ast.field(node, NODE_A);

        if name != 0
            && ast.kind(name) == N_LITERAL
            && (ast.field(name, NODE_A) == LIT_NUMBER || ast.field(name, NODE_A) == LIT_BIGINT)
        {
            self.report_str("An enum member may not have a numeric name.", ast.start(name));
        }
    }

    /// Reports a namespace named by a string.
    fn check_module_name(&mut self, node: u32) {
        let ast = self.ast;
        let id = ast.field(node, NODE_A);

        if id == 0 || ast.kind(id) != N_LITERAL {
            return;
        }

        let kind = (ast.flags(node) & MODULE_KIND_MASK) >> MKIND_SHIFT;

        if kind != MODULE_MODULE {
            self.report_str("A namespace may not be named by a string.", ast.start(id));
        }
    }

    /// Records the parameter properties a constructor implementation may have.
    fn permit_parameter_properties(&mut self, node: u32) {
        let ast = self.ast;
        let flags = ast.flags(node);

        if (flags & MKIND_MASK) >> MKIND_SHIFT != MKIND_CONSTRUCTOR {
            return;
        }

        let value = ast.field(node, NODE_B);

        if value == 0 || ast.field(value, NODE_C) == 0 {
            return;
        }

        let params = ast.field(value, NODE_B);
        let size = ast.list_size(params);

        for i in 0..size {
            let param = ast.list_item(params, i);

            if ast.kind(param) == N_TS_PARAMETER_PROPERTY {
                self.permitted_parameter_properties.insert(param);
            }
        }
    }

    /// Reports a parameter property written where none may stand.
    fn check_parameter_property(&mut self, node: u32) {
        let ast = self.ast;

        if !self.permitted_parameter_properties.contains(&node) {
            self.report_str(
                "A parameter property may only appear in a constructor implementation.",
                ast.start(node),
            );
            return;
        }

        let parameter = ast.field(node, NODE_A);
        let kind = ast.kind(parameter);

        if kind == N_REST_ELEMENT {
            self.report_str(
                "A parameter property may not be a rest parameter.",
                ast.start(node),
            );
        } else if kind == N_OBJECT_PATTERN || kind == N_ARRAY_PATTERN {
            self.report_str(
                "A parameter property may not use a binding pattern.",
                ast.start(node),
            );
        }
    }

    /// Records a type parameter list whose parameters may carry variance.
    fn permit_variance(&mut self, node: u32) {
        if node != 0 {
            self.variant_type_parameters.insert(node);
        }
    }

    /// Reports `in` or `out` on a type parameter that may not vary.
    fn check_type_parameter_variance(&mut self, node: u32) {
        if self.variant_type_parameters.contains(&node) {
            return;
        }

        let ast = self.ast;
        let params = ast.field(node, NODE_A);
        let size = ast.list_size(params);

        for i in 0..size {
            let param = ast.list_item(params, i);

            if (ast.flags(param) & (NF_IN | NF_STATIC)) != 0 {
                self.report_str(
                    "A variance annotation may only appear on a type parameter of a class, an interface, or a type alias.",
                    ast.start(param),
                );
            }
        }
    }

    /// Reports a function declaration that says two things at once.
    fn check_ambient_function(&mut self, node: u32, kind: u32, flags: u32, body: u32) {
        if kind != N_FUNCTION_DECLARATION && kind != N_TS_DECLARE_FUNCTION {
            return;
        }

        let start = self.ast.start(node);

        if (flags & NF_DECLARE) != 0 {
            if body != 0 {
                self.report_str("An ambient function declaration may not have a body.", start);
            } else if (flags & NF_ASYNC) != 0 {
                self.report_str("An ambient function declaration may not be async.", start);
            } else if (flags & NF_GENERATOR) != 0 {
                self.report_str("An ambient function declaration may not be a generator.", start);
            }

            return;
        }

        if body == 0 && (flags & NF_GENERATOR) != 0 {
            self.report_str("A function signature may not be a generator.", start);
        }
    }

    /// Reports a definite assignment assertion that promises nothing.
    fn check_definite_assertion(
        &mut self,
        node: u32,
        initializer: u32,
        type_annotation: u32,
        settled: bool,
    ) {
        let ast = self.ast;

        if (ast.flags(node) & NF_DEFINITE) == 0 {
            return;
        }

        if settled {
            self.report_str("A definite assignment assertion is not allowed here.", ast.start(node));
            return;
        }

        if initializer != 0 {
            self.report_str(
                "A definite assignment assertion may not be combined with an initializer.",
                ast.start(node),
            );
            return;
        }

        if type_annotation == 0 {
            self.report_str(
                "A definite assignment assertion requires a type annotation.",
                ast.start(node),
            );
        }
    }

    /// Reports an import attribute key written twice.
    fn check_import_attributes(&mut self, handle: u32) {
        let ast = self.ast;
        let size = ast.list_size(handle);

        if size < 2 {
            return;
        }

        let mut seen: HashSet<Vec<u16>> = HashSet::new();

        for i in 0..size {
            let attribute = ast.list_item(handle, i);
            let key = ast.field(attribute, NODE_A);

            if key == 0 {
                continue;
            }

            let name = if ast.kind(key) == N_LITERAL {
                let text = ast.text(key);

                decode_escapes(&text[1..text.len() - 1])
            } else {
                self.identifier_name(key)
            };

            if seen.contains(&name) {
                // Composed from the units: a string key can spell a lone
                // surrogate, which the quoting must reproduce exactly.
                let message = compose("Duplicate import attribute '", &name, "'.");

                self.report(message, ast.start(key));

                continue;
            }

            seen.insert(name);
        }
    }

    /// Checks the names a module exports.
    fn check_module_exports(&mut self, handle: u32) {
        let ast = self.ast;
        let size = ast.list_size(handle);
        let mut exported: HashSet<Vec<u16>> = HashSet::new();

        for i in 0..size {
            let item = ast.list_item(handle, i);

            match ast.kind(item) {
                k if k == N_IMPORT_DECLARATION => {
                    let specifiers = ast.field(item, NODE_A);
                    let count = ast.list_size(specifiers);

                    for j in 0..count {
                        let specifier = ast.list_item(specifiers, j);

                        if ast.kind(specifier) == N_IMPORT_SPECIFIER {
                            self.module_export_name(ast.field(specifier, NODE_A));
                        }
                    }
                }

                k if k == N_EXPORT_DEFAULT_DECLARATION => {
                    let exported_kind = ast.kind(ast.field(item, NODE_A));

                    if exported_kind != N_TS_DECLARE_FUNCTION
                        && exported_kind != N_TS_INTERFACE_DECLARATION
                    {
                        let default: Vec<u16> = "default".encode_utf16().collect();

                        self.add_exported_name(&mut exported, Some(default), ast.start(item));
                    }
                }

                k if k == N_EXPORT_ALL_DECLARATION => {
                    let alias = ast.field(item, NODE_A);

                    if alias != 0 {
                        let name = self.module_export_name(alias);

                        self.add_exported_name(&mut exported, name, ast.start(alias));
                    }
                }

                k if k == N_EXPORT_NAMED_DECLARATION => {
                    let declaration = ast.field(item, NODE_A);

                    if declaration != 0 {
                        self.add_declared_exports(&mut exported, declaration);
                        continue;
                    }

                    let specifiers = ast.field(item, NODE_B);
                    let count = ast.list_size(specifiers);
                    let reexport = ast.field(item, NODE_C) != 0;

                    for j in 0..count {
                        let specifier = ast.list_item(specifiers, j);
                        let local = ast.field(specifier, NODE_A);
                        let alias = ast.field(specifier, NODE_B);
                        let name = self.module_export_name(local);
                        let exported_name = if alias == local {
                            name.clone()
                        } else {
                            self.module_export_name(alias)
                        };

                        self.add_exported_name(
                            &mut exported,
                            exported_name,
                            ast.start(if alias == 0 { local } else { alias }),
                        );

                        let Some(name) = name else {
                            continue;
                        };

                        if reexport {
                            continue;
                        }

                        if ast.kind(local) == N_LITERAL {
                            self.report_str(
                                "A module export name written as a string may only name an export of another module.",
                                ast.start(local),
                            );

                            continue;
                        }

                        let resolves = match &mut self.scopes[0].names {
                            Some(names) => names.has_name(ast.source, &name),
                            None => false,
                        };

                        if resolves {
                            continue;
                        }

                        self.report_string(
                            format!("Export '{}' is not defined in the module.", name_of(&name)),
                            ast.start(local),
                        );
                    }
                }

                _ => {}
            }
        }
    }

    /// Records the names an exported declaration binds.
    fn add_declared_exports(&mut self, exported: &mut HashSet<Vec<u16>>, declaration: u32) {
        let ast = self.ast;
        let kind = ast.kind(declaration);

        if kind == N_VARIABLE_DECLARATION {
            let declarations = ast.field(declaration, NODE_A);
            let size = ast.list_size(declarations);

            for i in 0..size {
                self.add_pattern_exports(exported, ast.field(ast.list_item(declarations, i), NODE_A));
            }

            return;
        }

        if kind != N_FUNCTION_DECLARATION && kind != N_CLASS_DECLARATION {
            return;
        }

        let id = ast.field(declaration, NODE_A);

        if id != 0 {
            let name = self.identifier_name(id);

            self.add_exported_name(exported, Some(name), ast.start(id));
        }
    }

    /// Records every name a binding pattern binds.
    fn add_pattern_exports(&mut self, exported: &mut HashSet<Vec<u16>>, node: u32) {
        if node == 0 {
            return;
        }

        let ast = self.ast;

        match ast.kind(node) {
            k if k == N_IDENTIFIER => {
                let name = self.identifier_name(node);

                self.add_exported_name(exported, Some(name), ast.start(node));
            }

            k if k == N_ARRAY_PATTERN => {
                let elements = ast.field(node, NODE_A);
                let size = ast.list_size(elements);

                for i in 0..size {
                    self.add_pattern_exports(exported, ast.list_item(elements, i));
                }
            }

            k if k == N_OBJECT_PATTERN => {
                let properties = ast.field(node, NODE_A);
                let size = ast.list_size(properties);

                for i in 0..size {
                    let property = ast.list_item(properties, i);
                    let slot = if ast.kind(property) == N_PROPERTY {
                        NODE_B
                    } else {
                        NODE_A
                    };

                    self.add_pattern_exports(exported, ast.field(property, slot));
                }
            }

            k if k == N_ASSIGNMENT_PATTERN || k == N_REST_ELEMENT => {
                self.add_pattern_exports(exported, ast.field(node, NODE_A));
            }

            _ => {}
        }
    }

    /// Records one exported name, reporting a second export of it.
    fn add_exported_name(
        &mut self,
        exported: &mut HashSet<Vec<u16>>,
        name: Option<Vec<u16>>,
        start: u32,
    ) {
        let Some(name) = name else {
            return;
        };

        if exported.contains(&name) {
            /*
             * Composed from the units rather than formatted, because a module
             * export name written as a string can spell a lone surrogate that
             * no Rust `String` can carry — and the message must quote exactly
             * what the program wrote.
             */
            let message = compose("Duplicate export of '", &name, "'.");

            self.report(message, start);
            return;
        }

        exported.insert(name);
    }

    /// Reads a `ModuleExportName`, which is an identifier or a string literal.
    fn module_export_name(&mut self, node: u32) -> Option<Vec<u16>> {
        if node == 0 {
            return None;
        }

        let ast = self.ast;

        if ast.kind(node) != N_LITERAL {
            return Some(self.identifier_name(node));
        }

        let raw = ast.text(node);
        let value = decode_escapes(&raw[1..raw.len() - 1]);

        if !is_well_formed_unicode(&value) {
            self.report_str(
                "A module export name written as a string must be well-formed Unicode.",
                ast.start(node),
            );
        }

        Some(value)
    }

    /// Declares the local name of every specifier of an import declaration.
    fn declare_import_declaration(&mut self, node: u32) {
        let ast = self.ast;
        let specifiers = ast.field(node, NODE_A);
        let size = ast.list_size(specifiers);
        let type_only = (ast.flags(node) & NF_TYPE_ONLY) != 0;

        for i in 0..size {
            let specifier = ast.list_item(specifiers, i);
            let slot = if ast.kind(specifier) == N_IMPORT_SPECIFIER {
                NODE_B
            } else {
                NODE_A
            };
            let local = ast.field(specifier, slot);

            self.check_restricted_name(local, "bound");
            self.declare(
                local,
                if type_only || (ast.flags(specifier) & NF_TYPE_ONLY) != 0 {
                    BINDING_TYPE
                } else {
                    BINDING_LEXICAL
                },
            );
        }
    }

    /// Declares every identifier inside a binding pattern, and reports a
    /// pattern that is not a shape a pattern may take.
    fn declare_pattern(&mut self, node: u32, binding: u32) {
        if node == 0 {
            return;
        }

        let ast = self.ast;
        let kind = ast.kind(node);

        match kind {
            k if k == N_IDENTIFIER => {
                self.check_restricted_name(node, "bound");

                let flags = ast.flags(node);
                let idword = IDWORD_KINDS[((flags & IDWORD_MASK) >> IDWORD_SHIFT) as usize];

                if binding == BINDING_LEXICAL
                    && (idword == T_LET
                        || ((flags & NF_IDENTIFIER_ESCAPED) != 0
                            && eq_ascii(&self.identifier_name(node), b"let")))
                {
                    self.report_str(
                        "'let' may not be the name a lexical declaration binds.",
                        ast.start(node),
                    );
                }

                if binding != BINDING_PARAM && idword == T_THIS {
                    self.report_str("'this' may not be bound as a name.", ast.start(node));
                }

                self.declare(node, binding);
            }

            k if k == N_ARRAY_PATTERN => {
                let elements = ast.field(node, NODE_A);
                let size = ast.list_size(elements);

                for i in 0..size {
                    let element = ast.list_item(elements, i);

                    if element != 0 && ast.kind(element) == N_REST_ELEMENT {
                        if i == size - 1 {
                            self.check_comma_after_rest(node, element);
                        } else {
                            self.report_str(
                                "A rest element must be the last element.",
                                ast.start(element),
                            );
                        }
                    }

                    self.declare_pattern(element, binding);
                }
            }

            k if k == N_OBJECT_PATTERN => {
                let properties = ast.field(node, NODE_A);
                let size = ast.list_size(properties);

                for i in 0..size {
                    let property = ast.list_item(properties, i);
                    let is_property = ast.kind(property) == N_PROPERTY;
                    let target = ast.field(property, if is_property { NODE_B } else { NODE_A });

                    if !is_property {
                        if i == size - 1 {
                            self.check_comma_after_rest(node, property);
                        } else {
                            self.report_str(
                                "A rest element must be the last element.",
                                ast.start(property),
                            );
                        }

                        if target != 0 && ast.kind(target) != N_IDENTIFIER {
                            self.report_str(
                                "A rest element in an object pattern must be an identifier.",
                                ast.start(target),
                            );
                        }
                    }

                    self.declare_pattern(target, binding);
                }
            }

            k if k == N_ASSIGNMENT_PATTERN || k == N_REST_ELEMENT => {
                self.declare_pattern(ast.field(node, NODE_A), binding);
            }

            _ => {}
        }
    }

    /// Binds a name in the current scope and reports illegal redeclarations.
    fn declare(&mut self, identifier: u32, binding: u32) {
        if identifier == 0 {
            return;
        }

        let ast = self.ast;

        if ast.kind(identifier) != N_IDENTIFIER {
            return;
        }

        let start = ast.start(identifier);
        let name_end = ast.field(identifier, NODE_A);
        let end = if name_end == 0 {
            ast.end(identifier)
        } else {
            name_end
        };
        let hash = self.hash_name(start as usize, end as usize);
        let name = self.hashed_name.clone();

        if binding == BINDING_VAR {
            self.declare_var(hash, start as i32, end as i32, name);
            return;
        }

        let scope_index = self.scopes.len() - 1;
        let info = match &mut self.scopes[scope_index].names {
            Some(names) => names.find(ast.source, hash, start as i32, end as i32, name.as_deref()),
            None => 0,
        };
        let existing = (info & NAME_BINDING) - 1;

        let collides = if existing != -1 {
            self.conflicts(existing as u32, binding)
        } else {
            (info & NAME_VAR) != 0 && !self.tolerant_of_var(binding)
        };

        if collides {
            let spelled = match &name {
                Some(name) => name_of(name),
                None => name_of(&ast.source[start as usize..end as usize]),
            };

            self.report_string(
                format!("Identifier '{spelled}' has already been declared."),
                start,
            );

            return;
        }

        if binding == BINDING_SIGNATURE && existing != -1 && is_function_binding(existing as u32) {
            return;
        }

        if self.scopes[scope_index].names.is_none() {
            let table = self.take_table();

            self.scopes[scope_index].names = Some(table);
        }

        self.scopes[scope_index].names.as_mut().unwrap().bind(
            ast.source,
            hash,
            start as i32,
            end as i32,
            name.as_deref(),
            binding,
        );
    }

    /// Binds a name that climbs to the nearest function scope.
    fn declare_var(&mut self, hash: i32, start: i32, end: i32, name: Option<Vec<u16>>) {
        let ast = self.ast;
        let mut index = self.scopes.len() - 1;

        loop {
            let info = match &mut self.scopes[index].names {
                Some(names) => names.find(ast.source, hash, start, end, name.as_deref()),
                None => 0,
            };
            let existing = (info & NAME_BINDING) - 1;

            if existing != -1 && !self.tolerant_of_var(existing as u32) {
                let spelled = match &name {
                    Some(name) => name_of(name),
                    None => name_of(&ast.source[start as usize..end as usize]),
                };

                self.report_string(
                    format!("Identifier '{spelled}' has already been declared."),
                    start as u32,
                );

                return;
            }

            if self.scopes[index].names.is_none() {
                let table = self.take_table();

                self.scopes[index].names = Some(table);
            }

            self.scopes[index].names.as_mut().unwrap().add_var(
                ast.source,
                hash,
                start,
                end,
                name.as_deref(),
            );

            if self.scopes[index].is_function_scope || index == 0 {
                return;
            }

            index -= 1;
        }
    }

    /// Determines whether a binding may share its scope with a `var`.
    fn tolerant_of_var(&self, binding: u32) -> bool {
        binding != BINDING_LEXICAL
            && binding != BINDING_AMBIENT_CLASS
            && !is_function_binding(binding)
    }

    /// Determines whether two bindings of the same name may coexist.
    fn conflicts(&self, existing: u32, incoming: u32) -> bool {
        // Types may merge freely with each other and with values.
        if existing == BINDING_TYPE || incoming == BINDING_TYPE {
            return false;
        }

        if existing == BINDING_PARAM && incoming == BINDING_PARAM {
            return self.unique_params;
        }

        if (existing == BINDING_AMBIENT_CLASS
            && (incoming == BINDING_SIGNATURE || is_function_binding(incoming)))
            || (incoming == BINDING_AMBIENT_CLASS
                && (existing == BINDING_SIGNATURE || is_function_binding(existing)))
        {
            return false;
        }

        if (is_function_binding(existing) || existing == BINDING_SIGNATURE)
            && (is_function_binding(incoming) || incoming == BINDING_SIGNATURE)
        {
            return is_function_binding(existing)
                && is_function_binding(incoming)
                && (self.strict
                    || existing == BINDING_ASYNC_OR_GENERATOR
                    || incoming == BINDING_ASYNC_OR_GENERATOR);
        }

        true
    }

    /// Reports a word that may not be an identifier where it was written.
    fn check_reserved_word(&mut self, kind: u32, start: u32) {
        if !(KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind) {
            return;
        }

        if kind == T_YIELD && self.in_generator {
            self.report_str("'yield' cannot be used as an identifier inside a generator.", start);
            return;
        }

        if kind == T_AWAIT && self.await_reserved {
            self.report_str(
                if self.source_type == ValidateSourceType::Module && !self.in_async {
                    "'await' cannot be used as an identifier in a module."
                } else {
                    "'await' cannot be used as an identifier here."
                },
                start,
            );

            return;
        }

        if self.strict && (KIND_KEYWORD_FLAGS[kind as usize] & KW_STRICT_RESERVED) != 0 {
            self.report_string(
                format!(
                    "Unexpected reserved word '{}' in strict mode.",
                    KEYWORD_NAMES[(kind - KEYWORD_FIRST) as usize]
                ),
                start,
            );
        }
    }

    /// Checks a `super` used as the operand of a call or a member access.
    fn check_super_operand(&mut self, operand: u32, allowed: bool, message: &str) {
        if operand == 0 || self.ast.kind(operand) != N_SUPER {
            return;
        }

        self.sanctioned_super = operand;

        if !allowed {
            self.report_str(message, self.ast.start(operand));
        }
    }

    /// Checks the identifier a node uses as a name and as a reference at once.
    fn check_shared_name(&mut self, node: u32) {
        let ast = self.ast;
        let first = ast.field(node, NODE_A);

        if first != 0 && first == ast.field(node, NODE_B) && ast.kind(first) == N_IDENTIFIER {
            self.check_word_at(first);
        }
    }

    /// Checks an identifier's text for a word reserved where it is written.
    fn check_word_at(&mut self, node: u32) {
        let flags = self.ast.flags(node);

        if (flags & IDWORD_MASK) != 0 {
            self.check_reserved_word(
                IDWORD_KINDS[((flags & IDWORD_MASK) >> IDWORD_SHIFT) as usize],
                self.ast.start(node),
            );
        } else if (flags & NF_IDENTIFIER_ESCAPED) != 0 {
            let word = self.keyword_at(node);

            self.check_reserved_word(word, self.ast.start(node));
        }
    }

    /// Reads which keyword an identifier's text spells, if it spells one.
    fn keyword_at(&self, node: u32) -> u32 {
        let ast = self.ast;
        let source = ast.source;
        let start = ast.start(node) as usize;
        let name_end = ast.field(node, NODE_A);
        let end = if name_end == 0 {
            ast.end(node) as usize
        } else {
            name_end as usize
        };
        let mut hash = 0;
        let mut escaped = false;

        for &unit in &source[start..end] {
            let code = unit as i32;

            if code == CH_BACKSLASH {
                escaped = true;
            }

            hash = hash_char(hash, code);
        }

        if !escaped {
            return lookup_keyword(source, start, end, hash);
        }

        let name = decode_escapes(&source[start..end]);
        let mut decoded_hash = 0;

        for &unit in &name {
            decoded_hash = hash_char(decoded_hash, unit as i32);
        }

        lookup_keyword(&name, 0, name.len(), decoded_hash)
    }

    /// Checks the name a shorthand property is written with.
    fn check_shorthand_name(&mut self, node: u32) {
        let ast = self.ast;
        let key = ast.field(node, NODE_A);

        if (ast.flags(node) & NF_COMPUTED) != 0 || key == 0 || ast.kind(key) != N_IDENTIFIER {
            self.report_str(
                "A shorthand property must be written as a plain identifier.",
                ast.start(node),
            );

            return;
        }

        let flags = ast.flags(key);
        let code = (flags & IDWORD_MASK) >> IDWORD_SHIFT;
        let keyword = if code != 0 {
            IDWORD_KINDS[code as usize]
        } else if (flags & NF_IDENTIFIER_ESCAPED) != 0 {
            self.keyword_at(key)
        } else {
            0
        };

        if code == IDWORD_RESERVED
            || (keyword >= KEYWORD_FIRST
                && (KIND_KEYWORD_FLAGS[keyword as usize] & KW_RESERVED) != 0)
        {
            let name = self.identifier_name(key);

            self.report_string(
                format!("Unexpected reserved word '{}'.", name_of(&name)),
                ast.start(key),
            );

            return;
        }

        self.check_reserved_word(keyword, ast.start(key));
    }

    /// Checks the properties of an object literal.
    fn check_object_literal(&mut self, node: u32) {
        let ast = self.ast;
        let properties = ast.field(node, NODE_A);
        let size = ast.list_size(properties);
        let mut saw_proto = false;

        for i in 0..size {
            let property = ast.list_item(properties, i);

            // A spread carries no name of its own.
            if ast.kind(property) != N_PROPERTY {
                continue;
            }

            let flags = ast.flags(property);

            if (flags & NF_SHORTHAND) != 0 {
                let value = ast.field(property, NODE_B);

                if value != 0 && ast.kind(value) == N_ASSIGNMENT_PATTERN {
                    self.report_str(
                        "A shorthand property may only take a default inside a destructuring pattern.",
                        ast.start(property),
                    );
                }

                continue;
            }

            let accessor = (flags & MKIND_MASK) >> MKIND_SHIFT;

            if (flags & (NF_COMPUTED | NF_METHOD)) != 0
                || accessor == MKIND_GET
                || accessor == MKIND_SET
                || !self.is_proto_key(property)
            {
                continue;
            }

            if saw_proto {
                self.report_str(
                    "An object literal may only set '__proto__' once.",
                    ast.start(property),
                );
            }

            saw_proto = true;
        }
    }

    /// Determines whether a property's key spells `__proto__`.
    fn is_proto_key(&self, property: u32) -> bool {
        let ast = self.ast;
        let key = ast.field(property, NODE_A);

        if key == 0 {
            return false;
        }

        let first = ast.source[ast.start(key) as usize] as i32;

        if first != CH_UNDERSCORE
            && first != CH_QUOTE_DOUBLE
            && first != CH_QUOTE_SINGLE
            && first != CH_BACKSLASH
        {
            return false;
        }

        match self.property_name(property) {
            Some(name) => eq_ascii(&name, b"__proto__"),
            None => false,
        }
    }

    //-------------------------------------------------------------------------
    // `eval` and `arguments`
    //-------------------------------------------------------------------------

    /// Reports `eval` or `arguments` where strict mode will not have it.
    fn check_restricted_name(&mut self, node: u32, verb: &str) {
        if node == 0 || !self.strict || self.ambient {
            return;
        }

        let ast = self.ast;
        let start = ast.start(node);
        let first = ast.source[start as usize] as i32;

        if first != CH_A_SMALL && first != CH_E_SMALL && first != CH_BACKSLASH {
            return;
        }

        let name = self.identifier_name(node);

        if eq_ascii(&name, b"eval") || eq_ascii(&name, b"arguments") {
            self.report_string(
                format!("'{}' cannot be {verb} in strict mode.", name_of(&name)),
                start,
            );
        }
    }

    /// Finds the `arguments` that bans a field initializer or a static block.
    fn find_arguments(&mut self, node: u32) -> u32 {
        if node == 0 {
            return 0;
        }

        if self.mentions_arguments.is_none() {
            self.mentions_arguments = Some(
                contains_ascii(self.ast.source, b"arguments")
                    || contains_ascii(self.ast.source, b"\\u"),
            );
        }

        if self.mentions_arguments != Some(true) {
            return 0;
        }

        let ast = self.ast;
        let kind = ast.kind(node);

        match kind {
            k if k == N_IDENTIFIER => {
                if (ast.flags(node) & NF_IDENTIFIER_NAME) == 0
                    && eq_ascii(&self.identifier_name(node), b"arguments")
                {
                    return node;
                }

                return 0;
            }

            k if k == N_FUNCTION_DECLARATION
                || k == N_FUNCTION_EXPRESSION
                || k == N_TS_DECLARE_FUNCTION
                || k == N_TS_EMPTY_BODY_FUNCTION_EXPRESSION =>
            {
                return 0;
            }

            k if k == N_PROPERTY_DEFINITION
                || k == N_ACCESSOR_PROPERTY
                || k == N_TS_ABSTRACT_PROPERTY_DEFINITION =>
            {
                let found = self.find_arguments(ast.field(node, NODE_A));

                if found != 0 {
                    return found;
                }

                return self.find_arguments_in_list(ast.field(node, NODE_C));
            }

            k if k == N_STATIC_BLOCK => {
                return 0;
            }

            _ => {}
        }

        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let descriptor = SLOT_TABLE[base + slot] as u32;
            let mut found = 0;

            if descriptor == SLOT_NODE {
                found = self.find_arguments(ast.field(node, NODE_A + slot));
            } else if descriptor == SLOT_LIST {
                found = self.find_arguments_in_list(ast.field(node, NODE_A + slot));
            }

            if found != 0 {
                return found;
            }
        }

        0
    }

    /// Searches every element of a list for a banned `arguments`.
    fn find_arguments_in_list(&mut self, handle: u32) -> u32 {
        let size = self.ast.list_size(handle);

        for i in 0..size {
            let found = self.find_arguments(self.ast.list_item(handle, i));

            if found != 0 {
                return found;
            }
        }

        0
    }

    /// Reports an `arguments` written where it can only mean the wrong thing.
    fn check_no_arguments(&mut self, found: u32, location: &str) {
        if found != 0 {
            self.report_string(
                format!("'arguments' cannot be used in {location}."),
                self.ast.start(found),
            );
        }
    }

    //-------------------------------------------------------------------------
    // JSX
    //-------------------------------------------------------------------------

    /// Reports a JSX element or fragment written where JSX is not enabled.
    fn check_jsx_not_allowed(&mut self, node: u32) {
        if !self.jsx && !self.in_jsx {
            self.report_str(
                "JSX syntax is not allowed unless the jsx option is enabled.",
                self.ast.start(node),
            );
        }
    }

    /// Reports a closing tag whose name does not match its opening tag.
    fn check_jsx_tags_match(&mut self, node: u32) {
        let ast = self.ast;
        let closing = ast.field(node, NODE_B);

        if closing == 0 {
            return;
        }

        let opening = ast.field(node, NODE_A);
        let opening_name = ast.field(opening, NODE_A);
        let closing_name = ast.field(closing, NODE_A);

        if !self.jsx_names_equal(opening_name, closing_name) {
            self.report_string(
                format!(
                    "JSX element <{}> is closed by </{}>.",
                    self.jsx_tag_name(opening_name),
                    self.jsx_tag_name(closing_name)
                ),
                ast.start(closing),
            );
        }
    }

    /// Compares two JSX tag names as written, ignoring internal whitespace.
    fn jsx_names_equal(&self, a: u32, b: u32) -> bool {
        if a == 0 || b == 0 {
            return a == b;
        }

        let ast = self.ast;
        let source = ast.source;
        let a_end = ast.end(a) as usize;
        let b_end = ast.end(b) as usize;
        let mut i = ast.start(a) as usize;
        let mut j = ast.start(b) as usize;

        loop {
            while i < a_end && is_jsx_name_space(source[i] as i32) {
                i += 1;
            }

            while j < b_end && is_jsx_name_space(source[j] as i32) {
                j += 1;
            }

            if i >= a_end || j >= b_end {
                return i >= a_end && j >= b_end;
            }

            if source[i] != source[j] {
                return false;
            }

            i += 1;
            j += 1;
        }
    }

    /// Reads a JSX tag name with its internal whitespace removed.
    fn jsx_tag_name(&self, name: u32) -> String {
        if name == 0 {
            return String::new();
        }

        let kept: Vec<u16> = self
            .ast
            .text(name)
            .iter()
            .copied()
            .filter(|&unit| !is_jsx_name_space(unit as i32))
            .collect();

        name_of(&kept)
    }

    //-------------------------------------------------------------------------
    // Private Names
    //-------------------------------------------------------------------------

    /// Collects the private names a class body declares, reporting the ones it
    /// may not declare twice.
    fn collect_private_names(&mut self, body: u32) -> HashSet<Vec<u16>> {
        let ast = self.ast;
        let members = ast.field(body, NODE_A);
        let size = ast.list_size(members);
        let mut names: HashSet<Vec<u16>> = HashSet::new();
        let mut seen: HashMap<Vec<u16>, i32> = HashMap::new();

        for i in 0..size {
            let member = ast.list_item(members, i);
            let member_kind = ast.kind(member);

            if member_kind == N_STATIC_BLOCK || member_kind == N_TS_INDEX_SIGNATURE {
                continue;
            }

            let key = ast.field(member, NODE_A);

            if key == 0
                || ast.kind(key) != N_PRIVATE_IDENTIFIER
                || (ast.flags(member) & NF_COMPUTED) != 0
            {
                continue;
            }

            self.permit_private_name(key);

            let name = self.private_name(key);

            if eq_ascii(&name, b"#constructor") {
                self.report_str(
                    "Classes may not have a private element named '#constructor'.",
                    ast.start(key),
                );
                continue;
            }

            names.insert(name.clone());

            let flags = ast.flags(member);
            let accessor = (flags & MKIND_MASK) >> MKIND_SHIFT;
            let is_static = (flags & NF_STATIC) != 0;
            let descriptor: i32 = if accessor == MKIND_GET || accessor == MKIND_SET {
                accessor as i32 | if is_static { 4 } else { 0 }
            } else {
                -1
            };

            let Some(&previous) = seen.get(&name) else {
                seen.insert(name, descriptor);
                continue;
            };

            let pairs = descriptor >= 0
                && previous >= 0
                && (descriptor & 4) == (previous & 4)
                && (descriptor & 3) != (previous & 3);

            if !pairs {
                self.report_string(
                    format!("Identifier '{}' has already been declared.", name_of(&name)),
                    ast.start(key),
                );
                continue;
            }

            // A completed pair may not take a third member.
            seen.insert(name, -1);
        }

        names
    }

    /// Reads a private name, resolving any escapes in it.
    fn private_name(&self, key: u32) -> Vec<u16> {
        let raw = self.ast.text(key);

        if raw.iter().any(|&unit| unit as i32 == CH_BACKSLASH) {
            decode_escapes(raw)
        } else {
            raw.to_vec()
        }
    }

    /// Determines whether an expression reads a private field.
    fn is_private_reference(&self, node: u32) -> bool {
        let ast = self.ast;
        let mut current = node;

        while ast.kind(current) == N_CHAIN_EXPRESSION {
            current = ast.field(current, NODE_A);

            if current == 0 {
                return false;
            }
        }

        if ast.kind(current) != N_MEMBER_EXPRESSION {
            return false;
        }

        let property = ast.field(current, NODE_B);

        property != 0 && ast.kind(property) == N_PRIVATE_IDENTIFIER
    }

    /// Records that a `PrivateIdentifier` stands somewhere one may.
    fn permit_private_name(&mut self, key: u32) {
        self.permitted_private_names.insert(key);
    }

    /// Reports a private name that no enclosing class declares.
    fn check_private_reference(&mut self, key: u32) {
        let name = self.private_name(key);

        for names in self.private_names.iter().rev() {
            if names.contains(&name) {
                return;
            }
        }

        self.report_string(
            format!(
                "Private field '{}' must be declared in an enclosing class.",
                name_of(&name)
            ),
            self.ast.start(key),
        );
    }

    //-------------------------------------------------------------------------
    // Assignment Targets
    //-------------------------------------------------------------------------

    /// Reports an expression being assigned to that cannot be.
    fn check_assignment_target(&mut self, node: u32, pattern: bool, web_compat: bool) {
        if node == 0 {
            return;
        }

        let ast = self.ast;

        match ast.kind(node) {
            k if k == N_IDENTIFIER => {
                self.check_restricted_name(node, "assigned to");
                return;
            }

            k if k == N_MEMBER_EXPRESSION => {
                return;
            }

            k if k == N_TS_NON_NULL_EXPRESSION
                || k == N_TS_AS_EXPRESSION
                || k == N_TS_SATISFIES_EXPRESSION
                || k == N_TS_TYPE_ASSERTION =>
            {
                self.check_assignment_target(ast.field(node, NODE_A), pattern, web_compat);
                return;
            }

            k if k == N_ARRAY_PATTERN => {
                if pattern && (ast.flags(node) & NF_PARENTHESIZED) == 0 {
                    self.check_array_pattern(node);
                    return;
                }
            }

            k if k == N_OBJECT_PATTERN => {
                if pattern && (ast.flags(node) & NF_PARENTHESIZED) == 0 {
                    self.check_object_pattern(node);
                    return;
                }
            }

            k if k == N_CALL_EXPRESSION => {
                if !self.strict && web_compat {
                    return;
                }
            }

            _ => {}
        }

        self.report_str("Invalid assignment target.", ast.start(node));
    }

    /// Checks the elements of an array destructuring pattern.
    fn check_array_pattern(&mut self, node: u32) {
        let ast = self.ast;
        let elements = ast.field(node, NODE_A);
        let size = ast.list_size(elements);

        for i in 0..size {
            let element = ast.list_item(elements, i);

            // A hole is written as a missing element and targets nothing.
            if element == 0 {
                continue;
            }

            if ast.kind(element) != N_REST_ELEMENT {
                self.check_pattern_element(element);
                continue;
            }

            if i == size - 1 {
                self.check_comma_after_rest(node, element);
            } else {
                self.report_str("A rest element must be the last element.", ast.start(element));
            }

            self.check_rest_target(element);
        }
    }

    /// Checks the properties of an object destructuring pattern.
    fn check_object_pattern(&mut self, node: u32) {
        let ast = self.ast;
        let properties = ast.field(node, NODE_A);
        let size = ast.list_size(properties);

        for i in 0..size {
            let property = ast.list_item(properties, i);

            if ast.kind(property) == N_REST_ELEMENT {
                if i == size - 1 {
                    self.check_comma_after_rest(node, property);
                } else {
                    self.report_str(
                        "A rest element must be the last element.",
                        ast.start(property),
                    );
                }

                self.check_rest_target(property);
                continue;
            }

            self.check_pattern_element(ast.field(property, NODE_B));
        }
    }

    /// Reports a comma written after the rest element that ends a pattern.
    fn check_comma_after_rest(&mut self, pattern: u32, rest: u32) {
        if (self.ast.flags(pattern) & NF_COMMA_AFTER_REST) != 0 {
            self.report_str(
                "A comma is not allowed after a rest element.",
                self.ast.start(rest),
            );
        }
    }

    /// Checks one element of a pattern, seeing past its default.
    fn check_pattern_element(&mut self, node: u32) {
        if node == 0 {
            return;
        }

        let target = if self.ast.kind(node) == N_ASSIGNMENT_PATTERN {
            self.ast.field(node, NODE_A)
        } else {
            node
        };

        self.check_assignment_target(target, true, true);
    }

    /// Checks what a rest element collects into.
    fn check_rest_target(&mut self, node: u32) {
        let target = self.ast.field(node, NODE_A);

        if target != 0 && self.ast.kind(target) == N_ASSIGNMENT_PATTERN {
            self.report_str(
                "A rest element cannot have an initializer.",
                self.ast.start(target),
            );

            return;
        }

        self.check_assignment_target(target, true, true);
    }

    //-------------------------------------------------------------------------
    // `break` and `continue`
    //-------------------------------------------------------------------------

    /// Reports a `break` or `continue` with nothing to act on.
    fn check_break_or_continue(&mut self, node: u32, is_continue: bool) {
        let ast = self.ast;
        let label = ast.field(node, NODE_A);
        let word = if is_continue { "continue" } else { "break" };

        if label == 0 {
            if self.iteration_depth == 0 && (is_continue || self.switch_depth == 0) {
                self.report_str(
                    if is_continue {
                        "'continue' must be inside a loop."
                    } else {
                        "'break' must be inside a loop or a switch."
                    },
                    ast.start(node),
                );
            }

            return;
        }

        let name = self.identifier_name(label);

        for i in self.label_floor..self.labels.len() {
            if self.labels[i].name != name {
                continue;
            }

            if !is_continue || self.labels[i].iteration {
                return;
            }

            self.report_string(
                format!(
                    "Label '{}' is not on a loop, so 'continue' cannot name it.",
                    name_of(&name)
                ),
                ast.start(node),
            );

            return;
        }

        self.report_string(
            format!("Label '{}' is not enclosing this '{word}'.", name_of(&name)),
            ast.start(node),
        );
    }

    //-------------------------------------------------------------------------
    // `for` Statement Heads
    //-------------------------------------------------------------------------

    /// Reports a `for-in` or `for-of` head that declares more than it may.
    fn check_for_head(&mut self, node: u32, is_for_of: bool) {
        let ast = self.ast;
        let left = ast.field(node, NODE_A);

        if left == 0 {
            return;
        }

        if ast.kind(left) != N_VARIABLE_DECLARATION {
            if is_for_of
                && (ast.flags(node) & NF_ASYNC) == 0
                && ast.kind(left) == N_IDENTIFIER
                && (ast.flags(left) & NF_PARENTHESIZED) == 0
                && eq_ascii(ast.text(left), b"async")
            {
                self.report_str(
                    "'async' may not be the target of a for-of loop.",
                    ast.start(left),
                );
            }

            return;
        }

        let declarations = ast.field(left, NODE_A);
        let size = ast.list_size(declarations);

        if size > 1 {
            self.report_str(
                "A for-in or for-of head may declare only one binding.",
                ast.start(ast.list_item(declarations, 1)),
            );

            return;
        }

        if !is_for_of {
            let head_kind = (ast.flags(left) & DECL_MASK) >> DECL_SHIFT;

            if head_kind == DECL_USING || head_kind == DECL_AWAIT_USING {
                self.report_string(
                    format!(
                        "A '{}' declaration may not head a for-in loop.",
                        DECL_KIND_NAMES[head_kind as usize]
                    ),
                    ast.start(left),
                );
            }
        }

        let declarator = if size == 0 {
            0
        } else {
            ast.list_item(declarations, 0)
        };

        if declarator == 0 {
            return;
        }

        let target = ast.field(declarator, NODE_A);

        if ast.kind(target) == N_IDENTIFIER && ast.field(target, NODE_B) != 0 {
            self.report_str(
                "A for-in or for-of head may not annotate its binding.",
                ast.start(ast.field(target, NODE_B)),
            );
        }

        if ast.field(declarator, NODE_B) == 0 {
            return;
        }

        let declaration_kind = (ast.flags(left) & DECL_MASK) >> DECL_SHIFT;

        if !is_for_of
            && declaration_kind == DECL_VAR
            && !self.strict
            && ast.kind(ast.field(declarator, NODE_A)) == N_IDENTIFIER
        {
            return;
        }

        self.report_str(
            "A for-in or for-of head may not have an initializer.",
            ast.start(ast.field(declarator, NODE_B)),
        );
    }

    //-------------------------------------------------------------------------
    // Class Element Names
    //-------------------------------------------------------------------------

    /// The name a class element is written with.
    fn property_name(&self, node: u32) -> Option<Vec<u16>> {
        let ast = self.ast;

        if (ast.flags(node) & NF_COMPUTED) != 0 {
            return None;
        }

        let key = ast.field(node, NODE_A);

        if key == 0 {
            return None;
        }

        match ast.kind(key) {
            k if k == N_IDENTIFIER => Some(self.identifier_name(key)),

            k if k == N_LITERAL => {
                if ast.field(key, NODE_A) == LIT_STRING {
                    let text = ast.text(key);

                    Some(decode_escapes(&text[1..text.len() - 1]))
                } else {
                    None
                }
            }

            _ => None,
        }
    }

    /// Reports a class element whose name it may not have.
    fn check_class_element_name(&mut self, node: u32, kind: u32) {
        let ast = self.ast;
        let flags = ast.flags(node);
        let is_static = (flags & NF_STATIC) != 0;
        let Some(name) = self.property_name(node) else {
            return;
        };

        if is_static && eq_ascii(&name, b"prototype") {
            self.report_str(
                "A static class element may not be named 'prototype'.",
                ast.start(node),
            );

            return;
        }

        if !eq_ascii(&name, b"constructor") {
            return;
        }

        if kind != N_METHOD_DEFINITION && kind != N_TS_ABSTRACT_METHOD_DEFINITION {
            self.report_str("A class field may not be named 'constructor'.", ast.start(node));

            return;
        }

        if is_static {
            return;
        }

        let value = ast.field(node, NODE_B);
        let accessor = (flags & MKIND_MASK) >> MKIND_SHIFT;

        if accessor != MKIND_CONSTRUCTOR
            || (value != 0 && (ast.flags(value) & (NF_GENERATOR | NF_ASYNC)) != 0)
        {
            self.report_str(
                "A class constructor may not be a getter, a setter, a generator, or async.",
                ast.start(node),
            );

            return;
        }

        if value == 0 || ast.kind(value) == N_TS_EMPTY_BODY_FUNCTION_EXPRESSION {
            return;
        }

        if self.saw_constructor {
            self.report_str(
                "A class may not have more than one constructor.",
                ast.start(node),
            );

            return;
        }

        self.saw_constructor = true;
    }

    //-------------------------------------------------------------------------
    // Single-Statement Contexts
    //-------------------------------------------------------------------------

    /// Reports a declaration written where only a statement may go.
    fn check_statement_body(&mut self, body: u32, allow_function: bool) {
        if body == 0 {
            return;
        }

        let ast = self.ast;
        let kind = ast.kind(body);

        if kind == N_VARIABLE_DECLARATION {
            // `var` is the one declaration that is also a statement.
            if (ast.flags(body) & DECL_MASK) >> DECL_SHIFT == DECL_VAR {
                return;
            }
        } else if kind != N_CLASS_DECLARATION && kind != N_FUNCTION_DECLARATION {
            return;
        }

        if allow_function
            && !self.strict
            && kind == N_FUNCTION_DECLARATION
            && (ast.flags(body) & (NF_GENERATOR | NF_ASYNC)) == 0
        {
            return;
        }

        self.report_str(
            "A declaration may not appear in a single-statement context.",
            ast.start(body),
        );
    }

    //-------------------------------------------------------------------------
    // Node Checks
    //-------------------------------------------------------------------------

    /// Applies the checks that belong to a single node.
    fn check(&mut self, node: u32, kind: u32) {
        if self.dialect_js && kind >= TS_FIRST {
            self.report_str(
                "TypeScript syntax is not allowed when the dialect is \"js\".",
                self.ast.start(node),
            );
        }

        let ast = self.ast;

        match kind {
            k if k == N_PROPERTY_DEFINITION
                || k == N_ACCESSOR_PROPERTY
                || k == N_TS_ABSTRACT_PROPERTY_DEFINITION
                || k == N_TS_ABSTRACT_ACCESSOR_PROPERTY =>
            {
                let is_abstract = kind == N_TS_ABSTRACT_PROPERTY_DEFINITION
                    || kind == N_TS_ABSTRACT_ACCESSOR_PROPERTY;
                let value = ast.field(node, NODE_B);

                self.check_definite_assertion(node, value, ast.field(node, NODE_D), is_abstract);

                if is_abstract && value != 0 {
                    self.report_str(
                        "An abstract class element may not have an initializer.",
                        ast.start(node),
                    );
                }

                self.check_class_element_name(node, kind);
            }

            k if k == N_METHOD_DEFINITION => {
                self.check_method_modifiers(node);
                self.check_decorated_overload(node);
                self.permit_parameter_properties(node);
                self.check_class_element_name(node, kind);
            }

            k if k == N_TS_PARAMETER_PROPERTY => {
                self.check_parameter_property(node);
            }

            k if k == N_TS_INDEX_SIGNATURE => {
                self.check_index_signature(node);
            }

            k if k == N_TS_TYPE_PARAMETER_DECLARATION => {
                self.check_empty_type_list(node, "A type parameter list may not be empty.");
                self.check_type_parameter_variance(node);
            }

            k if k == N_TS_TYPE_PARAMETER_INSTANTIATION => {
                self.check_empty_type_list(node, "A type argument list may not be empty.");
            }

            k if k == N_TS_ENUM_MEMBER => {
                self.check_enum_member(node);
            }

            k if k == N_TS_MODULE_DECLARATION => {
                self.check_module_name(node);
            }

            k if k == N_CLASS_DECLARATION || k == N_CLASS_EXPRESSION => {
                self.permit_variance(ast.field(node, NODE_D));

                if kind == N_CLASS_DECLARATION
                    && ast.field(node, NODE_A) == 0
                    && self.anonymous_class_allowed != node
                {
                    self.report_str(
                        "A class declaration must have a name unless it is the default export.",
                        ast.start(node),
                    );
                }
            }

            k if k == N_TS_INTERFACE_DECLARATION || k == N_TS_TYPE_ALIAS_DECLARATION => {
                self.permit_variance(ast.field(node, NODE_C));
            }

            k if k == N_TS_ABSTRACT_METHOD_DEFINITION => {
                let value = ast.field(node, NODE_B);

                self.check_method_modifiers(node);

                if value != 0 && ast.field(value, NODE_C) != 0 {
                    self.report_str(
                        "An abstract class element may not have an implementation.",
                        ast.start(node),
                    );
                }

                self.check_class_element_name(node, kind);
            }

            k if k == N_IMPORT_DECLARATION
                || k == N_EXPORT_NAMED_DECLARATION
                || k == N_EXPORT_DEFAULT_DECLARATION
                || k == N_EXPORT_ALL_DECLARATION =>
            {
                if kind == N_IMPORT_DECLARATION {
                    self.check_type_only_import(node);
                }

                if kind == N_EXPORT_DEFAULT_DECLARATION {
                    self.anonymous_class_allowed = ast.field(node, NODE_A);
                }

                if kind != N_EXPORT_DEFAULT_DECLARATION {
                    let slot = if kind == N_EXPORT_NAMED_DECLARATION {
                        NODE_D
                    } else {
                        NODE_C
                    };

                    self.check_import_attributes(ast.field(node, slot));
                }

                if self.source_type != ValidateSourceType::Module {
                    self.report_str(
                        "'import' and 'export' may only appear when sourceType is \"module\".",
                        ast.start(node),
                    );
                } else if !self.module_items_allowed {
                    self.report_str(
                        "'import' and 'export' may only appear at the top level of a module or a namespace.",
                        ast.start(node),
                    );
                }
            }

            k if k == N_BREAK_STATEMENT || k == N_CONTINUE_STATEMENT => {
                self.check_break_or_continue(node, kind == N_CONTINUE_STATEMENT);
            }

            k if k == N_PRIVATE_IDENTIFIER => {
                if !self.permitted_private_names.contains(&node) {
                    self.report_str(
                        "A private name may only be a class element's name, the property of a member access, or the left operand of 'in'.",
                        ast.start(node),
                    );
                }
            }

            k if k == N_TEMPLATE_LITERAL => {
                if node == self.tagged_quasi || node == self.type_quasi {
                    return;
                }

                let quasis = ast.field(node, NODE_A);
                let size = ast.list_size(quasis);

                for i in 0..size {
                    let quasi = ast.list_item(quasis, i);

                    if (ast.flags(quasi) & NF_INVALID_ESCAPE) != 0 {
                        self.report_str(
                            "Invalid escape sequence in untagged template literal.",
                            ast.start(quasi),
                        );

                        return;
                    }
                }
            }

            k if k == N_WITH_STATEMENT => {
                if self.strict {
                    self.report_str(
                        "Strict mode code may not include a with statement.",
                        ast.start(node),
                    );
                }

                self.check_statement_body(ast.field(node, NODE_B), false);
            }

            k if k == N_IF_STATEMENT => {
                self.check_statement_body(ast.field(node, NODE_B), true);
                self.check_statement_body(ast.field(node, NODE_C), true);
            }

            k if k == N_LABELED_STATEMENT => {
                let in_statement_list = self.in_statement_list;

                self.check_statement_body(ast.field(node, NODE_B), in_statement_list);
            }

            k if k == N_WHILE_STATEMENT => {
                self.check_statement_body(ast.field(node, NODE_B), false);
            }

            k if k == N_DO_WHILE_STATEMENT => {
                self.check_statement_body(ast.field(node, NODE_A), false);
            }

            k if k == N_FOR_STATEMENT => {
                self.check_statement_body(ast.field(node, NODE_D), false);
            }

            k if k == N_MEMBER_EXPRESSION => {
                let property = ast.field(node, NODE_B);

                if property != 0 && ast.kind(property) == N_PRIVATE_IDENTIFIER {
                    self.permit_private_name(property);
                    self.check_private_reference(property);

                    if ast.kind(ast.field(node, NODE_A)) == N_SUPER {
                        self.report_str(
                            "A private name may not be read on 'super'.",
                            ast.start(node),
                        );
                    }
                }

                let allowed = self.super_property_allowed;

                self.check_super_operand(
                    ast.field(node, NODE_A),
                    allowed,
                    "'super' may only be read inside a method, a field initializer, or a static block.",
                );
            }

            k if k == N_CALL_EXPRESSION => {
                let allowed = self.super_call_allowed;

                self.check_super_operand(
                    ast.field(node, NODE_A),
                    allowed,
                    "'super' may only be called inside the constructor of a derived class.",
                );
            }

            k if k == N_SUPER => {
                if node != self.sanctioned_super {
                    self.report_str(
                        "'super' must be followed by an argument list or a property access.",
                        ast.start(node),
                    );
                }
            }

            k if k == N_BINARY_EXPRESSION => {
                let left = ast.field(node, NODE_A);

                if ast.field(node, NODE_C) == T_IN
                    && left != 0
                    && ast.kind(left) == N_PRIVATE_IDENTIFIER
                {
                    self.permit_private_name(left);
                    self.check_private_reference(left);
                }
            }

            k if k == N_UNARY_EXPRESSION => {
                let argument = ast.field(node, NODE_A);

                if ast.field(node, NODE_B) != T_DELETE || argument == 0 {
                    return;
                }

                if self.is_private_reference(argument) {
                    self.report_str("Private fields cannot be deleted.", ast.start(node));

                    return;
                }

                if self.strict && ast.kind(argument) == N_IDENTIFIER {
                    self.report_str(
                        "Deleting a local variable is not allowed in strict mode.",
                        ast.start(node),
                    );
                }
            }

            k if k == N_ASSIGNMENT_EXPRESSION => {
                let operator = ast.field(node, NODE_C);

                self.check_assignment_target(
                    ast.field(node, NODE_A),
                    operator == T_ASSIGN,
                    operator < T_ASSIGN_AMPAMP,
                );
            }

            k if k == N_UPDATE_EXPRESSION => {
                self.check_assignment_target(ast.field(node, NODE_A), false, true);
            }

            k if k == N_FOR_IN_STATEMENT || k == N_FOR_OF_STATEMENT => {
                let left = ast.field(node, NODE_A);

                if left != 0 && ast.kind(left) != N_VARIABLE_DECLARATION {
                    self.check_assignment_target(left, true, true);
                }

                self.check_for_head(node, kind == N_FOR_OF_STATEMENT);
                self.check_statement_body(ast.field(node, NODE_C), false);
            }

            k if k == N_LITERAL => {
                if (self.strict || !self.dialect_js)
                    && (ast.flags(node) & NF_LEGACY_OCTAL) != 0
                {
                    self.report_str(
                        if self.strict {
                            "Octal literals are not allowed in strict mode."
                        } else {
                            "Octal literals are not allowed in TypeScript."
                        },
                        ast.start(node),
                    );

                    return;
                }

                if ast.field(node, NODE_A) != LIT_REGEXP {
                    return;
                }

                let problem = RegExpValidator::validate(
                    ast.source,
                    ast.start(node) as usize,
                    ast.field(node, NODE_B) as usize,
                    ast.end(node) as usize,
                );

                if let Some(problem) = problem {
                    self.report_str(problem.message, problem.start);
                }
            }

            k if k == N_YIELD_EXPRESSION || k == N_AWAIT_EXPRESSION => {
                let location = if self.in_parameters {
                    Some("a parameter list")
                } else if self.in_static_block {
                    Some("a class static block")
                } else {
                    None
                };

                if let Some(location) = location {
                    self.report_string(
                        if kind == N_YIELD_EXPRESSION {
                            format!("A yield expression may not appear in {location}.")
                        } else {
                            format!("An await expression may not appear in {location}.")
                        },
                        ast.start(node),
                    );
                }
            }

            k if k == N_PROPERTY => {
                if (ast.flags(node) & NF_SHORTHAND) != 0 {
                    self.check_shorthand_name(node);
                }

                self.check_object_method_body(node);
            }

            k if k == N_OBJECT_EXPRESSION => {
                self.check_object_literal(node);
            }

            k if k == N_CHAIN_EXPRESSION => {
                let mut current = ast.field(node, NODE_A);
                let mut tag = 0;

                while current != 0 && (ast.flags(current) & NF_PARENTHESIZED) == 0 {
                    let link_kind = ast.kind(current);

                    if tag != 0 && (ast.flags(current) & NF_OPTIONAL) != 0 {
                        self.report_str(
                            "A template literal may not be tagged with an optional chain.",
                            ast.start(tag),
                        );

                        return;
                    }

                    if link_kind == N_TAGGED_TEMPLATE_EXPRESSION {
                        tag = current;
                    } else if link_kind != N_MEMBER_EXPRESSION && link_kind != N_CALL_EXPRESSION {
                        return;
                    }

                    current = ast.field(current, NODE_A);
                }
            }

            k if k == N_META_PROPERTY => {
                let property = ast.field(node, NODE_B);
                let is_import = eq_ascii(ast.text(ast.field(node, NODE_A)), b"import");

                if ast
                    .text(property)
                    .iter()
                    .any(|&unit| unit as i32 == CH_BACKSLASH)
                {
                    self.report_string(
                        format!(
                            "'{}' may not be written with an escape.",
                            if is_import { "import.meta" } else { "new.target" }
                        ),
                        ast.start(property),
                    );

                    return;
                }

                if is_import {
                    if !eq_ascii(ast.text(property), b"meta") {
                        self.report_str(
                            "'import' has no meta-property but 'import.meta'.",
                            ast.start(node),
                        );

                        return;
                    }

                    if self.source_type != ValidateSourceType::Module {
                        self.report_str(
                            "'import.meta' may only appear when sourceType is \"module\".",
                            ast.start(node),
                        );
                    }

                    return;
                }

                if !self.new_target_allowed {
                    self.report_str(
                        "'new.target' may only appear inside a function, a class field initializer, or a class static block.",
                        ast.start(node),
                    );
                }
            }

            k if k == N_IMPORT_SPECIFIER || k == N_EXPORT_SPECIFIER => {
                self.check_shared_name(node);
            }

            k if k == N_JSX_ELEMENT => {
                self.check_jsx_not_allowed(node);
                self.check_jsx_tags_match(node);
            }

            k if k == N_JSX_FRAGMENT => {
                self.check_jsx_not_allowed(node);
            }

            k if k == N_RETURN_STATEMENT => {
                if self.function_depth == 0 {
                    self.report_str("'return' outside of function.", ast.start(node));
                }
            }

            _ => {}
        }
    }
}
