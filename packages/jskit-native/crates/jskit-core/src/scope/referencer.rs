//! The walk that builds the scope graph.
//!
//! Port of `packages/jskit/src/scope/referencer.ts`, specialized to the
//! binary path. Pattern callbacks are replayed from the pattern walk's event
//! list; nothing else touches the builder during a pattern walk, so the
//! observable order is identical.

use crate::parse::node_kinds::*;
use crate::parse::slots::{SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE};
use super::binary_ast::{BinaryAst, DECL_KIND_NAMES};
use super::buffer::{CODE_CONDITIONAL_TYPE, CODE_FUNCTION_TYPE, CODE_MAPPED_TYPE, RF_READ, RF_WRITE};
use super::builder::ScopeBuilder;
use super::pattern::{collect_pattern, is_pattern_kind, PatternEvent};

/// `READ | WRITE`, as the walk spells a compound assignment's mode.
const READ_WRITE: u32 = RF_READ | RF_WRITE;
const WRITE: u32 = RF_WRITE;

/// Compares a UTF-16 name against an ASCII spelling.
fn eq_ascii(units: &[u16], text: &str) -> bool {
    units.len() == text.len()
        && units
            .iter()
            .zip(text.bytes())
            .all(|(&unit, byte)| unit == u16::from(byte))
}

/// Whether `text[0] === text[0].toUpperCase()` holds for a UTF-16 name, with
/// JavaScript's code-unit semantics: a lone surrogate maps to itself.
fn first_unit_is_uppercase(units: &[u16]) -> bool {
    let Some(&unit) = units.first() else {
        return false;
    };

    if (0xd800..0xe000).contains(&unit) {
        return true;
    }

    match char::from_u32(u32::from(unit)) {
        Some(c) => {
            let mut upper = c.to_uppercase();

            upper.next() == Some(c) && upper.next().is_none()
        }
        None => true,
    }
}

/// Builds the scope graph for one program.
pub struct Referencer<'a, 'b> {
    b: &'b mut ScopeBuilder<'a>,
    typescript: bool,
    jsx: bool,
    ignore_eval: bool,
    jsx_pragma: Option<Vec<u16>>,
    jsx_fragment_name: Option<Vec<u16>>,
    referenced_jsx_factory: bool,
    referenced_jsx_fragment_factory: bool,
}

impl<'a, 'b> Referencer<'a, 'b> {
    /// Creates a referencer over a builder.
    pub fn new(builder: &'b mut ScopeBuilder<'a>) -> Self {
        let typescript = builder.options.dialect_ts;
        let jsx = builder.options.jsx;
        let ignore_eval = builder.options.ignore_eval;
        let jsx_pragma = builder.options.jsx_pragma.clone();
        let jsx_fragment_name = builder.options.jsx_fragment_name.clone();

        Referencer {
            b: builder,
            typescript,
            jsx,
            ignore_eval,
            jsx_pragma,
            jsx_fragment_name,
            referenced_jsx_factory: false,
            referenced_jsx_fragment_factory: false,
        }
    }

    #[inline]
    fn ast(&self) -> &BinaryAst<'a> {
        &self.b.ast
    }

    //-------------------------------------------------------------------------
    // Scope Plumbing
    //-------------------------------------------------------------------------

    /// Closes every scope a node opened.
    fn close(&mut self, node: u32) {
        while self.b.current_scope() != -1 && node == self.b.current_block() {
            self.b.close_current();
        }
    }

    //-------------------------------------------------------------------------
    // Generic Traversal
    //-------------------------------------------------------------------------

    /// Visits every child of a node, in the order a visitor-key walk would.
    fn visit_children(&mut self, node: u32, kind: u32) {
        // A binary buffer holds no unknown kinds, so kind 0 has no children.
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let descriptor = SLOT_TABLE[base + slot] as u32;

            if descriptor == SLOT_NODE {
                self.visit(self.ast().child(node, slot));
            } else if descriptor == SLOT_LIST {
                self.visit_list(node, slot);
            }
        }
    }

    /// Visits every element of a slot's list.
    fn visit_list(&mut self, node: u32, slot: usize) {
        let size = self.ast().list_size(node, slot);

        for i in 0..size {
            self.visit(self.ast().list_item(node, slot, i));
        }
    }

    /// Records the writes that a pattern's default values perform.
    fn referencing_default_value(
        &mut self,
        pattern: u32,
        assignments: &[u32],
        implicit_node: u32,
        init: bool,
    ) {
        if assignments.is_empty() {
            return;
        }

        let name = self.ast().name(pattern);

        for &assignment in assignments {
            let write_expr = self.ast().child(assignment, 1);
            let partial = pattern != self.ast().child(assignment, 0);

            self.b
                .reference_value(pattern, &name, WRITE, write_expr, implicit_node, partial, init);
        }
    }

    //-------------------------------------------------------------------------
    // The Main Walk
    //-------------------------------------------------------------------------

    /// Visits a node and everything it contains. `0` means no node.
    pub fn visit(&mut self, node: u32) {
        if node == 0 {
            return;
        }

        let kind = self.ast().kind(node);

        match kind {
            k if k == N_IDENTIFIER => {
                let name = self.ast().name(node);

                self.b.reference_read(node, &name);
                self.visit_type(self.ast().child(node, 1));
            }
            k if k == N_PROGRAM => self.visit_program(node),
            k if k == N_BLOCK_STATEMENT => {
                self.b.nest_block_scope(node);
                self.visit_list(node, 0);
                self.close(node);
            }
            k if k == N_FUNCTION_DECLARATION
                || k == N_FUNCTION_EXPRESSION
                || k == N_ARROW_FUNCTION_EXPRESSION
                || k == N_TS_DECLARE_FUNCTION
                || k == N_TS_EMPTY_BODY_FUNCTION_EXPRESSION =>
            {
                self.visit_function(node, kind, false);
            }
            k if k == N_CLASS_DECLARATION || k == N_CLASS_EXPRESSION => {
                self.visit_class(node, kind);
            }
            k if k == N_VARIABLE_DECLARATION => self.visit_variable_declaration(node),
            k if k == N_ASSIGNMENT_EXPRESSION => self.visit_assignment(node),
            k if k == N_UPDATE_EXPRESSION => self.visit_update(node),
            k if k == N_MEMBER_EXPRESSION => {
                self.visit(self.ast().child(node, 0));

                if self.ast().computed(node) {
                    self.visit(self.ast().child(node, 1));
                }
            }
            k if k == N_PROPERTY => self.visit_property_like(node),
            k if k == N_CATCH_CLAUSE => self.visit_catch_clause(node),
            k if k == N_FOR_STATEMENT => self.visit_for(node),
            k if k == N_FOR_IN_STATEMENT || k == N_FOR_OF_STATEMENT => self.visit_for_in(node),
            k if k == N_SWITCH_STATEMENT => {
                self.visit(self.ast().child(node, 0));
                self.b.nest_switch_scope(node);
                self.visit_list(node, 1);
                self.close(node);
            }
            k if k == N_WITH_STATEMENT => {
                self.visit(self.ast().child(node, 0));
                self.b.nest_with_scope(node);
                self.visit(self.ast().child(node, 1));
                self.close(node);
            }
            k if k == N_CALL_EXPRESSION => self.visit_call(node),
            k if k == N_NEW_EXPRESSION => {
                self.visit(self.ast().child(node, 0));
                self.visit_list(node, 1);
                self.visit_type(self.ast().child(node, 2));
            }
            k if k == N_THIS_EXPRESSION => self.b.detect_this(),
            k if k == N_LABELED_STATEMENT => self.visit(self.ast().child(node, 1)),
            k if k == N_IMPORT_DECLARATION => self.visit_import_declaration(node),
            k if k == N_EXPORT_NAMED_DECLARATION => self.visit_export_named(node),
            k if k == N_EXPORT_DEFAULT_DECLARATION => self.visit_export_default(node),
            k if k == N_TAGGED_TEMPLATE_EXPRESSION => {
                self.visit(self.ast().child(node, 0));
                self.visit(self.ast().child(node, 1));
                self.visit_type(self.ast().child(node, 2));
            }
            // A label is not a variable, an `export * from` names nothing in
            // this program, and an import attribute's key is a property name.
            k if k == N_BREAK_STATEMENT
                || k == N_CONTINUE_STATEMENT
                || k == N_EXPORT_ALL_DECLARATION
                || k == N_IMPORT_ATTRIBUTE
                || k == N_META_PROPERTY
                || k == N_PRIVATE_IDENTIFIER => {}
            k if k == N_JSX_ELEMENT => self.visit_jsx_element(node),
            k if k == N_JSX_FRAGMENT => self.visit_jsx_fragment(node),
            k if k == N_JSX_OPENING_ELEMENT => self.visit_jsx_opening_element(node),
            k if k == N_JSX_IDENTIFIER => {
                if self.jsx {
                    let name = self.ast().name(node);

                    // `this` in a JSX name is the keyword, not a variable.
                    if !eq_ascii(&name, "this") {
                        self.b.reference_read(node, &name);
                    }
                }
            }
            k if k == N_JSX_MEMBER_EXPRESSION => self.visit(self.ast().child(node, 0)),
            k if k == N_JSX_NAMESPACED_NAME => {
                self.visit(self.ast().child(node, 0));
                self.visit(self.ast().child(node, 1));
            }
            k if k == N_JSX_ATTRIBUTE => self.visit(self.ast().child(node, 1)),
            k if k == N_JSX_EXPRESSION_CONTAINER => self.visit(self.ast().child(node, 0)),
            k if k == N_TS_AS_EXPRESSION || k == N_TS_SATISFIES_EXPRESSION => {
                self.visit(self.ast().child(node, 0));
                self.visit_type(self.ast().child(node, 1));
            }
            k if k == N_TS_TYPE_ASSERTION => {
                self.visit(self.ast().child(node, 1));
                self.visit_type(self.ast().child(node, 0));
            }
            k if k == N_TS_INSTANTIATION_EXPRESSION => {
                self.visit(self.ast().child(node, 0));
                self.visit_type(self.ast().child(node, 1));
            }
            k if k == N_TS_INTERFACE_DECLARATION || k == N_TS_TYPE_ALIAS_DECLARATION => {
                self.visit_type(node);
            }
            k if k == N_TS_ENUM_DECLARATION => self.visit_enum(node),
            k if k == N_TS_MODULE_DECLARATION => self.visit_module_declaration(node),
            k if k == N_TS_IMPORT_EQUALS_DECLARATION => self.visit_import_equals(node),
            k if k == N_TS_EXPORT_ASSIGNMENT => self.visit_export_assignment(node),
            k if k == N_STATIC_BLOCK => {
                self.b.nest_class_static_block_scope(node);
                self.visit_list(node, 0);
                self.close(node);
            }
            _ => self.visit_children(node, kind),
        }
    }

    //-------------------------------------------------------------------------
    // Statements and Declarations
    //-------------------------------------------------------------------------

    /// Visits the program, opening the scopes that wrap the whole file.
    fn visit_program(&mut self, node: u32) {
        self.b.nest_global_scope(node);

        // A CommonJS module runs inside a function, so `return` is legal at
        // the top level and the global scope itself is never strict.
        if self.b.is_global_return() {
            self.b.set_strict(false);
            self.b.nest_function_scope(node, false);
        }

        if self.b.is_module() {
            self.b.nest_module_scope(node);
        }

        if self.b.is_implied_strict() {
            self.b.set_strict(true);
        }

        self.visit_list(node, 0);
        self.close(node);
    }

    /// Visits a variable declaration, binding each name it introduces.
    fn visit_variable_declaration(&mut self, node: u32) {
        let kind_code = self.ast().declaration_kind_code(node);
        let kind_name = DECL_KIND_NAMES[kind_code as usize];
        let target = if kind_code == 0 {
            self.b.current_variable_scope()
        } else {
            self.b.current_scope() as u32
        };
        let size = self.ast().list_size(node, 0);

        for index in 0..size {
            let declarator = self.ast().list_item(node, 0, index);

            if declarator == 0 {
                continue;
            }

            let id = self.ast().child(declarator, 0);
            let init = self.ast().child(declarator, 1);

            if id != 0 {
                let walk = collect_pattern(self.ast(), id);

                for event in &walk.events {
                    let name = self.ast().name(event.pattern);

                    self.b.define_variable(
                        target,
                        event.pattern,
                        &name,
                        declarator,
                        node,
                        index as i32,
                        kind_name,
                    );

                    self.referencing_default_value(event.pattern, &event.assignments, 0, true);

                    if init != 0 {
                        self.b.reference_value(
                            event.pattern,
                            &name,
                            WRITE,
                            init,
                            0,
                            !event.top_level,
                            true,
                        );
                    }
                }

                for &right in &walk.right_hand_nodes {
                    self.visit(right);
                }
            }

            self.visit(init);
            self.visit_type(self.type_annotation_of(id));
        }
    }

    /// Visits an assignment, which either writes names or writes a property.
    fn visit_assignment(&mut self, node: u32) {
        let right = self.ast().child(node, 1);
        let left = self.expression_target(self.ast().child(node, 0));

        if left != 0 && is_pattern_kind(self.ast().kind(left)) {
            if self.ast().is_simple_assignment(node) {
                let implicit_node = if self.b.is_strict() { 0 } else { node };
                let walk = collect_pattern(self.ast(), left);

                for event in &walk.events {
                    let name = self.ast().name(event.pattern);

                    self.referencing_default_value(
                        event.pattern,
                        &event.assignments,
                        implicit_node,
                        false,
                    );
                    self.b.reference_value(
                        event.pattern,
                        &name,
                        WRITE,
                        right,
                        implicit_node,
                        !event.top_level,
                        false,
                    );
                }

                for &right_hand in &walk.right_hand_nodes {
                    self.visit(right_hand);
                }
            } else if self.ast().kind(left) == N_IDENTIFIER {
                let name = self.ast().name(left);

                self.b
                    .reference_value(left, &name, READ_WRITE, right, 0, false, false);
            }
        } else {
            self.visit(left);
        }

        self.visit(right);
    }

    /// Visits an increment or decrement, which reads and writes at once.
    fn visit_update(&mut self, node: u32) {
        let argument = self.expression_target(self.ast().child(node, 0));

        if argument != 0 && self.ast().kind(argument) == N_IDENTIFIER {
            let name = self.ast().name(argument);

            self.b
                .reference_value(argument, &name, READ_WRITE, 0, 0, false, false);
        } else {
            self.visit(argument);
        }
    }

    /// Looks through the TypeScript expressions that wrap an assignment
    /// target without changing what is being written to.
    fn expression_target(&mut self, node: u32) -> u32 {
        if node == 0 {
            return 0;
        }

        let kind = self.ast().kind(node);

        if kind == N_TS_AS_EXPRESSION {
            self.visit_type(self.ast().child(node, 1));

            return self.ast().child(node, 0);
        }

        if kind == N_TS_TYPE_ASSERTION {
            self.visit_type(self.ast().child(node, 0));

            return self.ast().child(node, 1);
        }

        if kind == N_TS_NON_NULL_EXPRESSION {
            return self.ast().child(node, 0);
        }

        node
    }

    /// Visits a `catch` clause, binding its parameter in a scope of its own.
    fn visit_catch_clause(&mut self, node: u32) {
        let param = self.ast().child(node, 0);

        self.b.nest_catch_scope(node);

        if param != 0 {
            let walk = collect_pattern(self.ast(), param);

            for event in &walk.events {
                let name = self.ast().name(event.pattern);

                self.b.define_catch_clause(event.pattern, &name, node);
                self.referencing_default_value(event.pattern, &event.assignments, 0, true);
            }

            for &right in &walk.right_hand_nodes {
                self.visit(right);
            }
        }

        self.visit(self.ast().child(node, 1));
        self.close(node);
    }

    /// Visits a `for` statement.
    fn visit_for(&mut self, node: u32) {
        let init = self.ast().child(node, 0);

        if init != 0 && self.is_lexical_declaration(init) {
            self.b.nest_for_scope(node);
        }

        self.visit(init);
        self.visit(self.ast().child(node, 1));
        self.visit(self.ast().child(node, 2));
        self.visit(self.ast().child(node, 3));
        self.close(node);
    }

    /// Visits a `for-in` or `for-of` statement.
    fn visit_for_in(&mut self, node: u32) {
        let left = self.ast().child(node, 0);
        let right = self.ast().child(node, 1);
        let is_declaration = left != 0 && self.ast().kind(left) == N_VARIABLE_DECLARATION;

        if is_declaration && self.is_lexical_declaration(left) {
            self.b.nest_for_scope(node);
        }

        if is_declaration {
            self.visit(left);

            let first = self.ast().list_item(left, 0, 0);

            if first != 0 {
                let id = self.ast().child(first, 0);

                if id != 0 {
                    let walk = collect_pattern(self.ast(), id);

                    for event in &walk.events {
                        let name = self.ast().name(event.pattern);

                        self.b
                            .reference_value(event.pattern, &name, WRITE, right, 0, true, true);
                    }
                }
            }
        } else if left != 0 {
            let implicit_node = if self.b.is_strict() { 0 } else { node };
            let walk = collect_pattern(self.ast(), left);

            for event in &walk.events {
                let name = self.ast().name(event.pattern);

                self.referencing_default_value(
                    event.pattern,
                    &event.assignments,
                    implicit_node,
                    false,
                );
                self.b.reference_value(
                    event.pattern,
                    &name,
                    WRITE,
                    right,
                    implicit_node,
                    true,
                    false,
                );
            }

            for &right_hand in &walk.right_hand_nodes {
                self.visit(right_hand);
            }
        }

        self.visit(right);
        self.visit(self.ast().child(node, 2));
        self.close(node);
    }

    /// Visits a call, noticing a direct call to `eval`.
    fn visit_call(&mut self, node: u32) {
        let callee = self.ast().child(node, 0);

        if !self.ignore_eval && callee != 0 && self.ast().kind(callee) == N_IDENTIFIER {
            let name = self.ast().name(callee);

            if eq_ascii(&name, "eval") {
                self.b.detect_eval();
            }
        }

        self.visit(callee);
        self.visit_list(node, 1);
        self.visit_type(self.ast().child(node, 2));
    }

    //-------------------------------------------------------------------------
    // Functions
    //-------------------------------------------------------------------------

    /// Visits a function, binding its name and parameters.
    fn visit_function(&mut self, node: u32, kind: u32, is_method: bool) {
        let id = self.ast().child(node, 0);

        // A function declaration binds its name where it is written, while a
        // named function expression binds its name only inside itself.
        if kind == N_FUNCTION_EXPRESSION {
            if id != 0 {
                self.b.nest_function_expression_name_scope(node);

                let name = self.ast().name(id);

                self.b.define_function_name(id, &name, node);
            }
        } else if id != 0 && kind != N_ARROW_FUNCTION_EXPRESSION {
            let name = self.ast().name(id);

            self.b.define_function_name(id, &name, node);
        }

        // A decorator on a method's parameter is evaluated where the class is
        // defined, not where the method runs.
        if is_method {
            self.visit_parameter_decorators(node);
        }

        self.b.nest_function_scope(node, is_method);
        self.visit_parameters(node, !is_method);
        self.visit_type(self.ast().child(node, 4));
        self.visit_type(self.ast().child(node, 3));

        let body = self.ast().child(node, 2);

        if body != 0 {
            // The body's own block scope is skipped: a function body and its
            // parameters share one scope.
            if self.ast().kind(body) == N_BLOCK_STATEMENT {
                self.visit_list(body, 0);
            } else {
                self.visit(body);
            }
        }

        self.close(node);
    }

    /// Binds every parameter of a function.
    fn visit_parameters(&mut self, node: u32, with_decorators: bool) {
        let size = self.ast().list_size(node, 1);

        for index in 0..size {
            let param = self.ast().list_item(node, 1, index);

            if param == 0 {
                continue;
            }

            let walk = collect_pattern(self.ast(), param);

            for event in &walk.events {
                let name = self.ast().name(event.pattern);

                self.b
                    .define_parameter(event.pattern, &name, node, index as i32, event.rest);
                self.referencing_default_value(event.pattern, &event.assignments, 0, true);
            }

            for &right in &walk.right_hand_nodes {
                self.visit(right);
            }

            self.visit_parameter_type_annotation(param);

            if with_decorators {
                self.visit_parameter_decorators_of(param);
            }
        }
    }

    /// Visits the decorators of every parameter of a function.
    fn visit_parameter_decorators(&mut self, node: u32) {
        let size = self.ast().list_size(node, 1);

        for index in 0..size {
            let param = self.ast().list_item(node, 1, index);

            if param != 0 {
                self.visit_parameter_decorators_of(param);
            }
        }
    }

    /// Visits the decorators attached to one parameter.
    fn visit_parameter_decorators_of(&mut self, param: u32) {
        let size = self.ast().parameter_decorator_size(param);

        for i in 0..size {
            self.visit(self.ast().parameter_decorator_at(param, i));
        }
    }

    /// Visits the type annotation of a parameter, wherever it hides.
    fn visit_parameter_type_annotation(&mut self, param: u32) {
        let kind = self.ast().kind(param);

        if kind == N_ASSIGNMENT_PATTERN {
            self.visit_type(self.type_annotation_of(self.ast().child(param, 0)));
        } else if kind == N_TS_PARAMETER_PROPERTY {
            let inner = self.ast().child(param, 0);

            if inner != 0 {
                self.visit_parameter_type_annotation(inner);
            }
        } else {
            self.visit_type(self.type_annotation_of(param));
        }
    }

    //-------------------------------------------------------------------------
    // Classes
    //-------------------------------------------------------------------------

    /// Visits a class, which binds its own name twice.
    fn visit_class(&mut self, node: u32, kind: u32) {
        let id = self.ast().child(node, 0);

        if kind == N_CLASS_DECLARATION && id != 0 {
            let name = self.ast().name(id);

            self.b.define_class_name(id, &name, node);
        }

        self.visit_list(node, 6);
        self.b.nest_class_scope(node);

        if id != 0 {
            let name = self.ast().name(id);

            self.b.define_class_name(id, &name, node);
        }

        self.visit(self.ast().child(node, 1));
        self.visit_type(self.ast().child(node, 3));
        self.visit_type(self.ast().child(node, 4));
        self.visit_type_list(node, 5);
        self.visit_class_body(self.ast().child(node, 2));
        self.close(node);
    }

    /// Visits the members of a class body.
    fn visit_class_body(&mut self, body: u32) {
        if body == 0 || self.ast().kind(body) != N_CLASS_BODY {
            return;
        }

        let size = self.ast().list_size(body, 0);

        for i in 0..size {
            let member = self.ast().list_item(body, 0, i);

            if member != 0 {
                self.visit_class_member(member);
            }
        }
    }

    /// Visits one member of a class body.
    fn visit_class_member(&mut self, member: u32) {
        match self.ast().kind(member) {
            k if k == N_METHOD_DEFINITION => self.visit_method(member, true),
            // An abstract method has no body to enter.
            k if k == N_TS_ABSTRACT_METHOD_DEFINITION => self.visit_method(member, false),
            k if k == N_PROPERTY_DEFINITION || k == N_ACCESSOR_PROPERTY => {
                self.visit_class_property(member, true);
            }
            k if k == N_TS_ABSTRACT_PROPERTY_DEFINITION
                || k == N_TS_ABSTRACT_ACCESSOR_PROPERTY =>
            {
                self.visit_class_property(member, false);
            }
            k if k == N_STATIC_BLOCK => {
                self.b.nest_class_static_block_scope(member);
                self.visit_list(member, 0);
                self.close(member);
            }
            k if k == N_TS_INDEX_SIGNATURE => self.visit_type(member),
            _ => self.visit(member),
        }
    }

    /// Visits a method definition.
    fn visit_method(&mut self, member: u32, has_body: bool) {
        let value = self.ast().child(member, 1);

        if self.ast().computed(member) {
            self.visit(self.ast().child(member, 0));
        }

        if has_body && value != 0 && self.ast().kind(value) == N_FUNCTION_EXPRESSION {
            self.visit_function(value, N_FUNCTION_EXPRESSION, true);
        } else {
            self.visit(value);
        }

        self.visit_list(member, 2);
    }

    /// Visits a class field, whose initializer runs in a scope of its own.
    fn visit_class_property(&mut self, member: u32, has_initializer_scope: bool) {
        let value = self.ast().child(member, 1);

        if self.ast().computed(member) {
            self.visit(self.ast().child(member, 0));
        }

        if value != 0 {
            if has_initializer_scope {
                self.b.nest_class_field_initializer_scope(value);
            }

            self.visit(value);

            if has_initializer_scope {
                self.close(value);
            }
        }

        self.visit_list(member, 2);
        self.visit_type(self.ast().child(member, 3));
    }

    /// Visits an object literal property's key and value.
    fn visit_property_like(&mut self, node: u32) {
        // An ordinary key is a property name, not a variable.
        if self.ast().computed(node) {
            self.visit(self.ast().child(node, 0));
        }

        self.visit(self.ast().child(node, 1));
    }

    //-------------------------------------------------------------------------
    // Modules
    //-------------------------------------------------------------------------

    /// Visits an import declaration, binding every name it brings in.
    fn visit_import_declaration(&mut self, node: u32) {
        let size = self.ast().list_size(node, 0);

        for i in 0..size {
            let specifier = self.ast().list_item(node, 0, i);

            if specifier == 0 {
                continue;
            }

            // The local name is the last slot on an `ImportSpecifier` and the
            // only one on the default and namespace forms.
            let slot = if self.ast().kind(specifier) == N_IMPORT_SPECIFIER {
                1
            } else {
                0
            };
            let local = self.ast().child(specifier, slot);

            if local == 0 {
                continue;
            }

            let name = self.ast().name(local);

            self.b.define_import_binding(local, &name, specifier, node);
        }
    }

    /// Visits a named export.
    fn visit_export_named(&mut self, node: u32) {
        // `export { x } from "m"` names nothing in this program.
        if self.ast().child(node, 2) != 0 {
            return;
        }

        let declaration = self.ast().child(node, 0);

        if declaration != 0 {
            self.visit(declaration);
            return;
        }

        let type_only = self.ast().type_only(node);
        let size = self.ast().list_size(node, 1);

        for i in 0..size {
            let specifier = self.ast().list_item(node, 1, i);

            if specifier == 0 {
                continue;
            }

            let local = self.ast().child(specifier, 0);

            if local == 0 || self.ast().kind(local) != N_IDENTIFIER {
                continue;
            }

            let specifier_type_only = self.ast().type_only(specifier);

            self.reference_exported_name(local, type_only || specifier_type_only);
        }
    }

    /// Visits a default export.
    fn visit_export_default(&mut self, node: u32) {
        let declaration = self.ast().child(node, 0);

        if declaration == 0 {
            return;
        }

        if self.ast().kind(declaration) == N_IDENTIFIER {
            let type_only = self.ast().type_only(node);

            self.reference_exported_name(declaration, type_only);
            return;
        }

        self.visit(declaration);
    }

    /// Records the reference that exporting a name by itself creates.
    fn reference_exported_name(&mut self, local: u32, type_only: bool) {
        let name = self.ast().name(local);

        if !self.typescript {
            self.b.reference_read(local, &name);
            return;
        }

        if type_only {
            self.b.reference_type(local, &name);
        } else {
            self.b.reference_dual_value_type(local, &name);
        }
    }

    //-------------------------------------------------------------------------
    // JSX
    //-------------------------------------------------------------------------

    /// Visits a JSX element: only the opening element and the children.
    fn visit_jsx_element(&mut self, node: u32) {
        if !self.jsx {
            self.visit_children(node, N_JSX_ELEMENT);
            return;
        }

        self.visit(self.ast().child(node, 0));
        self.visit_list(node, 2);
    }

    /// Visits a JSX fragment.
    fn visit_jsx_fragment(&mut self, node: u32) {
        self.reference_jsx_pragma();
        self.reference_jsx_fragment();
        self.visit_list(node, 2);
    }

    /// Visits a JSX opening tag. A lowercase tag name is a host element such
    /// as `div`, not a variable.
    fn visit_jsx_opening_element(&mut self, node: u32) {
        let name = self.ast().child(node, 0);

        self.reference_jsx_pragma();

        if self.jsx && name != 0 {
            let kind = self.ast().kind(name);

            if kind == N_JSX_MEMBER_EXPRESSION {
                self.visit(name);
            } else if kind == N_JSX_IDENTIFIER {
                let text = self.ast().name(name);

                if first_unit_is_uppercase(&text) {
                    self.visit(name);
                }
            }
        }

        self.visit_type(self.ast().child(node, 3));
        self.visit_list(node, 1);
    }

    /// References the JSX element factory, once per program.
    fn reference_jsx_pragma(&mut self) {
        if self.referenced_jsx_factory {
            return;
        }

        let Some(pragma) = self.jsx_pragma.clone() else {
            return;
        };

        self.referenced_jsx_factory = self.b.reference_if_declared(&pragma);
    }

    /// References the JSX fragment factory, once per program.
    fn reference_jsx_fragment(&mut self) {
        if self.referenced_jsx_fragment_factory {
            return;
        }

        let Some(fragment) = self.jsx_fragment_name.clone() else {
            return;
        };

        self.referenced_jsx_fragment_factory = self.b.reference_if_declared(&fragment);
    }

    //-------------------------------------------------------------------------
    // TypeScript Declarations
    //-------------------------------------------------------------------------

    /// Visits an enum, whose members are bound in a scope of their own.
    fn visit_enum(&mut self, node: u32) {
        let id = self.ast().child(node, 0);

        if id != 0 {
            let name = self.ast().name(id);

            self.b.define_enum_name(id, &name, node);
        }

        self.b.nest_ts_enum_scope(node);

        let body = self.ast().child(node, 1);

        if body != 0 {
            let size = self.ast().list_size(body, 0);

            for i in 0..size {
                let member = self.ast().list_item(body, 0, i);

                if member == 0 {
                    continue;
                }

                self.visit_enum_member(member);
            }
        }

        self.close(node);
    }

    /// Binds one enum member and visits its initializer.
    fn visit_enum_member(&mut self, member: u32) {
        let id = self.ast().child(member, 0);

        if id != 0 {
            let kind = self.ast().kind(id);

            if kind == N_IDENTIFIER {
                let name = self.ast().name(id);

                self.b.define_enum_member(id, &name, member);
            } else if kind == N_LITERAL {
                let name = self.ast().literal_string(id);

                self.b.define_enum_member_literal(&name, id, member);
            }
        }

        self.visit(self.ast().child(member, 1));
    }

    /// Visits a namespace or module declaration.
    fn visit_module_declaration(&mut self, node: u32) {
        let id = self.ast().child(node, 0);

        // `declare global` reopens the global scope rather than introducing a
        // name.
        if id != 0 && self.ast().kind(id) == N_IDENTIFIER && !self.ast().is_global_module(node) {
            let name = self.ast().name(id);

            self.b.define_module_name(id, &name, node);
        }

        self.b.nest_ts_module_scope(node);
        self.visit(self.ast().child(node, 1));
        self.close(node);
    }

    /// Visits an `import x = require("m")` declaration.
    fn visit_import_equals(&mut self, node: u32) {
        let id = self.ast().child(node, 0);

        if id != 0 {
            let name = self.ast().name(id);

            self.b.define_import_binding(id, &name, node, node);
        }

        let mut reference = self.ast().child(node, 1);

        // Only the leftmost name of `A.B.C` is a variable.
        while reference != 0 && self.ast().kind(reference) == N_TS_QUALIFIED_NAME {
            reference = self.ast().child(reference, 0);
        }

        self.visit(reference);
    }

    /// Visits an `export = x` assignment.
    fn visit_export_assignment(&mut self, node: u32) {
        let expression = self.ast().child(node, 0);

        if expression != 0 && self.ast().kind(expression) == N_IDENTIFIER {
            let name = self.ast().name(expression);

            self.b.reference_dual_value_type(expression, &name);
            return;
        }

        self.visit(expression);
    }

    //-------------------------------------------------------------------------
    // Types
    //-------------------------------------------------------------------------

    /// Visits every element of a slot's list as type nodes.
    fn visit_type_list(&mut self, node: u32, slot: usize) {
        let size = self.ast().list_size(node, slot);

        for i in 0..size {
            self.visit_type(self.ast().list_item(node, slot, i));
        }
    }

    /// Visits a node in type position.
    fn visit_type(&mut self, node: u32) {
        if node == 0 {
            return;
        }

        let kind = self.ast().kind(node);

        match kind {
            k if k == N_IDENTIFIER => {
                let name = self.ast().name(node);

                self.b.reference_type(node, &name);
            }
            // Only the leftmost name of `A.B.C` names anything bound.
            k if k == N_MEMBER_EXPRESSION || k == N_TS_QUALIFIED_NAME => {
                self.visit_type(self.ast().child(node, 0));
            }
            k if k == N_TS_FUNCTION_TYPE
                || k == N_TS_CONSTRUCTOR_TYPE
                || k == N_TS_CALL_SIGNATURE_DECLARATION
                || k == N_TS_CONSTRUCT_SIGNATURE_DECLARATION =>
            {
                self.visit_function_type(node, 0, 1, 2);
            }
            k if k == N_TS_METHOD_SIGNATURE => {
                self.visit_property_key(node);
                self.visit_function_type(node, 1, 2, 3);
            }
            k if k == N_TS_PROPERTY_SIGNATURE => {
                self.visit_property_key(node);
                self.visit_type(self.ast().child(node, 1));
            }
            k if k == N_TS_CONDITIONAL_TYPE => self.visit_conditional_type(node),
            k if k == N_TS_MAPPED_TYPE => self.visit_mapped_type(node),
            k if k == N_TS_INFER_TYPE => self.visit_infer_type(node),
            k if k == N_TS_TYPE_PARAMETER => self.visit_type_parameter(node),
            k if k == N_TS_INTERFACE_DECLARATION => self.visit_interface_declaration(node),
            k if k == N_TS_TYPE_ALIAS_DECLARATION => self.visit_type_alias_declaration(node),
            k if k == N_TS_INDEX_SIGNATURE => self.visit_index_signature(node),
            k if k == N_TS_TYPE_QUERY => self.visit_type_query(node),
            k if k == N_TS_TYPE_PREDICATE => self.visit_type_predicate(node),
            // The label is not a reference to anything.
            k if k == N_TS_NAMED_TUPLE_MEMBER => {
                self.visit_type(self.ast().child(node, 1));
            }
            k if k == N_TS_IMPORT_TYPE => {
                self.visit_type(self.ast().child(node, 2));
            }
            _ => self.visit_type_children(node, kind),
        }
    }

    /// Visits every child of a type node that has no rule of its own.
    fn visit_type_children(&mut self, node: u32, kind: u32) {
        let base = kind as usize * SLOT_COUNT;

        for slot in 0..SLOT_COUNT {
            let descriptor = SLOT_TABLE[base + slot] as u32;

            if descriptor == SLOT_NODE {
                self.visit_type(self.ast().child(node, slot));
            } else if descriptor == SLOT_LIST {
                self.visit_type_list(node, slot);
            }
        }
    }

    /// Visits a computed key in a type member, which is ordinary code.
    fn visit_property_key(&mut self, node: u32) {
        if self.ast().computed(node) {
            self.visit(self.ast().child(node, 0));
        }
    }

    /// Visits a function type, whose parameters are bound in a scope of their
    /// own.
    fn visit_function_type(
        &mut self,
        node: u32,
        params_slot: usize,
        return_type_slot: usize,
        type_parameters_slot: usize,
    ) {
        self.b.nest_function_type_scope(node);
        self.visit_type(self.ast().child(node, type_parameters_slot));

        let size = self.ast().list_size(node, params_slot);

        for index in 0..size {
            let param = self.ast().list_item(node, params_slot, index);

            if param == 0 {
                continue;
            }

            let mut visited_annotation = false;
            let walk = collect_pattern(self.ast(), param);

            for event in &walk.events {
                let name = self.ast().name(event.pattern);

                self.b
                    .define_parameter(event.pattern, &name, node, index as i32, event.rest);

                let annotation = self.type_annotation_of(event.pattern);

                if annotation != 0 {
                    self.visit_type(annotation);
                    visited_annotation = true;
                }
            }

            if !visited_annotation {
                self.visit_type(self.type_annotation_of(param));
            }
        }

        self.visit_type(self.ast().child(node, return_type_slot));
        self.close(node);
    }

    /// Visits a conditional type. Its `infer` names are visible in the true
    /// branch but not in the false one.
    fn visit_conditional_type(&mut self, node: u32) {
        self.b.nest_conditional_type_scope(node);
        self.visit_type(self.ast().child(node, 0));
        self.visit_type(self.ast().child(node, 1));
        self.visit_type(self.ast().child(node, 2));
        self.close(node);
        self.visit_type(self.ast().child(node, 3));
    }

    /// Visits a mapped type, whose key is bound for the rest of the type.
    fn visit_mapped_type(&mut self, node: u32) {
        let key = self.ast().mapped_type_key(node);

        self.b.nest_mapped_type_scope(node);

        if key != 0 {
            let name = self.ast().name(key);
            let scope = self.b.current_scope();

            self.b.define_type(scope, key, &name, node);
        }

        self.visit_type(self.ast().mapped_type_constraint(node));
        self.visit_type(self.ast().child(node, 2));
        self.visit_type(self.ast().child(node, 3));
        self.close(node);
    }

    /// Visits an `infer T`, binding `T` where it can be referred to.
    fn visit_infer_type(&mut self, node: u32) {
        let type_parameter = self.ast().child(node, 0);

        if type_parameter == 0 {
            return;
        }

        let name_node = self.ast().child(type_parameter, 0);
        let mut scope = self.b.current_scope();

        // An `infer` inside a function or mapped type nested in a conditional
        // type belongs to the conditional type.
        let scope_type = self.b.scope_type(scope);

        if scope_type == CODE_FUNCTION_TYPE || scope_type == CODE_MAPPED_TYPE {
            let mut current = self.b.upper_of(scope);

            while current != -1 {
                let current_type = self.b.scope_type(current);

                if current_type == CODE_FUNCTION_TYPE || current_type == CODE_MAPPED_TYPE {
                    current = self.b.upper_of(current);
                    continue;
                }

                if current_type == CODE_CONDITIONAL_TYPE {
                    scope = current;
                }

                break;
            }
        }

        if name_node != 0 {
            let name = self.ast().name(name_node);

            self.b.define_type(scope, name_node, &name, type_parameter);
        }

        self.visit_type(self.ast().child(type_parameter, 1));
    }

    /// Visits a type parameter declaration.
    fn visit_type_parameter(&mut self, node: u32) {
        let name_node = self.ast().child(node, 0);

        if name_node != 0 {
            let name = self.ast().name(name_node);
            let scope = self.b.current_scope();

            self.b.define_type(scope, name_node, &name, node);
        }

        self.visit_type(self.ast().child(node, 1));
        self.visit_type(self.ast().child(node, 2));
    }

    /// Visits an interface declaration.
    fn visit_interface_declaration(&mut self, node: u32) {
        let id = self.ast().child(node, 0);
        let type_parameters = self.ast().child(node, 2);

        if id != 0 {
            let name = self.ast().name(id);
            let scope = self.b.current_scope();

            self.b.define_type(scope, id, &name, node);
        }

        // The scope exists only to hold type parameters, so it is optional.
        if type_parameters != 0 {
            self.b.nest_type_scope(node);
            self.visit_type(type_parameters);
        }

        self.visit_type_list(node, 3);
        self.visit_type(self.ast().child(node, 1));

        if type_parameters != 0 {
            self.close(node);
        }
    }

    /// Visits a type alias declaration.
    fn visit_type_alias_declaration(&mut self, node: u32) {
        let id = self.ast().child(node, 0);
        let type_parameters = self.ast().child(node, 2);

        if id != 0 {
            let name = self.ast().name(id);
            let scope = self.b.current_scope();

            self.b.define_type(scope, id, &name, node);
        }

        if type_parameters != 0 {
            self.b.nest_type_scope(node);
            self.visit_type(type_parameters);
        }

        self.visit_type(self.ast().child(node, 1));

        if type_parameters != 0 {
            self.close(node);
        }
    }

    /// Visits an index signature, whose parameter names nothing.
    fn visit_index_signature(&mut self, node: u32) {
        let size = self.ast().list_size(node, 0);

        for i in 0..size {
            let parameter = self.ast().list_item(node, 0, i);

            if parameter != 0 && self.ast().kind(parameter) == N_IDENTIFIER {
                self.visit_type(self.type_annotation_of(parameter));
            }
        }

        self.visit_type(self.ast().child(node, 1));
    }

    /// Visits a `typeof x` type, where the name is a value even though the
    /// position is a type.
    fn visit_type_query(&mut self, node: u32) {
        let expr_name = self.ast().child(node, 0);
        let mut entity_name = expr_name;

        if expr_name != 0 && self.ast().kind(expr_name) == N_TS_QUALIFIED_NAME {
            let mut left = self.ast().child(expr_name, 0);

            while left != 0 && self.ast().kind(left) == N_TS_QUALIFIED_NAME {
                left = self.ast().child(left, 0);
            }

            entity_name = left;
        } else if expr_name != 0 && self.ast().kind(expr_name) == N_TS_IMPORT_TYPE {
            self.visit_type(expr_name);
        }

        if entity_name != 0 && self.ast().kind(entity_name) == N_IDENTIFIER {
            let name = self.ast().name(entity_name);

            self.b.reference_read(entity_name, &name);
        }

        self.visit_type(self.ast().child(node, 1));
    }

    /// Visits a type predicate, whose parameter name is a value.
    fn visit_type_predicate(&mut self, node: u32) {
        let parameter_name = self.ast().child(node, 0);

        if parameter_name != 0 && self.ast().kind(parameter_name) != N_TS_THIS_TYPE {
            let name = self.ast().name(parameter_name);

            self.b.reference_read(parameter_name, &name);
        }

        self.visit_type(self.ast().child(node, 1));
    }

    /// The type annotation attached to a binding, if it can carry one.
    fn type_annotation_of(&self, node: u32) -> u32 {
        if node == 0 {
            return 0;
        }

        match self.ast().kind(node) {
            k if k == N_IDENTIFIER
                || k == N_ARRAY_PATTERN
                || k == N_OBJECT_PATTERN
                || k == N_REST_ELEMENT =>
            {
                self.ast().child(node, 1)
            }
            _ => 0,
        }
    }

    /// Whether a declaration binds names that a loop's own scope should hold.
    fn is_lexical_declaration(&self, node: u32) -> bool {
        self.ast().kind(node) == N_VARIABLE_DECLARATION
            && self.ast().declaration_kind_code(node) != 0
    }
}

/// The pattern events and right-hand list live in `pattern.rs`; re-exported
/// here so callers can name them through the walk module.
pub use super::pattern::PatternWalk;
#[allow(unused_imports)]
pub use super::pattern::PatternEvent as _PatternEvent;
