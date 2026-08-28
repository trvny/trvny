# Gremlin knowledge: Rickroll-Lang

Purpose: make Gremlin reliably understand, write, explain, translate and debug Rickroll-Lang while distinguishing documented syntax from half-implemented parser experiments.

## Authority and freshness

Primary upstream: `Rick-Lang/rickroll-lang`.
Reference snapshot used for this guide: `5595a607ba782bd027e8d4102aa36f556e648015` (2025-02-08).

Primary implementation sources at that snapshot are `src/Keywords.py`, `src/Lexer.py`, `src/pyrickroll.py`, `src/interpreter.py`, the English docs and examples.

The README/docs sometimes describe features more broadly than individual execution modes implement. When exact behavior matters, prefer the code path the user will actually run.

## Mental model

Rickroll-Lang is a Python-hosted esoteric language whose keyword spellings are based on Rick Astley references. The main practical execution path tokenizes Rickroll source and translates it to Python; the project also contains an interpreter and an experimental C++ translation path.

The language is dynamic. Values can be integers, floats, strings and Python-like collections. A great deal of expression behavior inherits from the Python translation target.

Typical invocation from the project:

```sh
python src/RickRoll.py program.rickroll
```

Useful modes include:

```sh
python src/RickRoll.py program.rickroll --time
python src/RickRoll.py program.rickroll --audio
python src/RickRoll.py -intpr program.rickroll
python src/RickRoll.py -cpp program.rickroll
```

Treat `-cpp` as experimental. Do not promise feature parity with the Python path.

## Lexer rule that explains the weirdness

Rickroll keywords are internally recognized in compact normalized forms. The lexer can merge whitespace-separated pieces into a known keyword, which is why keyword phrases may be split unusually and still parse.

For reasoning, use the compact forms below. When producing human-facing Rickroll code, normal readable spacing is fine only if it tokenizes back to the same compact keyword.

Important compact keyword identifiers:

| Compact keyword | Meaning |
| --- | --- |
| `takemetourheart` | main block |
| `saygoodbye` | close the current block |
| `give` ... `up` | assignment / define variable |
| `ijustwannatelluhowimfeeling` | print expression |
| `andifuaskmehowimfeeling` | if |
| `togetherforeverwith` | while |
| `togetherforeverandnevertopart` | endless loop |
| `gonna` | function definition |
| `gotta` | function call form |
| `whenigivemy` ... `itwillbecompletely` | return |
| `weknowthe` ... `andweregonnaplayit` | import |
| `thereaintnomistaking` | try |
| `iftheyevergetudown` | except |
| `desertu` | break |
| `runaround` | continue |
| `py` | embedded Python escape |

Comparison words normalize to forms representing greater-than, less-than, greater-or-equal, less-or-equal, equality and not-equal. The lexer/runtime also accepts ordinary operator spellings in several expression positions.

`~` and apostrophe tokens are ignored by the token model in relevant paths, so decorative spelling can be tolerated. Do not rely on decorative punctuation to carry semantics.

## Program structure

Executable top-level code is normally placed inside the main block.

Compact spelling example:

```text
takemetourheart
    give msg up "hello\n"
    ijustwannatelluhowimfeeling msg
saygoodbye
```

Indentation is not the block delimiter. `saygoodbye` closes blocks. Indentation is still worth keeping because humans deserve at least one mercy.

The Python transpiler maps the main block to the usual Python `__main__` guard.

## Assignment and values

Assignment is shaped as:

```text
give variable up expression
```

Examples:

```text
give n up 10
give ratio up 0.5
give name up "gremlin"
give values up [1, 2, 3]
```

Expressions are translated toward Python syntax. Collections can therefore look Pythonic where the tokenizer/transpiler accepts them.

Built-in expression helpers recognized by the token model include `len`, `int`, `float` and `str`.

Do not invent a static type declaration system. Rickroll-Lang is dynamic.

## Output

The compact print keyword is `ijustwannatelluhowimfeeling`.

```text
ijustwannatelluhowimfeeling "status: "
ijustwannatelluhowimfeeling n
```

The Python transpiler emits `print(expr, end="")`, so a newline is not automatically guaranteed. Include `\n` in a string when the output needs a line break.

## Conditions

An if block is:

```text
andifuaskmehowimfeeling condition
    ...
saygoodbye
```

Expressions can use comparison operators and Python-like arithmetic where supported by tokenization.

Nested blocks each require their own closing `saygoodbye`.

There is no conventional `else` keyword in the authoritative keyword enum at the reference snapshot. Do not invent one from the song/theme.

## Loops

Conditional loop:

```text
togetherforeverwith condition
    ...
saygoodbye
```

Endless loop:

```text
togetherforeverandnevertopart
    ...
saygoodbye
```

`desertu` maps to break. `runaround` maps to continue in the Python translation path.

Be wary of older parser code: some AST/parser branches contain placeholders even where the Python transpiler supports the corresponding keyword. Always reason about the selected execution mode.

## Functions

Definition:

```text
gonna add a, b
    whenigivemy a + b itwillbecompletely
saygoodbye
```

Call form uses `gotta` in the keyword model and Python-like call expressions in the transpiler path.

Function parameter/return behavior is dynamic because the primary backend is Python.

When debugging function calls, inspect the generated Python if possible. It often reveals whether the fault is Rickroll tokenization or ordinary Python expression syntax.

## Imports

Import syntax uses the paired import keywords around a module name. The Python backend emits a normal Python import.

This means imported-code capability is not a harmless toy feature. Execution inherits the power and risk of the Python environment.

## Embedded Python

`py:` is an explicit escape hatch. The Python transpiler writes the remainder of that statement into generated Python.

Treat any Rickroll program containing `py:` as arbitrary Python code for safety purposes.

For untrusted programs:

- do not execute with secrets in the environment;
- do not expose a valuable filesystem;
- do not provide unrestricted credentials or network access;
- prefer a disposable sandbox.

"Funny esolang" is not a security boundary.

## Try/except

The keyword model and Python transpiler include try/except forms:

```text
thereaintnomistaking
    ...
saygoodbye
```

and an exception block introduced by `iftheyevergetudown`.

The exact nesting emitted by older versions can be fragile. If producing code that depends on exception handling, verify the generated Python against the current source instead of relying on theme-based intuition.

## Comments and strings

`#` starts a comment outside a quoted string in the lexer.

Double quotes control quoted-string scanning. Preserve quoting carefully because the lexer changes behavior while inside a string.

Because keywords can be merged across separated tokens, bizarre spacing may still be legal. Prefer readable canonical spacing unless the user explicitly wants maximum cursedness.

## Execution modes

### Python translation

This is the safest baseline for compatibility reasoning. Inspect generated Python when debugging.

Strengths:
- broad expression support inherited from Python;
- straightforward mapping for control flow and functions;
- easiest backend to diagnose.

### Interpreter

`-intpr` uses the project's interpreter path. Do not assume every transpiler feature behaves identically.

### C++ translation

`-cpp` exists but upstream itself describes it as immature/buggy. Only recommend it when the user specifically needs it, and verify the generated C++.

### Audio mode

`--audio` generates/plays audio from Rickroll source. Treat this as an optional presentation feature, not part of core semantic correctness.

## Common failure modes

1. Inventing a lyric-themed keyword that is not in `src/Keywords.py`.
2. Assuming indentation closes blocks.
3. Forgetting a `saygoodbye`.
4. Assuming print adds a newline.
5. Confusing an older AST parser placeholder with behavior of the Python transpiler.
6. Claiming the C++ backend is equivalent to Python.
7. Treating `py:` as sandboxed.
8. Breaking a quoted string and accidentally changing lexer tokenization.
9. Assuming conventional `else`, `for`, classes or type declarations exist because Python has them.
10. Writing visually clever spacing without checking that the lexer rejoins it into a known keyword.

## Gremlin operating procedure

When asked to write Rickroll-Lang:

1. Model the target behavior in simple Python-like pseudocode.
2. Use only keyword families present in `src/Keywords.py`.
3. Keep block structure explicit and balanced with `saygoodbye`.
4. Prefer the Python translation path unless the user names another backend.
5. Avoid `py:` unless direct Python is actually the point.
6. If execution tools are available, run/transpile the program and inspect generated Python.
7. If execution is unavailable, label the result syntax-reviewed rather than tested.
8. For obscure or newly changed syntax, inspect current upstream first.

When asked to debug:

1. Tokenize mentally first: what compact keyword does each spaced phrase become?
2. Check block balance.
3. Check generated Python.
4. Separate Rickroll syntax errors from Python runtime errors.
5. Confirm whether the user is using Python translation, interpreter or C++ mode.
6. Reduce to the smallest reproducer and keep the backend fixed while debugging.

When translating Python to Rickroll-Lang:

- use the supported subset, not arbitrary Python;
- rewrite unsupported constructs into assignments, conditions, while/endless loops and functions;
- do not hide unsupported semantics inside `py:` unless the user explicitly permits that shortcut;
- preserve data/output behavior over theatrical spelling.

## Upstream trail

Use these in descending order when exactness matters:

1. `src/Keywords.py` and `src/Lexer.py`;
2. backend implementation actually being used, especially `src/pyrickroll.py`;
3. tests and examples;
4. English docs and README;
5. older parser/AST code only as supporting evidence.

The project is intentionally ridiculous. The debugging method should not be.
