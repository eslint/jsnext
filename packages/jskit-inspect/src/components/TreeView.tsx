/**
 * @fileoverview A collapsible tree over any JSON-serializable value, plus
 * the two non-JSON values an ESTree AST actually contains: `RegExp` (a
 * regular expression literal's `value`) and `bigint` (a bigint literal's).
 *
 * Any object with numeric `start` and `end` stands for a stretch of the
 * source — an AST node, or the `{ type, start, end }` reference the scope,
 * flow, and type trees use for one — and its row can be selected so the
 * editor can highlight that stretch.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How many levels start expanded. */
const DEFAULT_EXPANDED_DEPTH = 2;

/** How far each level indents, in pixels. */
const INDENT = 16;

/** A stretch of the source, as UTF-16 offsets. */
export interface SourceRange {
	start: number;
	end: number;
}

export interface TreeViewProps {
	/** The value to render. */
	data: unknown;

	/** The name of the root entry. */
	rootLabel?: string;

	/** The path of the selected row, or `null` when none in this tree is. */
	selectedPath?: string | null;

	/**
	 * Called when a row with a source range is selected, or with `null`
	 * for both when the selected row is clicked again.
	 */
	onSelect?: (path: string | null, range: SourceRange | null) => void;
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
 * Reads the source range an object stands for.
 * @param value The value to test.
 * @returns The range, or `null` when the value has none.
 */
function rangeOf(value: object): SourceRange | null {
	const { start, end } = value as Record<string, unknown>;

	return typeof start === "number" && typeof end === "number"
		? { start, end }
		: null;
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
	path: string;
	selectedPath: string | null;
	onSelect: TreeViewProps["onSelect"];
}

function TreeNode({
	name,
	value,
	depth,
	path,
	selectedPath,
	onSelect,
}: TreeNodeProps): ReactNode {
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

	const toggle = (): void => setExpanded(current => !current);
	const range = onSelect === undefined ? null : rangeOf(value);
	const selected = range !== null && path === selectedPath;

	/*
	 * A row that stands for source text selects on click and leaves
	 * expanding to its chevron; every other row expands on click, as all
	 * of them did before rows could be selected.
	 */
	const label = (
		<>
			<span className="text-foreground/80">{name}:</span>
			<span className="text-muted-foreground">{summarize(value)}</span>
		</>
	);
	const chevron = (
		<svg
			viewBox="0 0 16 16"
			width="10"
			height="10"
			className={cn(
				"inline fill-current transition-transform",
				expanded && "rotate-90",
			)}
			aria-hidden="true"
		>
			<path d="M6 3l6 5-6 5z" />
		</svg>
	);

	return (
		<div>
			{range === null ? (
				<button
					type="button"
					aria-expanded={expanded}
					className="hover:bg-accent flex w-full items-start gap-1 rounded-sm py-px text-left leading-6"
					style={indent}
					onClick={toggle}
				>
					<span className="text-muted-foreground w-4 shrink-0 text-center">
						{chevron}
					</span>
					{label}
				</button>
			) : (
				<div
					className={cn(
						"flex w-full items-start gap-1 rounded-sm py-px leading-6",
						selected ? "bg-amber-500/20" : "hover:bg-accent",
					)}
					style={indent}
				>
					<button
						type="button"
						aria-expanded={expanded}
						aria-label={expanded ? "Collapse" : "Expand"}
						className="text-muted-foreground w-4 shrink-0 text-center"
						onClick={toggle}
					>
						{chevron}
					</button>
					<button
						type="button"
						aria-pressed={selected}
						title={`${range.start}–${range.end}`}
						className="flex min-w-0 flex-1 items-start gap-1 text-left"
						onClick={() =>
							selected
								? onSelect?.(null, null)
								: onSelect?.(path, range)
						}
					>
						{label}
					</button>
				</div>
			)}
			{expanded &&
				entriesOf(value).map(([childName, childValue]) => (
					<TreeNode
						key={childName}
						name={childName}
						value={childValue}
						depth={depth + 1}
						path={`${path}.${childName}`}
						selectedPath={selectedPath}
						onSelect={onSelect}
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
	selectedPath = null,
	onSelect,
}: TreeViewProps): ReactNode {
	return (
		<div className="font-mono text-[13px]">
			<TreeNode
				name={rootLabel}
				value={data}
				depth={0}
				path={rootLabel}
				selectedPath={selectedPath}
				onSelect={onSelect}
			/>
		</div>
	);
}
