/**
 * @fileoverview Turns a benchmark data file into a shareable SVG.
 *
 * ```bash
 * node benchmarks/benchmark.js --json=benchmarks/results.json
 * node benchmarks/chart.js benchmarks/results.json benchmarks/results.svg
 * ```
 *
 * The two tiers get a panel each and are never plotted on one scale, because a
 * result is only comparable inside its own tier — see the header of
 * `benchmark.js` for what separates them.
 *
 * Color carries the dialect and nothing else. It is deliberately not carrying
 * rank: the rows are in a fixed order set by `ROWS` rather than sorted by
 * speed, so a contender keeps its position between runs and a reader comparing
 * two charts is looking at the same layout twice.
 *
 * The output is one self-contained SVG with no external references, so it can
 * be opened, embedded, posted, or converted to PNG without anything else
 * present. It carries both a light and a dark palette and switches on the
 * viewer's `prefers-color-scheme`.
 */

import { readFileSync, writeFileSync } from "node:fs";

//-----------------------------------------------------------------------------
// What Is Plotted
//-----------------------------------------------------------------------------

/**
 * The rows of each panel, in the order they are drawn.
 *
 * Keyed by the `key` field the benchmark writes, so a contender whose display
 * name carries a version number still lands in the right row. A key that is
 * missing from the data is skipped, and a key the data has but this list does
 * not is left out of the chart — the extra TypeScript versions the benchmark
 * measures are informative in the table but would crowd the picture.
 */
const ROWS = {
	ast: [
		["jskit-parse", "jskit — parse()"],
		["jskit-validate", "jskit — parse() + validate()"],
		["jskit-to-ast", "jskit — parse() + validate() + toAST()"],
		["babel", "@babel/parser"],
		["acorn", "acorn"],
		["meriyah", "meriyah"],
		["espree", "espree"],
		["typescript-eslint", "@typescript-eslint/parser"],
	],
	eslint: [
		["jskit-eslint", "jskit — eslintParser.parse()"],
		["meriyah", "meriyah"],
		["espree", "espree"],
		["babel-eslint", "@babel/eslint-parser"],
		["typescript-eslint", "@typescript-eslint/parser"],
	],
};

/** The panels, in the order they are stacked. */
const PANELS = [
	{
		tier: "ast",
		title: "Syntax tree only",
		subtitle:
			"No tokens, no comments, no range or loc — the smallest job that still yields a tree",
	},
	{
		tier: "eslint",
		title: "The job ESLint actually asks for",
		subtitle:
			"Tree + tokens + comments, every one of them carrying both range and loc",
	},
];

/**
 * The dialects, in legend order, with the categorical slot each one wears.
 *
 * Three slots, which is what the palette validates for a chart where every
 * pair can appear side by side.
 */
const DIALECTS = [
	{ id: "js", label: "JavaScript", series: 1 },
	{ id: "ts", label: "TypeScript", series: 2 },
	{ id: "jsx", label: "JSX", series: 3 },
];

//-----------------------------------------------------------------------------
// Geometry
//-----------------------------------------------------------------------------

const WIDTH = 1240;
const GUTTER = 300;
const PADDING_LEFT = 44;
const PADDING_RIGHT = 132;
const BAR = 15;
const BAR_GAP = 2;
const ROW_GAP = 22;
const ROW_HEIGHT = DIALECTS.length * BAR + (DIALECTS.length - 1) * BAR_GAP;
const PLOT_LEFT = PADDING_LEFT + GUTTER;
const PLOT_WIDTH = WIDTH - PLOT_LEFT - PADDING_RIGHT;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Escapes the characters that cannot appear in XML text.
 * @param text The text to escape.
 * @returns The escaped text.
 */
function escapeXml(text) {
	return String(text)
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;");
}

/**
 * Chooses gridline positions that land on readable numbers.
 * @param max The largest value that has to fit.
 * @returns The tick values, starting at zero.
 */
function ticks(max) {
	const rough = max / 5;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const step =
		[1, 2, 2.5, 5, 10].find(multiple => multiple * magnitude >= rough) *
		magnitude;
	const count = Math.ceil(max / step);
	const result = [];

	for (let index = 0; index <= count; index++) {
		/*
		 * Multiplied rather than accumulated: adding a step like 0.2 nine times
		 * lands on 1.8000000000000003, which would be printed as the tick.
		 */
		result.push(Number((index * step).toPrecision(12)));
	}

	return result;
}

/**
 * Draws a bar that is rounded at the end it grows toward and square at the
 * baseline.
 * @param x The baseline.
 * @param y The bar's top edge.
 * @param width How far the bar reaches.
 * @param height How thick the bar is.
 * @returns The path data.
 */
function barPath(x, y, width, height) {
	const radius = Math.min(4, width);
	const right = x + width;

	return (
		`M${x.toFixed(1)} ${y} H${(right - radius).toFixed(1)} ` +
		`a${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${radius.toFixed(1)} ${radius.toFixed(1)} ` +
		`V${(y + height - radius).toFixed(1)} ` +
		`a${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${(-radius).toFixed(1)} ${radius.toFixed(1)} ` +
		`H${x.toFixed(1)} Z`
	);
}

/**
 * Finds one contender's result for one dialect.
 * @param data The parsed data file.
 * @param dialect The dialect to look in.
 * @param tier The tier to look in.
 * @param key The contender's stable key.
 * @returns The result, or `undefined` when that contender did not run.
 */
function find(data, dialect, tier, key) {
	return data.suites
		.find(suite => suite.dialect === dialect)
		?.results.find(result => result.key === key && result.tier === tier);
}

//-----------------------------------------------------------------------------
// Styling
//-----------------------------------------------------------------------------

/**
 * Every role in the chart, with the light-mode presentation it carries.
 *
 * These are written onto the elements as **presentation attributes**, not left
 * to the stylesheet, because presentation attributes are the one styling
 * channel every SVG renderer understands. Rasterizers built on librsvg — which
 * is what most "convert this SVG to a PNG" paths use — support neither CSS
 * custom properties nor `@media (prefers-color-scheme)`, and a chart that
 * renders as a black rectangle when someone converts it for posting is not a
 * shareable chart.
 *
 * A stylesheet still ships alongside, carrying only the dark-mode overrides.
 * CSS beats a presentation attribute, so where CSS works the chart follows the
 * viewer's theme, and where it does not the light rendering survives intact.
 */
const ROLES = {
	surface: { fill: "#fcfcfb" },
	title: { fill: "#0b0b0b", "font-size": 30, "font-weight": 600 },
	subtitle: { fill: "#52514e", "font-size": 15 },
	"panel-title": { fill: "#0b0b0b", "font-size": 18, "font-weight": 600 },
	"panel-subtitle": { fill: "#52514e", "font-size": 13 },
	"row-label": { fill: "#0b0b0b", "font-size": 14, "text-anchor": "end" },
	legend: { fill: "#52514e", "font-size": 13 },
	value: { fill: "#52514e", "font-size": 12 },
	absent: { fill: "#898781", "font-size": 12, "font-style": "italic" },
	tick: { fill: "#898781", "font-size": 12, "text-anchor": "middle" },
	footer: { fill: "#898781", "font-size": 12 },
	grid: { stroke: "#e1e0d9", "stroke-width": 1 },
	baseline: { stroke: "#c3c2b7", "stroke-width": 1 },
	s1: { fill: "#2a78d6" },
	s2: { fill: "#eb6834" },
	s3: { fill: "#1baf7a" },
};

/** What each role becomes in dark mode. Roles absent here do not change. */
const DARK = {
	surface: { fill: "#1a1a19" },
	title: { fill: "#ffffff" },
	subtitle: { fill: "#c3c2b7" },
	"panel-title": { fill: "#ffffff" },
	"panel-subtitle": { fill: "#c3c2b7" },
	"row-label": { fill: "#ffffff" },
	legend: { fill: "#c3c2b7" },
	value: { fill: "#c3c2b7" },
	grid: { stroke: "#2c2c2a" },
	baseline: { stroke: "#383835" },
	s1: { fill: "#3987e5" },
	s2: { fill: "#d95926" },
	s3: { fill: "#199e70" },
};

/**
 * Builds the `class` and presentation attributes for one or more roles.
 * @param names The roles to apply, in order. Later roles win.
 * @returns The attributes, ready to drop into a tag.
 */
function styled(...names) {
	const applied = Object.assign({}, ...names.map(name => ROLES[name]));
	const attributes = Object.entries(applied)
		.map(([property, value]) => `${property}="${value}"`)
		.join(" ");

	return `class="${names.map(name => `bench-${name}`).join(" ")}" ${attributes}`;
}

/**
 * Builds the stylesheet that lets the chart follow a dark viewer.
 * @returns The contents of the `style` element.
 */
function darkStyles() {
	return Object.entries(DARK)
		.map(([name, declarations]) => {
			const body = Object.entries(declarations)
				.map(([property, value]) => `${property}: ${value};`)
				.join(" ");

			return `\t\tsvg.bench .bench-${name} { ${body} }`;
		})
		.join("\n");
}

//-----------------------------------------------------------------------------
// Rendering
//-----------------------------------------------------------------------------

/**
 * Joins a list into English.
 * @param items The items to join.
 * @returns The items as a phrase.
 */
function sentenceList(items) {
	if (items.length < 3) {
		return items.join(" and ");
	}

	return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * Describes one panel in prose, for readers who cannot see it.
 *
 * Written from the measurements rather than by hand, because a description
 * that stops matching the picture is worse than none: this file is run again
 * every time the benchmark is, and hand-written numbers would survive a run
 * that changed them.
 * @param panel Which panel is being described.
 * @param rows The rows the panel drew, in drawing order.
 * @returns A paragraph naming the leader, the spread, and what is missing.
 */
function describePanel(panel, rows) {
	/*
	 * The row labels separate the package from the call with an em dash, which
	 * a screen reader reads out as "dash". Spoken, the space alone separates
	 * them just as well.
	 */
	const spoken = label => label.replace(/ — /gu, " ");

	const sentences = [
		`${panel.title}: ${panel.subtitle}.`,
		`Grouped horizontal bar chart of ${rows.length} parsers, each with a bar for JavaScript, TypeScript, and JSX, measured in megabytes of source per second.`,
	];

	for (const dialect of DIALECTS) {
		const ranked = rows
			.map(row => ({
				label: row.label,
				result: row.bars.find(bar => bar.dialect === dialect)?.result,
			}))
			.filter(entry => entry.result)
			.sort(
				(a, b) =>
					b.result.megabytesPerSecond - a.result.megabytesPerSecond,
			);

		if (ranked.length === 0) {
			continue;
		}

		const [first, second] = ranked;
		const last = ranked.at(-1);
		const rate = entry => entry.result.megabytesPerSecond.toFixed(1);
		const times = (a, b) =>
			(a.result.megabytesPerSecond / b.result.megabytesPerSecond).toFixed(
				1,
			);

		sentences.push(
			`On ${dialect.label}, ${spoken(first.label)} is fastest at ${rate(first)}, ` +
				`${times(first, second)} times ${spoken(second.label)} at ${rate(second)}, ` +
				`and ${times(first, last)} times the slowest, ${spoken(last.label)}, at ${rate(last)}.`,
		);
	}

	/*
	 * Grouped by dialect rather than by parser, so two parsers missing the
	 * same one share a clause instead of repeating it.
	 */
	for (const dialect of DIALECTS) {
		const missing = rows
			.filter(row =>
				row.bars.some(bar => bar.dialect === dialect && !bar.result),
			)
			.map(row => spoken(row.label));

		if (missing.length > 0) {
			sentences.push(
				`${sentenceList(missing)} ${missing.length === 1 ? "has" : "have"} no ${dialect.label} bar, that dialect being unsupported.`,
			);
		}
	}

	return sentences.join(" ");
}

/**
 * Draws one panel: a heading, a gridded plot, and one band per contender.
 * @param data The parsed data file.
 * @param panel Which panel to draw.
 * @param top The y coordinate to start at.
 * @returns The SVG markup, its prose description, and the y coordinate the
 *      next panel starts at.
 */
function renderPanel(data, panel, top) {
	const rows = ROWS[panel.tier]
		.map(([key, label]) => ({
			label,
			bars: DIALECTS.map(dialect => ({
				dialect,
				result: find(data, dialect.id, panel.tier, key),
			})),
		}))
		.filter(row => row.bars.some(bar => bar.result));

	const max = Math.max(
		...rows.flatMap(row =>
			row.bars
				.filter(bar => bar.result)
				.map(bar => bar.result.megabytesPerSecond),
		),
	);
	const scale = ticks(max);
	const domain = scale.at(-1);
	const x = value => PLOT_LEFT + (value / domain) * PLOT_WIDTH;

	const parts = [];

	parts.push(
		`<text ${styled("panel-title")} x="${PADDING_LEFT}" y="${top}">${escapeXml(panel.title)}</text>`,
		`<text ${styled("panel-subtitle")} x="${PADDING_LEFT}" y="${top + 21}">${escapeXml(panel.subtitle)}</text>`,
	);

	const plotTop = top + 46;
	const plotHeight = rows.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
	const plotBottom = plotTop + plotHeight;

	for (const value of scale) {
		parts.push(
			`<line ${styled("grid")} x1="${x(value).toFixed(1)}" y1="${plotTop - 8}" x2="${x(value).toFixed(1)}" y2="${plotBottom + 6}"/>`,
			`<text ${styled("tick")} x="${x(value).toFixed(1)}" y="${plotBottom + 26}">${value}</text>`,
		);
	}

	// The zero line is the baseline every bar grows from, so it reads stronger.
	parts.push(
		`<line ${styled("baseline")} x1="${PLOT_LEFT}" y1="${plotTop - 8}" x2="${PLOT_LEFT}" y2="${plotBottom + 6}"/>`,
	);

	rows.forEach((row, index) => {
		const bandTop = plotTop + index * (ROW_HEIGHT + ROW_GAP);

		parts.push(
			`<text ${styled("row-label")} x="${PLOT_LEFT - 16}" y="${bandTop + ROW_HEIGHT / 2 + 5}">${escapeXml(row.label)}</text>`,
		);

		row.bars.forEach((bar, barIndex) => {
			const y = bandTop + barIndex * (BAR + BAR_GAP);

			/*
			 * A dialect a parser does not support leaves an empty slot, and an
			 * empty slot beside two filled ones reads as a measurement of
			 * zero. A dash says which it is.
			 */
			if (!bar.result) {
				parts.push(
					`<text ${styled("absent")} x="${PLOT_LEFT + 6}" y="${y + BAR - 3}">— no ${escapeXml(bar.dialect.label)} support</text>`,
				);
				return;
			}
			const end = x(bar.result.megabytesPerSecond);

			/*
			 * A contender two orders of magnitude off the leader would round to
			 * nothing, and an invisible bar reads as missing data rather than
			 * as a very small number, so every bar keeps a visible stub.
			 */
			const width = Math.max(end - PLOT_LEFT, 3);

			parts.push(
				`<path ${styled(`s${bar.dialect.series}`)} d="${barPath(PLOT_LEFT, y, width, BAR)}"/>`,
				`<text ${styled("value")} x="${(PLOT_LEFT + width + 8).toFixed(1)}" y="${y + BAR - 3}">${bar.result.megabytesPerSecond.toFixed(1)}</text>`,
			);
		});
	});

	return {
		markup: parts.join("\n"),
		description: describePanel(panel, rows),
		next: plotBottom + 74,
	};
}

/**
 * Draws the whole chart.
 * @param data The parsed data file.
 * @returns The SVG document.
 */
function renderChart(data) {
	const parts = [];
	const descriptions = [];
	let y = 132;

	for (const panel of PANELS) {
		const rendered = renderPanel(data, panel, y);

		parts.push(rendered.markup);
		descriptions.push(rendered.description);
		y = rendered.next;
	}

	const height = y + 34;
	const legend = DIALECTS.map((dialect, index) => {
		const left = PADDING_LEFT + index * 148;

		return (
			`<rect ${styled(`s${dialect.series}`)} x="${left}" y="94" width="13" height="13" rx="3"/>` +
			`<text ${styled("legend")} x="${left + 21}" y="105">${escapeXml(dialect.label)}</text>`
		);
	}).join("\n");

	const bytes = (data.fixtureBytes / 1024).toFixed(0);
	const samples = (data.passes ?? 1) * (data.rounds ?? 1);

	/*
	 * `role="img"` makes the whole drawing one node to a screen reader, so the
	 * title and description below are read instead of the several hundred
	 * stranded text fragments the bars and axes would otherwise present. Both
	 * panels are described here rather than on a group each, because a group's
	 * own label inside a `role="img"` subtree is not reached.
	 */
	return `<svg xmlns="http://www.w3.org/2000/svg" class="bench" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" role="img" aria-labelledby="bench-name bench-summary">
<title id="bench-name">Parser throughput on ${bytes} KiB of source, in megabytes per second</title>
<desc id="bench-summary">${escapeXml(
		[
			`Two panels, each on its own scale.`,
			...descriptions,

			/*
			 * Sighted readers get this from the two separate axes. Spoken, the
			 * figures arrive in one stream, so the warning has to be said.
			 */
			`The two panels measure different jobs, so a figure from one is not comparable with a figure from the other.`,
			`Every parser was measured alone in its own process, and each figure is the median of ${samples} samples.`,
		].join(" "),
	)}</desc>
<style>
	/*
	 * Dark mode only. The light rendering is already on the elements as
	 * presentation attributes, which CSS outranks, so this file needs no
	 * light-mode rules and stays correct in a renderer that ignores CSS
	 * entirely.
	 *
	 * Every rule is scoped to the root element because an SVG "style" element
	 * inlined into an HTML page applies to the whole document, and unscoped
	 * rules would repaint the host. The ":not" guard lets a host that stamps
	 * an explicit light theme win over a dark operating system; a host wanting
	 * the reverse adds its own "[data-theme=dark] svg.bench" rules, which
	 * outrank these.
	 */
	@media (prefers-color-scheme: dark) {
		svg.bench:where(:not([data-theme="light"] *)) { color-scheme: dark; }

${darkStyles()
	.split("\n")
	.map(line => `\t${line}`)
	.join("\n")
	.replace(/svg\.bench/gu, 'svg.bench:where(:not([data-theme="light"] *))')}
	}

	svg.bench .bench-value,
	svg.bench .bench-tick { font-variant-numeric: tabular-nums; }
</style>
<rect ${styled("surface")} x="0" y="0" width="${WIDTH}" height="${height}"/>
<text ${styled("title")} x="${PADDING_LEFT}" y="52">Parsing ${bytes} KiB of source, in megabytes per second</text>
<text ${styled("subtitle")} x="${PADDING_LEFT}" y="76">Higher is faster. The two panels measure different jobs and share no scale — compare within a panel, never across.</text>
${legend}
${parts.join("\n")}
<text ${styled("footer")} x="${PADDING_LEFT}" y="${height - 14}">Median of ${samples} samples · every parser measured alone in its own process · Node ${escapeXml(data.node)} · @typescript-eslint/parser measured with no type information: one file, no tsconfig, no program</text>
</svg>
`;
}

//-----------------------------------------------------------------------------
// Entry Point
//-----------------------------------------------------------------------------

const [input = "benchmarks/results.json", output = "benchmarks/results.svg"] =
	process.argv.slice(2);

const data = JSON.parse(readFileSync(input, "utf8"));

writeFileSync(output, renderChart(data));

console.log(`Wrote ${output}`);
