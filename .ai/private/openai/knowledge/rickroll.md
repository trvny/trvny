# Gremlin knowledge: Rickroll-Lang

Purpose: make Gremlin reliably understand, write, explain, translate, review, test and debug Rickroll-Lang while distinguishing real syntax from lyric-shaped hallucinations and half-implemented parser experiments.

## Authority and freshness

Primary upstream: `Rick-Lang/rickroll-lang`.
Reference snapshot used for this guide: `5595a607ba782bd027e8d4102aa36f556e648015` (2025-02-08).

As of 2026-09-08, that is still the current upstream head. Primary implementation sources are `src/Keywords.py`, `src/Lexer.py`, `src/pyrickroll.py`, `src/interpreter.py`, tests/examples and the English docs.

The README/docs sometimes describe features more broadly than individual execution modes implement. When exact behavior matters, prefer the code path the user will actually run.

## Mental model

Rickroll-Lang is a Python-hosted esoteric language whose keywords are Rick Astley lyric fragments. The main practical path tokenizes Rickroll source and translates it to Python. The repository also contains a direct interpreter and an experimental C++ translation path.

The language is dynamic. Values can be integers, floats, strings and Python-like collections. Much expression behavior inherits from the Python translation target, but statement syntax and block structure are Rickroll-specific.

Typical invocation:

```sh
python src/RickRoll.py program.rickroll
```

Useful modes:

```sh
python src/RickRoll.py program.rickroll --time
python src/RickRoll.py program.rickroll --audio
python src/RickRoll.py -intpr program.rickroll
python src/RickRoll.py -cpp program.rickroll
```

Treat `-cpp` as experimental. Do not promise parity with the Python path.

## Lexer rule that explains the weirdness

Rickroll keywords are recognized in compact normalized forms. The lexer can merge whitespace-separated pieces into a known keyword, so human-facing code may use readable spacing while the lexer normalizes it.

For reasoning, use these compact forms:

| Compact keyword | Meaning |
| --- | --- |
| `takemetourheart` | main block |
| `saygoodbye` | close current block |
| `give` ... `up` | assignment / define variable |
| `ijustwannatelluhowimfeeling` | print expression |
| `andifuaskmehowimfeeling` | if |
| `togetherforeverwith` | while |
| `togetherforeverandnevertopart` | endless loop |
| `gonna` | function definition |
| `gotta` | function call statement |
| `whenigivemy` ... `itwillbecompletely` | return |
| `weknowthe` ... `andweregonnaplayit` | import |
| `thereaintnomistaking` | try |
| `iftheyevergetudown` | except |
| `desertu` | break |
| `runaround` | continue |
| `py` | embedded Python escape |

Comparison words normalize to greater-than, less-than, greater-or-equal, less-or-equal, equality and not-equal forms. Ordinary operator spellings are also accepted in several expression positions.

`~` and apostrophe tokens are ignored in relevant lexer paths. Decorative punctuation is decoration, not semantics.

## Program structure

Executable top-level code normally lives inside the main block:

```text
take me to ur heart
    give msg up "hello\n"
    i just wanna tell u how im feeling msg
say goodbye
```

Indentation does not close blocks. `say goodbye` does. Keep indentation anyway because future archaeologists deserve a chance.

The Python transpiler maps the main block to the normal Python `__main__` guard.

## Assignment and values

Assignment:

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

Rickroll-Lang is dynamic. Do not invent type declarations.

Expressions can use Python-like arithmetic, indexing, list literals and string concatenation where the lexer/transpiler accepts them. Built-in helpers recognized by the token model include `len`, `int`, `float` and `str`.

## Output

Print:

```text
i just wanna tell u how im feeling "status: "
i just wanna tell u how im feeling n
```

The Python backend emits `print(expr, end="")`, so output does not automatically gain a newline. Add `\n` deliberately when needed:

```text
i just wanna tell u how im feeling "done\n"
```

## Conditions

If block:

```text
and if u ask me how im feeling score > 10
    i just wanna tell u how im feeling "W\n"
say goodbye
```

Nested blocks each need their own `say goodbye`.

There is no conventional authoritative `else` keyword at this snapshot. Do not invent one. When logic needs two branches, use a complementary condition, an early return, or a flag.

Example with complementary conditions:

```text
and if u ask me how im feeling score > 10
    i just wanna tell u how im feeling "W\n"
say goodbye

and if u ask me how im feeling score <= 10
    i just wanna tell u how im feeling "L\n"
say goodbye
```

## Loops

Conditional loop:

```text
together forever with index < len(arr)
    give index up index + 1
say goodbye
```

Endless loop:

```text
together forever and never to part
    ...
say goodbye
```

`desert u` maps to break. `runaround` maps to continue in the Python translation path.

There is no normal `for` statement. Translate counted loops into initialize + `together forever with` + explicit increment.

Python:

```python
for i in range(5):
    print(i)
```

Rickroll-Lang shape:

```text
give i up 0
together forever with i < 5
    i just wanna tell u how im feeling str(i) + "\n"
    give i up i + 1
say goodbye
```

## Functions

Definition:

```text
gonna add a, b
    when i give my a + b it will be completely
say goodbye
```

Call statement:

```text
gotta add(2, 3)
```

The upstream examples use exactly this `gotta Function(args)` shape.

Parameters and return values are dynamic because the primary backend is Python. When debugging calls, inspect generated Python if possible. That separates Rickroll tokenization failures from ordinary Python runtime errors.

A real upstream-style example:

```text
gonna LinearSearch arr, target
    give index up 0

    together forever with index < len(arr)
        and if u ask me how im feeling arr[index] == target
            i just wanna tell u how im feeling "Found in index " + str(index) + "\n"
            when i give my index it will be completely
        say goodbye
        give index up index + 1
    say goodbye

    i just wanna tell u how im feeling "give up " + str(target) + " :(\n"
say good bye
```

## Imports

Import syntax uses the paired import keywords around a module name. The Python backend emits a normal Python import.

Imported code therefore inherits normal Python power and risk. Do not treat imports as sandboxed because the source language is funny.

## Embedded Python

`py:` is an explicit escape hatch. The Python transpiler writes the remainder into generated Python.

Treat Rickroll code containing `py:` as arbitrary Python for safety and review purposes.

For untrusted programs:

- do not execute with secrets in the environment;
- do not expose valuable filesystem state;
- do not provide unrestricted credentials or network access;
- prefer a disposable sandbox.

Use `py:` only when the user explicitly wants Python interop or when documenting the escape hatch. Do not use it to hide the fact that native Rickroll syntax cannot express something.

## Try/except

The keyword model and Python transpiler include try/except forms based on `there aint no mistaking` and `if they ever get u down`.

Older backend paths are fragile here. If code depends on exception behavior, verify generated Python against the current source and run it. Do not infer nesting from lyric aesthetics.

## Comments and strings

`#` starts a comment outside a quoted string.

Double quotes control quoted-string scanning. Preserve quoting carefully because lexer behavior changes inside strings.

Bizarre spacing may still tokenize, but Gremlin should default to readable canonical lyric spacing. Maximum cursedness is an optional presentation mode, not a correctness strategy.

## Execution modes

### Python translation

This is the compatibility baseline.

Strengths:

- broad expression support inherited from Python;
- straightforward control-flow and function mapping;
- easiest backend to inspect and debug.

Whenever possible, inspect the generated Python before diagnosing a mysterious runtime result.

### Interpreter

`-intpr` uses the direct interpreter path. Do not assume every transpiler feature behaves identically.

### C++ translation

`-cpp` is immature/buggy upstream. Only use it when the user specifically needs that backend, and inspect/compile the generated C++.

### Audio mode

`--audio` generates/plays audio from Rickroll source. Treat it as presentation, not semantic validation.

## Programming cookbook

Use these patterns instead of inventing missing syntax.

### Counter / accumulator

```text
take me to ur heart
    give i up 1
    give total up 0

    together forever with i <= 10
        give total up total + i
        give i up i + 1
    say goodbye

    i just wanna tell u how im feeling str(total) + "\n"
say goodbye
```

### Array traversal

```text
take me to ur heart
    give arr up [4, 8, 15, 16, 23, 42]
    give i up 0

    together forever with i < len(arr)
        i just wanna tell u how im feeling str(arr[i]) + "\n"
        give i up i + 1
    say goodbye
say goodbye
```

### Search with early return

Prefer early return over emulating `else` when a function has a natural success/failure result:

```text
gonna Find arr, target
    give i up 0
    together forever with i < len(arr)
        and if u ask me how im feeling arr[i] == target
            when i give my i it will be completely
        say goodbye
        give i up i + 1
    say goodbye
    when i give my -1 it will be completely
say goodbye
```

### State machine instead of unsupported constructs

For parsers, menu loops or multi-stage logic:

1. store state in a normal variable;
2. use `together forever with` as the driver loop;
3. use separate `and if u ask me how im feeling` blocks for each state;
4. change the state explicitly;
5. use `desert u` when complete.

This is more reliable than inventing `switch`, `match`, `else` or classes.

### String construction

The Python translation path supports normal string concatenation patterns in expressions:

```text
give label up "item=" + str(value) + "\n"
i just wanna tell u how im feeling label
```

Always convert non-string values deliberately with `str(...)` instead of assuming coercion.

## Translation playbook

### Python -> Rickroll-Lang

Map only the supported subset:

| Python | Rickroll-Lang strategy |
| --- | --- |
| `x = expr` | `give x up expr` |
| `print(expr)` | `i just wanna tell u how im feeling expr + "\n"` when a newline is desired |
| `if cond:` | `and if u ask me how im feeling cond` + `say goodbye` |
| `while cond:` | `together forever with cond` + `say goodbye` |
| `while True:` | `together forever and never to part` |
| `for i in range(n)` | initialize `i`, while loop, explicit increment |
| `def f(a, b)` | `gonna f a, b` |
| `return expr` | `when i give my expr it will be completely` |
| `f(a)` as statement | `gotta f(a)` |
| `break` | `desert u` |
| `continue` | `runaround` |

Do not translate arbitrary Python classes, comprehensions, generators, async code, decorators or context managers as if equivalents existed. Rewrite the behavior into supported primitives or clearly state the limitation.

### JavaScript -> Rickroll-Lang

- variables become `give ... up ...`;
- `while` maps naturally;
- counted `for` loops become explicit while loops;
- arrays map well to Python-like lists in the Python backend;
- object/class-heavy code needs redesign, not word substitution;
- promises/async/DOM APIs have no native equivalent;
- stringify values explicitly when constructing output.

### C/C++ -> Rickroll-Lang

Treat Rickroll-Lang as dynamic/Python-like, not C-like:

- remove static type declarations;
- rewrite pointer/manual-memory code into high-level values/collections;
- rewrite `for` loops to while loops;
- replace `switch` with explicit conditions/state;
- replace structs/classes with simpler collections only when semantics remain clear;
- do not preserve undefined behavior or manual lifetime tricks.

## Debugging model

Classify the failure before changing code:

1. lexer/tokenization: a lyric phrase did not normalize to a keyword;
2. block structure: missing or extra `say goodbye`;
3. transpilation: generated Python is syntactically wrong;
4. Python runtime: generated Python is valid but behavior/expression fails;
5. backend mismatch: transpiler works but `-intpr` / `-cpp` differs;
6. environment: dependency/import/audio issue.

Debug in that order. Do not rewrite a whole program because one lyric phrase tokenized badly.

## Verification ladder

For generated Rickroll-Lang, use the strongest available level and say which level was reached:

1. **Keyword/source review**: verify every statement keyword against `src/Keywords.py` / `src/Lexer.py` and compare with examples.
2. **Transpile**: run the standard Python translation path and inspect generated Python.
3. **Execute**: run the generated Python/Rickroll program and check output/exit behavior.
4. **Backend-specific**: if the user requests `-intpr`, `-cpp` or `--audio`, validate that exact mode separately.

Never call code "tested" if it was only visually reviewed.

## Common failure modes

1. Inventing a lyric-themed keyword not in `src/Keywords.py`.
2. Assuming indentation closes blocks.
3. Forgetting `say goodbye`.
4. Assuming print adds a newline.
5. Inventing conventional `else` or `for`.
6. Confusing older AST/parser placeholders with Python-transpiler behavior.
7. Claiming C++ backend parity.
8. Treating `py:` as sandboxed.
9. Breaking quoted strings and changing lexer behavior.
10. Using decorative spacing without checking normalization.
11. Translating arbitrary Python features instead of redesigning into the supported subset.
12. Using `py:` to conceal unsupported Rickroll semantics.

## Gremlin operating procedure

When asked to write Rickroll-Lang:

1. model the behavior in simple Python-like pseudocode;
2. restrict the design to supported Rickroll primitives;
3. use only keywords present in the current keyword/lexer tables;
4. keep every block balanced with `say goodbye`;
5. prefer the Python translation path unless another backend is requested;
6. avoid `py:` unless explicit interop is the point;
7. transpile and execute when tools are available;
8. inspect generated Python when something fails;
9. if execution is unavailable, label the code source-reviewed rather than tested;
10. favor readable lyric spacing over novelty spacing.

When asked to debug:

1. normalize/tokenize each keyword phrase;
2. verify block balance;
3. inspect generated Python;
4. separate Rickroll syntax from Python runtime errors;
5. keep the selected backend fixed;
6. reduce to the smallest reproducer;
7. repair the smallest mismatch and rerun.

When asked for substantial Rickroll-Lang code, correctness outranks rickroll density. The language has already committed to the bit.

## Upstream trail

Use these in descending order when exactness matters:

1. `src/Keywords.py` and `src/Lexer.py`;
2. the backend implementation actually being used, especially `src/pyrickroll.py`;
3. examples and tests;
4. English docs and README;
5. older parser/AST code only as supporting evidence.

The project is intentionally ridiculous. The debugging method should not be.
