/**
 * @fileoverview A collapsible tree over any JSON-serializable value, plus
 * the two non-JSON values an ESTree AST actually contains: `RegExp` (a
 * regular expression literal's `value`) and `bigint` (a bigint literal's).
 *
 * Any object that stands for a stretch of the source — an AST node, the
 * `{ type, start, end }` reference the scope, flow, and type trees use for
 * one, or a scope, variable, or reference by the node it names (see
 * `rangeOf()`) — can be selected so the editor can highlight that stretch.
 *
 * Which rows are expanded is held by the caller, keyed by path, so it
 * outlives the tree: switching tabs, or a parse error that briefly takes
 * the tree away, leaves it where it was.
 */

import { useEffect, useRef, type ReactNode } from "react";
import {
	entriesOf,
	isExpandable,
	rangeOf,
	type SourceRange,
} from "@/lib/tree-ranges";
import { cn } from "@/lib/utils";

export type { SourceRange } from "@/lib/tree-ranges";

/** How many levels start expanded. */
export const DEFAULT_EXPANDED_DEPTH = 2;

/** How far each level indents, in pixels. */
const INDENT = 16;

/** The rows a user has expanded or collapsed, by path. */
export type Expansion = ReadonlyMap<string, boolean>;

export interface TreeViewProps {
	/** The value to render. */
	data: unknown;

	/** The name of the root entry. */
	rootLabel?: string;

	/** The path of the selected row, or `null` when none in this tree is. */
	selectedPath?: string | null;

	/**
	 * Called when a row with a source range is selected, or with `null`
	 * for both when the selected row is clicked again. Without it, no row
	 * is selectable.
	 */
	onSelect?: (path: string | null, range: SourceRange | null) => void;

	/**
	 * The rows expanded or collapsed by hand; a row missing from it is
	 * expanded when it is shallower than `DEFAULT_EXPANDED_DEPTH`.
	 */
	expansion: Expansion;

	/** Called when a row's chevron is clicked. */
	onToggle: (path: string, expanded: boolean) => void;

	/**
	 * A row to scroll into view. It is scrolled to whenever `nonce`
	 * changes, so asking for the same row twice scrolls twice.
	 */
	reveal?: { path: string; nonce: number } | null;
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
 * `type`, a scope by its `type`, a variable or reference by its `name`, a
 * recorded type by its `text`, a typed node entry by its node's `type`, an
 * array by its length, and anything else by an ellipsis.
 * @param value The expandable value.
 * @returns The one-line summary.
 */
function summarize(value: object): string {
	if (Array.isArray(value)) {
		return `[${value.length}]`;
	}

	const { type, name, text, node } = value as Record<string, unknown>;

	if (typeof type === "string") {
		return type;
	}

	if (typeof name === "string") {
		return JSON.stringify(name);
	}

	if (typeof text === "string") {
		return JSON.stringify(text);
	}

	const nodeType =
		typeof node === "object" && node !== null
			? (node as Record<string, unknown>).type
			: null;

	return typeof nodeType === "string" ? nodeType : "{…}";
}

/**
 * Finds the element that scrolls an element: its nearest ancestor that
 * lets its content overflow, or the document's.
 * @param element The element.
 * @returns The scrolling element.
 */
function scrollParentOf(element: Element): Element {
	for (
		let current = element.parentElement;
		current !== null;
		current = current.parentElement
	) {
		const { overflowY } = getComputedStyle(current);

		if (overflowY === "auto" || overflowY === "scroll") {
			return current;
		}
	}

	return document.scrollingElement ?? document.documentElement;
}

interface TreeNodeProps {
	name: string;
	value: unknown;
	depth: number;
	path: string;
	selectedPath: string | null;
	onSelect: TreeViewProps["onSelect"];
	expansion: Expansion;
	onToggle: TreeViewProps["onToggle"];
}

function TreeNode({
	name,
	value,
	depth,
	path,
	selectedPath,
	onSelect,
	expansion,
	onToggle,
}: TreeNodeProps): ReactNode {
	const expandable = isExpandable(value);
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

	const expanded = expansion.get(path) ?? depth < DEFAULT_EXPANDED_DEPTH;
	const toggle = (): void => onToggle(path, !expanded);
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
		<div data-path={path}>
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
						expansion={expansion}
						onToggle={onToggle}
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
	expansion,
	onToggle,
	reveal = null,
}: TreeViewProps): ReactNode {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const revealPath = reveal?.path ?? null;
	const revealNonce = reveal?.nonce ?? 0;

	/*
	 * Runs after the commit that expanded the row's ancestors, so the row
	 * is in the document by now. Its first child is the row's own line
	 * rather than its subtree, which is the part worth bringing into view.
	 * A line already in view is left where it is, so moving the cursor
	 * between nearby nodes does not jolt the tree; one out of view is
	 * centered, which leaves room for the children it was expanded to show.
	 */
	useEffect(() => {
		if (revealPath === null) {
			return;
		}

		const row = containerRef.current?.querySelector(
			`[data-path="${CSS.escape(revealPath)}"]`,
		);
		const line = row?.firstElementChild ?? row;

		if (line === null || line === undefined) {
			return;
		}

		/*
		 * Scrolled by hand rather than with `scrollIntoView()`, which would
		 * scroll every ancestor on both axes — the page included.
		 */
		const scroller = scrollParentOf(line);
		const viewport = scroller.getBoundingClientRect();
		const bounds = line.getBoundingClientRect();

		if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
			scroller.scrollTop +=
				bounds.top -
				viewport.top -
				(viewport.height - bounds.height) / 2;
		}
	}, [revealPath, revealNonce]);

	return (
		<div ref={containerRef} className="font-mono text-[13px]">
			<TreeNode
				name={rootLabel}
				value={data}
				depth={0}
				path={rootLabel}
				selectedPath={selectedPath}
				onSelect={onSelect}
				expansion={expansion}
				onToggle={onToggle}
			/>
		</div>
	);
}
