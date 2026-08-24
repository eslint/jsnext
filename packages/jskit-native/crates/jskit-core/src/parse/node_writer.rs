//! Allocation and mutation of binary AST node records.
//!
//! Port of `packages/jskit/src/parse/node-writer.ts`.

use super::binary::WordBuffer;
use super::node_kinds::{
    EMPTY_LIST, NODE_A, NODE_END, NODE_FLAGS, NODE_KIND, NODE_START, NODE_WORDS,
};

/// Writes node records and child lists into growable word buffers.
pub struct NodeWriter {
    /// Node records, `NODE_WORDS` words each.
    pub nodes: WordBuffer,

    /// Child index lists, each preceded by its length.
    pub lists: WordBuffer,

    /// Number of allocated nodes, including the reserved node at index 0.
    pub count: u32,

    /// Stack used to gather list elements before they are flushed.
    scratch: Vec<u32>,
}

/// A snapshot of the writer for `rewind()`.
#[derive(Clone, Copy)]
pub struct WriterMark {
    count: u32,
    list_length: usize,
    scratch_length: usize,
}

impl NodeWriter {
    /// Creates a writer sized for a source text of the given length.
    pub fn new(source_length: usize) -> Self {
        let mut writer = NodeWriter {
            nodes: WordBuffer::new((NODE_WORDS * 64).max((source_length >> 2) * NODE_WORDS)),
            lists: WordBuffer::new(256usize.max(source_length >> 3)),
            count: 1,
            scratch: Vec::with_capacity(1024),
        };

        // Reserve node 0 as the "no node" sentinel.
        writer.nodes.reserve(NODE_WORDS);

        // Reserve list handle 0 as the empty list.
        writer.lists.push(0);

        writer
    }

    /// Allocates a node record.
    #[inline]
    pub fn alloc(&mut self, kind: u32, start: u32) -> u32 {
        let index = self.count;

        self.count += 1;

        let base = self.nodes.reserve(NODE_WORDS);

        self.nodes.words[base + NODE_START] = start;
        self.nodes.words[base + NODE_KIND] = kind;

        index
    }

    /// Reads one word of a node record.
    #[inline]
    pub fn get(&self, index: u32, field: usize) -> u32 {
        self.nodes.words[index as usize * NODE_WORDS + field]
    }

    /// Writes one word of a node record.
    #[inline]
    pub fn set(&mut self, index: u32, field: usize, value: u32) {
        self.nodes.words[index as usize * NODE_WORDS + field] = value;
    }

    /// Adds bits to a node's flags word.
    #[inline]
    pub fn add_flags(&mut self, index: u32, bits: u32) {
        self.nodes.words[index as usize * NODE_WORDS + NODE_FLAGS] |= bits;
    }

    /// Records the end offset of a node.
    #[inline]
    pub fn finish(&mut self, index: u32, end: u32) -> u32 {
        self.nodes.words[index as usize * NODE_WORDS + NODE_END] = end;

        index
    }

    /// Abandons an already-allocated node, leaving an inert zeroed record.
    pub fn discard(&mut self, index: u32) {
        let base = index as usize * NODE_WORDS;

        self.nodes.words[base..base + NODE_WORDS].fill(0);
    }

    /// Changes the kind of an already-allocated node.
    #[inline]
    pub fn retype(&mut self, index: u32, kind: u32) {
        self.nodes.words[index as usize * NODE_WORDS + NODE_KIND] = kind;
    }

    //-------------------------------------------------------------------------
    // List Building
    //-------------------------------------------------------------------------

    /// Marks the start of a new list on the scratch stack.
    #[inline]
    pub fn start_list(&self) -> usize {
        self.scratch.len()
    }

    /// Appends an element to the list currently being built.
    #[inline]
    pub fn push_list(&mut self, node_index: u32) {
        self.scratch.push(node_index);
    }

    /// Number of elements pushed since a mark.
    #[inline]
    pub fn list_size(&self, mark: usize) -> usize {
        self.scratch.len() - mark
    }

    /// Flushes the gathered elements into the list region.
    pub fn end_list(&mut self, mark: usize) -> u32 {
        let size = self.scratch.len() - mark;

        if size == 0 {
            return EMPTY_LIST;
        }

        let handle = self.lists.reserve(size + 1);

        self.lists.words[handle] = size as u32;

        for i in 0..size {
            self.lists.words[handle + 1 + i] = self.scratch[mark + i];
        }

        self.scratch.truncate(mark);

        handle as u32
    }

    /// Splits a run of interleaved elements into two lists: the handles for
    /// the even-indexed and odd-indexed elements, in that order.
    pub fn end_interleaved_lists(&mut self, mark: usize) -> (u32, u32) {
        let total = self.scratch.len() - mark;
        let even_size = (total + 1) >> 1;
        let odd_size = total >> 1;

        let even_handle = self.reserve_list(even_size);
        let odd_handle = self.reserve_list(odd_size);

        for i in 0..total {
            let value = self.scratch[mark + i];

            if (i & 1) == 0 {
                self.lists.words[even_handle as usize + 1 + (i >> 1)] = value;
            } else {
                self.lists.words[odd_handle as usize + 1 + (i >> 1)] = value;
            }
        }

        self.scratch.truncate(mark);

        (even_handle, odd_handle)
    }

    /// Allocates room for a list of a known size.
    fn reserve_list(&mut self, size: usize) -> u32 {
        if size == 0 {
            return EMPTY_LIST;
        }

        let handle = self.lists.reserve(size + 1);

        self.lists.words[handle] = size as u32;

        handle as u32
    }

    /// Creates a one-element list without going through the scratch stack.
    pub fn singleton_list(&mut self, node_index: u32) -> u32 {
        let handle = self.lists.reserve(2);

        self.lists.words[handle] = 1;
        self.lists.words[handle + 1] = node_index;

        handle as u32
    }

    //-------------------------------------------------------------------------
    // Speculative Parsing Support
    //-------------------------------------------------------------------------

    /// Captures the writer's position so a speculative parse can be undone.
    pub fn mark(&self) -> WriterMark {
        WriterMark {
            count: self.count,
            list_length: self.lists.length,
            scratch_length: self.scratch.len(),
        }
    }

    /// Discards every node and list written since a mark.
    pub fn rewind(&mut self, snapshot: WriterMark) {
        let word_length = snapshot.count as usize * NODE_WORDS;

        // Node slots default to zero, so the abandoned region is cleared
        // before its indexes are handed out again.
        self.nodes.words[word_length..self.nodes.length].fill(0);
        self.nodes.length = word_length;
        self.count = snapshot.count;
        self.lists.length = snapshot.list_length;
        self.scratch.truncate(snapshot.scratch_length);
    }
}
