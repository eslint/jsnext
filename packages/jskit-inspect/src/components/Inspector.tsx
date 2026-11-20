/**
 * @fileoverview The whole app: a code editor on the left, and the four
 * analyses of what it contains on the right. Everything runs in the
 * browser; there is no server round trip.
 *
 * The two sides follow each other. Selecting a row on the right highlights
 * the source it stands for, and moving the cursor on the left selects,
 * expands to, and scrolls to the row in the open tab that covers it most
 * tightly.
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import {
	inspect,
	type Inspection,
	type InspectionOptions,
} from "@/lib/inspect";
import { graphLabel } from "@/lib/flow-diagram";
import { isScopeEntity, locate } from "@/lib/tree-ranges";
import { typeAt } from "@/lib/type-hover";
import { CodeEditor } from "@/components/CodeEditor";
import { FlowDiagram } from "@/components/FlowDiagram";
import {
	TreeView,
	type Expansion,
	type SourceRange,
} from "@/components/TreeView";
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

/** The trees, by the name of the analysis each one shows. */
type PaneName = "ast" | "scopes" | "flow" | "types";

const PANE_NAMES: readonly PaneName[] = ["ast", "scopes", "flow", "types"];

/** The root row's name in each tree, which also starts every path in it. */
const ROOT_LABELS: Record<PaneName, string> = {
	ast: "Program",
	scopes: "scopes",
	flow: "flow",
	types: "types",
};

const NO_EXPANSION: Expansion = new Map();

/**
 * The node selected in one of the trees: which tree, which row, and the
 * source it covers. It belongs to the inspection it was made from, since
 * the next one's offsets describe different text. `fromEditor` marks a
 * selection that followed the cursor rather than a click in the tree.
 */
interface Selection {
	inspection: Inspection;
	pane: PaneName;
	path: string;
	range: SourceRange;
	fromEditor: boolean;
}

/** A row the open tree should scroll to, and a counter to ask again. */
interface Reveal {
	pane: PaneName;
	path: string;
	nonce: number;
}

/**
 * The last data each tree had, kept so that a program that briefly stops
 * parsing mid-edit leaves the trees in place, scrolled where they were,
 * rather than replacing them with an error.
 */
interface Shown {
	inspection: Inspection;
	data: Record<PaneName, unknown>;
}

/**
 * Carries each tree's data forward from the last inspection that had any.
 * @param inspection The new inspection.
 * @param previous The data shown before it, if any.
 * @returns The data to show now.
 */
function carryForward(inspection: Inspection, previous: Shown | null): Shown {
	const data = {} as Record<PaneName, unknown>;

	for (const name of PANE_NAMES) {
		data[name] = inspection[name].data ?? previous?.data[name] ?? null;
	}

	return { inspection, data };
}

/**
 * Marks rows expanded.
 * @param expansion The rows expanded or collapsed so far.
 * @param paths The rows to expand.
 * @returns The new expansion, or the old one when nothing changed.
 */
function expand(expansion: Expansion, paths: string[]): Expansion {
	if (paths.every(path => expansion.get(path) === true)) {
		return expansion;
	}

	const next = new Map(expansion);

	for (const path of paths) {
		next.set(path, true);
	}

	return next;
}

interface PaneProps {
	data: unknown;
	error: string | null;
	rootLabel: string;
	selectedPath?: string | null;
	onSelect?: (path: string | null, range: SourceRange | null) => void;
	expansion?: Expansion;
	onToggle?: (path: string, expanded: boolean) => void;
	reveal?: Reveal | null;
}

/**
 * One tab's body: the tree, the reason there is none, or both — the reason
 * above the last tree there was, dimmed and not selectable, since its
 * offsets describe text that has since changed.
 */
function Pane({
	data,
	error,
	rootLabel,
	selectedPath,
	onSelect,
	expansion = NO_EXPANSION,
	onToggle = () => {},
	reveal = null,
}: PaneProps): ReactNode {
	const stale = error !== null;

	return (
		<>
			{stale && (
				<div className="border-destructive/50 text-destructive bg-background sticky top-0 z-10 m-3 rounded-md border px-3 py-2 text-sm">
					{error}
				</div>
			)}
			{data !== null && (
				<div className={stale ? "px-3 pb-3 opacity-50" : "p-3"}>
					<TreeView
						data={data}
						rootLabel={rootLabel}
						selectedPath={stale ? null : selectedPath}
						onSelect={stale ? undefined : onSelect}
						expansion={expansion}
						onToggle={onToggle}
						reveal={stale ? null : reveal}
					/>
				</div>
			)}
		</>
	);
}

export default function Inspector(): ReactNode {
	const [code, setCode] = useState(DEFAULT_CODE);
	const [debouncedCode, setDebouncedCode] = useState(DEFAULT_CODE);
	const [sourceType, setSourceType] =
		useState<InspectionOptions["sourceType"]>("module");
	const [dialect, setDialect] = useState<InspectionOptions["dialect"]>("ts");
	const [jsx, setJsx] = useState(true);

	/** Which of the four tabs is open. */
	const [tab, setTab] = useState<PaneName>("ast");

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

	/*
	 * The rows expanded or collapsed in each tree. They are held here, by
	 * path, rather than in the rows, so that they survive what unmounts a
	 * tree: switching tabs, or an edit that stops the program parsing.
	 * Paths are positional, so an edit that adds a statement shifts which
	 * one is open below it — but the shape of the tree, and the reader's
	 * place in it, stays put.
	 */
	const [expansions, setExpansions] = useState<Record<PaneName, Expansion>>(
		() => ({
			ast: NO_EXPANSION,
			scopes: NO_EXPANSION,
			flow: NO_EXPANSION,
			types: NO_EXPANSION,
		}),
	);

	/** The row the open tree should scroll to next. */
	const [reveal, setReveal] = useState<Reveal | null>(null);

	/*
	 * Where the user last put the cursor. A fresh object every time, so
	 * clicking the same spot twice still counts as a move.
	 */
	const [cursor, setCursor] = useState<{ offset: number } | null>(null);

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedCode(code), DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [code]);

	const inspection = useMemo(
		() => inspect(debouncedCode, { sourceType, dialect, jsx }),
		[debouncedCode, sourceType, dialect, jsx],
	);

	/*
	 * Updated during render rather than in an effect, so the trees never
	 * show a frame without data between one inspection and the next.
	 */
	const [shown, setShown] = useState<Shown>(() =>
		carryForward(inspection, null),
	);

	if (shown.inspection !== inspection) {
		setShown(carryForward(inspection, shown));
	}

	/*
	 * An edit can leave the program with fewer units than it had, so the
	 * chosen one is picked here rather than taken at its word: deleting
	 * the function being looked at falls back to the program.
	 */
	const units = inspection.flow.data?.graphs ?? [];
	const unit = flowUnit < units.length ? flowUnit : 0;

	/*
	 * One selection across all the trees, so the editor highlights
	 * whichever node was picked last. A selection from an earlier
	 * inspection is ignored rather than cleared, which drops it the moment
	 * the analyses rerun without an effect to do so.
	 */
	const [rawSelection, setSelection] = useState<Selection | null>(null);
	const selection =
		rawSelection?.inspection === inspection ? rawSelection : null;

	/*
	 * The analyses describe the debounced text, so between a keystroke and
	 * the rerun their offsets point at the wrong characters; the tooltip
	 * and the cursor following stay off until the two agree again.
	 */
	const inSync = code === debouncedCode;
	const typeTree = inspection.types.data;
	const lookUpType = useCallback(
		(offset: number) =>
			typeTree === null ? null : typeAt(typeTree, offset),
		[typeTree],
	);

	/*
	 * The tree the cursor is followed into: the open tab's, unless the
	 * open tab is showing the flow diagram, which has no rows.
	 */
	const followPane: PaneName | null =
		tab === "flow" && flowView !== "tree" ? null : tab;

	/*
	 * Follows the cursor into the open tree: selects the row that covers
	 * it most tightly, expands everything down to it, and scrolls to it.
	 * It runs again when the tab changes, so the tree just opened catches
	 * up, and when a debounced edit produces a new inspection, so the
	 * selection follows the cursor through typing.
	 */
	useEffect(() => {
		if (cursor === null || followPane === null || !inSync) {
			return;
		}

		const data = inspection[followPane].data;
		const found =
			data === null
				? null
				: locate(
						data,
						ROOT_LABELS[followPane],
						cursor.offset,
						followPane === "scopes" ? isScopeEntity : undefined,
					);

		if (found === null) {
			setSelection(null);
			return;
		}

		setSelection({
			inspection,
			pane: followPane,
			path: found.path,
			range: found.range,
			fromEditor: true,
		});
		setExpansions(current => ({
			...current,
			[followPane]: expand(current[followPane], [
				...found.ancestors,
				found.path,
			]),
		}));
		setReveal(current => ({
			pane: followPane,
			path: found.path,
			nonce: (current?.nonce ?? 0) + 1,
		}));
	}, [cursor, followPane, inspection, inSync]);

	/**
	 * Wires one tree into the shared selection and expansion state.
	 * @param pane The tree's name.
	 * @returns The props that tree's pane takes.
	 */
	function paneProps(pane: PaneName): PaneProps {
		return {
			data: shown.data[pane],
			error: inspection[pane].error,
			rootLabel: ROOT_LABELS[pane],
			selectedPath: selection?.pane === pane ? selection.path : null,
			onSelect: (path, range) =>
				setSelection(
					path === null || range === null
						? null
						: {
								inspection,
								pane,
								path,
								range,
								fromEditor: false,
							},
				),
			expansion: expansions[pane],
			onToggle: (path, expanded) =>
				setExpansions(current => {
					const next = new Map(current[pane]);

					next.set(path, expanded);

					return { ...current, [pane]: next };
				}),
			reveal: reveal?.pane === pane ? reveal : null,
		};
	}

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
						highlight={selection?.range ?? null}
						scrollToHighlight={selection?.fromEditor !== true}
						typeAt={inSync ? lookUpType : null}
						onChange={setCode}
						onCursorChange={offset => setCursor({ offset })}
					/>
				</section>
				<section
					aria-label="Analysis"
					className="flex min-h-0 flex-1 basis-1/2 flex-col"
				>
					<Tabs
						value={tab}
						onValueChange={value => setTab(value as PaneName)}
						className="min-h-0 flex-1 gap-0"
					>
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
							<Pane {...paneProps("ast")} />
						</TabsContent>
						<TabsContent
							value="scopes"
							className="min-h-0 overflow-auto"
						>
							<Pane {...paneProps("scopes")} />
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
									<Pane {...paneProps("flow")} />
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
							<Pane {...paneProps("types")} />
						</TabsContent>
					</Tabs>
				</section>
			</main>
		</div>
	);
}
