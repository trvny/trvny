# Gremlin knowledge: Brainrot

Purpose: make Gremlin reliably read, write, explain, translate, review, test and debug Brainrot without inventing syntax or treating it as blind C keyword substitution.

## Authority and freshness

Primary upstream: `Brainrotlang/brainrot`.
Reference snapshot used for this guide: `19b9563f0a7c39402f2003d9bfeb782755354bf1` (2026-09-07).

Treat this file as maintained orientation, not a frozen language specification. For newly added features, exact parser edge cases, or behavior that conflicts with this guide, inspect the current upstream README, `docs/the-brainrot-programming-language.md`, `docs/brainrot-user-guide.md`, examples and tests. Prefer executable tests over prose when they disagree.

Recent deltas that matter for generated code:

- `rant + rant` now concatenates strings and returns a new independent `rant`; `yapcat(a, b)` still works but is deprecated in favor of `a + b`.
- `rant + number` remains invalid. There is no implicit stringification.
- `giga` / `thicc` now have real wide-integer execution paths. `thicc` is the dependable 64-bit integer choice; `giga` still models platform `long`, including wasm32 width differences in packed/layout contexts.
- The old aspirational names `whopper`, `cringe` and `unc` are dropped ideas, not supported language features. Do not generate them.

## Mental model

Brainrot is a C-like interpreted language implemented with Flex/Bison and a C runtime. Familiar C control-flow and data-model ideas map to slang keywords, but Brainrot has its own semantic analyzer, initializer rules, string model, module system and native standard runtime.

Native builds primarily target POSIX/macOS/Linux. The project also ships a WebAssembly build. Windows is not a native upstream target.

Typical native run:

```sh
./brainrot program.brainrot
```

Minimal program:

```c
skibidi main {
    yapping("Hello from the cursed compiler.");
    bussin 0;
}
```

## Core keyword map

| Brainrot | Meaning |
| --- | --- |
| `skibidi` | `void` |
| `rizz` | `int` |
| `cap` | boolean |
| `chad` | `float` |
| `gigachad` | `double` |
| `yap` | `char` |
| `rant` | string |
| `giga` | `long` |
| `smol` | `short` |
| `thicc` | `long long` |
| `nut` | signed |
| `nonut` | unsigned |
| `deadass` | const |
| `salty` | static |
| `schizo` | volatile |
| `lit` | typedef |
| `gang` | struct |
| `chungus` | union |
| `gyatt` | enum |
| `edgy` | if |
| `amogus` | else |
| `flex` | for |
| `goon` | while |
| `mewing` | do |
| `ohio` | switch |
| `sigma rule` | case |
| `based` | default |
| `bruh` | break |
| `grind` | continue |
| `bussin` | return |
| `maxxing` | sizeof |
| `W` | true |
| `L` | false |
| `#cooked` | source/native module mechanism |

Do not infer support from memes, old issue discussions or removed keyword tables. If a spelling is not in the current grammar/tests, do not emit it.

## Types, declarations and expressions

Scalar declarations are C-shaped:

```c
rizz count = 3;
cap ready = W;
chad ratio = 0.5;
gigachad precise = 1.25;
yap letter = 'A';
rant name = "Gremlin";
thicc huge = 5000000000;
```

Arithmetic, comparison, logical `&&` / `||`, unary `!`, and prefix/postfix increment/decrement exist. Type checking is stricter than casual C coercion. Boolean and integer values are distinct in semantic checks in places where C might coerce them.

`!` evaluates scalar or pointer truth and yields a `cap`. Pointer `!p` is a null check. Do not apply it to aggregates or strings as if they had implicit scalar truthiness.

For wide integers:

- prefer `rizz` for ordinary counters and indexes;
- prefer `thicc` when the value must safely exceed 32-bit range across targets;
- use `giga` when `long` semantics are specifically intended;
- remember wasm32 keeps `long`-style layout narrower than common LP64 native builds.

## Control flow

If/else:

```c
edgy (score > 10) {
    yapping("W");
} amogus {
    yapping("L");
}
```

For loop:

```c
flex (rizz i = 0; i < 5; i++) {
    yapping("%d", i);
}
```

While and do-while:

```c
goon (n > 0) {
    n--;
}

mewing {
    n++;
} goon (n < 3);
```

Switch:

```c
ohio (choice) {
    sigma rule 1:
        yapping("one");
        bruh;
    sigma rule 2:
        yapping("two");
        bruh;
    based:
        yapping("other");
}
```

`based` is position-sensitive in the current interpreter. Put it last unless deliberately testing that quirk.

## Functions

Definitions resemble C:

```c
rizz add(rizz a, rizz b) {
    bussin a + b;
}
```

`skibidi` is for no return value. Return values and arguments are semantically checked.

Arrays are not passed or returned by value. Use pointer parameters for caller-owned arrays. Aggregates support specific by-value paths, but not every expression C would accept. For struct/union arguments, return values and initializers, prefer forms already covered by upstream tests.

## Pointers

C-style pointer declarations, address-of and dereference are supported, including multiple levels:

```c
rizz value = 10;
rizz *p = &value;
rizz **pp = &p;
*p = 20;
```

Pointer arithmetic supports pointer plus/minus integer. Normal lifetime hazards still apply. Returning an address of a local is still a dangling-pointer bug wearing a meme costume.

## Arrays and aggregates

Arrays and multidimensional arrays are supported for scalar and aggregate element types:

```c
rizz nums[4];
gang Point points[3];
gang Point grid[2][2];
```

Indexing composes with member access, such as `points[i].x` and `grid[r][c].y`.

Current aggregate limitations remain important: whole-struct assignment into an existing array element and arbitrary aggregate brace initialization are not generally interchangeable with C. Prefer field-wise assignment or a fixture-proven copy path.

Struct example:

```c
gang Point {
    rizz x;
    rizz y;
};

skibidi main {
    gang Point p = {3, 4};
    yapping("%d %d", p.x, p.y);
    bussin 0;
}
```

Use `chungus` for unions, `gyatt` for enums and `lit` for aliases.

## Strings and text processing

`rant` is a dedicated length-prefixed byte string. `yap` is a character. String operations are byte-oriented, not Unicode-character-oriented. For example, `yaplen("é")` counts UTF-8 bytes, not user-perceived characters.

Current string toolkit:

- `a + b`: preferred concatenation of two `rant`s; returns an independent new value.
- `yapcat(a, b)`: deprecated compatibility concatenation.
- `yaplen(s)`: byte length.
- `yapcmp(a, b)`: string comparison.
- `yapidx(haystack, needle)`: search/index helper.
- `s[i]`: byte-oriented indexing.
- `s[i:j]`: byte-oriented slicing.

Example:

```c
rant first = "Big";
rant last = "Chungus";
rant full = first + " " + last;
yapping("%s", full);
```

Do not concatenate strings with numbers directly. Convert or format explicitly using a supported runtime path.

String indexing/slicing makes ordinary parsing possible. When implementing a delimiter parser, scanner or lightweight tokenizer, track byte offsets with `rizz`, use `yaplen` for bounds, and slice only after validating the offsets.

## Standard runtime built-ins

Important calls include:

- `yapping(...)`: output with trailing newline.
- `yappin(...)`: output without automatic newline.
- `baka(...)`: diagnostic output to stderr.
- `ragequit(code)`: terminate with an exit status.
- `chill(seconds)`: blocking sleep.
- `slorp(...)`: input helper.
- `bet(condition[, message])`: assertion; failure reports and exits, success returns `W`.
- `gamba(...)`: cryptographically safe random integer functionality backed by OpenSSL in native builds.
- string helpers described above.

Signatures and accepted types matter. Verify the current user guide or `stdrot/` implementation for nontrivial calls. OpenSSL/libcrypto is a native standard-runtime dependency, not merely a dependency of code that calls `gamba`.

## Modules: `#cooked`

Quoted source module:

```c
#cooked "helpers.brainrot"
```

The path is resolved relative to the including source and spliced by the Brainrot module loader.

Named module:

```c
#cooked <name>
```

Named modules resolve through the Brainrot module search path and may be source modules or native shared modules. Native modules use the runtime registration/ABI mechanism. Do not model `#cooked` as plain C `#include`.

The optional raylib integration is a module used by project examples. It is not a core interpreter dependency.

## WebAssembly

`make wasm` builds browser/Node-compatible interpreter artifacts with the standard runtime statically linked.

Important differences:

- wasm32 uses 32-bit `long` semantics/layout where native LP64 commonly uses 64-bit;
- `thicc` is the safer portable 64-bit integer choice;
- `chill()` blocks the JS thread, so browser integrations should isolate potentially sleeping execution.

## Programming cookbook

Use these patterns before inventing clever equivalents.

### Counter / accumulator

```c
skibidi main {
    rizz total = 0;
    flex (rizz i = 1; i <= 10; i++) {
        total = total + i;
    }
    yapping("%d", total);
    bussin 0;
}
```

### Array traversal

```c
skibidi main {
    rizz nums[4];
    nums[0] = 4;
    nums[1] = 8;
    nums[2] = 15;
    nums[3] = 16;

    rizz total = 0;
    flex (rizz i = 0; i < 4; i++) {
        total = total + nums[i];
    }
    yapping("%d", total);
    bussin 0;
}
```

### String assembly

```c
rant label(rant name) {
    bussin "hello, " + name;
}

skibidi main {
    rant message = label("Gremlin");
    yapping("%s", message);
    bussin 0;
}
```

### Guarded parsing shape

For text parsing, prefer this sequence:

1. obtain `yaplen(input)`;
2. walk byte indexes with `rizz`;
3. check bounds before `s[i]` or `s[i:j]`;
4. identify delimiters using supported byte/string comparisons;
5. slice only validated ranges;
6. use `bet` for invariants in tests, not as a substitute for user-facing error handling.

### Decomposition

For nontrivial programs, split behavior into small typed functions rather than building a 200-line `main`. Keep ownership and lifetime obvious. If a function needs to mutate caller data, use pointers rather than pretending arrays pass by value.

## Translation playbook

When translating from C/C++:

- preserve behavior, not surface syntax;
- map supported scalar types directly;
- replace unsupported preprocessing, extern/goto/inline-asm ideas rather than emitting old placeholder names;
- replace array-by-value APIs with pointer-based APIs;
- verify aggregate copies and initializers against current tests;
- use `rant` operations instead of C string-pointer assumptions.

When translating from Python/JavaScript:

- choose explicit Brainrot types instead of dynamic values;
- replace `for x in collection` with indexed `flex` loops when appropriate;
- replace truthy/falsy shortcuts with explicit typed comparisons;
- replace exceptions/promises/async constructs with explicit result/control-flow patterns unless a current Brainrot feature directly models them;
- convert high-level strings to byte-oriented `rant` logic deliberately;
- do not smuggle unsupported behavior through native modules unless the user actually requested an extension.

When generating from prose:

1. state the data model internally first;
2. select the smallest supported constructs;
3. write one complete runnable program;
4. validate syntax and semantics;
5. only then optimize or make it more cursed.

## Debugging model

Classify failures before editing:

1. lexer/parser: spelling, delimiters, unsupported grammar;
2. semantic/type: incompatible assignment, argument, return or operator types;
3. runtime: bounds, pointer lifetime, module loading, native ABI, built-in behavior;
4. environment/build: dependencies, module paths, POSIX/WASM differences.

Reduce failures to the smallest reproducer, then compare with the closest upstream fixture. Fix the minimal semantic mismatch instead of translating everything back to C.

## Verification ladder

For generated Brainrot, use the strongest available level and report which level was reached:

1. **Source check**: compare syntax/semantics with current docs and tests.
2. **Parse/run**: execute `./brainrot program.brainrot` and require the expected exit status/output.
3. **Regression fixture**: for a bug fix or language-edge task, reproduce with a tiny fixture next to the relevant upstream-style examples/tests.
4. **Target check**: if the user targets WASM, native modules or raylib, validate that target rather than assuming native interpreter behavior transfers.

Never say "tested" when only source review happened. Use "syntax-reviewed" or "source-reviewed" instead.

## Common failure modes

1. Treating Brainrot as blind keyword substitution over arbitrary C.
2. Generating removed or imagined keywords.
3. Assuming C implicit conversions.
4. Returning/passing arrays by value.
5. Assuming arbitrary aggregate assignment/initialization works.
6. Putting `based` before later `sigma rule` cases.
7. Forgetting native runtime/module dependencies.
8. Claiming native Windows support.
9. Ignoring wasm32 `long` differences.
10. Inventing built-in signatures.
11. Using `yapcat` for new code when `+` is clearer.
12. Mixing `rant` with numbers under `+` and expecting coercion.
13. Treating byte indexes as Unicode character indexes.

## Gremlin operating procedure

When asked to write Brainrot:

1. Identify behavior in ordinary pseudocode.
2. Choose explicit types and supported data structures.
3. Map control flow to Brainrot constructs.
4. Prefer constructs demonstrated in current docs/examples/tests.
5. Keep `based` last.
6. Avoid removed/imagined features.
7. Prefer `rant + rant` over deprecated `yapcat` in new code.
8. Run the actual interpreter when execution tools are available and repair parser/semantic/runtime failures before answering.
9. If execution is unavailable, say the code is source-reviewed rather than tested.
10. Inspect current upstream for obscure or rapidly changing features.

When asked to debug Brainrot:

1. classify the failure;
2. reduce it;
3. find the closest upstream fixture;
4. patch the smallest mismatch;
5. rerun the exact native/WASM/module target.

When asked for substantial Brainrot code, correctness outranks meme density. The syntax is already ridiculous enough.

## Upstream trail

Use these in descending order when exactness matters:

1. current tests and fixtures;
2. `docs/the-brainrot-programming-language.md`;
3. `docs/brainrot-user-guide.md`;
4. current README and examples;
5. parser, semantic analyzer and runtime implementation.

The language evolves quickly. "I remember Brainrot syntax" is not a verification strategy.
