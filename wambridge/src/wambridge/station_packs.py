"""Bundled station packs for quick local setup."""

from __future__ import annotations

from .stations import RadioStation, StationError

TOP3 = (
    RadioStation(
        alias="bbc1",
        url=(
            "https://as-hls-ww-live.akamaized.net/pool_01505109/live/ww/"
            "bbc_radio_one/bbc_radio_one.isml/"
            "bbc_radio_one-audio=320000.norewind.m3u8"
        ),
        fallback_urls=(
            "https://a.files.bbci.co.uk/ms6/live/"
            "3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/"
            "nonuk/audio_syndication_low_sbr_v1/aks/bbc_radio_one.m3u8",
        ),
    ),
    RadioStation(
        alias="trojka",
        url="http://41.dktr.pl:8000/trojka.ogg",
        fallback_urls=("http://41.dktr.pl:8000/trojka2.ogg",),
    ),
    RadioStation(
        alias="czworka",
        url="http://stream3.polskieradio.pl:8906/;stream",
        fallback_urls=("http://mp3.polskieradio.pl:8956/;",),
    ),
)

STATION_PACKS: dict[str, tuple[RadioStation, ...]] = {"top3": TOP3}


def station_pack_names() -> tuple[str, ...]:
    """Return bundled station-pack names."""
    return tuple(sorted(STATION_PACKS))


def get_station_pack(name: str) -> tuple[RadioStation, ...]:
    """Return a bundled station pack by case-insensitive name."""
    key = name.strip().casefold()
    try:
        return STATION_PACKS[key]
    except KeyError as error:
        available = ", ".join(station_pack_names())
        raise StationError(
            f"Unknown radio station pack {name!r}; available: {available}"
        ) from error
