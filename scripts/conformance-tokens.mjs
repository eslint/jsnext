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

const files = walk("node_modules").slice(0, Number(process.argv[2] ?? 300));
let ok = 0, bad = 0;
const seen = new Set();

for (const file of files) {
	const code = readFileSync(file, "utf8");
	let expected;
	try {
		expected = espree.parse(code, { ecmaVersion: "latest", sourceType: "module", tokens: true, comment: true, range: true, ecmaFeatures: { jsx: true } });
	} catch { continue; }
	let actual;
	try {
		actual = toAST(parse(code), { sourceType: "module", dialect: "js" }).ast;
	} catch { bad++; continue; }

	const norm = t =>
		t.map(
			x =>
				`${x.type}|${x.value}|${x.type === "Template" ? "" : `${x.start}|${x.end}`}${x.regex ? `|${x.regex.pattern}|${x.regex.flags}` : ""}`,
		);
	const et = norm(expected.tokens), at = norm(actual.tokens);
	const ec = norm(expected.comments), ac = norm(actual.comments);
	let bad1 = false;
	for (const [label, e, a] of [["tok", et, at], ["com", ec, ac]]) {
		if (e.length !== a.length || e.some((v, i) => v !== a[i])) {
			bad1 = true;
			let i = 0; while (i < Math.min(e.length, a.length) && e[i] === a[i]) i++;
			const key = `${label}:${e[i]}=>${a[i]}`;
			if (!seen.has(key)) { seen.add(key); console.log(`${label} ${file}\n   exp ${e.slice(i, i+3)}\n   got ${a.slice(i, i+3)}`); }
		}
	}
	if (bad1) bad++; else ok++;
}
console.log(`ok=${ok} bad=${bad}`);
