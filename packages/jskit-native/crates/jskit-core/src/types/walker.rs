//! The walk that reads types out of a parsed program.
//!
//! Port of `packages/jskit/src/types/types-walker.ts`, method for method.
//! Creation order is source order and internments are by exact key, so the
//! buffer this produces is byte-identical to the TypeScript walk's.

use std::collections::HashMap;

use crate::parse::node_kinds::*;
use crate::parse::slots::{SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE};
use crate::parse::token_kinds::{
    T_ASSIGN, T_ASSIGN_AMPAMP, T_ASSIGN_PLUS, T_ASSIGN_QQ, T_DELETE, T_EQ_EQ, T_GT_EQ, T_IN,
    T_INSTANCEOF, T_MINUS, T_NOT, T_PLUS, T_TILDE, T_TYPEOF, T_VOID,
};
use crate::scope::binary_ast::BinaryAst;
use crate::scope::buffer::{
    DEF_CODE_CLASS, DEF_CODE_ENUM, DEF_CODE_FUNCTION, DEF_CODE_IMPORT, DEF_CODE_VARIABLE,
    DEFINITION_WORDS, D_NAME, D_NODE, D_PARENT, D_TYPE, REFERENCE_WORDS, RF_TYPE,
    RF_VALUE, R_FLAGS, R_RESOLVED, SCOPE_H_DEFINITIONS_BASE, SCOPE_H_IDENT_REF_BASE,
    SCOPE_H_IDENT_REF_COUNT, SCOPE_H_POOL_BASE, SCOPE_H_REFERENCES_BASE, SCOPE_H_STRINGS_BASE,
    SCOPE_H_STRING_COUNT, SCOPE_H_SYMBOLS_BASE, SCOPE_H_SYMBOL_COUNT, SYMBOL_WORDS,
    V_DEFINITIONS, V_IDENTIFIERS, V_NAME,
};

use super::buffer::*;
use super::builder::TypesBuilder;
use super::well_known::is_well_known_lib_type;

/// How deep a member lookup follows references and heritage before giving up.
const MEMBER_LOOKUP_DEPTH: u32 = 8;

const MKIND_MASK: u32 = 7 << MKIND_SHIFT;
const DECL_MASK: u32 = 7 << DECL_SHIFT;

/// A member entry collected before its run is written contiguously.
struct MemberEntry {
    name: u32,
    type_id: u32,
    flags: u32,
}

/// Reads types out of the parse and scope buffers and records them into a
/// `TypesBuilder`.
pub struct TypesWalker<'a, 'b> {
    ast: &'b BinaryAst<'a>,
    scope_words: &'b [u32],
    builder: &'b mut TypesBuilder,

    /// Identifier node handle to the scope symbol it declares.
    symbol_of_ident: HashMap<u32, u32>,

    /// Our symbol ID for a scope symbol, `-1` until created.
    type_symbol_of: Vec<i64>,

    /// Node index to the type already computed for it.
    node_type_memo: HashMap<u32, u32>,
}

impl<'a, 'b> TypesWalker<'a, 'b> {
    /// Creates a walker over one program.
    pub fn new(
        ast: &'b BinaryAst<'a>,
        scope_words: &'b [u32],
        builder: &'b mut TypesBuilder,
    ) -> Self {
        let symbol_count = scope_words[SCOPE_H_SYMBOL_COUNT] as usize;
        let mut symbol_of_ident = HashMap::new();

        // Every declared name, keyed by the identifier that declares it.
        for symbol in 0..symbol_count as u32 {
            let pool = scope_symbol_field(scope_words, symbol, V_IDENTIFIERS);
            let count = scope_list_count(scope_words, pool);

            for i in 0..count {
                let ident = scope_list_item(scope_words, pool, i);

                symbol_of_ident.entry(ident).or_insert(symbol);
            }
        }

        TypesWalker {
            ast,
            scope_words,
            builder,
            symbol_of_ident,
            type_symbol_of: vec![-1; symbol_count],
            node_type_memo: HashMap::new(),
        }
    }

    /// Runs both passes over the whole program.
    pub fn build(&mut self) {
        self.declare(self.ast.root);
        self.express(self.ast.root);
    }

    //-------------------------------------------------------------------------
    // Shared plumbing
    //-------------------------------------------------------------------------

    #[inline]
    fn handle(&self, node: u32) -> u32 {
        self.ast.handle_of(node)
    }

    fn record(&mut self, node: u32, type_id: u32) {
        if type_id != TYPE_NONE {
            let handle = self.handle(node);

            self.builder.add_node_type(handle, type_id);
        }
    }

    /// The source text of a node, as UTF-16 code units.
    fn text(&self, node: u32) -> &'a [u16] {
        &self.ast.source[self.ast.start(node) as usize..self.ast.end(node) as usize]
    }

    /// The scope symbol an identifier declares, or `-1`.
    fn declared_symbol(&self, ident: u32) -> i64 {
        match self.symbol_of_ident.get(&self.handle(ident)) {
            Some(&symbol) => i64::from(symbol),
            None => -1,
        }
    }

    /// Whether a symbol also has a value declaration — a function, class,
    /// enum, or variable a namespace of the same name merges with.
    fn merges_with_value(&self, symbol: u32) -> bool {
        let defs_pool = scope_symbol_field(self.scope_words, symbol, V_DEFINITIONS);
        let count = scope_list_count(self.scope_words, defs_pool);

        for i in 0..count {
            let def = scope_list_item(self.scope_words, defs_pool, i);
            let code = scope_definition_field(self.scope_words, def, D_TYPE);

            if code == DEF_CODE_CLASS
                || code == DEF_CODE_FUNCTION
                || code == DEF_CODE_ENUM
                || code == DEF_CODE_VARIABLE
            {
                return true;
            }
        }

        false
    }

    /// The reference IDs recorded at an identifier's handle.
    fn references_at(&self, handle: u32) -> Vec<u32> {
        let base = self.scope_words[SCOPE_H_IDENT_REF_BASE] as usize;
        let count = self.scope_words[SCOPE_H_IDENT_REF_COUNT] as usize;
        let mut low = 0usize;
        let mut high = count;

        while low < high {
            let mid = (low + high) / 2;

            if self.scope_words[base + mid * 2] < handle {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        let mut refs = Vec::new();

        while low < count && self.scope_words[base + low * 2] == handle {
            refs.push(self.scope_words[base + low * 2 + 1]);
            low += 1;
        }

        refs
    }

    #[inline]
    fn reference_field(&self, reference: u32, field: usize) -> u32 {
        let base = self.scope_words[SCOPE_H_REFERENCES_BASE] as usize;

        self.scope_words[base + reference as usize * REFERENCE_WORDS + field]
    }

    /// The scope symbol an identifier reference resolves to, or `-1`.
    fn resolved_symbol(&self, ident: u32, namespace_flag: u32) -> i64 {
        let refs = self.references_at(self.handle(ident));
        let mut fallback: i64 = -1;

        for &reference in &refs {
            let resolved = self.reference_field(reference, R_RESOLVED);

            if resolved == 0 {
                continue;
            }

            let flags = self.reference_field(reference, R_FLAGS);

            if (flags & namespace_flag) != 0 {
                return i64::from(resolved) - 1;
            }

            if fallback == -1 {
                fallback = i64::from(resolved) - 1;
            }
        }

        fallback
    }

    /// Whether an identifier reference resolves to nothing — a global.
    fn is_unresolved(&self, ident: u32) -> bool {
        let refs = self.references_at(self.handle(ident));

        if refs.is_empty() {
            return false;
        }

        for &reference in &refs {
            if self.reference_field(reference, R_RESOLVED) != 0 {
                return false;
            }
        }

        true
    }

    /// Our symbol for a name the standard library declares.
    fn lib_symbol(&mut self, name: &str) -> u32 {
        let name_id = self.builder.intern_ascii(name);

        self.builder.intern_symbol(name_id, TYO_LIB, 0, 0, 0)
    }

    /// Our symbol for a scope symbol, created on first use.
    fn symbol_for(&mut self, symbol: u32) -> u32 {
        let cached = self.type_symbol_of[symbol as usize];

        if cached != -1 {
            return cached as u32;
        }

        let name_units = scope_string(
            self.scope_words,
            scope_symbol_field(self.scope_words, symbol, V_NAME),
        );
        let mut name = self.builder.intern(&name_units);
        let mut origin = TYO_LOCAL;
        let mut specifier = 0u32;
        let mut decl = 0u32;
        let defs_pool = scope_symbol_field(self.scope_words, symbol, V_DEFINITIONS);

        if scope_list_count(self.scope_words, defs_pool) > 0 {
            let def = scope_list_item(self.scope_words, defs_pool, 0);

            decl = scope_definition_field(self.scope_words, def, D_NAME);

            if scope_definition_field(self.scope_words, def, D_TYPE) == DEF_CODE_IMPORT {
                if let Some(from) =
                    self.import_source(scope_definition_field(self.scope_words, def, D_PARENT))
                {
                    origin = if from.first() == Some(&(b'.' as u16))
                        || from.first() == Some(&(b'/' as u16))
                    {
                        TYO_FILE
                    } else {
                        TYO_PACKAGE
                    };
                    specifier = self.builder.intern(&from) + 1;
                }

                name =
                    self.imported_name(scope_definition_field(self.scope_words, def, D_NODE), name);
                decl = scope_definition_field(self.scope_words, def, D_NODE);
            }
        }

        let id = self
            .builder
            .intern_symbol(name, origin, specifier, decl, symbol + 1);

        self.type_symbol_of[symbol as usize] = i64::from(id);

        id
    }

    /// The module specifier of an import declaration.
    fn import_source(&self, handle: u32) -> Option<Vec<u16>> {
        if handle == 0 {
            return None;
        }

        let node = self.node_at(handle);

        if self.ast.kind(node) != N_IMPORT_DECLARATION {
            return None;
        }

        Some(self.ast.literal_string(self.ast.field(node, NODE_B)))
    }

    /// The name an import binding was exported under.
    fn imported_name(&mut self, handle: u32, fallback: u32) -> u32 {
        if handle == 0 {
            return fallback;
        }

        let node = self.node_at(handle);
        let kind = self.ast.kind(node);

        if kind == N_IMPORT_SPECIFIER {
            let imported = self.ast.field(node, NODE_A);
            let units = if self.ast.kind(imported) == N_LITERAL {
                self.ast.literal_string(imported)
            } else {
                self.ast.name(imported)
            };

            return self.builder.intern(&units);
        }

        if kind == N_IMPORT_DEFAULT_SPECIFIER {
            return self.builder.intern_ascii("default");
        }

        fallback
    }

    /// The node a handle names.
    #[inline]
    fn node_at(&self, handle: u32) -> u32 {
        (handle as usize / 4 - self.ast.nodes_base) as u32 / self.ast.node_words as u32
    }

    //-------------------------------------------------------------------------
    // Type construction helpers
    //-------------------------------------------------------------------------

    /// A record for a construct this analysis does not model.
    fn deferred(&mut self, node: u32) -> u32 {
        let handle = self.handle(node);

        self.builder
            .add_type(TYF_UNKNOWN, TYS_DEFERRED, 0, 0, 0, 0, 0, handle)
    }

    /// An `Array<element>` reference.
    fn array_type(&mut self, element: u32, node: u32) -> u32 {
        let symbol = self.lib_symbol("Array");
        let pool = self.builder.pool_list(&[element]);
        let handle = self.handle(node);

        self.builder.add_type(
            TYF_OBJECT,
            TYS_REFERENCE | TYS_ARRAY,
            symbol + 1,
            pool,
            0,
            0,
            0,
            handle,
        )
    }

    /// A `Promise<value>` reference.
    fn promise_type(&mut self, value: u32, node: u32) -> u32 {
        let symbol = self.lib_symbol("Promise");
        let pool = self.builder.pool_list(&[value]);
        let handle = self.handle(node);

        self.builder
            .add_type(TYF_OBJECT, TYS_REFERENCE, symbol + 1, pool, 0, 0, 0, handle)
    }

    /// A union of already-built types.
    fn union(&mut self, ids: &[u32], node: u32) -> u32 {
        let builder = &mut self.builder;
        let mut flat: Vec<u32> = Vec::new();

        for &id in ids {
            if (builder.type_field(id, TY_FLAGS) & TYF_UNION) != 0 {
                let pool = builder.type_field(id, TY_DATA0);
                let count = builder.pool_count(pool);

                for j in 0..count {
                    flat.push(builder.pool_item(pool, j));
                }
            } else {
                flat.push(id);
            }
        }

        let mut unique: Vec<u32> = Vec::new();

        for &id in &flat {
            if !unique.contains(&id) {
                unique.push(id);
            }
        }

        if unique.is_empty() {
            return TYPE_NEVER;
        }

        if unique.len() == 1 {
            return unique[0];
        }

        let mut flags = TYF_UNION;

        for &id in &unique {
            flags |= builder.type_field(id, TY_FLAGS);
        }

        let pool = builder.pool_list(&unique);
        let handle = if node == 0 { 0 } else { self.ast.handle_of(node) };

        self.builder
            .add_type(flags, 0, 0, pool, 0, 0, 0, handle)
    }

    /// A literal type widened to its base, for a mutable binding.
    fn widen(&mut self, type_id: u32) -> u32 {
        let flags = self.builder.type_field(type_id, TY_FLAGS);

        // A union first: its flags word carries the OR of its constituents.
        if (flags & TYF_UNION) != 0 {
            let pool = self.builder.type_field(type_id, TY_DATA0);
            let count = self.builder.pool_count(pool);
            let mut widened: Vec<u32> = Vec::new();

            for i in 0..count {
                let item = self.builder.pool_item(pool, i);

                widened.push(self.widen(item));
            }

            return self.union(&widened, 0);
        }

        if (flags & TYF_ENUM_LITERAL) != 0 {
            return self.builder.type_field(type_id, TY_DATA1);
        }

        if (flags & (TYF_STRING_LITERAL | TYF_TEMPLATE_LITERAL)) != 0 {
            return TYPE_STRING;
        }

        if (flags & TYF_NUMBER_LITERAL) != 0 {
            return TYPE_NUMBER;
        }

        if type_id == TYPE_TRUE || type_id == TYPE_FALSE {
            return TYPE_BOOLEAN;
        }

        if (flags & TYF_BIGINT_LITERAL) != 0 {
            return TYPE_BIGINT;
        }

        type_id
    }

    /// Whether a type is a `Promise` or `PromiseLike` reference from the
    /// standard library.
    fn is_promise_reference(&self, type_id: u32) -> bool {
        let builder = &self.builder;

        if (builder.type_field(type_id, TY_SHAPE) & TYS_REFERENCE) == 0 {
            return false;
        }

        // Every reference this walk writes carries a symbol.
        let symbol = builder.type_field(type_id, TY_SYMBOL);

        if builder.symbol_field(symbol - 1, SY_ORIGIN) != TYO_LIB {
            return false;
        }

        let name = i64::from(builder.symbol_field(symbol - 1, SY_NAME));

        name == builder.string_id_ascii("Promise") || name == builder.string_id_ascii("PromiseLike")
    }

    /// The type `await` produces from an operand's type.
    fn awaited(&mut self, type_id: u32, node: u32) -> u32 {
        if type_id == TYPE_NONE {
            return TYPE_NONE;
        }

        let flags = self.builder.type_field(type_id, TY_FLAGS);

        if (flags & (TYF_ANY | TYF_UNKNOWN)) != 0 {
            return type_id;
        }

        if (flags & TYF_UNION) != 0 {
            let pool = self.builder.type_field(type_id, TY_DATA0);
            let count = self.builder.pool_count(pool);
            let mut parts: Vec<u32> = Vec::new();

            for i in 0..count {
                let item = self.builder.pool_item(pool, i);
                let awaited = self.awaited(item, node);

                parts.push(awaited);
            }

            return self.union(&parts, node);
        }

        if self.is_promise_reference(type_id) {
            let pool = self.builder.type_field(type_id, TY_DATA0);

            return if self.builder.pool_count(pool) > 0 {
                self.builder.pool_item(pool, 0)
            } else {
                TYPE_UNKNOWN
            };
        }

        type_id
    }

    /// A type with `null` and `undefined` removed, as `!` asserts.
    fn non_nullable(&mut self, type_id: u32) -> u32 {
        if type_id == TYPE_NONE {
            return TYPE_NONE;
        }

        let flags = self.builder.type_field(type_id, TY_FLAGS);

        if (flags & TYF_UNION) != 0 {
            let pool = self.builder.type_field(type_id, TY_DATA0);
            let count = self.builder.pool_count(pool);
            let mut kept: Vec<u32> = Vec::new();

            for i in 0..count {
                let part = self.builder.pool_item(pool, i);
                let part_flags = self.builder.type_field(part, TY_FLAGS);

                if part_flags != 0 && (part_flags & !TYF_NULLISH) == 0 {
                    continue;
                }

                kept.push(part);
            }

            return self.union(&kept, 0);
        }

        if flags != 0 && (flags & !TYF_NULLISH) == 0 {
            return TYPE_NEVER;
        }

        type_id
    }

    /// The type of a member on a type, following references and heritage.
    fn member_type(&mut self, type_id: u32, name: &[u16], depth: u32) -> u32 {
        if type_id == TYPE_NONE || depth == 0 {
            return TYPE_NONE;
        }

        let shape = self.builder.type_field(type_id, TY_SHAPE);

        // A reference is asked through the symbol it names.
        if (shape & TYS_REFERENCE) != 0 {
            if (shape & TYS_ARRAY) != 0 && is_ascii_name(name, "length") {
                return TYPE_NUMBER;
            }

            // Every reference this walk writes carries a symbol.
            let symbol = self.builder.type_field(type_id, TY_SYMBOL);
            let target = self.builder.symbol_field(symbol - 1, SY_TARGET);

            if target == 0 {
                return TYPE_NONE;
            }

            let declared = self.builder.declared_type(target - 1);

            return self.member_type(declared, name, depth - 1);
        }

        if (shape & TYS_TUPLE) != 0 && is_ascii_name(name, "length") {
            return TYPE_NUMBER;
        }

        let name_id = self.builder.string_id(name);

        if name_id != -1 {
            let first = self.builder.type_field(type_id, TY_MEMBER_FIRST);
            let count = self.builder.type_field(type_id, TY_MEMBER_COUNT);

            for i in 0..count {
                if i64::from(self.builder.member_field(first + i, TM_NAME)) == name_id
                    && (self.builder.member_field(first + i, TM_FLAGS)
                        & (TMF_INDEX_STRING | TMF_INDEX_NUMBER))
                        == 0
                {
                    let found = self.builder.member_field(first + i, TM_TYPE);

                    // An optional member may simply be absent, so reading
                    // it produces `undefined` as readily as its type —
                    // which is the checker's answer for `a.b` too.
                    if found != TYPE_NONE
                        && (self.builder.member_field(first + i, TM_FLAGS) & TMF_OPTIONAL) != 0
                    {
                        return self.union(&[found, TYPE_UNDEFINED], 0);
                    }

                    return found;
                }
            }
        }

        // Heritage: `extends` bases of classes and interfaces.
        if (shape & (TYS_CLASS | TYS_INTERFACE)) != 0 {
            let pool = self.builder.type_field(type_id, TY_DATA0);
            let count = self.builder.pool_count(pool);

            for i in 0..count {
                let base = self.builder.pool_item(pool, i);
                let found = self.member_type(base, name, depth - 1);

                if found != TYPE_NONE {
                    return found;
                }
            }
        }

        TYPE_NONE
    }

    //-------------------------------------------------------------------------
    // Annotation conversion
    //-------------------------------------------------------------------------

    /// The type a `TSTypeAnnotation` wrapper denotes.
    fn annotated(&mut self, annotation: u32) -> u32 {
        if annotation == 0 {
            return TYPE_NONE;
        }

        let inner = self.ast.field(annotation, NODE_A);

        self.convert(inner)
    }

    /// Converts a written type to a type record, memoized per node.
    fn convert(&mut self, node: u32) -> u32 {
        if let Some(&type_id) = self.node_type_memo.get(&node) {
            return type_id;
        }

        let type_id = self.convert_uncached(node);

        self.node_type_memo.insert(node, type_id);
        self.record(node, type_id);

        type_id
    }

    /// The conversion behind `convert()`.
    fn convert_uncached(&mut self, node: u32) -> u32 {
        let ast = self.ast;

        match ast.kind(node) {
            N_TS_ANY_KEYWORD => TYPE_ANY,
            N_TS_UNKNOWN_KEYWORD => TYPE_UNKNOWN,
            N_TS_NEVER_KEYWORD => TYPE_NEVER,
            N_TS_VOID_KEYWORD => TYPE_VOID,
            N_TS_UNDEFINED_KEYWORD => TYPE_UNDEFINED,
            N_TS_NULL_KEYWORD => TYPE_NULL,
            N_TS_STRING_KEYWORD => TYPE_STRING,
            N_TS_NUMBER_KEYWORD => TYPE_NUMBER,
            N_TS_BIG_INT_KEYWORD => TYPE_BIGINT,
            N_TS_BOOLEAN_KEYWORD => TYPE_BOOLEAN,
            N_TS_SYMBOL_KEYWORD => TYPE_SYMBOL,
            N_TS_OBJECT_KEYWORD => TYPE_OBJECT,

            N_TS_LITERAL_TYPE => {
                let literal = ast.field(node, NODE_A);

                self.literal_type(literal)
            }

            N_TS_TEMPLATE_LITERAL_TYPE => {
                self.builder.intern_type(TYF_TEMPLATE_LITERAL, 0, 0, 0, 0)
            }

            N_TS_UNION_TYPE => {
                let list = ast.field(node, NODE_A);
                let size = ast.raw_list_size(list);
                let mut parts: Vec<u32> = Vec::new();

                for i in 0..size {
                    let item = ast.raw_list_item(list, i);

                    parts.push(self.convert(item));
                }

                self.union(&parts, node)
            }

            N_TS_INTERSECTION_TYPE => {
                let list = ast.field(node, NODE_A);
                let size = ast.raw_list_size(list);
                let mut parts: Vec<u32> = Vec::new();
                let mut flags = TYF_INTERSECTION;

                for i in 0..size {
                    let item = ast.raw_list_item(list, i);
                    let part = self.convert(item);

                    parts.push(part);
                    flags |= self.builder.type_field(part, TY_FLAGS);
                }

                let pool = self.builder.pool_list(&parts);
                let handle = self.handle(node);

                self.builder.add_type(flags, 0, 0, pool, 0, 0, 0, handle)
            }

            N_TS_ARRAY_TYPE => {
                let element = self.convert(ast.field(node, NODE_A));

                self.array_type(element, node)
            }

            N_TS_TUPLE_TYPE => {
                let list = ast.field(node, NODE_A);
                let size = ast.raw_list_size(list);

                // `[...string[]]` is not a fixed-length tuple — it admits
                // any length — and the checker normalizes it to the array
                // type it spreads. So does this.
                if size == 1 && ast.kind(ast.raw_list_item(list, 0)) == N_TS_REST_TYPE {
                    let argument = ast.field(ast.raw_list_item(list, 0), NODE_A);

                    return self.convert(argument);
                }

                let mut elements: Vec<u32> = Vec::new();

                for i in 0..size {
                    let item = ast.raw_list_item(list, i);

                    elements.push(self.tuple_element(item));
                }

                let pool = self.builder.pool_list(&elements);
                let handle = self.handle(node);

                self.builder
                    .add_type(TYF_OBJECT, TYS_TUPLE, 0, pool, 0, 0, 0, handle)
            }

            N_TS_FUNCTION_TYPE => self.signature_type(
                ast.field(node, NODE_A),
                ast.field(node, NODE_B),
                ast.field(node, NODE_C),
                false,
                false,
                node,
            ),

            N_TS_CONSTRUCTOR_TYPE => {
                let instance = self.annotated(ast.field(node, NODE_B));
                let pool = self.parameter_pool(ast.field(node, NODE_A));
                let handle = self.handle(node);

                self.builder.add_type(
                    TYF_OBJECT,
                    TYS_FUNCTION | TYS_CONSTRUCTOR,
                    0,
                    pool,
                    instance,
                    0,
                    0,
                    handle,
                )
            }

            N_TS_TYPE_LITERAL => {
                let (first, count, extra) = self.signature_members(ast.field(node, NODE_A));
                let handle = self.handle(node);

                self.builder.add_type(
                    TYF_OBJECT,
                    TYS_ANONYMOUS | extra,
                    0,
                    0,
                    0,
                    first,
                    count,
                    handle,
                )
            }

            N_TS_TYPE_REFERENCE => self.type_reference(node),

            // A predicate signature returns a boolean — unless it asserts,
            // in which case it returns nothing at all.
            N_TS_TYPE_PREDICATE => {
                if ast.field(node, NODE_C) == 1 {
                    TYPE_VOID
                } else {
                    TYPE_BOOLEAN
                }
            }

            // Named, optional, and rest elements exist only inside tuples,
            // and `tuple_element()` unwraps them there; everything else
            // unmodeled defers.
            _ => self.deferred(node),
        }
    }

    /// The literal type a `TSLiteralType` wraps.
    fn literal_type(&mut self, literal: u32) -> u32 {
        let kind = self.ast.kind(literal);

        if kind == N_LITERAL {
            return self.literal_value_type(literal);
        }

        if kind == N_TEMPLATE_LITERAL {
            return self.builder.intern_type(TYF_TEMPLATE_LITERAL, 0, 0, 0, 0);
        }

        if kind == N_UNARY_EXPRESSION {
            // `-1` in type position: the literal is the whole written text.
            let text = self.text(literal).to_vec();
            let value = self.builder.intern(&text);

            return self
                .builder
                .intern_type(TYF_NUMBER_LITERAL, 0, 0, value, 0);
        }

        self.deferred(literal)
    }

    /// The literal type of a `Literal` node.
    fn literal_value_type(&mut self, literal: u32) -> u32 {
        let subtype = self.ast.field(literal, NODE_A);

        match subtype {
            LIT_STRING => {
                let units = self.ast.literal_string(literal);
                let value = self.builder.intern(&units);

                self.builder
                    .intern_type(TYF_STRING_LITERAL, 0, 0, value, 0)
            }

            LIT_NUMBER => {
                let text = self.text(literal).to_vec();
                let value = self.builder.intern(&text);

                self.builder
                    .intern_type(TYF_NUMBER_LITERAL, 0, 0, value, 0)
            }

            // `true` is four characters long; `false` is five.
            LIT_BOOLEAN => {
                if self.ast.end(literal) - self.ast.start(literal) == 4 {
                    TYPE_TRUE
                } else {
                    TYPE_FALSE
                }
            }

            LIT_NULL => TYPE_NULL,

            LIT_BIGINT => {
                let text = self.text(literal).to_vec();
                let value = self.builder.intern(&text);

                self.builder
                    .intern_type(TYF_BIGINT_LITERAL, 0, 0, value, 0)
            }

            LIT_REGEXP => {
                let symbol = self.lib_symbol("RegExp");

                self.builder
                    .intern_type(TYF_OBJECT, TYS_REFERENCE, symbol + 1, 0, 0)
            }

            _ => TYPE_STRING,
        }
    }

    /// One tuple element's type, unwrapping labels, optionality, and rest.
    fn tuple_element(&mut self, element: u32) -> u32 {
        let kind = self.ast.kind(element);

        if kind == N_TS_NAMED_TUPLE_MEMBER {
            return self.convert(self.ast.field(element, NODE_B));
        }

        if kind == N_TS_OPTIONAL_TYPE || kind == N_TS_REST_TYPE {
            return self.convert(self.ast.field(element, NODE_A));
        }

        self.convert(element)
    }

    /// The type a `TSTypeReference` names.
    fn type_reference(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let type_name = ast.field(node, NODE_A);
        let args_node = ast.field(node, NODE_B);
        let mut args: Vec<u32> = Vec::new();

        if args_node != 0 && ast.kind(args_node) == N_TS_TYPE_PARAMETER_INSTANTIATION {
            let list = ast.field(args_node, NODE_A);
            let size = ast.raw_list_size(list);

            for i in 0..size {
                let item = ast.raw_list_item(list, i);

                args.push(self.convert(item));
            }
        }

        let symbol: u32;
        let mut shape = TYS_REFERENCE;

        if ast.kind(type_name) == N_TS_QUALIFIED_NAME {
            // `A.B.C` names a member of a namespace this analysis does not
            // model.
            let mut root = type_name;

            while ast.kind(root) == N_TS_QUALIFIED_NAME {
                root = ast.field(root, NODE_A);
            }

            let root_symbol = self.resolved_symbol(root, RF_TYPE);
            let text = self.text(type_name).to_vec();
            let name = self.builder.intern(&text);

            if root_symbol != -1 {
                let root_id = self.symbol_for(root_symbol as u32);
                let origin = self.builder.symbol_field(root_id, SY_ORIGIN);
                let specifier = self.builder.symbol_field(root_id, SY_SPECIFIER);
                let decl = self.handle(type_name);

                symbol = self.builder.intern_symbol(name, origin, specifier, decl, 0);
            } else {
                symbol = self.builder.intern_symbol(name, TYO_GLOBAL, 0, 0, 0);
            }

            shape |= TYS_DEFERRED;
        } else {
            let name_units = ast.name(type_name);
            let resolved = self.resolved_symbol(type_name, RF_TYPE);

            if resolved != -1 {
                symbol = self.symbol_for(resolved as u32);

                // A type parameter's reference is the parameter itself.
                let declared = self.builder.declared_type(resolved as u32);

                if declared != TYPE_NONE
                    && (self.builder.type_field(declared, TY_FLAGS) & TYF_TYPE_PARAMETER) != 0
                {
                    return declared;
                }
            } else if is_well_known_lib_type(&name_units) {
                symbol = {
                    let name_id = self.builder.intern(&name_units);

                    self.builder.intern_symbol(name_id, TYO_LIB, 0, 0, 0)
                };

                if is_ascii_name(&name_units, "Array") || is_ascii_name(&name_units, "ReadonlyArray")
                {
                    shape |= TYS_ARRAY;
                }
            } else {
                let name_id = self.builder.intern(&name_units);

                symbol = self.builder.intern_symbol(name_id, TYO_GLOBAL, 0, 0, 0);
                shape |= TYS_UNRESOLVED;
            }
        }

        if args.is_empty() {
            return self
                .builder
                .intern_type(TYF_OBJECT, shape, symbol + 1, 0, 0);
        }

        let pool = self.builder.pool_list(&args);
        let handle = self.handle(node);

        self.builder
            .add_type(TYF_OBJECT, shape, symbol + 1, pool, 0, 0, 0, handle)
    }

    //-------------------------------------------------------------------------
    // Signatures and members
    //-------------------------------------------------------------------------

    /// Declares a list of type parameters, binding each name.
    fn declare_type_parameters(&mut self, declaration: u32) {
        if declaration == 0 {
            return;
        }

        let ast = self.ast;
        let list = ast.field(declaration, NODE_A);
        let size = ast.raw_list_size(list);

        for i in 0..size {
            let parameter = ast.raw_list_item(list, i);

            if ast.kind(parameter) != N_TS_TYPE_PARAMETER {
                continue;
            }

            let name = ast.field(parameter, NODE_A);
            let constraint_node = ast.field(parameter, NODE_B);
            let default_node = ast.field(parameter, NODE_C);
            let constraint = if constraint_node == 0 {
                TYPE_NONE
            } else {
                self.convert(constraint_node)
            };
            let fallback = if default_node == 0 {
                TYPE_NONE
            } else {
                self.convert(default_node)
            };
            let symbol = self.declared_symbol(name);
            let symbol_word = if symbol == -1 {
                0
            } else {
                self.symbol_for(symbol as u32) + 1
            };
            let handle = self.handle(parameter);
            let type_id = self.builder.add_type(
                TYF_TYPE_PARAMETER,
                0,
                symbol_word,
                constraint,
                fallback,
                0,
                0,
                handle,
            );

            if symbol != -1 {
                self.builder.set_declared_type(symbol as u32, type_id);
            }

            self.record(parameter, type_id);
        }
    }

    /// The pool of a parameter list's types, binding annotated names.
    fn parameter_pool(&mut self, params: u32) -> u32 {
        let size = self.ast.raw_list_size(params);
        let mut types: Vec<u32> = Vec::new();

        for i in 0..size {
            let item = self.ast.raw_list_item(params, i);

            types.push(self.parameter_type(item));
        }

        self.builder.pool_list(&types)
    }

    /// An annotated parameter's type with its optionality applied: `x?: T`
    /// admits `undefined` — the argument may simply be absent — so the
    /// recorded type is `T | undefined`, which is also the checker's answer.
    fn optional_parameter(&mut self, parameter: u32, type_id: u32) -> u32 {
        if type_id == TYPE_NONE || (self.ast.flags(parameter) & NF_OPTIONAL) == 0 {
            return type_id;
        }

        self.union(&[type_id, TYPE_UNDEFINED], parameter)
    }

    /// One parameter's written type, binding its name when it has one.
    fn parameter_type(&mut self, parameter: u32) -> u32 {
        let ast = self.ast;

        match ast.kind(parameter) {
            N_IDENTIFIER => {
                let annotated = self.annotated(ast.field(parameter, NODE_B));
                let type_id = self.optional_parameter(parameter, annotated);

                if type_id != TYPE_NONE {
                    let symbol = self.declared_symbol(parameter);

                    if symbol != -1 {
                        self.builder.set_symbol_type(symbol as u32, type_id);
                    }

                    self.record(parameter, type_id);
                }

                type_id
            }

            N_ASSIGNMENT_PATTERN => self.parameter_type(ast.field(parameter, NODE_A)),

            N_TS_PARAMETER_PROPERTY => self.parameter_type(ast.field(parameter, NODE_A)),

            N_OBJECT_PATTERN | N_ARRAY_PATTERN => {
                let annotated = self.annotated(ast.field(parameter, NODE_B));

                self.optional_parameter(parameter, annotated)
            }

            N_REST_ELEMENT => {
                let type_id = self.annotated(ast.field(parameter, NODE_B));
                let argument = ast.field(parameter, NODE_A);

                if type_id != TYPE_NONE && ast.kind(argument) == N_IDENTIFIER {
                    let symbol = self.declared_symbol(argument);

                    if symbol != -1 {
                        self.builder.set_symbol_type(symbol as u32, type_id);
                    }

                    self.record(argument, type_id);
                }

                type_id
            }

            _ => TYPE_NONE,
        }
    }

    /// A function or method type from its written signature.
    fn signature_type(
        &mut self,
        params: u32,
        return_annotation: u32,
        type_parameters: u32,
        is_async: bool,
        is_generator: bool,
        node: u32,
    ) -> u32 {
        self.declare_type_parameters(type_parameters);

        let pool = self.parameter_pool(params);
        let mut returns = self.annotated(return_annotation);

        // An unannotated `async` function still returns a `Promise`; an
        // async generator returns an `AsyncGenerator`, left unclaimed.
        if is_async && !is_generator && returns == TYPE_NONE {
            returns = self.promise_type(TYPE_UNKNOWN, node);
        }

        let handle = self.handle(node);

        self.builder
            .add_type(TYF_OBJECT, TYS_FUNCTION, 0, pool, returns, 0, 0, handle)
    }

    /// The member run of an interface body or type literal, returning the
    /// extra `TYS_*` shape bits the list earned — `TYS_INEXACT`,
    /// `TYS_CALLABLE`, or both.
    fn signature_members(&mut self, list: u32) -> (u32, u32, u32) {
        let ast = self.ast;
        let size = ast.raw_list_size(list);
        let mut entries: Vec<MemberEntry> = Vec::new();
        let mut shape = 0;

        for i in 0..size {
            let member = ast.raw_list_item(list, i);
            let kind = ast.kind(member);
            let flags = ast.flags(member);

            if kind == N_TS_PROPERTY_SIGNATURE {
                if (flags & NF_COMPUTED) != 0 {
                    shape |= TYS_INEXACT;
                    continue;
                }

                let name = self.member_name(ast.field(member, NODE_A));
                let type_id = self.annotated(ast.field(member, NODE_B));

                entries.push(MemberEntry {
                    name,
                    type_id,
                    flags: (if (flags & NF_OPTIONAL) != 0 { TMF_OPTIONAL } else { 0 })
                        | (if (flags & NF_READONLY) != 0 { TMF_READONLY } else { 0 }),
                });
                continue;
            }

            if kind == N_TS_METHOD_SIGNATURE {
                if (flags & NF_COMPUTED) != 0 {
                    shape |= TYS_INEXACT;
                    continue;
                }

                let method_kind = (flags & MKIND_MASK) >> MKIND_SHIFT;
                let signature = self.signature_type(
                    ast.field(member, NODE_B),
                    ast.field(member, NODE_C),
                    ast.field(member, NODE_D),
                    false,
                    false,
                    member,
                );
                let name = self.member_name(ast.field(member, NODE_A));
                let extra = if (flags & NF_OPTIONAL) != 0 { TMF_OPTIONAL } else { 0 };

                entries.push(self.accessor_entry(name, signature, method_kind, extra));
                continue;
            }

            if kind == N_TS_INDEX_SIGNATURE {
                let type_id = self.annotated(ast.field(member, NODE_B));
                let flags = self.index_kind_of(ast.field(member, NODE_A));

                entries.push(MemberEntry {
                    name: 0,
                    type_id,
                    flags,
                });
                continue;
            }

            // A call or construct signature is not recorded as a member,
            // which makes the type inexact — and callable, which is what
            // decides `typeof`: a value of the type answers `"function"`.
            if kind == N_TS_CALL_SIGNATURE_DECLARATION
                || kind == N_TS_CONSTRUCT_SIGNATURE_DECLARATION
            {
                shape |= TYS_CALLABLE | TYS_INEXACT;
            }
        }

        let (first, count) = self.write_members(&entries);

        (first, count, shape)
    }

    /// The index-signature flag for a parameter list's key type.
    fn index_kind_of(&self, parameters: u32) -> u32 {
        let ast = self.ast;

        if ast.raw_list_size(parameters) > 0 {
            let parameter = ast.raw_list_item(parameters, 0);

            if ast.kind(parameter) == N_IDENTIFIER {
                let annotation = ast.field(parameter, NODE_B);

                if annotation != 0
                    && ast.kind(ast.field(annotation, NODE_A)) == N_TS_NUMBER_KEYWORD
                {
                    return TMF_INDEX_NUMBER;
                }
            }
        }

        TMF_INDEX_STRING
    }

    /// A member entry for a method, getter, or setter.
    fn accessor_entry(
        &self,
        name: u32,
        signature: u32,
        method_kind: u32,
        extra_flags: u32,
    ) -> MemberEntry {
        let builder = &self.builder;

        if method_kind == MKIND_GET {
            return MemberEntry {
                name,
                type_id: builder.type_field(signature, TY_DATA1),
                flags: TMF_GETTER | extra_flags,
            };
        }

        if method_kind == MKIND_SET {
            let pool = builder.type_field(signature, TY_DATA0);

            return MemberEntry {
                name,
                type_id: if builder.pool_count(pool) > 0 {
                    builder.pool_item(pool, 0)
                } else {
                    TYPE_NONE
                },
                flags: TMF_SETTER | extra_flags,
            };
        }

        MemberEntry {
            name,
            type_id: signature,
            flags: TMF_METHOD | extra_flags,
        }
    }

    /// The string ID of a member key.
    fn member_name(&mut self, key: u32) -> u32 {
        if self.ast.kind(key) == N_LITERAL {
            let subtype = self.ast.field(key, NODE_A);
            let units = if subtype == LIT_STRING {
                self.ast.literal_string(key)
            } else {
                self.text(key).to_vec()
            };

            return self.builder.intern(&units);
        }

        let units = self.ast.name(key);

        self.builder.intern(&units)
    }

    /// Writes a collected member run contiguously.
    fn write_members(&mut self, entries: &[MemberEntry]) -> (u32, u32) {
        let first = self.builder.member_count();

        for entry in entries {
            self.builder.add_member(entry.name, entry.type_id, entry.flags);
        }

        (first, entries.len() as u32)
    }

    //-------------------------------------------------------------------------
    // Declarations
    //-------------------------------------------------------------------------

    /// Descends into every child of a node with the declaration pass.
    fn declare_children(&mut self, node: u32) {
        let ast = self.ast;
        let kind = ast.kind(node);
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let shape = SLOT_TABLE[base + slot];

            if u32::from(shape) == SLOT_NODE {
                let child = ast.field(node, NODE_A + slot);

                if child != 0 {
                    self.declare(child);
                }
            } else if u32::from(shape) == SLOT_LIST {
                let list = ast.field(node, NODE_A + slot);
                let size = ast.raw_list_size(list);

                for i in 0..size {
                    let child = ast.raw_list_item(list, i);

                    if child != 0 {
                        self.declare(child);
                    }
                }
            }
        }
    }

    /// The declaration pass: reads every signature and declared type.
    fn declare(&mut self, node: u32) {
        let ast = self.ast;

        match ast.kind(node) {
            N_FUNCTION_DECLARATION | N_TS_DECLARE_FUNCTION => {
                let type_id = self.function_type(node);
                let id = ast.field(node, NODE_A);

                if id != 0 {
                    let symbol = self.declared_symbol(id);

                    if symbol != -1 {
                        self.builder.set_symbol_type(symbol as u32, type_id);
                    }

                    self.record(id, type_id);
                }

                self.record(node, type_id);
            }

            N_FUNCTION_EXPRESSION
            | N_ARROW_FUNCTION_EXPRESSION
            | N_TS_EMPTY_BODY_FUNCTION_EXPRESSION => {
                let type_id = self.function_type(node);

                self.record(node, type_id);
            }

            N_CLASS_DECLARATION | N_CLASS_EXPRESSION => {
                self.class_type(node);
            }

            N_TS_INTERFACE_DECLARATION => {
                self.interface_type(node);
                return;
            }

            N_TS_TYPE_ALIAS_DECLARATION => {
                self.declare_type_parameters(ast.field(node, NODE_C));

                let type_id = self.convert(ast.field(node, NODE_B));
                let symbol = self.declared_symbol(ast.field(node, NODE_A));

                if symbol != -1 {
                    self.builder.set_declared_type(symbol as u32, type_id);
                }

                self.record(ast.field(node, NODE_A), type_id);
                return;
            }

            N_TS_ENUM_DECLARATION => {
                self.enum_type(node);
                return;
            }

            N_TS_MODULE_DECLARATION => {
                let id = ast.field(node, NODE_A);
                let symbol = if ast.kind(id) == N_IDENTIFIER {
                    self.declared_symbol(id)
                } else {
                    -1
                };
                let symbol_word = if symbol == -1 {
                    0
                } else {
                    self.symbol_for(symbol as u32) + 1
                };
                let handle = self.handle(node);
                let type_id = self.builder.add_type(
                    TYF_OBJECT,
                    TYS_NAMESPACE,
                    symbol_word,
                    0,
                    0,
                    0,
                    0,
                    handle,
                );

                // A namespace can merge with a function, class, enum, or
                // variable of the same name, and the merged value is that
                // declaration's: `typeof getBindingIdentifiers` stays a
                // function after `declare namespace getBindingIdentifiers`
                // adds to it, wherever the two sit in the file. When such
                // a declaration shares the symbol, the namespace types
                // neither the symbol nor its own node beyond what the
                // merge partner already recorded. The symbol's *declared
                // type* is never the namespace object either way: a bare
                // namespace name is not a type, and the interface, alias,
                // or enum it merges with is what a type reference means.
                let merged = symbol != -1 && self.merges_with_value(symbol as u32);

                if symbol != -1 && !merged {
                    self.builder.set_symbol_type(symbol as u32, type_id);
                }

                let recorded = if merged {
                    self.builder.symbol_type(symbol as u32)
                } else {
                    type_id
                };

                self.record(node, recorded);
            }

            N_VARIABLE_DECLARATOR => {
                let id = ast.field(node, NODE_A);

                if ast.kind(id) == N_IDENTIFIER {
                    let type_id = self.annotated(ast.field(id, NODE_B));

                    if type_id != TYPE_NONE {
                        let symbol = self.declared_symbol(id);

                        if symbol != -1 {
                            self.builder.set_symbol_type(symbol as u32, type_id);
                        }

                        self.record(id, type_id);
                    }
                } else {
                    // A destructuring pattern can still carry an annotation.
                    let type_id = self.annotated(ast.field(id, NODE_B));

                    self.record(id, type_id);
                }
            }

            N_IMPORT_DECLARATION => {
                self.declare_imports(node);
                return;
            }

            N_CATCH_CLAUSE => {
                let parameter = ast.field(node, NODE_A);

                if parameter != 0 && ast.kind(parameter) == N_IDENTIFIER {
                    self.parameter_type(parameter);
                }
            }

            _ => {}
        }

        self.declare_children(node);
    }

    /// A function-like node's type, memoized so both passes agree.
    fn function_type(&mut self, node: u32) -> u32 {
        if let Some(&type_id) = self.node_type_memo.get(&node) {
            return type_id;
        }

        let flags = self.ast.flags(node);
        let type_id = self.signature_type(
            self.ast.field(node, NODE_B),
            self.ast.field(node, NODE_E),
            self.ast.field(node, NODE_D),
            (flags & NF_ASYNC) != 0,
            (flags & NF_GENERATOR) != 0,
            node,
        );

        self.node_type_memo.insert(node, type_id);

        type_id
    }

    /// Declares a class: its constructor type, instance type, and members.
    fn class_type(&mut self, node: u32) -> u32 {
        if let Some(&memo) = self.node_type_memo.get(&node) {
            return memo;
        }

        let ast = self.ast;
        let id = ast.field(node, NODE_A);
        let scope_symbol = if id == 0 { -1 } else { self.declared_symbol(id) };
        let symbol = if scope_symbol == -1 {
            let name_units = if id == 0 { Vec::new() } else { ast.name(id) };
            let name = self.builder.intern(&name_units);
            let handle = self.handle(node);

            self.builder.intern_symbol(name, TYO_LOCAL, 0, handle, 0)
        } else {
            self.symbol_for(scope_symbol as u32)
        };

        self.declare_type_parameters(ast.field(node, NODE_D));

        // The `extends` base, when it names a class this file declares.
        let super_class = ast.field(node, NODE_B);
        let mut heritage = 0u32;

        if super_class != 0 && ast.kind(super_class) == N_IDENTIFIER {
            let base_symbol = self.resolved_symbol(super_class, RF_VALUE);

            if base_symbol != -1 {
                let base = self.builder.declared_type(base_symbol as u32);

                if base != TYPE_NONE {
                    heritage = self.builder.pool_list(&[base]);
                }
            }
        }

        let handle = self.handle(node);
        let instance = self.builder.add_type(
            TYF_OBJECT,
            TYS_CLASS,
            symbol + 1,
            heritage,
            0,
            0,
            0,
            handle,
        );
        let (first, count, inexact) = self.class_members(ast.field(node, NODE_C));

        self.builder.patch_type(instance, TY_MEMBER_FIRST, first);
        self.builder.patch_type(instance, TY_MEMBER_COUNT, count);

        if inexact {
            self.builder
                .patch_type(instance, TY_SHAPE, TYS_CLASS | TYS_INEXACT);
        }

        let constructor = self.builder.add_type(
            TYF_OBJECT,
            TYS_FUNCTION | TYS_CONSTRUCTOR,
            symbol + 1,
            0,
            instance,
            0,
            0,
            handle,
        );

        if scope_symbol != -1 {
            self.builder.set_symbol_type(scope_symbol as u32, constructor);
            self.builder.set_declared_type(scope_symbol as u32, instance);
        }

        self.node_type_memo.insert(node, constructor);
        self.record(node, constructor);

        constructor
    }

    /// The instance member run of a class body.
    fn class_members(&mut self, body: u32) -> (u32, u32, bool) {
        let ast = self.ast;
        let list = ast.field(body, NODE_A);
        let size = ast.raw_list_size(list);
        let mut entries: Vec<MemberEntry> = Vec::new();
        let mut inexact = false;

        for i in 0..size {
            let member = ast.raw_list_item(list, i);
            let kind = ast.kind(member);
            let flags = ast.flags(member);

            if (flags & NF_STATIC) != 0 {
                continue;
            }

            if kind == N_METHOD_DEFINITION || kind == N_TS_ABSTRACT_METHOD_DEFINITION {
                let method_kind = (flags & MKIND_MASK) >> MKIND_SHIFT;
                let value = ast.field(member, NODE_B);

                if method_kind == MKIND_CONSTRUCTOR {
                    if self.has_parameter_properties(value) {
                        inexact = true;
                    }

                    // The signature still binds its annotated parameters.
                    self.function_type(value);
                    continue;
                }

                if (flags & NF_COMPUTED) != 0 {
                    self.function_type(value);
                    inexact = true;
                    continue;
                }

                let name = self.member_name(ast.field(member, NODE_A));
                let signature = self.function_type(value);

                entries.push(self.accessor_entry(name, signature, method_kind, 0));
                continue;
            }

            if kind == N_PROPERTY_DEFINITION
                || kind == N_TS_ABSTRACT_PROPERTY_DEFINITION
                || kind == N_ACCESSOR_PROPERTY
                || kind == N_TS_ABSTRACT_ACCESSOR_PROPERTY
            {
                if (flags & NF_COMPUTED) != 0 {
                    inexact = true;
                    continue;
                }

                let name = self.member_name(ast.field(member, NODE_A));
                let type_id = self.annotated(ast.field(member, NODE_D));

                entries.push(MemberEntry {
                    name,
                    type_id,
                    flags: (if (flags & NF_OPTIONAL) != 0 { TMF_OPTIONAL } else { 0 })
                        | (if (flags & NF_READONLY) != 0 { TMF_READONLY } else { 0 }),
                });
            }
        }

        let (first, count) = self.write_members(&entries);

        (first, count, inexact)
    }

    /// Whether a constructor declares parameter properties.
    fn has_parameter_properties(&self, value: u32) -> bool {
        let params = self.ast.field(value, NODE_B);
        let size = self.ast.raw_list_size(params);

        for i in 0..size {
            if self.ast.kind(self.ast.raw_list_item(params, i)) == N_TS_PARAMETER_PROPERTY {
                return true;
            }
        }

        false
    }

    /// Declares an interface: its symbol, heritage, and members.
    fn interface_type(&mut self, node: u32) {
        let ast = self.ast;
        let id = ast.field(node, NODE_A);
        let scope_symbol = self.declared_symbol(id);
        let symbol = if scope_symbol == -1 {
            let name_units = ast.name(id);
            let name = self.builder.intern(&name_units);
            let handle = self.handle(id);

            self.builder.intern_symbol(name, TYO_LOCAL, 0, handle, 0)
        } else {
            self.symbol_for(scope_symbol as u32)
        };

        self.declare_type_parameters(ast.field(node, NODE_C));

        let extends_list = ast.field(node, NODE_D);
        let extends_size = ast.raw_list_size(extends_list);
        let mut bases: Vec<u32> = Vec::new();

        for i in 0..extends_size {
            let heritage = ast.raw_list_item(extends_list, i);

            if ast.kind(heritage) != N_TS_INTERFACE_HERITAGE {
                continue;
            }

            let expression = ast.field(heritage, NODE_A);

            // A base named any other way — `extends React.FC<P>` — is a
            // structure this analysis does not model, and dropping it
            // would make the interface look self-contained: members it
            // inherits would seem absent, and callability it inherits
            // would seem ruled out. A deferred base keeps the unknown on
            // the record.
            let base = if ast.kind(expression) == N_IDENTIFIER {
                self.heritage_reference(expression)
            } else {
                self.deferred(expression)
            };

            bases.push(base);
        }

        let heritage_pool = self.builder.pool_list(&bases);
        let body = ast.field(node, NODE_B);
        let (first, count, extra) = self.signature_members(ast.field(body, NODE_A));
        let handle = self.handle(node);
        let type_id = self.builder.add_type(
            TYF_OBJECT,
            TYS_INTERFACE | extra,
            symbol + 1,
            heritage_pool,
            0,
            first,
            count,
            handle,
        );

        if scope_symbol != -1 {
            self.builder.set_declared_type(scope_symbol as u32, type_id);
        }

        self.record(node, type_id);
        self.record(id, type_id);
    }

    /// A reference type for one `extends` clause name.
    fn heritage_reference(&mut self, expression: u32) -> u32 {
        let name_units = self.ast.name(expression);
        let resolved = self.resolved_symbol(expression, RF_TYPE);
        let symbol: u32;
        let mut shape = TYS_REFERENCE;

        if resolved != -1 {
            symbol = self.symbol_for(resolved as u32);
        } else if is_well_known_lib_type(&name_units) {
            let name_id = self.builder.intern(&name_units);

            symbol = self.builder.intern_symbol(name_id, TYO_LIB, 0, 0, 0);
        } else {
            let name_id = self.builder.intern(&name_units);

            symbol = self.builder.intern_symbol(name_id, TYO_GLOBAL, 0, 0, 0);
            shape |= TYS_UNRESOLVED;
        }

        self.builder
            .intern_type(TYF_OBJECT, shape, symbol + 1, 0, 0)
    }

    /// Declares an enum: one type for the enum, one literal per member.
    fn enum_type(&mut self, node: u32) {
        let ast = self.ast;
        let id = ast.field(node, NODE_A);
        let scope_symbol = self.declared_symbol(id);
        let symbol = if scope_symbol == -1 {
            let name_units = ast.name(id);
            let name = self.builder.intern(&name_units);
            let handle = self.handle(id);

            self.builder.intern_symbol(name, TYO_LOCAL, 0, handle, 0)
        } else {
            self.symbol_for(scope_symbol as u32)
        };
        let handle = self.handle(node);
        let enum_type = self
            .builder
            .add_type(TYF_OBJECT | TYF_ENUM, 0, symbol + 1, 0, 0, 0, 0, handle);
        let body = ast.field(node, NODE_B);
        let list = ast.field(body, NODE_A);
        let size = ast.raw_list_size(list);
        let mut entries: Vec<MemberEntry> = Vec::new();

        for i in 0..size {
            let member = ast.raw_list_item(list, i);

            if ast.kind(member) != N_TS_ENUM_MEMBER {
                continue;
            }

            let member_id = ast.field(member, NODE_A);
            let name_id = self.member_name(member_id);
            let initializer = ast.field(member, NODE_B);
            let is_string = initializer != 0
                && ast.kind(initializer) == N_LITERAL
                && ast.field(initializer, NODE_A) == LIT_STRING;
            let member_type = self.builder.intern_type(
                (if is_string {
                    TYF_STRING_LITERAL
                } else {
                    TYF_NUMBER_LITERAL
                }) | TYF_ENUM_LITERAL,
                0,
                symbol + 1,
                name_id,
                enum_type,
            );

            entries.push(MemberEntry {
                name: name_id,
                type_id: member_type,
                flags: 0,
            });
            self.record(member, member_type);

            let member_symbol = self.declared_symbol(member_id);

            if member_symbol != -1 {
                self.builder.set_symbol_type(member_symbol as u32, member_type);
            }
        }

        let (first, count) = self.write_members(&entries);

        self.builder.patch_type(enum_type, TY_MEMBER_FIRST, first);
        self.builder.patch_type(enum_type, TY_MEMBER_COUNT, count);

        // The declaration binds two answers, the way a class does. The
        // *type* `E` is the enum type above — a value of it is a member,
        // so it classifies by the members' base. The *value* `E` is the
        // object the declaration creates, whose properties are the members
        // and whose `typeof` is `"object"`, never `"number"`. Both share
        // one member run, so `E.A` resolves through either.
        let id_handle = self.handle(id);
        let enum_object = self.builder.add_type(
            TYF_OBJECT,
            TYS_NAMESPACE,
            symbol + 1,
            0,
            0,
            first,
            count,
            id_handle,
        );

        if scope_symbol != -1 {
            self.builder.set_symbol_type(scope_symbol as u32, enum_object);
            self.builder.set_declared_type(scope_symbol as u32, enum_type);
        }

        self.record(node, enum_object);
        self.record(id, enum_object);
    }

    /// Declares every binding of an import declaration as a foreign type.
    fn declare_imports(&mut self, node: u32) {
        let ast = self.ast;
        let specifiers = ast.field(node, NODE_A);
        let size = ast.raw_list_size(specifiers);

        for i in 0..size {
            let specifier = ast.raw_list_item(specifiers, i);
            let local = if ast.kind(specifier) == N_IMPORT_SPECIFIER {
                ast.field(specifier, NODE_B)
            } else {
                ast.field(specifier, NODE_A)
            };
            let symbol = self.declared_symbol(local);

            if symbol == -1 {
                continue;
            }

            let symbol_id = self.symbol_for(symbol as u32);
            let type_id =
                self.builder
                    .intern_type(0, TYS_REFERENCE | TYS_FOREIGN, symbol_id + 1, 0, 0);

            self.builder.set_symbol_type(symbol as u32, type_id);
            self.builder.set_declared_type(symbol as u32, type_id);
            self.record(local, type_id);
        }
    }

    //-------------------------------------------------------------------------
    // Expressions
    //-------------------------------------------------------------------------

    /// Descends into every child of a node with the expression pass.
    fn express_children(&mut self, node: u32) {
        self.express_children_except(node, 0);
    }

    /// Descends into every child of a node except one — the key a member
    /// case withholds — with the expression pass.
    fn express_children_except(&mut self, node: u32, skipped: u32) {
        let ast = self.ast;
        let kind = ast.kind(node);
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let shape = SLOT_TABLE[base + slot];

            if u32::from(shape) == SLOT_NODE {
                let child = ast.field(node, NODE_A + slot);

                if child != 0 && child != skipped {
                    self.express(child);
                }
            } else if u32::from(shape) == SLOT_LIST {
                let list = ast.field(node, NODE_A + slot);
                let size = ast.raw_list_size(list);

                for i in 0..size {
                    let child = ast.raw_list_item(list, i);

                    if child != 0 && child != skipped {
                        self.express(child);
                    }
                }
            }
        }
    }

    /// The expression pass: types what the rules can say something about.
    fn express(&mut self, node: u32) -> u32 {
        let ast = self.ast;

        match ast.kind(node) {
            N_LITERAL => {
                let type_id = self.literal_value_type(node);

                self.record(node, type_id);

                type_id
            }

            N_TEMPLATE_LITERAL => {
                self.express_children(node);
                self.record(node, TYPE_STRING);

                TYPE_STRING
            }

            N_IDENTIFIER => self.express_identifier(node),

            N_ARRAY_EXPRESSION => self.express_array(node),

            N_OBJECT_EXPRESSION => self.express_object(node),

            N_FUNCTION_EXPRESSION
            | N_ARROW_FUNCTION_EXPRESSION
            | N_TS_EMPTY_BODY_FUNCTION_EXPRESSION
            | N_FUNCTION_DECLARATION
            | N_TS_DECLARE_FUNCTION => {
                let type_id = self.function_type(node);

                self.express_children(node);
                self.record(node, type_id);

                type_id
            }

            N_CLASS_DECLARATION | N_CLASS_EXPRESSION => {
                let type_id = self.class_type(node);

                self.express_children(node);
                self.record(node, type_id);

                type_id
            }

            N_UNARY_EXPRESSION => self.express_unary(node),

            N_UPDATE_EXPRESSION => {
                let operand = self.express(ast.field(node, NODE_A));
                let type_id = self.numeric_result(operand, TYPE_NONE);

                self.record(node, type_id);

                type_id
            }

            N_BINARY_EXPRESSION => self.express_binary(node),

            N_LOGICAL_EXPRESSION | N_CONDITIONAL_EXPRESSION => {
                let left: u32;
                let right: u32;

                if ast.kind(node) == N_CONDITIONAL_EXPRESSION {
                    self.express(ast.field(node, NODE_A));
                    left = self.express(ast.field(node, NODE_B));
                    right = self.express(ast.field(node, NODE_C));
                } else {
                    left = self.express(ast.field(node, NODE_A));
                    right = self.express(ast.field(node, NODE_B));
                }

                if left == TYPE_NONE || right == TYPE_NONE {
                    return TYPE_NONE;
                }

                let type_id = self.union(&[left, right], node);

                self.record(node, type_id);

                type_id
            }

            N_ASSIGNMENT_EXPRESSION => {
                self.express(ast.field(node, NODE_A));

                let right = self.express(ast.field(node, NODE_B));
                let operator = ast.field(node, NODE_C);
                let type_id = if operator == T_ASSIGN {
                    right
                } else {
                    self.compound_result(node, right)
                };

                self.record(node, type_id);

                type_id
            }

            N_SEQUENCE_EXPRESSION => {
                let list = ast.field(node, NODE_A);
                let size = ast.raw_list_size(list);
                let mut last = TYPE_NONE;

                for i in 0..size {
                    last = self.express(ast.raw_list_item(list, i));
                }

                self.record(node, last);

                last
            }

            N_CALL_EXPRESSION => self.express_call(node),

            N_NEW_EXPRESSION => self.express_new(node),

            N_MEMBER_EXPRESSION => self.express_member(node),

            N_CHAIN_EXPRESSION => {
                let type_id = self.express(ast.field(node, NODE_A));

                self.record(node, type_id);

                type_id
            }

            N_AWAIT_EXPRESSION => {
                let operand = self.express(ast.field(node, NODE_A));
                let type_id = self.awaited(operand, node);

                self.record(node, type_id);

                type_id
            }

            N_IMPORT_EXPRESSION => {
                self.express_children(node);

                let type_id = self.promise_type(TYPE_UNKNOWN, node);

                self.record(node, type_id);

                type_id
            }

            N_TS_AS_EXPRESSION | N_TS_SATISFIES_EXPRESSION => {
                let inner = self.express(ast.field(node, NODE_A));
                let type_id = if ast.kind(node) == N_TS_AS_EXPRESSION {
                    self.convert(ast.field(node, NODE_B))
                } else {
                    inner
                };

                self.record(node, type_id);

                type_id
            }

            N_TS_TYPE_ASSERTION => {
                self.express(ast.field(node, NODE_B));

                let type_id = self.convert(ast.field(node, NODE_A));

                self.record(node, type_id);

                type_id
            }

            N_TS_NON_NULL_EXPRESSION => {
                let inner = self.express(ast.field(node, NODE_A));
                let type_id = self.non_nullable(inner);

                self.record(node, type_id);

                type_id
            }

            N_TS_INSTANTIATION_EXPRESSION => {
                let type_id = self.express(ast.field(node, NODE_A));

                self.record(node, type_id);

                type_id
            }

            N_VARIABLE_DECLARATION => {
                self.express_declaration(node);

                TYPE_NONE
            }

            N_TS_INTERFACE_DECLARATION | N_TS_TYPE_ALIAS_DECLARATION | N_TS_ENUM_DECLARATION => {
                TYPE_NONE
            }

            // Type-context subtrees a generic descent would otherwise walk
            // into: annotations, generic parameter lists, type arguments,
            // and heritage clauses. Everything inside them is a type, not a
            // value — `convert()` records the type nodes where a
            // declaration asks for them — and an identifier inside them
            // names a type, so the value rules must not read it as an
            // expression: `MapSource` in a return annotation is the
            // instance, not the function that constructs it.
            N_TS_TYPE_ANNOTATION
            | N_TS_TYPE_PARAMETER_DECLARATION
            | N_TS_TYPE_PARAMETER_INSTANTIATION
            | N_TS_CLASS_IMPLEMENTS
            | N_TS_INTERFACE_HERITAGE => TYPE_NONE,

            // A type-only export names types, not values: the `Stack` in
            // `export type { Stack }` means the declared type — the class
            // instance — not the constructor the value rules would read.
            // The same flag on one specifier is `export { type Stack }`.
            N_EXPORT_NAMED_DECLARATION => {
                if (ast.flags(node) & NF_TYPE_ONLY) == 0 {
                    self.express_children(node);
                }

                TYPE_NONE
            }

            N_EXPORT_SPECIFIER => {
                if (ast.flags(node) & NF_TYPE_ONLY) == 0 {
                    self.express_children(node);
                }

                TYPE_NONE
            }

            // A module's name is a name, not an expression: the `"*.css"`
            // in `declare module "*.css"` is never a string value at
            // runtime. The body is ordinary code.
            N_TS_MODULE_DECLARATION => {
                let body = ast.field(node, NODE_B);

                if body != 0 {
                    self.express(body);
                }

                TYPE_NONE
            }

            // Class and pattern members: a non-computed key is a name, not
            // an expression — the `"a"` in `class C { "a"() {} }` is never
            // a string value at runtime — so only a computed key is
            // expressed, along with every other child.
            N_PROPERTY
            | N_METHOD_DEFINITION
            | N_PROPERTY_DEFINITION
            | N_ACCESSOR_PROPERTY
            | N_TS_ABSTRACT_METHOD_DEFINITION
            | N_TS_ABSTRACT_PROPERTY_DEFINITION
            | N_TS_ABSTRACT_ACCESSOR_PROPERTY => {
                let key = ast.field(node, NODE_A);
                let computed = (ast.flags(node) & NF_COMPUTED) != 0;

                self.express_children_except(node, if computed { 0 } else { key });

                TYPE_NONE
            }

            _ => {
                self.express_children(node);

                TYPE_NONE
            }
        }
    }

    /// Types an identifier read through its resolved symbol.
    fn express_identifier(&mut self, node: u32) -> u32 {
        let symbol = self.resolved_symbol(node, RF_VALUE);

        if symbol == -1 {
            return TYPE_NONE;
        }

        let type_id = self.builder.symbol_type(symbol as u32);

        self.record(node, type_id);

        type_id
    }

    /// Types an array literal as `Array<union of its widened elements>`.
    fn express_array(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let list = ast.field(node, NODE_A);
        let size = ast.raw_list_size(list);
        let mut parts: Vec<u32> = Vec::new();
        let mut unknown = size == 0;

        for i in 0..size {
            let element = ast.raw_list_item(list, i);

            if element == 0 {
                continue;
            }

            if ast.kind(element) == N_SPREAD_ELEMENT {
                let spread = self.express(ast.field(element, NODE_A));
                let shape = if spread == TYPE_NONE {
                    0
                } else {
                    self.builder.type_field(spread, TY_SHAPE)
                };

                if (shape & TYS_ARRAY) != 0
                    && self
                        .builder
                        .pool_count(self.builder.type_field(spread, TY_DATA0))
                        > 0
                {
                    let pool = self.builder.type_field(spread, TY_DATA0);
                    let item = self.builder.pool_item(pool, 0);

                    parts.push(item);
                } else {
                    unknown = true;
                }

                continue;
            }

            let type_id = self.express(element);

            if type_id == TYPE_NONE {
                unknown = true;
            } else {
                let widened = self.widen(type_id);

                parts.push(widened);
            }
        }

        let element = if unknown {
            TYPE_UNKNOWN
        } else {
            self.union(&parts, 0)
        };
        let type_id = self.array_type(element, node);

        self.record(node, type_id);

        type_id
    }

    /// Types an object literal as an anonymous object.
    fn express_object(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let list = ast.field(node, NODE_A);
        let size = ast.raw_list_size(list);
        let mut entries: Vec<MemberEntry> = Vec::new();
        let mut inexact = false;

        for i in 0..size {
            let property = ast.raw_list_item(list, i);

            if ast.kind(property) != N_PROPERTY {
                // A spread: whatever it adds is not in the member list.
                self.express_children(property);
                inexact = true;
                continue;
            }

            let flags = ast.flags(property);
            let value = ast.field(property, NODE_B);

            if (flags & NF_COMPUTED) != 0 {
                self.express(ast.field(property, NODE_A));
                self.express(value);
                inexact = true;
                continue;
            }

            let method_kind = (flags & MKIND_MASK) >> MKIND_SHIFT;
            let value_type = self.express(value);
            let name = self.member_name(ast.field(property, NODE_A));

            if method_kind == MKIND_GET || method_kind == MKIND_SET {
                // The value is a function expression, so it always typed.
                entries.push(self.accessor_entry(name, value_type, method_kind, 0));
                continue;
            }

            let widened = self.widen(value_type);

            entries.push(MemberEntry {
                name,
                type_id: widened,
                flags: if (flags & NF_METHOD) != 0 { TMF_METHOD } else { 0 },
            });
        }

        let (first, count) = self.write_members(&entries);
        let handle = self.handle(node);
        let type_id = self.builder.add_type(
            TYF_OBJECT,
            TYS_ANONYMOUS | if inexact { TYS_INEXACT } else { 0 },
            0,
            0,
            0,
            first,
            count,
            handle,
        );

        self.record(node, type_id);

        type_id
    }

    /// Types a unary operator by its fixed result.
    fn express_unary(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let operand = self.express(ast.field(node, NODE_A));
        let operator = ast.field(node, NODE_B);

        let type_id = match operator {
            T_NOT => TYPE_BOOLEAN,
            T_TYPEOF => TYPE_STRING,
            T_VOID => TYPE_UNDEFINED,
            T_DELETE => TYPE_BOOLEAN,
            // `+x` coerces to a number; a bigint operand throws instead.
            T_PLUS => TYPE_NUMBER,
            T_MINUS | T_TILDE => self.numeric_result(operand, TYPE_NONE),
            _ => TYPE_NONE,
        };

        self.record(node, type_id);

        type_id
    }

    /// `bigint` when the operand is bigint-like, `number` when known.
    fn numeric_result(&self, operand: u32, fallback: u32) -> u32 {
        if operand == TYPE_NONE {
            return fallback;
        }

        if (self.builder.type_field(operand, TY_FLAGS) & TYF_BIGINT_LIKE) != 0 {
            TYPE_BIGINT
        } else {
            TYPE_NUMBER
        }
    }

    /// Types a binary operator by its fixed result.
    fn express_binary(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let left = self.express(ast.field(node, NODE_A));
        let right = self.express(ast.field(node, NODE_B));
        let operator = ast.field(node, NODE_C);
        let type_id = self.binary_result(operator, left, right);

        self.record(node, type_id);

        type_id
    }

    /// The result type of a binary operator over two operand types.
    fn binary_result(&self, operator: u32, left: u32, right: u32) -> u32 {
        // Comparisons, `in`, and `instanceof` always produce a boolean.
        if (T_EQ_EQ..=T_GT_EQ).contains(&operator)
            || operator == T_IN
            || operator == T_INSTANCEOF
        {
            return TYPE_BOOLEAN;
        }

        let left_flags = if left == TYPE_NONE {
            0
        } else {
            self.builder.type_field(left, TY_FLAGS)
        };
        let right_flags = if right == TYPE_NONE {
            0
        } else {
            self.builder.type_field(right, TY_FLAGS)
        };

        if operator == T_PLUS {
            if ((left_flags | right_flags) & TYF_STRING_LIKE) != 0 {
                return TYPE_STRING;
            }

            if left == TYPE_NONE || right == TYPE_NONE {
                return TYPE_NONE;
            }

            return if ((left_flags | right_flags) & TYF_BIGINT_LIKE) != 0 {
                TYPE_BIGINT
            } else {
                TYPE_NUMBER
            };
        }

        // The remaining arithmetic never concatenates, but two untyped
        // operands could still both be bigints.
        if left == TYPE_NONE && right == TYPE_NONE {
            return TYPE_NONE;
        }

        if ((left_flags | right_flags) & TYF_BIGINT_LIKE) != 0 {
            TYPE_BIGINT
        } else {
            TYPE_NUMBER
        }
    }

    /// The result type of a compound assignment.
    fn compound_result(&self, node: u32, right: u32) -> u32 {
        let operator = self.ast.field(node, NODE_C);

        // `&&=`, `||=`, and `??=` assign the right operand or keep the
        // target, so only a typed target answers.
        if (T_ASSIGN_AMPAMP..=T_ASSIGN_QQ).contains(&operator) {
            return TYPE_NONE;
        }

        if operator == T_ASSIGN_PLUS {
            return self.binary_result(T_PLUS, TYPE_NONE, right);
        }

        self.numeric_result(right, TYPE_NONE)
    }

    /// Types a call through its callee's declared return type.
    fn express_call(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let callee = self.express(ast.field(node, NODE_A));
        let args = ast.field(node, NODE_B);
        let size = ast.raw_list_size(args);

        for i in 0..size {
            self.express(ast.raw_list_item(args, i));
        }

        let mut type_id = TYPE_NONE;

        if callee != TYPE_NONE {
            let shape = self.builder.type_field(callee, TY_SHAPE);

            if (shape & TYS_FUNCTION) != 0 && (shape & TYS_CONSTRUCTOR) == 0 {
                type_id = self.builder.type_field(callee, TY_DATA1);
            }
        }

        if type_id != TYPE_NONE && (ast.flags(node) & NF_OPTIONAL) != 0 {
            type_id = self.union(&[type_id, TYPE_UNDEFINED], node);
        }

        self.record(node, type_id);

        type_id
    }

    /// Types `new` through the constructed instance type.
    fn express_new(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let callee_node = ast.field(node, NODE_A);
        let callee = self.express(callee_node);
        let args = ast.field(node, NODE_B);
        let size = ast.raw_list_size(args);

        for i in 0..size {
            self.express(ast.raw_list_item(args, i));
        }

        let mut type_id = TYPE_NONE;

        if callee != TYPE_NONE {
            let shape = self.builder.type_field(callee, TY_SHAPE);

            if (shape & TYS_CONSTRUCTOR) != 0 {
                type_id = self.builder.type_field(callee, TY_DATA1);
            }
        }

        // `new Map()` with no local `Map`: the standard library's.
        if type_id == TYPE_NONE
            && ast.kind(callee_node) == N_IDENTIFIER
            && self.is_unresolved(callee_node)
        {
            let name_units = ast.name(callee_node);

            if is_well_known_lib_type(&name_units) {
                let args_node = ast.field(node, NODE_C);
                let mut arg_ids: Vec<u32> = Vec::new();

                if args_node != 0 {
                    let list = ast.field(args_node, NODE_A);
                    let list_size = ast.raw_list_size(list);

                    for i in 0..list_size {
                        let item = ast.raw_list_item(list, i);

                        arg_ids.push(self.convert(item));
                    }
                }

                let symbol = {
                    let name_id = self.builder.intern(&name_units);

                    self.builder.intern_symbol(name_id, TYO_LIB, 0, 0, 0)
                };
                let shape = TYS_REFERENCE
                    | if is_ascii_name(&name_units, "Array")
                        || is_ascii_name(&name_units, "ReadonlyArray")
                    {
                        TYS_ARRAY
                    } else {
                        0
                    };

                type_id = if arg_ids.is_empty() {
                    self.builder
                        .intern_type(TYF_OBJECT, shape, symbol + 1, 0, 0)
                } else {
                    let pool = self.builder.pool_list(&arg_ids);
                    let handle = self.handle(node);

                    self.builder
                        .add_type(TYF_OBJECT, shape, symbol + 1, pool, 0, 0, 0, handle)
                };
            }
        }

        self.record(node, type_id);

        type_id
    }

    /// Types a member access.
    fn express_member(&mut self, node: u32) -> u32 {
        let ast = self.ast;
        let object = self.express(ast.field(node, NODE_A));
        let property = ast.field(node, NODE_B);
        let flags = ast.flags(node);
        let mut type_id = TYPE_NONE;

        if (flags & NF_COMPUTED) != 0 {
            let index = self.express(property);

            if object != TYPE_NONE {
                let shape = self.builder.type_field(object, TY_SHAPE);

                if (shape & TYS_TUPLE) != 0
                    && index != TYPE_NONE
                    && (self.builder.type_field(index, TY_FLAGS) & TYF_NUMBER_LITERAL) != 0
                {
                    let pool = self.builder.type_field(object, TY_DATA0);
                    let at = self.numeric_literal_value(index);

                    if at >= 0 && (at as u32) < self.builder.pool_count(pool) {
                        type_id = self.builder.pool_item(pool, at as u32);
                    }
                } else if (shape & TYS_ARRAY) != 0 {
                    let pool = self.builder.type_field(object, TY_DATA0);

                    if self.builder.pool_count(pool) > 0 {
                        type_id = self.builder.pool_item(pool, 0);
                    }
                }
            }
        } else if object != TYPE_NONE {
            let name = ast.name(property);

            type_id = self.member_type(object, &name, MEMBER_LOOKUP_DEPTH);
        }

        if type_id != TYPE_NONE && (flags & NF_OPTIONAL) != 0 {
            type_id = self.union(&[type_id, TYPE_UNDEFINED], node);
        }

        self.record(node, type_id);

        type_id
    }

    /// The integer a number-literal type spells, or `-1`.
    fn numeric_literal_value(&self, type_id: u32) -> i64 {
        let text = self
            .builder
            .string_at(self.builder.type_field(type_id, TY_DATA0));
        let mut value: i64 = 0;

        for &unit in text {
            if !(48..=57).contains(&unit) {
                return -1;
            }

            value = value * 10 + i64::from(unit - 48);

            if value > 0xffff {
                return -1;
            }
        }

        if text.is_empty() {
            -1
        } else {
            value
        }
    }

    /// Types the declarators of a declaration.
    fn express_declaration(&mut self, node: u32) {
        let ast = self.ast;
        let decl_kind = (ast.flags(node) & DECL_MASK) >> DECL_SHIFT;
        let is_const =
            decl_kind == DECL_CONST || decl_kind == DECL_USING || decl_kind == DECL_AWAIT_USING;
        let list = ast.field(node, NODE_A);
        let size = ast.raw_list_size(list);

        for i in 0..size {
            let declarator = ast.raw_list_item(list, i);

            if ast.kind(declarator) != N_VARIABLE_DECLARATOR {
                continue;
            }

            let id = ast.field(declarator, NODE_A);
            let init = ast.field(declarator, NODE_B);
            let init_type = if init == 0 {
                TYPE_NONE
            } else {
                self.express(init)
            };

            if ast.kind(id) != N_IDENTIFIER {
                continue;
            }

            let symbol = self.declared_symbol(id);

            if symbol == -1 {
                continue;
            }

            if self.builder.symbol_type(symbol as u32) == TYPE_NONE && init_type != TYPE_NONE {
                let stored = if is_const {
                    init_type
                } else {
                    self.widen(init_type)
                };
                let value_flags =
                    self.builder.type_field(stored, TY_FLAGS) & !(TYF_UNION | TYF_INTERSECTION);

                // `let x = null` is an evolving binding: the checker types
                // it by its later assignments, which one pass over the
                // syntax cannot see, so claiming the initializer's nullish
                // type at every use would be wrong the moment anything is
                // assigned. A mutable nullish-initialized binding stays
                // untyped.
                if is_const || value_flags == 0 || (value_flags & !TYF_NULLISH) != 0 {
                    self.builder.set_symbol_type(symbol as u32, stored);
                }
            }

            let final_type = self.builder.symbol_type(symbol as u32);

            self.record(id, final_type);
        }
    }
}

/// Whether UTF-16 code units spell an ASCII name.
fn is_ascii_name(units: &[u16], name: &str) -> bool {
    units.len() == name.len()
        && name
            .bytes()
            .zip(units.iter())
            .all(|(byte, &unit)| u16::from(byte) == unit)
}

/// One word of a scope symbol record.
#[inline]
fn scope_symbol_field(scope_words: &[u32], symbol: u32, field: usize) -> u32 {
    let base = scope_words[SCOPE_H_SYMBOLS_BASE] as usize;

    scope_words[base + symbol as usize * SYMBOL_WORDS + field]
}

/// One word of a scope definition record.
#[inline]
fn scope_definition_field(scope_words: &[u32], definition: u32, field: usize) -> u32 {
    let base = scope_words[SCOPE_H_DEFINITIONS_BASE] as usize;

    scope_words[base + definition as usize * DEFINITION_WORDS + field]
}

/// How many items a scope pool list holds.
#[inline]
fn scope_list_count(scope_words: &[u32], handle: u32) -> u32 {
    if handle == 0 {
        0
    } else {
        scope_words[scope_words[SCOPE_H_POOL_BASE] as usize + handle as usize]
    }
}

/// One item of a scope pool list.
#[inline]
fn scope_list_item(scope_words: &[u32], handle: u32, index: u32) -> u32 {
    scope_words[scope_words[SCOPE_H_POOL_BASE] as usize + handle as usize + 1 + index as usize]
}

/// A string from the scope buffer's table, as UTF-16 code units.
fn scope_string(scope_words: &[u32], id: u32) -> Vec<u16> {
    let strings_base = scope_words[SCOPE_H_STRINGS_BASE] as usize;
    let count = scope_words[SCOPE_H_STRING_COUNT] as usize;
    let start = scope_words[strings_base + id as usize] as usize;
    let end = scope_words[strings_base + id as usize + 1] as usize;
    let data_base = (strings_base + count + 1) * 4;
    let mut bytes: Vec<u8> = Vec::with_capacity(end - start);

    for at in start..end {
        let byte_index = data_base + at;

        bytes.push(((scope_words[byte_index / 4] >> ((byte_index % 4) * 8)) & 0xff) as u8);
    }

    String::from_utf8_lossy(&bytes).encode_utf16().collect()
}
