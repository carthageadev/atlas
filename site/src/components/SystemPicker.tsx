import { useMemo, useState } from "react";
import { POPULAR, type Scope, type System, type SystemIndex } from "../lib/systems";

const MAKERS_SHOWN = 14;

export function Chip({ label, count, onClick, title, strong }: { label: string; count?: number; onClick: () => void; title?: string; strong?: boolean }) {
	return (
		<button
			className={`border px-2.5 py-1 text-[11px] transition-colors hover:border-acc hover:text-acc ${strong ? "border-neutral-700 text-neutral-200" : "border-neutral-800 text-neutral-400"}`}
			onClick={onClick}
			title={title}
			type="button"
		>
			{label}
			{count !== undefined ? <span className="ml-2 tabular-nums text-neutral-700">{count.toLocaleString()}</span> : null}
		</button>
	);
}

function Heading({ children }: { children: string }) {
	return <h2 className="mb-3 text-[10px] uppercase tracking-[0.16em] text-neutral-600">{children}</h2>;
}

interface Props {
	index: SystemIndex;
	onPick: (scope: Scope) => void;
}

export function SystemPicker({ index, onPick }: Props) {
	const [expanded, setExpanded] = useState(false);

	const popular = useMemo(
		() => POPULAR.map((key) => index.byKey.get(key)).filter((system): system is System => Boolean(system)),
		[index],
	);
	const groups = useMemo(() => {
		const byMaker = new Map<string, System[]>();
		for (const system of index.systems) {
			if (!system.console) continue;
			byMaker.set(system.company, [...(byMaker.get(system.company) ?? []), system]);
		}
		for (const list of byMaker.values()) list.sort((a, b) => a.label.localeCompare(b.label));
		return [...index.makers].sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: "base" })).map((maker) => ({ ...maker, systems: byMaker.get(maker.company) ?? [] }));
	}, [index]);

	const pick = (system: System) => onPick({ company: system.company, console: system.console });

	return (
		<section className="fade-in mx-auto max-w-3xl px-5 pb-28 pt-4 sm:px-8">
			<Heading>popular systems</Heading>
			<div className="flex flex-wrap gap-2">
				{popular.map((system) => <Chip count={system.count} key={system.key} label={system.label} onClick={() => pick(system)} title={system.key} />)}
			</div>

			<div className="mt-9">
				<Heading>makers</Heading>
				<div className="flex flex-wrap gap-2">
					{index.makers.slice(0, MAKERS_SHOWN).map((maker) => <Chip count={maker.count} key={maker.company} label={maker.company} onClick={() => onPick({ company: maker.company, console: "" })} />)}
					<button className="px-2.5 py-1 text-[11px] text-neutral-500 transition-colors hover:text-acc" onClick={() => setExpanded((value) => !value)} type="button">
						{expanded ? "hide all systems" : `all ${index.systems.length} systems`}
					</button>
				</div>
			</div>

			{expanded ? (
				<div className="mt-9 space-y-6 border-t border-neutral-900 pt-7">
					{groups.map((group) => (
						<div key={group.company}>
							<div className="mb-2"><Chip count={group.count} label={group.company} onClick={() => onPick({ company: group.company, console: "" })} strong /></div>
							{group.systems.length > 1 ? (
								<div className="flex flex-wrap gap-2 pl-4">
									{group.systems.map((system) => <Chip count={system.count} key={system.key} label={system.label} onClick={() => pick(system)} title={system.key} />)}
								</div>
							) : null}
						</div>
					))}
				</div>
			) : null}
		</section>
	);
}
