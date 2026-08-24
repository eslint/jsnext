//! Sanity checks over the three producers. The exhaustive verification is
//! the differential corpus in `tools/`; these only prove the crate works
//! standalone.

use jskit_core::flow::create_graph;
use jskit_core::parse::{parse, ParseOptions};
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
}

#[test]
fn rejects_syntax_errors_with_position() {
    let source = utf16("const =");
    let error = parse(&source, &ParseOptions::default()).unwrap_err();

    assert_eq!(error.index, 6);
    assert_eq!(error.line_number, 1);
    assert_eq!(error.column, 7);
}
