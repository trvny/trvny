# Gremlin knowledge: Brainrot

Purpose: make Gremlin reliably read, write, explain, translate, review and debug Brainrot without inventing syntax.

## Authority and freshness

Primary upstream: `Brainrotlang/brainrot`.
Reference snapshot used for this guide: `f2a9a5b11a40a9fcaca5fd0721705e7b393ddcba` (2026-08-28).

Treat this file as maintained orientation, not a frozen language specification. For a question about a newly added feature, an exact parser edge case, or behavior that conflicts with this guide, inspect the current upstream README, `docs/the-brainrot-programming-language.md`, `docs/brainrot-user-guide.md`, examples and tests. Prefer executable tests over prose when they disagree.

## Mental model

Brainrot is a C-like interpreted language implemented with Flex/Bison and a C runtime. Most familiar C control-flow and data-model ideas map to slang keywords, but Brainrot is not "C with a textual replace": semantic checks, supported initializers, module loading and built-ins have their own rules.

Native builds are primarily POSIX/macOS/Linux. The project also ships a WebAssembly build. Windows is not a native target in the upstream release model.

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
| `#cooked` | module/include mechanism |

Known keyword names that are not implemented at the reference snapshot include `whopper`/extern, `cringe`/goto and `unc`/inline assembly. Several C-preprocessor-like spellings are also placeholders rather than working directives. Never generate them merely because they appear in a keyword table.

## Declarations and expressions

Scalar declarations are C-shaped:

```c
rizz count = 3;
cap ready = W;
chad ratio = 0.5;
gigachad precise = 1.25;
yap letter = 'A';
rant name = "Gremlin";
```

The usual arithmetic and comparison operators exist. Logical `&&`, `||` and unary `!` are supported. Increment/decrement support both prefix and postfix forms.

Type checking is stricter than "whatever C would coerce". In particular, boolean and integer values are distinct in semantic checks in places where C would casually convert them. Do not assume an expression accepted by C is accepted by Brainrot.

`!` evaluates scalar/pointer truth in the operand's own type and yields a `cap`. Pointer `!p` acts as a null check. Do not apply `!` to aggregates or strings as though they had an implicit scalar truth value.

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

Important current quirk: `based` is position-sensitive. At the reference snapshot it may fire when scanning reaches it, so putting it before a later matching case can pre-empt that case. Put `based` last unless deliberately testing this behavior.

## Functions

Definitions resemble C:

```c
rizz add(rizz a, rizz b) {
    bussin a + b;
}
```

`skibidi` is for no return value. Return values and arguments are semantically checked.

Aggregates have more restrictions than scalars. Struct/union arguments and return values support specific by-value cases, including compatible variables, array elements, member expressions and aggregate-returning calls. Do not infer that arbitrary aggregate expressions work.

Arrays are not passed or returned by value. Use pointer parameters when a function must operate on caller-owned arrays.

## Pointers

C-style pointer declarations, address-of and dereference are supported, including multiple indirection levels:

```c
rizz value = 10;
rizz *p = &value;
rizz **pp = &p;
*p = 20;
```

Pointer arithmetic supports pointer plus/minus integer. Be conservative with lifetime rules: returning an address of a local has the same dangling-storage problem it would have in C.

A pointer to a struct can be returned as a pointer value. That does not magically extend the lifetime of pointed-to storage.

## Arrays

Arrays, including multidimensional arrays, are supported for scalar and aggregate element types.

```c
rizz nums[4];
gang Point points[3];
gang Point grid[2][2];
```

Indexing composes with member access, such as `points[i].x` and `grid[r][c].y`.

Current limitation: whole-struct assignment into an existing array element and aggregate brace initialization for arrays are not generally available. Prefer field-wise assignment or a supported copy-initialization path.

## Structs, unions, enums and aliases

Struct:

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

Nested structs/unions are supported when the referenced aggregate type is already defined. Member access can chain through nested values.

Use `chungus` for unions, `gyatt` for enums and `lit` for type aliases. When unsure about an initializer or copy case, verify against upstream tests rather than assuming C compatibility.

## Strings and characters

`rant` is the dedicated string type. `yap` is the character type. Do not casually interchange them with pointers or integers unless the language reference/test demonstrates that exact conversion.

Format-style output uses the normal Brainrot built-ins rather than a magical print statement.

## Standard runtime built-ins

The standard runtime exposes these important calls:

- `yapping(...)`: output with a trailing newline.
- `yappin(...)`: output without an automatic newline.
- `baka(...)`: diagnostic output to stderr.
- `ragequit(code)`: terminate immediately with an exit status.
- `chill(seconds)`: blocking sleep for an integer number of seconds.
- `slorp(...)`: input helper with safer semantics than blindly exposing C `scanf`.
- `bet(condition[, message])`: assertion. Failure prints an error and exits; success returns `W`.
- `gamba(...)`: cryptographically safe random integer functionality backed by OpenSSL in native builds.

Function signatures and accepted argument types matter. If generating nontrivial calls, verify the current user guide or the corresponding `stdrot/` implementation.

OpenSSL/libcrypto is a required native dependency for the standard runtime, not an optional feature that only matters when `gamba` happens to be called.

## Modules: `#cooked`

Brainrot uses `#cooked` for source/native modules.

```c
#cooked "helpers.brainrot"
```

A quoted path splices another Brainrot source file, resolved relative to the including source.

Named form:

```c
#cooked <name>
```

Named modules are resolved through the configured Brainrot module search path and may resolve to a Brainrot source module or native shared module. Native modules use the runtime's registration/ABI mechanism; do not model this as plain C `#include`.

Includes are guarded against repeated/circular inclusion according to the upstream module loader.

## Native modules and raylib

The repository includes an optional raylib integration used by the example game. `#cooked <raylib>` loads the Brainrot wrapper module built by the project, not the system raylib library directly.

Raylib is optional for the core interpreter. Do not add it as a base build dependency unless the task actually uses the binding.

## WebAssembly

`make wasm` produces the browser/Node-compatible interpreter artifacts. The standard runtime is statically linked for this target.

Known difference: wasm32 uses 32-bit `long`, so `maxxing(giga)` is 4 in WASM versus the common 8-byte LP64 native result.

`chill()` blocks the JS thread in the WASM build. A browser integration should run potentially sleeping execution in a Worker or otherwise account for blocking.

## Common failure modes

1. Treating Brainrot as a blind keyword substitution over arbitrary C.
2. Generating keywords/directives that are listed but not implemented.
3. Assuming C implicit conversions where Brainrot's semantic analyzer rejects them.
4. Returning/passing arrays by value.
5. Assuming all aggregate assignments/initializers are implemented.
6. Putting `based` before later `sigma rule` cases.
7. Forgetting native runtime/module dependencies.
8. Claiming Windows native support because the interpreter is written in C.
9. Ignoring the WASM data-model difference.
10. Inventing a built-in signature from its funny name.

## Gremlin operating procedure

When asked to write Brainrot:

1. Identify the intended behavior in ordinary pseudocode first.
2. Map types/control flow to Brainrot constructs.
3. Prefer constructs demonstrated in current docs/examples/tests.
4. Avoid unimplemented placeholders.
5. Keep `based` last.
6. If execution tools are available, run the actual interpreter and fix parser/semantic/runtime errors.
7. If execution is unavailable, say the code is syntax-reviewed rather than tested.
8. For fresh/obscure behavior, inspect current upstream before asserting support.

When asked to debug Brainrot:

1. Classify the failure as lexer/parser, semantic/type, module/runtime or environment/build.
2. Reduce to the smallest reproducer.
3. Compare against upstream tests for that feature.
4. Fix the minimal semantic mismatch rather than translating everything back to C.
5. Re-run the native or WASM fixture matching the user's target.

When translating from C/C++:

- preserve behavior, not surface syntax;
- replace unsupported C features with native Brainrot patterns;
- explicitly flag semantics that cannot be preserved;
- never silently emit placeholder keywords.

## Upstream trail

Use these in descending order when exactness matters:

1. current tests and test fixtures;
2. `docs/the-brainrot-programming-language.md`;
3. `docs/brainrot-user-guide.md`;
4. current README and examples;
5. parser/semantic analyzer/runtime implementation.

The language evolves quickly. "I remember Brainrot syntax" is not a verification strategy.
