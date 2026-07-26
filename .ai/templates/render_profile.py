#!/usr/bin/env python3
"""Render compact instructions from a trvny LLM style profile.

Schema 0.2 separates personality (voice) from collaboration (working behavior).
Legacy 0.1 profiles remain readable so older backups do not break.
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

COLLABORATION_TEXT: dict[str, dict[str, dict[str, str]]] = {
    "pl": {
        "preamble": {
            "off": "Nie zapowiadaj pracy przed odpowiedzią.",
            "multiStepOnly": "Krótko zapowiadaj plan tylko przed wieloetapową pracą lub działaniem zmieniającym stan.",
            "always": "Przed działaniem krótko zapowiadaj plan.",
        },
        "initiative": {
            "conservative": "Nie rozszerzaj zadania poza to, o co poproszono.",
            "balanced": "Samodzielnie wykonuj oczywiste kroki, ale nie poszerzaj zakresu bez powodu.",
            "proactive": "Aktywnie wychwytuj powiązane problemy i proponuj użyteczne ulepszenia.",
        },
        "verification": {
            "light": "Sprawdzaj podstawową spójność i widoczne błędy.",
            "normal": "Weryfikuj ważne twierdzenia, wyniki i wykonane działania proporcjonalnie do ryzyka.",
            "strict": "Wymagaj mocnych dowodów i pełnej walidacji przed stanowczym wnioskiem.",
        },
        "questionPolicy": {
            "blockingOnly": "Pytaj tylko wtedy, gdy brak informacji blokuje bezpieczny lub sensowny postęp.",
            "materialAmbiguity": "Pytaj także wtedy, gdy niejasność może istotnie zmienić rezultat.",
            "earlyAlignment": "Przy większych zadaniach wcześnie uzgadniaj cel, zakres i kryteria sukcesu.",
        },
        "assumptionPolicy": {
            "cautious": "Unikaj założeń; oznacz je i potwierdzaj, gdy mogą zmienić wynik.",
            "balanced": "Przyjmuj rozsądne, odwracalne założenia i jasno je zaznaczaj.",
            "decisive": "Podejmuj rozsądne decyzje samodzielnie, chyba że ryzyko jest istotne.",
        },
    },
    "en": {
        "preamble": {
            "off": "Do not announce work before answering.",
            "multiStepOnly": "Use a brief preamble only before multi-step work or state-changing actions.",
            "always": "Briefly state the plan before acting.",
        },
        "initiative": {
            "conservative": "Do not expand the task beyond what was requested.",
            "balanced": "Take obvious steps independently without broadening scope without reason.",
            "proactive": "Actively surface related problems and useful improvements.",
        },
        "verification": {
            "light": "Check basic consistency and visible errors.",
            "normal": "Verify important claims, results, and completed actions in proportion to risk.",
            "strict": "Require strong evidence and thorough validation before a firm conclusion.",
        },
        "questionPolicy": {
            "blockingOnly": "Ask only when missing information blocks safe or useful progress.",
            "materialAmbiguity": "Also ask when ambiguity could materially change the result.",
            "earlyAlignment": "For larger tasks, align early on goal, scope, and success criteria.",
        },
        "assumptionPolicy": {
            "cautious": "Avoid assumptions; label and confirm them when they may change the outcome.",
            "balanced": "Make reasonable, reversible assumptions and state them clearly.",
            "decisive": "Make reasonable decisions independently unless the risk is material.",
        },
    },
}

BOOLEAN_TEXT: dict[str, dict[str, str]] = {
    "pl": {
        "answerFirst": "Najpierw podaj odpowiedź, wynik lub decyzję.",
        "plainChatIsDefault": "Zwykły czat jest trybem domyślnym; narzędzia i agentowe workflow uruchamiaj tylko z realnej potrzeby.",
        "respectExplicitTurnInstructions": "Jawne polecenie z bieżącej wiadomości ma pierwszeństwo przed domyślnym stylem.",
        "avoidRoutinePraise": "Nie zaczynaj automatycznie od pochwał.",
        "avoidRoutineFollowUpOffer": "Nie kończ każdej odpowiedzi rutynową ofertą dalszej pomocy.",
        "announceOnlyMaterialActions": "Aktualizacje postępu podawaj tylko przy istotnych etapach, ryzyku lub zmianie stanu.",
        "reportPartialFailures": "Wyraźnie odróżniaj pełny sukces, częściowy sukces i niepowodzenie.",
        "preferResultOverProcess": "Pokazuj wynik przed opisem procesu.",
    },
    "en": {
        "answerFirst": "Lead with the answer, result, or decision.",
        "plainChatIsDefault": "Plain chat is the default; use tools or agent workflows only when genuinely needed.",
        "respectExplicitTurnInstructions": "Explicit instructions in the current turn override style defaults.",
        "avoidRoutinePraise": "Do not open with automatic praise.",
        "avoidRoutineFollowUpOffer": "Do not end every response with a routine offer of more help.",
        "announceOnlyMaterialActions": "Give progress updates only for material stages, risk, or state changes.",
        "reportPartialFailures": "Clearly distinguish complete success, partial success, and failure.",
        "preferResultOverProcess": "Present the result before the process.",
    },
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


def normalize(profile: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    personality = profile.get("personality")
    collaboration = profile.get("collaboration")

    if personality is not None or collaboration is not None:
        if not isinstance(personality, dict):
            raise SystemExit("Missing `personality` mapping")
        if not isinstance(collaboration, dict):
            raise SystemExit("Missing `collaboration` mapping")
        return personality, collaboration

    style = profile.get("style")
    if not isinstance(style, dict):
        raise SystemExit("Missing `personality` mapping (or legacy `style` mapping)")

    legacy_adaptation = profile.get("adaptation", {})
    legacy_chat = profile.get("chat", {})
    legacy_agent = profile.get("agent", {})
    if not isinstance(legacy_adaptation, dict):
        legacy_adaptation = {}
    if not isinstance(legacy_chat, dict):
        legacy_chat = {}
    if not isinstance(legacy_agent, dict):
        legacy_agent = {}

    personality = dict(style)
    personality["adaptation"] = {
        "followUserRegister": legacy_adaptation.get("followUserRegister", True),
        "preserveRequestedArtifactStyle": legacy_adaptation.get(
            "preserveRequestedArtifactStyle", True
        ),
        "reduceHumorInSeriousContexts": legacy_adaptation.get(
            "reduceHumorInSeriousContexts", True
        ),
        "mirrorLanguage": legacy_chat.get("mirrorLanguage", True),
        "allowCasualProfanity": legacy_chat.get("allowCasualProfanity", False),
    }
    collaboration = {
        "preamble": (
            "multiStepOnly"
            if legacy_agent.get("announceOnlyMaterialActions", True)
            else "always"
        ),
        "initiative": "balanced",
        "verification": "normal",
        "questionPolicy": (
            "blockingOnly"
            if legacy_chat.get("askOnlyBlockingQuestions", True)
            else "materialAmbiguity"
        ),
        "assumptionPolicy": "balanced",
        "answerFirst": legacy_chat.get("answerFirst", True),
        "plainChatIsDefault": legacy_adaptation.get("plainChatIsDefault", True),
        "respectExplicitTurnInstructions": legacy_adaptation.get(
            "respectExplicitTurnInstructions", True
        ),
        "avoidRoutinePraise": legacy_chat.get("avoidRoutinePraise", True),
        "avoidRoutineFollowUpOffer": legacy_chat.get(
            "avoidRoutineFollowUpOffer", True
        ),
        "announceOnlyMaterialActions": legacy_agent.get(
            "announceOnlyMaterialActions", True
        ),
        "reportPartialFailures": legacy_agent.get("reportPartialFailures", True),
        "preferResultOverProcess": legacy_agent.get("preferResultOverProcess", True),
    }
    return personality, collaboration


def render(profile: dict[str, Any], language: str) -> str:
    personality, collaboration = normalize(profile)

    base = personality.get("base", "default")
    if base not in BASE_STYLE_TEXT[language]:
        allowed = ", ".join(sorted(BASE_STYLE_TEXT[language]))
        raise SystemExit(f"Unsupported base style `{base}`. Allowed: {allowed}")

    base_intensity = intensity(personality.get("intensity", 1), "personality.intensity")
    modifiers = personality.get("modifiers", {})
    adaptation = personality.get("adaptation", {})
    if not isinstance(modifiers, dict):
        raise SystemExit("personality.modifiers must be a mapping")
    if not isinstance(adaptation, dict):
        raise SystemExit("personality.adaptation must be a mapping")

    title = "Profil komunikacji" if language == "pl" else "Communication profile"
    personality_title = "Osobowość" if language == "pl" else "Personality"
    collaboration_title = "Współpraca" if language == "pl" else "Collaboration"
    boundaries_title = "Granice" if language == "pl" else "Boundaries"

    lines = [
        title,
        "",
        f"{personality_title}:",
        f"- {BASE_STYLE_TEXT[language][base]}",
    ]
    if base_intensity >= 2:
        lines.append(
            "- Wybrany styl ma być wyraźny, ale nadal podporządkowany treści i kontekstowi."
            if language == "pl"
            else "- Make the selected style visible while keeping it subordinate to content and context."
        )

    active: list[tuple[str, int]] = []
    for name, raw_value in modifiers.items():
        level = intensity(raw_value, f"personality.modifiers.{name}")
        if level > 0:
            active.append((name, level))

    unknown = [name for name, _ in active if name not in MODIFIER_TEXT[language]]
    if unknown:
        raise SystemExit("Unsupported modifiers: " + ", ".join(sorted(unknown)))

    for name, _level in sorted(active, key=lambda item: (-item[1], item[0])):
        lines.append(f"- {MODIFIER_TEXT[language][name]}")

    if adaptation.get("followUserRegister", False):
        lines.append(
            "- Dopasuj rejestr do użytkownika bez kopiowania błędów ani agresji."
            if language == "pl"
            else "- Match the user's register without copying mistakes or aggression."
        )
    if adaptation.get("preserveRequestedArtifactStyle", False):
        lines.append(
            "- Styl zamawianego artefaktu ma pierwszeństwo przed osobowością rozmowy."
            if language == "pl"
            else "- The requested artifact style outranks conversational personality."
        )
    if adaptation.get("reduceHumorInSeriousContexts", False):
        lines.append(
            "- Ogranicz humor w kontekstach poważnych, ryzykownych lub wrażliwych."
            if language == "pl"
            else "- Reduce humor in serious, risky, or sensitive contexts."
        )
    if adaptation.get("mirrorLanguage", False):
        lines.append(
            "- Odpowiadaj w języku użytkownika, chyba że poprosi inaczej."
            if language == "pl"
            else "- Reply in the user's language unless asked otherwise."
        )
    if adaptation.get("allowCasualProfanity", False):
        lines.append(
            "- W luźnym czacie dopuszczalne są naturalne, łagodne przekleństwa; nie przenoś ich automatycznie do formalnych artefaktów."
            if language == "pl"
            else "- Mild profanity may be used naturally in casual chat; do not carry it automatically into formal artifacts."
        )

    lines.extend(["", f"{collaboration_title}:"])
    for field in (
        "preamble",
        "initiative",
        "verification",
        "questionPolicy",
        "assumptionPolicy",
    ):
        value = collaboration.get(field)
        choices = COLLABORATION_TEXT[language][field]
        if value not in choices:
            raise SystemExit(
                f"Unsupported collaboration.{field} `{value}`. Allowed: "
                + ", ".join(choices)
            )
        lines.append(f"- {choices[value]}")

    for field, text in BOOLEAN_TEXT[language].items():
        if collaboration.get(field, False):
            lines.append(f"- {text}")

    lines.extend(
        [
            "",
            f"{boundaries_title}:",
            (
                "- Ten profil opisuje głos i sposób współpracy. Nie przyznaje narzędzi, uprawnień, dostępu do sieci ani prawa do zmiany zewnętrznego stanu."
                if language == "pl"
                else "- This profile describes voice and collaboration. It does not grant tools, permissions, network access, or authority to change external state."
            ),
            (
                "- Nie pokazuj prywatnego toku rozumowania; podawaj wniosek, kluczowe przesłanki i sposób weryfikacji."
                if language == "pl"
                else "- Do not expose private chain-of-thought; provide the conclusion, key reasons, and a way to verify it."
            ),
        ]
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
