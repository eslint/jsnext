/**
 * @fileoverview The CodeMirror 6 editor pane. The view is created once per
 * language configuration; the parent remounts it (via `key`) when the
 * dialect or JSX setting changes, carrying the document over through the
 * `value` prop.
 */

import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, type ReactNode } from "react";

export interface CodeEditorProps {
	/** The document to start from. Later external changes are synced in. */
	value: string;

	/** Whether to highlight TypeScript syntax. */
	typescript: boolean;

	/** Whether to highlight JSX syntax. */
	jsx: boolean;

	/** Called with the full document on every edit. */
	onChange: (value: string) => void;
}

export function CodeEditor({
	value,
	typescript,
	jsx,
	onChange,
}: CodeEditorProps): ReactNode {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);

	onChangeRef.current = onChange;

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

	return (
		<div
			ref={containerRef}
			className="h-full min-h-0 overflow-hidden text-sm"
		/>
	);
}
