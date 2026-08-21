/**
 * @fileoverview The JSX grammar.
 *
 * JSX is not a rearrangement of JavaScript tokens; it has its own lexical
 * grammar. Child text, element names, and quoted attribute values all have to
 * come out of the scanner in a JSX-specific mode, so every advance in this file
 * says which mode the next token should be read in:
 *
 * - `nextJsxText()` inside an element's children
 * - `nextJsxName()` inside a tag
 * - `nextJsxAttributeValue()` after an attribute's `=`
 *
 * Each of those falls back to ordinary scanning when the text at that position
 * is not the JSX-specific form, so the code below reads as if the scanner
 * simply knew what to do.
 */

import { AFTER_JSX_ATTRIBUTE, AFTER_JSX_CHILDREN } from "./parser-base.js";
import { ExpressionParser } from "./parser-expressions.js";
import {
	LIT_JSX_STRING,
	NF_SELF_CLOSING,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	N_JSXAttribute,
	N_JSXClosingElement,
	N_JSXClosingFragment,
	N_JSXElement,
	N_JSXEmptyExpression,
	N_JSXExpressionContainer,
	N_JSXFragment,
	N_JSXIdentifier,
	N_JSXMemberExpression,
	N_JSXNamespacedName,
	N_JSXOpeningElement,
	N_JSXOpeningFragment,
	N_JSXSpreadAttribute,
	N_JSXSpreadChild,
	N_JSXText,
	N_Literal,
} from "./node-kinds.js";
import {
	T_ASSIGN,
	T_BRACE_CLOSE,
	T_BRACE_OPEN,
	T_COLON,
	T_DOT,
	T_ELLIPSIS,
	T_GT,
	T_JSX_IDENT,
	T_JSX_STRING,
	T_JSX_TEXT,
	T_LT,
	T_SLASH,
} from "./token-kinds.js";

/**
 * Adds the JSX grammar to the parser.
 */
export abstract class JsxParser extends ExpressionParser {
	/**
	 * Parses a JSX element or fragment starting at the current `<`.
	 * @param after What surrounds the element, which decides how the token
	 *      after it is scanned.
	 * @returns The index of the `JSXElement` or `JSXFragment` node.
	 * @throws {ParseError} When the element is malformed.
	 */
	protected parseJsxRoot(after: number): number {
		const start = this.start;

		this.tokenizer.nextJsxName();

		return this.parseJsxAfterOpenAngle(start, after);
	}

	/**
	 * Parses the rest of an element or fragment once its `<` is consumed.
	 * @param start The offset of the `<`.
	 * @param after What surrounds the element.
	 * @returns The index of the `JSXElement` or `JSXFragment` node.
	 * @throws {ParseError} When the element is malformed.
	 */
	private parseJsxAfterOpenAngle(start: number, after: number): number {
		if (this.at(T_GT)) {
			return this.parseJsxFragment(start, after);
		}

		return this.parseJsxElement(start, after);
	}

	/**
	 * Parses a named JSX element.
	 * @param start The offset of the `<`.
	 * @param after What surrounds the element.
	 * @returns The index of the `JSXElement` node.
	 * @throws {ParseError} When the element is malformed.
	 */
	private parseJsxElement(start: number, after: number): number {
		const element = this.writer.alloc(N_JSXElement, start);
		const opening = this.writer.alloc(N_JSXOpeningElement, start);

		this.writer.set(opening, NODE_A, this.parseJsxElementName());

		if (this.at(T_LT)) {
			/*
			 * The type grammar scans one token past the closing `>`, which in
			 * `<Foo<T>/>` is the `/` that closes the tag. Marking the scanner
			 * as being inside a tag keeps it from reading that as a regular
			 * expression.
			 */
			const tokenizer = this.tokenizer;

			tokenizer.inJsxTag = true;

			try {
				this.writer.set(opening, NODE_D, this.parseTypeArguments());
			} finally {
				tokenizer.inJsxTag = false;
			}

			// The type grammar leaves the scanner out of JSX mode.
			tokenizer.reScanAsJsxName();
		}

		this.writer.set(opening, NODE_B, this.parseJsxAttributes());

		const selfClosing = this.at(T_SLASH);

		if (selfClosing) {
			this.writer.addFlags(opening, NF_SELF_CLOSING);

			// The `>` after the `/` is still inside the tag.
			this.tokenizer.nextJsxName();
		}

		if (!this.at(T_GT)) {
			throw this.error("Expected '>' to close the JSX element");
		}

		const openingEnd = this.end;

		this.writer.finish(opening, openingEnd);
		this.writer.set(element, NODE_A, opening);

		if (selfClosing) {
			this.advanceAfterJsx(after);

			return this.writer.finish(element, openingEnd);
		}

		// The `>` is followed by child text, so it is consumed in text mode.
		this.tokenizer.nextJsxText();

		const children = this.writer.startList();
		const closingStart = this.parseJsxChildren();

		this.writer.set(element, NODE_C, this.writer.endList(children));
		this.writer.set(
			element,
			NODE_B,
			this.parseJsxClosingElement(closingStart, after, false),
		);

		return this.writer.finish(element, this.lastEnd);
	}

	/**
	 * Parses a fragment, which is an element with no name.
	 * @param start The offset of the `<`.
	 * @param after What surrounds the fragment.
	 * @returns The index of the `JSXFragment` node.
	 * @throws {ParseError} When the fragment is malformed.
	 */
	private parseJsxFragment(start: number, after: number): number {
		const fragment = this.writer.alloc(N_JSXFragment, start);
		const opening = this.writer.alloc(N_JSXOpeningFragment, start);

		this.writer.finish(opening, this.end);
		this.writer.set(fragment, NODE_A, opening);
		this.tokenizer.nextJsxText();

		const children = this.writer.startList();
		const closingStart = this.parseJsxChildren();

		this.writer.set(fragment, NODE_C, this.writer.endList(children));
		this.writer.set(
			fragment,
			NODE_B,
			this.parseJsxClosingElement(closingStart, after, true),
		);

		return this.writer.finish(fragment, this.lastEnd);
	}

	/**
	 * Gathers the children of an element into the list currently being built,
	 * stopping when the closing tag begins.
	 * @returns The offset of the `<` that opens the closing tag.
	 * @throws {ParseError} When the input ends before the closing tag.
	 */
	private parseJsxChildren(): number {
		for (;;) {
			if (this.at(T_JSX_TEXT)) {
				const text = this.writer.alloc(N_JSXText, this.start);
				const end = this.end;

				this.writer.pushList(this.writer.finish(text, end));
				this.tokenizer.nextJsxText();
				continue;
			}

			if (this.at(T_BRACE_OPEN)) {
				this.writer.pushList(this.parseJsxExpressionContainer(true));
				continue;
			}

			if (this.at(T_LT)) {
				const childStart = this.start;

				this.tokenizer.nextJsxName();

				/*
				 * A `/` here means this `<` opened the closing tag rather than
				 * a nested element.
				 */
				if (this.at(T_SLASH)) {
					return childStart;
				}

				this.writer.pushList(
					this.parseJsxAfterOpenAngle(childStart, AFTER_JSX_CHILDREN),
				);
				continue;
			}

			throw this.error("Unterminated JSX element");
		}
	}

	/**
	 * Parses the closing tag of an element or fragment.
	 * @param start The offset of the `<` that opened the closing tag.
	 * @param after What surrounds the element being closed.
	 * @param isFragment Whether a fragment is being closed.
	 * @returns The index of the closing node.
	 * @throws {ParseError} When the closing tag is malformed.
	 */
	private parseJsxClosingElement(
		start: number,
		after: number,
		isFragment: boolean,
	): number {
		const node = this.writer.alloc(
			isFragment ? N_JSXClosingFragment : N_JSXClosingElement,
			start,
		);

		// Move past the `/` that follows the `<`.
		this.tokenizer.nextJsxName();

		if (!isFragment) {
			this.writer.set(node, NODE_A, this.parseJsxElementName());
		}

		if (!this.at(T_GT)) {
			throw this.error("Expected '>' to close the JSX closing tag");
		}

		const end = this.end;

		this.advanceAfterJsx(after);

		return this.writer.finish(node, end);
	}

	/**
	 * Consumes the `>` that ends an element, scanning what follows the way the
	 * surrounding syntax requires.
	 * @param after What surrounds the element.
	 * @returns Nothing.
	 */
	private advanceAfterJsx(after: number): void {
		if (after === AFTER_JSX_CHILDREN) {
			this.tokenizer.nextJsxText();
		} else if (after === AFTER_JSX_ATTRIBUTE) {
			/*
			 * The element was an attribute's value, so what follows is the
			 * rest of the enclosing tag: another attribute, or the `/` or `>`
			 * that closes it.
			 */
			this.tokenizer.nextJsxName();
		} else {
			this.next();
		}
	}

	//-------------------------------------------------------------------------
	// Names
	//-------------------------------------------------------------------------

	/**
	 * Parses a single JSX identifier.
	 * @returns The index of the `JSXIdentifier` node.
	 * @throws {ParseError} When the current token is not a JSX identifier.
	 */
	private parseJsxIdentifier(): number {
		if (!this.at(T_JSX_IDENT)) {
			throw this.error("Expected a JSX name");
		}

		const node = this.writer.alloc(N_JSXIdentifier, this.start);
		const end = this.end;

		this.tokenizer.nextJsxName();

		return this.writer.finish(node, end);
	}

	/**
	 * Parses an element name, which may be namespaced (`a:b`) or a dotted
	 * member chain (`A.B.C`).
	 * @returns The index of the name node.
	 * @throws {ParseError} When the name is malformed.
	 */
	private parseJsxElementName(): number {
		const start = this.start;
		let name = this.parseJsxIdentifier();

		if (this.at(T_COLON)) {
			return this.finishJsxNamespacedName(start, name);
		}

		while (this.at(T_DOT)) {
			this.tokenizer.nextJsxName();

			const member = this.writer.alloc(N_JSXMemberExpression, start);

			this.writer.set(member, NODE_A, name);
			this.writer.set(member, NODE_B, this.parseJsxIdentifier());
			name = this.writer.finish(member, this.lastEnd);
		}

		return name;
	}

	/**
	 * Parses an attribute name, which may be namespaced but never dotted.
	 * @returns The index of the name node.
	 * @throws {ParseError} When the name is malformed.
	 */
	private parseJsxAttributeName(): number {
		const start = this.start;
		const name = this.parseJsxIdentifier();

		if (this.at(T_COLON)) {
			return this.finishJsxNamespacedName(start, name);
		}

		return name;
	}

	/**
	 * Builds a `JSXNamespacedName` from an already-parsed namespace.
	 * @param start The offset at which the name began.
	 * @param namespace The namespace half of the name.
	 * @returns The index of the `JSXNamespacedName` node.
	 * @throws {ParseError} When the second half is missing.
	 */
	private finishJsxNamespacedName(start: number, namespace: number): number {
		const node = this.writer.alloc(N_JSXNamespacedName, start);

		this.tokenizer.nextJsxName();
		this.writer.set(node, NODE_A, namespace);
		this.writer.set(node, NODE_B, this.parseJsxIdentifier());

		return this.writer.finish(node, this.lastEnd);
	}

	//-------------------------------------------------------------------------
	// Attributes
	//-------------------------------------------------------------------------

	/**
	 * Parses every attribute of an opening tag.
	 * @returns A list handle holding the attribute nodes.
	 * @throws {ParseError} When an attribute is malformed.
	 */
	private parseJsxAttributes(): number {
		const mark = this.writer.startList();

		for (;;) {
			if (this.at(T_JSX_IDENT)) {
				this.writer.pushList(this.parseJsxAttribute());
				continue;
			}

			if (this.at(T_BRACE_OPEN)) {
				this.writer.pushList(this.parseJsxSpreadAttribute());
				continue;
			}

			break;
		}

		return this.writer.endList(mark);
	}

	/**
	 * Parses one `name` or `name=value` attribute.
	 * @returns The index of the `JSXAttribute` node.
	 * @throws {ParseError} When the value is malformed.
	 */
	private parseJsxAttribute(): number {
		const node = this.writer.alloc(N_JSXAttribute, this.start);

		this.writer.set(node, NODE_A, this.parseJsxAttributeName());

		if (this.at(T_ASSIGN)) {
			this.tokenizer.nextJsxAttributeValue();

			if (this.at(T_JSX_STRING)) {
				const literal = this.writer.alloc(N_Literal, this.start);
				const end = this.end;

				this.writer.set(literal, NODE_A, LIT_JSX_STRING);
				this.tokenizer.nextJsxName();
				this.writer.set(node, NODE_B, this.writer.finish(literal, end));
			} else if (this.at(T_BRACE_OPEN)) {
				this.writer.set(
					node,
					NODE_B,
					this.parseJsxExpressionContainer(false),
				);
			} else if (this.at(T_LT)) {
				/*
				 * An element may stand as an attribute value without braces,
				 * as in `<a b=<c/>/>`. Both reference parsers accept it.
				 */
				this.writer.set(
					node,
					NODE_B,
					this.parseJsxRoot(AFTER_JSX_ATTRIBUTE),
				);
			} else {
				throw this.error("Expected a JSX attribute value");
			}
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `{...expression}` attribute.
	 * @returns The index of the `JSXSpreadAttribute` node.
	 * @throws {ParseError} When the attribute is malformed.
	 */
	private parseJsxSpreadAttribute(): number {
		const node = this.writer.alloc(N_JSXSpreadAttribute, this.start);

		this.enterBrace(false);

		if (!this.at(T_ELLIPSIS)) {
			throw this.error("Expected '...' in a JSX spread attribute");
		}

		this.next();
		this.writer.set(node, NODE_A, this.parseAssignmentExpression());

		const end = this.end;

		if (!this.at(T_BRACE_CLOSE)) {
			throw this.error("Expected '}' to close the JSX attribute");
		}

		this.tokenizer.nextJsxName();

		return this.writer.finish(node, end);
	}

	//-------------------------------------------------------------------------
	// Expression Containers
	//-------------------------------------------------------------------------

	/**
	 * Parses a `{...}` container, which holds an expression, a spread, or
	 * nothing at all.
	 * @param isChild Whether the container sits among an element's children,
	 *      which decides how the token after it is scanned.
	 * @returns The index of the container node.
	 * @throws {ParseError} When the container is malformed.
	 */
	private parseJsxExpressionContainer(isChild: boolean): number {
		const start = this.start;
		const node = this.writer.alloc(N_JSXExpressionContainer, start);

		this.enterBrace(false);

		if (isChild && this.at(T_ELLIPSIS)) {
			this.writer.retype(node, N_JSXSpreadChild);
			this.next();
			this.writer.set(node, NODE_A, this.parseExpression());
		} else if (this.at(T_BRACE_CLOSE)) {
			/*
			 * An empty container still has a node, whose range covers the
			 * space between the braces along with any comment in it.
			 */
			const empty = this.writer.alloc(N_JSXEmptyExpression, start + 1);

			this.writer.set(
				node,
				NODE_A,
				this.writer.finish(empty, this.start),
			);
		} else {
			this.writer.set(node, NODE_A, this.parseExpression());
		}

		const end = this.end;

		if (!this.at(T_BRACE_CLOSE)) {
			throw this.error("Expected '}' to close the JSX expression");
		}

		if (isChild) {
			this.tokenizer.nextJsxText();
		} else {
			this.tokenizer.nextJsxName();
		}

		return this.writer.finish(node, end);
	}
}
