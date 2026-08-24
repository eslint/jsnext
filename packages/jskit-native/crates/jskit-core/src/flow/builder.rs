//! The graph in binary form: recording and emission.
//!
//! Port of `packages/jskit/src/flow/flow-builder.ts`. The node-block index is
//! sorted by `(handle, block)` and deduplicated, which makes the result
//! independent of the sort algorithm; everything else is copied in the exact
//! order the TypeScript emitter produces.

use super::buffer::*;

/// How many words a write occupies while being built; the block leads.
const BUILD_WRITE_WORDS: usize = WRITE_WORDS + 1;

/// Records blocks, edges, writes, and graphs as the walk discovers them, and
/// compacts them into a flow buffer.
pub struct FlowBuilder {
    /// Per-block words: flags, then owning graph ID.
    blocks: Vec<u32>,

    /// Edge records in creation order, `EDGE_WORDS` words each.
    edges: Vec<u32>,

    /// Write records in creation order, block first, then the format words.
    writes: Vec<u32>,

    /// Graph records, `GRAPH_WORDS` words each.
    graphs: Vec<u32>,

    /// The list pool: `[count, items...]` runs. Word 0 is a padding word.
    pool: Vec<u32>,

    /// `(node handle, block ID)` pairs in visit order.
    node_blocks: Vec<u32>,

    /// The graph currently being built, or `-1` between graphs.
    open_graph: i32,
}

impl FlowBuilder {
    /// Creates an empty builder.
    pub fn new() -> Self {
        FlowBuilder {
            blocks: Vec::with_capacity(256),
            edges: Vec::with_capacity(512),
            writes: Vec::with_capacity(256),
            graphs: Vec::with_capacity(64),
            // Pool handle 0 must mean "empty list".
            pool: vec![0],
            node_blocks: Vec::with_capacity(1024),
            open_graph: -1,
        }
    }

    /// How many blocks exist so far.
    #[inline]
    pub fn block_count(&self) -> u32 {
        (self.blocks.len() / 2) as u32
    }

    //-------------------------------------------------------------------------
    // Graphs
    //-------------------------------------------------------------------------

    /// Opens a new graph. Every block created until `end_graph()` belongs to
    /// it.
    pub fn begin_graph(&mut self, origin: u32, node: u32, upper: i32) -> u32 {
        let id = (self.graphs.len() / GRAPH_WORDS) as u32;
        let base = self.graphs.len();

        self.graphs.resize(base + GRAPH_WORDS, 0);
        self.graphs[base + G_ORIGIN] = origin;
        self.graphs[base + G_NODE] = node;
        self.graphs[base + G_UPPER] = (upper + 1) as u32;
        self.graphs[base + G_FIRST_BLOCK] = self.block_count();
        self.open_graph = id as i32;

        id
    }

    /// Closes the open graph.
    pub fn end_graph(&mut self, initial: u32, implicit: u32, returned: &[u32], thrown: &[u32]) {
        let returned_handle = self.pool_list(returned);
        let thrown_handle = self.pool_list(thrown);
        let base = self.open_graph as usize * GRAPH_WORDS;

        self.graphs[base + G_INITIAL] = initial;
        self.graphs[base + G_BLOCK_COUNT] = self.block_count() - self.graphs[base + G_FIRST_BLOCK];
        self.graphs[base + G_RETURNED] = returned_handle;
        self.graphs[base + G_THROWN] = thrown_handle;
        self.graphs[base + G_IMPLICIT] = implicit + 1;
        self.open_graph = -1;
    }

    /// Stores a list in the pool; `0` for an empty list.
    fn pool_list(&mut self, items: &[u32]) -> u32 {
        if items.is_empty() {
            return 0;
        }

        let handle = self.pool.len() as u32;

        self.pool.push(items.len() as u32);
        self.pool.extend_from_slice(items);

        handle
    }

    //-------------------------------------------------------------------------
    // Blocks and edges
    //-------------------------------------------------------------------------

    /// Creates a block in the open graph. It starts unreachable.
    pub fn new_block(&mut self) -> u32 {
        let id = self.block_count();

        self.blocks.push(0);
        self.blocks.push(self.open_graph as u32);

        id
    }

    /// Marks a block reachable without an edge, for graph entry blocks.
    pub fn seed_reachable(&mut self, block: u32) {
        self.blocks[block as usize * 2] |= BF_REACHABLE;
    }

    /// Adds flags to a block.
    pub fn add_block_flags(&mut self, block: u32, flags: u32) {
        self.blocks[block as usize * 2] |= flags;
    }

    /// Whether control can reach a block, as known so far.
    pub fn is_reachable(&self, block: u32) -> bool {
        (self.blocks[block as usize * 2] & BF_REACHABLE) != 0
    }

    /// Records an edge and propagates reachability across it.
    pub fn add_edge(&mut self, from: u32, to: u32, flags: u32, cond: u32) {
        self.edges.push(from);
        self.edges.push(to);
        self.edges.push(flags);
        self.edges.push(cond);

        if (self.blocks[from as usize * 2] & BF_REACHABLE) != 0 {
            self.blocks[to as usize * 2] |= BF_REACHABLE;
        }

        if (flags & EF_BACK) != 0 {
            self.blocks[to as usize * 2] |= BF_LOOP_HEAD;
        }
    }

    //-------------------------------------------------------------------------
    // Writes and membership
    //-------------------------------------------------------------------------

    /// Records a variable or member write in a block.
    pub fn add_write(&mut self, block: u32, reference: u32, target: u32, expr: u32, flags: u32) {
        self.writes.push(block);
        self.writes.push(reference);
        self.writes.push(target);
        self.writes.push(expr);
        self.writes.push(flags);
    }

    /// Records which block a node executes in.
    pub fn add_node(&mut self, node: u32, block: u32) {
        self.node_blocks.push(node);
        self.node_blocks.push(block);
    }

    //-------------------------------------------------------------------------
    // Emission
    //-------------------------------------------------------------------------

    /// Compacts everything recorded into one flow buffer, as bytes.
    pub fn finish(&mut self) -> Vec<u8> {
        let graph_count = self.graphs.len() / GRAPH_WORDS;
        let block_count = self.block_count() as usize;
        let edge_count = self.edges.len() / EDGE_WORDS;
        let write_count = self.writes.len() / BUILD_WRITE_WORDS;
        let pool_words = self.pool.len();

        // Sort the node-block index by `(handle, block)` and deduplicate.
        {
            let pairs: &mut Vec<u32> = &mut self.node_blocks;
            let mut as_pairs: Vec<(u32, u32)> = pairs
                .chunks_exact(2)
                .map(|chunk| (chunk[0], chunk[1]))
                .collect();

            as_pairs.sort_unstable();
            as_pairs.dedup();
            pairs.clear();

            for (node, block) in as_pairs {
                pairs.push(node);
                pairs.push(block);
            }
        }

        let pair_count = self.node_blocks.len() / 2;

        let graphs_base = FLOW_HEADER_WORDS;
        let blocks_base = graphs_base + graph_count * GRAPH_WORDS;
        let edges_base = blocks_base + block_count * BLOCK_WORDS;
        let preds_base = edges_base + edge_count * EDGE_WORDS;
        let writes_base = preds_base + edge_count;
        let pool_base = writes_base + write_count * WRITE_WORDS;
        let node_block_base = pool_base + pool_words;
        let total_words = node_block_base + pair_count * 2;

        let mut out = vec![0u32; total_words];

        out[FLOW_H_MAGIC] = FLOW_BUFFER_MAGIC;
        out[FLOW_H_VERSION] = FLOW_BUFFER_VERSION;
        out[FLOW_H_FLAGS] = 0;
        out[FLOW_H_GRAPH_COUNT] = graph_count as u32;
        out[FLOW_H_BLOCK_COUNT] = block_count as u32;
        out[FLOW_H_EDGE_COUNT] = edge_count as u32;
        out[FLOW_H_WRITE_COUNT] = write_count as u32;
        out[FLOW_H_GRAPHS_BASE] = graphs_base as u32;
        out[FLOW_H_BLOCKS_BASE] = blocks_base as u32;
        out[FLOW_H_EDGES_BASE] = edges_base as u32;
        out[FLOW_H_PREDS_BASE] = preds_base as u32;
        out[FLOW_H_WRITES_BASE] = writes_base as u32;
        out[FLOW_H_POOL_BASE] = pool_base as u32;
        out[FLOW_H_NODE_BLOCK_BASE] = node_block_base as u32;
        out[FLOW_H_NODE_BLOCK_COUNT] = pair_count as u32;

        out[graphs_base..graphs_base + self.graphs.len()].copy_from_slice(&self.graphs);
        out[pool_base..pool_base + pool_words].copy_from_slice(&self.pool);

        // Block flags and owners; the range fields are filled in below.
        for i in 0..block_count {
            out[blocks_base + i * BLOCK_WORDS + B_FLAGS] = self.blocks[i * 2];
            out[blocks_base + i * BLOCK_WORDS + B_GRAPH] = self.blocks[i * 2 + 1];
        }

        self.emit_edges(&mut out, blocks_base, edges_base, preds_base, block_count);
        self.emit_writes(&mut out, blocks_base, writes_base, block_count);

        out[node_block_base..node_block_base + pair_count * 2]
            .copy_from_slice(&self.node_blocks);

        let mut buffer = Vec::with_capacity(total_words * 4);

        for word in &out {
            buffer.extend_from_slice(&word.to_le_bytes());
        }

        buffer
    }

    /// Emits the edge section grouped by source block and the predecessor
    /// section grouped by target block. Both groupings are stable.
    fn emit_edges(
        &self,
        out: &mut [u32],
        blocks_base: usize,
        edges_base: usize,
        preds_base: usize,
        block_count: usize,
    ) {
        let edge_count = self.edges.len() / EDGE_WORDS;
        let mut counts = vec![0u32; block_count];

        for i in 0..edge_count {
            counts[self.edges[i * EDGE_WORDS + E_FROM] as usize] += 1;
        }

        let mut running = 0u32;

        for b in 0..block_count {
            out[blocks_base + b * BLOCK_WORDS + B_SUCC_FIRST] = running;
            out[blocks_base + b * BLOCK_WORDS + B_SUCC_COUNT] = counts[b];
            running += counts[b];
            counts[b] = running - counts[b];
        }

        for i in 0..edge_count {
            let from = self.edges[i * EDGE_WORDS + E_FROM] as usize;
            let slot = counts[from] as usize;

            counts[from] += 1;

            let base = edges_base + slot * EDGE_WORDS;

            out[base + E_FROM] = self.edges[i * EDGE_WORDS + E_FROM];
            out[base + E_TO] = self.edges[i * EDGE_WORDS + E_TO];
            out[base + E_FLAGS] = self.edges[i * EDGE_WORDS + E_FLAGS];
            out[base + E_COND] = self.edges[i * EDGE_WORDS + E_COND];
        }

        // Now group the final edge IDs by target block.
        counts.fill(0);

        for i in 0..edge_count {
            counts[out[edges_base + i * EDGE_WORDS + E_TO] as usize] += 1;
        }

        running = 0;

        for b in 0..block_count {
            out[blocks_base + b * BLOCK_WORDS + B_PRED_FIRST] = running;
            out[blocks_base + b * BLOCK_WORDS + B_PRED_COUNT] = counts[b];
            running += counts[b];
            counts[b] = running - counts[b];
        }

        for i in 0..edge_count {
            let to = out[edges_base + i * EDGE_WORDS + E_TO] as usize;
            let slot = counts[to] as usize;

            counts[to] += 1;
            out[preds_base + slot] = i as u32;
        }
    }

    /// Emits the write section grouped by block. The grouping is stable, so a
    /// block's writes read back in execution order.
    fn emit_writes(
        &self,
        out: &mut [u32],
        blocks_base: usize,
        writes_base: usize,
        block_count: usize,
    ) {
        let write_count = self.writes.len() / BUILD_WRITE_WORDS;
        let mut counts = vec![0u32; block_count];

        for i in 0..write_count {
            counts[self.writes[i * BUILD_WRITE_WORDS] as usize] += 1;
        }

        let mut running = 0u32;

        for b in 0..block_count {
            out[blocks_base + b * BLOCK_WORDS + B_WRITE_FIRST] = running;
            out[blocks_base + b * BLOCK_WORDS + B_WRITE_COUNT] = counts[b];
            running += counts[b];
            counts[b] = running - counts[b];
        }

        for i in 0..write_count {
            let src = i * BUILD_WRITE_WORDS;
            let block = self.writes[src] as usize;
            let slot = counts[block] as usize;

            counts[block] += 1;

            let base = writes_base + slot * WRITE_WORDS;

            out[base + W_REF] = self.writes[src + 1 + W_REF];
            out[base + W_TARGET] = self.writes[src + 1 + W_TARGET];
            out[base + W_EXPR] = self.writes[src + 1 + W_EXPR];
            out[base + W_FLAGS] = self.writes[src + 1 + W_FLAGS];
        }
    }
}

impl Default for FlowBuilder {
    fn default() -> Self {
        FlowBuilder::new()
    }
}
