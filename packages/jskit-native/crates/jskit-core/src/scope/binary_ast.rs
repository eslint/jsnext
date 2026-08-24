//! Reading a program out of the parser's binary buffers.
//!
//! Port of the binary path of `packages/jskit/src/scope/binary-ast.ts` plus
//! the slice of `parse/reader.ts` the walk needs. A node is its index into
//! the parse buffer's node region; `0` stands for "no node" exactly where the
//! TypeScript code passes `null`.

use crate::parse::binary::{
    PARSE_HEADER_LIST_OFFSET, PARSE_HEADER_NODES_OFFSET, PARSE_HEADER_NODE_BYTES,
    PARSE_HEADER_ROOT,
};
use crate::parse::node_kinds::{
    DECL_SHIFT, MKIND_SHIFT, MODULE_GLOBAL, NF_COMPUTED, NF_TYPE_ONLY, NODE_A, NODE_B, NODE_C,
    NODE_FLAGS, NODE_KIND, N_TS_PARAMETER_PROPERTY,
};
use crate::parse::token_kinds::T_ASSIGN;
use crate::parse::values::decode_escapes;

/// The declaration keyword codes, mirroring `DECL_KIND_NAMES` order.
pub const KIND_VAR: u32 = 0;

const DECL_MASK: u32 = 7 << DECL_SHIFT;
const MODULE_KIND_MASK: u32 = 7 << MKIND_SHIFT;

/// The declaration keyword spellings, indexed by the packed value.
pub const DECL_KIND_NAMES: [&str; 5] = ["var", "let", "const", "using", "await using"];

/// Reads a program out of a binary parse buffer.
pub struct BinaryAst<'a> {
    /// The whole parse buffer, viewed as words.
    words: &'a [u32],

    /// The source text, as UTF-16 code units.
    pub source: &'a [u16],

    /// Word index of the node region.
    pub nodes_base: usize,

    /// Word index of the list region.
    lists_base: usize,

    /// Words per node record.
    pub node_words: usize,

    /// The root node index.
    pub root: u32,
}

impl<'a> BinaryAst<'a> {
    /// Creates an accessor over a parse buffer's words.
    pub fn new(words: &'a [u32], source: &'a [u16]) -> Self {
        BinaryAst {
            words,
            source,
            nodes_base: (words[PARSE_HEADER_NODES_OFFSET] / 4) as usize,
            lists_base: (words[PARSE_HEADER_LIST_OFFSET] / 4) as usize,
            node_words: (words[PARSE_HEADER_NODE_BYTES] / 4) as usize,
            root: words[PARSE_HEADER_ROOT],
        }
    }

    /// The handle the binary path stores for a node: the byte offset of its
    /// record in the parse buffer.
    #[inline]
    pub fn handle_of(&self, node: u32) -> u32 {
        ((self.nodes_base + node as usize * self.node_words) * 4) as u32
    }

    /// One word of a node record, addressed the way `AstReader#field` is.
    #[inline]
    pub fn field(&self, node: u32, field: usize) -> u32 {
        self.word(node, field)
    }

    /// The number of elements in a list, by raw handle.
    #[inline]
    pub fn raw_list_size(&self, handle: u32) -> u32 {
        if handle == 0 {
            0
        } else {
            self.words[self.lists_base + handle as usize]
        }
    }

    /// One element of a list, by raw handle.
    #[inline]
    pub fn raw_list_item(&self, handle: u32, index: u32) -> u32 {
        self.words[self.lists_base + handle as usize + 1 + index as usize]
    }

    #[inline]
    fn word(&self, node: u32, field: usize) -> u32 {
        self.words[self.nodes_base + node as usize * self.node_words + field]
    }

    /// The node kind constant for a node.
    #[inline]
    pub fn kind(&self, node: u32) -> u32 {
        self.word(node, NODE_KIND)
    }

    /// The offset a node starts at.
    #[inline]
    pub fn start(&self, node: u32) -> u32 {
        self.word(node, 0)
    }

    /// The offset just past a node.
    #[inline]
    pub fn end(&self, node: u32) -> u32 {
        self.word(node, 1)
    }

    /// The node's flags word.
    #[inline]
    pub fn flags(&self, node: u32) -> u32 {
        self.word(node, NODE_FLAGS)
    }

    /// The child in a slot; `0` when the node has none there.
    #[inline]
    pub fn child(&self, node: u32, slot: usize) -> u32 {
        self.word(node, NODE_A + slot)
    }

    /// How many children a slot's list holds.
    #[inline]
    pub fn list_size(&self, node: u32, slot: usize) -> u32 {
        let handle = self.word(node, NODE_A + slot);

        if handle == 0 {
            0
        } else {
            self.words[self.lists_base + handle as usize]
        }
    }

    /// One element of a slot's list; `0` for an array hole.
    #[inline]
    pub fn list_item(&self, node: u32, slot: usize, index: u32) -> u32 {
        let handle = self.word(node, NODE_A + slot);

        self.words[self.lists_base + handle as usize + 1 + index as usize]
    }

    /// The name an identifier spells, as UTF-16 code units with any unicode
    /// escapes resolved. On an `Identifier` the name ends where slot A says;
    /// a `JSXIdentifier` leaves that slot empty and the whole node is it.
    pub fn name(&self, node: u32) -> Vec<u16> {
        let name_end = self.word(node, NODE_A);
        let end = if name_end == 0 { self.end(node) } else { name_end };
        let raw = &self.source[self.start(node) as usize..end as usize];

        if raw.contains(&(b'\\' as u16)) {
            decode_escapes(raw)
        } else {
            raw.to_vec()
        }
    }

    /// The string a literal denotes, with any escapes resolved.
    pub fn literal_string(&self, node: u32) -> Vec<u16> {
        let raw = &self.source[self.start(node) as usize + 1..self.end(node) as usize - 1];

        if raw.contains(&(b'\\' as u16)) {
            decode_escapes(raw)
        } else {
            raw.to_vec()
        }
    }

    /// The directive an `ExpressionStatement` states — the quoted text minus
    /// its quotes — or `None` for an ordinary expression.
    pub fn directive(&self, node: u32) -> Option<&'a [u16]> {
        if self.word(node, NODE_B) != 1 {
            return None;
        }

        // The prologue scan asks about statements of every kind, so slot B
        // being `1` does not prove slot A is a real literal. The TypeScript
        // code leans on `String.prototype.slice`'s clamping; reproduce it.
        let literal = self.word(node, NODE_A);
        let start = self.start(literal) as usize;
        let end = self.end(literal) as usize;

        if end < start + 2 {
            return Some(&[]);
        }

        Some(&self.source[start + 1..end - 1])
    }

    /// Whether a key or member is computed.
    #[inline]
    pub fn computed(&self, node: u32) -> bool {
        (self.flags(node) & NF_COMPUTED) != 0
    }

    /// Whether an import or export was written `type`.
    #[inline]
    pub fn type_only(&self, node: u32) -> bool {
        (self.flags(node) & NF_TYPE_ONLY) != 0
    }

    /// The packed declaration keyword code of a `VariableDeclaration`.
    #[inline]
    pub fn declaration_kind_code(&self, node: u32) -> u32 {
        (self.flags(node) & DECL_MASK) >> DECL_SHIFT
    }

    /// Whether a module declaration was written `global`.
    #[inline]
    pub fn is_global_module(&self, node: u32) -> bool {
        (self.flags(node) & MODULE_KIND_MASK) >> MKIND_SHIFT == MODULE_GLOBAL
    }

    /// Whether an assignment uses plain `=`.
    #[inline]
    pub fn is_simple_assignment(&self, node: u32) -> bool {
        self.word(node, NODE_C) == T_ASSIGN
    }

    /// Where a parameter's decorators sit: slot B on a parameter property,
    /// slot C on every other binding form.
    #[inline]
    fn parameter_decorator_slot(&self, node: u32) -> usize {
        if self.kind(node) == N_TS_PARAMETER_PROPERTY {
            1
        } else {
            2
        }
    }

    /// How many decorators a function parameter carries.
    pub fn parameter_decorator_size(&self, node: u32) -> u32 {
        self.list_size(node, self.parameter_decorator_slot(node))
    }

    /// One decorator of a function parameter; `0` when absent.
    pub fn parameter_decorator_at(&self, node: u32, index: u32) -> u32 {
        self.list_item(node, self.parameter_decorator_slot(node), index)
    }

    /// The name a mapped type binds, which is its key; `0` when absent.
    pub fn mapped_type_key(&self, node: u32) -> u32 {
        let type_parameter = self.word(node, NODE_A);

        if type_parameter == 0 {
            return 0;
        }

        self.word(type_parameter, NODE_A)
    }

    /// The constraint a mapped type's key ranges over; `0` when absent.
    pub fn mapped_type_constraint(&self, node: u32) -> u32 {
        let type_parameter = self.word(node, NODE_A);

        if type_parameter == 0 {
            return 0;
        }

        self.word(type_parameter, NODE_B)
    }
}
