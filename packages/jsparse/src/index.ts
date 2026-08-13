/**
 * @fileoverview The package's public surface. Everything here is defined
 * elsewhere; this file only decides what is exported.
 */

export { ParseError } from "./errors.js";
export { LineIndex } from "./locations.js";
export type { Position, SourceLocation } from "./locations.js";
export { AstReader, TokenReader } from "./reader.js";

/*
 * The shape of everything `toAST()` produces, node by node. Type-only, so a
 * bundler drops the module entirely.
 */
export type * from "./ast-types.js";
export * from "./node-kinds.js";
export * from "./token-kinds.js";
export * from "./slots.js";

/*
 * A tool reading the binary buffers directly still has to turn raw identifier
 * and literal text into values, so the two decoders that do it are part of the
 * public surface rather than an implementation detail of `toAST()`.
 */
export { decodeEscapes, decodeNumber } from "./values.js";

/*
 * The three phases. `buildAst()` is deliberately absent: it is what the ESLint
 * parser object needs and nothing a caller of `toAST()` does.
 */
export { decodeTokens, parse, toAST, tokenStartsLine, validate } from "./api.js";
export type {
	ParseOptions,
	ParseResult,
	ToAstResult,
	Token,
	ValidateOptions,
	ValidationError,
} from "./api.js";

export { eslintParser } from "./eslint-parser.js";
export type { EslintParserOptions } from "./eslint-parser.js";

/** The property bag the decoder works in, before it is asserted to `Program`. */
export type { EsNode } from "./to-ast.js";
