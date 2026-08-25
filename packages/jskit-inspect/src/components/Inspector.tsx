/**
 * @fileoverview The whole app: a code editor on the left, and the four
 * analyses of what it contains on the right. Everything runs in the
 * browser; there is no server round trip.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { inspect, type InspectionOptions } from "@/lib/inspect";
import { graphLabel } from "@/lib/flow-diagram";
import { CodeEditor } from "@/components/CodeEditor";
import { FlowDiagram } from "@/components/FlowDiagram";
import { TreeView } from "@/components/TreeView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** How long the editor can be idle before the analyses rerun. */
const DEBOUNCE_MS = 200;

const DEFAULT_CODE = `interface Point {
	x: number;
	y: number;
}

function distance(a: Point, b: Point): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt(dx * dx + dy * dy);
}

export function farthest(origin: Point, points: Point[]): Point | null {
	let best = null;
	let bestDistance = -1;

	for (const point of points) {
		const d = distance(origin, point);

		if (d > bestDistance) {
			best = point;
			bestDistance = d;
		}
	}

	return best;
}
`;

const SELECT_CLASS =
	"border-input bg-background h-8 rounded-md border px-2 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

interface PaneProps {
	data: unknown;
	error: string | null;
	rootLabel: string;
}

/**
 * One tab's body: the tree, or the reason there is none.
 */
function Pane({ data, error, rootLabel }: PaneProps): ReactNode {
	if (error !== null) {
		return (
			<div className="border-destructive/50 text-destructive m-3 rounded-md border px-3 py-2 text-sm">
				{error}
			</div>
		);
	}

	return (
		<div className="p-3">
			<TreeView data={data} rootLabel={rootLabel} />
		</div>
	);
}

export default function Inspector(): ReactNode {
	const [code, setCode] = useState(DEFAULT_CODE);
	const [debouncedCode, setDebouncedCode] = useState(DEFAULT_CODE);
	const [sourceType, setSourceType] =
		useState<InspectionOptions["sourceType"]>("module");
	const [dialect, setDialect] = useState<InspectionOptions["dialect"]>("ts");
	const [jsx, setJsx] = useState(true);

	/*
	 * Which of the control flow tab's two views is showing. It is held
	 * here rather than in the tab itself so that leaving the tab and
	 * coming back returns to the view that was open.
	 */
	const [flowView, setFlowView] = useState("tree");

	/*
	 * Which execution unit the diagram is drawing, by its position in the
	 * flow tree. Held here for the same reason, and clamped below rather
	 * than reset on every edit, so that typing inside a function does not
	 * throw the view back to the program.
	 */
	const [flowUnit, setFlowUnit] = useState(0);

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedCode(code), DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [code]);

	const inspection = useMemo(
		() => inspect(debouncedCode, { sourceType, dialect, jsx }),
		[debouncedCode, sourceType, dialect, jsx],
	);

	/*
	 * An edit can leave the program with fewer units than it had, so the
	 * chosen one is picked here rather than taken at its word: deleting
	 * the function being looked at falls back to the program.
	 */
	const units = inspection.flow.data?.graphs ?? [];
	const unit = flowUnit < units.length ? flowUnit : 0;

	return (
		<div className="flex h-full flex-col">
			<header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
				<div className="flex items-baseline gap-3">
					<h1 className="text-base font-semibold">jskit-inspect</h1>
					<p className="text-muted-foreground hidden text-sm sm:block">
						parse · scope · flow · types
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-4 text-sm">
					<label className="flex items-center gap-2">
						<span className="text-muted-foreground">
							Source type
						</span>
						<select
							className={SELECT_CLASS}
							value={sourceType}
							onChange={event =>
								setSourceType(
									event.target
										.value as InspectionOptions["sourceType"],
								)
							}
						>
							<option value="module">module</option>
							<option value="script">script</option>
							<option value="commonjs">commonjs</option>
						</select>
					</label>
					<label className="flex items-center gap-2">
						<span className="text-muted-foreground">Dialect</span>
						<select
							className={SELECT_CLASS}
							value={dialect}
							onChange={event =>
								setDialect(
									event.target
										.value as InspectionOptions["dialect"],
								)
							}
						>
							<option value="ts">TypeScript</option>
							<option value="js">JavaScript</option>
						</select>
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							className="accent-primary size-4"
							checked={jsx}
							onChange={event => setJsx(event.target.checked)}
						/>
						<span className="text-muted-foreground">JSX</span>
					</label>
				</div>
			</header>
			<main className="flex min-h-0 flex-1 flex-col md:flex-row">
				<section
					aria-label="Code editor"
					className="min-h-0 flex-1 basis-1/2 border-b md:border-r md:border-b-0"
				>
					<CodeEditor
						key={`${dialect}-${jsx}`}
						value={code}
						typescript={dialect === "ts"}
						jsx={jsx}
						onChange={setCode}
					/>
				</section>
				<section
					aria-label="Analysis"
					className="flex min-h-0 flex-1 basis-1/2 flex-col"
				>
					<Tabs defaultValue="ast" className="min-h-0 flex-1 gap-0">
						<div className="border-b px-3 py-2">
							<TabsList>
								<TabsTrigger value="ast">AST</TabsTrigger>
								<TabsTrigger value="scopes">Scopes</TabsTrigger>
								<TabsTrigger value="flow">
									Control flow
								</TabsTrigger>
								<TabsTrigger value="types">Types</TabsTrigger>
							</TabsList>
						</div>
						{inspection.validationErrors.length > 0 && (
							<div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
								{inspection.validationErrors.map(problem => (
									<div
										key={`${problem.lineNumber}:${problem.column}:${problem.message}`}
									>
										{problem.lineNumber}:{problem.column}{" "}
										{problem.message}
									</div>
								))}
							</div>
						)}
						<TabsContent
							value="ast"
							className="min-h-0 overflow-auto"
						>
							<Pane
								data={inspection.ast.data}
								error={inspection.ast.error}
								rootLabel="Program"
							/>
						</TabsContent>
						<TabsContent
							value="scopes"
							className="min-h-0 overflow-auto"
						>
							<Pane
								data={inspection.scopes.data}
								error={inspection.scopes.error}
								rootLabel="scopes"
							/>
						</TabsContent>
						<TabsContent
							value="flow"
							className="flex min-h-0 flex-col"
						>
							<Tabs
								value={flowView}
								onValueChange={setFlowView}
								className="min-h-0 flex-1 gap-0"
							>
								<div className="flex flex-wrap items-center gap-3 px-3 py-2">
									<TabsList>
										<TabsTrigger value="tree">
											Tree
										</TabsTrigger>
										<TabsTrigger value="diagram">
											Diagram
										</TabsTrigger>
									</TabsList>
									{flowView === "diagram" &&
										units.length > 0 && (
											<label className="flex min-w-0 items-center gap-2 text-sm">
												<span className="text-muted-foreground">
													Execution unit
												</span>
												<select
													className={`${SELECT_CLASS} w-[22rem] max-w-full font-mono text-xs`}
													value={unit}
													onChange={event =>
														setFlowUnit(
															Number(
																event.target
																	.value,
															),
														)
													}
												>
													{units.map(
														(graph, index) => (
															<option
																key={
																	graph.graphId
																}
																value={index}
															>
																{graphLabel(
																	graph,
																	debouncedCode,
																)}
															</option>
														),
													)}
												</select>
											</label>
										)}
								</div>
								<TabsContent
									value="tree"
									className="min-h-0 overflow-auto"
								>
									<Pane
										data={inspection.flow.data}
										error={inspection.flow.error}
										rootLabel="flow"
									/>
								</TabsContent>
								<TabsContent
									value="diagram"
									className="min-h-0 overflow-auto"
								>
									{units.length === 0 ? (
										<Pane
											data={null}
											error={
												inspection.flow.error ??
												"There is no control flow graph to draw."
											}
											rootLabel="flow"
										/>
									) : (
										<FlowDiagram
											graph={units[unit]}
											source={debouncedCode}
										/>
									)}
								</TabsContent>
							</Tabs>
						</TabsContent>
						<TabsContent
							value="types"
							className="min-h-0 overflow-auto"
						>
							<Pane
								data={inspection.types.data}
								error={inspection.types.error}
								rootLabel="types"
							/>
						</TabsContent>
					</Tabs>
				</section>
			</main>
		</div>
	);
}
