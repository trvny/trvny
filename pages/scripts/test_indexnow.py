import unittest

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

    def test_no_duplicate_submission(self):
        old = {indexnow.BASE + "/": "same"}
        self.assertEqual(indexnow.changes(old, old), [])


if __name__ == "__main__":
    unittest.main()
