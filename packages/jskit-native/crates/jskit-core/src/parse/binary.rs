//! The binary parse buffer layout and its assembly.
//!
//! Port of `packages/jskit/src/parse/binary.ts`. The buffer this module
//! produces must be byte-identical to the one the TypeScript implementation
//! builds for the same source and options.

use super::node_kinds::{NODE_A, NODE_BYTES, NODE_KIND, NODE_WORDS};
use super::slots::{SLOT_DATA, SLOT_DESCRIPTORS, SLOT_LIST};

/// Magic number identifying a parse buffer: "JSPB" in little-endian ASCII.
pub const PARSE_MAGIC: u32 = 0x4250534a;

/// Format version of the parse buffer.
pub const PARSE_VERSION: u32 = 2;

/// Size of the parse buffer header in bytes.
pub const PARSE_HEADER_BYTES: u32 = 68;

pub const PARSE_HEADER_MAGIC: usize = 0;
pub const PARSE_HEADER_VERSION: usize = 1;
pub const PARSE_HEADER_FLAGS: usize = 2;
pub const PARSE_HEADER_ROOT: usize = 3;
pub const PARSE_HEADER_NODE_COUNT: usize = 4;
pub const PARSE_HEADER_NODE_BYTES: usize = 5;
pub const PARSE_HEADER_NODES_OFFSET: usize = 6;
pub const PARSE_HEADER_LIST_COUNT: usize = 7;
pub const PARSE_HEADER_LIST_OFFSET: usize = 8;
pub const PARSE_HEADER_TOKEN_COUNT: usize = 9;
pub const PARSE_HEADER_TOKEN_BYTES: usize = 10;
pub const PARSE_HEADER_TOKENS_OFFSET: usize = 11;
pub const PARSE_HEADER_LINE_COUNT: usize = 12;
pub const PARSE_HEADER_LINES_OFFSET: usize = 13;
pub const PARSE_HEADER_SOURCE_LENGTH: usize = 14;
pub const PARSE_HEADER_SOURCE_OFFSET: usize = 15;
pub const PARSE_HEADER_PARENTS_OFFSET: usize = 16;

pub const PARSE_FLAG_SOURCE_EMBEDDED: u32 = 1;
pub const PARSE_FLAG_PARENTS: u32 = 1 << 1;
pub const PARSE_FLAG_TOKENS: u32 = 1 << 4;

pub const PARSE_SOURCE_TYPE_SHIFT: u32 = 2;
pub const SOURCE_TYPE_MODULE: u32 = 0;
pub const SOURCE_TYPE_SCRIPT: u32 = 1;
pub const SOURCE_TYPE_COMMONJS: u32 = 2;

/// Size of one token record in bytes.
pub const TOKEN_BYTES: u32 = 16;

/// A line terminator appeared between this token and the previous one.
pub const TF_NEWLINE_BEFORE: u32 = 1 << 0;

/// The token's text contains at least one backslash escape sequence.
pub const TF_HAS_ESCAPE: u32 = 1 << 1;

/// The token contains an escape that is invalid outside a tagged template.
pub const TF_INVALID_ESCAPE: u32 = 1 << 2;

/// The token uses legacy octal syntax, which is banned in strict mode.
pub const TF_LEGACY_OCTAL: u32 = 1 << 3;

/// A growable array of 32-bit words.
///
/// Unlike `Vec::truncate`, shrinking `length` leaves the words beyond it in
/// place, which the tokenizer's peek cache relies on: a rolled-back record can
/// be reinstated by putting the length back, exactly as in the TypeScript
/// `WordBuffer`.
pub struct WordBuffer {
    /// The backing storage; grown by doubling, never shrunk.
    pub words: Vec<u32>,

    /// Number of words written so far.
    pub length: usize,
}

impl WordBuffer {
    pub fn new(initial_words: usize) -> Self {
        WordBuffer {
            words: vec![0; initial_words.max(1)],
            length: 0,
        }
    }

    /// Ensures `count` more words fit and returns the index to write at.
    #[inline]
    pub fn reserve(&mut self, count: usize) -> usize {
        let needed = self.length + count;

        if needed > self.words.len() {
            self.grow(needed);
        }

        let start = self.length;

        self.length = needed;

        start
    }

    fn grow(&mut self, needed: usize) {
        let mut capacity = self.words.len() * 2;

        while capacity < needed {
            capacity *= 2;
        }

        self.words.resize(capacity, 0);
    }

    /// Appends a single word.
    #[inline]
    pub fn push(&mut self, value: u32) -> usize {
        let index = self.reserve(1);

        self.words[index] = value;

        index
    }
}

/// Rounds a byte count up to the next multiple of four.
#[inline]
pub fn align_words(bytes: u32) -> u32 {
    (bytes + 3) & !3
}

/// Derives the parent of every node from the node and list regions.
pub fn fill_parent_table(
    parents: &mut [u32],
    nodes: &[u32],
    node_count: u32,
    lists: &[u32],
) {
    for node in 1..node_count as usize {
        let base = node * NODE_WORDS;
        let mut descriptors = SLOT_DESCRIPTORS[nodes[base + NODE_KIND] as usize];
        let mut word = base + NODE_A;

        while descriptors != 0 {
            let descriptor = (descriptors & 3) as u32;

            if descriptor != SLOT_DATA {
                let value = nodes[word] as usize;

                // Zero is the empty list and the absent child alike.
                if value != 0 {
                    if descriptor == SLOT_LIST {
                        let size = lists[value] as usize;

                        for i in 1..=size {
                            let child = lists[value + i] as usize;

                            // A zero element is an array hole, as in `[a, , b]`.
                            if child != 0 {
                                parents[child] = node as u32;
                            }
                        }
                    } else {
                        parents[value] = node as u32;
                    }
                }
            }

            word += 1;
            descriptors >>= 2;
        }
    }
}

/// Everything a parse produced, before it is laid out in one buffer.
pub struct ParseBufferInput<'a> {
    pub nodes: &'a WordBuffer,
    pub node_count: u32,
    pub lists: &'a WordBuffer,
    pub root: u32,
    pub tokens: &'a WordBuffer,
    pub token_count: u32,
    pub store_tokens: bool,
    pub line_starts: &'a [u32],
    pub line_count: u32,
    pub source: &'a [u16],
    pub embed_source: bool,
    pub parents: bool,
    pub source_type: u32,
}

/// Builds the single buffer a parse returns, as little-endian bytes.
pub fn build_parse_buffer(input: &ParseBufferInput) -> Vec<u8> {
    let nodes_bytes = input.node_count * NODE_BYTES;
    let parent_bytes = if input.parents { input.node_count * 4 } else { 0 };
    let list_bytes = (input.lists.length as u32) * 4;
    let token_bytes = if input.store_tokens {
        input.token_count * TOKEN_BYTES
    } else {
        0
    };
    let line_bytes = input.line_count * 4;
    let source_bytes = if input.embed_source {
        align_words((input.source.len() as u32) * 2)
    } else {
        0
    };

    let nodes_offset = PARSE_HEADER_BYTES;
    let parents_offset = nodes_offset + nodes_bytes;
    let list_offset = parents_offset + parent_bytes;
    let tokens_offset = list_offset + list_bytes;
    let lines_offset = tokens_offset + token_bytes;
    let source_offset = lines_offset + line_bytes;

    let total = (source_offset + source_bytes) as usize;
    let mut buffer = vec![0u8; total];

    let write_word = |buffer: &mut [u8], word_index: usize, value: u32| {
        let at = word_index * 4;

        buffer[at..at + 4].copy_from_slice(&value.to_le_bytes());
    };

    write_word(&mut buffer, PARSE_HEADER_MAGIC, PARSE_MAGIC);
    write_word(&mut buffer, PARSE_HEADER_VERSION, PARSE_VERSION);
    write_word(
        &mut buffer,
        PARSE_HEADER_FLAGS,
        (if input.embed_source { PARSE_FLAG_SOURCE_EMBEDDED } else { 0 })
            | (if input.parents { PARSE_FLAG_PARENTS } else { 0 })
            | (if input.store_tokens { PARSE_FLAG_TOKENS } else { 0 })
            | (input.source_type << PARSE_SOURCE_TYPE_SHIFT),
    );
    write_word(&mut buffer, PARSE_HEADER_ROOT, input.root);
    write_word(&mut buffer, PARSE_HEADER_NODE_COUNT, input.node_count);
    write_word(&mut buffer, PARSE_HEADER_NODE_BYTES, NODE_BYTES);
    write_word(&mut buffer, PARSE_HEADER_NODES_OFFSET, nodes_offset);
    write_word(&mut buffer, PARSE_HEADER_PARENTS_OFFSET, parents_offset);
    write_word(&mut buffer, PARSE_HEADER_LIST_COUNT, input.lists.length as u32);
    write_word(&mut buffer, PARSE_HEADER_LIST_OFFSET, list_offset);
    write_word(&mut buffer, PARSE_HEADER_TOKEN_COUNT, input.token_count);
    write_word(&mut buffer, PARSE_HEADER_TOKEN_BYTES, TOKEN_BYTES);
    write_word(&mut buffer, PARSE_HEADER_TOKENS_OFFSET, tokens_offset);
    write_word(&mut buffer, PARSE_HEADER_LINE_COUNT, input.line_count);
    write_word(&mut buffer, PARSE_HEADER_LINES_OFFSET, lines_offset);
    write_word(&mut buffer, PARSE_HEADER_SOURCE_LENGTH, input.source.len() as u32);
    write_word(&mut buffer, PARSE_HEADER_SOURCE_OFFSET, source_offset);

    let copy_words = |buffer: &mut [u8], byte_offset: u32, words: &[u32]| {
        let mut at = byte_offset as usize;

        for &word in words {
            buffer[at..at + 4].copy_from_slice(&word.to_le_bytes());
            at += 4;
        }
    };

    copy_words(
        &mut buffer,
        nodes_offset,
        &input.nodes.words[..(nodes_bytes / 4) as usize],
    );

    if input.parents {
        let mut parents = vec![0u32; input.node_count as usize];

        fill_parent_table(
            &mut parents,
            &input.nodes.words,
            input.node_count,
            &input.lists.words,
        );
        copy_words(&mut buffer, parents_offset, &parents);
    }

    copy_words(
        &mut buffer,
        list_offset,
        &input.lists.words[..input.lists.length],
    );

    if input.store_tokens {
        copy_words(
            &mut buffer,
            tokens_offset,
            &input.tokens.words[..(token_bytes / 4) as usize],
        );
    }

    copy_words(
        &mut buffer,
        lines_offset,
        &input.line_starts[..input.line_count as usize],
    );

    if input.embed_source {
        let mut at = source_offset as usize;

        for &unit in input.source {
            buffer[at..at + 2].copy_from_slice(&unit.to_le_bytes());
            at += 2;
        }
    }

    buffer
}
