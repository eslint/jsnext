/**
 * @fileoverview The control flow tab's second view: the graph the tree
 * shows, drawn as a Mermaid flowchart.
 *
 * Mermaid is loaded on demand rather than with the page, because it is by
 * far the largest thing this app could ship and the diagram is one view of
 * one tab. That import lands in a chunk of its own, so a visit that never
 * opens the diagram never pays for it.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FlowTreeGraph } from "@eslint/jskit";
import { toFlowDiagram } from "@/lib/flow-diagram";

/**
 * Mermaid renders into an element it makes from an id it is given, so
 * every render needs one no other render is using. Numbering them is
 * enough: the ids never outlive the call.
 */
let renderCount = 0;

/**
 * Follows the color scheme the page is being viewed in, so the diagram is
 * drawn in the same one the rest of the app is.
 * @returns `true` while the viewer prefers a dark scheme.
 */
function usePrefersDark(): boolean {
	const [dark, setDark] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const update = (): void => setDark(query.matches);

		update();
		query.addEventListener("change", update);

		return () => query.removeEventListener("change", update);
	}, []);

	return dark;
}

export interface FlowDiagramProps {
	/** The execution unit to draw. */
	graph: FlowTreeGraph;

	/** The program the graph was built from. */
	source: string;
}

/**
 * Draws one execution unit's control flow graph as a flowchart.
 */
export function FlowDiagram({ graph, source }: FlowDiagramProps): ReactNode {
	const diagram = useMemo(
		() => toFlowDiagram(graph, source),
		[graph, source],
	);
	const dark = usePrefersDark();
	const [svg, setSvg] = useState("");
	const [error, setError] = useState<string | null>(null);
	const { definition } = diagram;

	useEffect(() => {
		if (definition === null) {
			return undefined;
		}

		let current = true;

		void (async () => {
			try {
				const { default: mermaid } = await import("mermaid");

				mermaid.initialize({
					startOnLoad: false,
					theme: dark ? "dark" : "neutral",
					securityLevel: "strict",
					maxEdges: 2000,
					flowchart: { useMaxWidth: false },
				});

				const rendered = await mermaid.render(
					`flow-diagram-${++renderCount}`,
					definition,
				);

				if (current) {
					setSvg(rendered.svg);
					setError(null);
				}
			} catch (thrown) {
				if (current) {
					setSvg("");
					setError(
						thrown instanceof Error
							? thrown.message
							: String(thrown),
					);
				}
			}
		})();

		return () => {
			current = false;
		};
	}, [definition, dark]);

	if (definition === null) {
		return (
			<div className="text-muted-foreground m-3 rounded-md border px-3 py-2 text-sm">
				This execution unit has {diagram.blockCount} basic blocks, more
				than the {diagram.limit} a readable diagram holds. The tree view
				shows all of them.
			</div>
		);
	}

	if (error !== null) {
		return (
			<div className="border-destructive/50 text-destructive m-3 rounded-md border px-3 py-2 text-sm">
				{error}
			</div>
		);
	}

	if (svg === "") {
		return (
			<div className="text-muted-foreground p-3 text-sm">Drawing…</div>
		);
	}

	/*
	 * Mermaid hands back a finished SVG string rather than anything React
	 * can render, so there is nothing to do but insert it. It is built
	 * from the definition above, whose every label is escaped, and drawn
	 * with Mermaid's own sanitizer at its strictest.
	 */
	return (
		<div className="w-max p-3" dangerouslySetInnerHTML={{ __html: svg }} />
	);
}
