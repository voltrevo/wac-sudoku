# wac-sudoku

A killer sudoku generator, solver and player, written in [wac](https://github.com/voltrevo/wac).

The generator compiles to WebAssembly and the whole app ships as **one HTML file** — around 51 KB,
with the wasm module inlined as base64. No CDN, no fetches, no service worker, nothing to install.
Type a seed, get a puzzle, solve it on your phone.

**[Play it](https://voltrevo.github.io/wac-sudoku/)**

<img src="docs/screenshot.png" alt="A 6x6 killer sudoku part-solved, with dashed cages, pencil marks and a digit pad" width="330">

```
./bootstrap.sh          # dist/index.html
```

Node 22+ is the only prerequisite. There is no `npm install`, because there are no dependencies.

## Playing

Every row, column and 3×2 box holds 1–6 once. The dashed cages add to the small number in their
corner, and no digit repeats inside a cage.

The app prefills a seed as an adjective–animal pair — `brisk-otter`, `tawny-heron` — hashed to a
32-bit integer with FNV-1a. The same seed always produces the same puzzle on any device, and it
lives in the URL hash, so a puzzle is a link. Open the app with no link and it returns to the
puzzle you were last on, grid and all.

Only a browser that has never been here needs a name picked for it, and that one comes from
**today's local date** rather than from chance — so everyone starting fresh on the same day is on
the same puzzle, and Next walks them through the same sequence. Local, not UTC: the day you are
having is the one on your wall, and a player just after midnight should get tomorrow's puzzle
rather than yesterday's.

A seed is a name and a two-digit number: `brisk-otter-07`. Type one without a number and it *is*
that name at `-00`, so **Next** and **Prev** always have somewhere to go. They walk the number and
wrap, which is why Prev from `-00` lands on `-99` rather than refusing — a hundred puzzles per
name, in a ring.

**A hundred puzzles are kept, not just the one on screen**, because Next and Prev make leaving a
puzzle mid-thought the normal way to use this: step forward, get stuck, step back, and your grid is
where you left it. A hundred is one full `-00`…`-99` ring, so Next can lap a name without losing
anything; the next one evicts the least recently opened.

Tap a cell, tap a digit. Notes mode writes pencil marks, which clear themselves from a cell's row,
column, box and cage peers when you commit a digit. One action is one undo however many cells it
moved, so undoing that placement puts the digit *and* every note it rubbed out back. **Clear**
starts the puzzle over, clock included, and is itself one undo away — which is why it does not
stop to ask. The pad counts how many of each digit are left to place. Keyboard works too: `1`–`6`,
arrows, backspace, `N` notes, `U` undo, `[` and `]` for Prev and Next.

### Not spoiling it

Everything the app tells you comes from the **rules**, never from the answer: a repeated digit in a
house or cage, a cage over its total, a cage full but adding to the wrong number. `conflicts()`
in the page never reads the solution, so a red cell says *this cannot stand*, not *it should have
been a 4*. The solution is read in exactly one function, behind a two-step confirmation — and if
you take it, the finishing message says so rather than congratulating you.

Showing it is not a one-way door: **Undo** puts your own grid back, and **Clear** starts the puzzle
over. Revealing is recorded on the undo stack like any other action.

## What is here

```
src/webgen.wac      the browser entry point: generate(seed) -> i32[]
src/gen.wac         the same generator as a command line, for batches
src/solve.wac       the solver both of those are built on
src/killer.wac      reads a puzzle, solves it, or works out its cages from the printed totals
src/render.wac      a printable HTML sheet of many puzzles
src/state.wac       what you have done to a grid, as bytes
src/text.wac        small shared helpers

web/index.template.html   the app, with one marker where the wasm glue is folded in
web/build.mjs             folds it in
tools/verify.mjs          an independent solver that checks the generator's claim

bootstrap.sh        build everything, fetching a wac compiler if there is not one here
wac-ref.txt         which wac to build with — a branch, tag or commit
```

## Saving

A saved grid is **forty-odd bytes**, and the page never looks inside it: `packState` in wac returns
an opaque `Uint8Array` and `unpackState` takes it back. The layout is `src/state.wac`'s business.

It is small because **the answer is not in it**. The seed regenerates the solution, so a cell
filled in correctly costs one bit — *filled* — and only the cells you have got wrong carry a digit.
What remains is two bit vectors and a short list:

```
0        version
1-2      a fingerprint of the answer this state was saved against
3-7      which cells are filled            36 bits
8-34     pencil marks, six bits per cell   216 bits
35-37    seconds on the clock              24 bits
38       flags — bit 0 is `revealed`
39       how many cells are wrong, W
40..     one byte each: cell * 6 + digit - 1, which fits because 36 * 6 = 216 < 256
```

Forty bytes covers every realistic state, including a grid pencilled in every cell with all six
candidates — which the JSON this replaced spent 611 characters on. A hundred puzzles is 4 KB.

The fingerprint earns its two bytes: nothing pins a seed to the puzzle it produced, so if the
generator ever changes, `brisk-otter-00` becomes a different grid. Without it the old state would
decode against the new answer and quietly move your digits around. A mismatch is read as "no saved
state" instead.

Storage is **IndexedDB**, which keeps a byte array as bytes rather than stringifying it — and
`github.io` is a single origin for every project published under it, so the localStorage budget was
never ours alone. Everything is mirrored in memory at startup, so reads are synchronous and only
writes go to disk, coalesced.

Anything the localStorage version left behind is migrated once. The old keys are removed only after
the new bytes are **on disk** — the transaction is awaited rather than queued, because a coalesced
write that had not landed would have taken the grids with it if the tab closed in between. A failed
write leaves the originals alone and the next visit tries again.

The migration is stamped `2026-09-07` and stops running sixty days later. Past that it is dead code:
delete `migrate`, `forgetOld`, the three constants and the one call, and nothing else refers to
them. The trade is deliberate — someone who has not opened the app for two months loses grids saved
under the old format.

**Undo is not saved and is not meant to be.** It lives in memory for one puzzle: `build()` resets it
on every switch, so it never outlives the grid it describes.

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
