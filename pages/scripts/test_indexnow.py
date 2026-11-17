import unittest
from defusedxml.common import DefusedXmlException

import indexnow


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

    def test_no_duplicate_submission(self):
        old = {indexnow.BASE + "/": "same"}
        self.assertEqual(indexnow.changes(old, old), [])


if __name__ == "__main__":
    unittest.main()
