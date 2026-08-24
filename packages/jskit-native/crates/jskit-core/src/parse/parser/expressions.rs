//! The expression, pattern, function, and class grammar.
//!
//! Port of `packages/jskit/src/parse/parser-expressions.ts`.

use super::{PRes, Parser, AFTER_JSX_EXPRESSION};
use crate::parse::binary::TF_HAS_ESCAPE;
use crate::parse::node_kinds::*;
use crate::parse::token_kinds::*;
use crate::parse::values::decode_escapes;

impl<'a> Parser<'a> {
    //-------------------------------------------------------------------------
    // Expressions
    //-------------------------------------------------------------------------

    /// Parses a comma-separated expression list as a single expression.
    pub fn parse_expression(&mut self) -> PRes {
        let start = self.start();
        let first = self.parse_assignment_expression()?;

        if !self.at(T_COMMA) {
            return Ok(first);
        }

        let node = self.writer.alloc(N_SEQUENCE_EXPRESSION, start);
        let mark = self.writer.start_list();

        self.writer.push_list(first);

        while self.eat(T_COMMA)? {
            let next = self.parse_assignment_expression()?;

            self.writer.push_list(next);
        }

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an assignment-level expression, which also covers arrow
    /// functions, `yield`, and conditional expressions.
    pub fn parse_assignment_expression(&mut self) -> PRes {
        if self.at(T_YIELD) && self.in_generator {
            return self.parse_yield_expression();
        }

        let start = self.start();
        let arrow = self.try_parse_arrow_function()?;

        if arrow != 0 {
            return Ok(arrow);
        }

        let left = self.parse_conditional_expression()?;

        if !is_assignment_kind(self.kind()) {
            return Ok(left);
        }

        let operator = self.kind();
        let node = self.writer.alloc(N_ASSIGNMENT_EXPRESSION, start);

        self.next()?;

        if operator == T_ASSIGN {
            self.to_pattern(left);
        }

        self.writer.set(node, NODE_A, left);

        let right = self.parse_assignment_expression()?;

        self.writer.set(node, NODE_B, right);
        self.writer.set(node, NODE_C, operator);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses `yield` and `yield*`.
    fn parse_yield_expression(&mut self) -> PRes {
        let node = self.writer.alloc(N_YIELD_EXPRESSION, self.start());

        self.next()?;

        // `yield [no LineTerminator here] *`.
        if !self.newline_before() && self.eat(T_STAR)? {
            self.writer.add_flags(node, NF_DELEGATE);

            let argument = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_A, argument);
        } else if !self.can_insert_semicolon()
            && self.at_expression_start()
            && KIND_CONTINUES_EXPR[self.kind() as usize] == 0
        {
            let argument = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_A, argument);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a conditional expression.
    fn parse_conditional_expression(&mut self) -> PRes {
        let start = self.start();
        let test = self.parse_binary_expression(0)?;

        if !self.at(T_QUESTION) {
            return Ok(test);
        }

        let node = self.writer.alloc(N_CONDITIONAL_EXPRESSION, start);

        self.next()?;
        self.writer.set(node, NODE_A, test);

        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let consequent = self.parse_assignment_expression();

        self.allow_in = previous_allow_in;
        self.writer.set(node, NODE_B, consequent?);
        self.expect(T_COLON)?;

        let alternate = self.parse_assignment_expression()?;

        self.writer.set(node, NODE_C, alternate);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses binary operators using precedence climbing.
    fn parse_binary_expression(&mut self, minimum_precedence: u8) -> PRes {
        let start = self.start();
        let mut left = self.parse_unary_expression()?;

        loop {
            let operator = self.kind();

            // `in` is banned in the head of a classic `for` statement.
            if operator == T_IN && !self.allow_in {
                break;
            }

            let precedence = KIND_PRECEDENCE[operator as usize];

            if precedence == 0 || precedence <= minimum_precedence {
                break;
            }

            if (operator == T_AS || operator == T_SATISFIES) && self.newline_before() {
                break;
            }

            if operator == T_AS || operator == T_SATISFIES {
                let node = self.writer.alloc(
                    if operator == T_AS {
                        N_TS_AS_EXPRESSION
                    } else {
                        N_TS_SATISFIES_EXPRESSION
                    },
                    start,
                );

                self.next()?;
                self.writer.set(node, NODE_A, left);

                let type_node = self.parse_type()?;

                self.writer.set(node, NODE_B, type_node);
                left = self.writer.finish(node, self.last_end());
                continue;
            }

            let is_logical =
                operator == T_AMPAMP || operator == T_PIPEPIPE || operator == T_QQ;

            self.check_operand_mixing(left, operator)?;

            let node = self.writer.alloc(
                if is_logical {
                    N_LOGICAL_EXPRESSION
                } else {
                    N_BINARY_EXPRESSION
                },
                start,
            );

            self.next()?;
            self.writer.set(node, NODE_A, left);

            // Exponentiation is right-associative.
            let right_precedence = if operator == T_STARSTAR {
                precedence - 1
            } else {
                precedence
            };
            let right = self.parse_binary_expression(right_precedence)?;

            // `??` is the one operator that has to look right as well.
            if operator == T_QQ {
                self.check_operand_mixing(right, operator)?;
            }

            self.writer.set(node, NODE_B, right);
            self.writer.set(node, NODE_C, operator);
            left = self.writer.finish(node, self.last_end());
        }

        Ok(left)
    }

    /// Reports an operand an operator's grammar does not admit.
    fn check_operand_mixing(&self, operand: u32, operator: u32) -> PRes<()> {
        if (self.writer.get(operand, NODE_FLAGS) & NF_PARENTHESIZED) != 0 {
            return Ok(());
        }

        let kind = self.writer.get(operand, NODE_KIND);

        if operator == T_STARSTAR {
            if kind == N_UNARY_EXPRESSION || kind == N_AWAIT_EXPRESSION {
                return Err(self.error_at(
                    "A unary expression may not be the base of an exponentiation; parenthesize it.",
                    self.writer.get(operand, NODE_START),
                ));
            }

            return Ok(());
        }

        if kind != N_LOGICAL_EXPRESSION {
            return Ok(());
        }

        let inner = self.writer.get(operand, NODE_C);
        let mixed = if operator == T_QQ {
            inner == T_AMPAMP || inner == T_PIPEPIPE
        } else {
            (operator == T_AMPAMP || operator == T_PIPEPIPE) && inner == T_QQ
        };

        if mixed {
            return Err(self.error_at(
                "'??' may not be mixed with '||' or '&&' without parentheses.",
                self.writer.get(operand, NODE_START),
            ));
        }

        Ok(())
    }

    /// Parses prefix operators and `await`.
    fn parse_unary_expression(&mut self) -> PRes {
        let kind = self.kind();
        let start = self.start();

        match kind {
            k if k == T_NOT
                || k == T_TILDE
                || k == T_PLUS
                || k == T_MINUS
                || k == T_TYPEOF
                || k == T_VOID
                || k == T_DELETE =>
            {
                let node = self.writer.alloc(N_UNARY_EXPRESSION, start);

                self.next()?;

                let argument = self.parse_unary_expression()?;

                self.writer.set(node, NODE_A, argument);
                self.writer.set(node, NODE_B, kind);
                self.writer.add_flags(node, NF_PREFIX);

                return Ok(self.writer.finish(node, self.last_end()));
            }
            k if k == T_PLUS_PLUS || k == T_MINUS_MINUS => {
                let node = self.writer.alloc(N_UPDATE_EXPRESSION, start);

                self.next()?;

                let argument = self.parse_unary_expression()?;

                self.writer.set(node, NODE_A, argument);
                self.writer.set(node, NODE_B, kind);
                self.writer.add_flags(node, NF_PREFIX);

                return Ok(self.writer.finish(node, self.last_end()));
            }
            k if k == T_AWAIT => {
                if self.in_async {
                    let node = self.writer.alloc(N_AWAIT_EXPRESSION, start);

                    self.next()?;

                    let argument = self.parse_unary_expression()?;

                    self.writer.set(node, NODE_A, argument);

                    return Ok(self.writer.finish(node, self.last_end()));
                }
            }
            k if k == T_LT => {
                return self.parse_angle_bracket_expression();
            }
            _ => {}
        }

        self.parse_postfix_expression()
    }

    /// Parses whatever a `<` in expression position turns out to introduce.
    fn parse_angle_bracket_expression(&mut self) -> PRes {
        if self.jsx == Some(true) {
            let element = self.parse_jsx_root(AFTER_JSX_EXPRESSION)?;

            return self.parse_call_or_member_expression(false, element, false);
        }

        if self.jsx == Some(false) {
            return self.parse_type_assertion();
        }

        let state = self.tokenizer.save();
        let snapshot = self.writer.mark();
        let mut element = 0;
        let mut failed = false;

        match self.parse_jsx_root(AFTER_JSX_EXPRESSION) {
            Ok(parsed) => element = parsed,
            Err(_) => {
                failed = true;
                self.writer.rewind(snapshot);
                self.tokenizer.restore(&state);
            }
        }

        if !failed {
            return self.parse_call_or_member_expression(false, element, false);
        }

        match self.parse_type_assertion() {
            Ok(assertion) => Ok(assertion),
            Err(_) => {
                // Neither reading worked. The JSX diagnostic is reported,
                // re-parsed outside speculation for the real message.
                self.writer.rewind(snapshot);
                self.tokenizer.restore(&state);

                self.parse_jsx_root(AFTER_JSX_EXPRESSION)?;

                // Unreachable in practice; refuse rather than return a
                // half-built reading.
                Err(self.error("Invalid expression"))
            }
        }
    }

    /// Parses an old-style `<T>expr` type assertion.
    fn parse_type_assertion(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_ASSERTION, self.start());

        self.next()?;

        let type_node = self.parse_type()?;

        self.writer.set(node, NODE_A, type_node);

        if !self.at(T_GT) {
            self.tokenizer.re_scan_greater_than();
        }

        self.expect(T_GT)?;

        let expression = self.parse_unary_expression()?;

        self.writer.set(node, NODE_B, expression);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses postfix `++` and `--`.
    fn parse_postfix_expression(&mut self) -> PRes {
        let start = self.start();
        let expression = self.parse_call_or_member_expression(false, 0, false)?;

        if (self.at(T_PLUS_PLUS) || self.at(T_MINUS_MINUS)) && !self.newline_before() {
            let node = self.writer.alloc(N_UPDATE_EXPRESSION, start);

            self.writer.set(node, NODE_A, expression);
            self.writer.set(node, NODE_B, self.kind());

            let end = self.end();

            self.next()?;

            return Ok(self.writer.finish(node, end));
        }

        Ok(expression)
    }

    //-------------------------------------------------------------------------
    // Member and Call Expressions
    //-------------------------------------------------------------------------

    /// Parses member access, calls, tagged templates, and the TypeScript
    /// suffixes `!` and `<...>`.
    pub(crate) fn parse_call_or_member_expression(
        &mut self,
        no_calls: bool,
        atom: u32,
        no_computed: bool,
    ) -> PRes {
        let start = if atom == 0 {
            self.start()
        } else {
            self.writer.get(atom, NODE_START)
        };
        let mut expression = if atom == 0 {
            self.parse_primary_expression()?
        } else {
            atom
        };
        let mut optional_chain = false;

        loop {
            let kind = self.kind();

            if kind == T_DOT {
                self.next()?;

                let property = if self.at(T_PRIVATE_IDENT) {
                    self.parse_private_identifier()?
                } else {
                    self.parse_identifier_name()?
                };

                expression = self.finish_member(start, expression, property, false, false);
                continue;
            }

            if kind == T_QUESTION_DOT {
                optional_chain = true;
                self.next()?;

                if self.at(T_PAREN_OPEN) {
                    expression = self.finish_call(start, expression, true, no_calls, 0)?;
                    continue;
                }

                // A `<` here can only open a type argument list.
                if self.at(T_LT) {
                    let type_arguments = self.parse_type_arguments()?;

                    expression =
                        self.finish_call(start, expression, true, no_calls, type_arguments)?;
                    continue;
                }

                if self.at(T_BRACKET_OPEN) {
                    let previous_allow_in = self.allow_in;

                    self.allow_in = true;
                    self.next()?;

                    let property = self.parse_expression();

                    let property = match property {
                        Ok(value) => value,
                        Err(error) => {
                            self.allow_in = previous_allow_in;

                            return Err(error);
                        }
                    };

                    self.expect(T_BRACKET_CLOSE)?;
                    self.allow_in = previous_allow_in;
                    expression = self.finish_member(start, expression, property, true, true);
                    continue;
                }

                let property = if self.at(T_PRIVATE_IDENT) {
                    self.parse_private_identifier()?
                } else {
                    self.parse_identifier_name()?
                };

                expression = self.finish_member(start, expression, property, false, true);
                continue;
            }

            if kind == T_BRACKET_OPEN {
                if no_computed {
                    break;
                }

                let previous_allow_in = self.allow_in;

                self.allow_in = true;
                self.next()?;

                let property = self.parse_expression();

                let property = match property {
                    Ok(value) => value,
                    Err(error) => {
                        self.allow_in = previous_allow_in;

                        return Err(error);
                    }
                };

                self.expect(T_BRACKET_CLOSE)?;
                self.allow_in = previous_allow_in;
                expression = self.finish_member(start, expression, property, true, false);
                continue;
            }

            if kind == T_PAREN_OPEN && !no_calls {
                expression = self.finish_call(start, expression, false, no_calls, 0)?;
                continue;
            }

            if kind == T_NOT && !self.newline_before() {
                let node = self.writer.alloc(N_TS_NON_NULL_EXPRESSION, start);
                let end = self.end();

                self.next()?;
                self.writer.set(node, NODE_A, expression);
                expression = self.writer.finish(node, end);
                continue;
            }

            if kind == T_TEMPLATE_FULL || kind == T_TEMPLATE_HEAD {
                let node = self.writer.alloc(N_TAGGED_TEMPLATE_EXPRESSION, start);

                self.writer.set(node, NODE_A, expression);

                let quasi = self.parse_template_literal()?;

                self.writer.set(node, NODE_B, quasi);
                expression = self.writer.finish(node, self.last_end());
                continue;
            }

            if kind == T_LT {
                let type_arguments = self.try_parse_type_arguments_in_expression()?;

                if type_arguments == 0 {
                    break;
                }

                if self.at(T_PAREN_OPEN) && !no_calls {
                    expression =
                        self.finish_call(start, expression, false, no_calls, type_arguments)?;
                    continue;
                }

                if self.at(T_TEMPLATE_FULL) || self.at(T_TEMPLATE_HEAD) {
                    let node = self.writer.alloc(N_TAGGED_TEMPLATE_EXPRESSION, start);

                    self.writer.set(node, NODE_A, expression);

                    let quasi = self.parse_template_literal()?;

                    self.writer.set(node, NODE_B, quasi);
                    self.writer.set(node, NODE_C, type_arguments);
                    expression = self.writer.finish(node, self.last_end());
                    continue;
                }

                let node = self.writer.alloc(N_TS_INSTANTIATION_EXPRESSION, start);

                self.writer.set(node, NODE_A, expression);
                self.writer.set(node, NODE_B, type_arguments);
                expression = self.writer.finish(node, self.last_end());
                continue;
            }

            break;
        }

        if optional_chain {
            let node = self.writer.alloc(N_CHAIN_EXPRESSION, start);

            self.writer.set(node, NODE_A, expression);

            let end = self.writer.get(expression, NODE_END);

            return Ok(self.writer.finish(node, end));
        }

        Ok(expression)
    }

    /// Builds a `MemberExpression` node.
    pub(crate) fn finish_member(
        &mut self,
        start: u32,
        object: u32,
        property: u32,
        computed: bool,
        optional: bool,
    ) -> u32 {
        let node = self.writer.alloc(N_MEMBER_EXPRESSION, start);

        self.writer.set(node, NODE_A, object);
        self.writer.set(node, NODE_B, property);

        if computed {
            self.writer.add_flags(node, NF_COMPUTED);
        }

        if optional {
            self.writer.add_flags(node, NF_OPTIONAL);
        }

        self.writer.finish(node, self.last_end())
    }

    /// Builds a `CallExpression` node from the argument list that follows.
    fn finish_call(
        &mut self,
        start: u32,
        callee: u32,
        optional: bool,
        no_calls: bool,
        type_arguments: u32,
    ) -> PRes {
        if no_calls {
            return Err(self.unexpected());
        }

        let node = self.writer.alloc(N_CALL_EXPRESSION, start);

        self.writer.set(node, NODE_A, callee);

        let arguments = self.parse_arguments()?;

        self.writer.set(node, NODE_B, arguments);
        self.writer.set(node, NODE_C, type_arguments);

        if optional {
            self.writer.add_flags(node, NF_OPTIONAL);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a parenthesized argument list.
    fn parse_arguments(&mut self) -> PRes {
        let mark = self.writer.start_list();
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_arguments_body(mark);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_arguments_body(&mut self, mark: usize) -> PRes {
        self.expect(T_PAREN_OPEN)?;

        while !self.at(T_PAREN_CLOSE) && !self.at(T_EOF) {
            if self.at(T_ELLIPSIS) {
                let spread = self.writer.alloc(N_SPREAD_ELEMENT, self.start());

                self.next()?;

                let argument = self.parse_assignment_expression()?;

                self.writer.set(spread, NODE_A, argument);

                let finished = self.writer.finish(spread, self.last_end());

                self.writer.push_list(finished);
            } else {
                let argument = self.parse_assignment_expression()?;

                self.writer.push_list(argument);
            }

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect(T_PAREN_CLOSE)?;

        Ok(self.writer.end_list(mark))
    }

    /// Tries to read a `<...>` type argument list in an expression position.
    /// Returns `0` when the `<` was a less-than operator after all.
    fn try_parse_type_arguments_in_expression(&mut self) -> PRes {
        let state = self.tokenizer.save();
        let snapshot = self.writer.mark();

        let attempt = (|| -> PRes {
            let type_arguments = self.parse_type_arguments()?;

            Ok(type_arguments)
        })();

        if let Ok(type_arguments) = attempt {
            let following = self.kind();

            // A type argument list in an expression only makes sense when it
            // is followed by a call, a tagged template, or something that
            // cannot continue an expression.
            if following == T_PAREN_OPEN
                || following == T_QUESTION_DOT
                || following == T_TEMPLATE_FULL
                || following == T_TEMPLATE_HEAD
                || following == T_SEMICOLON
                || following == T_COMMA
                || following == T_PAREN_CLOSE
                || following == T_BRACKET_CLOSE
                || following == T_BRACE_CLOSE
                || following == T_EOF
            {
                return Ok(type_arguments);
            }
        }

        self.writer.rewind(snapshot);
        self.tokenizer.restore(&state);

        Ok(0)
    }

    //-------------------------------------------------------------------------
    // Primary Expressions
    //-------------------------------------------------------------------------

    /// Whether an expression can begin at the current token.
    pub(crate) fn at_expression_start(&self) -> bool {
        !matches!(
            self.kind(),
            k if k == T_SEMICOLON
                || k == T_PAREN_CLOSE
                || k == T_BRACKET_CLOSE
                || k == T_BRACE_CLOSE
                || k == T_COMMA
                || k == T_COLON
                || k == T_EOF
        )
    }

    /// Parses the innermost form of an expression.
    fn parse_primary_expression(&mut self) -> PRes {
        let kind = self.kind();
        let start = self.start();

        match kind {
            k if k == T_THIS => {
                let node = self.writer.alloc(N_THIS_EXPRESSION, start);
                let end = self.end();

                self.next()?;

                Ok(self.writer.finish(node, end))
            }
            k if k == T_SUPER => {
                let node = self.writer.alloc(N_SUPER, start);
                let end = self.end();

                self.next()?;

                Ok(self.writer.finish(node, end))
            }
            k if k == T_BRACKET_OPEN => self.parse_array_literal(),
            k if k == T_BRACE_OPEN => self.parse_object_literal(),
            k if k == T_FUNCTION => self.parse_function_expression(start, false),
            k if k == T_CLASS => {
                let class_start = self.start();

                self.parse_class(N_CLASS_EXPRESSION, 0, class_start)
            }
            k if k == T_AT => {
                // A class expression may be decorated too.
                let decorators = self.parse_decorators()?;

                self.parse_class(N_CLASS_EXPRESSION, decorators, start)
            }
            k if k == T_NEW => self.parse_new_expression(),
            k if k == T_TEMPLATE_FULL || k == T_TEMPLATE_HEAD => self.parse_template_literal(),
            k if k == T_PAREN_OPEN => self.parse_parenthesized_expression(),
            k if k == T_IMPORT => self.parse_import_expression(),
            k if k == T_ASYNC => self.parse_async_expression(),
            k if k == T_PRIVATE_IDENT => self.parse_private_identifier(),
            k if k == T_SLASH || k == T_ASSIGN_SLASH => {
                // A `/` where an expression has to begin is the start of a
                // regular expression, whatever the tokenizer decided.
                self.tokenizer.re_scan_as_reg_exp()?;

                self.parse_literal()
            }
            _ => {
                if self.at_literal() {
                    return self.parse_literal();
                }

                if is_identifier_name_kind(kind) {
                    return self.parse_identifier();
                }

                Err(self.unexpected())
            }
        }
    }

    /// Parses expressions that begin with the word `async`.
    fn parse_async_expression(&mut self) -> PRes {
        let start = self.start();
        let state = self.tokenizer.save();

        self.next()?;

        if self.at(T_FUNCTION) && !self.newline_before() {
            return self.parse_function_expression(start, true);
        }

        if !self.newline_before() {
            // `async x => ...`
            if self.at_binding_name() && self.peek_is_arrow()? {
                return self.parse_arrow_from_single_parameter(start, true);
            }

            if self.at(T_PAREN_OPEN) {
                if self.parenthesized_is_followed_by_arrow()? {
                    return self.parse_arrow_function(start, true);
                }

                if self.kind_after_matching_paren()? == T_COLON {
                    let arrow = self.speculate_arrow_function(start, true)?;

                    if arrow != 0 {
                        return Ok(arrow);
                    }
                }
            } else if self.at(T_LT) {
                let arrow = self.speculate_arrow_function(start, true)?;

                if arrow != 0 {
                    return Ok(arrow);
                }
            }
        }

        // `async` turned out to be an ordinary identifier after all.
        self.tokenizer.restore(&state);

        self.parse_identifier()
    }

    /// Looks ahead one token to see whether an arrow follows.
    fn peek_is_arrow(&mut self) -> PRes<bool> {
        Ok(self.tokenizer.peek()? == T_ARROW && !self.tokenizer.peek_newline_before)
    }

    /// Parses an array literal, including holes and spread elements.
    fn parse_array_literal(&mut self) -> PRes {
        let node = self.writer.alloc(N_ARRAY_EXPRESSION, self.start());
        let mark = self.writer.start_list();

        // Every bracketed construct restores `in` as an operator.
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_array_literal_body(node, mark);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_array_literal_body(&mut self, node: u32, mark: usize) -> PRes {
        self.next()?;

        while !self.at(T_BRACKET_CLOSE) && !self.at(T_EOF) {
            if self.at(T_COMMA) {
                // An elision produces a null element.
                self.writer.push_list(0);
                self.next()?;
                continue;
            }

            let is_rest = self.at(T_ELLIPSIS);

            if is_rest {
                let spread = self.writer.alloc(N_SPREAD_ELEMENT, self.start());

                self.next()?;

                let argument = self.parse_assignment_expression()?;

                self.writer.set(spread, NODE_A, argument);

                let finished = self.writer.finish(spread, self.last_end());

                self.writer.push_list(finished);
            } else {
                let element = self.parse_assignment_expression()?;

                self.writer.push_list(element);
            }

            if !self.eat(T_COMMA)? {
                break;
            }

            if is_rest {
                self.writer.add_flags(node, NF_COMMA_AFTER_REST);
            }
        }

        self.expect(T_BRACKET_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an object literal.
    fn parse_object_literal(&mut self) -> PRes {
        let node = self.writer.alloc(N_OBJECT_EXPRESSION, self.start());
        let mark = self.writer.start_list();
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_object_literal_body(node, mark);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_object_literal_body(&mut self, node: u32, mark: usize) -> PRes {
        self.enter_brace(false)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            let is_rest = self.at(T_ELLIPSIS);
            let member = self.parse_object_member()?;

            self.writer.push_list(member);

            if !self.eat(T_COMMA)? {
                break;
            }

            if is_rest {
                self.writer.add_flags(node, NF_COMMA_AFTER_REST);
            }
        }

        self.expect(T_BRACE_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses one member of an object literal.
    fn parse_object_member(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_ELLIPSIS) {
            let node = self.writer.alloc(N_SPREAD_ELEMENT, start);

            self.next()?;

            let argument = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_A, argument);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let mut is_async = false;
        let mut is_generator = false;
        let mut method_kind = MKIND_INIT;

        if self.at(T_ASYNC) && self.next_starts_property_name(false)? {
            self.next()?;
            is_async = true;
        }

        if self.eat(T_STAR)? {
            is_generator = true;
        }

        if !is_async
            && !is_generator
            && (self.at(T_GET) || self.at(T_SET))
            && self.next_starts_property_name(true)?
        {
            method_kind = if self.at(T_GET) { MKIND_GET } else { MKIND_SET };
            self.next()?;
        }

        let node = self.writer.alloc(N_PROPERTY, start);
        let computed = self.at(T_BRACKET_OPEN);

        // Recorded before the key is read, because shorthand reuses the key
        // as the reference and by then the flags describe the token after it.
        let key_start = self.start();
        let key_end = self.end();
        let key_escaped = (self.tokenizer.flags & TF_HAS_ESCAPE) != 0;
        let key = self.parse_property_name()?;

        if computed {
            self.writer.add_flags(node, NF_COMPUTED);
        }

        self.writer.set(node, NODE_A, key);

        if method_kind != MKIND_INIT {
            self.writer.add_flags(node, method_kind << MKIND_SHIFT);

            let value = self.parse_method_value(false, false)?;

            self.writer.set(node, NODE_B, value);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if is_async || is_generator || self.at(T_PAREN_OPEN) || self.at(T_LT) {
            self.writer.add_flags(node, NF_METHOD);

            let value = self.parse_method_value(is_async, is_generator)?;

            self.writer.set(node, NODE_B, value);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if self.eat(T_COLON)? {
            let value = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_B, value);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        // Shorthand, optionally with a default value in a pattern position.
        self.writer.add_flags(node, NF_SHORTHAND);

        if key_escaped {
            self.check_escaped_word(key_start, key_end)?;
        }

        if self.at(T_ASSIGN) {
            let pattern = self.writer.alloc(N_ASSIGNMENT_PATTERN, start);

            self.next()?;
            self.writer.set(pattern, NODE_A, key);

            let default = self.parse_assignment_expression()?;

            self.writer.set(pattern, NODE_B, default);

            let finished = self.writer.finish(pattern, self.last_end());

            self.writer.set(node, NODE_B, finished);
        } else {
            self.writer.set(node, NODE_B, key);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses the function that implements a method or accessor.
    fn parse_method_value(&mut self, is_async: bool, is_generator: bool) -> PRes {
        let node = self.writer.alloc(N_FUNCTION_EXPRESSION, self.start());
        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_D, type_parameters);

        let parameters = self.parse_parameter_list(is_async, is_generator)?;

        self.writer.set(node, NODE_B, parameters);

        let return_type = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_E, return_type);

        if is_async {
            self.writer.add_flags(node, NF_ASYNC);
        }

        if is_generator {
            self.writer.add_flags(node, NF_GENERATOR);
        }

        if self.at(T_BRACE_OPEN) {
            let body = self.parse_function_body(is_async, is_generator, false)?;

            self.writer.set(node, NODE_C, body);
        } else {
            // A method without a body is an overload signature.
            self.writer.retype(node, N_TS_EMPTY_BODY_FUNCTION_EXPRESSION);
            self.semicolon()?;
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Whether a property name follows the current token.
    fn next_starts_property_name(&mut self, allow_newline: bool) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let kind = self.kind();
        let result = (is_identifier_name_kind(kind)
            || kind == T_STRING
            || kind == T_NUMBER
            || kind == T_BRACKET_OPEN
            || kind == T_PRIVATE_IDENT
            || kind == T_STAR)
            && (allow_newline || !self.newline_before());

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Parses a property name, which may be computed.
    pub(crate) fn parse_property_name(&mut self) -> PRes {
        if self.at(T_BRACKET_OPEN) {
            let previous_allow_in = self.allow_in;

            self.allow_in = true;
            self.next()?;

            let key = self.parse_assignment_expression();

            let key = match key {
                Ok(value) => value,
                Err(error) => {
                    self.allow_in = previous_allow_in;

                    return Err(error);
                }
            };

            self.expect(T_BRACKET_CLOSE)?;
            self.allow_in = previous_allow_in;

            return Ok(key);
        }

        if self.at(T_STRING) || self.at(T_NUMBER) || self.at(T_BIGINT) {
            return self.parse_literal();
        }

        if self.at(T_PRIVATE_IDENT) {
            return self.parse_private_identifier();
        }

        self.parse_identifier_name()
    }

    /// Parses a template literal.
    pub(crate) fn parse_template_literal(&mut self) -> PRes {
        let node = self.writer.alloc(N_TEMPLATE_LITERAL, self.start());
        let mark = self.writer.start_list();
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_template_literal_body(node, mark);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_template_literal_body(&mut self, node: u32, mark: usize) -> PRes {
        if self.at(T_TEMPLATE_FULL) {
            let quasi = self.parse_template_element(true)?;

            self.writer.push_list(quasi);
        } else {
            let head = self.parse_template_element(false)?;

            self.writer.push_list(head);

            loop {
                let expression = self.parse_expression()?;

                self.writer.push_list(expression);

                if self.at(T_TEMPLATE_TAIL) {
                    let tail = self.parse_template_element(true)?;

                    self.writer.push_list(tail);
                    break;
                }

                if !self.at(T_TEMPLATE_MIDDLE) {
                    return Err(self.unexpected());
                }

                let middle = self.parse_template_element(false)?;

                self.writer.push_list(middle);
            }
        }

        let (quasis, expressions) = self.writer.end_interleaved_lists(mark);

        self.writer.set(node, NODE_A, quasis);
        self.writer.set(node, NODE_B, expressions);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses `new X(...)` and `new.target`.
    fn parse_new_expression(&mut self) -> PRes {
        let start = self.start();
        let meta = self.parse_word_as_identifier()?;

        if self.at(T_DOT) {
            let node = self.writer.alloc(N_META_PROPERTY, start);

            self.next()?;
            self.writer.set(node, NODE_A, meta);

            let property = self.parse_identifier_name()?;

            self.writer.set(node, NODE_B, property);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        // `new` takes a `MemberExpression`, and `import(...)` is a
        // `CallExpression` — there is no production that joins the two.
        if self.at(T_IMPORT) {
            let import_start = self.start();
            let state = self.tokenizer.save();

            self.next()?;

            let is_call = self.at(T_PAREN_OPEN);

            self.tokenizer.restore(&state);

            if is_call {
                return Err(self.error_at(
                    "'new' cannot be applied to a dynamic import.",
                    import_start,
                ));
            }
        }

        let node = self.writer.alloc(N_NEW_EXPRESSION, start);
        let callee = self.parse_call_or_member_expression(true, 0, false)?;

        // A callee parsed without its call arguments swallows a type
        // argument list as an instantiation expression; under `new` the type
        // arguments belong to the `new` itself, so the wrapper is unwrapped
        // and discarded.
        if self.writer.get(callee, NODE_KIND) == N_TS_INSTANTIATION_EXPRESSION {
            let inner_callee = self.writer.get(callee, NODE_A);
            let type_arguments = self.writer.get(callee, NODE_B);

            self.writer.set(node, NODE_A, inner_callee);
            self.writer.set(node, NODE_C, type_arguments);
            self.writer.discard(callee);
        } else {
            self.writer.set(node, NODE_A, callee);

            if self.at(T_LT) {
                let type_arguments = self.parse_type_arguments()?;

                self.writer.set(node, NODE_C, type_arguments);
            }
        }

        if self.at(T_PAREN_OPEN) {
            let arguments = self.parse_arguments()?;

            self.writer.set(node, NODE_B, arguments);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses `import(...)` and `import.meta`.
    fn parse_import_expression(&mut self) -> PRes {
        let start = self.start();
        let meta = self.parse_word_as_identifier()?;

        if self.at(T_DOT) {
            let node = self.writer.alloc(N_META_PROPERTY, start);

            self.next()?;
            self.writer.set(node, NODE_A, meta);

            let property = self.parse_identifier_name()?;

            self.writer.set(node, NODE_B, property);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let node = self.writer.alloc(N_IMPORT_EXPRESSION, start);
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_import_expression_body(node);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_import_expression_body(&mut self, node: u32) -> PRes {
        self.expect(T_PAREN_OPEN)?;

        let source = self.parse_assignment_expression()?;

        self.writer.set(node, NODE_A, source);

        if self.eat(T_COMMA)? && !self.at(T_PAREN_CLOSE) {
            let options = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_B, options);
            self.eat(T_COMMA)?;
        }

        self.expect(T_PAREN_CLOSE)?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a parenthesized expression or sequence.
    fn parse_parenthesized_expression(&mut self) -> PRes {
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = (|| -> PRes {
            self.next()?;

            let inner = self.parse_expression()?;

            self.expect(T_PAREN_CLOSE)?;

            Ok(inner)
        })();

        self.allow_in = previous_allow_in;

        let inner = result?;

        self.writer.add_flags(inner, NF_PARENTHESIZED);

        Ok(inner)
    }

    //-------------------------------------------------------------------------
    // Arrow Functions
    //-------------------------------------------------------------------------

    /// Tries to parse an arrow function at the current position.
    /// Returns `0` when this is not an arrow function.
    fn try_parse_arrow_function(&mut self) -> PRes {
        let kind = self.kind();
        let start = self.start();

        // `async` is a binding name like any other when a `=>` follows it
        // directly.
        if self.at_binding_name() && self.peek_is_arrow()? {
            return self.parse_arrow_from_single_parameter(start, false);
        }

        if kind == T_PAREN_OPEN {
            // One token of lookahead rules out the common cases before the
            // matching-paren scan runs at all.
            if !self.next_can_start_parameter_list()? {
                return Ok(0);
            }

            if self.parenthesized_is_followed_by_arrow()? {
                return self.parse_arrow_function(start, false);
            }

            // A return type annotation hides the arrow behind a type.
            if self.kind_after_matching_paren()? == T_COLON {
                return self.speculate_arrow_function(start, false);
            }

            return Ok(0);
        }

        if kind == T_LT {
            // In JSX mode a `<` is an element unless it is spelled the one
            // way an element cannot be.
            if self.jsx == Some(true) && !self.at_tsx_generic_arrow()? {
                return Ok(0);
            }

            return self.speculate_arrow_function(start, false);
        }

        Ok(0)
    }

    /// Whether a `<` begins a generic arrow under JSX rules, where only the
    /// unambiguous `<T,>` and `<T extends ...>` spellings do.
    fn at_tsx_generic_arrow(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        let attempt = (|| -> PRes<bool> {
            self.next()?;

            // TypeScript 5's `const` modifier may precede the name.
            if self.at(T_CONST) {
                self.next()?;
            }

            if self.at_binding_name() {
                self.next()?;

                return Ok(self.at(T_COMMA) || self.at(T_EXTENDS));
            }

            Ok(false)
        })();

        // The lookahead scans with the ordinary tokenizer, and what follows a
        // `<` in a JSX file does not have to scan as JavaScript.
        let result = attempt.unwrap_or(false);

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether the token after the current `(` could begin a parameter list.
    fn next_can_start_parameter_list(&mut self) -> PRes<bool> {
        let kind = self.tokenizer.peek()?;

        Ok(is_binding_name_kind(kind)
            || kind == T_PAREN_CLOSE
            || kind == T_BRACE_OPEN
            || kind == T_BRACKET_OPEN
            || kind == T_ELLIPSIS
            || kind == T_THIS
            || kind == T_AT)
    }

    /// Attempts a full arrow function parse, undoing it on failure.
    fn speculate_arrow_function(&mut self, start: u32, is_async: bool) -> PRes {
        self.speculate(move |parser| parser.parse_arrow_function(start, is_async))
    }

    /// Parses an arrow function whose parameters are parenthesized.
    fn parse_arrow_function(&mut self, start: u32, is_async: bool) -> PRes {
        let node = self.writer.alloc(N_ARROW_FUNCTION_EXPRESSION, start);
        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_D, type_parameters);

        let parameters = self.parse_parameter_list_inherit()?;

        self.writer.set(node, NODE_B, parameters);

        let return_type = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_E, return_type);
        self.expect(T_ARROW)?;
        self.finish_arrow_body(node, is_async)?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an arrow function with a single unparenthesized parameter.
    fn parse_arrow_from_single_parameter(&mut self, start: u32, is_async: bool) -> PRes {
        let node = self.writer.alloc(N_ARROW_FUNCTION_EXPRESSION, start);
        let parameter = self.parse_identifier()?;
        let list = self.writer.singleton_list(parameter);

        self.writer.set(node, NODE_B, list);
        self.expect(T_ARROW)?;
        self.finish_arrow_body(node, is_async)?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses the body of an arrow function.
    fn finish_arrow_body(&mut self, node: u32, is_async: bool) -> PRes<()> {
        if is_async {
            self.writer.add_flags(node, NF_ASYNC);
        }

        let previous_async = self.in_async;
        let previous_generator = self.in_generator;

        self.in_async = is_async;
        self.in_generator = false;
        self.tokenizer.in_async = is_async;
        self.tokenizer.in_generator = false;

        let result = (|| -> PRes<()> {
            if self.at(T_BRACE_OPEN) {
                // An arrow's block body keeps the statement reading.
                let body = self.parse_block(true, true)?;

                self.writer.set(node, NODE_C, body);
            } else {
                self.writer.add_flags(node, NF_EXPRESSION_BODY);

                let body = self.parse_assignment_expression()?;

                self.writer.set(node, NODE_C, body);
            }

            Ok(())
        })();

        self.in_async = previous_async;
        self.in_generator = previous_generator;
        self.tokenizer.in_async = previous_async;
        self.tokenizer.in_generator = previous_generator;

        result
    }

    //-------------------------------------------------------------------------
    // Functions
    //-------------------------------------------------------------------------

    /// Parses a function expression.
    fn parse_function_expression(&mut self, start: u32, is_async: bool) -> PRes {
        let node = self.writer.alloc(N_FUNCTION_EXPRESSION, start);

        self.next()?;

        let is_generator = self.eat(T_STAR)?;

        if is_async {
            self.writer.add_flags(node, NF_ASYNC);
        }

        if is_generator {
            self.writer.add_flags(node, NF_GENERATOR);
        }

        if !self.at(T_PAREN_OPEN) && !self.at(T_LT) {
            let id = self.parse_identifier()?;

            self.writer.set(node, NODE_A, id);
        }

        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_D, type_parameters);

        let parameters = self.parse_parameter_list(is_async, is_generator)?;

        self.writer.set(node, NODE_B, parameters);

        let return_type = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_E, return_type);

        let body = self.parse_function_body(is_async, is_generator, false)?;

        self.writer.set(node, NODE_C, body);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a function body, switching the `await` and `yield` contexts.
    pub(crate) fn parse_function_body(
        &mut self,
        is_async: bool,
        is_generator: bool,
        is_statement: bool,
    ) -> PRes {
        let previous_async = self.in_async;
        let previous_generator = self.in_generator;

        self.in_async = is_async;
        self.in_generator = is_generator;
        self.tokenizer.in_async = is_async;
        self.tokenizer.in_generator = is_generator;

        let body = self.parse_block(true, is_statement);

        self.in_async = previous_async;
        self.in_generator = previous_generator;
        self.tokenizer.in_async = previous_async;
        self.tokenizer.in_generator = previous_generator;

        body
    }

    //-------------------------------------------------------------------------
    // Parameters and Patterns
    //-------------------------------------------------------------------------

    /// Parses a parenthesized parameter list in the enclosing context, the
    /// way an arrow function's parameters inherit it.
    pub(crate) fn parse_parameter_list_inherit(&mut self) -> PRes {
        let is_async = self.in_async;
        let is_generator = self.in_generator;

        self.parse_parameter_list(is_async, is_generator)
    }

    /// Parses a parenthesized parameter list.
    pub fn parse_parameter_list(&mut self, is_async: bool, is_generator: bool) -> PRes {
        let previous_async = self.in_async;
        let previous_generator = self.in_generator;
        let previous_allow_in = self.allow_in;

        self.allow_in = true;
        self.in_async = is_async;
        self.in_generator = is_generator;
        self.tokenizer.in_async = is_async;
        self.tokenizer.in_generator = is_generator;

        let result = self.parse_parameter_list_body();

        self.allow_in = previous_allow_in;
        self.in_async = previous_async;
        self.in_generator = previous_generator;
        self.tokenizer.in_async = previous_async;
        self.tokenizer.in_generator = previous_generator;

        result
    }

    fn parse_parameter_list_body(&mut self) -> PRes {
        let mark = self.writer.start_list();

        self.expect(T_PAREN_OPEN)?;

        while !self.at(T_PAREN_CLOSE) && !self.at(T_EOF) {
            let parameter = self.parse_parameter()?;
            let is_rest = self.writer.get(parameter, NODE_KIND) == N_REST_ELEMENT;
            let comma_start = self.start();

            self.writer.push_list(parameter);

            if !self.eat(T_COMMA)? {
                break;
            }

            // A rest parameter ends the list, so a comma after it separates
            // it from nothing.
            if is_rest && self.at(T_PAREN_CLOSE) {
                return Err(self.error_at(
                    "A rest parameter may not have a trailing comma.",
                    comma_start,
                ));
            }
        }

        self.expect(T_PAREN_CLOSE)?;

        Ok(self.writer.end_list(mark))
    }

    /// Parses one parameter, including TypeScript parameter properties.
    pub fn parse_parameter(&mut self) -> PRes {
        let start = self.start();
        let decorators = self.parse_decorators()?;
        let mut modifiers = 0u32;
        let mut saw_modifier = false;

        loop {
            let kind = self.kind();
            let bit = if kind == T_PUBLIC {
                ACCESS_PUBLIC << ACCESS_SHIFT
            } else if kind == T_PRIVATE {
                ACCESS_PRIVATE << ACCESS_SHIFT
            } else if kind == T_PROTECTED {
                ACCESS_PROTECTED << ACCESS_SHIFT
            } else if kind == T_READONLY {
                NF_READONLY
            } else if kind == T_OVERRIDE {
                NF_OVERRIDE
            } else {
                break;
            };

            if !self.next_starts_binding_element()? {
                break;
            }

            modifiers |= bit;
            saw_modifier = true;
            self.next()?;
        }

        let element = self.parse_binding_element()?;

        if !saw_modifier {
            // A decorator alone does not make a parameter property.
            if decorators != 0 {
                self.writer.set(element, NODE_C, decorators);

                // A rest parameter is the one binding form whose range covers
                // its decorators.
                if self.writer.get(element, NODE_KIND) == N_REST_ELEMENT {
                    self.writer.set(element, NODE_START, start);
                }
            }

            return Ok(element);
        }

        let node = self.writer.alloc(N_TS_PARAMETER_PROPERTY, start);

        self.writer.set(node, NODE_A, element);
        self.writer.set(node, NODE_B, decorators);
        self.writer.add_flags(node, modifiers);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Whether a binding element follows the current token.
    fn next_starts_binding_element(&mut self) -> PRes<bool> {
        let kind = self.tokenizer.peek()?;

        Ok(is_binding_name_kind(kind)
            || kind == T_BRACE_OPEN
            || kind == T_BRACKET_OPEN
            || kind == T_ELLIPSIS
            || kind == T_THIS
            || kind == T_PUBLIC
            || kind == T_PRIVATE
            || kind == T_PROTECTED
            || kind == T_READONLY
            || kind == T_OVERRIDE)
    }

    /// Parses a binding element: a target with an optional type annotation
    /// and an optional default value.
    pub(crate) fn parse_binding_element(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_ELLIPSIS) {
            let node = self.writer.alloc(N_REST_ELEMENT, start);

            self.next()?;

            let argument = self.parse_binding_atom()?;

            self.writer.set(node, NODE_A, argument);

            let annotation = self.try_parse_type_annotation()?;

            self.writer.set(node, NODE_B, annotation);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let target = self.parse_binding_atom()?;

        // The `?` and `!` are part of the binding they mark, so they widen
        // it.
        if self.eat(T_QUESTION)? {
            self.writer.add_flags(target, NF_OPTIONAL);
            self.writer.finish(target, self.last_end());
        }

        if self.at(T_NOT) {
            self.next()?;
            self.writer.add_flags(target, NF_DEFINITE);
            self.writer.finish(target, self.last_end());
        }

        let annotation = self.try_parse_type_annotation()?;

        if annotation != 0 {
            self.writer.set(target, NODE_B, annotation);
            self.writer.finish(target, self.last_end());
        }

        if !self.at(T_ASSIGN) {
            return Ok(target);
        }

        let node = self.writer.alloc(N_ASSIGNMENT_PATTERN, start);

        self.next()?;
        self.writer.set(node, NODE_A, target);

        let default = self.parse_assignment_expression()?;

        self.writer.set(node, NODE_B, default);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a binding target: an identifier or a destructuring pattern.
    pub fn parse_binding_atom(&mut self) -> PRes {
        if self.at(T_BRACKET_OPEN) {
            return self.parse_array_pattern();
        }

        if self.at(T_BRACE_OPEN) {
            return self.parse_object_pattern();
        }

        if self.at(T_THIS) {
            // A `this` parameter carries only a type annotation.
            let node = self.writer.alloc(N_IDENTIFIER, self.start());
            let end = self.end();

            self.writer.set(node, NODE_A, end);

            // Legal only as a parameter name; the word code is what lets
            // `validate()` catch `var [this] = x` without reading the text.
            self.writer.add_flags(
                node,
                (KIND_IDWORD_CODES[T_THIS as usize] as u32) << IDWORD_SHIFT,
            );
            self.next()?;

            return Ok(self.writer.finish(node, end));
        }

        self.parse_identifier()
    }

    /// Parses an array destructuring pattern.
    fn parse_array_pattern(&mut self) -> PRes {
        let node = self.writer.alloc(N_ARRAY_PATTERN, self.start());
        let mark = self.writer.start_list();
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_array_pattern_body(node, mark);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_array_pattern_body(&mut self, node: u32, mark: usize) -> PRes {
        self.next()?;

        while !self.at(T_BRACKET_CLOSE) && !self.at(T_EOF) {
            if self.at(T_COMMA) {
                self.writer.push_list(0);
                self.next()?;
                continue;
            }

            let is_rest = self.at(T_ELLIPSIS);
            let element = self.parse_binding_element()?;

            self.writer.push_list(element);

            if !self.eat(T_COMMA)? {
                break;
            }

            if is_rest {
                self.writer.add_flags(node, NF_COMMA_AFTER_REST);
            }
        }

        self.expect(T_BRACKET_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an object destructuring pattern.
    fn parse_object_pattern(&mut self) -> PRes {
        let node = self.writer.alloc(N_OBJECT_PATTERN, self.start());
        let mark = self.writer.start_list();
        let previous_allow_in = self.allow_in;

        self.allow_in = true;

        let result = self.parse_object_pattern_body(node, mark);

        self.allow_in = previous_allow_in;

        result
    }

    fn parse_object_pattern_body(&mut self, node: u32, mark: usize) -> PRes {
        self.enter_brace(false)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            if self.at(T_ELLIPSIS) {
                let rest = self.writer.alloc(N_REST_ELEMENT, self.start());

                self.next()?;

                let argument = self.parse_binding_atom()?;

                self.writer.set(rest, NODE_A, argument);

                let finished = self.writer.finish(rest, self.last_end());

                self.writer.push_list(finished);

                if !self.eat(T_COMMA)? {
                    break;
                }

                self.writer.add_flags(node, NF_COMMA_AFTER_REST);
                continue;
            }

            let start = self.start();
            let property = self.writer.alloc(N_PROPERTY, start);
            let computed = self.at(T_BRACKET_OPEN);

            // See `parseObjectMember`: shorthand makes the key a binding.
            let key_start = self.start();
            let key_end = self.end();
            let key_escaped = (self.tokenizer.flags & TF_HAS_ESCAPE) != 0;
            let key = self.parse_property_name()?;

            if computed {
                self.writer.add_flags(property, NF_COMPUTED);
            }

            self.writer.set(property, NODE_A, key);

            if self.eat(T_COLON)? {
                let value = self.parse_binding_element()?;

                self.writer.set(property, NODE_B, value);
            } else {
                self.writer.add_flags(property, NF_SHORTHAND);

                if key_escaped {
                    self.check_escaped_word(key_start, key_end)?;
                }

                if self.at(T_ASSIGN) {
                    let pattern = self.writer.alloc(N_ASSIGNMENT_PATTERN, start);

                    self.next()?;
                    self.writer.set(pattern, NODE_A, key);

                    let default = self.parse_assignment_expression()?;

                    self.writer.set(pattern, NODE_B, default);

                    let finished = self.writer.finish(pattern, self.last_end());

                    self.writer.set(property, NODE_B, finished);
                } else {
                    self.writer.set(property, NODE_B, key);
                }
            }

            let finished = self.writer.finish(property, self.last_end());

            self.writer.push_list(finished);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect(T_BRACE_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Reinterprets an already-parsed expression as a binding pattern, which
    /// is what makes `[a, b] = c` produce an `ArrayPattern`.
    pub(crate) fn to_pattern(&mut self, node: u32) {
        if node == 0 {
            return;
        }

        let kind = self.writer.get(node, NODE_KIND);

        match kind {
            k if k == N_ARRAY_EXPRESSION => {
                self.retype_as_pattern(node, N_ARRAY_PATTERN);
                self.to_pattern_list(self.writer.get(node, NODE_A));
            }
            k if k == N_OBJECT_EXPRESSION => {
                self.retype_as_pattern(node, N_OBJECT_PATTERN);
                self.to_pattern_list(self.writer.get(node, NODE_A));
            }
            k if k == N_PROPERTY => {
                self.to_pattern(self.writer.get(node, NODE_B));
            }
            k if k == N_SPREAD_ELEMENT => {
                self.retype_as_pattern(node, N_REST_ELEMENT);
                self.to_pattern(self.writer.get(node, NODE_A));
            }
            k if k == N_ASSIGNMENT_EXPRESSION => {
                self.retype_as_pattern(node, N_ASSIGNMENT_PATTERN);
                self.to_pattern(self.writer.get(node, NODE_A));
            }
            _ => {}
        }
    }

    /// Retypes an expression node as the binding pattern that mirrors it.
    ///
    /// Slot C means different things on the two sides — decorators on every
    /// binding form, the operator kind on `AssignmentExpression` — so it is
    /// cleared rather than carried across.
    fn retype_as_pattern(&mut self, node: u32, kind: u32) {
        self.writer.retype(node, kind);
        self.writer.set(node, NODE_C, 0);
    }

    /// Applies `to_pattern` to every element of a list.
    fn to_pattern_list(&mut self, handle: u32) {
        if handle == 0 {
            return;
        }

        let size = self.writer.lists.words[handle as usize];

        for i in 0..size {
            let item = self.writer.lists.words[handle as usize + 1 + i as usize];

            if item != 0 {
                self.to_pattern(item);
            }
        }
    }

    //-------------------------------------------------------------------------
    // Classes
    //-------------------------------------------------------------------------

    /// Parses decorators that precede a declaration or member.
    pub(crate) fn parse_decorators(&mut self) -> PRes {
        if !self.at(T_AT) {
            return Ok(0);
        }

        let mark = self.writer.start_list();

        while self.at(T_AT) {
            let node = self.writer.alloc(N_DECORATOR, self.start());

            self.next()?;

            let expression = self.parse_call_or_member_expression(false, 0, true)?;

            self.writer.set(node, NODE_A, expression);

            let finished = self.writer.finish(node, self.last_end());

            self.writer.push_list(finished);
        }

        Ok(self.writer.end_list(mark))
    }

    /// Parses a class declaration or expression.
    pub(crate) fn parse_class(&mut self, node_kind: u32, decorators: u32, start: u32) -> PRes {
        let node = self.writer.alloc(node_kind, start);

        self.writer.set(node, NODE_G, decorators);

        // Reading the keyword rather than stepping over it is what keeps
        // every caller honest about a class actually beginning here.
        self.expect(T_CLASS)?;

        if self.at_binding_name() && !self.at(T_IMPLEMENTS) {
            let id = self.parse_identifier()?;

            self.writer.set(node, NODE_A, id);
        }

        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_D, type_parameters);

        if self.eat(T_EXTENDS)? {
            // The heritage clause is a `LeftHandSideExpression`, so it may be
            // a call: `class C extends Mix(A, B) {}`.
            let heritage = self.parse_call_or_member_expression(false, 0, false)?;

            // `ClassHeritage : extends LeftHandSideExpression`, and an arrow
            // is an `AssignmentExpression`.
            if self.writer.get(heritage, NODE_KIND) == N_ARROW_FUNCTION_EXPRESSION
                && (self.writer.get(heritage, NODE_FLAGS) & NF_PARENTHESIZED) == 0
            {
                return Err(self.error_at(
                    "A class may not extend an arrow function.",
                    self.writer.get(heritage, NODE_START),
                ));
            }

            self.writer.set(node, NODE_B, heritage);

            if self.at(T_LT) {
                let type_arguments = self.parse_type_arguments()?;

                self.writer.set(node, NODE_E, type_arguments);
            }
        }

        if self.at(T_IMPLEMENTS) {
            self.next()?;

            let mark = self.writer.start_list();

            loop {
                let heritage = self.writer.alloc(N_TS_CLASS_IMPLEMENTS, self.start());
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

            self.writer.set(node, NODE_F, list);
        }

        let body = self.parse_class_body(node_kind == N_CLASS_DECLARATION)?;

        self.writer.set(node, NODE_C, body);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses the name in an `extends` or `implements` clause.
    pub(crate) fn parse_heritage_expression(&mut self) -> PRes {
        let start = self.start();
        let mut expression = self.parse_identifier()?;

        while self.eat(T_DOT)? {
            let property = self.parse_identifier_name()?;

            expression = self.finish_member(start, expression, property, false, false);
        }

        Ok(expression)
    }

    /// Parses the body of a class.
    fn parse_class_body(&mut self, is_statement: bool) -> PRes {
        let node = self.writer.alloc(N_CLASS_BODY, self.start());
        let mark = self.writer.start_list();
        let previous_super_property = self.allow_super_property;
        let previous_allow_in = self.allow_in;

        self.allow_in = true;
        self.allow_super_property = true;

        let result = self.parse_class_body_inner(node, mark, is_statement);

        self.allow_in = previous_allow_in;
        self.allow_super_property = previous_super_property;

        result
    }

    fn parse_class_body_inner(&mut self, node: u32, mark: usize, is_statement: bool) -> PRes {
        self.enter_brace(is_statement)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            if self.eat(T_SEMICOLON)? {
                continue;
            }

            let member = self.parse_class_member()?;

            self.writer.push_list(member);
        }

        self.expect(T_BRACE_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses one class member, including all of its modifiers.
    fn parse_class_member(&mut self) -> PRes {
        let start = self.start();
        let decorators = self.parse_decorators()?;
        let mut flags = 0u32;
        let mut is_static = false;
        let mut is_abstract = false;
        let mut is_async = false;
        let mut is_generator = false;
        let mut is_accessor = false;
        let mut method_kind = MKIND_INIT;

        loop {
            let kind = self.kind();

            // `static` is the one modifier a line break may follow.
            if kind == T_STATIC && self.next_starts_class_element_name(true, true)? {
                self.next()?;
                is_static = true;
                continue;
            }

            if kind == T_ABSTRACT && self.next_starts_class_element_name(false, true)? {
                self.next()?;
                is_abstract = true;
                continue;
            }

            if kind == T_DECLARE && self.next_starts_class_element_name(false, true)? {
                self.next()?;
                flags |= NF_DECLARE;
                continue;
            }

            if kind == T_OVERRIDE && self.next_starts_class_element_name(false, true)? {
                self.next()?;
                flags |= NF_OVERRIDE;
                continue;
            }

            if kind == T_READONLY && self.next_starts_class_element_name(false, true)? {
                self.next()?;
                flags |= NF_READONLY;
                continue;
            }

            if (kind == T_PUBLIC || kind == T_PRIVATE || kind == T_PROTECTED)
                && self.next_starts_class_element_name(false, true)?
            {
                let access = if kind == T_PUBLIC {
                    ACCESS_PUBLIC
                } else if kind == T_PRIVATE {
                    ACCESS_PRIVATE
                } else {
                    ACCESS_PROTECTED
                };

                // One node holds one accessibility, in two bits, so a second
                // modifier has nowhere to go.
                if (flags & ACCESS_MASK) != 0 {
                    return Err(self.error(
                        "An accessibility modifier may only be written once.",
                    ));
                }

                self.next()?;
                flags |= access << ACCESS_SHIFT;
                continue;
            }

            if kind == T_ACCESSOR && self.next_starts_class_element_name(false, true)? {
                self.next()?;
                is_accessor = true;
                continue;
            }

            break;
        }

        // An index signature stands in for a named member.
        if self.at_index_signature()? {
            let signature = self.parse_index_signature(start, (flags & NF_READONLY) != 0)?;

            self.writer.add_flags(signature, flags & !NF_READONLY);

            if is_static {
                self.writer.add_flags(signature, NF_STATIC);
            }

            self.semicolon()?;

            return Ok(self.writer.finish(signature, self.last_end()));
        }

        // A static initialization block has no name.
        if is_static && self.at(T_BRACE_OPEN) {
            let node = self.writer.alloc(N_STATIC_BLOCK, start);
            let mark = self.writer.start_list();

            self.enter_brace(true)?;

            while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
                let statement = self.parse_statement(false)?;

                self.writer.push_list(statement);
            }

            self.expect(T_BRACE_CLOSE)?;

            let list = self.writer.end_list(mark);

            self.writer.set(node, NODE_A, list);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if self.at(T_ASYNC) && self.next_starts_class_element_name(false, true)? {
            self.next()?;
            is_async = true;
        }

        if self.eat(T_STAR)? {
            is_generator = true;
        }

        // `get` and `set` carry no `[no LineTerminator here]`, unlike
        // `async` and `accessor`.
        if !is_async
            && !is_generator
            && (self.at(T_GET) || self.at(T_SET))
            && self.next_starts_class_element_name(true, false)?
        {
            method_kind = if self.at(T_GET) { MKIND_GET } else { MKIND_SET };
            self.next()?;
        }

        let computed = self.at(T_BRACKET_OPEN);
        let key = self.parse_property_name()?;
        let optional = self.eat(T_QUESTION)?;
        let definite = !optional && self.at(T_NOT);

        if definite {
            self.next()?;
        }

        if method_kind != MKIND_INIT
            || is_async
            || is_generator
            || self.at(T_PAREN_OPEN)
            || self.at(T_LT)
        {
            // `accessor` makes a field into a getter and setter pair, so
            // there is no accessor method for it to make.
            if is_accessor {
                return Err(self.error_at(
                    "An 'accessor' modifier may only appear on a class field.",
                    self.writer.get(key, NODE_START),
                ));
            }

            return self.finish_method_definition(
                start,
                key,
                decorators,
                flags,
                is_static,
                is_abstract,
                computed,
                optional,
                if method_kind == MKIND_INIT {
                    MKIND_METHOD
                } else {
                    method_kind
                },
                is_async,
                is_generator,
            );
        }

        self.finish_property_definition(
            start, key, decorators, flags, is_static, is_abstract, is_accessor, computed,
            optional, definite,
        )
    }

    /// Builds a method definition node from already-parsed modifiers.
    #[allow(clippy::too_many_arguments)]
    fn finish_method_definition(
        &mut self,
        start: u32,
        key: u32,
        decorators: u32,
        flags: u32,
        is_static: bool,
        is_abstract: bool,
        computed: bool,
        optional: bool,
        method_kind: u32,
        is_async: bool,
        is_generator: bool,
    ) -> PRes {
        let node = self.writer.alloc(
            if is_abstract {
                N_TS_ABSTRACT_METHOD_DEFINITION
            } else {
                N_METHOD_DEFINITION
            },
            start,
        );
        let is_constructor = !computed
            && !is_static
            && method_kind == MKIND_METHOD
            && self.is_named(key, "constructor");

        self.writer.set(node, NODE_A, key);
        self.writer.set(node, NODE_C, decorators);
        self.writer.add_flags(node, flags);

        if is_static {
            self.writer.add_flags(node, NF_STATIC);
        }

        if computed {
            self.writer.add_flags(node, NF_COMPUTED);
        }

        if optional {
            self.writer.add_flags(node, NF_OPTIONAL);
        }

        self.writer.add_flags(
            node,
            (if is_constructor {
                MKIND_CONSTRUCTOR
            } else {
                method_kind
            }) << MKIND_SHIFT,
        );

        let previous_super_call = self.allow_super_call;

        self.allow_super_call = is_constructor;

        let value = self.parse_method_value(is_async, is_generator);

        self.allow_super_call = previous_super_call;
        self.writer.set(node, NODE_B, value?);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Builds a property definition node from already-parsed modifiers.
    #[allow(clippy::too_many_arguments)]
    fn finish_property_definition(
        &mut self,
        start: u32,
        key: u32,
        decorators: u32,
        flags: u32,
        is_static: bool,
        is_abstract: bool,
        is_accessor: bool,
        computed: bool,
        optional: bool,
        definite: bool,
    ) -> PRes {
        let node_kind = if is_accessor {
            if is_abstract {
                N_TS_ABSTRACT_ACCESSOR_PROPERTY
            } else {
                N_ACCESSOR_PROPERTY
            }
        } else if is_abstract {
            N_TS_ABSTRACT_PROPERTY_DEFINITION
        } else {
            N_PROPERTY_DEFINITION
        };

        let node = self.writer.alloc(node_kind, start);

        self.writer.set(node, NODE_A, key);
        self.writer.set(node, NODE_C, decorators);

        let annotation = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_D, annotation);
        self.writer.add_flags(node, flags);

        if is_static {
            self.writer.add_flags(node, NF_STATIC);
        }

        if computed {
            self.writer.add_flags(node, NF_COMPUTED);
        }

        if optional {
            self.writer.add_flags(node, NF_OPTIONAL);
        }

        if definite {
            self.writer.add_flags(node, NF_DEFINITE);
        }

        if self.eat(T_ASSIGN)? {
            let value = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_B, value);
        }

        self.semicolon()?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Whether a key node names something, however it spells it.
    fn is_named(&self, key: u32, name: &str) -> bool {
        let kind = self.writer.get(key, NODE_KIND);
        let name_units: Vec<u16> = name.encode_utf16().collect();

        if kind == N_LITERAL {
            if self.writer.get(key, NODE_A) != LIT_STRING {
                return false;
            }

            let raw = &self.source[self.writer.get(key, NODE_START) as usize + 1
                ..self.writer.get(key, NODE_END) as usize - 1];

            return if raw.contains(&(0x5c /* backslash */)) {
                decode_escapes(raw) == name_units
            } else {
                raw == name_units.as_slice()
            };
        }

        if kind != N_IDENTIFIER {
            return false;
        }

        let start = self.writer.get(key, NODE_START) as usize;
        let end = self.writer.get(key, NODE_END) as usize;

        if end - start != name_units.len() {
            return false;
        }

        &self.source[start..end] == name_units.as_slice()
    }

    /// Whether a class element name follows the current token.
    fn next_starts_class_element_name(
        &mut self,
        allow_newline: bool,
        allow_generator: bool,
    ) -> PRes<bool> {
        let kind = self.tokenizer.peek()?;

        Ok((is_identifier_name_kind(kind)
            || kind == T_STRING
            || kind == T_NUMBER
            || kind == T_BRACKET_OPEN
            || kind == T_PRIVATE_IDENT
            || (kind == T_STAR && allow_generator)
            || kind == T_BRACE_OPEN)
            && (allow_newline || !self.tokenizer.peek_newline_before))
    }
}
