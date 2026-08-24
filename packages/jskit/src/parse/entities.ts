/**
 * @fileoverview The named character references JSX recognizes.
 *
 * JSX child text and attribute values are the only places in the grammar where
 * an entity reference is resolved, so the table lives here rather than in the
 * scanner. It matches the XHTML entity set the reference parsers use.
 */

/** Named character references, mapped to the text they stand for. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	quot: '"',
	amp: "&",
	apos: "'",
	lt: "<",
	gt: ">",
	nbsp: " ",
	iexcl: "¡",
	cent: "¢",
	pound: "£",
	curren: "¤",
	yen: "¥",
	brvbar: "¦",
	sect: "§",
	uml: "¨",
	copy: "©",
	ordf: "ª",
	laquo: "«",
	not: "¬",
	shy: "­",
	reg: "®",
	macr: "¯",
	deg: "°",
	plusmn: "±",
	sup2: "²",
	sup3: "³",
	acute: "´",
	micro: "µ",
	para: "¶",
	middot: "·",
	cedil: "¸",
	sup1: "¹",
	ordm: "º",
	raquo: "»",
	frac14: "¼",
	frac12: "½",
	frac34: "¾",
	iquest: "¿",
	Agrave: "À",
	Aacute: "Á",
	Acirc: "Â",
	Atilde: "Ã",
	Auml: "Ä",
	Aring: "Å",
	AElig: "Æ",
	Ccedil: "Ç",
	Egrave: "È",
	Eacute: "É",
	Ecirc: "Ê",
	Euml: "Ë",
	Igrave: "Ì",
	Iacute: "Í",
	Icirc: "Î",
	Iuml: "Ï",
	ETH: "Ð",
	Ntilde: "Ñ",
	Ograve: "Ò",
	Oacute: "Ó",
	Ocirc: "Ô",
	Otilde: "Õ",
	Ouml: "Ö",
	times: "×",
	Oslash: "Ø",
	Ugrave: "Ù",
	Uacute: "Ú",
	Ucirc: "Û",
	Uuml: "Ü",
	Yacute: "Ý",
	THORN: "Þ",
	szlig: "ß",
	agrave: "à",
	aacute: "á",
	acirc: "â",
	atilde: "ã",
	auml: "ä",
	aring: "å",
	aelig: "æ",
	ccedil: "ç",
	egrave: "è",
	eacute: "é",
	ecirc: "ê",
	euml: "ë",
	igrave: "ì",
	iacute: "í",
	icirc: "î",
	iuml: "ï",
	eth: "ð",
	ntilde: "ñ",
	ograve: "ò",
	oacute: "ó",
	ocirc: "ô",
	otilde: "õ",
	ouml: "ö",
	divide: "÷",
	oslash: "ø",
	ugrave: "ù",
	uacute: "ú",
	ucirc: "û",
	uuml: "ü",
	yacute: "ý",
	thorn: "þ",
	yuml: "ÿ",
	OElig: "Œ",
	oelig: "œ",
	Scaron: "Š",
	scaron: "š",
	Yuml: "Ÿ",
	fnof: "ƒ",
	circ: "ˆ",
	tilde: "˜",
	Alpha: "Α",
	Beta: "Β",
	Gamma: "Γ",
	Delta: "Δ",
	Epsilon: "Ε",
	Zeta: "Ζ",
	Eta: "Η",
	Theta: "Θ",
	Iota: "Ι",
	Kappa: "Κ",
	Lambda: "Λ",
	Mu: "Μ",
	Nu: "Ν",
	Xi: "Ξ",
	Omicron: "Ο",
	Pi: "Π",
	Rho: "Ρ",
	Sigma: "Σ",
	Tau: "Τ",
	Upsilon: "Υ",
	Phi: "Φ",
	Chi: "Χ",
	Psi: "Ψ",
	Omega: "Ω",
	alpha: "α",
	beta: "β",
	gamma: "γ",
	delta: "δ",
	epsilon: "ε",
	zeta: "ζ",
	eta: "η",
	theta: "θ",
	iota: "ι",
	kappa: "κ",
	lambda: "λ",
	mu: "μ",
	nu: "ν",
	xi: "ξ",
	omicron: "ο",
	pi: "π",
	rho: "ρ",
	sigmaf: "ς",
	sigma: "σ",
	tau: "τ",
	upsilon: "υ",
	phi: "φ",
	chi: "χ",
	psi: "ψ",
	omega: "ω",
	thetasym: "ϑ",
	upsih: "ϒ",
	piv: "ϖ",
	ensp: " ",
	emsp: " ",
	thinsp: " ",
	zwnj: "‌",
	zwj: "‍",
	lrm: "‎",
	rlm: "‏",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	sbquo: "‚",
	ldquo: "“",
	rdquo: "”",
	bdquo: "„",
	dagger: "†",
	Dagger: "‡",
	bull: "•",
	hellip: "…",
	permil: "‰",
	prime: "′",
	Prime: "″",
	lsaquo: "‹",
	rsaquo: "›",
	oline: "‾",
	frasl: "⁄",
	euro: "€",
	image: "ℑ",
	weierp: "℘",
	real: "ℜ",
	trade: "™",
	alefsym: "ℵ",
	larr: "←",
	uarr: "↑",
	rarr: "→",
	darr: "↓",
	harr: "↔",
	crarr: "↵",
	lArr: "⇐",
	uArr: "⇑",
	rArr: "⇒",
	dArr: "⇓",
	hArr: "⇔",
	forall: "∀",
	part: "∂",
	exist: "∃",
	empty: "∅",
	nabla: "∇",
	isin: "∈",
	notin: "∉",
	ni: "∋",
	prod: "∏",
	sum: "∑",
	minus: "−",
	lowast: "∗",
	radic: "√",
	prop: "∝",
	infin: "∞",
	ang: "∠",
	and: "∧",
	or: "∨",
	cap: "∩",
	cup: "∪",
	int: "∫",
	there4: "∴",
	sim: "∼",
	cong: "≅",
	asymp: "≈",
	ne: "≠",
	equiv: "≡",
	le: "≤",
	ge: "≥",
	sub: "⊂",
	sup: "⊃",
	nsub: "⊄",
	sube: "⊆",
	supe: "⊇",
	oplus: "⊕",
	otimes: "⊗",
	perp: "⊥",
	sdot: "⋅",
	lceil: "⌈",
	rceil: "⌉",
	lfloor: "⌊",
	rfloor: "⌋",
	lang: "〈",
	rang: "〉",
	loz: "◊",
	spades: "♠",
	clubs: "♣",
	hearts: "♥",
	diams: "♦",
};

/**
 * Texts already resolved during the decode in progress.
 *
 * The same text is resolved more than once per tree — a `JSXText` run is
 * decoded for its node and again for its token, and real JSX repeats the
 * same few entity-bearing strings — so finished answers are kept until
 * `clearEntityCache()` ends the decode. The strings are slices of the source
 * being decoded, which is why the cache must not outlive the call that
 * filled it: a slice can pin its parent string.
 */
const ENTITY_CACHE = /* @__PURE__ */ new Map<string, string>();

/**
 * Empties the entity cache, releasing the source text it points into.
 * @returns Nothing.
 */
export function clearEntityCache(): void {
	ENTITY_CACHE.clear();
}

/**
 * Resolves the entity references in a run of JSX text.
 *
 * JSX resolves `&amp;`, `&#65;`, and `&#x41;`, and leaves anything that does
 * not form a complete reference exactly as written.
 * @param raw The text as it appears in the source.
 * @returns The text with every complete reference replaced.
 */
export function decodeEntities(raw: string): string {
	if (raw.indexOf("&") === -1) {
		return raw;
	}

	const cached = ENTITY_CACHE.get(raw);

	if (cached !== undefined) {
		return cached;
	}

	let result = "";
	let index = 0;

	for (;;) {
		const start = raw.indexOf("&", index);

		if (start === -1) {
			break;
		}

		const end = raw.indexOf(";", start);

		if (end === -1) {
			break;
		}

		const body = raw.slice(start + 1, end);
		let replacement: string | undefined;

		if (body.charCodeAt(0) === 0x23) {
			// A numeric reference, either decimal or hexadecimal.
			const isHex = (body.charCodeAt(1) | 0x20) === 0x78;
			const digits = isHex ? body.slice(2) : body.slice(1);
			const pattern = isHex ? /^[\da-f]+$/iu : /^\d+$/u;

			if (pattern.test(digits)) {
				const code = parseInt(digits, isHex ? 16 : 10);

				if (code <= 0x10ffff) {
					replacement = String.fromCodePoint(code);
				}
			}
		} else {
			replacement = NAMED_ENTITIES[body];
		}

		if (replacement === undefined) {
			// Not a reference after all; keep looking past the ampersand.
			result += raw.slice(index, start + 1);
			index = start + 1;
			continue;
		}

		result += raw.slice(index, start) + replacement;
		index = end + 1;
	}

	const decoded = result + raw.slice(index);

	// A pathological file could hold thousands of distinct entity texts;
	// starting over keeps the cache small without a use-count to maintain.
	if (ENTITY_CACHE.size >= 512) {
		ENTITY_CACHE.clear();
	}

	ENTITY_CACHE.set(raw, decoded);

	return decoded;
}
