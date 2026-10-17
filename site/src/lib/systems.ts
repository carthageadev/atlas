import type { RomEntry } from "./roms";

/** A maker, or one system of a maker. An empty console means the whole maker. */
export interface Scope {
	company: string;
	console: string;
}

export interface System {
	key: string;
	company: string;
	console: string;
	label: string;
	count: number;
}

export interface Maker {
	company: string;
	count: number;
}

export interface SystemIndex {
	systems: System[];
	byKey: Map<string, System>;
	makers: Maker[];
}

interface Known {
	label: string;
	aliases?: string[];
}

// Keyed by "<maker>/<system>" exactly as the source names them. Anything not
// listed here still works, it just uses the source name and no short aliases.
const KNOWN: Record<string, Known> = {
	"Nintendo/Famicom": { label: "NES", aliases: ["nes", "fc"] },
	"Nintendo/Super Famicom": { label: "SNES", aliases: ["snes", "sfc", "super nes", "super nintendo"] },
	"Nintendo/Nintendo 64": { label: "N64", aliases: ["n64"] },
	"Nintendo/GameCube": { label: "GameCube", aliases: ["gc", "gcn", "ngc"] },
	"Nintendo/Wii": { label: "Wii" },
	"Nintendo/Wii U": { label: "Wii U", aliases: ["wiiu"] },
	"Nintendo/Game Boy": { label: "Game Boy", aliases: ["gb", "gameboy"] },
	"Nintendo/Game Boy Color": { label: "Game Boy Color", aliases: ["gbc"] },
	"Nintendo/Game Boy Advance": { label: "Game Boy Advance", aliases: ["gba"] },
	"Nintendo/DS": { label: "DS", aliases: ["nds", "ds"] },
	"Nintendo/3DS": { label: "3DS", aliases: ["n3ds"] },
	"Nintendo/Virtual Boy": { label: "Virtual Boy", aliases: ["vb"] },
	"Nintendo/Pokémon Mini": { label: "Pokémon Mini", aliases: ["pokemini"] },
	"Nintendo/Game & Watch": { label: "Game & Watch", aliases: ["gw", "gnw"] },
	"SONY/PlayStation": { label: "PlayStation", aliases: ["ps1", "psx", "psone"] },
	"SONY/PlayStation 2": { label: "PS2", aliases: ["ps2"] },
	"SONY/PlayStation 3 (T-En)": { label: "PS3", aliases: ["ps3"] },
	"SONY/PlayStation Portable": { label: "PSP", aliases: ["psp"] },
	"SEGA/Genesis": { label: "Genesis", aliases: ["md", "megadrive", "mega drive"] },
	"SEGA/Master System": { label: "Master System", aliases: ["sms"] },
	"SEGA/Game Gear": { label: "Game Gear", aliases: ["gg"] },
	"SEGA/Saturn": { label: "Saturn", aliases: ["sat"] },
	"SEGA/DreamCast": { label: "Dreamcast", aliases: ["dc"] },
	"SEGA/SG-1000": { label: "SG-1000", aliases: ["sg1000"] },
	"Microsoft/Xbox": { label: "Xbox" },
	"Microsoft/Xbox 360": { label: "Xbox 360", aliases: ["x360"] },
	"NEC/PC-Engine": { label: "PC Engine", aliases: ["pce", "tg16", "turbografx", "pc engine"] },
	"NEC/PC-Engine CD": { label: "PC Engine CD", aliases: ["pcecd", "tgcd", "pc engine cd"] },
	"NEC/PC-FX": { label: "PC-FX", aliases: ["pcfx"] },
	"SNK/NeoGeo Pocket": { label: "Neo Geo Pocket", aliases: ["ngp"] },
	"SNK/NeoGeo Pocket Color": { label: "Neo Geo Pocket Color", aliases: ["ngpc"] },
	"SNK/NeoGeo CD": { label: "Neo Geo CD", aliases: ["neocd", "ngcd"] },
	"Atari/2600": { label: "Atari 2600", aliases: ["a2600", "vcs"] },
	"Atari/5200": { label: "Atari 5200", aliases: ["a5200"] },
	"Atari/7800": { label: "Atari 7800", aliases: ["a7800"] },
	"Atari/800": { label: "Atari 800" },
	"Atari/Lynx": { label: "Lynx" },
	"Atari/Jaguar": { label: "Jaguar" },
	"Atari/ST": { label: "Atari ST" },
	"Commodore/64": { label: "Commodore 64", aliases: ["c64"] },
	"Commodore/Amiga": { label: "Amiga" },
	"Commodore/Amiga CD32": { label: "Amiga CD32", aliases: ["cd32"] },
	"Commodore/VIC-20": { label: "VIC-20", aliases: ["vic20"] },
	"Bandai/WonderSwan": { label: "WonderSwan", aliases: ["ws"] },
	"Bandai/WonderSwan Color": { label: "WonderSwan Color", aliases: ["wsc"] },
	"Apple/Macintosh": { label: "Macintosh", aliases: ["mac"] },
	"Arcade/MAME": { label: "MAME" },
	"Arcade/FBNeo": { label: "FBNeo", aliases: ["fba", "finalburn"] },
	"Philips/CD-i": { label: "CD-i", aliases: ["cdi"] },
	"Panasonic - 3DO": { label: "3DO", aliases: ["3do"] },
	"Sinclair - ZX Spectrum +3": { label: "ZX Spectrum", aliases: ["zx", "zxs", "spectrum"] },
	"GCE - Vectrex": { label: "Vectrex" },
	"Magnavox - Odyssey 2": { label: "Odyssey 2" },
	"Amstrad - CPC": { label: "Amstrad CPC" },
	"ColecoVision": { label: "ColecoVision" },
};

// Shown first on the landing page, in this order, when present in the index.
export const POPULAR = [
	"Nintendo/Famicom",
	"Nintendo/Super Famicom",
	"Nintendo/Nintendo 64",
	"Nintendo/GameCube",
	"Nintendo/Wii",
	"Nintendo/Wii U",
	"Nintendo/Game Boy",
	"Nintendo/Game Boy Color",
	"Nintendo/Game Boy Advance",
	"Nintendo/DS",
	"Nintendo/3DS",
	"SEGA/Genesis",
	"SEGA/Master System",
	"SEGA/Game Gear",
	"SEGA/Saturn",
	"SEGA/DreamCast",
	"SONY/PlayStation",
	"SONY/PlayStation Portable",
	"SONY/PlayStation 2",
	"Microsoft/Xbox",
	"NEC/PC-Engine",
	"Atari/2600",
	"Arcade/MAME",
	"Arcade/FBNeo",
];

export function fold(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

export function systemKey(rom: Pick<RomEntry, "company" | "console">): string {
	return rom.console ? `${rom.company}/${rom.console}` : rom.company;
}

export function scopeKey(scope: Scope): string {
	return scope.console ? `${scope.company}/${scope.console}` : scope.company;
}

export function parseScope(value: string | null | undefined): Scope | null {
	if (!value) return null;
	const cut = value.indexOf("/");
	const company = cut < 0 ? value : value.slice(0, cut);
	if (!company) return null;
	return { company, console: cut < 0 ? "" : value.slice(cut + 1) };
}

export function inScope(rom: Pick<RomEntry, "company" | "console">, scope: Scope): boolean {
	return rom.company === scope.company && (!scope.console || rom.console === scope.console);
}

export function knownLabel(key: string): string | null {
	return KNOWN[key]?.label ?? null;
}

interface Aliases {
	/** Short names that are not part of the searchable text, such as "psp". */
	soft: Set<string>;
	/** Every name a system answers to, used by the p: filter. */
	all: Set<string>;
}

const aliasCache = new Map<string, Aliases>();

function aliasesFor(company: string, consoleName: string): Aliases {
	const key = consoleName ? `${company}/${consoleName}` : company;
	let found = aliasCache.get(key);
	if (!found) {
		const known = KNOWN[key];
		const soft = new Set((known?.aliases ?? []).map(fold));
		const all = new Set(soft);
		for (const name of [consoleName || company, known?.label ?? ""]) {
			if (!name) continue;
			const folded = fold(name);
			all.add(folded);
			all.add(folded.replace(/[\s-]+/g, ""));
		}
		found = { soft, all };
		aliasCache.set(key, found);
	}
	return found;
}

/** True when `term` is a short name for the rom's system, for example "psp". */
export function hasSystemAlias(rom: Pick<RomEntry, "company" | "console">, term: string): boolean {
	return aliasesFor(rom.company, rom.console).soft.has(term);
}

/** The p: filter. Exact names and aliases first, plain substrings for longer values. */
export function platformMatches(rom: Pick<RomEntry, "company" | "console">, value: string): boolean {
	const { all } = aliasesFor(rom.company, rom.console);
	if (all.has(value)) return true;
	if (value.length < 3) return false;
	return fold(rom.console).includes(value) || fold(rom.company).includes(value);
}

export function buildSystemIndex(roms: Pick<RomEntry, "company" | "console">[]): SystemIndex {
	const counts = new Map<string, System>();
	const totals = new Map<string, number>();
	for (const rom of roms) {
		const key = systemKey(rom);
		const system = counts.get(key);
		if (system) system.count++;
		else counts.set(key, { key, company: rom.company, console: rom.console, label: "", count: 1 });
		totals.set(rom.company, (totals.get(rom.company) ?? 0) + 1);
	}

	const systems = [...counts.values()];
	const rawLabel = (system: System) => KNOWN[system.key]?.label ?? (system.console || system.company);
	const labelUses = new Map<string, number>();
	for (const system of systems) {
		const label = rawLabel(system);
		labelUses.set(label, (labelUses.get(label) ?? 0) + 1);
	}
	for (const system of systems) {
		const label = rawLabel(system);
		const curated = system.key in KNOWN;
		system.label = !curated && (labelUses.get(label) ?? 0) > 1 ? `${system.company} ${label}` : label;
		if (!system.console) system.count = totals.get(system.company) ?? system.count;
	}
	systems.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

	const makers = [...totals.entries()]
		.map(([company, count]) => ({ company, count }))
		.sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
	return { systems, byKey: new Map(systems.map((system) => [system.key, system])), makers };
}

export function scopeLabel(scope: Scope, index?: SystemIndex): string {
	if (!scope.console) return scope.company;
	const system = index?.byKey.get(scopeKey(scope));
	return system?.label ?? knownLabel(scopeKey(scope)) ?? scope.console;
}

export interface Facet {
	scope: Scope;
	label: string;
	count: number;
}

/** Counts per system (or per system inside one maker) for the current results. */
export function buildFacets(
	roms: Pick<RomEntry, "company" | "console">[],
	scope: Scope | null,
	index: SystemIndex,
	limit = 14,
): Facet[] {
	if (scope?.console) return [];
	const counts = new Map<string, number>();
	for (const rom of roms) {
		const key = systemKey(rom);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const facets: Facet[] = [];
	for (const [key, count] of counts) {
		const system = index.byKey.get(key);
		if (!system) continue;
		facets.push({ scope: { company: system.company, console: system.console }, label: system.label, count });
	}
	facets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	return facets.slice(0, limit);
}
