//! Parses a file and writes the binary parse buffer to stdout.
//!
//! The differential harness diffs this output byte-for-byte against the
//! buffer the TypeScript implementation produces for the same file and
//! options.
//!
//! Usage: jskit-dump parse <file> [--source-type=module|script|commonjs]
//!        [--jsx=true|false] [--tokens] [--parents] [--source]

use std::io::Write;
use std::process::ExitCode;

use jskit_core::parse::{parse, ParseOptions, SourceType};
use jskit_core::scope::{analyze, words_of, ScopeSourceType};
use jskit_core::scope::options::ResolvedOptions;

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_default();

    if command != "parse" && command != "analyze" && command != "graph" {
        eprintln!("usage: jskit-dump parse|analyze <file> [options]");

        return ExitCode::from(2);
    }

    let mut path = None;
    let mut options = ParseOptions::default();
    let mut scope_options = ResolvedOptions::defaults();

    for argument in args {
        match argument.as_str() {
            "--tokens" => options.tokens = true,
            "--parents" => options.parents = true,
            "--source" => options.source = true,
            "--jsx=true" => options.jsx = Some(true),
            "--jsx=false" => options.jsx = Some(false),
            "--source-type=module" => {
                options.source_type = SourceType::Module;
                scope_options.source_type = ScopeSourceType::Module;
            }
            "--source-type=script" => {
                options.source_type = SourceType::Script;
                scope_options.source_type = ScopeSourceType::Script;
            }
            "--source-type=commonjs" => {
                options.source_type = SourceType::CommonJs;
                scope_options.source_type = ScopeSourceType::CommonJs;
            }
            "--dialect=js" => scope_options.dialect_ts = false,
            "--scope-jsx=false" => scope_options.jsx = false,
            "--implied-strict" => scope_options.implied_strict = true,
            "--global-return" => scope_options.global_return = true,
            "--ignore-eval" => scope_options.ignore_eval = true,
            other if other.starts_with("--globals=") => {
                scope_options.globals = Some(
                    other["--globals=".len()..]
                        .split(',')
                        .filter(|name| !name.is_empty())
                        .map(utf16)
                        .collect(),
                );
            }
            other if other.starts_with("--jsx-pragma=") => {
                scope_options.jsx_pragma = Some(utf16(&other["--jsx-pragma=".len()..]));
            }
            other if other.starts_with("--jsx-fragment=") => {
                scope_options.jsx_fragment_name =
                    Some(utf16(&other["--jsx-fragment=".len()..]));
            }
            other if other.starts_with("--") => {
                eprintln!("unknown option: {other}");

                return ExitCode::from(2);
            }
            other => path = Some(other.to_string()),
        }
    }

    let Some(path) = path else {
        eprintln!("usage: jskit-dump parse <file> [options]");

        return ExitCode::from(2);
    };

    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("cannot read {path}: {error}");

            return ExitCode::from(2);
        }
    };

    let units: Vec<u16> = text.encode_utf16().collect();

    match parse(&units, &options) {
        Ok(buffer) => {
            if command == "analyze" {
                let words = words_of(&buffer);
                let scope_buffer = analyze(&words, &units, scope_options);

                std::io::stdout().write_all(&scope_buffer).unwrap();
            } else if command == "graph" {
                let words = words_of(&buffer);
                let scope_buffer = analyze(&words, &units, scope_options);
                let scope_words = words_of(&scope_buffer);
                let flow_buffer =
                    jskit_core::flow::create_graph(&words, &units, &scope_words);

                std::io::stdout().write_all(&flow_buffer).unwrap();
            } else {
                std::io::stdout().write_all(&buffer).unwrap();
            }

            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("THROW {error}");

            ExitCode::FAILURE
        }
    }
}
