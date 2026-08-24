//! Escape decoding, for the few places the parser must compare decoded text.
//!
//! Port of the `decodeEscapes` half of `packages/jskit/src/parse/values.ts`.
//! The parser calls this only for identifier-like text (escaped keyword
//! checks, `"constructor"` key comparison), and always with
//! `isTemplate: false`.

use super::chars::*;

fn push_code_unit(out: &mut Vec<u16>, unit: u32) {
    out.push(unit as u16);
}

fn push_code_point(out: &mut Vec<u16>, point: u32) {
    if point > 0xffff && point <= 0x10ffff {
        let p = point - 0x10000;

        out.push(0xd800 + (p >> 10) as u16);
        out.push(0xdc00 + (p & 0x3ff) as u16);
    } else {
        out.push(point as u16);
    }
}

/// Decodes the backslash escapes in a raw string or identifier body, matching
/// the JavaScript implementation with `isTemplate` false.
pub fn decode_escapes(raw: &[u16]) -> Vec<u16> {
    if !raw.contains(&(CH_BACKSLASH as u16)) {
        return raw.to_vec();
    }

    let mut result: Vec<u16> = Vec::with_capacity(raw.len());
    let mut index = 0usize;
    let cc = |i: usize| -> i32 {
        if i < raw.len() {
            raw[i] as i32
        } else {
            -1
        }
    };

    while index < raw.len() {
        let code = raw[index] as i32;

        if code != CH_BACKSLASH {
            result.push(raw[index]);
            index += 1;
            continue;
        }

        index += 1;

        let escape = cc(index);

        match escape {
            c if c == CH_N_LOWER => {
                push_code_unit(&mut result, 0x0a);
                index += 1;
            }
            c if c == CH_T_LOWER => {
                push_code_unit(&mut result, 0x09);
                index += 1;
            }
            c if c == CH_R_LOWER => {
                push_code_unit(&mut result, 0x0d);
                index += 1;
            }
            c if c == CH_B_LOWER => {
                push_code_unit(&mut result, 0x08);
                index += 1;
            }
            c if c == CH_F_LOWER => {
                push_code_unit(&mut result, 0x0c);
                index += 1;
            }
            c if c == CH_V_LOWER => {
                push_code_unit(&mut result, 0x0b);
                index += 1;
            }
            c if c == CH_X_LOWER => {
                let value = parse_hex(raw, index + 1, index + 3);

                push_code_unit(&mut result, value);
                index += 3;
            }
            c if c == CH_U_LOWER => {
                if cc(index + 1) == CH_BRACE_OPEN {
                    let mut close = index + 2;

                    while close < raw.len() && raw[close] as i32 != CH_BRACE_CLOSE {
                        close += 1;
                    }

                    let value = parse_hex(raw, index + 2, close);

                    push_code_point(&mut result, value);
                    index = close + 1;
                } else {
                    let value = parse_hex(raw, index + 1, index + 5);

                    push_code_unit(&mut result, value);
                    index += 5;
                }
            }
            c if c == CH_LF || c == CH_LINE_SEPARATOR || c == CH_PARAGRAPH_SEPARATOR => {
                // A line continuation contributes nothing to the value.
                index += 1;
            }
            c if c == CH_CR => {
                index += if cc(index + 1) == CH_LF { 2 } else { 1 };
            }
            c if (CH_0..=CH_7).contains(&c) => {
                let mut value = 0u32;
                let mut digits = 0;

                while digits < 3 && (CH_0..=CH_7).contains(&cc(index)) {
                    value = value * 8 + (cc(index) - CH_0) as u32;
                    digits += 1;
                    index += 1;
                }

                push_code_unit(&mut result, value);
            }
            c if (CH_0..=CH_9).contains(&c) => {
                result.push(raw[index]);
                index += 1;
            }
            _ => {
                if index < raw.len() {
                    result.push(raw[index]);
                }

                index += 1;
            }
        }
    }

    result
}

fn parse_hex(raw: &[u16], start: usize, end: usize) -> u32 {
    let mut value = 0u32;

    for i in start..end.min(raw.len()) {
        let code = raw[i] as i32;
        let digit = if (CH_0..=CH_9).contains(&code) {
            (code - CH_0) as u32
        } else {
            (((code | 0x20) - CH_A_LOWER) as u32).wrapping_add(10)
        };

        value = value.wrapping_mul(16).wrapping_add(digit);
    }

    value
}
