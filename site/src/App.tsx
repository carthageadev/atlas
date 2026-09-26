import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Dossier } from "./components/Dossier";
import { BigLogo, MiniLogo } from "./components/Logo";
import { ResultItem } from "./components/ResultItem";
import { SearchBar } from "./components/SearchBar";
import { loadRomIndex, type RomEntry, type RomSearchResult, searchRoms } from "./lib/roms";

const MAX_RESULTS = 80;

function initialQuery() {
	try {
		return new URLSearchParams(window.location.search).get("q") ?? "";
	} catch {
		return "";
	}
}

function emptyResult(): RomSearchResult {
	return { hits: [], parsed: { text: "", terms: [], tokens: [], platforms: [], companies: [] }, ms: 0 };
}

export default function App() {
	const [query, setQuery] = useState(initialQuery);
	const [deferredQuery, setDeferredQuery] = useState(initialQuery);
	const [roms, setRoms] = useState<RomEntry[]>([]);
	const [dataSource, setDataSource] = useState("waiting for index");
	const [status, setStatus] = useState("connecting to data index");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const [open, setOpen] = useState<RomEntry | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
	const keyboardMove = useRef(false);

	useEffect(() => {
		let cancelled = false;
		loadRomIndex((message) => {
			if (!cancelled) setStatus(message);
		})
			.then((index) => {
				if (cancelled) return;
				setRoms(index.roms);
				setDataSource(index.source === "cache" ? "cached data loaded - no new index update" : "new data fetched from source");
				setStatus("index ready - data loaded");
			})
			.catch((error: unknown) => {
				if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => setDeferredQuery(query), 140);
		return () => window.clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		setSelected(0);
	}, [deferredQuery]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			const url = new URL(window.location.href);
			if (deferredQuery.trim()) url.searchParams.set("q", deferredQuery.trim());
			else url.searchParams.delete("q");
			window.history.replaceState(null, "", url.toString());
			document.title = deferredQuery.trim() ? `${deferredQuery.trim()} - atlas` : "atlas";
		}, 180);
		return () => window.clearTimeout(timer);
	}, [deferredQuery]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const result = useMemo(() => {
		if (!deferredQuery.trim() || roms.length === 0) return emptyResult();
		return searchRoms(roms, deferredQuery);
	}, [deferredQuery, roms]);
	const hits = result.hits;
	const visibleHits = hits.slice(0, MAX_RESULTS);
	const current = visibleHits[selected]?.rom ?? null;

	const openRom = useCallback((rom: RomEntry) => {
		setOpen(rom);
		const request = document.createElement("iframe");
		request.src = rom.url;
		request.title = `download ${rom.id}`;
		request.setAttribute("aria-hidden", "true");
		request.style.display = "none";
		document.body.appendChild(request);
		window.setTimeout(() => request.remove(), 30000);
	}, []);

	useEffect(() => {
		if (!keyboardMove.current) return;
		itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
		keyboardMove.current = false;
	}, [selected]);

	const move = useCallback((amount: number) => {
		if (!visibleHits.length) return;
		keyboardMove.current = true;
		setSelected((index) => (index + amount + visibleHits.length) % visibleHits.length);
	}, [visibleHits.length]);

	const clear = () => {
		setQuery("");
		setOpen(null);
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			move(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			move(-1);
		} else if (event.key === "Enter" && current) {
			openRom(current);
		} else if (event.key === "Escape") {
			if (query) clear();
			else inputRef.current?.blur();
		}
	};

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (open) {
				if (event.key === "Escape") setOpen(null);
				return;
			}
			if (document.activeElement === inputRef.current) return;
			if (event.key === "/" || (event.key === "k" && (event.ctrlKey || event.metaKey))) {
				event.preventDefault();
				inputRef.current?.focus();
			} else if (event.key === "j" || event.key === "ArrowDown") {
				event.preventDefault();
				move(1);
			} else if (event.key === "k" || event.key === "ArrowUp") {
				event.preventDefault();
				move(-1);
			} else if (event.key === "Enter" && current) {
				openRom(current);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [current, move, open, openRom]);

	const active = query.trim().length > 0;
	return (
		<div className="atmosphere min-h-screen">
			<header className={`z-20 transition-[padding,background-color] duration-150 ease-out ${active ? "sticky top-0 bg-[#0c0d0b]/90 py-4 backdrop-blur-md" : "relative pt-[22vh] sm:pt-[24vh]"}`}>
				<div className="mx-auto max-w-3xl px-5 sm:px-8">
					<div className={`grid transition-[grid-template-rows,opacity] duration-150 ease-out ${active ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
						<div className="overflow-hidden">
							<div className="flex flex-col items-center pb-14">
								<BigLogo />
								<p className="mt-8 text-[11px] tracking-[0.12em] text-neutral-600">a shared game index</p>
							</div>
						</div>
					</div>

					<div className="flex items-center gap-7">
						<div className={`overflow-hidden transition-[width,opacity] duration-150 ease-out ${active ? "w-[50px] opacity-100" : "w-0 opacity-0"}`}><MiniLogo onClick={clear} /></div>
						<SearchBar active={active} inputRef={inputRef} onChange={setQuery} onKeyDown={onInputKeyDown} value={query} />
					</div>

				</div>
			</header>

			{loadError ? (
				<main className="mx-auto max-w-3xl px-5 py-20 sm:px-8">
					<div className="border-y border-red-300/20 py-8">
						<p className="text-[12px] text-red-200">Could not load the shared index.</p>
						<p className="mt-2 break-words text-[11px] leading-5 text-neutral-600">{loadError}</p>
						<button className="mt-6 border-b border-neutral-600 pb-1 text-[11px] text-neutral-400 transition-colors hover:border-acc hover:text-acc" onClick={() => window.location.reload()} type="button">retry ↗</button>
					</div>
				</main>
			) : null}

			{!loadError && active && (
				<main className="fade-in mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-8">
					<div className="mb-4 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-neutral-600">
						<span>{roms.length ? `${hits.length.toLocaleString()} ${hits.length === 1 ? "match" : "matches"}` : status}</span>
						<span className="hidden sm:inline">{roms.length && hits.length > MAX_RESULTS ? `showing first ${MAX_RESULTS} / ` : ""}up/down to select / enter to open</span>
					</div>

					{roms.length === 0 ? (
						<div className="border-t border-neutral-900 py-14"><p className="text-[13px] text-neutral-400">Loading the data index...</p></div>
					) : hits.length ? (
						<ul className="border-t border-neutral-900" key={deferredQuery}>
							{visibleHits.map((hit, index) => <ResultItem hit={hit} index={index} key={hit.rom.id} onHover={() => setSelected(index)} onOpen={() => openRom(hit.rom)} ref={(element) => { itemRefs.current[index] = element; }} selected={selected === index} />)}
						</ul>
					) : (
						<div className="border-t border-neutral-900 py-14">
							<p className="text-[13px] text-neutral-400">No games found in the shared index.</p>
							<p className="mt-3 text-[11px] text-neutral-700">Try a title, p:n64, c:nintendo, or y:199x.</p>
						</div>
					)}
				</main>
			)}

			{!loadError && (
				<footer className="fixed inset-x-0 bottom-5 px-5 text-center text-[9px] uppercase tracking-[0.16em] text-neutral-800">
					{status} - {dataSource} - source: http://92.35.124.13
				</footer>
			)}

			{open && (
				<div className="fade-in fixed inset-0 z-50 overflow-y-auto bg-black/80 px-5 py-10 backdrop-blur-sm sm:py-16" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
					<div className="dialog-in relative mx-auto max-w-2xl border-y border-neutral-700 bg-[#0c0d0b] px-1 py-10 sm:px-10 sm:py-12">
						<button className="absolute right-1 top-4 text-[10px] uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:text-acc sm:right-10" onClick={() => setOpen(null)} type="button">esc / close</button>
						<Dossier rom={open} />
					</div>
				</div>
			)}
		</div>
	);
}
