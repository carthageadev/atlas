import { useState } from "react";
import { crc32 } from "../lib/hash";
import type { RomEntry } from "../lib/roms";

function Datum({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-[10px] uppercase tracking-[0.14em] text-neutral-600">{label}</dt>
			<dd className="mt-1 text-[13px] text-neutral-300">{value}</dd>
		</div>
	);
}

export function Dossier({ rom }: { rom: RomEntry }) {
	const [copied, setCopied] = useState(false);
	const copyUrl = () => {
		navigator.clipboard?.writeText(rom.url).catch(() => {});
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1200);
	};

	return (
		<article>
			<p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">roms.tn / index record</p>
			<h2 className="mt-8 max-w-xl text-2xl leading-snug tracking-[-0.03em] text-neutral-100 sm:text-3xl">{rom.title}</h2>
			<p className="mt-3 break-all text-[12px] text-acc-dim">{rom.url}</p>

			<dl className="mt-9 grid grid-cols-2 gap-x-8 gap-y-7 border-y border-neutral-800 py-7 sm:grid-cols-3">
				<Datum label="system" value={rom.console || "unknown"} />
				<Datum label="maker" value={rom.company || "unknown"} />
				<Datum label="size" value={rom.size || "—"} />
				<Datum label="date" value={rom.date || "—"} />
				<Datum label="path" value={rom.folder} />
				<Datum label="record id" value={crc32(rom.id)} />
			</dl>

			<div className="mt-8 flex flex-wrap items-center gap-5">
				<a className="border-b border-neutral-600 pb-1 text-[11px] text-neutral-400 transition-colors hover:border-acc hover:text-acc" download href={rom.url}>download raw ↗</a>
				<button className="border-b border-neutral-600 pb-1 text-[11px] text-neutral-400 transition-colors hover:border-acc hover:text-acc" onClick={copyUrl} type="button">{copied ? "copied" : "copy url"}</button>
			</div>
		</article>
	);
}
