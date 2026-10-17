import gzip
import hashlib
import json
import posixpath
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scraper  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def listing(folders=(), files=()):
    rows = tuple(
        scraper.FileRow(path=path, title=posixpath.splitext(posixpath.basename(path))[0], date="2026-01-01", size="1 MB")
        for path in files
    )
    return scraper.Listing(folders=tuple(folders), files=rows)


class FakeSource:
    def __init__(self, tree):
        self.tree = tree
        self.calls = []

    def listing(self, path):
        self.calls.append(path)
        if path not in self.tree:
            raise scraper.ListingError("directory not found")
        return self.tree[path]


def sample_tree():
    return {
        "": listing(folders=["A", "B"]),
        "A": listing(folders=["A/x"], files=["A/one.7z"]),
        "A/x": listing(files=["A/x/two.7z", "A/x/three.7z"]),
        "B": listing(files=["B/four.7z"]),
    }


def big_tree(per_root=600):
    return {
        "": listing(folders=["Nintendo", "SEGA"]),
        "Nintendo": listing(folders=["Nintendo/Wii"]),
        "Nintendo/Wii": listing(files=[f"Nintendo/Wii/game{i}.7z" for i in range(per_root)]),
        "SEGA": listing(files=[f"SEGA/game{i}.7z" for i in range(per_root)]),
    }


def entries_for(company, count):
    return [
        scraper.build_entry(scraper.FileRow(path=f"{company}/Console/game{i}.7z", title=f"game{i}", date="", size=""))
        for i in range(count)
    ]


class ParseListingTests(unittest.TestCase):
    def setUp(self):
        self.listing = scraper.parse_listing(fixture("directory.html"))
        self.by_name = {posixpath.basename(f.path): f for f in self.listing.files}

    def test_folders_skip_sort_and_back_links(self):
        self.assertEqual(self.listing.folders, ("Nintendo/Wii/CDN", "Nintendo/Wii/T-En"))

    def test_awkward_names_are_decoded(self):
        self.assertIn("$1,000,000 Pyramid, The (USA).7z", self.by_name)
        self.assertIn("Zack & Wiki - Quest (USA).7z", self.by_name)
        self.assertIn("Pokémon Rumble (USA).7z", self.by_name)

    def test_titles_drop_the_icon(self):
        self.assertEqual(self.by_name["Zack & Wiki - Quest (USA).7z"].title, "Zack & Wiki - Quest (USA)")
        self.assertEqual(self.by_name["$1,000,000 Pyramid, The (USA).7z"].title, "$1,000,000 Pyramid, The (USA)")

    def test_date_and_size_are_read(self):
        row = self.by_name["Zack & Wiki - Quest (USA).7z"]
        self.assertEqual((row.date, row.size), ("2026-08-28", "1.06 GB"))

    def test_old_date_format_becomes_iso(self):
        self.assertEqual(self.by_name["Pokémon Rumble (USA).7z"].date, "2026-08-27")

    def test_missing_meta_is_blank(self):
        row = self.by_name["No Meta (USA).7z"]
        self.assertEqual((row.date, row.size), ("", ""))

    def test_unsafe_paths_are_dropped(self):
        self.assertFalse(any(".." in f.path for f in self.listing.files))

    def test_root_listing(self):
        root = scraper.parse_listing(fixture("root.html"))
        self.assertEqual(
            root.folders,
            ("Acorn", "Amstrad - CPC", "IBM - PC & Compatibles", "Sinclair - ZX Spectrum +3"),
        )
        self.assertEqual(root.files, ())

    def test_not_found_page_is_an_error(self):
        with self.assertRaisesRegex(scraper.ListingError, "not found"):
            scraper.parse_listing(fixture("missing.html"))

    def test_unknown_layout_is_an_error(self):
        with self.assertRaisesRegex(scraper.ListingError, "layout may have changed"):
            scraper.parse_listing(fixture("challenge.html"))

    def test_text_input_is_accepted(self):
        text = fixture("root.html").decode("utf-8")
        self.assertEqual(len(scraper.parse_listing(text).folders), 4)


class HelperTests(unittest.TestCase):
    def test_normalize_date(self):
        self.assertEqual(scraper.normalize_date("2026-08-27"), "2026-08-27")
        self.assertEqual(scraper.normalize_date("27.08.2026"), "2026-08-27")
        self.assertEqual(scraper.normalize_date("yesterday"), "")
        self.assertEqual(scraper.normalize_date(""), "")

    def test_parse_file_meta(self):
        self.assertEqual(scraper.parse_file_meta("2026-08-27 \u2022 982.15 MB"), ("2026-08-27", "982.15 MB"))
        self.assertEqual(scraper.parse_file_meta("1.3 GB"), ("", "1.3 GB"))
        self.assertEqual(scraper.parse_file_meta(""), ("", ""))
        self.assertEqual(scraper.parse_file_meta("2026-08-27 \u2022 lots"), ("2026-08-27", ""))

    def test_parse_file_meta_accepts_thousands_separators(self):
        self.assertEqual(scraper.parse_file_meta("2026-09-20 \u2022 1,009.91 KB"), ("2026-09-20", "1,009.91 KB"))
        self.assertEqual(scraper.parse_file_meta("2026-09-20 \u2022 512 B"), ("2026-09-20", "512 B"))

    def test_clean_path(self):
        self.assertEqual(scraper.clean_path("/Nintendo/Wii/"), "Nintendo/Wii")
        self.assertIsNone(scraper.clean_path(""))
        self.assertIsNone(scraper.clean_path("Nintendo/../etc"))
        self.assertIsNone(scraper.clean_path("Nintendo//Wii"))

    def test_normalize_text_strips_accents(self):
        self.assertEqual(scraper.normalize_text("Pokémon MINI"), "pokemon mini")


class BuildEntryTests(unittest.TestCase):
    def entry(self, path):
        return scraper.build_entry(scraper.FileRow(path=path, title="Pokémon Mini", date="2026-01-01", size="1 MB"))

    def test_nested_file(self):
        entry = self.entry("Nintendo/Wii/T-En/Game (USA).7z")
        self.assertEqual(entry["id"], "/Nintendo/Wii/T-En/Game (USA).7z")
        self.assertEqual(entry["company"], "Nintendo")
        self.assertEqual(entry["console"], "Wii")
        self.assertEqual(entry["folder"], "/Nintendo/Wii/T-En")

    def test_console_folder(self):
        entry = self.entry("Nintendo/Wii/Game.7z")
        self.assertEqual((entry["console"], entry["folder"]), ("Wii", "/Nintendo/Wii"))

    def test_file_directly_under_a_root_has_no_console(self):
        entry = self.entry("Amstrad - CPC/Thing.7z")
        self.assertEqual((entry["console"], entry["folder"]), ("", "/Amstrad - CPC"))

    def test_search_text_is_lowercase_and_accent_free(self):
        text = self.entry("Nintendo/Wii/Game.7z")["searchText"]
        self.assertIn("pokemon mini", text)
        self.assertIn("/nintendo/wii", text)
        self.assertNotIn("é", text)

    def test_schema(self):
        self.assertEqual(
            sorted(self.entry("Nintendo/Wii/Game.7z")),
            ["company", "console", "date", "folder", "id", "searchText", "size", "title"],
        )


class CrawlTests(unittest.TestCase):
    def test_walks_nested_folders(self):
        source = FakeSource(sample_tree())
        result = scraper.crawl(source.listing, ["A", "B"])
        self.assertEqual(
            set(result.files),
            {"A/one.7z", "A/x/two.7z", "A/x/three.7z", "B/four.7z"},
        )
        self.assertEqual(result.directories, 3)
        self.assertEqual(result.errors, [])

    def test_reports_unreadable_directories_and_keeps_going(self):
        tree = sample_tree()
        del tree["A/x"]
        result = scraper.crawl(FakeSource(tree).listing, ["A", "B"])
        self.assertEqual(len(result.errors), 1)
        self.assertTrue(result.errors[0].startswith("A/x:"))
        self.assertIn("B/four.7z", result.files)

    def test_ignores_links_outside_the_current_directory(self):
        tree = {
            "A": listing(folders=["B/evil", "A/ok"], files=["B/stray.7z", "A/top.7z"]),
            "A/ok": listing(files=["A/ok/deep.7z"]),
        }
        source = FakeSource(tree)
        with self.assertLogs("atlas", level="WARNING"):
            result = scraper.crawl(source.listing, ["A"])
        self.assertEqual(set(result.files), {"A/top.7z", "A/ok/deep.7z"})
        self.assertNotIn("B/evil", source.calls)

    def test_counts_duplicate_files(self):
        tree = {"A": listing(files=["A/one.7z", "A/one.7z"])}
        result = scraper.crawl(FakeSource(tree).listing, ["A"])
        self.assertEqual((len(result.files), result.duplicates), (1, 1))

    def test_each_directory_is_fetched_once(self):
        source = FakeSource(sample_tree())
        scraper.crawl(source.listing, ["A", "B", "A"], workers=3)
        self.assertEqual(sorted(source.calls), ["A", "A/x", "B"])


class ValidateTests(unittest.TestCase):
    def test_accepts_a_healthy_index(self):
        self.assertEqual(scraper.validate(entries_for("Nintendo", 1500), ["Nintendo"], None, False), [])

    def test_rejects_a_tiny_index(self):
        problems = scraper.validate(entries_for("Nintendo", 10), ["Nintendo"], None, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("only 10", problems[0])

    def test_rejects_an_empty_root(self):
        problems = scraper.validate(entries_for("Nintendo", 1500), ["Nintendo", "SEGA"], None, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("SEGA", problems[0])

    def test_rejects_a_big_shrink(self):
        problems = scraper.validate(entries_for("Nintendo", 1500), ["Nintendo"], 3000, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("shrank", problems[0])

    def test_shrink_can_be_allowed(self):
        self.assertEqual(scraper.validate(entries_for("Nintendo", 1500), ["Nintendo"], 3000, True), [])

    def test_small_drop_is_fine(self):
        self.assertEqual(scraper.validate(entries_for("Nintendo", 1500), ["Nintendo"], 1600, False), [])


class OutputTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out = Path(self._tmp.name)

    def test_writes_index_and_meta(self):
        entries = entries_for("Nintendo", 1200)
        self.assertTrue(scraper.write_outputs(entries, self.out))

        loaded = json.loads(gzip.decompress((self.out / "roms.json.gz").read_bytes()))
        self.assertEqual(loaded, entries)

        meta = json.loads((self.out / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["schema"], scraper.SCHEMA_VERSION)
        self.assertEqual(meta["totalFiles"], 1200)
        self.assertEqual(meta["contentHash"], hashlib.sha256(scraper.serialize(entries)).hexdigest())
        self.assertEqual(meta["companies"], ["Nintendo"])
        self.assertEqual(meta["byConsoleCounts"], {"Nintendo - Console": 1200})

    def test_unchanged_content_is_not_rewritten(self):
        entries = entries_for("Nintendo", 1200)
        scraper.write_outputs(entries, self.out)
        gz_before = (self.out / "roms.json.gz").read_bytes()
        meta_before = (self.out / "meta.json").read_bytes()

        self.assertFalse(scraper.write_outputs(entries, self.out))
        self.assertEqual((self.out / "roms.json.gz").read_bytes(), gz_before)
        self.assertEqual((self.out / "meta.json").read_bytes(), meta_before)

    def test_changed_content_is_rewritten(self):
        scraper.write_outputs(entries_for("Nintendo", 1200), self.out)
        self.assertTrue(scraper.write_outputs(entries_for("Nintendo", 1300), self.out))
        meta = json.loads((self.out / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["totalFiles"], 1300)

    def test_a_missing_index_is_rebuilt_even_if_meta_matches(self):
        entries = entries_for("Nintendo", 1200)
        scraper.write_outputs(entries, self.out)
        (self.out / "roms.json.gz").unlink()
        self.assertTrue(scraper.write_outputs(entries, self.out))
        self.assertTrue((self.out / "roms.json.gz").exists())

    def test_output_is_deterministic(self):
        entries = entries_for("Nintendo", 1200)
        other = Path(self._tmp.name) / "other"
        scraper.write_outputs(entries, self.out)
        scraper.write_outputs(entries, other)
        self.assertEqual((self.out / "roms.json.gz").read_bytes(), (other / "roms.json.gz").read_bytes())

    def test_no_temp_files_are_left_behind(self):
        scraper.write_outputs(entries_for("Nintendo", 1200), self.out)
        self.assertEqual(sorted(p.name for p in self.out.iterdir()), ["meta.json", "roms.json.gz"])


class RunTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out = Path(self._tmp.name)

    def written(self):
        return sorted(p.name for p in self.out.iterdir())

    def test_publishes_a_healthy_crawl(self):
        code = scraper.run(FakeSource(big_tree()), ("Nintendo", "SEGA"), self.out, workers=2)
        self.assertEqual(code, 0)
        self.assertEqual(self.written(), ["meta.json", "roms.json.gz"])
        meta = json.loads((self.out / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["totalFiles"], 1200)

    def test_second_run_changes_nothing(self):
        source = FakeSource(big_tree())
        scraper.run(source, ("Nintendo", "SEGA"), self.out)
        before = (self.out / "meta.json").read_bytes()
        self.assertEqual(scraper.run(source, ("Nintendo", "SEGA"), self.out), 0)
        self.assertEqual((self.out / "meta.json").read_bytes(), before)

    def test_missing_root_publishes_nothing(self):
        with self.assertLogs("atlas", level="ERROR") as logs:
            code = scraper.run(FakeSource(big_tree()), ("Nintendo", "Nope"), self.out)
        self.assertEqual(code, 1)
        self.assertEqual(self.written(), [])
        self.assertTrue(any("Nope" in line for line in logs.output))

    def test_root_reachable_but_not_listed_on_the_root_page_is_fine(self):
        tree = big_tree()
        tree[""] = listing(folders=["Nintendo"])
        self.assertEqual(scraper.run(FakeSource(tree), ("Nintendo", "SEGA"), self.out), 0)
        meta = json.loads((self.out / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["totalFiles"], 1200)

    def test_unreadable_directory_publishes_nothing(self):
        tree = big_tree()
        del tree["Nintendo/Wii"]
        with self.assertLogs("atlas", level="ERROR") as logs:
            code = scraper.run(FakeSource(tree), ("Nintendo", "SEGA"), self.out)
        self.assertEqual(code, 1)
        self.assertEqual(self.written(), [])
        self.assertTrue(any("Nintendo/Wii" in line for line in logs.output))

    def test_empty_root_publishes_nothing(self):
        tree = big_tree()
        tree["SEGA"] = listing()
        with self.assertLogs("atlas", level="ERROR"):
            code = scraper.run(FakeSource(tree), ("Nintendo", "SEGA"), self.out)
        self.assertEqual(code, 1)
        self.assertEqual(self.written(), [])

    def test_dry_run_writes_nothing(self):
        code = scraper.run(FakeSource(big_tree()), ("Nintendo", "SEGA"), self.out, dry_run=True)
        self.assertEqual(code, 0)
        self.assertEqual(self.written(), [])

    def test_shrink_guard_keeps_the_old_index(self):
        scraper.run(FakeSource(big_tree(1000)), ("Nintendo", "SEGA"), self.out)
        before = (self.out / "meta.json").read_bytes()

        with self.assertLogs("atlas", level="ERROR"):
            code = scraper.run(FakeSource(big_tree(600)), ("Nintendo", "SEGA"), self.out)
        self.assertEqual(code, 1)
        self.assertEqual((self.out / "meta.json").read_bytes(), before)

        code = scraper.run(FakeSource(big_tree(600)), ("Nintendo", "SEGA"), self.out, allow_shrink=True)
        self.assertEqual(code, 0)
        meta = json.loads((self.out / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["totalFiles"], 1200)

    def test_unreachable_source_fails(self):
        class Down:
            def listing(self, path):
                raise scraper.ListingError("request failed")

        with self.assertLogs("atlas", level="ERROR"):
            self.assertEqual(scraper.run(Down(), ("Nintendo",), self.out), 1)
        self.assertEqual(self.written(), [])


class ClientTests(unittest.TestCase):
    def fake_response(self, body):
        response = mock.Mock()
        response.content = body
        response.raise_for_status.return_value = None
        return response

    def test_root_request_has_no_query(self):
        client = scraper.Client("https://example.test/", delay=0)
        with mock.patch.object(requests.Session, "get", return_value=self.fake_response(fixture("root.html"))) as get:
            self.assertEqual(len(client.listing("").folders), 4)
        self.assertEqual(get.call_args.args[0], "https://example.test/")
        self.assertIsNone(get.call_args.kwargs["params"])

    def test_directory_request_sends_the_path_as_a_query(self):
        client = scraper.Client("https://example.test", delay=0)
        with mock.patch.object(requests.Session, "get", return_value=self.fake_response(fixture("directory.html"))) as get:
            client.listing("Nintendo/Wii")
        self.assertEqual(get.call_args.kwargs["params"], {"dir": "Nintendo/Wii"})

    def test_network_errors_become_listing_errors(self):
        client = scraper.Client("https://example.test", delay=0)
        with mock.patch.object(requests.Session, "get", side_effect=requests.ConnectionError("boom")):
            with self.assertRaisesRegex(scraper.ListingError, "request failed"):
                client.listing("Nintendo")

    def test_http_errors_become_listing_errors(self):
        client = scraper.Client("https://example.test", delay=0)
        response = self.fake_response(b"")
        response.raise_for_status.side_effect = requests.HTTPError("403 Forbidden")
        with mock.patch.object(requests.Session, "get", return_value=response):
            with self.assertRaisesRegex(scraper.ListingError, "403"):
                client.listing("Nintendo")

    def test_rate_limiter_spaces_requests(self):
        limiter = scraper.RateLimiter(0.05)
        started = time.monotonic()
        for _ in range(4):
            limiter.wait()
        self.assertGreaterEqual(time.monotonic() - started, 0.14)

    def test_zero_interval_never_waits(self):
        limiter = scraper.RateLimiter(0)
        started = time.monotonic()
        for _ in range(50):
            limiter.wait()
        self.assertLess(time.monotonic() - started, 0.05)


class CliTests(unittest.TestCase):
    def test_defaults(self):
        args = scraper.parse_args([])
        self.assertIsNone(args.roots)
        self.assertEqual(args.workers, 4)
        self.assertFalse(args.dry_run)

    def test_repeatable_roots(self):
        args = scraper.parse_args(["--root", "Nintendo", "--root", "SEGA", "--dry-run", "--allow-shrink"])
        self.assertEqual(args.roots, ["Nintendo", "SEGA"])
        self.assertTrue(args.dry_run and args.allow_shrink)

    def test_every_configured_root_is_unique(self):
        self.assertEqual(len(scraper.ROOTS), len(set(scraper.ROOTS)))


if __name__ == "__main__":
    unittest.main()
