# wac-sudoku

A killer sudoku generator, solver and player, written in [wac](https://github.com/voltrevo/wac).

The generator compiles to WebAssembly and the whole app ships as **one HTML file** — around 39 KB,
with the wasm module inlined as base64. No CDN, no fetches, no service worker, nothing to install.
Type a seed, get a puzzle, solve it on your phone.

```
./bootstrap.sh          # dist/index.html
```

Node 22+ is the only prerequisite. There is no `npm install`, because there are no dependencies.

## Playing

Every row, column and 3×2 box holds 1–6 once. The dashed cages add to the small number in their
corner, and no digit repeats inside a cage.

The app prefills a seed as an adjective–animal pair — `brisk-otter`, `tawny-heron` — hashed to a
32-bit integer with FNV-1a. The same phrase always produces the same puzzle on any device, and the
seed lives in the URL hash, so a puzzle is a link. Progress and the clock are kept per seed in
`localStorage`.

Tap a cell, tap a digit. Notes mode writes pencil marks, which clear themselves from a cell's
row, column, box and cage peers when you commit a digit; undo covers those cascades too. The pad
counts how many of each digit are left to place. Keyboard works as well: `1`–`6`, arrows,
backspace, `N` for notes, `U` for undo.

### Not spoiling it

Everything the app tells you comes from the **rules**, never from the answer: a repeated digit in a
house or cage, a cage over its total, a cage full but adding to the wrong number. `conflicts()`
in the page never reads the solution, so a red cell says *this cannot stand*, not *it should have
been a 4*. The solution is read in exactly one function, behind a two-step confirmation — and if
you take it, the finishing message says so rather than congratulating you.

## What is here

```
src/webgen.wac      the browser entry point: generate(seed) -> i32[]
src/gen.wac         the same generator as a command line, for batches
src/solve.wac       the solver both of those are built on
src/killer.wac      reads a puzzle, solves it, or works out its cages from the printed totals
src/render.wac      a printable HTML sheet of many puzzles
src/text.wac        small shared helpers

web/index.template.html   the app, with one marker where the wasm glue is folded in
web/build.mjs             folds it in
tools/verify.mjs          an independent solver that checks the generator's claim

bootstrap.sh        build everything, fetching a wac compiler if there is not one here
wac-ref.txt         which wac to build with — a branch, tag or commit
```

## How a puzzle is made unique

Uniqueness is not tested after the fact and retried until it holds. It is preserved at every step,
which is why the generator never has to reject a finished puzzle:

1. Make a filled 6×6 grid — a base pattern, then digit relabelling and band, stack, row and column
   shuffles, which are the symmetries that keep it valid.
2. Start with every cell its own one-cell cage. That is trivially unique: every digit is given.
3. Repeatedly merge two touching cages and re-count the solutions. Keep the merge only if the count
   is still exactly one; otherwise put it back.

Step 3 walks *down* from a fully-given puzzle rather than up from an empty one, so the invariant
holds from the start. A final sweep merges away any one-cell cages left over, since those are free
givens rather than puzzle. `tools/verify.mjs` re-checks all of this from outside, with a search
written to be deliberately dumber than `src/solve.wac`'s — it does not reproduce the cage
range-pruning, which is the part most able to prune a real second solution away and report a
puzzle unique when it is not.

## Command line

```sh
wac run src/gen.wac -- 20 20260906              # 20 puzzles, seeded
wac run src/gen.wac -- 20 1 | wac run src/render.wac > puzzles.html
wac run src/killer.wac < examples/twenty.txt    # solve, and count the solutions
```

`killer.wac` also derives cage shapes it was never told. `examples/photographed.txt` is a puzzle
transcribed from a newspaper photograph — only the printed totals and where they sat, because the
cage outlines were not legible:

```sh
wac run src/killer.wac < examples/photographed.txt
```

It recovers the layout, because eleven totals adding to 126 = 6 × 21 can only be a partition of all
36 cells, and because a cage's total is printed in its topmost-then-leftmost cell.

## Building

`bootstrap.sh` looks for a wac compiler in `$WAC`, then on `PATH`, then in `.wac/`. Finding none, it
fetches wac and runs *its* `bootstrap.sh --host nodejs`, which builds the compiler from source by a
ladder whose lowest rung is hand-written wasm assembly text — no cargo, no C++ toolchain, and
nothing unpacks a binary that somebody compiled once and checked in. About 50 seconds cold, and
cached in `.wac/` afterwards.

```sh
./bootstrap.sh --verify        # ...and check the generated puzzles
./bootstrap.sh --clean         # throw away .wac/, dist/ and the generated glue
WAC=/path/to/wac ./bootstrap.sh
```

Then `wac bindgen src/webgen.wac --js` writes `src/webgen.gen.js`, with the compiled module inlined
as base64 and a plain `export function generate(seed)` over it. `web/build.mjs` drops that into the
template. Instantiation is synchronous, so there is no loading state to design.

## Deploying

`.github/workflows/pages.yml` runs `./bootstrap.sh --verify` and publishes `dist/`. It is the same
command a laptop runs, so if CI and a local build ever disagree, the disagreement is in the
environment rather than in two descriptions of the same steps that drifted apart.

Enable it once under **Settings → Pages → Source → GitHub Actions**. The compiler is cached on the
contents of `wac-ref.txt`, so it rebuilds when that moves and not otherwise.
