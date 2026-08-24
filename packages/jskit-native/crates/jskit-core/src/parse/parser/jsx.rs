//! The JSX grammar.
//!
//! Port of `packages/jskit/src/parse/parser-jsx.ts`. Every advance in this
//! file says which mode the next token should be read in; each scanner mode
//! falls back to ordinary scanning when the text is not the JSX form.

use super::{PRes, Parser, AFTER_JSX_ATTRIBUTE, AFTER_JSX_CHILDREN};
use crate::parse::node_kinds::*;
use crate::parse::token_kinds::*;

impl<'a> Parser<'a> {
    /// Parses a JSX element or fragment starting at the current `<`.
    pub(crate) fn parse_jsx_root(&mut self, after: u8) -> PRes {
        let start = self.start();

        self.tokenizer.next_jsx_name()?;

        self.parse_jsx_after_open_angle(start, after)
    }

    /// Parses the rest of an element or fragment once its `<` is consumed.
    fn parse_jsx_after_open_angle(&mut self, start: u32, after: u8) -> PRes {
        if self.at(T_GT) {
            return self.parse_jsx_fragment(start, after);
        }

        self.parse_jsx_element(start, after)
    }

    /// Parses a named JSX element.
    fn parse_jsx_element(&mut self, start: u32, after: u8) -> PRes {
        let element = self.writer.alloc(N_JSX_ELEMENT, start);
        let opening = self.writer.alloc(N_JSX_OPENING_ELEMENT, start);
        let name = self.parse_jsx_element_name()?;

        self.writer.set(opening, NODE_A, name);

        if self.at(T_LT) {
            // The type grammar scans one token past the closing `>`, which in
            // `<Foo<T>/>` is the `/` that closes the tag. Marking the scanner
            // as being inside a tag keeps it from reading that as a regular
            // expression.
            self.tokenizer.in_jsx_tag = true;

            let type_arguments = self.parse_type_arguments();

            self.tokenizer.in_jsx_tag = false;

            self.writer.set(opening, NODE_D, type_arguments?);

            // The type grammar leaves the scanner out of JSX mode.
            self.tokenizer.re_scan_as_jsx_name()?;
        }

        let attributes = self.parse_jsx_attributes()?;

        self.writer.set(opening, NODE_B, attributes);

        let self_closing = self.at(T_SLASH);

        if self_closing {
            self.writer.add_flags(opening, NF_SELF_CLOSING);

            // The `>` after the `/` is still inside the tag.
            self.tokenizer.next_jsx_name()?;
        }

        if !self.at(T_GT) {
            return Err(self.error("Expected '>' to close the JSX element"));
        }

        let opening_end = self.end();

        self.writer.finish(opening, opening_end);
        self.writer.set(element, NODE_A, opening);

        if self_closing {
            self.advance_after_jsx(after)?;

            return Ok(self.writer.finish(element, opening_end));
        }

        // The `>` is followed by child text, so it is consumed in text mode.
        self.tokenizer.next_jsx_text()?;

        let children = self.writer.start_list();
        let closing_start = self.parse_jsx_children()?;
        let list = self.writer.end_list(children);

        self.writer.set(element, NODE_C, list);

        let closing = self.parse_jsx_closing_element(closing_start, after, false)?;

        self.writer.set(element, NODE_B, closing);

        Ok(self.writer.finish(element, self.last_end()))
    }

    /// Parses a fragment, which is an element with no name.
    fn parse_jsx_fragment(&mut self, start: u32, after: u8) -> PRes {
        let fragment = self.writer.alloc(N_JSX_FRAGMENT, start);
        let opening = self.writer.alloc(N_JSX_OPENING_FRAGMENT, start);

        self.writer.finish(opening, self.end());
        self.writer.set(fragment, NODE_A, opening);
        self.tokenizer.next_jsx_text()?;

        let children = self.writer.start_list();
        let closing_start = self.parse_jsx_children()?;
        let list = self.writer.end_list(children);

        self.writer.set(fragment, NODE_C, list);

        let closing = self.parse_jsx_closing_element(closing_start, after, true)?;

        self.writer.set(fragment, NODE_B, closing);

        Ok(self.writer.finish(fragment, self.last_end()))
    }

    /// Gathers the children of an element into the list currently being
    /// built, stopping when the closing tag begins. Returns the offset of the
    /// `<` that opens the closing tag.
    fn parse_jsx_children(&mut self) -> PRes {
        loop {
            if self.at(T_JSX_TEXT) {
                let text = self.writer.alloc(N_JSX_TEXT, self.start());
                let end = self.end();
                let finished = self.writer.finish(text, end);

                self.writer.push_list(finished);
                self.tokenizer.next_jsx_text()?;
                continue;
            }

            if self.at(T_BRACE_OPEN) {
                let container = self.parse_jsx_expression_container(true)?;

                self.writer.push_list(container);
                continue;
            }

            if self.at(T_LT) {
                let child_start = self.start();

                self.tokenizer.next_jsx_name()?;

                // A `/` here means this `<` opened the closing tag rather
                // than a nested element.
                if self.at(T_SLASH) {
                    return Ok(child_start);
                }

                let child = self.parse_jsx_after_open_angle(child_start, AFTER_JSX_CHILDREN)?;

                self.writer.push_list(child);
                continue;
            }

            return Err(self.error("Unterminated JSX element"));
        }
    }

    /// Parses the closing tag of an element or fragment.
    fn parse_jsx_closing_element(&mut self, start: u32, after: u8, is_fragment: bool) -> PRes {
        let node = self.writer.alloc(
            if is_fragment {
                N_JSX_CLOSING_FRAGMENT
            } else {
                N_JSX_CLOSING_ELEMENT
            },
            start,
        );

        // Move past the `/` that follows the `<`.
        self.tokenizer.next_jsx_name()?;

        if !is_fragment {
            let name = self.parse_jsx_element_name()?;

            self.writer.set(node, NODE_A, name);
        }

        if !self.at(T_GT) {
            return Err(self.error("Expected '>' to close the JSX closing tag"));
        }

        let end = self.end();

        self.advance_after_jsx(after)?;

        Ok(self.writer.finish(node, end))
    }

    /// Consumes the `>` that ends an element, scanning what follows the way
    /// the surrounding syntax requires.
    fn advance_after_jsx(&mut self, after: u8) -> PRes<()> {
        if after == AFTER_JSX_CHILDREN {
            self.tokenizer.next_jsx_text()
        } else if after == AFTER_JSX_ATTRIBUTE {
            // The element was an attribute's value, so what follows is the
            // rest of the enclosing tag.
            self.tokenizer.next_jsx_name()
        } else {
            self.next()
        }
    }

    //-------------------------------------------------------------------------
    // Names
    //-------------------------------------------------------------------------

    /// Parses a single JSX identifier.
    fn parse_jsx_identifier(&mut self) -> PRes {
        if !self.at(T_JSX_IDENT) {
            return Err(self.error("Expected a JSX name"));
        }

        let node = self.writer.alloc(N_JSX_IDENTIFIER, self.start());
        let end = self.end();

        self.tokenizer.next_jsx_name()?;

        Ok(self.writer.finish(node, end))
    }

    /// Parses an element name, which may be namespaced (`a:b`) or a dotted
    /// member chain (`A.B.C`).
    fn parse_jsx_element_name(&mut self) -> PRes {
        let start = self.start();
        let mut name = self.parse_jsx_identifier()?;

        if self.at(T_COLON) {
            return self.finish_jsx_namespaced_name(start, name);
        }

        while self.at(T_DOT) {
            self.tokenizer.next_jsx_name()?;

            let member = self.writer.alloc(N_JSX_MEMBER_EXPRESSION, start);

            self.writer.set(member, NODE_A, name);

            let property = self.parse_jsx_identifier()?;

            self.writer.set(member, NODE_B, property);
            name = self.writer.finish(member, self.last_end());
        }

        Ok(name)
    }

    /// Parses an attribute name, which may be namespaced but never dotted.
    fn parse_jsx_attribute_name(&mut self) -> PRes {
        let start = self.start();
        let name = self.parse_jsx_identifier()?;

        if self.at(T_COLON) {
            return self.finish_jsx_namespaced_name(start, name);
        }

        Ok(name)
    }

    /// Builds a `JSXNamespacedName` from an already-parsed namespace.
    fn finish_jsx_namespaced_name(&mut self, start: u32, namespace: u32) -> PRes {
        let node = self.writer.alloc(N_JSX_NAMESPACED_NAME, start);

        self.tokenizer.next_jsx_name()?;
        self.writer.set(node, NODE_A, namespace);

        let name = self.parse_jsx_identifier()?;

        self.writer.set(node, NODE_B, name);

        Ok(self.writer.finish(node, self.last_end()))
    }

    //-------------------------------------------------------------------------
    // Attributes
    //-------------------------------------------------------------------------

    /// Parses every attribute of an opening tag.
    fn parse_jsx_attributes(&mut self) -> PRes {
        let mark = self.writer.start_list();

        loop {
            if self.at(T_JSX_IDENT) {
                let attribute = self.parse_jsx_attribute()?;

                self.writer.push_list(attribute);
                continue;
            }

            if self.at(T_BRACE_OPEN) {
                let attribute = self.parse_jsx_spread_attribute()?;

                self.writer.push_list(attribute);
                continue;
            }

            break;
        }

        Ok(self.writer.end_list(mark))
    }

    /// Parses one `name` or `name=value` attribute.
    fn parse_jsx_attribute(&mut self) -> PRes {
        let node = self.writer.alloc(N_JSX_ATTRIBUTE, self.start());
        let name = self.parse_jsx_attribute_name()?;

        self.writer.set(node, NODE_A, name);

        if self.at(T_ASSIGN) {
            self.tokenizer.next_jsx_attribute_value()?;

            if self.at(T_JSX_STRING) {
                let literal = self.writer.alloc(N_LITERAL, self.start());
                let end = self.end();

                self.writer.set(literal, NODE_A, LIT_JSX_STRING);
                self.tokenizer.next_jsx_name()?;

                let finished = self.writer.finish(literal, end);

                self.writer.set(node, NODE_B, finished);
            } else if self.at(T_BRACE_OPEN) {
                let container = self.parse_jsx_expression_container(false)?;

                self.writer.set(node, NODE_B, container);
            } else if self.at(T_LT) {
                // An element may stand as an attribute value without braces,
                // as in `<a b=<c/>/>`. Both reference parsers accept it.
                let value = self.parse_jsx_root(AFTER_JSX_ATTRIBUTE)?;

                self.writer.set(node, NODE_B, value);
            } else {
                return Err(self.error("Expected a JSX attribute value"));
            }
        }

        Ok(self.writer.finish(node, self.last_end()))
    }

    /// Parses a `{...expression}` attribute.
    fn parse_jsx_spread_attribute(&mut self) -> PRes {
        let node = self.writer.alloc(N_JSX_SPREAD_ATTRIBUTE, self.start());

        self.enter_brace(false)?;

        if !self.at(T_ELLIPSIS) {
            return Err(self.error("Expected '...' in a JSX spread attribute"));
        }

        self.next()?;

        let argument = self.parse_assignment_expression()?;

        self.writer.set(node, NODE_A, argument);

        let end = self.end();

        if !self.at(T_BRACE_CLOSE) {
            return Err(self.error("Expected '}' to close the JSX attribute"));
        }

        self.tokenizer.next_jsx_name()?;

        Ok(self.writer.finish(node, end))
    }

    //-------------------------------------------------------------------------
    // Expression Containers
    //-------------------------------------------------------------------------

    /// Parses a `{...}` container, which holds an expression, a spread, or
    /// nothing at all.
    fn parse_jsx_expression_container(&mut self, is_child: bool) -> PRes {
        let start = self.start();
        let node = self.writer.alloc(N_JSX_EXPRESSION_CONTAINER, start);

        self.enter_brace(false)?;

        if is_child && self.at(T_ELLIPSIS) {
            self.writer.retype(node, N_JSX_SPREAD_CHILD);
            self.next()?;

            let expression = self.parse_expression()?;

            self.writer.set(node, NODE_A, expression);
        } else if self.at(T_BRACE_CLOSE) {
            // An empty container still has a node, whose range covers the
            // space between the braces along with any comment in it.
            let empty = self.writer.alloc(N_JSX_EMPTY_EXPRESSION, start + 1);
            let finished = self.writer.finish(empty, self.start());

            self.writer.set(node, NODE_A, finished);
        } else {
            let expression = self.parse_expression()?;

            self.writer.set(node, NODE_A, expression);
        }

        let end = self.end();

        if !self.at(T_BRACE_CLOSE) {
            return Err(self.error("Expected '}' to close the JSX expression"));
        }

        if is_child {
            self.tokenizer.next_jsx_text()?;
        } else {
            self.tokenizer.next_jsx_name()?;
        }

        Ok(self.writer.finish(node, end))
    }
}
