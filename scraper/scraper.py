#!/usr/bin/env python3
"""Build the atlas search index by crawling the source directory listing.

Writes ``roms.json.gz`` and ``meta.json`` into the output directory (default:
``<repo>/data``). A run is all-or-nothing: if any directory cannot be read or
the result looks wrong, nothing is written and the exit code is non-zero, so a
bad run can never replace a good index.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import logging
import os
import posixpath
import re
import sys
import threading
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Protocol
from urllib.parse import parse_qs, urlsplit

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("atlas")

SCHEMA_VERSION = 2
BASE_URL = os.environ.get("ATLAS_BASE_URL", "https://lolroms.com").rstrip("/")

# Top level directories to index. Names must match the source exactly. The crawl
# refuses to run when one of them disappears, so a rename cannot silently drop
# a whole platform from the index. "Audio [FLAC]" and "fixdats" are left out on
# purpose: they are music and DAT files, not games.
ROOTS = (
    "Acorn",
    "ACT - Apricot PC Xi",
    "Amstrad - CPC",
    "Analogue Pocket",
    "APF",
    "Apple",
    "Arcade",
    "Arduboy",
    "Atari",
    "Bally - Astrocade",
    "Bandai",
    "Benesse",
    "Bit Corporation - Gamate",
    "CASIO",
    "ColecoVision",
    "Commodore",
    "Digital Media Cartridge - Firecore",
    "Emerson - Arcadia 2001",
    "Entex - Adventure Vision",
    "Epoch",
    "Evercade",
    "Fairchild - Channel F",
    "Fujitsu",
    "Funtech - Super Acan",
    "GamePark",
    "GCE - Vectrex",
    "Hartung - Game Master",
    "Hitachi - S1",
    "IBM - PC & Compatibles",
    "Interton - VC 4000",
    "Konami - Picno",
    "LeapFrog",
    "Luxor - ABC 800",
    "Magnavox - Odyssey 2",
    "Mattel",
    "Microsoft",
    "NEC",
    "Nichibutsu - My Vision",
    "Nintendo",
    "Ouya",
    "Panasonic - 3DO",
    "Philips",
    "Playdate",
    "Pokéhacks",
    "RCA - Studio II",
    "Sanyo - MBC-550",
    "SEGA",
    "Sharp",
    "Sinclair - ZX Spectrum +3",
    "SNK",
    "SONY",
    "TeleNova - Compis",
    "Texas Instruments - 99-4A",
    "Toshiba",
    "VM Labs - NUON",
    "VTech",
    "Watara - Supervision",
    "Welback - Mega Duck",
    "Yamaha - Copera",
    "Zeebo",
)

# The source sits behind a bot filter that answers 403 to short user agents.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data"
MIN_TOTAL = 1000
MIN_RATIO = 0.7  # a new index must keep at least this share of the previous one

RETRY_STATUSES = (429, 500, 502, 503, 504, 520, 521, 522, 523, 524)
ICONS = "\U0001F4C4\U0001F4C1\ufe0f"
SIZE_RE = re.compile(r"\d[\d,]*(?:\.\d+)?\s*(?:[KMGT]i?B|B)", re.IGNORECASE)
ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DMY_DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")


class ListingError(Exception):
    """A directory could not be fetched or did not look like a listing."""


@dataclass(frozen=True)
class FileRow:
    path: str  # relative to the source root, e.g. "Nintendo/Wii/Wii Sports (USA).7z"
    title: str
    date: str
    size: str


@dataclass(frozen=True)
class Listing:
    folders: tuple[str, ...]  # full relative paths of sub directories
    files: tuple[FileRow, ...]


@dataclass
class CrawlResult:
    files: dict[str, FileRow] = field(default_factory=dict)
    directories: int = 0
    duplicates: int = 0
    errors: list[str] = field(default_factory=list)


class Fetcher(Protocol):
    def listing(self, path: str) -> Listing: ...


# --------------------------------------------------------------------------
# parsing
# --------------------------------------------------------------------------


def normalize_text(value: str) -> str:
    """Lowercase and strip accents so "Pokémon" is found by "pokemon"."""
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def normalize_date(text: str) -> str:
    """Return an ISO date, or an empty string when the text is not a date."""
    text = text.strip()
    if ISO_DATE_RE.fullmatch(text):
        return text
    match = DMY_DATE_RE.fullmatch(text)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    return ""


def parse_file_meta(text: str) -> tuple[str, str]:
    """Split "2026-08-27 • 982.15 MB" into (date, size)."""
    date = size = ""
    for part in (piece.strip() for piece in text.split("\u2022")):
        if not part:
            continue
        iso = normalize_date(part)
        if iso:
            date = iso
        elif SIZE_RE.fullmatch(part):
            size = re.sub(r"\s+", " ", part)
    return date, size


def clean_path(value: str) -> str | None:
    """Validate a relative source path, returning None if it looks unsafe."""
    path = value.strip("/")
    if not path:
        return None
    if any(segment in ("", ".", "..") for segment in path.split("/")):
        return None
    return path


def parse_listing(markup: bytes | str) -> Listing:
    """Parse one directory page into sub directories and files."""
    if isinstance(markup, bytes):
        soup = BeautifulSoup(markup, "lxml", from_encoding="utf-8")
    else:
        soup = BeautifulSoup(markup, "lxml")

    container = soup.select_one("div.list")
    if container is None:
        # Unknown directories answer 200 with a "not found" page, so the
        # status code alone cannot be trusted.
        text = soup.get_text(" ", strip=True)
        if "not found" in text.lower():
            raise ListingError("directory not found")
        title = soup.title.get_text(strip=True) if soup.title else "no title"
        raise ListingError(f"not a directory listing, layout may have changed ({title})")

    folders: list[str] = []
    files: list[FileRow] = []
    for row in container.select("div.row"):
        link = row.find("a", href=True)
        if link is None:
            continue
        query = parse_qs(urlsplit(link["href"]).query)

        if "dir" in query:
            path = clean_path(query["dir"][0])
            if path:
                folders.append(path)
        elif "file" in query:
            path = clean_path(query["file"][0])
            if not path:
                continue
            title = link.get_text().strip().lstrip(ICONS).strip()
            if not title:
                title = posixpath.splitext(posixpath.basename(path))[0]
            meta = row.select_one("span.file-meta")
            date, size = parse_file_meta(meta.get_text(" ", strip=True)) if meta else ("", "")
            files.append(FileRow(path=path, title=title, date=date, size=size))

    return Listing(folders=tuple(folders), files=tuple(files))


def build_entry(row: FileRow) -> dict[str, str]:
    """Turn a crawled file into an index record."""
    parts = row.path.split("/")
    company = parts[0]
    console = parts[1] if len(parts) > 2 else ""
    folder = "/" + "/".join(parts[:-1])
    return {
        "id": "/" + row.path,
        "title": row.title,
        "company": company,
        "console": console,
        "folder": folder,
        "size": row.size,
        "date": row.date,
        "searchText": normalize_text(f"{row.title} {company} {console} {folder}"),
    }


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------


class RateLimiter:
    """Spaces request starts at least ``interval`` seconds apart, across threads."""

    def __init__(self, interval: float) -> None:
        self._interval = interval
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        if self._interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self._interval
        if delay > 0:
            time.sleep(delay)


class Client:
    """HTTP client with retries, backoff, and a shared request rate limit."""

    def __init__(
        self,
        base_url: str = BASE_URL,
        *,
        retries: int = 4,
        delay: float = 0.25,
        timeout: tuple[float, float] = (10, 90),
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._retries = retries
        self._timeout = timeout
        self._limiter = RateLimiter(delay)
        self._local = threading.local()

    def _session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            retry = Retry(
                total=self._retries,
                backoff_factor=1.5,
                status_forcelist=RETRY_STATUSES,
                allowed_methods=("GET",),
                respect_retry_after_header=True,
                raise_on_status=False,
            )
            session = requests.Session()
            session.headers["User-Agent"] = USER_AGENT
            session.mount("https://", HTTPAdapter(max_retries=retry))
            session.mount("http://", HTTPAdapter(max_retries=retry))
            self._local.session = session
        return session

    def listing(self, path: str) -> Listing:
        self._limiter.wait()
        params = {"dir": path} if path else None
        try:
            response = self._session().get(f"{self._base_url}/", params=params, timeout=self._timeout)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ListingError(f"request failed: {exc}") from exc
        return parse_listing(response.content)


# --------------------------------------------------------------------------
# crawling
# --------------------------------------------------------------------------


def _attempt(fetch: Callable[[str], Listing], path: str) -> Listing | Exception:
    try:
        return fetch(path)
    except Exception as exc:  # reported by the caller, never swallowed
        return exc


def crawl(fetch: Callable[[str], Listing], roots: Iterable[str], workers: int = 4) -> CrawlResult:
    """Walk the tree breadth first, collecting every file below ``roots``."""
    frontier = list(dict.fromkeys(roots))
    seen = set(frontier)
    result = CrawlResult()
    level = 0

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        while frontier:
            outcomes = list(pool.map(lambda path: _attempt(fetch, path), frontier))
            next_frontier: list[str] = []

            for path, outcome in zip(frontier, outcomes):
                result.directories += 1
                if isinstance(outcome, Exception):
                    result.errors.append(f"{path}: {outcome}")
                    continue

                for child in outcome.folders:
                    if posixpath.dirname(child) != path:
                        log.warning("ignoring folder outside %r: %r", path, child)
                    elif child not in seen:
                        seen.add(child)
                        next_frontier.append(child)

                for row in outcome.files:
                    if posixpath.dirname(row.path) != path:
                        log.warning("ignoring file outside %r: %r", path, row.path)
                    elif row.path in result.files:
                        result.duplicates += 1
                    else:
                        result.files[row.path] = row

            level += 1
            log.info(
                "depth %d: %d directories, %d files so far, %d errors",
                level,
                result.directories,
                len(result.files),
                len(result.errors),
            )
            frontier = next_frontier

    return result


# --------------------------------------------------------------------------
# validation and output
# --------------------------------------------------------------------------


def validate(
    entries: list[dict[str, str]],
    roots: Iterable[str],
    previous_total: int | None,
    allow_shrink: bool,
) -> list[str]:
    """Return a list of reasons the new index should not be published."""
    problems: list[str] = []
    total = len(entries)
    if total < MIN_TOTAL:
        problems.append(f"only {total} files found, expected at least {MIN_TOTAL}")

    counts = Counter(entry["company"] for entry in entries)
    for root in roots:
        if counts.get(root, 0) == 0:
            problems.append(f"no files found under {root!r}")

    if previous_total and not allow_shrink and total < previous_total * MIN_RATIO:
        problems.append(
            f"index shrank from {previous_total} to {total} files "
            f"(below {MIN_RATIO:.0%}); rerun with --allow-shrink if this is expected"
        )
    return problems


def read_meta(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def atomic_write(path: Path, data: bytes) -> None:
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(data)
    os.replace(temp, path)


def serialize(entries: list[dict[str, str]]) -> bytes:
    return json.dumps(entries, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_outputs(entries: list[dict[str, str]], out_dir: Path) -> bool:
    """Write the index and metadata. Returns False when nothing changed."""
    raw = serialize(entries)
    digest = hashlib.sha256(raw).hexdigest()
    gz_path = out_dir / "roms.json.gz"
    meta_path = out_dir / "meta.json"

    previous = read_meta(meta_path)
    unchanged = (
        previous is not None
        and previous.get("contentHash") == digest
        and previous.get("schema") == SCHEMA_VERSION
        and gz_path.exists()
        and gz_path.stat().st_size > 0
    )
    if unchanged:
        return False

    by_console = Counter(
        f"{e['company']} - {e['console']}" if e["console"] else e["company"] for e in entries
    )
    meta = {
        "schema": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "baseUrl": BASE_URL,
        "totalFiles": len(entries),
        "contentHash": digest,
        "companies": sorted({e["company"] for e in entries}),
        "consoles": sorted({e["console"] for e in entries if e["console"]}),
        "byConsoleCounts": dict(sorted(by_console.items())),
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    atomic_write(gz_path, gzip.compress(raw, compresslevel=9, mtime=0))
    atomic_write(meta_path, (json.dumps(meta, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return True


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------


def run(
    client: Fetcher,
    roots: tuple[str, ...],
    out_dir: Path,
    *,
    workers: int = 4,
    allow_shrink: bool = False,
    dry_run: bool = False,
    check_previous: bool = True,
) -> int:
    try:
        available = set(client.listing("").folders)
    except ListingError as exc:
        log.error("cannot read the source root: %s", exc)
        return 1
    unindexed = sorted(available - set(ROOTS))
    if unindexed:
        log.info("source has %d top level directories that are not indexed", len(unindexed))

    started = time.monotonic()
    result = crawl(client.listing, roots, workers)
    if result.errors:
        log.error("%d directories could not be read, refusing to publish:", len(result.errors))
        for message in result.errors[:20]:
            log.error("  %s", message)
        if any(error.split(":", 1)[0] in roots for error in result.errors):
            log.error("top level directories listed by the source: %s", ", ".join(sorted(available)))
        return 1
    if result.duplicates:
        log.warning("skipped %d duplicate files", result.duplicates)

    entries = sorted(
        (build_entry(row) for row in result.files.values()),
        key=lambda e: (e["company"], e["console"], e["title"].lower(), e["id"]),
    )

    previous = read_meta(out_dir / "meta.json") if check_previous else None
    previous_total = previous.get("totalFiles") if previous else None
    problems = validate(entries, roots, previous_total, allow_shrink)
    if problems:
        log.error("refusing to publish:")
        for problem in problems:
            log.error("  %s", problem)
        return 1

    counts = Counter(entry["company"] for entry in entries)
    for company, count in sorted(counts.items()):
        log.info("%7d  %s", count, company)
    log.info(
        "%d files in %d directories, %.0fs",
        len(entries),
        result.directories,
        time.monotonic() - started,
    )

    if dry_run:
        log.info("dry run, nothing written")
        return 0
    if write_outputs(entries, out_dir):
        log.info("wrote %s", out_dir)
    else:
        log.info("index unchanged, nothing written")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory")
    parser.add_argument(
        "--root",
        action="append",
        dest="roots",
        metavar="NAME",
        help="only crawl this top level directory (repeatable, implies no shrink check)",
    )
    parser.add_argument("--workers", type=int, default=4, help="parallel requests")
    parser.add_argument("--delay", type=float, default=0.25, help="minimum seconds between requests")
    parser.add_argument("--retries", type=int, default=4, help="retries per request")
    parser.add_argument("--allow-shrink", action="store_true", help="accept a much smaller index")
    parser.add_argument("--dry-run", action="store_true", help="crawl and validate without writing")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    client = Client(retries=args.retries, delay=args.delay)
    return run(
        client,
        tuple(args.roots) if args.roots else ROOTS,
        args.out,
        workers=args.workers,
        allow_shrink=args.allow_shrink,
        dry_run=args.dry_run,
        check_previous=not args.roots,
    )


if __name__ == "__main__":
    sys.exit(main())
