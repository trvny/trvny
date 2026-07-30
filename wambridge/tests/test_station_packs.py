from unittest import TestCase

from wambridge.station_packs import get_station_pack, station_pack_names
from wambridge.stations import StationError


class StationPackTests(TestCase):
    def test_top3_contains_user_stations_with_fallbacks(self) -> None:
        stations = get_station_pack("TOP3")

        self.assertEqual(
            [station.alias for station in stations],
            ["bbc1", "trojka", "czworka"],
        )
        self.assertTrue(all(len(station.all_urls) == 2 for station in stations))

    def test_lists_available_packs(self) -> None:
        self.assertIn("top3", station_pack_names())

    def test_rejects_unknown_pack(self) -> None:
        with self.assertRaisesRegex(StationError, "available: top3"):
            get_station_pack("missing")
