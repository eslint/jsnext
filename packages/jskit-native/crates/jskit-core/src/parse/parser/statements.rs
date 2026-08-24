//! The statement, declaration, and module grammar, plus `parse_program()`.
//!
//! Port of `packages/jskit/src/parse/parser.ts`.

use super::{PRes, Parser};
use crate::parse::node_kinds::*;
use crate::parse::token_kinds::*;

/// The spelling the `"use strict"` directive must have, quotes aside.
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

impl<'a> Parser<'a> {
    //-------------------------------------------------------------------------
    // Program
    //-------------------------------------------------------------------------

    /// Parses the whole source text.
    pub fn parse_program(&mut self) -> PRes {
        let node = self.writer.alloc(N_PROGRAM, 0);
        let mark = self.writer.start_list();

        // Where the first token begins, which is not always where the first
        // statement begins: decorators written before an `export` sit outside
        // the node they decorate.
        let first_token_start = self.start();

        self.parse_statement_list(T_EOF)?;

        // A program spans its statements, not the whole file. An empty
        // program keeps the whole text so that its range is never inverted.
        let size = self.writer.list_size(mark);
        let start = if size == 0 { 0 } else { first_token_start };
        let end = if size == 0 {
            self.source.len() as u32
        } else {
            self.last_end()
        };

        self.writer.set(node, NODE_START, start);

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, end))
    }

    /// Parses statements until a closing token, marking the directive
    /// prologue as it goes.
    fn parse_statement_list(&mut self, terminator: u32) -> PRes<()> {
        let mut in_prologue = true;

        while !self.at(terminator) && !self.at(T_EOF) {
            let statement = self.parse_statement(false)?;

            if in_prologue {
                if self.is_directive(statement) {
                    self.writer.set(statement, NODE_B, 1);

                    if self.is_use_strict(statement) {
                        self.writer.add_flags(statement, NF_USE_STRICT);
                    }
                } else {
                    in_prologue = false;
                }
            }

            self.writer.push_list(statement);
        }

        Ok(())
    }

    /// Whether a statement belongs to a directive prologue.
    fn is_directive(&self, statement: u32) -> bool {
        if self.writer.get(statement, NODE_KIND) != N_EXPRESSION_STATEMENT {
            return false;
        }

        let expression = self.writer.get(statement, NODE_A);

        if self.writer.get(expression, NODE_KIND) != N_LITERAL {
            return false;
        }

        // Only a string literal is a directive.
        if self.writer.get(expression, NODE_A) != LIT_STRING {
            return false;
        }

        // A directive "consists entirely of a StringLiteral token", so
        // `("use strict")` is not one.
        self.writer.get(expression, NODE_START) == self.writer.get(statement, NODE_START)
    }

    /// Whether a directive is the `"use strict"` directive.
    fn is_use_strict(&self, statement: u32) -> bool {
        let expression = self.writer.get(statement, NODE_A);
        let start = self.writer.get(expression, NODE_START);

        if self.writer.get(expression, NODE_END) - start != 12 {
            return false;
        }

        for (i, &expected) in USE_STRICT.iter().enumerate() {
            if self.source[start as usize + 1 + i] != expected {
                return false;
            }
        }

        true
    }

    //-------------------------------------------------------------------------
    // Statements
    //-------------------------------------------------------------------------

    /// Parses a single statement or declaration.
    pub fn parse_statement(&mut self, single: bool) -> PRes {
        let start = self.start();

        match self.kind() {
            k if k == T_BRACE_OPEN => return self.parse_block(false, true),
            k if k == T_SEMICOLON => {
                let node = self.writer.alloc(N_EMPTY_STATEMENT, start);
                let end = self.end();

                self.next()?;

                return Ok(self.writer.finish(node, end));
            }
            k if k == T_VAR => return self.parse_variable_statement(DECL_VAR, start),
            k if k == T_CONST => {
                if self.next_is(T_ENUM, false)? {
                    self.next()?;

                    return self.parse_enum_declaration(start, NF_CONST);
                }

                return self.parse_variable_statement(DECL_CONST, start);
            }
            k if k == T_LET => {
                // A single-statement position takes no declaration, so `let`
                // written there is an ordinary identifier — except before a
                // `[`, which no `ExpressionStatement` may begin with.
                if self.next_starts_binding()?
                    && (!single || self.next_is(T_BRACKET_OPEN, false)?)
                {
                    return self.parse_variable_statement(DECL_LET, start);
                }
            }
            k if k == T_USING => {
                if self.using_starts_binding()? {
                    return self.parse_variable_statement(DECL_USING, start);
                }
            }
            k if k == T_FUNCTION => {
                return self.parse_function_declaration(start, false, 0);
            }
            k if k == T_CLASS => return self.parse_class(N_CLASS_DECLARATION, 0, start),
            k if k == T_AT => {
                let decorators = self.parse_decorators()?;

                // Decorators may sit on either side of `export`.
                if self.at(T_EXPORT) {
                    return self.parse_decorated_export(decorators);
                }

                return self.parse_decorated_class(decorators, start);
            }
            k if k == T_IF => return self.parse_if_statement(),
            k if k == T_FOR => return self.parse_for_statement(),
            k if k == T_WHILE => return self.parse_while_statement(),
            k if k == T_DO => return self.parse_do_while_statement(),
            k if k == T_SWITCH => return self.parse_switch_statement(),
            k if k == T_TRY => return self.parse_try_statement(),
            k if k == T_THROW => return self.parse_throw_statement(),
            k if k == T_RETURN => return self.parse_return_statement(),
            k if k == T_BREAK || k == T_CONTINUE => return self.parse_break_or_continue(),
            k if k == T_WITH => return self.parse_with_statement(),
            k if k == T_DEBUGGER => {
                let node = self.writer.alloc(N_DEBUGGER_STATEMENT, start);

                self.next()?;
                self.semicolon()?;

                return Ok(self.writer.finish(node, self.last_end()));
            }
            k if k == T_IMPORT => {
                if self.import_is_declaration()? {
                    return self.parse_import_declaration();
                }
            }
            k if k == T_EXPORT => return self.parse_export_declaration(),
            k if k == T_ASYNC => {
                if self.async_starts_function()? {
                    self.next()?;

                    return self.parse_function_declaration(start, true, 0);
                }
            }
            k if k == T_AWAIT => {
                if self.await_starts_using()? {
                    self.next()?;

                    // The `await` has already been consumed, so the
                    // declaration's own start has to be handed down.
                    return self.parse_variable_statement(DECL_AWAIT_USING, start);
                }
            }
            k if k == T_INTERFACE => {
                if self.next_starts_binding()? {
                    return self.parse_interface_declaration(start, 0);
                }
            }
            k if k == T_TYPE => {
                if self.type_starts_alias()? {
                    return self.parse_type_alias_declaration(start, 0);
                }
            }
            k if k == T_ENUM => return self.parse_enum_declaration(start, 0),
            k if k == T_DECLARE => {
                if self.declare_starts_declaration()? {
                    return self.parse_declare(start);
                }
            }
            k if k == T_ABSTRACT => {
                if self.next_is(T_CLASS, true)? {
                    self.next()?;

                    let node = self.parse_class(N_CLASS_DECLARATION, 0, start)?;

                    self.writer.add_flags(node, NF_ABSTRACT);

                    return Ok(self.writer.finish(node, self.last_end()));
                }
            }
            k if k == T_NAMESPACE || k == T_MODULE => {
                if self.next_starts_module_name()? {
                    return self.parse_module_declaration(start, 0);
                }
            }
            k if k == T_GLOBAL => {
                if self.next_is(T_BRACE_OPEN, false)? {
                    return self.parse_module_declaration(start, 0);
                }
            }
            _ => {}
        }

        self.parse_expression_or_labeled_statement()
    }

    /// Parses a brace-delimited block of statements.
    pub fn parse_block(&mut self, with_directives: bool, is_statement: bool) -> PRes {
        let node = self.writer.alloc(N_BLOCK_STATEMENT, self.start());
        let mark = self.writer.start_list();

        // A statement list is never parameterized by `[In]`, so the ban a
        // `for` head puts on the `in` operator ends at the brace.
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = (|| -> PRes<()> {
            self.enter_brace(is_statement)?;

            if with_directives {
                self.parse_statement_list(T_BRACE_CLOSE)?;
            } else {
                while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
                    let statement = self.parse_statement(false)?;

                    self.writer.push_list(statement);
                }
            }

            self.expect(T_BRACE_CLOSE)
        })();

        self.allow_in = previous_allow_in;
        result?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an expression statement or a labeled statement.
    fn parse_expression_or_labeled_statement(&mut self) -> PRes {
        let start = self.start();
        let expression = self.parse_expression()?;

        if self.at(T_COLON)
            && self.writer.get(expression, NODE_KIND) == N_IDENTIFIER
            && self.writer.get(expression, NODE_B) == 0
        {
            let node = self.writer.alloc(N_LABELED_STATEMENT, start);

            self.next()?;
            self.writer.set(node, NODE_A, expression);

            let body = self.parse_statement(true)?;

            self.writer.set(node, NODE_B, body);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let node = self.writer.alloc(N_EXPRESSION_STATEMENT, start);

        self.writer.set(node, NODE_A, expression);
        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a variable statement and its terminating semicolon.
    fn parse_variable_statement(&mut self, declaration_kind: u32, start: u32) -> PRes {
        let node = self.parse_variable_declaration(declaration_kind, start)?;

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a variable declaration without its terminating semicolon.
    fn parse_variable_declaration(&mut self, declaration_kind: u32, start: u32) -> PRes {
        let node = self.writer.alloc(N_VARIABLE_DECLARATION, start);
        let mark = self.writer.start_list();

        self.writer.add_flags(node, declaration_kind << DECL_SHIFT);
        self.next()?;

        loop {
            let declarator = self.writer.alloc(N_VARIABLE_DECLARATOR, self.start());
            let target = self.parse_binding_atom()?;

            if self.at(T_NOT) {
                self.next()?;
                self.writer.add_flags(declarator, NF_DEFINITE);
            }

            let annotation = self.try_parse_type_annotation()?;

            if annotation != 0 {
                self.writer.set(target, NODE_B, annotation);
                self.writer.finish(target, self.last_end());
            }

            self.writer.set(declarator, NODE_A, target);

            if self.eat(T_ASSIGN)? {
                let init = self.parse_assignment_expression()?;

                self.writer.set(declarator, NODE_B, init);
            }

            let finished = self.writer.finish(declarator, self.last_end());

            self.writer.push_list(finished);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a function declaration.
    fn parse_function_declaration(&mut self, start: u32, is_async: bool, flags: u32) -> PRes {
        let node = self.writer.alloc(N_FUNCTION_DECLARATION, start);

        self.writer.add_flags(node, flags);
        self.next()?;

        let is_generator = self.eat(T_STAR)?;

        if is_async {
            self.writer.add_flags(node, NF_ASYNC);
        }

        if is_generator {
            self.writer.add_flags(node, NF_GENERATOR);
        }

        if self.at_binding_name() {
            let id = self.parse_identifier()?;

            self.writer.set(node, NODE_A, id);
        }

        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_D, type_parameters);

        let parameters = self.parse_parameter_list(is_async, is_generator)?;

        self.writer.set(node, NODE_B, parameters);

        let return_type = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_E, return_type);

        if self.at(T_BRACE_OPEN) {
            let body = self.parse_function_body(is_async, is_generator, true)?;

            self.writer.set(node, NODE_C, body);
        } else {
            // A body-less function declaration is an overload signature.
            self.writer.retype(node, N_TS_DECLARE_FUNCTION);
            self.semicolon()?;
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // Control Flow
    //-------------------------------------------------------------------------

    /// Parses an `if` statement.
    fn parse_if_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_IF_STATEMENT, self.start());

        self.next()?;
        self.enter_statement_paren()?;

        let test = self.parse_expression()?;

        self.writer.set(node, NODE_A, test);
        self.expect(T_PAREN_CLOSE)?;

        let consequent = self.parse_statement(true)?;

        self.writer.set(node, NODE_B, consequent);

        if self.eat(T_ELSE)? {
            let alternate = self.parse_statement(true)?;

            self.writer.set(node, NODE_C, alternate);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `while` statement.
    fn parse_while_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_WHILE_STATEMENT, self.start());

        self.next()?;
        self.enter_statement_paren()?;

        let test = self.parse_expression()?;

        self.writer.set(node, NODE_A, test);
        self.expect(T_PAREN_CLOSE)?;

        let body = self.parse_statement(true)?;

        self.writer.set(node, NODE_B, body);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `do ... while` statement.
    fn parse_do_while_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_DO_WHILE_STATEMENT, self.start());

        self.next()?;

        let body = self.parse_statement(true)?;

        self.writer.set(node, NODE_A, body);
        self.expect(T_WHILE)?;
        self.enter_statement_paren()?;

        let test = self.parse_expression()?;

        self.writer.set(node, NODE_B, test);
        self.expect(T_PAREN_CLOSE)?;
        self.eat(T_SEMICOLON)?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses every form of `for` statement.
    fn parse_for_statement(&mut self) -> PRes {
        let start = self.start();

        self.next()?;

        let is_await = self.eat(T_AWAIT)?;

        self.enter_statement_paren()?;

        // `for (;` has no initializer at all.
        if self.at(T_SEMICOLON) {
            return self.finish_classic_for(start, 0);
        }

        let declaration_kind = self.declaration_kind_at_for_head()?;
        let init;

        if declaration_kind >= 0 {
            let previous_allow_in = self.allow_in;

            self.allow_in = false;

            let declaration_start = self.start();
            let result = (|| -> PRes {
                if declaration_kind == DECL_AWAIT_USING as i32 {
                    self.next()?;
                }

                self.parse_variable_declaration(declaration_kind as u32, declaration_start)
            })();

            self.allow_in = previous_allow_in;
            init = result?;
        } else {
            let previous_allow_in = self.allow_in;

            self.allow_in = false;

            let result = self.parse_expression();

            self.allow_in = previous_allow_in;
            init = result?;
        }

        if self.at(T_IN) || self.at(T_OF) {
            let is_of = self.at(T_OF);
            let node = self.writer.alloc(
                if is_of {
                    N_FOR_OF_STATEMENT
                } else {
                    N_FOR_IN_STATEMENT
                },
                start,
            );

            if declaration_kind < 0 {
                self.to_pattern(init);
            }

            self.next()?;
            self.writer.set(node, NODE_A, init);

            let right = if is_of {
                self.parse_assignment_expression()?
            } else {
                self.parse_expression()?
            };

            self.writer.set(node, NODE_B, right);
            self.expect(T_PAREN_CLOSE)?;

            let body = self.parse_statement(true)?;

            self.writer.set(node, NODE_C, body);

            if is_await {
                self.writer.add_flags(node, NF_ASYNC);
            }

            return Ok(self.writer.finish(node, self.last_end()));
        }

        self.finish_classic_for(start, init)
    }

    /// Finishes a three-part `for` statement once its initializer is known.
    fn finish_classic_for(&mut self, start: u32, init: u32) -> PRes {
        let node = self.writer.alloc(N_FOR_STATEMENT, start);

        self.writer.set(node, NODE_A, init);
        self.expect(T_SEMICOLON)?;

        if !self.at(T_SEMICOLON) {
            let test = self.parse_expression()?;

            self.writer.set(node, NODE_B, test);
        }

        self.expect(T_SEMICOLON)?;

        if !self.at(T_PAREN_CLOSE) {
            let update = self.parse_expression()?;

            self.writer.set(node, NODE_C, update);
        }

        self.expect(T_PAREN_CLOSE)?;

        let body = self.parse_statement(true)?;

        self.writer.set(node, NODE_D, body);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Which kind of declaration, if any, opens a `for` head; `-1` for an
    /// expression head.
    fn declaration_kind_at_for_head(&mut self) -> PRes<i32> {
        match self.kind() {
            k if k == T_VAR => Ok(DECL_VAR as i32),
            k if k == T_CONST => Ok(DECL_CONST as i32),
            k if k == T_LET => Ok(if self.next_starts_binding()? {
                DECL_LET as i32
            } else {
                -1
            }),
            k if k == T_USING => Ok(if self.using_starts_binding()? {
                DECL_USING as i32
            } else {
                -1
            }),
            k if k == T_AWAIT => Ok(if self.await_starts_using()? {
                DECL_AWAIT_USING as i32
            } else {
                -1
            }),
            _ => Ok(-1),
        }
    }

    /// Parses a `switch` statement.
    fn parse_switch_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_SWITCH_STATEMENT, self.start());

        self.next()?;
        self.enter_statement_paren()?;

        let discriminant = self.parse_expression()?;

        self.writer.set(node, NODE_A, discriminant);
        self.expect(T_PAREN_CLOSE)?;

        let mark = self.writer.start_list();

        self.enter_brace(true)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            let clause = self.writer.alloc(N_SWITCH_CASE, self.start());

            if self.eat(T_CASE)? {
                let test = self.parse_expression()?;

                self.writer.set(clause, NODE_A, test);
            } else {
                self.expect(T_DEFAULT)?;
            }

            self.expect(T_COLON)?;

            let body = self.writer.start_list();

            while !self.at(T_CASE)
                && !self.at(T_DEFAULT)
                && !self.at(T_BRACE_CLOSE)
                && !self.at(T_EOF)
            {
                let statement = self.parse_statement(false)?;

                self.writer.push_list(statement);
            }

            let body_list = self.writer.end_list(body);

            self.writer.set(clause, NODE_B, body_list);

            let finished = self.writer.finish(clause, self.last_end());

            self.writer.push_list(finished);
        }

        self.expect(T_BRACE_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_B, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `try` statement.
    fn parse_try_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_TRY_STATEMENT, self.start());

        self.next()?;

        let block = self.parse_block(false, true)?;

        self.writer.set(node, NODE_A, block);

        if self.at(T_CATCH) {
            let handler = self.writer.alloc(N_CATCH_CLAUSE, self.start());

            self.next()?;

            if self.eat(T_PAREN_OPEN)? {
                let parameter = self.parse_binding_atom()?;
                let annotation = self.try_parse_type_annotation()?;

                if annotation != 0 {
                    self.writer.set(parameter, NODE_B, annotation);
                    self.writer.finish(parameter, self.last_end());
                }

                self.writer.set(handler, NODE_A, parameter);
                self.expect(T_PAREN_CLOSE)?;
            }

            let body = self.parse_block(false, true)?;

            self.writer.set(handler, NODE_B, body);

            let finished = self.writer.finish(handler, self.last_end());

            self.writer.set(node, NODE_B, finished);
        }

        if self.eat(T_FINALLY)? {
            let finalizer = self.parse_block(false, true)?;

            self.writer.set(node, NODE_C, finalizer);
        }

        if self.writer.get(node, NODE_B) == 0 && self.writer.get(node, NODE_C) == 0 {
            return Err(self.error("Missing catch or finally clause"));
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `throw` statement.
    fn parse_throw_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_THROW_STATEMENT, self.start());

        self.next()?;

        if self.newline_before() {
            return Err(self.error("Illegal newline after throw"));
        }

        let argument = self.parse_expression()?;

        self.writer.set(node, NODE_A, argument);
        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `return` statement.
    fn parse_return_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_RETURN_STATEMENT, self.start());

        self.next()?;

        if !self.can_insert_semicolon() && !self.at(T_SEMICOLON) {
            let argument = self.parse_expression()?;

            self.writer.set(node, NODE_A, argument);
        }

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `break` or `continue` statement.
    fn parse_break_or_continue(&mut self) -> PRes {
        let node = self.writer.alloc(
            if self.at(T_BREAK) {
                N_BREAK_STATEMENT
            } else {
                N_CONTINUE_STATEMENT
            },
            self.start(),
        );

        self.next()?;

        if !self.can_insert_semicolon() && self.at_binding_name() {
            let label = self.parse_identifier()?;

            self.writer.set(node, NODE_A, label);
        }

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `with` statement.
    fn parse_with_statement(&mut self) -> PRes {
        let node = self.writer.alloc(N_WITH_STATEMENT, self.start());

        self.next()?;
        self.enter_statement_paren()?;

        let object = self.parse_expression()?;

        self.writer.set(node, NODE_A, object);
        self.expect(T_PAREN_CLOSE)?;

        let body = self.parse_statement(true)?;

        self.writer.set(node, NODE_B, body);

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // Modules
    //-------------------------------------------------------------------------

    /// Whether an `import` token starts a declaration rather than a dynamic
    /// import or `import.meta`.
    fn import_is_declaration(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let kind = self.kind();
        let result = kind != T_PAREN_OPEN && kind != T_DOT;

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Parses an import declaration, including `import x = require(...)`.
    fn parse_import_declaration(&mut self) -> PRes {
        let start = self.start();

        self.next()?;

        // `import x = require("m")` and `import x = A.B`.
        if self.at_binding_name() && self.next_is(T_ASSIGN, false)? {
            return self.parse_import_equals(start, false);
        }

        let node = self.writer.alloc(N_IMPORT_DECLARATION, start);
        let mark = self.writer.start_list();
        let mut type_only = false;

        if self.at(T_TYPE) && !self.next_is(T_FROM, false)? && !self.next_is(T_ASSIGN, false)? {
            let state = self.tokenizer.save();

            self.next()?;

            if self.at_binding_name() || self.at(T_BRACE_OPEN) || self.at(T_STAR) {
                type_only = true;

                if self.at_binding_name() && self.next_is(T_ASSIGN, false)? {
                    return self.parse_import_equals(start, true);
                }
            } else {
                self.tokenizer.restore(&state);
            }
        }

        if self.at(T_STRING) {
            // A bare `import "mod"` has no specifiers.
            let source = self.parse_literal()?;

            self.writer.set(node, NODE_B, source);

            let list = self.writer.end_list(mark);

            self.writer.set(node, NODE_A, list);

            let attributes = self.parse_import_attributes()?;

            self.writer.set(node, NODE_C, attributes);
            self.semicolon()?;

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if self.at_binding_name() {
            let specifier = self.writer.alloc(N_IMPORT_DEFAULT_SPECIFIER, self.start());
            let local = self.parse_identifier()?;

            self.writer.set(specifier, NODE_A, local);

            let finished = self.writer.finish(specifier, self.last_end());

            self.writer.push_list(finished);
            self.eat(T_COMMA)?;
        }

        if self.at(T_STAR) {
            let specifier = self
                .writer
                .alloc(N_IMPORT_NAMESPACE_SPECIFIER, self.start());

            self.next()?;
            self.expect(T_AS)?;

            let local = self.parse_identifier()?;

            self.writer.set(specifier, NODE_A, local);

            let finished = self.writer.finish(specifier, self.last_end());

            self.writer.push_list(finished);
        } else if self.at(T_BRACE_OPEN) {
            self.enter_brace(false)?;

            while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
                let specifier = self.parse_import_specifier()?;

                self.writer.push_list(specifier);

                if !self.eat(T_COMMA)? {
                    break;
                }
            }

            self.expect(T_BRACE_CLOSE)?;
        }

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);
        self.expect(T_FROM)?;

        let source = self.parse_literal()?;

        self.writer.set(node, NODE_B, source);

        let attributes = self.parse_import_attributes()?;

        self.writer.set(node, NODE_C, attributes);

        if type_only {
            self.writer.add_flags(node, NF_TYPE_ONLY);
        }

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses one `{ a as b }` import specifier.
    fn parse_import_specifier(&mut self) -> PRes {
        let node = self.writer.alloc(N_IMPORT_SPECIFIER, self.start());
        let mut type_only = false;

        if self.at(T_TYPE) && !self.next_is_as_rename()? && !self.next_is(T_COMMA, false)? {
            let state = self.tokenizer.save();

            self.next()?;

            if is_identifier_name_kind(self.kind()) || self.at(T_STRING) {
                type_only = true;
            } else {
                self.tokenizer.restore(&state);
            }
        }

        let imported = if self.at(T_STRING) {
            self.parse_literal()?
        } else {
            self.parse_identifier_name()?
        };

        self.writer.set(node, NODE_A, imported);

        if self.eat(T_AS)? {
            let local = self.parse_identifier()?;

            self.writer.set(node, NODE_B, local);
        } else {
            self.writer.set(node, NODE_B, imported);
        }

        if type_only {
            self.writer.add_flags(node, NF_TYPE_ONLY);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `with { ... }` or `assert { ... }` attributes clause.
    fn parse_import_attributes(&mut self) -> PRes {
        if (!self.at(T_WITH) && !self.at(T_ASSERT)) || self.newline_before() {
            return Ok(0);
        }

        self.next()?;

        let mark = self.writer.start_list();

        self.enter_brace(false)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            let attribute = self.writer.alloc(N_IMPORT_ATTRIBUTE, self.start());
            let key = if self.at(T_STRING) {
                self.parse_literal()?
            } else {
                self.parse_identifier_name()?
            };

            self.writer.set(attribute, NODE_A, key);
            self.expect(T_COLON)?;

            let value = self.parse_literal()?;

            self.writer.set(attribute, NODE_B, value);

            let finished = self.writer.finish(attribute, self.last_end());

            self.writer.push_list(finished);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect(T_BRACE_CLOSE)?;

        Ok(self.writer.end_list(mark))
    }

    /// Parses `import x = require("mod")` or `import x = A.B`.
    fn parse_import_equals(&mut self, start: u32, type_only: bool) -> PRes {
        let node = self.writer.alloc(N_TS_IMPORT_EQUALS_DECLARATION, start);
        let id = self.parse_identifier()?;

        self.writer.set(node, NODE_A, id);
        self.expect(T_ASSIGN)?;

        if self.at(T_REQUIRE) && self.next_is(T_PAREN_OPEN, false)? {
            let reference = self
                .writer
                .alloc(N_TS_EXTERNAL_MODULE_REFERENCE, self.start());

            self.next()?;
            self.expect(T_PAREN_OPEN)?;

            let expression = self.parse_literal()?;

            self.writer.set(reference, NODE_A, expression);
            self.expect(T_PAREN_CLOSE)?;

            let finished = self.writer.finish(reference, self.last_end());

            self.writer.set(node, NODE_B, finished);
        } else {
            let module_reference = self.parse_entity_name(false)?;

            self.writer.set(node, NODE_B, module_reference);
        }

        if type_only {
            self.writer.add_flags(node, NF_TYPE_ONLY);
        }

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an export whose decorators were written before the `export`.
    fn parse_decorated_export(&mut self, decorators: u32) -> PRes {
        let node = self.parse_export_declaration()?;
        let declaration = self.writer.get(node, NODE_A);
        let kind = self.writer.get(declaration, NODE_KIND);

        if kind != N_CLASS_DECLARATION {
            return Err(self.error("Decorators are not valid here"));
        }

        self.writer.set(declaration, NODE_G, decorators);

        Ok(node)
    }

    /// Parses every form of export declaration.
    fn parse_export_declaration(&mut self) -> PRes {
        let start = self.start();

        self.next()?;

        if self.at(T_ASSIGN) {
            let node = self.writer.alloc(N_TS_EXPORT_ASSIGNMENT, start);

            self.next()?;

            let expression = self.parse_expression()?;

            self.writer.set(node, NODE_A, expression);
            self.semicolon()?;

            return Ok(self.writer.finish(node, self.last_end()));
        }

        // `export as namespace A;` has to be tested before the `export *`
        // branch, because `export * as A from "m"` also continues with `as`.
        if self.at(T_AS) && self.next_is(T_NAMESPACE, false)? {
            let node = self.writer.alloc(N_TS_NAMESPACE_EXPORT_DECLARATION, start);

            self.next()?;
            self.next()?;

            let id = self.parse_identifier_name()?;

            self.writer.set(node, NODE_A, id);
            self.semicolon()?;

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if self.at(T_DEFAULT) {
            let node = self.writer.alloc(N_EXPORT_DEFAULT_DECLARATION, start);

            self.next()?;

            let declaration = self.parse_export_default_value()?;

            self.writer.set(node, NODE_A, declaration);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if self.at(T_STAR) {
            let node = self.writer.alloc(N_EXPORT_ALL_DECLARATION, start);

            self.next()?;

            if self.eat(T_AS)? {
                let exported = if self.at(T_STRING) {
                    self.parse_literal()?
                } else {
                    self.parse_identifier_name()?
                };

                self.writer.set(node, NODE_A, exported);
            }

            self.expect(T_FROM)?;

            let source = self.parse_literal()?;

            self.writer.set(node, NODE_B, source);

            let attributes = self.parse_import_attributes()?;

            self.writer.set(node, NODE_C, attributes);
            self.semicolon()?;

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let type_only = self.at(T_TYPE) && !self.next_is(T_ASSIGN, false)?;

        if type_only {
            let state = self.tokenizer.save();

            self.next()?;

            if self.at(T_BRACE_OPEN) || self.at(T_STAR) {
                return self.parse_export_named(start, true);
            }

            self.tokenizer.restore(&state);
        }

        if self.at(T_BRACE_OPEN) {
            return self.parse_export_named(start, false);
        }

        if self.at(T_IMPORT) {
            let node = self.writer.alloc(N_EXPORT_NAMED_DECLARATION, start);
            let import_start = self.start();

            self.next()?;

            let declaration = self.parse_import_equals(import_start, false)?;

            self.writer.set(node, NODE_A, declaration);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let node = self.writer.alloc(N_EXPORT_NAMED_DECLARATION, start);
        let declaration = self.parse_statement(false)?;
        let declaration_kind = self.writer.get(declaration, NODE_KIND);

        self.writer.set(node, NODE_A, declaration);

        // Exporting a type declaration, or anything marked `declare`, makes
        // the export itself type-only.
        if declaration_kind == N_TS_INTERFACE_DECLARATION
            || declaration_kind == N_TS_TYPE_ALIAS_DECLARATION
            || (self.writer.get(declaration, NODE_FLAGS) & NF_DECLARE) != 0
        {
            self.writer.add_flags(node, NF_TYPE_ONLY);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses the value of an `export default` declaration.
    fn parse_export_default_value(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_FUNCTION) {
            return self.parse_function_declaration(start, false, 0);
        }

        if self.at(T_ASYNC) && self.async_starts_function()? {
            self.next()?;

            return self.parse_function_declaration(start, true, 0);
        }

        if self.at(T_CLASS) {
            return self.parse_class(N_CLASS_DECLARATION, 0, start);
        }

        if self.at(T_AT) {
            let decorators = self.parse_decorators()?;

            return self.parse_decorated_class(decorators, start);
        }

        if self.at(T_ABSTRACT) && self.next_is(T_CLASS, true)? {
            self.next()?;

            let node = self.parse_class(N_CLASS_DECLARATION, 0, start)?;

            self.writer.add_flags(node, NF_ABSTRACT);

            return Ok(node);
        }

        if self.at(T_INTERFACE) && self.next_starts_binding()? {
            return self.parse_interface_declaration(start, 0);
        }

        let value = self.parse_assignment_expression()?;

        self.semicolon()?;

        Ok(value)
    }

    /// Parses `export { ... }` with an optional `from` clause.
    fn parse_export_named(&mut self, start: u32, type_only: bool) -> PRes {
        if self.at(T_STAR) {
            let node = self.writer.alloc(N_EXPORT_ALL_DECLARATION, start);

            self.next()?;

            // The namespace may be named by a string, as `export * as`
            // allows.
            if self.eat(T_AS)? {
                let exported = if self.at(T_STRING) {
                    self.parse_literal()?
                } else {
                    self.parse_identifier_name()?
                };

                self.writer.set(node, NODE_A, exported);
            }

            self.expect(T_FROM)?;

            let source = self.parse_literal()?;

            self.writer.set(node, NODE_B, source);
            self.writer.add_flags(node, NF_TYPE_ONLY);
            self.semicolon()?;

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let node = self.writer.alloc(N_EXPORT_NAMED_DECLARATION, start);
        let mark = self.writer.start_list();

        self.enter_brace(false)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            let specifier = self.writer.alloc(N_EXPORT_SPECIFIER, self.start());

            // An individual specifier may carry its own `type` marker.
            if self.at(T_TYPE)
                && !self.next_is(T_COMMA, false)?
                && !self.next_is_as_rename()?
            {
                let state = self.tokenizer.save();

                self.next()?;

                if !is_identifier_name_kind(self.kind()) && !self.at(T_STRING) {
                    self.tokenizer.restore(&state);
                } else {
                    self.writer.add_flags(specifier, NF_TYPE_ONLY);
                }
            }

            let local = if self.at(T_STRING) {
                self.parse_literal()?
            } else {
                self.parse_identifier_name()?
            };

            self.writer.set(specifier, NODE_A, local);

            if self.eat(T_AS)? {
                let exported = if self.at(T_STRING) {
                    self.parse_literal()?
                } else {
                    self.parse_identifier_name()?
                };

                self.writer.set(specifier, NODE_B, exported);
            } else {
                self.writer.set(specifier, NODE_B, local);
            }

            let finished = self.writer.finish(specifier, self.last_end());

            self.writer.push_list(finished);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect(T_BRACE_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_B, list);

        if self.eat(T_FROM)? {
            let source = self.parse_literal()?;

            self.writer.set(node, NODE_C, source);

            let attributes = self.parse_import_attributes()?;

            self.writer.set(node, NODE_D, attributes);
        }

        if type_only {
            self.writer.add_flags(node, NF_TYPE_ONLY);
        }

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // TypeScript Declarations
    //-------------------------------------------------------------------------

    /// Parses a `declare` declaration.
    fn parse_declare(&mut self, start: u32) -> PRes {
        self.next()?;

        let node = self.parse_statement(false)?;

        self.writer.add_flags(node, NF_DECLARE);
        self.writer.set(node, NODE_START, start);

        Ok(node)
    }

    /// Parses an interface declaration.
    fn parse_interface_declaration(&mut self, start: u32, flags: u32) -> PRes {
        let node = self.writer.alloc(N_TS_INTERFACE_DECLARATION, start);

        self.writer.add_flags(node, flags);
        self.next()?;

        let id = self.parse_identifier()?;

        self.writer.set(node, NODE_A, id);

        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_C, type_parameters);

        if self.eat(T_EXTENDS)? {
            let mark = self.writer.start_list();

            loop {
                let heritage = self.writer.alloc(N_TS_INTERFACE_HERITAGE, self.start());
                let expression = self.parse_heritage_expression()?;

                self.writer.set(heritage, NODE_A, expression);

                if self.at(T_LT) {
                    let type_arguments = self.parse_type_arguments()?;

                    self.writer.set(heritage, NODE_B, type_arguments);
                }

                let finished = self.writer.finish(heritage, self.last_end());

                self.writer.push_list(finished);

                if !self.eat(T_COMMA)? {
                    break;
                }
            }

            let list = self.writer.end_list(mark);

            self.writer.set(node, NODE_D, list);
        }

        let body = self.writer.alloc(N_TS_INTERFACE_BODY, self.start());
        let members = self.parse_object_type_members()?;

        self.writer.set(body, NODE_A, members);

        let finished = self.writer.finish(body, self.last_end());

        self.writer.set(node, NODE_B, finished);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a type alias declaration.
    fn parse_type_alias_declaration(&mut self, start: u32, flags: u32) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_ALIAS_DECLARATION, start);

        self.writer.add_flags(node, flags);
        self.next()?;

        let id = self.parse_identifier()?;

        self.writer.set(node, NODE_A, id);

        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_C, type_parameters);
        self.expect(T_ASSIGN)?;

        let type_node = self.parse_type()?;

        self.writer.set(node, NODE_B, type_node);
        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an enum declaration.
    fn parse_enum_declaration(&mut self, start: u32, flags: u32) -> PRes {
        let node = self.writer.alloc(N_TS_ENUM_DECLARATION, start);

        self.writer.add_flags(node, flags);
        self.next()?;

        let id = self.parse_identifier()?;

        self.writer.set(node, NODE_A, id);

        let body = self.writer.alloc(N_TS_ENUM_BODY, self.start());
        let mark = self.writer.start_list();

        self.enter_brace(false)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            let member = self.writer.alloc(N_TS_ENUM_MEMBER, self.start());
            let computed = self.at(T_BRACKET_OPEN);
            let key = self.parse_property_name()?;

            self.writer.set(member, NODE_A, key);

            if computed {
                self.writer.add_flags(member, NF_COMPUTED);
            }

            if self.eat(T_ASSIGN)? {
                let initializer = self.parse_assignment_expression()?;

                self.writer.set(member, NODE_B, initializer);
            }

            let finished = self.writer.finish(member, self.last_end());

            self.writer.push_list(finished);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect(T_BRACE_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(body, NODE_A, list);

        let finished_body = self.writer.finish(body, self.last_end());

        self.writer.set(node, NODE_B, finished_body);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses the class a set of decorators is written on.
    fn parse_decorated_class(&mut self, decorators: u32, start: u32) -> PRes {
        let mut flags = 0u32;

        // Either order is written, so both are read rather than a fixed one.
        loop {
            if self.at(T_ABSTRACT) {
                flags |= NF_ABSTRACT;
            } else if self.at(T_DECLARE) {
                flags |= NF_DECLARE;
            } else {
                break;
            }

            self.next()?;
        }

        if !self.at(T_CLASS) {
            return Err(self.error("A decorator may only be applied to a class declaration."));
        }

        let node = self.parse_class(N_CLASS_DECLARATION, decorators, start)?;

        self.writer.add_flags(node, flags);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `namespace`, `module`, or `global` declaration.
    fn parse_module_declaration(&mut self, start: u32, flags: u32) -> PRes {
        let node = self.writer.alloc(N_TS_MODULE_DECLARATION, start);
        let keyword = self.kind();

        self.writer.add_flags(node, flags);

        if keyword == T_GLOBAL {
            self.writer
                .add_flags(node, MODULE_GLOBAL << MODULE_KIND_SHIFT);

            let id = self.parse_identifier()?;

            self.writer.set(node, NODE_A, id);
        } else {
            self.writer.add_flags(
                node,
                (if keyword == T_MODULE {
                    MODULE_MODULE
                } else {
                    MODULE_NAMESPACE
                }) << MODULE_KIND_SHIFT,
            );
            self.next()?;

            let id = if self.at(T_STRING) {
                self.parse_literal()?
            } else {
                self.parse_entity_name(false)?
            };

            self.writer.set(node, NODE_A, id);
        }

        if self.at(T_BRACE_OPEN) {
            let body = self.writer.alloc(N_TS_MODULE_BLOCK, self.start());
            let mark = self.writer.start_list();

            self.enter_brace(true)?;

            while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
                let statement = self.parse_statement(false)?;

                self.writer.push_list(statement);
            }

            self.expect(T_BRACE_CLOSE)?;

            let list = self.writer.end_list(mark);

            self.writer.set(body, NODE_A, list);

            let finished = self.writer.finish(body, self.last_end());

            self.writer.set(node, NODE_B, finished);
        } else {
            self.semicolon()?;
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // Lookahead Helpers
    //-------------------------------------------------------------------------

    /// Whether the `as` after the current token renames it, rather than being
    /// the name that a `type` modifier applies to.
    fn next_is_as_rename(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let mut result = false;

        if self.at(T_AS) {
            self.next()?;
            result = !self.at(T_COMMA) && !self.at(T_BRACE_CLOSE);
        }

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Tests the kind of the token after the current one.
    fn next_is(&mut self, kind: u32, same_line: bool) -> PRes<bool> {
        Ok(self.tokenizer.peek()? == kind
            && (!same_line || !self.tokenizer.peek_newline_before))
    }

    /// Whether a binding target follows the current token.
    fn next_starts_binding(&mut self) -> PRes<bool> {
        let kind = self.tokenizer.peek()?;

        Ok(is_binding_name_kind(kind) || kind == T_BRACKET_OPEN || kind == T_BRACE_OPEN)
    }

    /// Whether `using` introduces a `using` declaration.
    fn using_starts_binding(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let result = self.at_binding_name() && !self.newline_before();

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether `async` introduces a function declaration.
    fn async_starts_function(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let result = self.at(T_FUNCTION) && !self.newline_before();

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether `await` introduces an `await using` declaration.
    fn await_starts_using(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let mut result = false;

        if self.at(T_USING) && !self.newline_before() {
            self.next()?;
            result = self.at_binding_name() && !self.newline_before();
        }

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether `type` introduces a type alias declaration.
    fn type_starts_alias(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let mut result = false;

        if self.at_binding_name() && !self.newline_before() {
            self.next()?;
            result = self.at(T_ASSIGN) || self.at(T_LT);
        }

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether `namespace` or `module` introduces a declaration.
    fn next_starts_module_name(&mut self) -> PRes<bool> {
        let kind = self.tokenizer.peek()?;

        Ok((is_binding_name_kind(kind) || kind == T_STRING)
            && !self.tokenizer.peek_newline_before)
    }

    /// Whether `declare` introduces a declaration.
    fn declare_starts_declaration(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let kind = self.kind();
        let result = !self.newline_before()
            && (kind == T_VAR
                || kind == T_LET
                || kind == T_CONST
                || kind == T_FUNCTION
                || kind == T_CLASS
                || kind == T_ENUM
                || kind == T_INTERFACE
                || kind == T_TYPE
                || kind == T_NAMESPACE
                || kind == T_MODULE
                || kind == T_GLOBAL
                || kind == T_ABSTRACT
                || kind == T_ASYNC);

        self.tokenizer.restore(&state);

        Ok(result)
    }
}
