//! Node-API bindings for jskit-core.
//!
//! Each function takes the source text as a JavaScript string, works on its
//! UTF-16 code units directly — the same units every offset in the binary
//! formats counts — and returns the finished buffer as an `ArrayBuffer`
//! without copying it.
//!
//! A `ParseError` crosses the boundary as an `Error` whose message packs the
//! structured fields with `\u{1}` separators; the JavaScript wrapper in
//! `@eslint/jskit` rebuilds a real `ParseError` from them.

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi::{Env, JsArrayBuffer, JsObject, JsString};
use napi_derive::napi;

use jskit_core::parse::{ParseError, ParseOptions, SourceType, ValidateSourceType};
use jskit_core::scope::options::{ResolvedOptions, ScopeSourceType};

/// The options `parse()` accepts, mirroring the TypeScript `ParseOptions`.
#[napi(object)]
#[derive(Default)]
pub struct NativeParseOptions {
    pub source_type: Option<String>,
    pub jsx: Option<bool>,
    pub source: Option<bool>,
    pub tokens: Option<bool>,
    pub parents: Option<bool>,
}

fn encode_parse_error(error: &ParseError) -> Error {
    Error::new(
        Status::GenericFailure,
        format!(
            "ParseError\u{1}{}\u{1}{}\u{1}{}\u{1}{}",
            error.index, error.line_number, error.column, error.message
        ),
    )
}

fn resolve_options(options: Option<NativeParseOptions>) -> Result<ParseOptions> {
    let options = options.unwrap_or_default();
    let source_type = match options.source_type.as_deref() {
        None | Some("module") => SourceType::Module,
        Some("script") => SourceType::Script,
        Some("commonjs") => SourceType::CommonJs,
        Some(other) => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Unknown sourceType: {other}"),
            ))
        }
    };

    Ok(ParseOptions {
        source_type,
        jsx: options.jsx,
        source: options.source.unwrap_or(false),
        tokens: options.tokens.unwrap_or(false),
        parents: options.parents.unwrap_or(false),
    })
}

/// Parses source text into one binary parse buffer.
#[napi]
pub fn parse(
    env: Env,
    code: JsString,
    options: Option<NativeParseOptions>,
) -> Result<JsArrayBuffer> {
    let utf16 = code.into_utf16()?;
    let slice = utf16.as_slice();

    // The slice carries napi's trailing NUL terminator.
    let units = &slice[..slice.len().saturating_sub(1)];
    let options = resolve_options(options)?;
    let buffer =
        jskit_core::parse::parse(units, &options).map_err(|error| encode_parse_error(&error))?;

    Ok(env.create_arraybuffer_with_data(buffer)?.into_raw())
}

/// The options `validate()` accepts. The buffer's recorded source type is
/// resolved against the caller's request on the JavaScript side, which also
/// locates the reported offsets, so what crosses is already settled.
#[napi(object)]
#[derive(Default)]
pub struct NativeValidateOptions {
    pub source_type: Option<String>,
    pub dialect: Option<String>,
    pub jsx: Option<bool>,
    pub declaration: Option<bool>,
}

/// Checks a parse result for problems that depend on how the program is
/// meant to be interpreted.
///
/// `result` is the parse buffer `parse()` produced and `text` the exact
/// source it was parsed from; the JavaScript wrapper recovers the text from
/// the buffer's cache before calling in. Each problem comes back as
/// `{ message, start }`, with the message built from UTF-16 units so that a
/// quoted name keeps even a lone surrogate the program spelled.
#[napi]
pub fn validate(
    env: Env,
    result: JsArrayBuffer,
    text: JsString,
    options: Option<NativeValidateOptions>,
) -> Result<Vec<JsObject>> {
    let buffer = result.into_value()?;
    let words = jskit_core::scope::words_of(&buffer);
    let utf16 = text.into_utf16()?;
    let slice = utf16.as_slice();
    let units = &slice[..slice.len().saturating_sub(1)];
    let options = options.unwrap_or_default();
    let source_type = match options.source_type.as_deref() {
        None | Some("module") => ValidateSourceType::Module,
        Some("script") => ValidateSourceType::Script,
        Some("commonjs") => ValidateSourceType::CommonJs,
        Some(other) => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Unknown sourceType: {other}"),
            ))
        }
    };

    let problems = jskit_core::parse::validate_ast(
        &words,
        units,
        source_type,
        options.dialect.as_deref() == Some("js"),
        options.jsx.unwrap_or(false),
        options.declaration.unwrap_or(false),
    );

    let mut located = Vec::with_capacity(problems.len());

    for problem in problems {
        let mut object = env.create_object()?;

        object.set_named_property("message", env.create_string_utf16(&problem.message)?)?;
        object.set_named_property("start", problem.start)?;
        located.push(object);
    }

    Ok(located)
}

/// The options `analyze()` accepts, mirroring the TypeScript
/// `AnalyzeOptions` — `text` stays on the JavaScript side, which resolves the
/// source before calling in.
#[napi(object)]
#[derive(Default)]
pub struct NativeAnalyzeOptions {
    pub source_type: Option<String>,
    pub dialect: Option<String>,
    pub jsx: Option<bool>,
    pub implied_strict: Option<bool>,
    pub global_return: Option<bool>,
    pub ignore_eval: Option<bool>,
    pub globals: Option<Vec<String>>,
    pub jsx_pragma: Option<String>,
    pub jsx_fragment_name: Option<String>,
}

fn utf16_units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn resolve_analyze_options(options: Option<NativeAnalyzeOptions>) -> Result<ResolvedOptions> {
    let options = options.unwrap_or_default();
    let source_type = match options.source_type.as_deref() {
        None | Some("module") => ScopeSourceType::Module,
        Some("script") => ScopeSourceType::Script,
        Some("commonjs") => ScopeSourceType::CommonJs,
        Some(other) => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Unknown sourceType: {other}"),
            ))
        }
    };

    Ok(ResolvedOptions {
        source_type,
        dialect_ts: options.dialect.as_deref() != Some("js"),
        jsx: options.jsx.unwrap_or(true),
        implied_strict: options.implied_strict.unwrap_or(false),
        global_return: options.global_return.unwrap_or(false),
        ignore_eval: options.ignore_eval.unwrap_or(false),
        globals: options
            .globals
            .map(|names| names.iter().map(|name| utf16_units(name)).collect()),
        jsx_pragma: options.jsx_pragma.as_deref().map(utf16_units),
        jsx_fragment_name: options.jsx_fragment_name.as_deref().map(utf16_units),
    })
}

/// Finds the scopes of a parsed program and resolves every identifier in it.
///
/// `result` is the parse buffer `parse()` produced and `text` the exact
/// source it was parsed from; the JavaScript wrapper recovers the text from
/// the buffer's cache before calling in.
#[napi]
pub fn analyze(
    env: Env,
    result: JsArrayBuffer,
    text: JsString,
    options: Option<NativeAnalyzeOptions>,
) -> Result<JsArrayBuffer> {
    let buffer = result.into_value()?;
    let words = jskit_core::scope::words_of(&buffer);
    let utf16 = text.into_utf16()?;
    let slice = utf16.as_slice();
    let units = &slice[..slice.len().saturating_sub(1)];
    let options = resolve_analyze_options(options)?;
    let scope_buffer = jskit_core::scope::analyze(&words, units, options);

    Ok(env.create_arraybuffer_with_data(scope_buffer)?.into_raw())
}

/// Builds the control flow graph of a parsed program.
///
/// `parsed` and `scope` are the parse and scope buffers over the same
/// program, and `text` is the exact source; the JavaScript wrapper validates
/// both buffers and recovers the text before calling in.
#[napi]
pub fn create_graph(
    env: Env,
    parsed: JsArrayBuffer,
    scope: JsArrayBuffer,
    text: JsString,
) -> Result<JsArrayBuffer> {
    let parse_buffer = parsed.into_value()?;
    let parse_words = jskit_core::scope::words_of(&parse_buffer);
    let scope_buffer = scope.into_value()?;
    let scope_words = jskit_core::scope::words_of(&scope_buffer);
    let utf16 = text.into_utf16()?;
    let slice = utf16.as_slice();
    let units = &slice[..slice.len().saturating_sub(1)];
    let flow_buffer = jskit_core::flow::create_graph(&parse_words, units, &scope_words);

    Ok(env.create_arraybuffer_with_data(flow_buffer)?.into_raw())
}
