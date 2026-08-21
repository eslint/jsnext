/**
 * @fileoverview A collapsible tree over any JSON-serializable value, plus
 * the two non-JSON values an ESTree AST actually contains: `RegExp` (a
 * regular expression literal's `value`) and `bigint` (a bigint literal's).
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How many levels start expanded. */
const DEFAULT_EXPANDED_DEPTH = 2;

/** How far each level indents, in pixels. */
const INDENT = 16;

export interface TreeViewProps {
	/** The value to render. */
	data: unknown;

	/** The name of the root entry. */
	rootLabel?: string;
}

/**
 * Decides whether a value gets a chevron and children of its own.
 * @param value The value to test.
 * @returns `true` for arrays and plain-ish objects with at least one entry.
 */
function isExpandable(value: unknown): value is object {
	if (
		typeof value !== "object" ||
		value === null ||
		value instanceof RegExp
	) {
		return false;
	}

	return Array.isArray(value)
		? value.length > 0
		: Object.keys(value).length > 0;
}

/**
 * Renders a primitive the way a JSON viewer would, colored by type.
 * @param value The value to render.
 * @returns The rendered value.
 */
function Primitive({ value }: { value: unknown }): ReactNode {
	if (value === null) {
		return <span className="text-muted-foreground italic">null</span>;
	}

	switch (typeof value) {
		case "string":
			return (
				<span className="text-emerald-700 dark:text-emerald-400">
					{JSON.stringify(value)}
				</span>
			);
		case "number":
			return (
				<span className="text-sky-700 dark:text-sky-400">
					{String(value)}
				</span>
			);
		case "bigint":
			return (
				<span className="text-sky-700 dark:text-sky-400">
					{String(value)}n
				</span>
			);
		case "boolean":
			return (
				<span className="text-purple-700 dark:text-purple-400">
					{String(value)}
				</span>
			);
		case "undefined":
			return (
				<span className="text-muted-foreground italic">undefined</span>
			);
		default:
			if (value instanceof RegExp) {
				return (
					<span className="text-rose-700 dark:text-rose-400">
						{String(value)}
					</span>
				);
			}

			// An empty array or object; the expandable ones never reach here.
			return (
				<span className="text-muted-foreground">
					{Array.isArray(value) ? "[]" : "{}"}
				</span>
			);
	}
}

/**
 * Summarizes an expandable value for its header row: an AST node by its
 * `type`, a scope by its `type`, an array by its length, and anything else
 * by an ellipsis.
 * @param value The expandable value.
 * @returns The one-word summary.
 */
function summarize(value: object): string {
	if (Array.isArray(value)) {
		return `[${value.length}]`;
	}

	const type = (value as Record<string, unknown>).type;

	return typeof type === "string" ? type : "{…}";
}

/**
 * The entries of an object or array, in insertion order.
 * @param value The expandable value.
 * @returns The name/value pairs to render.
 */
function entriesOf(value: object): [string, unknown][] {
	return Array.isArray(value)
		? value.map((item, index): [string, unknown] => [String(index), item])
		: Object.entries(value);
}

interface TreeNodeProps {
	name: string;
	value: unknown;
	depth: number;
}

function TreeNode({ name, value, depth }: TreeNodeProps): ReactNode {
	const expandable = isExpandable(value);
	const [expanded, setExpanded] = useState(depth < DEFAULT_EXPANDED_DEPTH);
	const indent = { paddingLeft: `${depth * INDENT}px` };

	if (!expandable) {
		return (
			<div
				className="flex items-start gap-1 py-px leading-6"
				style={indent}
			>
				<span className="w-4 shrink-0" />
				<span className="text-foreground/80">{name}:</span>
				<Primitive value={value} />
			</div>
		);
	}

	return (
		<div>
			<button
				type="button"
				aria-expanded={expanded}
				className="hover:bg-accent flex w-full items-start gap-1 rounded-sm py-px text-left leading-6"
				style={indent}
				onClick={() => setExpanded(current => !current)}
			>
				<span
					className={cn(
						"text-muted-foreground w-4 shrink-0 text-center transition-transform",
						expanded && "rotate-90",
					)}
				>
					<svg
						viewBox="0 0 16 16"
						width="10"
						height="10"
						className="inline fill-current"
						aria-hidden="true"
					>
						<path d="M6 3l6 5-6 5z" />
					</svg>
				</span>
				<span className="text-foreground/80">{name}:</span>
				<span className="text-muted-foreground">
					{summarize(value)}
				</span>
			</button>
			{expanded &&
				entriesOf(value).map(([childName, childValue]) => (
					<TreeNode
						key={childName}
						name={childName}
						value={childValue}
						depth={depth + 1}
					/>
				))}
		</div>
	);
}

/**
 * Renders a serialized analysis result as an expandable tree.
 */
export function TreeView({
	data,
	rootLabel = "root",
}: TreeViewProps): ReactNode {
	return (
		<div className="font-mono text-[13px]">
			<TreeNode name={rootLabel} value={data} depth={0} />
		</div>
	);
}
