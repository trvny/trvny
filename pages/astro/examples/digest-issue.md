---
title: "CoCzyDziennik — YYYY-MM-DD"
description: "Replace with verified lead."
date: "YYYY-MM-DD"
draft: true
magazine:
  cover:
    src: "/przeglad/assets/editorial-cover.svg"
    alt: "CoCzyDziennik editorial cover"
    credit: "TRAVNY"
  stats:
    - label: "Metric"
      value: "Verified number and unit"
  sections:
    - kind: science
      title: "Science and space"
      layout: feature
      cards:
        - title: "Lead story"
          kicker: "Topic or date"
          body: "What happened. Why it matters."
          # Optional: official provider link, not iframe code.
          # media:
          #   kind: embed
          #   src: "https://www.youtube.com/watch?v=VIDEO_ID"
          #   alt: "Describe the source video"
          #   credit: "Source channel"
          links:
            - label: "Source"
              url: "https://example.org/"
    - kind: gallery
      title: "Gallery"
      gallery:
        - src: "/przeglad/assets/editorial-cover.svg"
          aspect: wide
          alt: "Describe image"
          credit: "TRAVNY"
    - kind: football
      title: "Scores"
      cards:
        - title: "Competition"
          score: {home: "Home", away: "Away", result: "Final score"}
      table:
        title: "Standings"
        columns: ["Team", "Points"]
        rows: [["Team A", "0"]]
    - kind: data
      title: "Numbers"
      chart:
        title: "Comparable data"
        unit: "units"
        items: [{label: "A", value: 1}, {label: "B", value: 2}]
        source: {label: "Dataset", url: "https://example.org/"}
    - kind: memes
      title: "Memes"
      cards:
        - title: "Meme"
          body: "Context, creator and origin."
          media:
            src: "/przeglad/assets/microsoft-364.svg"
            alt: "Example editorial illustration"
            credit: "TRAVNY"
    - kind: freebies
      title: "Freebies"
      cards:
        - title: "Game"
          price: "0 PLN"
          previousPrice: "Normal price"
          deadline: "Date and local time"
          body: "Store, region, ownership, requirements."
          links: [{label: "Claim", url: "https://example.org/"}]
    - kind: cars
      title: "Cars"
      cards:
        - title: "Make · model · trim"
          price: "Listing price"
          facts:
            - {label: "Year", value: "Year"}
            - {label: "Mileage", value: "Mileage"}
            - {label: "Transmission", value: "Automatic"}
          body: "Actual equipment."
          links: [{label: "Listing", url: "https://example.org/"}]
  note: "Snapshot at publication."
---

Polish editorial prose. Delete unused blocks and replace all placeholders.
