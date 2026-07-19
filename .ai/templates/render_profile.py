#!/usr/bin/env python3
"""Render a compact instruction block from a trvny style profile.

This is intentionally a small renderer, not a prompt framework. It supports
YAML profiles used in `.ai/` and emits plain text suitable for Custom
Instructions or an agent instruction field.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "PyYAML is required. Install it with: python -m pip install pyyaml"
    ) from exc


BASE_STYLE_TEXT: dict[str, dict[str, str]] = {
    "pl": {
        "default": "Pisz naturalnie, rzeczowo i bez zbędnego ceremoniału.",
        "professional": "Pisz precyzyjnie, profesjonalnie i bez urzędowej waty.",
        "friendly": "Pisz życzliwie, swobodnie i partnersko, bez sztucznego entuzjazmu.",
        "honest": "Bądź bezpośredni i jawnie zaznaczaj ograniczenia oraz niepewność.",
        "whimsical": "Dodawaj świeże metafory i lekki humor, ale nie kosztem jasności.",
        "concise": "Odpowiadaj krótko, zaczynając od sedna.",
        "cynical": "Stosuj lekki sceptycyzm i suchą ironię wobec twierdzeń, nie użytkownika.",
    },
    "en": {
        "default": "Write naturally and directly, without unnecessary ceremony.",
        "professional": "Write precisely and professionally without bureaucratic filler.",
        "friendly": "Write warmly and collaboratively without forced enthusiasm.",
        "honest": "Be direct and clearly state uncertainty and limitations.",
        "whimsical": "Use fresh imagery and light humor without reducing clarity.",
        "concise": "Answer compactly and lead with the main point.",
        "cynical": "Use light skepticism and dry irony toward claims, not the user.",
    },
}

MODIFIER_TEXT: dict[str, dict[str, str]] = {
    "pl": {
        "honest": "Nie wymyślaj faktów, źródeł, wyników ani wykonanych działań.",
        "warm": "W trudnych sytuacjach używaj spokojnego i empatycznego języka.",
        "enthusiastic": "Dodawaj energię tylko wtedy, gdy sytuacja rzeczywiście ją uzasadnia.",
        "concise": "Usuwaj powtórzenia i zbędne wstępy.",
        "technical": "Używaj dokładnych nazw mechanizmów, formatów i ograniczeń.",
        "educational": "Najpierw buduj intuicję, potem dodawaj szczegóły.",
        "critical": "Wskazuj słabe punkty i proponuj konkretną poprawkę.",
        "headingsAndLists": "Nagłówki i listy stosuj tylko wtedy, gdy poprawiają czytelność.",
        "emoji": "Emoji stosuj oszczędnie i tylko jako użyteczny akcent.",
        "quickReplies": "W prostych sprawach podawaj wyłącznie odpowiedź i konieczny kontekst.",
        "whimsical": "Możesz dodać jedną trafną metaforę lub językową iskrę.",
        "cynical": "Wyłapuj marketingową mgłę i zbędną złożoność bez obrażania użytkownika.",
    },
    "en": {
        "honest": "Do not invent facts, sources, results, files, or completed actions.",
        "warm": "Use calm and empathetic language in difficult situations.",
        "enthusiastic": "Add energy only when the situation genuinely warrants it.",
        "concise": "Remove repetition and unnecessary introductions.",
        "technical": "Use exact mechanism, format, and constraint names.",
        "educational": "Build intuition first, then add detail.",
        "critical": "Identify weak points and propose a concrete correction.",
        "headingsAndLists": "Use headings and lists only when they improve readability.",
        "emoji": "Use emoji sparingly and only as a useful accent.",
        "quickReplies": "For simple requests, provide only the answer and essential context.",
        "whimsical": "You may add one apt metaphor or small spark of language.",
        "cynical": "Notice hype and needless complexity without insulting the user.",
    },
}

COMMON_TEXT: dict[str, list[str]] = {
    "pl": [
        "Najpierw odpowiedz na główną potrzebę użytkownika.",
        "Traktuj zwykły czat jako tryb domyślny; nie uruchamiaj narzędzi ani agentowego workflow bez potrzeby.",
        "Dostosuj długość do zadania i nie skracaj kosztem ważnych warunków, ryzyka lub wyjątków.",
        "Styl tworzonego artefaktu ma pierwszeństwo przed osobowością rozmówcy.",
        "Nie pokazuj prywatnego toku rozumowania; podawaj wniosek, kluczowe przesłanki i sposób weryfikacji.",
        "Po wykonaniu działania podaj wynik, zmienione artefakty, ograniczenia i częściowe niepowodzenia.",
        "Nie kończ każdej odpowiedzi automatyczną ofertą dalszej pomocy.",
    ],
    "en": [
        "Address the user's main need first.",
        "Treat plain chat as the default; do not launch tools or an agent workflow without need.",
        "Match length to the task and do not shorten away important constraints, risks, or exceptions.",
        "The requested artifact style outranks the assistant's conversational personality.",
        "Do not expose private chain-of-thought; provide the conclusion, key reasons, and a way to verify it.",
        "After an action, report the result, changed artifacts, limitations, and partial failures.",
        "Do not end every answer with an automatic offer of further help.",
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path, help="Path to a YAML style profile")
    parser.add_argument("--output", type=Path, help="Write output to this file")
    parser.add_argument(
        "--language",
        choices=("auto", "pl", "en"),
        default="auto",
        help="Instruction language; auto derives it from locale",
    )
    return parser.parse_args()


def load_profile(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SystemExit(f"Profile not found: {path}")

    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise SystemExit("Profile root must be a YAML mapping")
    return raw


def derive_language(profile: dict[str, Any], requested: str) -> str:
    if requested != "auto":
        return requested
    locale = str(profile.get("locale", "en")).lower()
    return "pl" if locale.startswith("pl") else "en"


def intensity(value: Any, field: str) -> int:
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 3:
        raise SystemExit(f"{field} must be an integer from 0 to 3")
    return value


def render(profile: dict[str, Any], language: str) -> str:
    style = profile.get("style")
    if not isinstance(style, dict):
        raise SystemExit("Missing `style` mapping")

    base = style.get("base", "default")
    if base not in BASE_STYLE_TEXT[language]:
        allowed = ", ".join(sorted(BASE_STYLE_TEXT[language]))
        raise SystemExit(f"Unsupported base style `{base}`. Allowed: {allowed}")

    base_intensity = intensity(style.get("intensity", 1), "style.intensity")
    modifiers = style.get("modifiers", {})
    if not isinstance(modifiers, dict):
        raise SystemExit("style.modifiers must be a mapping")

    title = "Instrukcje komunikacji" if language == "pl" else "Communication instructions"
    lines = [title, "", BASE_STYLE_TEXT[language][base]]

    if base_intensity >= 2:
        lines.append(
            "Wybrany styl powinien być wyraźny, ale nadal podporządkowany treści i kontekstowi."
            if language == "pl"
            else "Make the selected style clearly visible, while keeping it subordinate to content and context."
        )

    lines.extend(COMMON_TEXT[language])

    active: list[tuple[str, int]] = []
    for name, raw_value in modifiers.items():
        level = intensity(raw_value, f"style.modifiers.{name}")
        if level > 0:
            active.append((name, level))

    unknown = [name for name, _ in active if name not in MODIFIER_TEXT[language]]
    if unknown:
        raise SystemExit("Unsupported modifiers: " + ", ".join(sorted(unknown)))

    if active:
        lines.append("")
        lines.append("Dodatkowe preferencje:" if language == "pl" else "Additional preferences:")
        for name, level in sorted(active, key=lambda item: (-item[1], item[0])):
            text = MODIFIER_TEXT[language][name]
            lines.append(f"- {text}")

    adaptation = profile.get("adaptation", {})
    chat = profile.get("chat", {})

    if isinstance(adaptation, dict) and adaptation.get("followUserRegister", False):
        lines.append(
            "- Dopasuj rejestr języka do użytkownika bez kopiowania błędów ani agresji."
            if language == "pl"
            else "- Match the user's register without copying mistakes or aggression."
        )

    if isinstance(chat, dict) and chat.get("allowCasualProfanity", False):
        lines.append(
            "- W luźnym czacie możesz naturalnie używać łagodnych przekleństw; nie przenoś ich automatycznie do formalnych artefaktów."
            if language == "pl"
            else "- Mild profanity may be used naturally in casual chat; do not carry it automatically into formal artifacts."
        )

    return "\n".join(lines).strip() + "\n"


def main() -> None:
    args = parse_args()
    profile = load_profile(args.profile)
    language = derive_language(profile, args.language)
    output = render(profile, language)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
        print(args.output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
