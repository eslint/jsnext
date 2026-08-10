import { parse as tsParse } from "@typescript-eslint/parser";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, toAST } from "../dist/jsparse.js";

function walk(dir, out = [], depth = 0) {
	if (depth > 7) return out;
	let entries;
	try { entries = readdirSync(dir); } catch { return out; }
	for (const name of entries) {
		const full = join(dir, name);
		let st;
		try { st = statSync(full); } catch { continue; }
		if (st.isDirectory()) walk(full, out, depth + 1);
		else if (/\.(ts|mts|cts|tsx)$/.test(name) && st.size < 900_000) out.push(full);
	}
	return out;
}

function stable(value) {
	if (value === undefined) return null;
	if (value === null || typeof value !== "object") return typeof value === "bigint" ? `#${value}` : value;
	if (Array.isArray(value)) return value.map(stable);
	if (value instanceof RegExp) return `re:${value.source}/${value.flags}`;
	const flat = {};
	for (const key of Object.keys(value)) {
		if (["tokens", "comments", "loc", "range", "parent"].includes(key)) continue;
		flat[key] = value[key];
	}
	if (Array.isArray(value.range)) { flat.start = value.range[0]; flat.end = value.range[1]; }
	const out = {};
	for (const key of Object.keys(flat).sort()) out[key] = stable(flat[key]);
	return out;
}

const dirs = process.argv[2] ? [process.argv[2]] : ["node_modules"];
let files = [];
for (const d of dirs) files = files.concat(walk(d));
files = files.slice(0, Number(process.argv[3] ?? 400));

let ok = 0, mismatch = 0, threw = 0;
const seen = new Set();
for (const file of files) {
	const code = readFileSync(file, "utf8");
	let expected;
	try { expected = tsParse(code, { sourceType: "module", range: true, loc: false, jsx: /\.tsx$/.test(file) }); } catch { continue; }
	let actual;
	try { actual = toAST(parse(code), { sourceType: "module", dialect: "ts" }).ast; }
	catch (e) {
		threw++;
		const key = "T" + e.message.replace(/\(\d+:\d+\)/, "");
		if (!seen.has(key)) { seen.add(key); console.log(`THROW ${file}: ${e.message}`); }
		continue;
	}
	const a = JSON.stringify(stable(expected)), b = JSON.stringify(stable(actual));
	if (a === b) ok++;
	else {
		mismatch++;
		let i = 0; while (i < a.length && a[i] === b[i]) i++;
		const key = "D" + a.slice(Math.max(0, i - 30), i + 40);
		if (!seen.has(key)) {
			seen.add(key);
			console.log(`DIFF ${file}\n   exp ${a.slice(Math.max(0, i - 50), i + 80)}\n   got ${b.slice(Math.max(0, i - 50), i + 80)}`);
		}
	}
	if (seen.size > 20) break;
}
console.log(`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`);
