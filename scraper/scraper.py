#!/usr/bin/env python3
"""
ROMs Index Scraper - IP-based
Crawls https://92.35.124.13 directly (no DNS, no cert verify) for Nintendo + SEGA
Outputs: data/roms.json.gz (gzip max, mtime=0) + data/meta.json only
"""
import json
import time
import re
import sys
from pathlib import Path
from urllib.parse import unquote, quote
import requests
from bs4 import BeautifulSoup
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://92.35.124.13"
# Expanded scope - common consoles + arcade (MAME, Neo Geo, etc.)
TARGET_ROOTS = [
    "/Nintendo",
    "/SEGA",
    "/SONY",
    "/SNK",
    "/NEC",
    "/Atari",
    "/Arcade",
    "/Panasonic - 3DO",
    "/Microsoft",
    "/Commodore",
    "/Bandai",
    "/ColecoVision",
    "/Magnavox - Odyssey 2",
    "/Mattel",
    "/GCE - Vectrex",
    "/Sinclair - ZX Spectrum +3",
    "/Sharp",
    "/Philips - Videopac+",
    "/Amstrad - CPC",
    "/Apple",
]

# Output paths (repo root / data)
ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

HEADERS = {
    "User-Agent": "roms-search-scraper/1.0 (+https://github.com/carthageadev/roms-search)"
}

# Regex to detect region / languages in title: (USA), (Europe), (Japan) etc
REGION_RE = re.compile(r"\((USA|Europe|Japan|World|Germany|France|Spain|Italy|USA, Europe|Japan, Europe|.*?)\)")

def parse_size_to_bytes(size_str: str) -> int:
    """Convert '546.81Kb' / '4.23Mb' / '1.2Gb' to bytes"""
    if not size_str:
        return 0
    m = re.match(r"([\d.]+)\s*([KMG]b)", size_str.strip(), re.I)
    if not m:
        return 0
    val, unit = m.groups()
    val = float(val)
    unit = unit.lower()
    if unit == "kb":
        return int(val * 1024)
    if unit == "mb":
        return int(val * 1024 * 1024)
    if unit == "gb":
        return int(val * 1024 * 1024 * 1024)
    return int(val)

def fetch_html(path: str) -> str:
    url = f"{BASE_URL}{quote(path, safe='/%')}" if " " not in path else f"{BASE_URL}{path.replace(' ', '%20')}"
    # Use raw path encoded - requests will handle it, but we force quoting
    # Better: use quote on each segment
    # Rebuild url properly
    encoded = "/".join(quote(unquote(p), safe="") for p in path.split("/"))
    # keep leading /
    if not encoded.startswith("/"):
        encoded = "/" + encoded
    # fix double encoding for already encoded parts - unquote first handles it
    url = f"{BASE_URL}{encoded}"
    # print(f"GET {url}")
    resp = requests.get(url, headers=HEADERS, verify=False, timeout=30)
    resp.raise_for_status()
    return resp.text

def parse_directory(html: str, current_path: str):
    soup = BeautifulSoup(html, "lxml")
    folders = []
    files = []

    # folders: <li class="folder"><a class="file" href="/Nintendo/3DS">3DS</a>
    for li in soup.select("li.folder a.file"):
        href = li.get("href")
        if href:
            # href is already like /Nintendo/3DS
            folders.append(unquote(href))

    # files: <li class='filei'><a class='file' href='...'>Title</a><div class='meta'><span>size</span><span>date</span>
    for li in soup.select("li.filei"):
        a = li.select_one("a.file")
        if not a:
            continue
        href = a.get("href", "")
        title = a.get_text(strip=True)
        meta_spans = li.select("div.meta span")
        size = meta_spans[0].get_text(strip=True) if len(meta_spans) > 0 else ""
        date = meta_spans[1].get_text(strip=True) if len(meta_spans) > 1 else ""
        files.append({
            "href": unquote(href),
            "title": title,
            "size": size,
            "date": date,
        })

    return folders, files

def crawl():
    visited = set()
    # BFS queue
    queue = list(TARGET_ROOTS)
    all_entries = []
    seen_file_hrefs = set()

    print(f"[scraper] BASE_URL={BASE_URL}")
    print(f"[scraper] targets={TARGET_ROOTS}")

    while queue:
        path = queue.pop(0)
        if path in visited:
            continue
        visited.add(path)
        print(f"[crawl] -> {path}")
        try:
            html = fetch_html(path)
        except Exception as e:
            print(f"[error] failed to fetch {path}: {e}", file=sys.stderr)
            continue

        folders, files = parse_directory(html, path)
        # enqueue subfolders
        for f in folders:
            if f not in visited and f not in queue:
                # Only crawl if under TARGET_ROOTS (stay within Nintendo/SEGA tree)
                if any(f == r or f.startswith(r + "/") for r in TARGET_ROOTS):
                    queue.append(f)

        # process files in this directory
        for fl in files:
            href = fl["href"]
            if href in seen_file_hrefs:
                continue
            seen_file_hrefs.add(href)

            # Derive company / console from path
            # href = /Nintendo/Game Boy Advance/file.7z
            # For single-level roots like /Amstrad - CPC/file.7z, console is empty
            parts = href.strip("/").split("/")
            company = parts[0] if len(parts) > 0 else ""
            if len(parts) <= 2:
                console = ""
            else:
                console = parts[1]
            # folder path without filename
            folder_path = "/" + "/".join(parts[:-1]) if len(parts) > 1 else "/"

            # Build search text: title + company + console + folder
            size_bytes = parse_size_to_bytes(fl["size"])

            entry = {
                "id": href,  # unique
                "title": fl["title"],
                "href": href,
                "url": f"{BASE_URL}{quote(href, safe='/%')}",
                "company": company,      # Nintendo / SEGA - sortable/filterable
                "console": console,      # Game Boy Advance etc - sortable/filterable
                "folder": folder_path,   # full folder path as search criteria
                "folderParts": parts[:-1],
                "size": fl["size"],
                "sizeBytes": size_bytes,
                "date": fl["date"],
                # for full-text search
                "searchText": f"{fl['title']} {company} {console} {folder_path}".lower(),
            }
            all_entries.append(entry)

        # Be nice to server
        time.sleep(0.35)

        # Progress log every 10 dirs
        if len(visited) % 10 == 0:
            print(f"[progress] visited={len(visited)} queue={len(queue)} files={len(all_entries)}")

    return all_entries

def write_compressed(path: Path, data, use_compact=True):
    import gzip
    # smallest deploy file: compact JSON + gzip max (9) + mtime=0, no brotli — only .gz is committed
    if use_compact:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        # write raw locally for worker fallback / debugging (gitignored)
        with open(path, "wb") as f:
            f.write(raw)
        gz_path = path.with_suffix(path.suffix + ".gz")
        with gzip.GzipFile(gz_path, "wb", compresslevel=9, mtime=0) as f_out:
            f_out.write(raw)
        print(f"[compress] {gz_path.name} {gz_path.stat().st_size/1024/1024:.2f} MB (max gzip, mtime=0, level=9)")
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    entries = crawl()
    print(f"[done] total files={len(entries)}")

    if not entries or len(entries) < 1000:
        print(f"[abort] too few entries ({len(entries)}), not overwriting good index", file=sys.stderr)
        sys.exit(1)

    # Sort by company then console then title for deterministic output
    entries.sort(key=lambda x: (x["company"], x["console"], x["title"].lower()))

    # Write main index + compressed (only gzip needed)
    out_main = DATA_DIR / "roms.json"
    write_compressed(out_main, entries, use_compact=True)
    print(f"[write] {out_main} ({out_main.stat().st_size / 1024 / 1024:.2f} MB) + {out_main}.gz")

    # Write meta (no by-console shards — frontend only uses roms.json.gz)
    from collections import defaultdict
    by_console = defaultdict(list)
    for e in entries:
        key = f"{e['company']} - {e['console']}" if e['console'] else e['company']
        by_console[key].append(e)

    meta = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": BASE_URL,
        "targets": TARGET_ROOTS,
        "totalFiles": len(entries),
        "companies": sorted(set(e["company"] for e in entries)),
        "consoles": sorted(set(e["console"] for e in entries if e["console"])),
        "byConsoleCounts": {k: len(v) for k, v in by_console.items()},
    }
    with open(DATA_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"[meta] {meta}")

if __name__ == "__main__":
    main()
