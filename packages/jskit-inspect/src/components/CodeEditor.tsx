/**
 * @fileoverview The CodeMirror 6 editor pane. The view is created once per
 * language configuration; the parent remounts it (via `key`) when the
 * dialect or JSX setting changes, carrying the document over through the
 * `value` prop.
 *
 * The `highlight` prop marks one stretch of the document: the source range
 * of whatever node is selected in a tree on the right. The `typeAt` prop
 * answers the hover tooltip, which shows the type recorded for the
 * identifier or expression under the pointer.
 */

import { javascript } from "@codemirror/lang-javascript";
import { StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, hoverTooltip, type DecorationSet } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, type ReactNode } from "react";
import type { SourceRange } from "@/components/TreeView";
import type { TypeHover } from "@/lib/type-hover";

/** Replaces the highlighted range, or clears it with `null`. */
const setHighlight = StateEffect.define<SourceRange | null>();

const highlightMark = Decoration.mark({ class: "cm-jskit-highlight" });

/**
 * The highlighted range. It is mapped through edits, so it stays on the
 * same text while typing until the next analysis replaces or clears it.
 */
const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, transaction) {
		let next = decorations.map(transaction.changes);

		for (const effect of transaction.effects) {
			if (effect.is(setHighlight)) {
				next = Decoration.none;

				if (effect.value !== null) {
					const length = transaction.state.doc.length;
					const from = Math.min(effect.value.start, length);
					const to = Math.min(effect.value.end, length);

					if (from < to) {
						next = Decoration.set(highlightMark.range(from, to));
					}
				}
			}
		}

		return next;
	},
	provide: field => EditorView.decorations.from(field),
});

const highlightTheme = EditorView.baseTheme({
	".cm-jskit-highlight": {
		backgroundColor: "rgba(245, 158, 11, 0.25)",
		outline: "1px solid rgba(245, 158, 11, 0.6)",
		borderRadius: "2px",
	},
	".cm-jskit-type": {
		display: "flex",
		alignItems: "baseline",
		gap: "0.75em",
		padding: "2px 8px",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		fontSize: "12px",
	},
	".cm-jskit-type-id": {
		opacity: "0.6",
	},
});

/**
 * Builds a tooltip's contents.
 * @param hover What the tooltip reports.
 * @returns The element to show.
 */
function renderTypeTooltip(hover: TypeHover): HTMLElement {
	const dom = document.createElement("div");
	const text = document.createElement("span");
	const id = document.createElement("span");

	dom.className = "cm-jskit-type";
	text.textContent = hover.text;
	id.className = "cm-jskit-type-id";
	id.textContent = `type ${hover.typeId}`;
	dom.append(text, id);

	return dom;
}

export interface CodeEditorProps {
	/** The document to start from. Later external changes are synced in. */
	value: string;

	/** Whether to highlight TypeScript syntax. */
	typescript: boolean;

	/** Whether to highlight JSX syntax. */
	jsx: boolean;

	/** The range to highlight, or `null` for none. */
	highlight?: SourceRange | null;

	/**
	 * Looks up the type recorded at an offset, for the hover tooltip, or
	 * `null` while there is no type data that matches the document.
	 */
	typeAt?: ((offset: number) => TypeHover | null) | null;

	/** Called with the full document on every edit. */
	onChange: (value: string) => void;
}

export function CodeEditor({
	value,
	typescript,
	jsx,
	highlight = null,
	typeAt = null,
	onChange,
}: CodeEditorProps): ReactNode {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);

	const typeAtRef = useRef(typeAt);

	onChangeRef.current = onChange;
	typeAtRef.current = typeAt;

	useEffect(() => {
		const parent = containerRef.current;

		if (parent === null) {
			return undefined;
		}

		const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		const view = new EditorView({
			doc: value,
			parent,
			extensions: [
				basicSetup,
				javascript({ typescript, jsx }),
				dark ? oneDark : [],
				highlightField,
				highlightTheme,
				hoverTooltip((_view, pos, side) => {
					const hover = typeAtRef.current?.(side < 0 ? pos - 1 : pos);

					return hover
						? {
								pos: hover.start,
								end: hover.end,
								above: true,
								create: () => ({
									dom: renderTypeTooltip(hover),
								}),
							}
						: null;
				}),
				EditorView.updateListener.of(update => {
					if (update.docChanged) {
						onChangeRef.current(update.state.doc.toString());
					}
				}),
			],
		});

		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// The document is intentionally not a dependency: edits come from
		// the view itself, and recreating it on every keystroke would drop
		// the cursor.
	}, [typescript, jsx]);

	// An external replacement of the document (not an echo of an edit).
	useEffect(() => {
		const view = viewRef.current;

		if (view !== null && view.state.doc.toString() !== value) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value },
			});
		}
	}, [value]);

	/*
	 * Depends on the view's own dependencies too, so a view recreated for
	 * a new language configuration picks the highlight back up.
	 */
	useEffect(() => {
		const view = viewRef.current;

		if (view === null) {
			return;
		}

		const effects: StateEffect<unknown>[] = [setHighlight.of(highlight)];

		if (highlight !== null) {
			effects.push(
				EditorView.scrollIntoView(
					Math.min(highlight.start, view.state.doc.length),
					{ y: "nearest" },
				),
			);
		}

		view.dispatch({ effects });
	}, [highlight, typescript, jsx]);

	return (
		<div
			ref={containerRef}
			className="h-full min-h-0 overflow-hidden text-sm"
		/>
	);
}
