/**
 * @fileoverview Conversion of raw literal text into JavaScript values.
 *
 * These functions only run when an AST is materialized, so they favor clarity
 * over the bit tricks used in the scanner.
 */

import {
	CH_0,
	CH_7,
	CH_9,
	CH_B_LOWER,
	CH_BACKSLASH,
	CH_BRACE_CLOSE,
	CH_BRACE_OPEN,
	CH_CR,
	CH_F_LOWER,
	CH_LF,
	CH_N_LOWER,
	CH_R_LOWER,
	CH_T_LOWER,
	CH_U_LOWER,
	CH_V_LOWER,
	CH_X_LOWER,
	CH_LINE_SEPARATOR,
	CH_PARAGRAPH_SEPARATOR,
} from "./chars.js";

/**
 * Resolves the escape sequences in a string or template body.
 * @param raw The text between the delimiters.
 * @param isTemplate Whether the text came from a template literal, where a
 *      lone `\r` and `\r\n` both normalize to `\n`.
 * @returns The cooked value.
 */
export function decodeEscapes(raw: string, isTemplate: boolean): string {
	if (raw.indexOf("\\") === -1) {
		return isTemplate && raw.indexOf("\r") !== -1
			? raw.replace(/\r\n?/gu, "\n")
			: raw;
	}

	let result = "";
	let index = 0;

	while (index < raw.length) {
		const code = raw.charCodeAt(index);

		if (code === CH_CR) {
			// Template literals normalize every line ending to `\n`.
			result += "\n";
			index += raw.charCodeAt(index + 1) === CH_LF ? 2 : 1;
			continue;
		}

		if (code !== CH_BACKSLASH) {
			result += raw[index];
			index++;
			continue;
		}

		index++;

		const escape = raw.charCodeAt(index);

		switch (escape) {
			case CH_N_LOWER:
				result += "\n";
				index++;
				break;

			case CH_T_LOWER:
				result += "\t";
				index++;
				break;

			case CH_R_LOWER:
				result += "\r";
				index++;
				break;

			case CH_B_LOWER:
				result += "\b";
				index++;
				break;

			case CH_F_LOWER:
				result += "\f";
				index++;
				break;

			case CH_V_LOWER:
				result += "\v";
				index++;
				break;

			case CH_X_LOWER:
				result += String.fromCharCode(
					parseInt(raw.slice(index + 1, index + 3), 16),
				);
				index += 3;
				break;

			case CH_U_LOWER:
				if (raw.charCodeAt(index + 1) === CH_BRACE_OPEN) {
					const close = raw.indexOf(
						String.fromCharCode(CH_BRACE_CLOSE),
						index + 2,
					);

					result += String.fromCodePoint(
						parseInt(raw.slice(index + 2, close), 16),
					);
					index = close + 1;
				} else {
					result += String.fromCharCode(
						parseInt(raw.slice(index + 1, index + 5), 16),
					);
					index += 5;
				}

				break;

			case CH_LF:
			case CH_LINE_SEPARATOR:
			case CH_PARAGRAPH_SEPARATOR:
				// A line continuation contributes nothing to the value.
				index++;
				break;

			case CH_CR:
				index += raw.charCodeAt(index + 1) === CH_LF ? 2 : 1;
				break;

			default:
				if (escape >= CH_0 && escape <= CH_7) {
					let digits = "";

					while (
						digits.length < 3 &&
						raw.charCodeAt(index) >= CH_0 &&
						raw.charCodeAt(index) <= CH_7
					) {
						digits += raw[index];
						index++;
					}

					result += String.fromCharCode(parseInt(digits, 8));
					break;
				}

				if (escape >= CH_0 && escape <= CH_9) {
					result += raw[index];
					index++;
					break;
				}

				result += raw[index];
				index++;
		}
	}

	return result;
}

/**
 * Converts the raw text of a numeric literal into a number.
 * @param raw The literal's source text.
 * @returns The numeric value.
 */
export function decodeNumber(raw: string): number {
	const text = raw.indexOf("_") === -1 ? raw : raw.replace(/_/gu, "");

	if (text.charCodeAt(0) !== CH_0 || text.length === 1) {
		return Number(text);
	}

	const marker = text.charCodeAt(1) | 0x20;

	if (marker === CH_X_LOWER) {
		return parseInt(text.slice(2), 16);
	}

	if (marker === 0x6f) {
		return parseInt(text.slice(2), 8);
	}

	if (marker === CH_B_LOWER) {
		return parseInt(text.slice(2), 2);
	}

	/*
	 * A leading zero followed only by octal digits is a legacy octal literal;
	 * anything else (such as `08`) is read as a decimal number.
	 */
	if (/^0[0-7]+$/u.test(text)) {
		return parseInt(text.slice(1), 8);
	}

	return Number(text);
}
