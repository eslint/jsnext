/**
 * @fileoverview Generates the source texts the benchmark runs against.
 *
 * The fixtures are generated rather than checked in so that the benchmark
 * measures a predictable mix of syntax at a predictable size, instead of
 * whatever happens to be installed in `node_modules`.
 */

/**
 * Builds a JavaScript source text of roughly the requested size.
 * @param targetBytes How large the result should be, approximately.
 * @returns The generated source text.
 */
export function javascriptFixture(targetBytes) {
	const parts = ["'use strict';\n"];
	let index = 0;

	while (parts.join("").length < targetBytes) {
		parts.push(`
// Section ${index}: a mix of the constructs a real module contains.
import { helper${index} as aliased${index} } from "./module-${index}.js";

const CONFIG_${index} = {
	name: "section-${index}",
	values: [1, 2.5, 0x1f, 1_000, ${index}e2],
	pattern: /^[a-z]+(\\d*)$/gu,
	nested: { deep: { deeper: [{ a: 1 }, { b: 2 }] } },
	async *stream(...args) {
		for await (const chunk of args) {
			yield chunk?.value ?? aliased${index}(chunk);
		}
	},
};

export class Widget${index} extends Base {
	#private = ${index};
	static registry = new Map();
	static { Widget${index}.registry.set("w${index}", Widget${index}); }

	constructor({ id = ${index}, label = \`widget-\${id}\`, ...rest } = {}) {
		super(id);
		this.id = id;
		this.label = label;
		this.rest = rest;
	}

	get total() {
		return this.#private + (this.rest.extra || 0);
	}

	async render(target, { retries = 3 } = {}) {
		let attempt = 0;

		while (attempt++ < retries) {
			try {
				const result = await target.draw(this.label, CONFIG_${index});

				if (result && typeof result === "object") {
					return result.value === undefined ? null : result.value;
				}
			} catch (error) {
				if (attempt === retries) {
					throw error;
				}
			} finally {
				target.cleanup?.();
			}
		}

		return null;
	}
}

export function process${index}(items) {
	const output = [];

	for (let i = 0, length = items.length; i < length; i++) {
		const item = items[i];

		switch (item.kind) {
			case "a":
			case "b":
				output.push(item.value * 2);
				break;

			case "c":
				output.push(...item.values.map(v => v + 1));
				break;

			default:
				output.push(item.value ? item.value : 0);
		}
	}

	return output.filter(Boolean).reduce((sum, v) => sum + v, 0);
}
`);
		index++;
	}

	return parts.join("");
}

/**
 * Builds a TypeScript source text of roughly the requested size.
 * @param targetBytes How large the result should be, approximately.
 * @returns The generated source text.
 */
export function typescriptFixture(targetBytes) {
	const parts = ["export {};\n"];
	let index = 0;

	while (parts.join("").length < targetBytes) {
		parts.push(`
interface Shape${index}<T extends object = Record<string, unknown>> {
	readonly id: number;
	name?: string;
	values: Array<T | null>;
	handler(event: { type: string; payload: T }): void | Promise<void>;
	[key: \`data-\${string}\`]: unknown;
}

type Keys${index}<T> = { readonly [K in keyof T as \`get\${string & K}\`]-?: () => T[K] };

type Unwrap${index}<T> = T extends Promise<infer U> ? U : T extends Array<infer V> ? V : never;

export enum Mode${index} {
	Off = 0,
	On = 1,
	Auto = "auto",
}

declare class Base${index} {
	constructor(...args: unknown[]);
	protected tag?: string;
}

export abstract class Service${index}<T extends object>
	extends Base${index}
	implements Shape${index}<T>
{
	readonly id: number = ${index};
	name?: string;
	values: Array<T | null> = [];
	protected abstract create(): T;

	constructor(
		public readonly label: string,
		private options: Partial<Shape${index}<T>> = {},
		protected override tag?: string,
	) {
		super();
	}

	handler(event: { type: string; payload: T }): void {
		const cast = event.payload as unknown as Record<string, number>;
		const checked = cast satisfies Record<string, number>;

		this.values.push(checked as unknown as T);
	}

	find<K extends keyof T>(key: K): T[K] | undefined {
		return this.options.values?.[0]?.[key];
	}
}

export function isShape${index}(value: unknown): value is Shape${index} {
	return typeof value === "object" && value !== null && "id" in value;
}

export declare function overload${index}(input: string): number;

export namespace Helpers${index} {
	export const version: \`\${number}.\${number}\` = "1.0";
	export type Callback = (error: Error | null, value?: unknown) => void;
}
`);
		index++;
	}

	return parts.join("");
}

/**
 * Builds a JSX source text of roughly the requested size.
 * @param targetBytes How large the result should be, approximately.
 * @returns The generated source text.
 */
export function jsxFixture(targetBytes) {
	const parts = ["import { useState } from \"react\";\n"];
	let index = 0;

	while (parts.join("").length < targetBytes) {
		parts.push(`
export function Panel${index}({ items, title, onSelect }) {
	const [open, setOpen] = useState(false);

	return (
		<section className="panel panel-${index}" data-index={${index}} aria-label={title}>
			<header className="panel-header" onClick={() => setOpen(!open)}>
				<h2>{title} &mdash; {items.length} item{items.length === 1 ? "" : "s"}</h2>
				{open ? <Chevron.Up size={16} /> : <Chevron.Down size={16} />}
			</header>
			{open && (
				<ul className="panel-body">
					{items.map((item, i) => (
						<li key={item.id} className={i % 2 ? "odd" : "even"}>
							<button type="button" onClick={() => onSelect(item)} disabled={!item.enabled}>
								{item.label}
							</button>
							{item.note ? <small>{item.note}</small> : null}
						</li>
					))}
				</ul>
			)}
			<footer>
				<>
					Showing {items.length} of {items.total} &nbsp;
					<a href={\`/panel/\${${index}}\`} rel="noreferrer">details</a>
				</>
			</footer>
		</section>
	);
}
`);
		index++;
	}

	return parts.join("");
}
