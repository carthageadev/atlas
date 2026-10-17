import type { SortMode } from "../lib/roms";
import { type Facet, type Scope, type SystemIndex, scopeLabel } from "../lib/systems";
import { Chip } from "./SystemPicker";

const SORTS: { mode: SortMode; label: string }[] = [
	{ mode: "best", label: "best match" },
	{ mode: "az", label: "a-z" },
	{ mode: "size", label: "largest" },
	{ mode: "added", label: "newest" },
];

interface Props {
	scope: Scope | null;
	facets: Facet[];
	index: SystemIndex;
	sort: SortMode;
	hasTerms: boolean;
	onScope: (scope: Scope | null) => void;
	onSort: (mode: SortMode) => void;
}

export function FilterBar({ scope, facets, index, sort, hasTerms, onScope, onSort }: Props) {
	const activeSort = sort === "best" && !hasTerms ? "az" : sort;
	const showFacets = facets.length > 1;

	return (
		<div className="mb-5 space-y-4">
			{scope || showFacets ? (
				<div className="flex flex-wrap items-center gap-2">
					{scope ? (
						<button
							className="border border-acc/60 px-2.5 py-1 text-[11px] text-acc transition-colors hover:border-acc"
							onClick={() => onScope(null)}
							title="show every system"
							type="button"
						>
							{scope.console ? `${scope.company} / ${scopeLabel(scope, index)}` : scope.company}
							<span className="ml-2 text-acc-dim">x</span>
						</button>
					) : null}
					{scope?.console ? <Chip label={`all ${scope.company}`} onClick={() => onScope({ company: scope.company, console: "" })} /> : null}
					{showFacets ? facets.map((facet) => <Chip count={facet.count} key={`${facet.scope.company}/${facet.scope.console}`} label={facet.label} onClick={() => onScope(facet.scope)} />) : null}
				</div>
			) : null}

			<div className="flex items-center gap-5 text-[10px] uppercase tracking-[0.12em]">
				<span className="text-neutral-700">sort</span>
				{SORTS.filter((option) => hasTerms || option.mode !== "best").map((option) => (
					<button
						className={`transition-colors hover:text-acc ${activeSort === option.mode ? "text-acc" : "text-neutral-500"}`}
						key={option.mode}
						onClick={() => onSort(option.mode)}
						type="button"
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}
