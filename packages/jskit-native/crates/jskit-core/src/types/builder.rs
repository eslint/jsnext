//! The type table in binary form: recording and emission.
//!
//! Port of `packages/jskit/src/types/types-builder.ts`. The node-type index
//! is sorted by `(handle, type)` and deduplicated, which makes the result
//! independent of the sort algorithm; everything else is emitted in the
//! exact order the TypeScript emitter produces.

use std::collections::HashMap;

use super::buffer::*;

/// Records types, members, and symbols as the walk discovers them, and
/// compacts them into a type buffer.
pub struct TypesBuilder {
    /// Type records, `TYPE_WORDS` words each.
    types: Vec<u32>,

    /// Member records, `MEMBER_WORDS` words each, in creation order.
    members: Vec<u32>,

    /// Symbol records, `TYPE_SYMBOL_WORDS` words each.
    symbols: Vec<u32>,

    /// The list pool: `[count, items...]` runs. Word 0 is a padding word.
    pool: Vec<u32>,

    /// `(node handle, type ID)` pairs in visit order.
    node_types: Vec<u32>,

    /// Interned strings, in first-use order, as UTF-16 code units.
    strings: Vec<Vec<u16>>,

    /// String to its interned ID, keyed by code units so that two distinct
    /// strings whose lossy encodings collide still get distinct IDs, the
    /// way JavaScript string keys behave.
    string_ids: HashMap<Vec<u16>, u32>,

    /// Intern key of a member-less type to its ID.
    type_ids: HashMap<(u32, u32, u32, u32, u32), u32>,

    /// Intern key of a symbol to its ID.
    symbol_ids: HashMap<(u32, u32, u32, u32, u32), u32>,

    /// The value type of each scope symbol, `TYPE_NONE` when unknown.
    symbol_types: Vec<u32>,

    /// The declared type of each scope symbol, `TYPE_NONE` for none.
    declared_types: Vec<u32>,
}

impl TypesBuilder {
    /// Creates a builder and pins the intrinsic type records.
    pub fn new(scope_symbol_count: usize) -> Self {
        let mut builder = TypesBuilder {
            types: Vec::with_capacity(256),
            members: Vec::with_capacity(128),
            symbols: Vec::with_capacity(64),
            // Pool handle 0 must mean "empty list".
            pool: vec![0],
            node_types: Vec::with_capacity(1024),
            strings: Vec::new(),
            string_ids: HashMap::new(),
            type_ids: HashMap::new(),
            symbol_ids: HashMap::new(),
            symbol_types: vec![0; scope_symbol_count],
            declared_types: vec![0; scope_symbol_count],
        };

        // The intrinsics, in `TYPE_*` order; interning first pins their IDs.
        builder.intern_type(0, 0, 0, 0, 0);
        builder.intern_type(TYF_ANY, 0, 0, 0, 0);
        builder.intern_type(TYF_UNKNOWN, 0, 0, 0, 0);
        builder.intern_type(TYF_NEVER, 0, 0, 0, 0);
        builder.intern_type(TYF_VOID, 0, 0, 0, 0);
        builder.intern_type(TYF_UNDEFINED, 0, 0, 0, 0);
        builder.intern_type(TYF_NULL, 0, 0, 0, 0);
        builder.intern_type(TYF_STRING, 0, 0, 0, 0);
        builder.intern_type(TYF_NUMBER, 0, 0, 0, 0);
        builder.intern_type(TYF_BIGINT, 0, 0, 0, 0);
        builder.intern_type(TYF_BOOLEAN, 0, 0, 0, 0);
        builder.intern_type(TYF_SYMBOL, 0, 0, 0, 0);
        builder.intern_type(TYF_NON_PRIMITIVE, 0, 0, 0, 0);
        builder.intern_type(TYF_BOOLEAN_LITERAL, 0, 0, 1, 0);
        builder.intern_type(TYF_BOOLEAN_LITERAL, 0, 0, 0, 0);

        builder
    }

    /// How many types exist so far.
    #[inline]
    pub fn type_count(&self) -> u32 {
        (self.types.len() / TYPE_WORDS) as u32
    }

    /// How many members exist so far.
    #[inline]
    pub fn member_count(&self) -> u32 {
        (self.members.len() / MEMBER_WORDS) as u32
    }

    //-------------------------------------------------------------------------
    // Strings
    //-------------------------------------------------------------------------

    /// Interns a string given as UTF-16 code units.
    pub fn intern(&mut self, value: &[u16]) -> u32 {
        if let Some(&id) = self.string_ids.get(value) {
            return id;
        }

        let id = self.strings.len() as u32;

        self.string_ids.insert(value.to_vec(), id);
        self.strings.push(value.to_vec());

        id
    }

    /// Interns an ASCII string.
    pub fn intern_ascii(&mut self, value: &str) -> u32 {
        let units: Vec<u16> = value.bytes().map(u16::from).collect();

        self.intern(&units)
    }

    /// The ID a string was interned under, without interning it.
    pub fn string_id(&self, value: &[u16]) -> i64 {
        match self.string_ids.get(value) {
            Some(&id) => i64::from(id),
            None => -1,
        }
    }

    /// The ID an ASCII string was interned under, without interning it.
    pub fn string_id_ascii(&self, value: &str) -> i64 {
        let units: Vec<u16> = value.bytes().map(u16::from).collect();

        self.string_id(&units)
    }

    /// The code units of a string already interned.
    pub fn string_at(&self, id: u32) -> &[u16] {
        &self.strings[id as usize]
    }

    //-------------------------------------------------------------------------
    // Types
    //-------------------------------------------------------------------------

    /// Interns a type with no members and no source node.
    pub fn intern_type(
        &mut self,
        flags: u32,
        shape: u32,
        symbol: u32,
        data0: u32,
        data1: u32,
    ) -> u32 {
        let key = (flags, shape, symbol, data0, data1);

        if let Some(&id) = self.type_ids.get(&key) {
            return id;
        }

        let id = self.add_type(flags, shape, symbol, data0, data1, 0, 0, 0);

        self.type_ids.insert(key, id);

        id
    }

    /// Appends a type record.
    #[allow(clippy::too_many_arguments)]
    pub fn add_type(
        &mut self,
        flags: u32,
        shape: u32,
        symbol: u32,
        data0: u32,
        data1: u32,
        member_first: u32,
        member_count: u32,
        node: u32,
    ) -> u32 {
        let id = self.type_count();
        let base = self.types.len();

        self.types.resize(base + TYPE_WORDS, 0);
        self.types[base + TY_FLAGS] = flags;
        self.types[base + TY_SHAPE] = shape;
        self.types[base + TY_SYMBOL] = symbol;
        self.types[base + TY_DATA0] = data0;
        self.types[base + TY_DATA1] = data1;
        self.types[base + TY_MEMBER_FIRST] = member_first;
        self.types[base + TY_MEMBER_COUNT] = member_count;
        self.types[base + TY_NODE] = node;

        id
    }

    /// Reads a field back from a type already recorded.
    #[inline]
    pub fn type_field(&self, type_id: u32, field: usize) -> u32 {
        self.types[type_id as usize * TYPE_WORDS + field]
    }

    /// Rewrites a field of a type already recorded.
    pub fn patch_type(&mut self, type_id: u32, field: usize, value: u32) {
        self.types[type_id as usize * TYPE_WORDS + field] = value;
    }

    /// Appends a member record.
    pub fn add_member(&mut self, name: u32, type_id: u32, flags: u32) -> u32 {
        let id = self.member_count();
        let base = self.members.len();

        self.members.resize(base + MEMBER_WORDS, 0);
        self.members[base + TM_NAME] = name;
        self.members[base + TM_TYPE] = type_id;
        self.members[base + TM_FLAGS] = flags;

        id
    }

    /// Reads a field back from a member already recorded.
    #[inline]
    pub fn member_field(&self, member: u32, field: usize) -> u32 {
        self.members[member as usize * MEMBER_WORDS + field]
    }

    //-------------------------------------------------------------------------
    // Symbols
    //-------------------------------------------------------------------------

    /// Interns a symbol, reusing the ID of an identical one.
    pub fn intern_symbol(
        &mut self,
        name: u32,
        origin: u32,
        specifier: u32,
        decl: u32,
        target: u32,
    ) -> u32 {
        let key = (name, origin, specifier, decl, target);

        if let Some(&id) = self.symbol_ids.get(&key) {
            return id;
        }

        let id = (self.symbols.len() / TYPE_SYMBOL_WORDS) as u32;
        let base = self.symbols.len();

        self.symbols.resize(base + TYPE_SYMBOL_WORDS, 0);
        self.symbols[base + SY_NAME] = name;
        self.symbols[base + SY_ORIGIN] = origin;
        self.symbols[base + SY_SPECIFIER] = specifier;
        self.symbols[base + SY_DECL] = decl;
        self.symbols[base + SY_TARGET] = target;
        self.symbol_ids.insert(key, id);

        id
    }

    /// Reads a field back from a symbol already recorded.
    #[inline]
    pub fn symbol_field(&self, symbol: u32, field: usize) -> u32 {
        self.symbols[symbol as usize * TYPE_SYMBOL_WORDS + field]
    }

    //-------------------------------------------------------------------------
    // Lists and lookups
    //-------------------------------------------------------------------------

    /// Stores a list in the pool.
    pub fn pool_list(&mut self, items: &[u32]) -> u32 {
        if items.is_empty() {
            return 0;
        }

        let handle = self.pool.len() as u32;

        self.pool.push(items.len() as u32);
        self.pool.extend_from_slice(items);

        handle
    }

    /// How many items a pooled list holds.
    #[inline]
    pub fn pool_count(&self, handle: u32) -> u32 {
        if handle == 0 {
            0
        } else {
            self.pool[handle as usize]
        }
    }

    /// One item of a pooled list.
    #[inline]
    pub fn pool_item(&self, handle: u32, index: u32) -> u32 {
        self.pool[handle as usize + 1 + index as usize]
    }

    /// Records the type of a node.
    pub fn add_node_type(&mut self, node: u32, type_id: u32) {
        self.node_types.push(node);
        self.node_types.push(type_id);
    }

    /// Records the type of a scope symbol's value, keeping the first answer.
    pub fn set_symbol_type(&mut self, symbol: u32, type_id: u32) {
        if self.symbol_types[symbol as usize] == 0 {
            self.symbol_types[symbol as usize] = type_id;
        }
    }

    /// The recorded value type of a scope symbol.
    #[inline]
    pub fn symbol_type(&self, symbol: u32) -> u32 {
        self.symbol_types[symbol as usize]
    }

    /// Records the type a scope symbol declares, keeping the first answer.
    pub fn set_declared_type(&mut self, symbol: u32, type_id: u32) {
        if self.declared_types[symbol as usize] == 0 {
            self.declared_types[symbol as usize] = type_id;
        }
    }

    /// The recorded declared type of a scope symbol.
    #[inline]
    pub fn declared_type(&self, symbol: u32) -> u32 {
        self.declared_types[symbol as usize]
    }

    //-------------------------------------------------------------------------
    // Emission
    //-------------------------------------------------------------------------

    /// Compacts everything recorded into one type buffer.
    pub fn finish(&mut self) -> Vec<u8> {
        let type_count = self.types.len() / TYPE_WORDS;
        let member_count = self.members.len() / MEMBER_WORDS;
        let symbol_count = self.symbols.len() / TYPE_SYMBOL_WORDS;
        let pool_words = self.pool.len();
        let scope_symbol_count = self.symbol_types.len();

        // Sort the node-type index by `(handle, type)` and deduplicate.
        {
            let mut as_pairs: Vec<(u32, u32)> = self
                .node_types
                .chunks_exact(2)
                .map(|chunk| (chunk[0], chunk[1]))
                .collect();

            as_pairs.sort_unstable();
            as_pairs.dedup();
            self.node_types.clear();

            for (node, type_id) in as_pairs {
                self.node_types.push(node);
                self.node_types.push(type_id);
            }
        }

        let pair_count = self.node_types.len() / 2;

        let encoded: Vec<Vec<u8>> = self
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

        let types_base = TYPES_HEADER_WORDS;
        let members_base = types_base + type_count * TYPE_WORDS;
        let pool_base = members_base + member_count * MEMBER_WORDS;
        let symbols_base = pool_base + pool_words;
        let symbol_types_base = symbols_base + symbol_count * TYPE_SYMBOL_WORDS;
        let declared_types_base = symbol_types_base + scope_symbol_count;
        let node_type_base = declared_types_base + scope_symbol_count;
        let strings_base = node_type_base + pair_count * NODE_TYPE_WORDS;
        let string_data_base = strings_base + string_offsets.len();
        let total_words = string_data_base + byte_length.div_ceil(4) as usize;

        let mut out = vec![0u32; total_words];

        out[TYPES_H_MAGIC] = TYPES_BUFFER_MAGIC;
        out[TYPES_H_VERSION] = TYPES_BUFFER_VERSION;
        out[TYPES_H_FLAGS] = 0;
        out[TYPES_H_TYPE_COUNT] = type_count as u32;
        out[TYPES_H_MEMBER_COUNT] = member_count as u32;
        out[TYPES_H_SYMBOL_COUNT] = symbol_count as u32;
        out[TYPES_H_TYPES_BASE] = types_base as u32;
        out[TYPES_H_MEMBERS_BASE] = members_base as u32;
        out[TYPES_H_POOL_BASE] = pool_base as u32;
        out[TYPES_H_SYMBOLS_BASE] = symbols_base as u32;
        out[TYPES_H_SYMBOL_TYPES_BASE] = symbol_types_base as u32;
        out[TYPES_H_SYMBOL_TYPES_COUNT] = scope_symbol_count as u32;
        out[TYPES_H_DECLARED_TYPES_BASE] = declared_types_base as u32;
        out[TYPES_H_NODE_TYPE_BASE] = node_type_base as u32;
        out[TYPES_H_NODE_TYPE_COUNT] = pair_count as u32;
        out[TYPES_H_STRINGS_BASE] = strings_base as u32;
        out[TYPES_H_STRING_COUNT] = self.strings.len() as u32;
        out[TYPES_H_STRING_BYTES] = byte_length;
        out[TYPES_H_IMPORTS_BASE] = 0;
        out[TYPES_H_IMPORT_COUNT] = 0;

        out[types_base..types_base + self.types.len()].copy_from_slice(&self.types);
        out[members_base..members_base + self.members.len()].copy_from_slice(&self.members);
        out[pool_base..pool_base + pool_words].copy_from_slice(&self.pool);
        out[symbols_base..symbols_base + self.symbols.len()].copy_from_slice(&self.symbols);
        out[symbol_types_base..symbol_types_base + scope_symbol_count]
            .copy_from_slice(&self.symbol_types);
        out[declared_types_base..declared_types_base + scope_symbol_count]
            .copy_from_slice(&self.declared_types);
        out[node_type_base..node_type_base + self.node_types.len()]
            .copy_from_slice(&self.node_types);
        out[strings_base..strings_base + string_offsets.len()].copy_from_slice(&string_offsets);

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
