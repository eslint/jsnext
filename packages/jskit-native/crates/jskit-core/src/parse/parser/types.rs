//! The TypeScript type grammar.
//!
//! Port of `packages/jskit/src/parse/parser-types.ts`.

use super::{PRes, Parser};
use crate::parse::binary::TF_INVALID_ESCAPE;
use crate::parse::node_kinds::*;
use crate::parse::token_kinds::*;

impl<'a> Parser<'a> {
    //-------------------------------------------------------------------------
    // Entry Points
    //-------------------------------------------------------------------------

    /// Parses a `: Type` annotation when one is present; `0` when absent.
    pub fn try_parse_type_annotation(&mut self) -> PRes {
        if !self.at(T_COLON) {
            return Ok(0);
        }

        self.parse_type_annotation()
    }

    /// Parses a `: Type` annotation, including the colon.
    pub fn parse_type_annotation(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_ANNOTATION, self.start());

        self.expect(T_COLON)?;

        let inner = self.parse_type_or_predicate()?;

        self.writer.set(node, NODE_A, inner);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a type, allowing the `x is T` and `asserts x is T` forms.
    pub fn parse_type_or_predicate(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_ASSERTS) {
            let state = self.tokenizer.save();
            let snapshot = self.writer.mark();

            self.next()?;

            if (self.at_binding_name() || self.at(T_THIS)) && !self.newline_before() {
                let node = self.writer.alloc(N_TS_TYPE_PREDICATE, start);
                let parameter_name = if self.at(T_THIS) {
                    self.parse_this_type()?
                } else {
                    self.parse_identifier()?
                };

                self.writer.set(node, NODE_A, parameter_name);
                self.writer.set(node, NODE_C, 1);

                if self.at(T_IS) {
                    self.next()?;

                    let annotation = self.parse_predicate_type()?;

                    self.writer.set(node, NODE_B, annotation);
                }

                return Ok(self.writer.finish(node, self.last_end()));
            }

            self.writer.rewind(snapshot);
            self.tokenizer.restore(&state);
        }

        // A predicate such as `object is Foo` begins with a plain name that
        // would otherwise be read as a keyword type.
        if (self.at_binding_name() || self.at(T_THIS)) && self.peek_is_on_same_line(T_IS)? {
            let node = self.writer.alloc(N_TS_TYPE_PREDICATE, start);
            let parameter_name = if self.at(T_THIS) {
                self.parse_this_type()?
            } else {
                self.parse_identifier()?
            };

            self.writer.set(node, NODE_A, parameter_name);
            self.next()?;

            let annotation = self.parse_predicate_type()?;

            self.writer.set(node, NODE_B, annotation);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let type_node = self.parse_type()?;

        if self.at(T_IS) && !self.newline_before() {
            let kind_of_type = self.writer.get(type_node, NODE_KIND);

            if kind_of_type == N_TS_TYPE_REFERENCE || kind_of_type == N_TS_THIS_TYPE {
                let node = self.writer.alloc(N_TS_TYPE_PREDICATE, start);

                self.next()?;

                let annotation = self.parse_predicate_type()?;
                let parameter_name = if kind_of_type == N_TS_THIS_TYPE {
                    type_node
                } else {
                    self.writer.get(type_node, NODE_A)
                };

                self.writer.set(node, NODE_A, parameter_name);
                self.writer.set(node, NODE_B, annotation);

                return Ok(self.writer.finish(node, self.last_end()));
            }
        }

        Ok(type_node)
    }

    /// Parses the type after the `is` of a type predicate, wrapped the way
    /// `@typescript-eslint/parser` wraps it.
    fn parse_predicate_type(&mut self) -> PRes {
        let annotation = self.writer.alloc(N_TS_TYPE_ANNOTATION, self.start());
        let type_node = self.parse_type()?;

        self.writer.set(annotation, NODE_A, type_node);
        self.writer
            .set(annotation, NODE_START, self.writer.get(type_node, NODE_START));

        let end = self.writer.get(type_node, NODE_END);

        Ok(self.writer.finish(annotation, end))
    }

    /// Parses a complete type, including conditional types.
    pub fn parse_type(&mut self) -> PRes {
        // A conditional type may appear here, so an enclosing one no longer
        // has any claim on the next `?`.
        let outer_no_conditional_types = self.no_conditional_types;

        self.no_conditional_types = false;

        let result = self.parse_type_body();

        self.no_conditional_types = outer_no_conditional_types;

        result
    }

    fn parse_type_body(&mut self) -> PRes {
        let start = self.start();

        if self.at_constructor_type_start()? {
            return self.parse_function_or_constructor_type();
        }

        if self.at_function_type_start()? {
            let function_type = self.try_function_type()?;

            if function_type != 0 {
                return Ok(function_type);
            }
        }

        let check_type = self.parse_union_type()?;

        if !self.at(T_EXTENDS) || self.newline_before() {
            return Ok(check_type);
        }

        let node = self.writer.alloc(N_TS_CONDITIONAL_TYPE, start);

        self.next()?;
        self.writer.set(node, NODE_A, check_type);

        // The `extends` type is parsed without conditional types so that the
        // `?` belongs to this conditional rather than a nested one.
        self.no_conditional_types = true;

        let extends_type = if self.at_constructor_type_start()? || self.at_function_type_start()?
        {
            self.parse_function_or_constructor_type()
        } else {
            self.parse_union_type()
        };

        // The flag is restored before propagating so a failure leaves the
        // parser the way the TypeScript `finally` would.
        self.no_conditional_types = false;

        self.writer.set(node, NODE_B, extends_type?);

        self.expect(T_QUESTION)?;

        let true_type = self.parse_type()?;

        self.writer.set(node, NODE_C, true_type);
        self.expect(T_COLON)?;

        let false_type = self.parse_type()?;

        self.writer.set(node, NODE_D, false_type);

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // Composite Types
    //-------------------------------------------------------------------------

    /// Parses a union type, which may begin with a leading `|`.
    fn parse_union_type(&mut self) -> PRes {
        self.parse_union_or_intersection(T_PIPE, N_TS_UNION_TYPE, Self::parse_intersection_type)
    }

    /// Parses an intersection type, which may begin with a leading `&`.
    fn parse_intersection_type(&mut self) -> PRes {
        self.parse_union_or_intersection(T_AMP, N_TS_INTERSECTION_TYPE, Self::parse_type_operator)
    }

    /// Shared driver for union and intersection types.
    fn parse_union_or_intersection(
        &mut self,
        separator: u32,
        node_kind: u32,
        parse_operand: fn(&mut Self) -> PRes,
    ) -> PRes {
        let start = self.start();
        let leading = self.eat(separator)?;
        let first = parse_operand(self)?;

        if !self.at(separator) {
            return if leading {
                self.wrap_single_constituent(node_kind, start, first)
            } else {
                Ok(first)
            };
        }

        let node = self.writer.alloc(node_kind, start);
        let mark = self.writer.start_list();

        self.writer.push_list(first);

        while self.eat(separator)? {
            let operand = parse_operand(self)?;

            self.writer.push_list(operand);
        }

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Wraps a lone constituent that was preceded by a leading separator.
    fn wrap_single_constituent(&mut self, node_kind: u32, start: u32, operand: u32) -> PRes {
        let node = self.writer.alloc(node_kind, start);
        let list = self.writer.singleton_list(operand);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses `keyof`, `unique`, and `readonly` type operators.
    fn parse_type_operator(&mut self) -> PRes {
        let kind = self.kind();

        if kind == T_KEYOF || kind == T_UNIQUE || kind == T_READONLY {
            let node = self.writer.alloc(N_TS_TYPE_OPERATOR, self.start());

            self.next()?;

            let operand = self.parse_type_operator()?;

            self.writer.set(node, NODE_A, operand);
            self.writer.set(node, NODE_B, kind);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        if kind == T_INFER {
            return self.parse_infer_type();
        }

        self.parse_postfix_type()
    }

    /// Parses `infer T` and `infer T extends U`.
    fn parse_infer_type(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_INFER_TYPE, self.start());

        self.next()?;

        let parameter = self.writer.alloc(N_TS_TYPE_PARAMETER, self.start());
        let name = self.parse_identifier()?;

        self.writer.set(parameter, NODE_A, name);

        // `infer T extends U` is only a constraint when it is not the
        // `extends` of an enclosing conditional type.
        if self.at(T_EXTENDS) {
            let state = self.tokenizer.save();
            let snapshot = self.writer.mark();

            self.next()?;

            let constraint = self.parse_union_type()?;

            if !self.no_conditional_types && self.at(T_QUESTION) {
                self.writer.rewind(snapshot);
                self.tokenizer.restore(&state);
            } else {
                self.writer.set(parameter, NODE_B, constraint);
            }
        }

        let finished = self.writer.finish(parameter, self.last_end());

        self.writer.set(node, NODE_A, finished);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses array and indexed access suffixes.
    fn parse_postfix_type(&mut self) -> PRes {
        let start = self.start();
        let mut type_node = self.parse_primary_type()?;

        while self.at(T_BRACKET_OPEN) && !self.newline_before() {
            self.next()?;

            if self.eat(T_BRACKET_CLOSE)? {
                let node = self.writer.alloc(N_TS_ARRAY_TYPE, start);

                self.writer.set(node, NODE_A, type_node);
                type_node = self.writer.finish(node, self.last_end());
                continue;
            }

            let node = self.writer.alloc(N_TS_INDEXED_ACCESS_TYPE, start);

            self.writer.set(node, NODE_A, type_node);

            let index = self.parse_type()?;

            self.writer.set(node, NODE_B, index);
            self.expect(T_BRACKET_CLOSE)?;
            type_node = self.writer.finish(node, self.last_end());
        }

        Ok(type_node)
    }

    //-------------------------------------------------------------------------
    // Primary Types
    //-------------------------------------------------------------------------

    /// Parses the innermost form of a type.
    fn parse_primary_type(&mut self) -> PRes {
        let kind = self.kind();
        let start = self.start();

        match kind {
            k if k == T_ANY => self.parse_keyword_type(N_TS_ANY_KEYWORD),
            k if k == T_UNKNOWN => self.parse_keyword_type(N_TS_UNKNOWN_KEYWORD),
            k if k == T_NEVER => self.parse_keyword_type(N_TS_NEVER_KEYWORD),
            k if k == T_STRING_KW => self.parse_keyword_type(N_TS_STRING_KEYWORD),
            k if k == T_NUMBER_KW => self.parse_keyword_type(N_TS_NUMBER_KEYWORD),
            k if k == T_BIGINT_KW => self.parse_keyword_type(N_TS_BIG_INT_KEYWORD),
            k if k == T_BOOLEAN => self.parse_keyword_type(N_TS_BOOLEAN_KEYWORD),
            k if k == T_SYMBOL => self.parse_keyword_type(N_TS_SYMBOL_KEYWORD),
            k if k == T_OBJECT => self.parse_keyword_type(N_TS_OBJECT_KEYWORD),
            k if k == T_UNDEFINED => self.parse_keyword_type(N_TS_UNDEFINED_KEYWORD),
            k if k == T_VOID => self.parse_keyword_type(N_TS_VOID_KEYWORD),
            k if k == T_INTRINSIC => self.parse_keyword_type(N_TS_INTRINSIC_KEYWORD),
            k if k == T_NULL => self.parse_keyword_type(N_TS_NULL_KEYWORD),
            k if k == T_THIS => self.parse_this_type(),
            k if k == T_TYPEOF => self.parse_type_query(),
            k if k == T_IMPORT => self.parse_import_type(),
            k if k == T_BRACKET_OPEN => self.parse_tuple_type(),
            k if k == T_BRACE_OPEN => {
                if self.at_mapped_type_start()? {
                    self.parse_mapped_type()
                } else {
                    self.parse_type_literal()
                }
            }
            k if k == T_PAREN_OPEN => {
                self.next()?;

                let inner = self.parse_type()?;

                self.expect(T_PAREN_CLOSE)?;

                Ok(inner)
            }
            k if k == T_STRING
                || k == T_NUMBER
                || k == T_BIGINT
                || k == T_TRUE
                || k == T_FALSE =>
            {
                let node = self.writer.alloc(N_TS_LITERAL_TYPE, start);
                let literal = self.parse_literal()?;

                self.writer.set(node, NODE_A, literal);

                Ok(self.writer.finish(node, self.last_end()))
            }
            k if k == T_MINUS => {
                let node = self.writer.alloc(N_TS_LITERAL_TYPE, start);
                let literal = self.parse_negative_literal()?;

                self.writer.set(node, NODE_A, literal);

                Ok(self.writer.finish(node, self.last_end()))
            }
            k if k == T_TEMPLATE_FULL || k == T_TEMPLATE_HEAD => {
                self.parse_template_literal_type()
            }
            k if is_identifier_name_kind(k) => self.parse_type_reference(),
            _ => Err(self.unexpected()),
        }
    }

    /// Parses a keyword type such as `string`.
    fn parse_keyword_type(&mut self, node_kind: u32) -> PRes {
        let node = self.writer.alloc(node_kind, self.start());
        let end = self.end();

        self.next()?;

        Ok(self.writer.finish(node, end))
    }

    /// Parses the `this` type.
    fn parse_this_type(&mut self) -> PRes {
        self.parse_keyword_type(N_TS_THIS_TYPE)
    }

    /// Parses a negated numeric literal used as a literal type.
    fn parse_negative_literal(&mut self) -> PRes {
        let node = self.writer.alloc(N_UNARY_EXPRESSION, self.start());
        let operator = self.kind();

        self.next()?;

        let literal = self.parse_literal()?;

        self.writer.set(node, NODE_A, literal);
        self.writer.set(node, NODE_B, operator);
        self.writer.add_flags(node, NF_PREFIX);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses `typeof X` and `typeof import(...)`.
    fn parse_type_query(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_QUERY, self.start());

        self.next()?;

        let name = if self.at(T_IMPORT) {
            self.parse_import_type()?
        } else {
            let from_this = self.at(T_THIS);

            self.parse_entity_name(from_this)?
        };

        self.writer.set(node, NODE_A, name);

        if self.at(T_LT) && !self.newline_before() {
            let type_arguments = self.parse_type_arguments()?;

            self.writer.set(node, NODE_B, type_arguments);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses `import("mod").Qualifier<Args>`.
    fn parse_import_type(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_IMPORT_TYPE, self.start());

        self.next()?;
        self.expect(T_PAREN_OPEN)?;

        // The module specifier is a plain string literal, not a literal type.
        let specifier = if self.at(T_STRING) {
            self.parse_literal()?
        } else {
            self.parse_type()?
        };

        self.writer.set(node, NODE_A, specifier);

        // The import options are an object literal, not a type literal.
        if self.eat(T_COMMA)? {
            let options = self.parse_assignment_expression()?;

            self.writer.set(node, NODE_D, options);
        }

        self.expect(T_PAREN_CLOSE)?;

        if self.eat(T_DOT)? {
            let qualifier = self.parse_entity_name(false)?;

            self.writer.set(node, NODE_B, qualifier);
        }

        if self.at(T_LT) && !self.newline_before() {
            let type_arguments = self.parse_type_arguments()?;

            self.writer.set(node, NODE_C, type_arguments);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a dotted name such as `A.B.C`.
    pub fn parse_entity_name(&mut self, from_this: bool) -> PRes {
        let start = self.start();

        // In `typeof this.x` the `this` is an expression, not the `this`
        // type, so it is built as a `ThisExpression`.
        let mut name = if from_this {
            self.parse_keyword_type(N_THIS_EXPRESSION)?
        } else {
            self.parse_identifier_name()?
        };

        while self.at(T_DOT) {
            self.next()?;

            let node = self.writer.alloc(N_TS_QUALIFIED_NAME, start);

            self.writer.set(node, NODE_A, name);

            let right = self.parse_identifier_name()?;

            self.writer.set(node, NODE_B, right);
            name = self.writer.finish(node, self.last_end());
        }

        Ok(name)
    }

    /// Parses a named type reference with optional type arguments.
    fn parse_type_reference(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_REFERENCE, self.start());
        let name = self.parse_entity_name(false)?;

        self.writer.set(node, NODE_A, name);

        if self.at(T_LT) && !self.newline_before() {
            let type_arguments = self.parse_type_arguments()?;

            self.writer.set(node, NODE_B, type_arguments);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a tuple type, including named, optional, and rest members.
    fn parse_tuple_type(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TUPLE_TYPE, self.start());
        let mark = self.writer.start_list();

        self.next()?;

        while !self.at(T_BRACKET_CLOSE) && !self.at(T_EOF) {
            let member = self.parse_tuple_member()?;

            self.writer.push_list(member);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect(T_BRACKET_CLOSE)?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses one member of a tuple type.
    fn parse_tuple_member(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_ELLIPSIS) {
            let node = self.writer.alloc(N_TS_REST_TYPE, start);

            self.next()?;

            let inner = self.parse_tuple_member()?;

            self.writer.set(node, NODE_A, inner);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        // A label is an identifier followed by `?:` or `:`.
        if self.at_labeled_tuple_member()? {
            let node = self.writer.alloc(N_TS_NAMED_TUPLE_MEMBER, start);
            let label = self.parse_identifier_name()?;

            self.writer.set(node, NODE_A, label);

            if self.eat(T_QUESTION)? {
                self.writer.add_flags(node, NF_OPTIONAL);
            }

            self.expect(T_COLON)?;

            let element = self.parse_type()?;

            self.writer.set(node, NODE_B, element);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let type_node = self.parse_type()?;

        if self.at(T_QUESTION) {
            let node = self.writer.alloc(N_TS_OPTIONAL_TYPE, start);

            self.next()?;
            self.writer.set(node, NODE_A, type_node);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        Ok(type_node)
    }

    /// Whether the current tuple member carries a label.
    fn at_labeled_tuple_member(&mut self) -> PRes<bool> {
        if !is_identifier_name_kind(self.kind()) {
            return Ok(false);
        }

        let state = self.tokenizer.save();

        self.next()?;

        let _optional = self.eat(T_QUESTION)?;
        let labeled = self.at(T_COLON);

        self.tokenizer.restore(&state);

        Ok(labeled)
    }

    //-------------------------------------------------------------------------
    // Object Types
    //-------------------------------------------------------------------------

    /// Whether a `{` opens a mapped type.
    fn at_mapped_type_start(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.enter_brace(false)?;

        let mut result = false;

        if self.at(T_PLUS) || self.at(T_MINUS) {
            result = true;
        } else {
            if self.at(T_READONLY) {
                self.next()?;
            }

            if self.at(T_BRACKET_OPEN) {
                self.next()?;

                if self.at_binding_name() {
                    self.next()?;
                    result = self.at(T_IN);
                }
            }
        }

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Parses a mapped type such as `{ readonly [K in Keys]?: T }`.
    fn parse_mapped_type(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_MAPPED_TYPE, self.start());

        self.enter_brace(false)?;

        // `readonly`, `+readonly`, and `-readonly` are all spelled here.
        if self.at(T_PLUS) || self.at(T_MINUS) {
            let sign = self.kind();

            self.next()?;
            self.expect(T_READONLY)?;
            self.writer
                .set(node, NODE_F, if sign == T_PLUS { 2 } else { 3 });
        } else if self.eat(T_READONLY)? {
            self.writer.set(node, NODE_F, 1);
        }

        self.expect(T_BRACKET_OPEN)?;

        let key = self.writer.alloc(N_TS_TYPE_PARAMETER, self.start());
        let name = self.parse_identifier()?;

        self.writer.set(key, NODE_A, name);
        self.expect(T_IN)?;

        let constraint = self.parse_type()?;

        self.writer.set(key, NODE_B, constraint);

        let finished_key = self.writer.finish(key, self.last_end());

        self.writer.set(node, NODE_A, finished_key);

        if self.eat(T_EXTENDS)? || self.eat(T_AS)? {
            let name_type = self.parse_type()?;

            self.writer.set(node, NODE_C, name_type);
        }

        self.expect(T_BRACKET_CLOSE)?;

        if self.at(T_PLUS) || self.at(T_MINUS) {
            let sign = self.kind();

            self.next()?;
            self.expect(T_QUESTION)?;
            self.writer
                .set(node, NODE_E, if sign == T_PLUS { 2 } else { 3 });
        } else if self.eat(T_QUESTION)? {
            self.writer.set(node, NODE_E, 1);
        }

        if self.at(T_COLON) {
            self.next()?;

            let value = self.parse_type()?;

            self.writer.set(node, NODE_D, value);
        }

        self.eat(T_SEMICOLON)?;
        self.expect(T_BRACE_CLOSE)?;

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an object type literal.
    fn parse_type_literal(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_LITERAL, self.start());
        let members = self.parse_object_type_members()?;

        self.writer.set(node, NODE_A, members);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a brace-delimited list of type members.
    pub fn parse_object_type_members(&mut self) -> PRes {
        let mark = self.writer.start_list();

        self.enter_brace(false)?;

        while !self.at(T_BRACE_CLOSE) && !self.at(T_EOF) {
            let member = self.parse_type_member()?;

            self.writer.push_list(member);

            // Members may be separated by `,` or `;`, or by nothing at all
            // when a line break already separates them.
            if self.eat(T_COMMA)? || self.eat(T_SEMICOLON)? {
                self.writer.finish(member, self.last_end());
            } else if !self.newline_before() {
                break;
            }
        }

        self.expect(T_BRACE_CLOSE)?;

        Ok(self.writer.end_list(mark))
    }

    /// Parses a single member of an object type.
    fn parse_type_member(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_PAREN_OPEN) || self.at(T_LT) {
            return self.parse_signature_member(N_TS_CALL_SIGNATURE_DECLARATION, start);
        }

        if self.at(T_NEW) && self.next_starts_signature()? {
            self.next()?;

            return self.parse_signature_member(N_TS_CONSTRUCT_SIGNATURE_DECLARATION, start);
        }

        let mut readonly = false;

        if self.at(T_READONLY) && self.next_starts_member_name()? {
            self.next()?;
            readonly = true;
        }

        if self.at_index_signature()? {
            return self.parse_index_signature(start, readonly);
        }

        let mut method_kind = 0u32;

        if (self.at(T_GET) || self.at(T_SET)) && self.next_starts_member_name()? {
            method_kind = if self.kind() == T_GET { 1 } else { 2 };
            self.next()?;
        }

        let computed = self.at(T_BRACKET_OPEN);
        let key = self.parse_type_member_name()?;
        let optional = self.eat(T_QUESTION)?;

        if self.at(T_PAREN_OPEN) || self.at(T_LT) {
            let node = self.writer.alloc(N_TS_METHOD_SIGNATURE, start);

            self.writer.set(node, NODE_A, key);

            let type_parameters = self.try_parse_type_parameters()?;

            self.writer.set(node, NODE_D, type_parameters);

            let parameters = self.parse_parameter_list_inherit()?;

            self.writer.set(node, NODE_B, parameters);

            let return_type = self.try_parse_type_annotation()?;

            self.writer.set(node, NODE_C, return_type);

            if computed {
                self.writer.add_flags(node, NF_COMPUTED);
            }

            if optional {
                self.writer.add_flags(node, NF_OPTIONAL);
            }

            self.writer.add_flags(node, method_kind << MKIND_SHIFT);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let node = self.writer.alloc(N_TS_PROPERTY_SIGNATURE, start);

        self.writer.set(node, NODE_A, key);

        let annotation = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_B, annotation);

        if computed {
            self.writer.add_flags(node, NF_COMPUTED);
        }

        if optional {
            self.writer.add_flags(node, NF_OPTIONAL);
        }

        if readonly {
            self.writer.add_flags(node, NF_READONLY);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a call or construct signature.
    fn parse_signature_member(&mut self, node_kind: u32, start: u32) -> PRes {
        let node = self.writer.alloc(node_kind, start);
        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_C, type_parameters);

        let parameters = self.parse_parameter_list_inherit()?;

        self.writer.set(node, NODE_A, parameters);

        let return_type = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_B, return_type);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses an index signature such as `[key: string]: T`.
    pub fn parse_index_signature(&mut self, start: u32, readonly: bool) -> PRes {
        let node = self.writer.alloc(N_TS_INDEX_SIGNATURE, start);

        self.expect(T_BRACKET_OPEN)?;

        let parameter = self.parse_identifier()?;
        let annotation = self.parse_type_annotation()?;

        self.writer.set(parameter, NODE_B, annotation);
        self.writer.finish(parameter, self.last_end());
        self.expect(T_BRACKET_CLOSE)?;

        let list = self.writer.singleton_list(parameter);

        self.writer.set(node, NODE_A, list);

        let return_type = self.try_parse_type_annotation()?;

        self.writer.set(node, NODE_B, return_type);

        if readonly {
            self.writer.add_flags(node, NF_READONLY);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Whether the current `[` opens an index signature rather than a
    /// computed member name.
    pub fn at_index_signature(&mut self) -> PRes<bool> {
        if !self.at(T_BRACKET_OPEN) {
            return Ok(false);
        }

        let state = self.tokenizer.save();

        self.next()?;

        let mut result = false;

        if self.at_binding_name() {
            self.next()?;
            result = self.at(T_COLON);
        }

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether a signature follows the current token.
    fn next_starts_signature(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let result = self.at(T_PAREN_OPEN) || self.at(T_LT);

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Whether a member name follows the current token.
    pub(crate) fn next_starts_member_name(&mut self) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let kind = self.kind();
        let result = is_identifier_name_kind(kind)
            || kind == T_STRING
            || kind == T_NUMBER
            || kind == T_BRACKET_OPEN;

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Parses the name of an object type member.
    fn parse_type_member_name(&mut self) -> PRes {
        if self.at(T_BRACKET_OPEN) {
            self.next()?;

            let key = self.parse_assignment_expression()?;

            self.expect(T_BRACKET_CLOSE)?;

            return Ok(key);
        }

        if self.at(T_STRING) || self.at(T_NUMBER) {
            return self.parse_literal();
        }

        self.parse_identifier_name()
    }

    //-------------------------------------------------------------------------
    // Function Types
    //-------------------------------------------------------------------------

    /// Whether a constructor type starts at the current token.
    fn at_constructor_type_start(&mut self) -> PRes<bool> {
        Ok(self.at(T_NEW) || (self.at(T_ABSTRACT) && self.peek_is(T_NEW)?))
    }

    /// Tests the kind of the token after the current one.
    pub(crate) fn peek_is(&mut self, kind: u32) -> PRes<bool> {
        let state = self.tokenizer.save();

        self.next()?;

        let result = self.at(kind);

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Tests the kind of the token after the current one, requiring that no
    /// line break separates them.
    fn peek_is_on_same_line(&mut self, kind: u32) -> PRes<bool> {
        Ok(self.tokenizer.peek()? == kind && !self.tokenizer.peek_newline_before)
    }

    /// Parses a function type, giving the shape back when it is not one.
    fn try_function_type(&mut self) -> PRes {
        if !self.at(T_PAREN_OPEN) {
            return self.parse_function_or_constructor_type();
        }

        self.speculate(Self::parse_function_or_constructor_type)
    }

    /// Whether a function type starts at the current token.
    fn at_function_type_start(&mut self) -> PRes<bool> {
        if self.at(T_LT) {
            return Ok(true);
        }

        if !self.at(T_PAREN_OPEN) {
            return Ok(false);
        }

        let state = self.tokenizer.save();

        self.next()?;

        // `()` can only be a parameter list.
        if self.at(T_PAREN_CLOSE) {
            self.tokenizer.restore(&state);

            return Ok(true);
        }

        self.tokenizer.restore(&state);

        // A *type* takes its arrow wherever it falls; nothing in a type
        // position is ended by an automatic semicolon.
        Ok(self.kind_after_matching_paren()? == T_ARROW)
    }

    /// Scans forward from the current `(` to its match and reports whether an
    /// arrow follows on the same line.
    pub(crate) fn parenthesized_is_followed_by_arrow(&mut self) -> PRes<bool> {
        Ok(self.kind_after_matching_paren()? == T_ARROW && !self.newline_after_matching_paren)
    }

    /// Scans forward from the current `(`, `[`, or `{` to its match and
    /// reports the kind of the token that follows it.
    pub(crate) fn kind_after_matching_paren(&mut self) -> PRes<u32> {
        let state = self.tokenizer.save();
        let mut scan = || -> PRes<u32> {
            let mut depth = 0i32;

            loop {
                let kind = self.kind();

                if kind == T_EOF {
                    break;
                }

                if kind == T_PAREN_OPEN || kind == T_BRACKET_OPEN || kind == T_BRACE_OPEN {
                    depth += 1;
                } else if kind == T_PAREN_CLOSE
                    || kind == T_BRACKET_CLOSE
                    || kind == T_BRACE_CLOSE
                {
                    depth -= 1;

                    if depth == 0 {
                        self.next()?;
                        break;
                    }
                }

                self.next()?;
            }

            Ok(self.kind())
        };

        let result = match scan() {
            Ok(kind) => {
                self.newline_after_matching_paren = self.newline_before();

                kind
            }
            Err(_) => {
                // This scan runs in ordinary JavaScript mode, so content that
                // only makes sense in another mode — JSX, most often — can
                // fail to tokenize. Whatever is in there, it is not an
                // arrow's parameter list.
                self.newline_after_matching_paren = false;

                T_EOF
            }
        };

        self.tokenizer.restore(&state);

        Ok(result)
    }

    /// Parses a function type or a constructor type.
    fn parse_function_or_constructor_type(&mut self) -> PRes {
        let start = self.start();
        let is_abstract = self.at(T_ABSTRACT) && self.peek_is(T_NEW)?;

        if is_abstract {
            self.next()?;
        }

        let is_constructor = self.eat(T_NEW)?;
        let node = self.writer.alloc(
            if is_constructor {
                N_TS_CONSTRUCTOR_TYPE
            } else {
                N_TS_FUNCTION_TYPE
            },
            start,
        );

        if is_abstract {
            self.writer.add_flags(node, NF_ABSTRACT);
        }

        let type_parameters = self.try_parse_type_parameters()?;

        self.writer.set(node, NODE_C, type_parameters);

        let parameters = self.parse_parameter_list_inherit()?;

        self.writer.set(node, NODE_A, parameters);

        let return_type = self.writer.alloc(N_TS_TYPE_ANNOTATION, self.start());

        self.expect(T_ARROW)?;

        let inner = self.parse_type_or_predicate()?;

        self.writer.set(return_type, NODE_A, inner);

        let finished = self.writer.finish(return_type, self.last_end());

        self.writer.set(node, NODE_B, finished);

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // Template Literal Types
    //-------------------------------------------------------------------------

    /// Parses a template literal type such as `` `a${T}b` ``.
    fn parse_template_literal_type(&mut self) -> PRes {
        let start = self.start();

        if self.at(T_TEMPLATE_FULL) {
            let node = self.writer.alloc(N_TS_LITERAL_TYPE, start);
            let literal = self.writer.alloc(N_TEMPLATE_LITERAL, start);
            let quasi = self.parse_template_element(true)?;
            let list = self.writer.singleton_list(quasi);

            self.writer.set(literal, NODE_A, list);
            self.writer.set(literal, NODE_B, EMPTY_LIST);
            self.writer.finish(literal, self.last_end());
            self.writer.set(node, NODE_A, literal);

            return Ok(self.writer.finish(node, self.last_end()));
        }

        let node = self.writer.alloc(N_TS_TEMPLATE_LITERAL_TYPE, start);
        let mark = self.writer.start_list();
        let head = self.parse_template_element(false)?;

        self.writer.push_list(head);

        loop {
            let type_node = self.parse_type()?;

            self.writer.push_list(type_node);

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

        let (quasis, types) = self.writer.end_interleaved_lists(mark);

        self.writer.set(node, NODE_A, quasis);
        self.writer.set(node, NODE_B, types);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses one `TemplateElement` from the current template token.
    pub(crate) fn parse_template_element(&mut self, tail: bool) -> PRes {
        let start = self.start();
        let end = self.end();
        let node = self.writer.alloc(N_TEMPLATE_ELEMENT, start);

        // The raw text excludes the delimiters: one character for a leading
        // backtick or `}`, and one or two for the trailing backtick or `${`.
        self.writer.set(node, NODE_A, start + 1);
        self.writer
            .set(node, NODE_B, if tail { end - 1 } else { end - 2 });

        if tail {
            self.writer.add_flags(node, NF_TAIL);
        }

        if (self.tokenizer.flags & TF_INVALID_ESCAPE) != 0 {
            self.writer.add_flags(node, NF_INVALID_ESCAPE);
        }

        self.next()?;

        Ok(self.writer.finish(node, end))
    }

    //-------------------------------------------------------------------------
    // Type Parameters and Arguments
    //-------------------------------------------------------------------------

    /// Parses a `<...>` type parameter declaration; `0` when absent.
    pub fn try_parse_type_parameters(&mut self) -> PRes {
        if !self.at(T_LT) {
            return Ok(0);
        }

        let node = self
            .writer
            .alloc(N_TS_TYPE_PARAMETER_DECLARATION, self.start());
        let mark = self.writer.start_list();

        self.next()?;

        while !self.at_type_list_end() {
            let parameter = self.parse_type_parameter()?;

            self.writer.push_list(parameter);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect_type_list_end()?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a single type parameter, including its modifiers.
    fn parse_type_parameter(&mut self) -> PRes {
        let node = self.writer.alloc(N_TS_TYPE_PARAMETER, self.start());

        loop {
            if self.at(T_IN) && self.next_starts_member_name()? {
                self.writer.add_flags(node, NF_IN);
                self.next()?;
                continue;
            }

            if self.at(T_OUT) && self.next_starts_member_name()? {
                self.writer.add_flags(node, NF_STATIC);
                self.next()?;
                continue;
            }

            if self.at(T_CONST) && self.next_starts_member_name()? {
                self.writer.add_flags(node, NF_CONST);
                self.next()?;
                continue;
            }

            break;
        }

        let name = self.parse_identifier()?;

        self.writer.set(node, NODE_A, name);

        if self.eat(T_EXTENDS)? {
            let constraint = self.parse_type()?;

            self.writer.set(node, NODE_B, constraint);
        }

        if self.eat(T_ASSIGN)? {
            let default = self.parse_type()?;

            self.writer.set(node, NODE_C, default);
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `<...>` type argument list.
    pub fn parse_type_arguments(&mut self) -> PRes {
        let node = self
            .writer
            .alloc(N_TS_TYPE_PARAMETER_INSTANTIATION, self.start());
        let mark = self.writer.start_list();

        self.expect(T_LT)?;

        while !self.at_type_list_end() {
            let argument = self.parse_type()?;

            self.writer.push_list(argument);

            if !self.eat(T_COMMA)? {
                break;
            }
        }

        self.expect_type_list_end()?;

        let list = self.writer.end_list(mark);

        self.writer.set(node, NODE_A, list);

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Whether the current token closes a type list, splitting a
    /// multi-character shift operator when necessary.
    fn at_type_list_end(&mut self) -> bool {
        if self.at(T_GT) {
            return true;
        }

        if self.at(T_EOF) {
            return true;
        }

        self.tokenizer.re_scan_greater_than() && self.at(T_GT)
    }

    /// Consumes the `>` that closes a type list.
    fn expect_type_list_end(&mut self) -> PRes<()> {
        if !self.at(T_GT) {
            self.tokenizer.re_scan_greater_than();
        }

        self.expect(T_GT)
    }
}
