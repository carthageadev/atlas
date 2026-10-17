import { describe, expect, test } from "bun:test";
import { type RomEntry, searchRoms, sizeBytes } from "../src/lib/roms";
import { buildFacets, buildSystemIndex, hasSystemAlias, inScope, parseScope, platformMatches, scopeKey, scopeLabel } from "../src/lib/systems";

function rom(company: string, console: string, title: string, size = "1 MB", date = "2026-01-01"): RomEntry {
	const folder = console ? `/${company}/${console}` : `/${company}`;
	const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
	return {
		id: `${folder}/${title}.7z`,
		title,
		company,
		console,
		folder,
		size,
		date,
		searchText: fold(`${title} ${company} ${console} ${folder}`),
	};
}

const PSP = "PlayStation Portable";
const roms = [
	rom("SONY", PSP, "Legend of Zelda Clone", "1.43 GB", "2026-03-01"),
	rom("SONY", PSP, "Patapon", "300 MB", "2026-05-01"),
	rom("SONY", PSP, "Echochrome", "1,009.91 KB", "2026-04-01"),
	rom("SONY", "PlayStation", "Zelda Clone Racing"),
	rom("SONY", "PlayStation", "Crash Bandicoot"),
	rom("Nintendo", "Wii", "Wii Sports"),
	rom("Nintendo", "Wii U", "Wii Party U"),
	rom("Nintendo", "DS", "Zelda Phantom Hourglass"),
	rom("Nintendo", "3DS", "Zelda A Link Between Worlds"),
	rom("Nintendo", "Pokémon Mini", "Pichu Bros"),
	rom("ColecoVision", "", "Donkey Kong"),
];
const index = buildSystemIndex(roms);

describe("scope", () => {
	test("round trips through a key", () => {
		const scope = parseScope("SONY/PlayStation Portable");
		expect(scope).toEqual({ company: "SONY", console: PSP });
		expect(scope && scopeKey(scope)).toBe("SONY/PlayStation Portable");
		expect(parseScope("SONY")).toEqual({ company: "SONY", console: "" });
		expect(parseScope("")).toBeNull();
		expect(parseScope(null)).toBeNull();
	});

	test("a system does not leak into a similarly named one", () => {
		const wii = { company: "Nintendo", console: "Wii" };
		expect(inScope(roms[5], wii)).toBe(true);
		expect(inScope(roms[6], wii)).toBe(false);
		expect(inScope(roms[0], { company: "SONY", console: "" })).toBe(true);
	});
});

describe("system index", () => {
	test("uses short labels and counts every system", () => {
		const psp = index.byKey.get(`SONY/${PSP}`);
		expect(psp?.label).toBe("PSP");
		expect(psp?.count).toBe(3);
		expect(index.makers.find((maker) => maker.company === "SONY")?.count).toBe(5);
		expect(index.makers.find((maker) => maker.company === "Nintendo")?.count).toBe(5);
	});

	test("a maker with no system is its own system", () => {
		expect(index.byKey.get("ColecoVision")?.label).toBe("ColecoVision");
	});

	test("repeated names get the maker as a prefix", () => {
		const shared = buildSystemIndex([rom("A", "Misc", "x"), rom("B", "Misc", "y")]);
		expect(shared.systems.map((system) => system.label).sort()).toEqual(["A Misc", "B Misc"]);
	});

	test("a curated label wins a name clash, the other one gets the maker", () => {
		const clash = buildSystemIndex([rom("Arcade", "MAME", "x"), rom("Other", "MAME", "y")]);
		expect(clash.byKey.get("Arcade/MAME")?.label).toBe("MAME");
		expect(clash.byKey.get("Other/MAME")?.label).toBe("Other MAME");
	});

	test("labels fall back to the source name", () => {
		expect(scopeLabel({ company: "Nintendo", console: "Pokémon Mini" }, index)).toBe("Pokémon Mini");
		expect(scopeLabel({ company: "SONY", console: "" }, index)).toBe("SONY");
	});

	test("facets count per system and skip them inside one system", () => {
		const facets = buildFacets(roms, null, index);
		expect(facets[0].label).toBe("PSP");
		expect(facets.find((facet) => facet.label === "Wii")?.count).toBe(1);
		expect(buildFacets(roms, { company: "SONY", console: PSP }, index)).toEqual([]);
	});
});

describe("aliases and the p: filter", () => {
	test("short names point at one system", () => {
		expect(hasSystemAlias(roms[0], "psp")).toBe(true);
		expect(hasSystemAlias(roms[3], "psp")).toBe(false);
		expect(hasSystemAlias(roms[3], "ps1")).toBe(true);
	});

	test("exact names win over substrings", () => {
		expect(platformMatches(roms[7], "ds")).toBe(true);
		expect(platformMatches(roms[8], "ds")).toBe(false);
		expect(platformMatches(roms[3], "ps1")).toBe(true);
		expect(platformMatches(roms[0], "ps1")).toBe(false);
	});

	test("longer values still match as a substring", () => {
		expect(platformMatches(roms[0], "playstation")).toBe(true);
		expect(platformMatches(roms[3], "playstation")).toBe(true);
		expect(platformMatches(roms[5], "playstation")).toBe(false);
	});

	test("accents are ignored", () => {
		expect(platformMatches(roms[9], "pokemon mini")).toBe(true);
	});
});

describe("search", () => {
	const titles = (query: string, options = {}) => searchRoms(roms, query, options).hits.map((hit) => hit.rom.title);

	test("a short system name finds that system", () => {
		const found = titles("psp");
		expect(found).toHaveLength(3);
		expect(found).not.toContain("Crash Bandicoot");
	});

	test("a short system name narrows a title search", () => {
		expect(titles("psp zelda")).toEqual(["Legend of Zelda Clone"]);
	});

	test("p: works with the short name", () => {
		expect(titles("p:psp")).toHaveLength(3);
		expect(titles("p:psp patapon")).toEqual(["Patapon"]);
	});

	test("a scope with no text lists the whole system", () => {
		expect(titles("", { scope: { company: "SONY", console: PSP } })).toEqual(["Echochrome", "Legend of Zelda Clone", "Patapon"]);
	});

	test("scope and text combine", () => {
		expect(titles("zelda", { scope: { company: "SONY", console: "" } })).toEqual(["Zelda Clone Racing", "Legend of Zelda Clone"]);
	});

	test("a maker scope covers all its systems", () => {
		expect(titles("", { scope: { company: "Nintendo", console: "" } })).toHaveLength(5);
	});

	test("sorting by size puts the largest first", () => {
		const scope = { company: "SONY", console: PSP };
		expect(titles("", { scope, sort: "size" })).toEqual(["Legend of Zelda Clone", "Patapon", "Echochrome"]);
	});

	test("sorting by date puts the newest first", () => {
		const scope = { company: "SONY", console: PSP };
		expect(titles("", { scope, sort: "added" })).toEqual(["Patapon", "Echochrome", "Legend of Zelda Clone"]);
	});

	test("best match still ranks exact titles first", () => {
		expect(titles("patapon")[0]).toBe("Patapon");
	});

	test("accent free search finds accented systems", () => {
		expect(titles("pokemon")).toEqual(["Pichu Bros"]);
	});
});

describe("sizeBytes", () => {
	test("reads units and thousands separators", () => {
		expect(sizeBytes("512 B")).toBe(512);
		expect(sizeBytes("1 KB")).toBe(1024);
		expect(sizeBytes("1,009.91 KB")).toBeCloseTo(1009.91 * 1024);
		expect(sizeBytes("1.5 GB")).toBe(1.5 * 1024 ** 3);
		expect(sizeBytes(undefined)).toBe(0);
		expect(sizeBytes("")).toBe(0);
	});
});
