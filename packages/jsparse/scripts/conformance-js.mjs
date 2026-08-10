import * as espree from "espree";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, toAST } from "../dist/jsparse.js";

function walk(dir, out = [], depth = 0) {
	if (depth > 6) return out;
	let entries;
	try { entries = readdirSync(dir); } catch { return out; }
	for (const name of entries) {
		const full = join(dir, name);
		let st;
		try { st = statSync(full); } catch { continue; }
		if (st.isDirectory()) walk(full, out, depth + 1);
		else if (/\.(js|mjs|cjs|jsx)$/.test(name) && st.size < 400_000) out.push(full);
	}
	return out;
}

function stable(value) {
	if (value === null || typeof value !== "object") {
		return typeof value === "bigint" ? `#${value}` : value;
	}
	if (Array.isArray(value)) return value.map(stable);
	if (value instanceof RegExp) return `re:${value.source}/${value.flags}`;
	const out = {};
	for (const key of Object.keys(value).sort()) {
		if (key === "tokens" || key === "comments") continue;
		out[key] = stable(value[key]);
	}
	return out;
}

const files = walk(process.argv[2] ?? "../../node_modules").slice(0, Number(process.argv[3] ?? 400));
let ok = 0, mismatch = 0, threw = 0;
const problems = [];

for (const file of files) {
	const code = readFileSync(file, "utf8");
	for (const sourceType of ["module", "script"]) {
		let expected;
		try {
			expected = espree.parse(code, { ecmaVersion: "latest", sourceType, ecmaFeatures: { jsx: true } });
		} catch { continue; }
		let actual;
		try {
			actual = toAST(parse(code), { sourceType, dialect: "js" }).ast;
		} catch (e) {
			threw++;
			problems.push([file, sourceType, "THROW", e.message]);
			break;
		}
		const a = JSON.stringify(stable(expected));
		const b = JSON.stringify(stable(actual));
		if (a === b) ok++;
		else {
			mismatch++;
			let i = 0;
			while (i < a.length && a[i] === b[i]) i++;
			problems.push([file, sourceType, "DIFF", `exp=${a.slice(Math.max(0,i-50), i+70)}\n     got=${b.slice(Math.max(0,i-50), i+70)}`]);
		}
		break;
	}
}
console.log(`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`);
const seen = new Set();
for (const [file, st, kind, msg] of problems) {
	const key = kind + msg.slice(0, 120);
	if (seen.has(key)) continue;
	seen.add(key);
	console.log(`${kind} ${file} [${st}]\n     ${msg}`);
	if (seen.size > 25) break;
}
