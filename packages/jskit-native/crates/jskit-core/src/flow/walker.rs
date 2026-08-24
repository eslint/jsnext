//! The walk that turns a binary AST and a scope buffer into a control flow
//! graph.
//!
//! Port of `packages/jskit/src/flow/flow-walker.ts`.

use std::collections::HashMap;

use crate::parse::node_kinds::*;
use crate::parse::slots::{SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE};
use crate::parse::token_kinds::{
    T_AMPAMP, T_ASSIGN, T_ASSIGN_AMPAMP, T_ASSIGN_PIPEPIPE, T_ASSIGN_QQ, T_NOT, T_PIPEPIPE,
};
use crate::scope::binary_ast::BinaryAst;
use crate::scope::buffer::{
    REFERENCE_WORDS, RF_INIT, RF_WRITE, R_FLAGS, R_IDENTIFIER, R_WRITE_EXPR,
    SCOPE_H_REFERENCES_BASE, SCOPE_H_REFERENCE_COUNT,
};
use super::buffer::*;
use super::builder::FlowBuilder;

/// One past the largest JavaScript node kind; TypeScript kinds start here.
const TS_FIRST: u32 = 100;

const CTX_LOOP: u8 = 0;
const CTX_BREAKABLE: u8 = 1;
const CTX_LABEL: u8 = 2;
const CTX_TRY: u8 = 3;

const PHASE_TRY: u8 = 0;
const PHASE_CATCH: u8 = 1;
const PHASE_FINALLY: u8 = 2;

/// A jump that must run a `finally` before reaching its target.
#[derive(Clone, Copy)]
struct PendingJump {
    target: u32,
    context_index: usize,
    flags: u32,
}

/// One enclosing construct a jump or throw can interact with.
struct FlowContext {
    kind: u8,
    break_target: i64,
    continue_target: i64,
    back_target: i64,
    labels: Option<Vec<u32>>,
    phase: u8,
    has_finally: bool,
    finally_entry: i64,
    pending_jumps: Vec<PendingJump>,
    pending_return: bool,
}

impl FlowContext {
    fn new(kind: u8) -> Self {
        FlowContext {
            kind,
            break_target: -1,
            continue_target: -1,
            back_target: -1,
            labels: None,
            phase: PHASE_TRY,
            has_finally: false,
            finally_entry: -1,
            pending_jumps: Vec::new(),
            pending_return: false,
        }
    }
}

/// A nested graph discovered by the walk, built after the current one.
struct GraphTask {
    node: u32,
    origin: u32,
    upper: i32,
}

/// Builds every graph in a program, one walk per execution unit.
pub struct FlowWalker<'a, 'b> {
    reader: &'b BinaryAst<'a>,
    scope_words: &'b [u32],
    builder: &'b mut FlowBuilder,
    write_refs: HashMap<u32, u32>,
    references_base: u32,
    tasks: std::collections::VecDeque<GraphTask>,
    contexts: Vec<FlowContext>,
    pending_labels: Vec<u32>,
    current: u32,
    graph: i32,
    returned: Vec<u32>,
    thrown: Vec<u32>,
    write_flags: u32,
}

impl<'a, 'b> FlowWalker<'a, 'b> {
    /// Creates a walker over one program.
    pub fn new(
        reader: &'b BinaryAst<'a>,
        scope_words: &'b [u32],
        builder: &'b mut FlowBuilder,
    ) -> Self {
        let references_base = scope_words[SCOPE_H_REFERENCES_BASE];
        let reference_count = scope_words[SCOPE_H_REFERENCE_COUNT];
        let mut write_refs = HashMap::new();

        // Every write the program performs on a variable already exists as a
        // reference record keyed by the written identifier's handle.
        for reference in 0..reference_count {
            let base = references_base as usize + reference as usize * REFERENCE_WORDS;

            if (scope_words[base + R_FLAGS] & RF_WRITE) != 0 {
                write_refs.insert(scope_words[base + R_IDENTIFIER], reference);
            }
        }

        FlowWalker {
            reader,
            scope_words,
            builder,
            write_refs,
            references_base,
            tasks: std::collections::VecDeque::new(),
            contexts: Vec::new(),
            pending_labels: Vec::new(),
            current: 0,
            graph: 0,
            returned: Vec::new(),
            thrown: Vec::new(),
            write_flags: 0,
        }
    }

    #[inline]
    fn reference_field(&self, reference: u32, field: usize) -> u32 {
        self.scope_words[self.references_base as usize + reference as usize * REFERENCE_WORDS + field]
    }

    /// Builds the program graph and every nested graph it queues.
    pub fn build(&mut self) {
        self.tasks.push_back(GraphTask {
            node: self.reader.root,
            origin: ORIGIN_PROGRAM,
            upper: -1,
        });

        while let Some(task) = self.tasks.pop_front() {
            self.build_graph(task);
        }
    }

    /// Builds one graph from entry to exit.
    fn build_graph(&mut self, task: GraphTask) {
        let node = task.node;

        self.graph = self
            .builder
            .begin_graph(task.origin, self.reader.handle_of(node), task.upper)
            as i32;
        self.returned = Vec::new();
        self.thrown = Vec::new();

        let entry = self.builder.new_block();

        self.builder.seed_reachable(entry);
        self.current = entry;
        self.record(node);

        if task.origin == ORIGIN_FUNCTION {
            // Parameters run first: patterns bind, defaults evaluate.
            let params = self.reader.field(node, NODE_B);
            let param_count = self.reader.raw_list_size(params);

            for i in 0..param_count {
                let param = self.reader.raw_list_item(params, i);

                self.maybe_visit(param);
            }

            let body = self.reader.field(node, NODE_C);

            if body != 0 {
                self.maybe_visit(body);
            }
        } else if task.origin == ORIGIN_CLASS_FIELD_INITIALIZER {
            // The graph's node is the field's value expression.
            self.maybe_visit(node);
        } else {
            // A Program or a static block: a statement list either way.
            self.visit_list(self.reader.field(node, NODE_A));
        }

        let implicit = self.current;

        if self.builder.is_reachable(implicit) {
            self.returned.push(implicit);
        }

        let returned = std::mem::take(&mut self.returned);
        let thrown = std::mem::take(&mut self.thrown);

        self.builder.end_graph(entry, implicit, &returned, &thrown);
    }

    //-------------------------------------------------------------------------
    // Small helpers
    //-------------------------------------------------------------------------

    /// Records which block a node executes in.
    fn record(&mut self, node: u32) {
        self.builder.add_node(self.reader.handle_of(node), self.current);
    }

    /// The handle of a node.
    #[inline]
    fn handle(&self, node: u32) -> u32 {
        self.reader.handle_of(node)
    }

    /// Ends the current block after a jump or exit.
    fn terminate(&mut self) {
        self.current = self.builder.new_block();
    }

    /// Visits every node in a list, by raw handle.
    fn visit_list(&mut self, handle: u32) {
        let count = self.reader.raw_list_size(handle);

        for i in 0..count {
            let item = self.reader.raw_list_item(handle, i);

            if item != 0 {
                self.maybe_visit(item);
            }
        }
    }

    /// Visits a node, routing TypeScript kinds to the type-aware dispatcher.
    fn maybe_visit(&mut self, node: u32) {
        let kind = self.reader.kind(node);

        if kind >= TS_FIRST {
            self.visit_ts(node, kind);
        } else {
            self.visit(node, kind);
        }
    }

    /// Whether an identifier node spells the same name as another.
    fn same_name(&self, a: u32, b: u32) -> bool {
        let reader = self.reader;
        let a_start = reader.start(a) as usize;
        let a_end = reader.field(a, NODE_A) as usize;
        let b_start = reader.start(b) as usize;
        let b_end = reader.field(b, NODE_A) as usize;

        if a_end - a_start != b_end - b_start {
            return false;
        }

        reader.source[a_start..a_end] == reader.source[b_start..b_end]
    }

    //-------------------------------------------------------------------------
    // Jump routing
    //-------------------------------------------------------------------------

    /// Routes a jump to its target, detouring through every `finally` that
    /// must run first.
    fn route_jump(&mut self, target: u32, context_index: usize, flags: u32) {
        for i in (context_index + 1..self.contexts.len()).rev() {
            let is_detour = {
                let ctx = &self.contexts[i];

                ctx.kind == CTX_TRY && ctx.has_finally && ctx.phase != PHASE_FINALLY
            };

            if is_detour {
                let finally_entry = self.contexts[i].finally_entry as u32;

                self.builder
                    .add_edge(self.current, finally_entry, EK_ABRUPT, 0);

                let pending = &mut self.contexts[i].pending_jumps;

                for jump in pending.iter() {
                    if jump.target == target {
                        return;
                    }
                }

                pending.push(PendingJump {
                    target,
                    context_index,
                    flags,
                });

                return;
            }
        }

        self.builder
            .add_edge(self.current, target, EK_NORMAL | flags, 0);
    }

    /// Routes a `return`, detouring through every `finally` that must run
    /// first.
    fn route_return(&mut self) {
        for i in (0..self.contexts.len()).rev() {
            let is_detour = {
                let ctx = &self.contexts[i];

                ctx.kind == CTX_TRY && ctx.has_finally && ctx.phase != PHASE_FINALLY
            };

            if is_detour {
                let finally_entry = self.contexts[i].finally_entry as u32;

                self.builder
                    .add_edge(self.current, finally_entry, EK_ABRUPT, 0);
                self.contexts[i].pending_return = true;

                return;
            }
        }

        self.returned.push(self.current);
    }

    /// Whether an exception raised at the current position is routed by an
    /// enclosing `try` in this graph.
    fn is_protected(&self) -> bool {
        for ctx in self.contexts.iter().rev() {
            if ctx.kind != CTX_TRY {
                continue;
            }

            if ctx.phase == PHASE_TRY {
                return true;
            }

            if ctx.phase == PHASE_CATCH && ctx.has_finally {
                return true;
            }

            // A throw inside catch or finally keeps propagating outward.
        }

        false
    }

    //-------------------------------------------------------------------------
    // Writes
    //-------------------------------------------------------------------------

    /// Records the write an identifier performs, when it performs one.
    fn maybe_write(&mut self, handle: u32) {
        let Some(&reference) = self.write_refs.get(&handle) else {
            return;
        };

        let flags = if (self.reference_field(reference, R_FLAGS) & RF_INIT) != 0 {
            WF_INIT | self.write_flags
        } else {
            self.write_flags
        };

        self.builder.add_write(
            self.current,
            (self.references_base + reference * REFERENCE_WORDS as u32) * 4,
            handle,
            self.reference_field(reference, R_WRITE_EXPR),
            flags,
        );
    }

    /// Walks an assignment target, recording writes for member expressions.
    fn visit_target(&mut self, node: u32, expr: u32, flags: u32) {
        let reader = self.reader;
        let mut node = node;
        let mut kind = reader.kind(node);

        // Unwrap `(a as T).b = c`, `a!.b = c`, and `(<T>a).b = c`.
        loop {
            if kind == N_TS_AS_EXPRESSION
                || kind == N_TS_SATISFIES_EXPRESSION
                || kind == N_TS_NON_NULL_EXPRESSION
            {
                self.record(node);
                node = reader.field(node, NODE_A);
            } else if kind == N_TS_TYPE_ASSERTION {
                self.record(node);
                node = reader.field(node, NODE_B);
            } else {
                break;
            }

            kind = reader.kind(node);
        }

        match kind {
            k if k == N_MEMBER_EXPRESSION => {
                self.record(node);
                self.maybe_visit(reader.field(node, NODE_A));

                if (reader.flags(node) & NF_COMPUTED) != 0 {
                    self.maybe_visit(reader.field(node, NODE_B));
                }

                self.builder.add_write(
                    self.current,
                    0,
                    self.handle(node),
                    expr,
                    WF_MEMBER | flags,
                );
            }
            k if k == N_ARRAY_PATTERN => {
                self.record(node);

                let elements = reader.field(node, NODE_A);
                let count = reader.raw_list_size(elements);

                for i in 0..count {
                    let element = reader.raw_list_item(elements, i);

                    if element != 0 {
                        self.visit_target(element, expr, flags);
                    }
                }
            }
            k if k == N_OBJECT_PATTERN => {
                self.record(node);

                let properties = reader.field(node, NODE_A);
                let count = reader.raw_list_size(properties);

                for i in 0..count {
                    let property = reader.raw_list_item(properties, i);

                    if reader.kind(property) == N_PROPERTY {
                        self.record(property);

                        if (reader.flags(property) & NF_COMPUTED) != 0 {
                            self.maybe_visit(reader.field(property, NODE_A));
                        }

                        self.visit_target(reader.field(property, NODE_B), expr, flags);
                    } else {
                        // A rest element.
                        self.visit_target(property, expr, flags);
                    }
                }
            }
            k if k == N_ASSIGNMENT_PATTERN => {
                self.record(node);
                self.maybe_visit(reader.field(node, NODE_B));
                self.visit_target(reader.field(node, NODE_A), expr, flags);
            }
            k if k == N_REST_ELEMENT => {
                self.record(node);
                self.visit_target(reader.field(node, NODE_A), expr, flags);
            }
            _ => {
                self.maybe_visit(node);
            }
        }
    }

    //-------------------------------------------------------------------------
    // Conditions
    //-------------------------------------------------------------------------

    /// Whether a node is a literal with a fixed truthiness: `1` for
    /// constant-true, `0` for constant-false, `-1` neither.
    fn folded_truth(&self, node: u32) -> i32 {
        let reader = self.reader;

        if reader.kind(node) != N_LITERAL {
            return -1;
        }

        // A literal's subtype lives in slot A.
        let subtype = reader.field(node, NODE_A);

        if subtype == LIT_BOOLEAN {
            // `true` is four characters long; `false` is five.
            return if reader.end(node) - reader.start(node) == 4 {
                1
            } else {
                0
            };
        }

        if subtype == LIT_NULL {
            return 0;
        }

        -1
    }

    /// Compiles an expression as a branch condition, distributing `&&`,
    /// `||`, `!`, and nested conditionals.
    fn visit_condition(
        &mut self,
        node: u32,
        true_target: u32,
        false_target: u32,
        true_flags: u32,
        false_flags: u32,
    ) {
        let reader = self.reader;
        let kind = reader.kind(node);

        if kind == N_LOGICAL_EXPRESSION {
            let operator = reader.field(node, NODE_C);

            if operator == T_AMPAMP {
                self.record(node);

                let mid = self.builder.new_block();

                self.visit_condition(reader.field(node, NODE_A), mid, false_target, 0, false_flags);
                self.current = mid;
                self.visit_condition(
                    reader.field(node, NODE_B),
                    true_target,
                    false_target,
                    true_flags,
                    false_flags,
                );

                return;
            }

            if operator == T_PIPEPIPE {
                self.record(node);

                let mid = self.builder.new_block();

                self.visit_condition(reader.field(node, NODE_A), true_target, mid, true_flags, 0);
                self.current = mid;
                self.visit_condition(
                    reader.field(node, NODE_B),
                    true_target,
                    false_target,
                    true_flags,
                    false_flags,
                );

                return;
            }

            // `??` keeps its value semantics; fall through to the default.
        } else if kind == N_UNARY_EXPRESSION {
            if reader.field(node, NODE_B) == T_NOT {
                self.record(node);
                self.visit_condition(
                    reader.field(node, NODE_A),
                    false_target,
                    true_target,
                    false_flags,
                    true_flags,
                );

                return;
            }
        } else if kind == N_CONDITIONAL_EXPRESSION {
            self.record(node);

            let then_block = self.builder.new_block();
            let else_block = self.builder.new_block();

            self.visit_condition(reader.field(node, NODE_A), then_block, else_block, 0, 0);
            self.current = then_block;
            self.visit_condition(
                reader.field(node, NODE_B),
                true_target,
                false_target,
                true_flags,
                false_flags,
            );
            self.current = else_block;
            self.visit_condition(
                reader.field(node, NODE_C),
                true_target,
                false_target,
                true_flags,
                false_flags,
            );

            return;
        } else if kind == N_SEQUENCE_EXPRESSION {
            self.record(node);

            let expressions = reader.field(node, NODE_A);
            let count = reader.raw_list_size(expressions);

            for i in 0..count.saturating_sub(1) {
                let item = reader.raw_list_item(expressions, i);

                self.maybe_visit(item);
            }

            let last = reader.raw_list_item(expressions, count - 1);

            self.visit_condition(last, true_target, false_target, true_flags, false_flags);

            return;
        }

        let truth = self.folded_truth(node);

        if truth >= 0 {
            // A constant condition takes exactly one direction.
            self.record(node);
            self.builder.add_edge(
                self.current,
                if truth == 1 { true_target } else { false_target },
                if truth == 1 {
                    EK_TRUE | true_flags
                } else {
                    EK_FALSE | false_flags
                },
                self.handle(node),
            );

            return;
        }

        self.maybe_visit(node);

        let handle = self.handle(node);

        self.builder
            .add_edge(self.current, true_target, EK_TRUE | true_flags, handle);
        self.builder
            .add_edge(self.current, false_target, EK_FALSE | false_flags, handle);
    }

    //-------------------------------------------------------------------------
    // Dispatch
    //-------------------------------------------------------------------------

    /// Visits one JavaScript-kind node in the current block.
    fn visit(&mut self, node: u32, kind: u32) {
        let reader = self.reader;

        self.record(node);

        match kind {
            k if k == N_IDENTIFIER => {
                self.maybe_write(self.handle(node));
            }
            k if k == N_PROPERTY => {
                // A shorthand property's key and value are the same
                // identifier; walking both slots would record it twice.
                if (reader.flags(node) & NF_SHORTHAND) == 0 {
                    self.maybe_visit(reader.field(node, NODE_A));
                }

                self.maybe_visit(reader.field(node, NODE_B));
            }
            k if k == N_IF_STATEMENT => self.visit_if(node),
            k if k == N_LOGICAL_EXPRESSION => self.visit_logical(node),
            k if k == N_CONDITIONAL_EXPRESSION => {
                let then_block = self.builder.new_block();
                let else_block = self.builder.new_block();
                let join = self.builder.new_block();

                self.visit_condition(reader.field(node, NODE_A), then_block, else_block, 0, 0);
                self.current = then_block;
                self.maybe_visit(reader.field(node, NODE_B));
                self.builder.add_edge(self.current, join, EK_NORMAL, 0);
                self.current = else_block;
                self.maybe_visit(reader.field(node, NODE_C));
                self.builder.add_edge(self.current, join, EK_NORMAL, 0);
                self.current = join;
            }
            k if k == N_ASSIGNMENT_EXPRESSION => self.visit_assignment(node),
            k if k == N_UPDATE_EXPRESSION => self.visit_update(node),
            k if k == N_VARIABLE_DECLARATOR => {
                let init = reader.field(node, NODE_B);

                if init != 0 {
                    self.maybe_visit(init);
                }

                // The id comes second: the value exists before the binding.
                self.maybe_visit(reader.field(node, NODE_A));
            }
            k if k == N_WHILE_STATEMENT => self.visit_while(node),
            k if k == N_DO_WHILE_STATEMENT => self.visit_do_while(node),
            k if k == N_FOR_STATEMENT => self.visit_for(node),
            k if k == N_FOR_IN_STATEMENT || k == N_FOR_OF_STATEMENT => self.visit_for_each(node),
            k if k == N_SWITCH_STATEMENT => self.visit_switch(node),
            k if k == N_TRY_STATEMENT => self.visit_try(node),
            k if k == N_LABELED_STATEMENT => self.visit_labeled(node),
            k if k == N_BREAK_STATEMENT => self.visit_break(node),
            k if k == N_CONTINUE_STATEMENT => self.visit_continue(node),
            k if k == N_RETURN_STATEMENT => {
                let argument = reader.field(node, NODE_A);

                if argument != 0 {
                    self.maybe_visit(argument);
                }

                self.builder.add_block_flags(self.current, BF_RETURNS);
                self.route_return();
                self.terminate();
            }
            k if k == N_THROW_STATEMENT => {
                self.maybe_visit(reader.field(node, NODE_A));
                self.builder.add_block_flags(self.current, BF_THROWS);

                if !self.is_protected() {
                    self.thrown.push(self.current);
                }

                self.terminate();
            }
            k if k == N_AWAIT_EXPRESSION || k == N_YIELD_EXPRESSION => {
                let argument = reader.field(node, NODE_A);

                if argument != 0 {
                    self.maybe_visit(argument);
                }

                let resumed = self.builder.new_block();

                self.builder
                    .add_edge(self.current, resumed, EK_RESUME, self.handle(node));
                self.current = resumed;
            }
            k if k == N_CHAIN_EXPRESSION => {
                let join = self.builder.new_block();

                self.visit_chain_step(reader.field(node, NODE_A), join);
                self.builder.add_edge(self.current, join, EK_NORMAL, 0);
                self.current = join;
            }
            k if k == N_FUNCTION_DECLARATION
                || k == N_FUNCTION_EXPRESSION
                || k == N_ARROW_FUNCTION_EXPRESSION =>
            {
                self.tasks.push_back(GraphTask {
                    node,
                    origin: ORIGIN_FUNCTION,
                    upper: self.graph,
                });
            }
            k if k == N_CLASS_DECLARATION || k == N_CLASS_EXPRESSION => self.visit_class(node),
            _ => self.visit_children(node, kind),
        }
    }

    /// Visits a node's children generically, in slot order.
    fn visit_children(&mut self, node: u32, kind: u32) {
        let reader = self.reader;
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let descriptor = SLOT_TABLE[base + slot] as u32;

            if descriptor == SLOT_NODE {
                let child = reader.field(node, NODE_A + slot);

                if child != 0 {
                    self.maybe_visit(child);
                }
            } else if descriptor == SLOT_LIST {
                self.visit_list(reader.field(node, NODE_A + slot));
            }
        }
    }

    /// Visits the TypeScript kinds that contain runtime code, and skips the
    /// rest — type positions have no control flow.
    fn visit_ts(&mut self, node: u32, kind: u32) {
        let reader = self.reader;

        match kind {
            k if k == N_TS_AS_EXPRESSION
                || k == N_TS_SATISFIES_EXPRESSION
                || k == N_TS_NON_NULL_EXPRESSION
                || k == N_TS_INSTANTIATION_EXPRESSION
                || k == N_TS_EXPORT_ASSIGNMENT =>
            {
                self.record(node);
                self.maybe_visit(reader.field(node, NODE_A));
            }
            k if k == N_TS_TYPE_ASSERTION => {
                self.record(node);
                self.maybe_visit(reader.field(node, NODE_B));
            }
            k if k == N_TS_PARAMETER_PROPERTY => {
                self.record(node);
                self.maybe_visit(reader.field(node, NODE_A));
            }
            k if k == N_TS_MODULE_DECLARATION => {
                let body = reader.field(node, NODE_B);

                if body != 0 {
                    self.record(node);
                    self.visit_ts(body, reader.kind(body));
                }
            }
            k if k == N_TS_MODULE_BLOCK => {
                self.record(node);
                self.visit_list(reader.field(node, NODE_A));
            }
            k if k == N_TS_ENUM_DECLARATION => {
                self.record(node);
                self.visit_ts(reader.field(node, NODE_B), N_TS_ENUM_BODY);
            }
            k if k == N_TS_ENUM_BODY => {
                self.record(node);
                self.visit_list(reader.field(node, NODE_A));
            }
            k if k == N_TS_ENUM_MEMBER => {
                let initializer = reader.field(node, NODE_B);

                if initializer != 0 {
                    self.record(node);
                    self.maybe_visit(initializer);
                }
            }
            _ => {
                // A type position: nothing here executes.
            }
        }
    }

    //-------------------------------------------------------------------------
    // Statements
    //-------------------------------------------------------------------------

    /// Visits an `if` statement.
    fn visit_if(&mut self, node: u32) {
        let reader = self.reader;
        let alternate = reader.field(node, NODE_C);
        let then_block = self.builder.new_block();
        let else_block = if alternate != 0 {
            self.builder.new_block() as i64
        } else {
            -1
        };
        let after = self.builder.new_block();

        self.visit_condition(
            reader.field(node, NODE_A),
            then_block,
            if alternate != 0 {
                else_block as u32
            } else {
                after
            },
            0,
            0,
        );
        self.current = then_block;
        self.maybe_visit(reader.field(node, NODE_B));
        self.builder.add_edge(self.current, after, EK_NORMAL, 0);

        if alternate != 0 {
            self.current = else_block as u32;
            self.maybe_visit(alternate);
            self.builder.add_edge(self.current, after, EK_NORMAL, 0);
        }

        self.current = after;
    }

    /// Visits a logical expression in value position.
    fn visit_logical(&mut self, node: u32) {
        let reader = self.reader;
        let operator = reader.field(node, NODE_C);
        let left = reader.field(node, NODE_A);
        let right = self.builder.new_block();
        let join = self.builder.new_block();

        if operator == T_AMPAMP {
            self.visit_condition(left, right, join, 0, 0);
        } else if operator == T_PIPEPIPE {
            self.visit_condition(left, join, right, 0, 0);
        } else {
            // `??` forks on nullishness, not truthiness.
            self.maybe_visit(left);

            let handle = self.handle(left);

            self.builder.add_edge(self.current, right, EK_NULLISH, handle);
            self.builder
                .add_edge(self.current, join, EK_NOT_NULLISH, handle);
        }

        self.current = right;
        self.maybe_visit(reader.field(node, NODE_B));
        self.builder.add_edge(self.current, join, EK_NORMAL, 0);
        self.current = join;
    }

    /// Visits an assignment expression, forking for the logical operators.
    fn visit_assignment(&mut self, node: u32) {
        let reader = self.reader;
        let operator = reader.field(node, NODE_C);
        let left = reader.field(node, NODE_A);
        let right = reader.field(node, NODE_B);

        if operator == T_ASSIGN_AMPAMP
            || operator == T_ASSIGN_PIPEPIPE
            || operator == T_ASSIGN_QQ
        {
            self.visit_logical_assignment(operator, left, right);

            return;
        }

        // The value exists before the target receives it.
        self.maybe_visit(right);

        if operator == T_ASSIGN {
            self.visit_target(left, self.handle(right), 0);
        } else {
            self.write_flags = WF_COMPOUND;
            self.visit_target(left, self.handle(right), WF_COMPOUND);
            self.write_flags = 0;
        }
    }

    /// Visits `&&=`, `||=`, or `??=`, whose right side and write are
    /// conditional.
    fn visit_logical_assignment(&mut self, operator: u32, left: u32, right: u32) {
        let reader = self.reader;
        let left_kind = reader.kind(left);
        let is_member = left_kind == N_MEMBER_EXPRESSION;

        // Read the target without letting the reference map record a write.
        self.record(left);

        if is_member {
            self.maybe_visit(reader.field(left, NODE_A));

            if (reader.flags(left) & NF_COMPUTED) != 0 {
                self.maybe_visit(reader.field(left, NODE_B));
            }
        }

        let left_handle = self.handle(left);
        let right_block = self.builder.new_block();
        let join = self.builder.new_block();

        if operator == T_ASSIGN_AMPAMP {
            self.builder
                .add_edge(self.current, right_block, EK_TRUE, left_handle);
            self.builder.add_edge(self.current, join, EK_FALSE, left_handle);
        } else if operator == T_ASSIGN_PIPEPIPE {
            self.builder
                .add_edge(self.current, right_block, EK_FALSE, left_handle);
            self.builder.add_edge(self.current, join, EK_TRUE, left_handle);
        } else {
            self.builder
                .add_edge(self.current, right_block, EK_NULLISH, left_handle);
            self.builder
                .add_edge(self.current, join, EK_NOT_NULLISH, left_handle);
        }

        self.current = right_block;
        self.maybe_visit(right);

        if is_member {
            self.builder.add_write(
                self.current,
                0,
                left_handle,
                self.handle(right),
                WF_MEMBER | WF_COMPOUND,
            );
        } else {
            self.write_flags = WF_COMPOUND;
            self.maybe_write(left_handle);
            self.write_flags = 0;
        }

        self.builder.add_edge(self.current, join, EK_NORMAL, 0);
        self.current = join;
    }

    /// Visits an update expression.
    fn visit_update(&mut self, node: u32) {
        let reader = self.reader;
        let argument = reader.field(node, NODE_A);

        if reader.kind(argument) == N_IDENTIFIER {
            self.write_flags = WF_UPDATE;
            self.maybe_visit(argument);
            self.write_flags = 0;
        } else {
            self.visit_target(argument, 0, WF_UPDATE);
        }
    }

    /// Visits a `while` statement.
    fn visit_while(&mut self, node: u32) {
        let reader = self.reader;
        let test = self.builder.new_block();

        self.builder.add_edge(self.current, test, EK_NORMAL, 0);

        let body = self.builder.new_block();
        let after = self.builder.new_block();

        self.current = test;
        self.visit_condition(reader.field(node, NODE_A), body, after, 0, 0);

        let mut ctx = FlowContext::new(CTX_LOOP);

        ctx.break_target = after as i64;
        ctx.continue_target = test as i64;
        ctx.back_target = test as i64;
        ctx.labels = self.take_labels();
        self.contexts.push(ctx);
        self.current = body;
        self.maybe_visit(reader.field(node, NODE_B));
        self.builder
            .add_edge(self.current, test, EK_NORMAL | EF_BACK, 0);
        self.contexts.pop();
        self.current = after;
    }

    /// Visits a `do...while` statement.
    fn visit_do_while(&mut self, node: u32) {
        let reader = self.reader;
        let body = self.builder.new_block();

        self.builder.add_edge(self.current, body, EK_NORMAL, 0);

        let test = self.builder.new_block();
        let after = self.builder.new_block();
        let mut ctx = FlowContext::new(CTX_LOOP);

        ctx.break_target = after as i64;
        ctx.continue_target = test as i64;
        ctx.back_target = body as i64;
        ctx.labels = self.take_labels();
        self.contexts.push(ctx);
        self.current = body;
        self.maybe_visit(reader.field(node, NODE_A));
        self.builder.add_edge(self.current, test, EK_NORMAL, 0);
        self.current = test;
        self.visit_condition(reader.field(node, NODE_B), body, after, EF_BACK, 0);
        self.contexts.pop();
        self.current = after;
    }

    /// Visits a `for` statement.
    fn visit_for(&mut self, node: u32) {
        let reader = self.reader;
        let init = reader.field(node, NODE_A);
        let test_expr = reader.field(node, NODE_B);
        let update_expr = reader.field(node, NODE_C);

        if init != 0 {
            self.maybe_visit(init);
        }

        let test = self.builder.new_block();

        self.builder.add_edge(self.current, test, EK_NORMAL, 0);

        let body = self.builder.new_block();
        let update = if update_expr != 0 {
            self.builder.new_block() as i64
        } else {
            -1
        };
        let after = self.builder.new_block();

        self.current = test;

        if test_expr != 0 {
            self.visit_condition(test_expr, body, after, 0, 0);
        } else {
            // `for (;;)` iterates unconditionally.
            self.builder.add_edge(self.current, body, EK_NORMAL, 0);
        }

        let mut ctx = FlowContext::new(CTX_LOOP);

        ctx.break_target = after as i64;
        ctx.continue_target = if update_expr != 0 { update } else { test as i64 };
        ctx.back_target = test as i64;
        ctx.labels = self.take_labels();
        self.contexts.push(ctx);
        self.current = body;
        self.maybe_visit(reader.field(node, NODE_D));

        if update_expr != 0 {
            self.builder
                .add_edge(self.current, update as u32, EK_NORMAL, 0);
            self.current = update as u32;
            self.maybe_visit(update_expr);
        }

        self.builder
            .add_edge(self.current, test, EK_NORMAL | EF_BACK, 0);
        self.contexts.pop();
        self.current = after;
    }

    /// Visits a `for...in` or `for...of` statement.
    fn visit_for_each(&mut self, node: u32) {
        let reader = self.reader;
        let left = reader.field(node, NODE_A);
        let right = reader.field(node, NODE_B);

        self.maybe_visit(right);

        let head = self.builder.new_block();

        self.builder.add_edge(self.current, head, EK_NORMAL, 0);

        let body = self.builder.new_block();
        let after = self.builder.new_block();
        let right_handle = self.handle(right);

        self.builder.add_edge(head, body, EK_ITERATE, right_handle);
        self.builder.add_edge(head, after, EK_DONE, right_handle);

        let mut ctx = FlowContext::new(CTX_LOOP);

        ctx.break_target = after as i64;
        ctx.continue_target = head as i64;
        ctx.back_target = head as i64;
        ctx.labels = self.take_labels();
        self.contexts.push(ctx);
        self.current = body;

        // Each iteration writes the left side before the body runs.
        if reader.kind(left) == N_VARIABLE_DECLARATION {
            self.maybe_visit(left);
        } else {
            self.visit_target(left, right_handle, 0);
        }

        self.maybe_visit(reader.field(node, NODE_C));
        self.builder
            .add_edge(self.current, head, EK_NORMAL | EF_BACK, 0);
        self.contexts.pop();
        self.current = after;
    }

    /// Visits a `switch` statement.
    fn visit_switch(&mut self, node: u32) {
        let reader = self.reader;

        self.maybe_visit(reader.field(node, NODE_A));

        let after = self.builder.new_block();
        let cases = reader.field(node, NODE_B);
        let case_count = reader.raw_list_size(cases);

        if case_count == 0 {
            self.builder.add_edge(self.current, after, EK_NORMAL, 0);
            self.current = after;

            return;
        }

        let mut ctx = FlowContext::new(CTX_BREAKABLE);

        ctx.break_target = after as i64;
        ctx.labels = self.take_labels();
        self.contexts.push(ctx);

        // Every case body gets its block up front; tests chain into them.
        let mut bodies = Vec::with_capacity(case_count as usize);

        for _ in 0..case_count {
            bodies.push(self.builder.new_block());
        }

        let mut previous = self.current;
        let mut previous_cond = 0u32;
        let mut default_index: i64 = -1;

        for i in 0..case_count {
            let case_node = reader.raw_list_item(cases, i);
            let test = reader.field(case_node, NODE_A);

            if test == 0 {
                default_index = i as i64;
                continue;
            }

            let test_block = self.builder.new_block();

            self.builder.add_edge(
                previous,
                test_block,
                if previous_cond == 0 { EK_NORMAL } else { EK_FALSE },
                previous_cond,
            );
            self.current = test_block;
            self.maybe_visit(test);

            let test_handle = self.handle(test);

            self.builder
                .add_edge(self.current, bodies[i as usize], EK_TRUE, test_handle);
            previous = self.current;
            previous_cond = test_handle;
        }

        self.builder.add_edge(
            previous,
            if default_index >= 0 {
                bodies[default_index as usize]
            } else {
                after
            },
            if previous_cond == 0 { EK_NORMAL } else { EK_FALSE },
            previous_cond,
        );

        for i in 0..case_count {
            if i > 0 {
                // Falling through the end of the previous body.
                self.builder
                    .add_edge(self.current, bodies[i as usize], EK_NORMAL, 0);
            }

            self.current = bodies[i as usize];

            let case_node = reader.raw_list_item(cases, i);

            self.record(case_node);
            self.visit_list(reader.field(case_node, NODE_B));
        }

        self.builder.add_edge(self.current, after, EK_NORMAL, 0);
        self.contexts.pop();
        self.current = after;
    }

    /// Visits a `try` statement.
    fn visit_try(&mut self, node: u32) {
        let reader = self.reader;
        let block = reader.field(node, NODE_A);
        let handler = reader.field(node, NODE_B);
        let finalizer = reader.field(node, NODE_C);
        let has_finally = finalizer != 0;

        // The continuation blocks come first so that the try region is one
        // contiguous run after them.
        let finally_entry: i64 = if has_finally {
            self.builder.new_block() as i64
        } else {
            -1
        };
        let handler_entry: i64 = if handler != 0 {
            self.builder.new_block() as i64
        } else {
            -1
        };
        let after = self.builder.new_block();
        let mut ctx = FlowContext::new(CTX_TRY);

        ctx.has_finally = has_finally;
        ctx.finally_entry = finally_entry;
        self.contexts.push(ctx);

        let ctx_index = self.contexts.len() - 1;
        let try_entry = self.builder.new_block();

        self.builder.add_edge(self.current, try_entry, EK_NORMAL, 0);
        self.current = try_entry;
        self.maybe_visit(block);

        let try_end = self.current;
        let region_end = self.builder.block_count();

        // Anything in the region can throw into the handler or finalizer.
        let exception_target = if handler != 0 {
            handler_entry as u32
        } else {
            finally_entry as u32
        };

        for b in try_entry..region_end {
            self.builder.add_edge(b, exception_target, EK_EXCEPTION, 0);
        }

        self.builder.add_edge(
            try_end,
            if has_finally {
                finally_entry as u32
            } else {
                after
            },
            EK_NORMAL,
            0,
        );

        // Whether the protected code can complete without jumping or
        // throwing.
        let mut completes = self.builder.is_reachable(try_end);

        if handler != 0 {
            self.contexts[ctx_index].phase = PHASE_CATCH;
            self.current = handler_entry as u32;
            self.record(handler);

            let param = reader.field(handler, NODE_A);

            if param != 0 {
                self.maybe_visit(param);
            }

            let catch_region_start = self.builder.block_count();

            self.maybe_visit(reader.field(handler, NODE_B));

            let catch_end = self.current;

            if has_finally {
                // The catch can throw too, and the finalizer still runs.
                self.builder
                    .add_edge(handler_entry as u32, finally_entry as u32, EK_EXCEPTION, 0);

                for b in catch_region_start..self.builder.block_count() {
                    self.builder
                        .add_edge(b, finally_entry as u32, EK_EXCEPTION, 0);
                }
            }

            self.builder.add_edge(
                catch_end,
                if has_finally {
                    finally_entry as u32
                } else {
                    after
                },
                EK_NORMAL,
                0,
            );
            completes = completes || self.builder.is_reachable(catch_end);
        }

        if has_finally {
            self.contexts[ctx_index].phase = PHASE_FINALLY;
            self.current = finally_entry as u32;
            self.maybe_visit(finalizer);

            let finally_end = self.current;

            // The finalizer falls through to what follows only when the
            // protected code can complete normally.
            if completes {
                self.builder.add_edge(finally_end, after, EK_NORMAL, 0);
            }

            let ctx = self.contexts.pop().unwrap();

            // Abrupt completions that were parked on the context resume from
            // the finalizer's end.
            self.current = finally_end;

            for jump in &ctx.pending_jumps {
                self.route_jump(jump.target, jump.context_index, jump.flags);
            }

            if ctx.pending_return {
                self.route_return();
            }

            if !self.is_protected() {
                self.thrown.push(finally_end);
            }
        } else {
            self.contexts.pop();
        }

        self.current = after;
    }

    /// Visits a labeled statement.
    fn visit_labeled(&mut self, node: u32) {
        let reader = self.reader;
        let label = reader.field(node, NODE_A);
        let body = reader.field(node, NODE_B);
        let body_kind = reader.kind(body);

        if body_kind == N_WHILE_STATEMENT
            || body_kind == N_DO_WHILE_STATEMENT
            || body_kind == N_FOR_STATEMENT
            || body_kind == N_FOR_IN_STATEMENT
            || body_kind == N_FOR_OF_STATEMENT
            || body_kind == N_SWITCH_STATEMENT
            || body_kind == N_LABELED_STATEMENT
        {
            // The loop or switch takes the label onto its own context.
            self.pending_labels.push(label);
            self.visit(body, body_kind);

            return;
        }

        let after = self.builder.new_block();
        let mut ctx = FlowContext::new(CTX_LABEL);

        ctx.break_target = after as i64;

        let mut labels = vec![label];

        labels.extend_from_slice(&self.pending_labels);
        self.pending_labels.clear();
        ctx.labels = Some(labels);
        self.contexts.push(ctx);
        self.maybe_visit(body);
        self.builder.add_edge(self.current, after, EK_NORMAL, 0);
        self.contexts.pop();
        self.current = after;
    }

    /// Takes the labels waiting for the construct being entered.
    fn take_labels(&mut self) -> Option<Vec<u32>> {
        if self.pending_labels.is_empty() {
            return None;
        }

        Some(std::mem::take(&mut self.pending_labels))
    }

    /// Whether a context answers to a label.
    fn has_label(&self, context_index: usize, label: u32) -> bool {
        let Some(labels) = &self.contexts[context_index].labels else {
            return false;
        };

        labels.iter().any(|&candidate| self.same_name(candidate, label))
    }

    /// Visits a `break` statement.
    fn visit_break(&mut self, node: u32) {
        let label = self.reader.field(node, NODE_A);

        for i in (0..self.contexts.len()).rev() {
            let matches = if label != 0 {
                self.contexts[i].break_target >= 0 && self.has_label(i, label)
            } else {
                self.contexts[i].kind == CTX_LOOP || self.contexts[i].kind == CTX_BREAKABLE
            };

            if matches {
                let target = self.contexts[i].break_target as u32;

                self.route_jump(target, i, 0);
                break;
            }
        }

        self.terminate();
    }

    /// Visits a `continue` statement.
    fn visit_continue(&mut self, node: u32) {
        let label = self.reader.field(node, NODE_A);

        for i in (0..self.contexts.len()).rev() {
            let matches = self.contexts[i].kind == CTX_LOOP
                && (label == 0 || self.has_label(i, label));

            if matches {
                let target = self.contexts[i].continue_target;
                let flags = if target == self.contexts[i].back_target {
                    EF_BACK
                } else {
                    0
                };

                self.route_jump(target as u32, i, flags);
                break;
            }
        }

        self.terminate();
    }

    //-------------------------------------------------------------------------
    // Expressions
    //-------------------------------------------------------------------------

    /// Walks one step of an optional chain, short-circuiting to the join
    /// block wherever a `?.` finds nothing.
    fn visit_chain_step(&mut self, node: u32, join: u32) {
        let reader = self.reader;
        let kind = reader.kind(node);

        if kind == N_MEMBER_EXPRESSION {
            self.record(node);

            let object = reader.field(node, NODE_A);

            self.visit_chain_step(object, join);

            if (reader.flags(node) & NF_OPTIONAL) != 0 {
                self.fork(self.handle(object), join);
            }

            if (reader.flags(node) & NF_COMPUTED) != 0 {
                self.maybe_visit(reader.field(node, NODE_B));
            }

            return;
        }

        if kind == N_CALL_EXPRESSION {
            self.record(node);

            let callee = reader.field(node, NODE_A);

            self.visit_chain_step(callee, join);

            if (reader.flags(node) & NF_OPTIONAL) != 0 {
                self.fork(self.handle(callee), join);
            }

            self.visit_list(reader.field(node, NODE_B));

            return;
        }

        if kind == N_TS_NON_NULL_EXPRESSION {
            self.record(node);
            self.visit_chain_step(reader.field(node, NODE_A), join);

            return;
        }

        self.maybe_visit(node);
    }

    /// Splits the current block on a nullish check.
    fn fork(&mut self, condition: u32, join: u32) {
        let next = self.builder.new_block();

        self.builder
            .add_edge(self.current, next, EK_NOT_NULLISH, condition);
        self.builder.add_edge(self.current, join, EK_NULLISH, condition);
        self.current = next;
    }

    /// Visits a class, deferring everything that runs later: method bodies,
    /// field initializers, and static blocks each become their own graph.
    fn visit_class(&mut self, node: u32) {
        let reader = self.reader;

        self.visit_list(reader.field(node, NODE_G));

        let super_class = reader.field(node, NODE_B);

        if super_class != 0 {
            self.maybe_visit(super_class);
        }

        let body = reader.field(node, NODE_C);

        self.record(body);

        let members = reader.field(body, NODE_A);
        let count = reader.raw_list_size(members);

        for i in 0..count {
            let member = reader.raw_list_item(members, i);
            let member_kind = reader.kind(member);

            if member_kind == N_METHOD_DEFINITION
                || member_kind == N_TS_ABSTRACT_METHOD_DEFINITION
            {
                self.record(member);
                self.visit_list(reader.field(member, NODE_C));

                if (reader.flags(member) & NF_COMPUTED) != 0 {
                    self.maybe_visit(reader.field(member, NODE_A));
                }

                let value = reader.field(member, NODE_B);

                if value != 0 && reader.kind(value) == N_FUNCTION_EXPRESSION {
                    // Evaluating the class creates the method's closure, so
                    // the function node executes here even though its body is
                    // a graph of its own.
                    self.record(value);
                    self.tasks.push_back(GraphTask {
                        node: value,
                        origin: ORIGIN_FUNCTION,
                        upper: self.graph,
                    });
                }
            } else if member_kind == N_PROPERTY_DEFINITION
                || member_kind == N_ACCESSOR_PROPERTY
            {
                self.record(member);
                self.visit_list(reader.field(member, NODE_C));

                if (reader.flags(member) & NF_COMPUTED) != 0 {
                    self.maybe_visit(reader.field(member, NODE_A));
                }

                let value = reader.field(member, NODE_B);

                if value != 0 {
                    self.tasks.push_back(GraphTask {
                        node: value,
                        origin: ORIGIN_CLASS_FIELD_INITIALIZER,
                        upper: self.graph,
                    });
                }
            } else if member_kind == N_STATIC_BLOCK {
                // A static block runs when the class is evaluated.
                self.record(member);
                self.tasks.push_back(GraphTask {
                    node: member,
                    origin: ORIGIN_CLASS_STATIC_BLOCK,
                    upper: self.graph,
                });
            }

            // Abstract members and index signatures have nothing to run.
        }
    }
}
