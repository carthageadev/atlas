import { forwardRef } from "react";
import type { RomHit } from "../lib/roms";
import { Highlight } from "./Highlight";

interface Props {
	hit: RomHit;
	index: number;
	selected: boolean;
	onHover: () => void;
	onOpen: () => void;
}

export const ResultItem = forwardRef<HTMLLIElement, Props>(function ResultItem(
	{ hit, index, selected, onHover, onOpen },
	ref,
) {
	const { rom } = hit;
	return (
		<li className="rise border-b border-neutral-900" ref={ref} style={{ animationDelay: `${Math.min(index, 16) * 16}ms` }}>
			<button className="group grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 py-4 text-left sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]" onClick={onOpen} onFocus={onHover} onMouseMove={onHover} type="button">
				<span className={`text-[11px] tabular-nums ${selected ? "text-acc" : "text-neutral-700"}`}>{selected ? ">" : String(index + 1).padStart(2, "0")}</span>
				<span className="min-w-0">
					<span className={`block truncate text-[14px] sm:text-[15px] ${selected ? "text-white" : "text-neutral-300"}`}><Highlight hl={hit.hl} text={rom.title} /></span>
					<span className="mt-1 block truncate text-[11px] text-neutral-600">
						{rom.company || "unknown maker"} / {rom.console || "unknown system"}
						{hit.metaHits.has("company") ? <span className="ml-2 text-acc-dim">company</span> : null}
						{hit.metaHits.has("console") ? <span className="ml-2 text-acc-dim">system</span> : null}
					</span>
				</span>
				<span className="pl-3 text-right text-[10px] uppercase tracking-[0.1em] text-neutral-500 sm:text-[11px]">
					<span className={hit.metaHits.has("year") ? "text-acc" : "text-neutral-500"}>{rom.date?.slice(-4) ?? "—"}</span>
					<span className="mx-2 text-neutral-800">/</span>
					<span>{rom.size || "—"}</span>
				</span>
			</button>
		</li>
	);
});
