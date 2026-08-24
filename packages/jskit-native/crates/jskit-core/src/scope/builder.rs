//! The scope graph, built directly in binary form.
//!
//! Port of `packages/jskit/src/scope/scope-builder.ts`, specialized to the
//! binary AST path. Every ordering the TypeScript implementation produces —
//! reference IDs in walk order, symbols scope by scope in binding order,
//! string IDs in first-seen order, the pool laid out in emission order — is
//! reproduced exactly, because the buffer must be byte-identical.

use std::collections::HashMap;

use crate::parse::binary::WordBuffer;
use crate::parse::node_kinds::{
    N_ARROW_FUNCTION_EXPRESSION, N_BLOCK_STATEMENT, N_PROGRAM,
};
use super::binary_ast::BinaryAst;
use super::buffer::*;
use super::options::ResolvedOptions;

// Build-time record layouts. Scopes and symbols carry their list heads and
// tails inline; `finish()` turns the chains into pool lists.

pub const BS_WORDS: usize = 13;
pub const BS_TYPE: usize = 0;
pub const BS_FLAGS: usize = 1;
pub const BS_BLOCK: usize = 2;
pub const BS_UPPER: usize = 3; // scope ID + 1
pub const BS_VARIABLE_SCOPE: usize = 4;
pub const BS_VARS_HEAD: usize = 5;
// BS_VARS_HEAD + 1 is the tail; append_to() relies on tail = head + 1.
pub const BS_REFS_HEAD: usize = 7;
pub const BS_THROUGH_HEAD: usize = 9;
pub const BS_LEFT_HEAD: usize = 11;

/// `BS_FLAGS` bit: the scope's block is the whole program (`globalReturn`).
pub const BSF_PROGRAM_BLOCK: u32 = 64;

pub const BV_WORDS: usize = 9;
pub const BV_NAME: usize = 0;
pub const BV_SCOPE: usize = 1;
pub const BV_FLAGS: usize = 2;
pub const BV_IDENTS_HEAD: usize = 3;
pub const BV_DEFS_HEAD: usize = 5;
pub const BV_REFS_HEAD: usize = 7;

/// `BV_FLAGS` bits beyond the serialized `VF_*` set.
pub const BVF_TYPE_BINDING: u32 = 8;
pub const BVF_VALUE_BINDING: u32 = 16;

/// The `VF_*` subset of symbol flags that is serialized.
const BVF_SERIALIZED: u32 = VF_TAINTED | VF_STACK | VF_IMPLICIT_GLOBAL;

/// Scope type codes whose scopes are their own variable scope, as a bitmask.
const VARIABLE_SCOPE_MASK: u32 = (1 << CODE_GLOBAL)
    | (1 << CODE_MODULE)
    | (1 << CODE_FUNCTION)
    | (1 << CODE_CLASS_FIELD_INITIALIZER)
    | (1 << CODE_CLASS_STATIC_BLOCK)
    | (1 << CODE_TS_MODULE);

/// Scope type codes that are strict by nature, as a bitmask.
const IMPLICITLY_STRICT_MASK: u32 = (1 << CODE_CLASS)
    | (1 << CODE_MODULE)
    | (1 << CODE_CONDITIONAL_TYPE)
    | (1 << CODE_FUNCTION_TYPE)
    | (1 << CODE_MAPPED_TYPE)
    | (1 << CODE_TS_ENUM)
    | (1 << CODE_TS_MODULE)
    | (1 << CODE_TYPE);

/// The UTF-16 spelling of `"use strict"`.
const USE_STRICT: [u16; 10] = [
    b'u' as u16,
    b's' as u16,
    b'e' as u16,
    b' ' as u16,
    b's' as u16,
    b't' as u16,
    b'r' as u16,
    b'i' as u16,
    b'c' as u16,
    b't' as u16,
];

/// Sorts `(key, value)` pairs by key, then value, and flattens them.
fn sorted_pair_words(mut pairs: Vec<(u32, u32)>) -> Vec<u32> {
    pairs.sort_unstable_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

    let mut words = Vec::with_capacity(pairs.len() * 2);

    for (key, value) in pairs {
        words.push(key);
        words.push(value);
    }

    words
}

/// Interns UTF-16 strings, assigning IDs in first-seen order.
pub struct StringTable {
    strings: Vec<Vec<u16>>,
    ids: HashMap<Vec<u16>, u32>,
}

impl StringTable {
    fn new() -> Self {
        StringTable {
            strings: Vec::new(),
            ids: HashMap::new(),
        }
    }

    /// The ID for a string, assigning one the first time it appears.
    pub fn intern(&mut self, value: &[u16]) -> u32 {
        if let Some(&id) = self.ids.get(value) {
            return id;
        }

        let id = self.strings.len() as u32;

        self.ids.insert(value.to_vec(), id);
        self.strings.push(value.to_vec());

        id
    }

    /// Interns an ASCII string.
    pub fn intern_ascii(&mut self, value: &str) -> u32 {
        let units: Vec<u16> = value.bytes().map(u16::from).collect();

        self.intern(&units)
    }

    /// The ID of a string already interned, if any.
    pub fn get(&self, value: &[u16]) -> Option<u32> {
        self.ids.get(value).copied()
    }
}

/// The scope graph under construction, and the walk's whole recording API.
pub struct ScopeBuilder<'a> {
    /// How to read the program.
    pub ast: BinaryAst<'a>,

    /// The options the analysis runs with.
    pub options: ResolvedOptions,

    /// The scope records.
    scopes: WordBuffer,

    /// The symbol records.
    symbols: WordBuffer,

    /// The reference records, already in format layout.
    refs: WordBuffer,

    /// The start offset of each reference's identifier.
    ref_starts: Vec<u32>,

    /// The definition records, already in format layout.
    defs: WordBuffer,

    /// The start offset of each definition's name.
    def_starts: Vec<u32>,

    /// The cell pool every list is chained through: `[value, next]` cells.
    cells: WordBuffer,

    /// Every distinct string, in the order it was first seen.
    pub strings: StringTable,

    /// Each scope's bindings by name ID, created on the first binding.
    bindings: Vec<Option<HashMap<u32, u32>>>,

    /// Each scope's block node.
    blocks: Vec<u32>,

    /// Each symbol's first declaring identifier node, or `0`.
    first_identifiers: Vec<u32>,

    /// The scope being filled in right now, or `-1` once analysis ends.
    current: i32,

    /// How many scopes exist.
    scope_count: u32,

    /// How many symbols exist.
    symbol_count: u32,

    /// How many references exist.
    ref_count: u32,

    /// How many definitions exist.
    def_count: u32,

    /// The global scope's implicit variables, by name ID.
    implicit_by_name: HashMap<u32, u32>,

    /// Head cell of the implicit variable list.
    implicit_head: u32,

    /// Tail cell of the implicit variable list.
    implicit_tail: u32,

    /// Each declaring node's symbol chain, in insertion order — the JS `Map`
    /// the TypeScript code iterates at emission time preserves it, and the
    /// pool layout depends on it.
    declared: Vec<(u32, u32, u32)>, // (handle, head cell, tail cell)

    /// The index of each declaring node's entry in `declared`.
    declared_index: HashMap<u32, usize>,
}

impl<'a> ScopeBuilder<'a> {
    /// Creates an empty builder.
    pub fn new(ast: BinaryAst<'a>, options: ResolvedOptions) -> Self {
        let mut cells = WordBuffer::new(256);

        // Cell 0 is the "no cell" sentinel.
        cells.push(0);
        cells.push(0);

        ScopeBuilder {
            ast,
            options,
            scopes: WordBuffer::new(16 * BS_WORDS),
            symbols: WordBuffer::new(32 * BV_WORDS),
            refs: WordBuffer::new(64 * REFERENCE_WORDS),
            ref_starts: Vec::with_capacity(64),
            defs: WordBuffer::new(32 * DEFINITION_WORDS),
            def_starts: Vec::with_capacity(32),
            cells,
            strings: StringTable::new(),
            bindings: Vec::new(),
            blocks: Vec::new(),
            first_identifiers: Vec::new(),
            current: -1,
            scope_count: 0,
            symbol_count: 0,
            ref_count: 0,
            def_count: 0,
            implicit_by_name: HashMap::new(),
            implicit_head: 0,
            implicit_tail: 0,
            declared: Vec::new(),
            declared_index: HashMap::new(),
        }
    }

    //-------------------------------------------------------------------------
    // Options
    //-------------------------------------------------------------------------

    /// Whether the program is an ES module.
    pub fn is_module(&self) -> bool {
        self.options.source_type == super::options::ScopeSourceType::Module
    }

    /// Whether the program runs inside an implicit function.
    pub fn is_global_return(&self) -> bool {
        self.options.global_return
            || self.options.source_type == super::options::ScopeSourceType::CommonJs
    }

    /// Whether strict mode applies without a directive saying so.
    pub fn is_implied_strict(&self) -> bool {
        self.options.implied_strict
    }

    //-------------------------------------------------------------------------
    // Cells
    //-------------------------------------------------------------------------

    /// Appends a value to a chained list held in the scope records.
    fn append_to_scope(&mut self, base: usize, head_field: usize, value: u32) {
        let cell = self.cells.reserve(2);

        self.cells.words[cell] = value;
        self.cells.words[cell + 1] = 0;

        let tail = self.scopes.words[base + head_field + 1];

        if tail == 0 {
            self.scopes.words[base + head_field] = cell as u32;
        } else {
            self.cells.words[tail as usize + 1] = cell as u32;
        }

        self.scopes.words[base + head_field + 1] = cell as u32;
    }

    /// Appends a value to a chained list held in the symbol records.
    fn append_to_symbol(&mut self, base: usize, head_field: usize, value: u32) {
        let cell = self.cells.reserve(2);

        self.cells.words[cell] = value;
        self.cells.words[cell + 1] = 0;

        let tail = self.symbols.words[base + head_field + 1];

        if tail == 0 {
            self.symbols.words[base + head_field] = cell as u32;
        } else {
            self.cells.words[tail as usize + 1] = cell as u32;
        }

        self.symbols.words[base + head_field + 1] = cell as u32;
    }

    //-------------------------------------------------------------------------
    // Nesting
    //-------------------------------------------------------------------------

    /// Opens a scope inside the current one and makes it current.
    fn nest(&mut self, code: u32, block: u32, is_method_definition: bool) -> u32 {
        let id = self.scope_count;

        self.scope_count += 1;

        let base = self.scopes.reserve(BS_WORDS);
        let upper = self.current;
        let mut flags = 0u32;

        if code == CODE_GLOBAL || code == CODE_WITH {
            flags |= SF_DYNAMIC;
        }

        if code == CODE_FUNCTION && self.ast.kind(block) == N_PROGRAM {
            flags |= BSF_PROGRAM_BLOCK;
        }

        if self.is_strict_scope(code, upper, block, is_method_definition, flags) {
            flags |= SF_STRICT;
        }

        let words = &mut self.scopes.words;

        words[base + BS_TYPE] = code;
        words[base + BS_FLAGS] = flags;
        words[base + BS_BLOCK] = self.ast.handle_of(block);
        words[base + BS_UPPER] = (upper + 1) as u32;
        words[base + BS_VARIABLE_SCOPE] = if (VARIABLE_SCOPE_MASK >> code) & 1 != 0 {
            id
        } else {
            words[upper as usize * BS_WORDS + BS_VARIABLE_SCOPE]
        };

        self.bindings.push(None);
        self.blocks.push(block);
        self.current = id as i32;

        id
    }

    /// Decides whether a scope runs under strict mode.
    fn is_strict_scope(
        &self,
        code: u32,
        upper: i32,
        block: u32,
        is_method_definition: bool,
        flags: u32,
    ) -> bool {
        // Strictness is inherited, so an enclosing strict scope settles it.
        if upper != -1
            && (self.scopes.words[upper as usize * BS_WORDS + BS_FLAGS] & SF_STRICT) != 0
        {
            return true;
        }

        if is_method_definition || (IMPLICITLY_STRICT_MASK >> code) & 1 == 1 {
            return true;
        }

        if code == CODE_BLOCK || code == CODE_SWITCH {
            return false;
        }

        let ast = &self.ast;
        let body: u32;

        if code == CODE_FUNCTION {
            if (flags & BSF_PROGRAM_BLOCK) != 0 {
                body = block;
            } else {
                body = ast.child(block, 2);

                // An expression-bodied arrow has no statement list, so it has
                // no prologue and cannot turn strict mode on by itself.
                if ast.kind(block) == N_ARROW_FUNCTION_EXPRESSION
                    && (body == 0 || ast.kind(body) != N_BLOCK_STATEMENT)
                {
                    return false;
                }
            }

            if body == 0 {
                return false;
            }
        } else if code == CODE_GLOBAL {
            body = block;
        } else {
            return false;
        }

        self.has_use_strict_directive(body)
    }

    /// Whether a statement list opens with a `"use strict"` directive.
    fn has_use_strict_directive(&self, body: u32) -> bool {
        let ast = &self.ast;
        let size = ast.list_size(body, 0);

        for i in 0..size {
            let statement = ast.list_item(body, 0, i);

            if statement == 0 {
                return false;
            }

            // The prologue ends at the first statement that is no directive.
            match ast.directive(statement) {
                None => return false,
                Some(text) => {
                    if text == USE_STRICT {
                        return true;
                    }
                }
            }
        }

        false
    }

    pub fn nest_global_scope(&mut self, block: u32) {
        self.nest(CODE_GLOBAL, block, false);
    }

    pub fn nest_module_scope(&mut self, block: u32) {
        self.nest(CODE_MODULE, block, false);
    }

    /// Opens a function scope, binding `arguments` unless it is an arrow.
    pub fn nest_function_scope(&mut self, block: u32, is_method_definition: bool) {
        let id = self.nest(CODE_FUNCTION, block, is_method_definition);

        if self.ast.kind(block) != N_ARROW_FUNCTION_EXPRESSION {
            let name_id = self.strings.intern_ascii("arguments");

            self.bind_symbol(id, 0, name_id);
        }
    }

    pub fn nest_function_expression_name_scope(&mut self, block: u32) {
        let id = self.nest(CODE_FUNCTION_EXPRESSION_NAME, block, false);

        self.scopes.words[id as usize * BS_WORDS + BS_FLAGS] |= SF_FUNCTION_EXPRESSION_SCOPE;
    }

    pub fn nest_block_scope(&mut self, block: u32) {
        self.nest(CODE_BLOCK, block, false);
    }

    pub fn nest_switch_scope(&mut self, block: u32) {
        self.nest(CODE_SWITCH, block, false);
    }

    pub fn nest_catch_scope(&mut self, block: u32) {
        self.nest(CODE_CATCH, block, false);
    }

    pub fn nest_with_scope(&mut self, block: u32) {
        self.nest(CODE_WITH, block, false);
    }

    pub fn nest_for_scope(&mut self, block: u32) {
        self.nest(CODE_FOR, block, false);
    }

    pub fn nest_class_scope(&mut self, block: u32) {
        self.nest(CODE_CLASS, block, false);
    }

    pub fn nest_class_field_initializer_scope(&mut self, block: u32) {
        self.nest(CODE_CLASS_FIELD_INITIALIZER, block, true);
    }

    pub fn nest_class_static_block_scope(&mut self, block: u32) {
        self.nest(CODE_CLASS_STATIC_BLOCK, block, true);
    }

    pub fn nest_type_scope(&mut self, block: u32) {
        self.nest(CODE_TYPE, block, false);
    }

    pub fn nest_function_type_scope(&mut self, block: u32) {
        self.nest(CODE_FUNCTION_TYPE, block, false);
    }

    pub fn nest_conditional_type_scope(&mut self, block: u32) {
        self.nest(CODE_CONDITIONAL_TYPE, block, false);
    }

    pub fn nest_mapped_type_scope(&mut self, block: u32) {
        self.nest(CODE_MAPPED_TYPE, block, false);
    }

    pub fn nest_ts_enum_scope(&mut self, block: u32) {
        self.nest(CODE_TS_ENUM, block, false);
    }

    pub fn nest_ts_module_scope(&mut self, block: u32) {
        self.nest(CODE_TS_MODULE, block, false);
    }

    //-------------------------------------------------------------------------
    // The current scope
    //-------------------------------------------------------------------------

    /// The scope being filled in right now, or `-1` once every scope closed.
    #[inline]
    pub fn current_scope(&self) -> i32 {
        self.current
    }

    /// The node that opened the current scope.
    #[inline]
    pub fn current_block(&self) -> u32 {
        self.blocks[self.current as usize]
    }

    /// The nearest enclosing scope a `var` declaration binds in.
    #[inline]
    pub fn current_variable_scope(&self) -> u32 {
        self.scopes.words[self.current as usize * BS_WORDS + BS_VARIABLE_SCOPE]
    }

    /// Whether strict mode rules apply in the current scope.
    pub fn is_strict(&self) -> bool {
        (self.scopes.words[self.current as usize * BS_WORDS + BS_FLAGS] & SF_STRICT) != 0
    }

    /// Overrides the current scope's strictness.
    pub fn set_strict(&mut self, strict: bool) {
        let at = self.current as usize * BS_WORDS + BS_FLAGS;

        if strict {
            self.scopes.words[at] |= SF_STRICT;
        } else {
            self.scopes.words[at] &= !SF_STRICT;
        }
    }

    /// The type code of a scope.
    #[inline]
    pub fn scope_type(&self, scope: i32) -> u32 {
        self.scopes.words[scope as usize * BS_WORDS + BS_TYPE]
    }

    /// The enclosing scope's ID, or `-1` for the global scope.
    #[inline]
    pub fn upper_of(&self, scope: i32) -> i32 {
        self.scopes.words[scope as usize * BS_WORDS + BS_UPPER] as i32 - 1
    }

    /// Records that `this` is mentioned in the current variable scope.
    pub fn detect_this(&mut self) {
        let scope = self.current_variable_scope() as usize;

        self.scopes.words[scope * BS_WORDS + BS_FLAGS] |= SF_THIS_FOUND;
    }

    /// Marks the current variable scope, and everything around it, as
    /// containing a direct call to `eval`.
    pub fn detect_eval(&mut self) {
        let mut scope = self.current_variable_scope() as i32;

        self.scopes.words[scope as usize * BS_WORDS + BS_FLAGS] |= SF_DIRECT_EVAL;

        while scope != -1 {
            self.scopes.words[scope as usize * BS_WORDS + BS_FLAGS] |= SF_DYNAMIC;
            scope = self.scopes.words[scope as usize * BS_WORDS + BS_UPPER] as i32 - 1;
        }
    }

    //-------------------------------------------------------------------------
    // Declaring
    //-------------------------------------------------------------------------

    /// Binds a name in a scope, creating the symbol the first time the name
    /// is seen there. `identifier` may be `0` for a binding with none.
    fn bind_symbol(&mut self, scope: u32, identifier: u32, name_id: u32) -> u32 {
        if self.bindings[scope as usize].is_none() {
            self.bindings[scope as usize] = Some(HashMap::new());
        }

        let existing = self.bindings[scope as usize]
            .as_ref()
            .unwrap()
            .get(&name_id)
            .copied();

        let symbol = match existing {
            Some(symbol) => symbol,
            None => {
                let symbol = self.new_symbol(scope, name_id, VF_STACK);

                self.bindings[scope as usize]
                    .as_mut()
                    .unwrap()
                    .insert(name_id, symbol);
                self.append_to_scope(scope as usize * BS_WORDS, BS_VARS_HEAD, symbol);

                symbol
            }
        };

        if identifier != 0 {
            let handle = self.ast.handle_of(identifier);

            self.append_to_symbol(symbol as usize * BV_WORDS, BV_IDENTS_HEAD, handle);

            if self.first_identifiers[symbol as usize] == 0 {
                self.first_identifiers[symbol as usize] = identifier;
            }
        }

        symbol
    }

    /// Creates a bare symbol record.
    fn new_symbol(&mut self, scope: u32, name_id: u32, flags: u32) -> u32 {
        let symbol = self.symbol_count;

        self.symbol_count += 1;

        let base = self.symbols.reserve(BV_WORDS);

        self.symbols.words[base + BV_NAME] = name_id;
        self.symbols.words[base + BV_SCOPE] = scope;
        self.symbols.words[base + BV_FLAGS] = flags;
        self.first_identifiers.push(0);

        symbol
    }

    /// Records one definition of a symbol and files it under its declaring
    /// nodes. `parent` may be `0`; `index` is `-1` for none.
    #[allow(clippy::too_many_arguments)]
    fn add_definition(
        &mut self,
        symbol: u32,
        def_type: u32,
        name: u32,
        node: u32,
        parent: u32,
        index: i32,
        kind_id: u32,
        flags: u32,
    ) {
        let definition = self.def_count;

        self.def_count += 1;

        let base = self.defs.reserve(DEFINITION_WORDS);
        let words = &mut self.defs.words;

        words[base + D_TYPE] = def_type;
        words[base + D_NAME] = self.ast.handle_of(name);
        words[base + D_NODE] = self.ast.handle_of(node);
        words[base + D_PARENT] = if parent == 0 {
            0
        } else {
            self.ast.handle_of(parent)
        };
        words[base + D_INDEX] = (index + 1) as u32;
        words[base + D_KIND] = kind_id;
        words[base + D_FLAGS] = flags;
        self.def_starts.push(self.ast.start(name));

        self.append_to_symbol(symbol as usize * BV_WORDS, BV_DEFS_HEAD, definition);

        let symbol_flags = symbol as usize * BV_WORDS + BV_FLAGS;

        if (flags & DF_TYPE_DEFINITION) != 0 {
            self.symbols.words[symbol_flags] |= BVF_TYPE_BINDING;
        }

        if (flags & DF_VARIABLE_DEFINITION) != 0 {
            self.symbols.words[symbol_flags] |= BVF_VALUE_BINDING;
        }

        let node_handle = self.ast.handle_of(node);

        self.declare_on_handle(node_handle, symbol);

        if parent != 0 {
            let parent_handle = self.ast.handle_of(parent);

            self.declare_on_handle(parent_handle, symbol);
        }
    }

    /// Binds a name declared by `var`, `let`, or `const`.
    #[allow(clippy::too_many_arguments)]
    pub fn define_variable(
        &mut self,
        scope: u32,
        id: u32,
        name: &[u16],
        declarator: u32,
        declaration: u32,
        index: i32,
        kind: &str,
    ) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(scope, id, name_id);
        let kind_id = self.strings.intern_ascii(kind) + 1;

        self.add_definition(
            symbol,
            DEF_CODE_VARIABLE,
            id,
            declarator,
            declaration,
            index,
            kind_id,
            DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds a function parameter in the current scope.
    pub fn define_parameter(&mut self, id: u32, name: &[u16], func: u32, index: i32, rest: bool) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_PARAMETER,
            id,
            func,
            0,
            index,
            0,
            DF_VARIABLE_DEFINITION | (if rest { DF_REST } else { 0 }),
        );
    }

    /// Binds a function's own name in the current scope.
    pub fn define_function_name(&mut self, id: u32, name: &[u16], func: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_FUNCTION,
            id,
            func,
            0,
            -1,
            0,
            DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds a class's own name in the current scope.
    pub fn define_class_name(&mut self, id: u32, name: &[u16], node: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_CLASS,
            id,
            node,
            0,
            -1,
            0,
            DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds a `catch` clause parameter in the current scope.
    pub fn define_catch_clause(&mut self, id: u32, name: &[u16], node: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_CATCH,
            id,
            node,
            0,
            -1,
            0,
            DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds an imported name in the current scope.
    pub fn define_import_binding(&mut self, id: u32, name: &[u16], specifier: u32, declaration: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_IMPORT,
            id,
            specifier,
            declaration,
            -1,
            0,
            DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds a type-only name in a scope.
    pub fn define_type(&mut self, scope: i32, id: u32, name: &[u16], node: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(scope as u32, id, name_id);

        self.add_definition(symbol, DEF_CODE_TYPE, id, node, 0, -1, 0, DF_TYPE_DEFINITION);
    }

    /// Binds an enum's own name in the current scope.
    pub fn define_enum_name(&mut self, id: u32, name: &[u16], node: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_ENUM,
            id,
            node,
            0,
            -1,
            0,
            DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds one enum member in the current scope.
    pub fn define_enum_member(&mut self, id: u32, name: &[u16], member: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_ENUM_MEMBER,
            id,
            member,
            0,
            -1,
            0,
            DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds an enum member whose name a string literal spells.
    pub fn define_enum_member_literal(&mut self, name: &[u16], literal: u32, member: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, 0, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_ENUM_MEMBER,
            literal,
            member,
            0,
            -1,
            0,
            DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
        );
    }

    /// Binds a namespace or module's own name in the current scope.
    pub fn define_module_name(&mut self, id: u32, name: &[u16], node: u32) {
        let name_id = self.strings.intern(name);
        let symbol = self.bind_symbol(self.current as u32, id, name_id);

        self.add_definition(
            symbol,
            DEF_CODE_MODULE,
            id,
            node,
            0,
            -1,
            0,
            DF_TYPE_DEFINITION | DF_VARIABLE_DEFINITION,
        );
    }

    //-------------------------------------------------------------------------
    // Referencing
    //-------------------------------------------------------------------------

    /// Records a reference in a scope and queues it for resolution there.
    /// Node parameters may be `0` for none.
    #[allow(clippy::too_many_arguments)]
    fn add_reference(
        &mut self,
        scope: u32,
        identifier: u32,
        name_id: u32,
        flags: u32,
        write_expr: u32,
        ig_pattern: u32,
        ig_node: u32,
    ) {
        let reference = self.ref_count;

        self.ref_count += 1;

        let base = self.refs.reserve(REFERENCE_WORDS);
        let words = &mut self.refs.words;

        words[base + R_IDENTIFIER] = self.ast.handle_of(identifier);
        words[base + R_NAME] = name_id;
        words[base + R_FROM] = scope;
        words[base + R_RESOLVED] = 0;
        words[base + R_FLAGS] = flags;
        words[base + R_WRITE_EXPR] = if write_expr == 0 {
            0
        } else {
            self.ast.handle_of(write_expr)
        };
        words[base + R_IG_PATTERN] = if ig_pattern == 0 {
            0
        } else {
            self.ast.handle_of(ig_pattern)
        };
        words[base + R_IG_NODE] = if ig_node == 0 {
            0
        } else {
            self.ast.handle_of(ig_node)
        };
        self.ref_starts.push(self.ast.start(identifier));

        let scope_base = scope as usize * BS_WORDS;

        self.append_to_scope(scope_base, BS_REFS_HEAD, reference);
        self.append_to_scope(scope_base, BS_LEFT_HEAD, reference);
    }

    /// Records a read of a name used as a value, in the current scope.
    pub fn reference_read(&mut self, identifier: u32, name: &[u16]) {
        let name_id = self.strings.intern(name);

        self.add_reference(
            self.current as u32,
            identifier,
            name_id,
            RF_READ | RF_VALUE,
            0,
            0,
            0,
        );
    }

    /// Records an occurrence of a name used as a value, in the current scope.
    #[allow(clippy::too_many_arguments)]
    pub fn reference_value(
        &mut self,
        identifier: u32,
        name: &[u16],
        flag: u32,
        write_expr: u32,
        ig_node: u32,
        partial: bool,
        init: bool,
    ) {
        let name_id = self.strings.intern(name);

        self.add_reference(
            self.current as u32,
            identifier,
            name_id,
            flag | RF_VALUE
                | (if partial { RF_PARTIAL } else { 0 })
                | (if init { RF_INIT } else { 0 }),
            write_expr,
            if ig_node == 0 { 0 } else { identifier },
            ig_node,
        );
    }

    /// Records an occurrence of a name used as a type, in the current scope.
    pub fn reference_type(&mut self, identifier: u32, name: &[u16]) {
        let name_id = self.strings.intern(name);

        self.add_reference(
            self.current as u32,
            identifier,
            name_id,
            RF_READ | RF_TYPE,
            0,
            0,
            0,
        );
    }

    /// Records an occurrence that could name either a value or a type.
    pub fn reference_dual_value_type(&mut self, identifier: u32, name: &[u16]) {
        let name_id = self.strings.intern(name);

        self.add_reference(
            self.current as u32,
            identifier,
            name_id,
            RF_READ | RF_VALUE | RF_TYPE,
            0,
            0,
            0,
        );
    }

    /// References a name in whichever enclosing scope declares it. Returns
    /// `true` when some scope declared the name.
    pub fn reference_if_declared(&mut self, name: &[u16]) -> bool {
        let Some(name_id) = self.strings.get(name) else {
            return false;
        };

        let mut scope = self.current;

        while scope != -1 {
            let symbol = self.bindings[scope as usize]
                .as_ref()
                .and_then(|map| map.get(&name_id))
                .copied();

            if let Some(symbol) = symbol {
                let identifier = self.first_identifiers[symbol as usize];

                if identifier != 0 {
                    self.add_reference(
                        scope as u32,
                        identifier,
                        name_id,
                        RF_READ | RF_VALUE,
                        0,
                        0,
                        0,
                    );
                }

                return true;
            }

            scope = self.upper_of(scope);
        }

        false
    }

    //-------------------------------------------------------------------------
    // Closing
    //-------------------------------------------------------------------------

    /// Resolves everything queued on the current scope and makes its parent
    /// current.
    pub fn close_current(&mut self) {
        let scope = self.current;
        let base = scope as usize * BS_WORDS;
        let code = self.scopes.words[base + BS_TYPE];
        let flags = self.scopes.words[base + BS_FLAGS];

        if code == CODE_GLOBAL {
            self.close_global(scope as u32);
            self.resolve_left(scope as u32, true);
        } else if code == CODE_WITH && (flags & SF_DYNAMIC) != 0 {
            // A `with` body whose object is not statically known cannot
            // resolve anything.
            let mut cell = self.scopes.words[base + BS_LEFT_HEAD];

            while cell != 0 {
                let reference = self.cells.words[cell as usize];

                self.refs.words[reference as usize * REFERENCE_WORDS + R_FLAGS] |= RF_TAINTED;
                self.delegate(scope as u32, reference);
                cell = self.cells.words[cell as usize + 1];
            }
        } else {
            self.resolve_left(scope as u32, (flags & SF_DYNAMIC) == 0);
        }

        self.scopes.words[base + BS_LEFT_HEAD] = 0;
        self.scopes.words[base + BS_LEFT_HEAD + 1] = 0;
        self.current = self.scopes.words[base + BS_UPPER] as i32 - 1;
    }

    /// Resolves every queued reference, or files them all as passing through
    /// when the scope is dynamic.
    fn resolve_left(&mut self, scope: u32, is_static: bool) {
        let mut cell = self.scopes.words[scope as usize * BS_WORDS + BS_LEFT_HEAD];

        while cell != 0 {
            let reference = self.cells.words[cell as usize];

            if is_static {
                if !self.resolve(scope, reference) {
                    self.delegate(scope, reference);
                }
            } else {
                // Every enclosing scope has to see a name it might not own.
                let mut current = scope as i32;

                while current != -1 {
                    self.append_to_scope(
                        current as usize * BS_WORDS,
                        BS_THROUGH_HEAD,
                        reference,
                    );
                    current =
                        self.scopes.words[current as usize * BS_WORDS + BS_UPPER] as i32 - 1;
                }
            }

            cell = self.cells.words[cell as usize + 1];
        }
    }

    /// Links a reference to the symbol it names, if this scope binds it.
    fn resolve(&mut self, scope: u32, reference: u32) -> bool {
        let Some(map) = self.bindings[scope as usize].as_ref() else {
            return false;
        };

        let ref_base = reference as usize * REFERENCE_WORDS;
        let name_id = self.refs.words[ref_base + R_NAME];
        let Some(&symbol) = map.get(&name_id) else {
            return false;
        };

        if !self.is_valid_resolution(scope, reference, symbol) {
            return false;
        }

        // A name can be bound as a type, as a value, or as both, and a
        // reference names one or the other.
        let ref_flags = self.refs.words[ref_base + R_FLAGS];
        let symbol_base = symbol as usize * BV_WORDS;
        let mut symbol_flags = self.symbols.words[symbol_base + BV_FLAGS];
        let binding_bits = if self.symbols.words[symbol_base + BV_DEFS_HEAD] == 0 {
            BVF_TYPE_BINDING | BVF_VALUE_BINDING
        } else {
            symbol_flags
        };

        if !((ref_flags & RF_TYPE) != 0 && (binding_bits & BVF_TYPE_BINDING) != 0)
            && !((ref_flags & RF_VALUE) != 0 && (binding_bits & BVF_VALUE_BINDING) != 0)
        {
            return false;
        }

        self.append_to_symbol(symbol_base, BV_REFS_HEAD, reference);

        let from_scope = self.refs.words[ref_base + R_FROM] as usize;

        if self.scopes.words[from_scope * BS_WORDS + BS_VARIABLE_SCOPE]
            != self.scopes.words[scope as usize * BS_WORDS + BS_VARIABLE_SCOPE]
        {
            symbol_flags &= !VF_STACK;
        }

        if (ref_flags & RF_TAINTED) != 0 {
            symbol_flags |= VF_TAINTED;
        }

        self.symbols.words[symbol_base + BV_FLAGS] = symbol_flags;
        self.refs.words[ref_base + R_RESOLVED] = symbol + 1;

        true
    }

    /// Rejects the resolutions that are lexically impossible: a default
    /// parameter value cannot see the body.
    fn is_valid_resolution(&self, scope: u32, reference: u32, symbol: u32) -> bool {
        let base = scope as usize * BS_WORDS;

        if self.scopes.words[base + BS_TYPE] != CODE_FUNCTION {
            return true;
        }

        // With `globalReturn`, the function scope's block is the program.
        if (self.scopes.words[base + BS_FLAGS] & BSF_PROGRAM_BLOCK) != 0 {
            return true;
        }

        let ast = &self.ast;
        let body = ast.child(self.blocks[scope as usize], 2);
        let body_start: i64 = if body == 0 { -1 } else { ast.start(body) as i64 };

        if self.symbols.words[symbol as usize * BV_WORDS + BV_SCOPE] != scope
            || self.ref_starts[reference as usize] as i64 >= body_start
        {
            return true;
        }

        // Valid only if some declaration sits before the body: a parameter.
        let mut cell = self.symbols.words[symbol as usize * BV_WORDS + BV_DEFS_HEAD];

        while cell != 0 {
            let definition = self.cells.words[cell as usize];

            if (self.def_starts[definition as usize] as i64) < body_start {
                return true;
            }

            cell = self.cells.words[cell as usize + 1];
        }

        false
    }

    /// Passes a reference this scope could not resolve to the enclosing one.
    fn delegate(&mut self, scope: u32, reference: u32) {
        let base = scope as usize * BS_WORDS;
        let upper = self.scopes.words[base + BS_UPPER] as i32 - 1;

        if upper != -1 {
            self.append_to_scope(upper as usize * BS_WORDS, BS_LEFT_HEAD, reference);
        }

        self.append_to_scope(base, BS_THROUGH_HEAD, reference);
    }

    /// Turns the assignments to undeclared names into implicit global
    /// variables.
    fn close_global(&mut self, scope: u32) {
        let mut cell = self.scopes.words[scope as usize * BS_WORDS + BS_LEFT_HEAD];

        while cell != 0 {
            let reference = self.cells.words[cell as usize];
            let ref_base = reference as usize * REFERENCE_WORDS;
            let pattern = self.refs.words[ref_base + R_IG_PATTERN];

            if pattern == 0 {
                cell = self.cells.words[cell as usize + 1];
                continue;
            }

            let name_id = self.refs.words[ref_base + R_NAME];

            if self.bindings[scope as usize]
                .as_ref()
                .is_some_and(|map| map.contains_key(&name_id))
            {
                cell = self.cells.words[cell as usize + 1];
                continue;
            }

            let symbol = match self.implicit_by_name.get(&name_id) {
                Some(&symbol) => symbol,
                None => {
                    let symbol = self.new_symbol(scope, name_id, VF_STACK | VF_IMPLICIT_GLOBAL);

                    self.implicit_by_name.insert(name_id, symbol);

                    let implicit_cell = self.cells.reserve(2);

                    self.cells.words[implicit_cell] = symbol;
                    self.cells.words[implicit_cell + 1] = 0;

                    if self.implicit_tail == 0 {
                        self.implicit_head = implicit_cell as u32;
                    } else {
                        self.cells.words[self.implicit_tail as usize + 1] =
                            implicit_cell as u32;
                    }

                    self.implicit_tail = implicit_cell as u32;

                    symbol
                }
            };

            // Every undeclared assignment adds its own occurrence.
            self.append_to_symbol(symbol as usize * BV_WORDS, BV_IDENTS_HEAD, pattern);

            let definition = self.def_count;

            self.def_count += 1;

            let def_base = self.defs.reserve(DEFINITION_WORDS);
            let ig_node = self.refs.words[ref_base + R_IG_NODE];

            self.defs.words[def_base + D_TYPE] = DEF_CODE_IMPLICIT;
            self.defs.words[def_base + D_NAME] = pattern;
            self.defs.words[def_base + D_NODE] = ig_node;
            self.defs.words[def_base + D_PARENT] = 0;
            self.defs.words[def_base + D_INDEX] = 0;
            self.defs.words[def_base + D_KIND] = 0;
            self.defs.words[def_base + D_FLAGS] = DF_VARIABLE_DEFINITION;
            self.def_starts.push(0);

            self.append_to_symbol(symbol as usize * BV_WORDS, BV_DEFS_HEAD, definition);
            self.symbols.words[symbol as usize * BV_WORDS + BV_FLAGS] |= BVF_VALUE_BINDING;
            self.declare_on_handle(ig_node, symbol);

            cell = self.cells.words[cell as usize + 1];
        }
    }

    /// Files a symbol under a declaring node already held as a handle.
    fn declare_on_handle(&mut self, handle: u32, symbol: u32) {
        if let Some(&index) = self.declared_index.get(&handle) {
            let head = self.declared[index].1;
            let mut cell = head;

            while cell != 0 {
                if self.cells.words[cell as usize] == symbol {
                    return;
                }

                cell = self.cells.words[cell as usize + 1];
            }

            let cell = self.cells.reserve(2);

            self.cells.words[cell] = symbol;
            self.cells.words[cell + 1] = 0;

            let tail = self.declared[index].2;

            self.cells.words[tail as usize + 1] = cell as u32;
            self.declared[index].2 = cell as u32;

            return;
        }

        let cell = self.cells.reserve(2);

        self.cells.words[cell] = symbol;
        self.cells.words[cell + 1] = 0;
        self.declared_index.insert(handle, self.declared.len());
        self.declared.push((handle, cell as u32, cell as u32));
    }

    //-------------------------------------------------------------------------
    // Globals
    //-------------------------------------------------------------------------

    /// Declares names in the global scope and resolves whatever was waiting
    /// for them.
    pub fn add_globals(&mut self, names: &[Vec<u16>]) {
        if self.scope_count == 0 {
            return;
        }

        let mut added: std::collections::HashSet<u32> = std::collections::HashSet::new();

        for name in names {
            let name_id = self.strings.intern(name);

            self.bind_symbol(0, 0, name_id);
            self.implicit_by_name.remove(&name_id);
            added.insert(name_id);
        }

        // Resolve the waiting references; keep the rest passing through.
        let old_head = self.scopes.words[BS_THROUGH_HEAD];
        let mut new_head = 0u32;
        let mut new_tail = 0u32;
        let mut cell = old_head;

        while cell != 0 {
            let next = self.cells.words[cell as usize + 1];
            let reference = self.cells.words[cell as usize];
            let name_id = self.refs.words[reference as usize * REFERENCE_WORDS + R_NAME];

            if added.contains(&name_id) {
                let symbol = *self.bindings[0]
                    .as_ref()
                    .unwrap()
                    .get(&name_id)
                    .unwrap();

                self.refs.words[reference as usize * REFERENCE_WORDS + R_RESOLVED] = symbol + 1;
                self.append_to_symbol(symbol as usize * BV_WORDS, BV_REFS_HEAD, reference);
            } else {
                self.cells.words[cell as usize + 1] = 0;

                if new_tail == 0 {
                    new_head = cell;
                } else {
                    self.cells.words[new_tail as usize + 1] = cell;
                }

                new_tail = cell;
            }

            cell = next;
        }

        self.scopes.words[BS_THROUGH_HEAD] = new_head;
        self.scopes.words[BS_THROUGH_HEAD + 1] = new_tail;

        // Drop the implicit variables the supplied globals cover.
        let mut implicit_head = 0u32;
        let mut implicit_tail = 0u32;
        let mut cell = self.implicit_head;

        while cell != 0 {
            let next = self.cells.words[cell as usize + 1];
            let symbol = self.cells.words[cell as usize];
            let name_id = self.symbols.words[symbol as usize * BV_WORDS + BV_NAME];

            if !added.contains(&name_id) {
                self.cells.words[cell as usize + 1] = 0;

                if implicit_tail == 0 {
                    implicit_head = cell;
                } else {
                    self.cells.words[implicit_tail as usize + 1] = cell;
                }

                implicit_tail = cell;
            }

            cell = next;
        }

        self.implicit_head = implicit_head;
        self.implicit_tail = implicit_tail;
    }

    //-------------------------------------------------------------------------
    // Emission
    //-------------------------------------------------------------------------

    /// Compacts the finished graph into the scope buffer format.
    pub fn finish(&mut self) -> Vec<u8> {
        // Final symbol IDs: scope by scope in binding order, with the
        // implicit globals at the end.
        let mut symbol_remap = vec![0u32; self.symbol_count as usize];
        let mut final_symbols: Vec<u32> = Vec::new();

        for scope in 0..self.scope_count as usize {
            let mut cell = self.scopes.words[scope * BS_WORDS + BS_VARS_HEAD];

            while cell != 0 {
                let symbol = self.cells.words[cell as usize];

                symbol_remap[symbol as usize] = final_symbols.len() as u32 + 1;
                final_symbols.push(symbol);
                cell = self.cells.words[cell as usize + 1];
            }
        }

        let mut cell = self.implicit_head;

        while cell != 0 {
            let symbol = self.cells.words[cell as usize];

            symbol_remap[symbol as usize] = final_symbols.len() as u32 + 1;
            final_symbols.push(symbol);
            cell = self.cells.words[cell as usize + 1];
        }

        // Definitions follow their symbols.
        let mut definition_remap = vec![0u32; self.def_count as usize];
        let mut final_definitions: Vec<u32> = Vec::new();

        for &symbol in &final_symbols {
            let mut cell = self.symbols.words[symbol as usize * BV_WORDS + BV_DEFS_HEAD];

            while cell != 0 {
                let definition = self.cells.words[cell as usize];

                definition_remap[definition as usize] = final_definitions.len() as u32;
                final_definitions.push(definition);
                cell = self.cells.words[cell as usize + 1];
            }
        }

        // Pool lists and record sections.
        let mut pool = WordBuffer::new(1024);

        pool.push(0);

        let cells = &self.cells;
        let count_chain = |head: u32| -> u32 {
            let mut count = 0;
            let mut cell = head;

            while cell != 0 {
                count += 1;
                cell = cells.words[cell as usize + 1];
            }

            count
        };

        macro_rules! list_from_cells {
            ($head:expr, $map:expr) => {{
                let head: u32 = $head;

                if head == 0 {
                    0u32
                } else {
                    let count = count_chain(head);
                    let handle = pool.length as u32;
                    let base = pool.reserve(count as usize + 1);

                    pool.words[base] = count;

                    let mut at = base + 1;
                    let mut cell = head;

                    while cell != 0 {
                        let value: u32 = cells.words[cell as usize];

                        pool.words[at] = $map(value);
                        at += 1;
                        cell = cells.words[cell as usize + 1];
                    }

                    handle
                }
            }};
        }

        let identity = |value: u32| value;
        let remap_symbol = |value: u32| symbol_remap[value as usize] - 1;
        let remap_definition = |value: u32| definition_remap[value as usize];

        let mut out_scopes = vec![0u32; self.scope_count as usize * SCOPE_WORDS];

        for scope in 0..self.scope_count as usize {
            let from = scope * BS_WORDS;
            let to = scope * SCOPE_WORDS;
            let scope_words = &self.scopes.words;

            out_scopes[to + S_TYPE] = scope_words[from + BS_TYPE];
            out_scopes[to + S_FLAGS] = scope_words[from + BS_FLAGS] & !BSF_PROGRAM_BLOCK;
            out_scopes[to + S_BLOCK] = scope_words[from + BS_BLOCK];
            out_scopes[to + S_UPPER] = scope_words[from + BS_UPPER];
            out_scopes[to + S_VARIABLE_SCOPE] = scope_words[from + BS_VARIABLE_SCOPE];

            let vars_head = scope_words[from + BS_VARS_HEAD];
            let refs_head = scope_words[from + BS_REFS_HEAD];
            let through_head = scope_words[from + BS_THROUGH_HEAD];
            let is_global = scope == 0 && scope_words[from + BS_TYPE] == CODE_GLOBAL;

            out_scopes[to + S_VARIABLES] = list_from_cells!(vars_head, remap_symbol);
            out_scopes[to + S_REFERENCES] = list_from_cells!(refs_head, identity);
            out_scopes[to + S_THROUGH] = list_from_cells!(through_head, identity);
            out_scopes[to + S_IMPLICIT] = if is_global {
                list_from_cells!(self.implicit_head, remap_symbol)
            } else {
                0
            };
        }

        let mut out_symbols = vec![0u32; final_symbols.len() * SYMBOL_WORDS];

        for (i, &symbol) in final_symbols.iter().enumerate() {
            let from = symbol as usize * BV_WORDS;
            let to = i * SYMBOL_WORDS;
            let symbol_words = &self.symbols.words;

            out_symbols[to + V_NAME] = symbol_words[from + BV_NAME];
            out_symbols[to + V_SCOPE] = symbol_words[from + BV_SCOPE];
            out_symbols[to + V_FLAGS] = symbol_words[from + BV_FLAGS] & BVF_SERIALIZED;
            out_symbols[to + V_IDENTIFIERS] =
                list_from_cells!(symbol_words[from + BV_IDENTS_HEAD], identity);
            out_symbols[to + V_DEFINITIONS] =
                list_from_cells!(symbol_words[from + BV_DEFS_HEAD], remap_definition);

            let refs_handle = list_from_cells!(symbol_words[from + BV_REFS_HEAD], identity);

            out_symbols[to + V_REFERENCES] = refs_handle;

            // Summarize the read and write counts off the just-laid list.
            if refs_handle != 0 {
                let end = refs_handle as usize + pool.words[refs_handle as usize] as usize;
                let mut reads = 0u32;
                let mut writes = 0u32;

                for at in refs_handle as usize + 1..=end {
                    let ref_flags = self.refs.words
                        [pool.words[at] as usize * REFERENCE_WORDS + R_FLAGS];

                    reads += ref_flags & RF_READ;
                    writes += (ref_flags & RF_WRITE) >> 1;
                }

                out_symbols[to + V_READ_COUNT] = reads;
                out_symbols[to + V_WRITE_COUNT] = writes;
            }
        }

        // References are already final: copy, then remap what they resolved
        // to.
        let mut out_refs =
            self.refs.words[..self.ref_count as usize * REFERENCE_WORDS].to_vec();

        for i in 0..self.ref_count as usize {
            let resolved = out_refs[i * REFERENCE_WORDS + R_RESOLVED];

            if resolved != 0 {
                out_refs[i * REFERENCE_WORDS + R_RESOLVED] =
                    symbol_remap[resolved as usize - 1];
            }
        }

        let mut out_defs = vec![0u32; final_definitions.len() * DEFINITION_WORDS];

        for (i, &definition) in final_definitions.iter().enumerate() {
            let from = definition as usize * DEFINITION_WORDS;
            let to = i * DEFINITION_WORDS;

            out_defs[to..to + DEFINITION_WORDS]
                .copy_from_slice(&self.defs.words[from..from + DEFINITION_WORDS]);
        }

        // Indexes.
        let mut node_scope_pairs: Vec<(u32, u32)> = Vec::new();

        for scope in 0..self.scope_count as usize {
            node_scope_pairs.push((self.scopes.words[scope * BS_WORDS + BS_BLOCK], scope as u32));
        }

        let mut declared_pairs: Vec<(u32, u32)> = Vec::new();

        for &(handle, head, _tail) in &self.declared {
            // A list can be entirely dead symbols — an implicit global that a
            // supplied global replaced. It gets no pair.
            let mut count = 0u32;
            let mut cell = head;

            while cell != 0 {
                if symbol_remap[cells.words[cell as usize] as usize] != 0 {
                    count += 1;
                }

                cell = cells.words[cell as usize + 1];
            }

            if count == 0 {
                continue;
            }

            let list_handle = pool.length as u32;
            let base = pool.reserve(count as usize + 1);

            pool.words[base] = count;

            let mut at = base + 1;
            let mut cell = head;

            while cell != 0 {
                let remapped = symbol_remap[cells.words[cell as usize] as usize];

                if remapped != 0 {
                    pool.words[at] = remapped - 1;
                    at += 1;
                }

                cell = cells.words[cell as usize + 1];
            }

            declared_pairs.push((handle, list_handle));
        }

        let mut ident_ref_pairs: Vec<(u32, u32)> = Vec::new();

        for i in 0..self.ref_count as usize {
            ident_ref_pairs.push((out_refs[i * REFERENCE_WORDS + R_IDENTIFIER], i as u32));
        }

        let node_scope_words = sorted_pair_words(node_scope_pairs);
        let declared_words = sorted_pair_words(declared_pairs);
        let ident_ref_words = sorted_pair_words(ident_ref_pairs);

        // Strings.
        let jsx_pragma_id = match &self.options.jsx_pragma {
            None => 0,
            Some(name) => self.strings.intern(name) + 1,
        };
        let jsx_fragment_id = match &self.options.jsx_fragment_name {
            None => 0,
            Some(name) => self.strings.intern(name) + 1,
        };

        let encoded: Vec<Vec<u8>> = self
            .strings
            .strings
            .iter()
            .map(|units| String::from_utf16_lossy(units).into_bytes())
            .collect();
        let mut string_offsets = vec![0u32; encoded.len() + 1];
        let mut byte_length = 0u32;

        for (i, chunk) in encoded.iter().enumerate() {
            string_offsets[i] = byte_length;
            byte_length += chunk.len() as u32;
        }

        string_offsets[encoded.len()] = byte_length;

        // Layout.
        let scopes_base = SCOPE_HEADER_WORDS;
        let symbols_base = scopes_base + out_scopes.len();
        let references_base = symbols_base + out_symbols.len();
        let definitions_base = references_base + out_refs.len();
        let pool_base = definitions_base + out_defs.len();
        let node_scope_base = pool_base + pool.length;
        let declared_base = node_scope_base + node_scope_words.len();
        let ident_ref_base = declared_base + declared_words.len();
        let strings_base = ident_ref_base + ident_ref_words.len();
        let string_data_base = strings_base + string_offsets.len();
        let total_words = string_data_base + byte_length.div_ceil(4) as usize;

        let mut out = vec![0u32; total_words];

        out[SCOPE_H_MAGIC] = SCOPE_BUFFER_MAGIC;
        out[SCOPE_H_VERSION] = SCOPE_BUFFER_VERSION;
        out[SCOPE_H_FLAGS] = 0;
        out[SCOPE_H_SCOPE_COUNT] = self.scope_count;
        out[SCOPE_H_SYMBOL_COUNT] = final_symbols.len() as u32;
        out[SCOPE_H_REFERENCE_COUNT] = self.ref_count;
        out[SCOPE_H_DEFINITION_COUNT] = final_definitions.len() as u32;
        out[SCOPE_H_SCOPES_BASE] = scopes_base as u32;
        out[SCOPE_H_SYMBOLS_BASE] = symbols_base as u32;
        out[SCOPE_H_REFERENCES_BASE] = references_base as u32;
        out[SCOPE_H_DEFINITIONS_BASE] = definitions_base as u32;
        out[SCOPE_H_POOL_BASE] = pool_base as u32;
        out[SCOPE_H_NODE_SCOPE_BASE] = node_scope_base as u32;
        out[SCOPE_H_NODE_SCOPE_COUNT] = (node_scope_words.len() / 2) as u32;
        out[SCOPE_H_DECLARED_BASE] = declared_base as u32;
        out[SCOPE_H_DECLARED_COUNT] = (declared_words.len() / 2) as u32;
        out[SCOPE_H_IDENT_REF_BASE] = ident_ref_base as u32;
        out[SCOPE_H_IDENT_REF_COUNT] = (ident_ref_words.len() / 2) as u32;
        out[SCOPE_H_STRINGS_BASE] = strings_base as u32;
        out[SCOPE_H_STRING_COUNT] = self.strings.strings.len() as u32;
        out[SCOPE_H_STRING_BYTES] = byte_length;
        out[SCOPE_H_OPTIONS] = self.options.encoded();
        out[SCOPE_H_JSX_PRAGMA] = jsx_pragma_id;
        out[SCOPE_H_JSX_FRAGMENT] = jsx_fragment_id;

        out[scopes_base..scopes_base + out_scopes.len()].copy_from_slice(&out_scopes);
        out[symbols_base..symbols_base + out_symbols.len()].copy_from_slice(&out_symbols);
        out[references_base..references_base + out_refs.len()].copy_from_slice(&out_refs);
        out[definitions_base..definitions_base + out_defs.len()].copy_from_slice(&out_defs);
        out[pool_base..pool_base + pool.length].copy_from_slice(&pool.words[..pool.length]);
        out[node_scope_base..node_scope_base + node_scope_words.len()]
            .copy_from_slice(&node_scope_words);
        out[declared_base..declared_base + declared_words.len()]
            .copy_from_slice(&declared_words);
        out[ident_ref_base..ident_ref_base + ident_ref_words.len()]
            .copy_from_slice(&ident_ref_words);
        out[strings_base..strings_base + string_offsets.len()]
            .copy_from_slice(&string_offsets);

        // Serialize to little-endian bytes, then splice the UTF-8 string data
        // into its word-aligned tail.
        let mut buffer = Vec::with_capacity(total_words * 4);

        for word in &out {
            buffer.extend_from_slice(&word.to_le_bytes());
        }

        let mut written = string_data_base * 4;

        for chunk in &encoded {
            buffer[written..written + chunk.len()].copy_from_slice(chunk);
            written += chunk.len();
        }

        buffer
    }
}
