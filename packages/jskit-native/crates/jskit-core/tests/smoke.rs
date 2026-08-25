//! Sanity checks over the four producers. The exhaustive verification is
//! the differential corpus in `tools/`; these only prove the crate works
//! standalone.

use jskit_core::flow::create_graph;
use jskit_core::types::infer_types;
use jskit_core::parse::{parse, validate_ast, ParseOptions, ValidateSourceType};
use jskit_core::scope::options::ResolvedOptions;
use jskit_core::scope::{analyze, words_of};

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[test]
fn parses_analyzes_and_graphs() {
    let source = utf16("const answer = 42;\nfunction f(x) { return x + answer; }\n");
    let parsed = parse(&source, &ParseOptions::default()).expect("parses");
    let parse_words = words_of(&parsed);

    assert_eq!(parse_words[0], 0x4250534a, "parse magic");

    let scope = analyze(&parse_words, &source, ResolvedOptions::defaults());
    let scope_words = words_of(&scope);

    assert_eq!(scope_words[0], 0x4353534a, "scope magic");

    let flow = create_graph(&parse_words, &source, &scope_words);
    let flow_words = words_of(&flow);

    assert_eq!(flow_words[0], 0x4746434a, "flow magic");

    let types = infer_types(&parse_words, &source, &scope_words);
    let type_words = words_of(&types);

    assert_eq!(type_words[0], 0x5954534a, "type magic");
}

#[test]
fn validates_context_dependent_problems() {
    let source = utf16("let a; let a; return 1; const b = /(/u;");
    let parsed = parse(&source, &ParseOptions::default()).expect("parses");
    let parse_words = words_of(&parsed);
    let problems = validate_ast(
        &parse_words,
        &source,
        ValidateSourceType::Module,
        false,
        false,
        false,
    );

    let messages: Vec<String> = problems
        .iter()
        .map(|problem| String::from_utf16_lossy(&problem.message))
        .collect();

    assert_eq!(
        messages,
        [
            "Identifier 'a' has already been declared.",
            "'return' outside of function.",
            "Unterminated group.",
        ]
    );
    assert_eq!(problems[0].start, 11);
}

#[test]
fn rejects_syntax_errors_with_position() {
    let source = utf16("const =");
    let error = parse(&source, &ParseOptions::default()).unwrap_err();

    assert_eq!(error.index, 6);
    assert_eq!(error.line_number, 1);
    assert_eq!(error.column, 7);
}
