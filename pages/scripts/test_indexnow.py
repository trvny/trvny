import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import indexnow
from defusedxml.common import DefusedXmlException


class IndexNowTests(unittest.TestCase):
    def test_canonical_only(self):
        self.assertTrue(indexnow.canonical(indexnow.BASE + "/tv/"))
        self.assertFalse(indexnow.canonical("https://trfny.com/tv/"))
        self.assertFalse(indexnow.canonical(indexnow.BASE + "/?utm=x"))

    def test_sitemap_and_changes(self):
        doc = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://travny.pages.dev/</loc></url><url><loc>https://travny.pages.dev/przeglad/2026-11-17/</loc><lastmod>2026-11-17</lastmod></url></urlset>'
        result = indexnow.entries([doc])
        self.assertEqual(result[indexnow.BASE + "/"], "")
        self.assertEqual(result[indexnow.BASE + "/przeglad/2026-11-17/"], "2026-11-17")
        self.assertEqual(indexnow.changes(result, {indexnow.BASE + "/": "new"}), [
            indexnow.BASE + "/", indexnow.BASE + "/przeglad/2026-11-17/",
        ])

    def test_foreign_sitemap_rejected(self):
        with self.assertRaises(ValueError):
            indexnow.entries([b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>'])

    def test_unsafe_xml_rejected(self):
        with self.assertRaises(DefusedXmlException):
            indexnow.entries([b'<!DOCTYPE urlset [<!ENTITY x "unsafe">]><urlset>&x;</urlset>'])

    def test_updates_detected_even_with_same_lastmod_and_guide(self):
        doc = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://travny.pages.dev/</loc><lastmod>2026-11-17</lastmod></url></urlset>'

        def snapshot(html):
            return indexnow.snapshot(lambda url: doc if url.endswith("sitemap.xml") else
                                     b"# Guide" if url.endswith("index.md") else html)

        first = snapshot(b'<p>article</p><div id="wxmeta">old weather</div>')
        second = snapshot(b'<p>article</p><div id="wxmeta">new weather</div>')
        third = snapshot(b'<p>new article</p><div id="wxmeta">new weather</div>')
        self.assertEqual(first, second)
        self.assertEqual(indexnow.changes(first, third), [indexnow.BASE + "/"])

    def test_scoped_feedseek_and_mixed_weather_sitemap(self):
        feedseek = indexnow.SITES["feedseek"]
        self.assertTrue(indexnow.canonical("https://trvny.github.io/feedseek/reader/", feedseek))
        self.assertFalse(indexnow.canonical("https://trvny.github.io/other/", feedseek))
        self.assertFalse(indexnow.canonical("https://trvny.github.io/feedseek/../other/", feedseek))
        weather = indexnow.SITES["weather"]
        doc = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://weather.travny.workers.dev/</loc></url><url><loc>https://weather.travny.workers.dev/feed.atom</loc></url></urlset>'
        self.assertEqual(indexnow.entries([doc], weather), {weather.root: ""})

    def test_removed_url(self):
        self.assertEqual(indexnow.changes({indexnow.BASE + "/old/": "x"}, {}), [indexnow.BASE + "/old/"])

    def test_undated_guide_change(self):
        doc = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://travny.pages.dev/</loc></url></urlset>'

        def snapshot(guide):
            return indexnow.snapshot(lambda url: doc if url.endswith("sitemap.xml") else
                                     guide if url.endswith("index.md") else b"<p>Page</p>")

        self.assertEqual(indexnow.changes(snapshot(b"old"), snapshot(b"new")), [indexnow.BASE + "/"])

    def test_encoded_paths(self):
        self.assertTrue(indexnow.canonical(indexnow.BASE + "/przeglad/%C5%BC/"))
        for path in ["/%2e%2e/", "/a%2fb/", "/%252e%252e/"]:
            self.assertFalse(indexnow.canonical(indexnow.BASE + path))

    def test_widget_parser_recovers_and_weather_metadata_is_stable(self):
        def stable(html):
            parser = indexnow.StableHTML(live_weather=True)
            parser.feed(html)
            return "".join(parser.parts)

        first = '<meta name="description" content="12C"><div id="nowCard"><span>12</div><p>guide</p>'
        second = '<meta name="description" content="13C"><div id="nowCard"><span>13</div><p>guide</p>'
        self.assertEqual(stable(first), stable(second))
        self_closing_first = first.replace('12C">', '12C" />')
        self_closing_second = second.replace('13C">', '13C" />')
        self.assertEqual(stable(self_closing_first), stable(self_closing_second))
        self.assertEqual(stable(first), stable(self_closing_first))
        self.assertIn("<p>guide</p>", stable(first))
        self.assertNotEqual(stable(first), stable(second.replace(">guide<", ">new guide<")))

    def test_state_only_advances_on_acceptance(self):
        with TemporaryDirectory() as directory:
            state = Path(directory) / "state.json"
            current = {indexnow.BASE + "/": "new"}
            with patch.object(indexnow, "read", return_value=b"wrong"), patch.object(indexnow, "submit") as submit:
                with self.assertRaises(ValueError):
                    indexnow.run(state)
                submit.assert_not_called()
                self.assertFalse(state.exists())
            with patch.object(indexnow, "read", return_value=indexnow.HUB.key.encode()), patch.object(indexnow, "snapshot", return_value=current):
                with patch.object(indexnow, "submit", side_effect=RuntimeError("failed")):
                    with self.assertRaises(RuntimeError):
                        indexnow.run(state)
                    self.assertFalse(state.exists())
                with patch.object(indexnow, "submit", return_value=200):
                    indexnow.run(state)
                self.assertIn("new", state.read_text(encoding="utf-8"))

    def test_no_duplicate_submission(self):
        old = {indexnow.BASE + "/": "same"}
        self.assertEqual(indexnow.changes(old, old), [])


if __name__ == "__main__":
    unittest.main()
