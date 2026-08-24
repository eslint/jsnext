//! The walk over a destructuring pattern.
//!
//! Port of `packages/jskit/src/scope/pattern-visitor.ts`. Where the
//! TypeScript visitor calls back at every name during the walk, this one
//! records the callbacks as events and hands them back — nothing else touches
//! the builder during a pattern walk, so deferring them changes no ordering.

use crate::parse::node_kinds::*;
use crate::parse::slots::{SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE};
use super::binary_ast::BinaryAst;

/// What the walk knows about a name by the time it reaches it.
pub struct PatternEvent {
    /// The `Identifier` node being bound.
    pub pattern: u32,

    /// Whether the name is the whole pattern rather than a part of one.
    pub top_level: bool,

    /// Whether the name is the target of a rest element.
    pub rest: bool,

    /// The `AssignmentPattern` and `AssignmentExpression` nodes enclosing the
    /// name, which are the defaults that write to it.
    pub assignments: Vec<u32>,
}

/// The result of walking one pattern.
pub struct PatternWalk {
    /// One event per name found, in walk order.
    pub events: Vec<PatternEvent>,

    /// The expressions inside the pattern that are evaluated, not bound.
    pub right_hand_nodes: Vec<u32>,
}

struct PatternVisitor<'a, 'b> {
    ast: &'b BinaryAst<'a>,
    root_pattern: u32,
    events: Vec<PatternEvent>,
    right_hand_nodes: Vec<u32>,
    assignments: Vec<u32>,
    rest_elements: Vec<u32>,
}

/// Walks a pattern, reporting the names it binds.
pub fn collect_pattern(ast: &BinaryAst, root: u32) -> PatternWalk {
    let mut visitor = PatternVisitor {
        ast,
        root_pattern: root,
        events: Vec::new(),
        right_hand_nodes: Vec::new(),
        assignments: Vec::new(),
        rest_elements: Vec::new(),
    };

    visitor.visit(root);

    PatternWalk {
        events: visitor.events,
        right_hand_nodes: visitor.right_hand_nodes,
    }
}

impl<'a, 'b> PatternVisitor<'a, 'b> {
    fn visit(&mut self, node: u32) {
        if node == 0 {
            return;
        }

        let ast = self.ast;
        let kind = ast.kind(node);

        match kind {
            k if k == N_IDENTIFIER => {
                let rest = self
                    .rest_elements
                    .last()
                    .is_some_and(|&last| ast.child(last, 0) == node);

                self.events.push(PatternEvent {
                    pattern: node,
                    top_level: node == self.root_pattern,
                    rest,
                    assignments: self.assignments.clone(),
                });
            }
            k if k == N_PROPERTY => {
                // A computed key is evaluated; it does not name a binding.
                if ast.computed(node) {
                    self.push_right_hand(ast.child(node, 0));
                }

                // Shorthand or not, the name being bound is always the
                // property's value.
                self.visit(ast.child(node, 1));
            }
            k if k == N_ARRAY_PATTERN || k == N_ARRAY_EXPRESSION => {
                let size = ast.list_size(node, 0);

                for i in 0..size {
                    self.visit(ast.list_item(node, 0, i));
                }
            }
            k if k == N_ASSIGNMENT_PATTERN || k == N_ASSIGNMENT_EXPRESSION => {
                self.assignments.push(node);
                self.visit(ast.child(node, 0));
                self.push_right_hand(ast.child(node, 1));
                self.assignments.pop();
            }
            k if k == N_REST_ELEMENT => {
                self.rest_elements.push(node);
                self.visit(ast.child(node, 0));
                self.rest_elements.pop();
            }
            k if k == N_SPREAD_ELEMENT => {
                self.visit(ast.child(node, 0));
            }
            k if k == N_MEMBER_EXPRESSION => {
                if ast.computed(node) {
                    self.push_right_hand(ast.child(node, 1));
                }

                // The object is only read; the write lands on its property.
                self.push_right_hand(ast.child(node, 0));
            }
            k if k == N_CALL_EXPRESSION => {
                let size = ast.list_size(node, 1);

                for i in 0..size {
                    self.push_right_hand(ast.list_item(node, 1, i));
                }

                self.visit(ast.child(node, 0));
            }
            // Neither binds anything, and neither is evaluated here.
            k if k == N_DECORATOR || k == N_TS_TYPE_ANNOTATION => {}
            _ => {
                self.visit_children(node, kind);
            }
        }
    }

    fn push_right_hand(&mut self, node: u32) {
        if node != 0 {
            self.right_hand_nodes.push(node);
        }
    }

    fn visit_children(&mut self, node: u32, kind: u32) {
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let descriptor = SLOT_TABLE[base + slot] as u32;

            if descriptor == SLOT_NODE {
                self.visit(self.ast.child(node, slot));
            } else if descriptor == SLOT_LIST {
                let size = self.ast.list_size(node, slot);

                for i in 0..size {
                    self.visit(self.ast.list_item(node, slot, i));
                }
            }
        }
    }
}

/// Whether a node can appear where a pattern is expected.
pub fn is_pattern_kind(kind: u32) -> bool {
    kind == N_IDENTIFIER
        || kind == N_ARRAY_PATTERN
        || kind == N_ASSIGNMENT_PATTERN
        || kind == N_REST_ELEMENT
        || kind == N_SPREAD_ELEMENT
        || kind == N_OBJECT_PATTERN
}
