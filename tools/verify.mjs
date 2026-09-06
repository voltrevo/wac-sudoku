// An oracle for the generator, written to share as little as possible with it.
//
//     node tools/verify.mjs [count]
//
// It imports the compiled wasm directly — the same glue the page inlines — so what it checks is
// the artefact that ships, not a second implementation that happens to agree.
//
// **The search here is deliberately dumber than the one in `src/solve.wac`.** That solver prunes a
// cage with `loRest`/`hiRest`: the least and greatest totals its remaining cells could still make.
// That is the part most able to prune away a real second solution and report a puzzle unique when
// it is not, so it is the part this does not reproduce. Houses use bitmasks because that is not
// what is in question; the cage arithmetic is checked the long way, and every solution is counted
// rather than stopping at the first, because "exactly one" is the claim.

import { generate } from "../src/webgen.gen.js";

const N = 6, BW = 3, BH = 2, CELLS = N * N;
const boxOf = (i) => (((i / N) | 0) / BH | 0) * (N / BW) + ((i % N) / BW | 0);

function countAll(cage, sums) {
  const members = sums.map(() => []);
  for (let i = 0; i < CELLS; i++) members[cage[i]].push(i);
  const remaining = cage.map((g, i) => members[g].filter((j) => j > i).length);
  const grid = new Array(CELLS).fill(0);
  const row = new Array(N).fill(0), col = new Array(N).fill(0), box = new Array(N).fill(0);
  const seen = new Array(sums.length).fill(0), acc = new Array(sums.length).fill(0);
  let count = 0, first = null;

  const go = (i) => {
    if (i === CELLS) {
      count++;
      if (count === 1) first = grid.slice();
      return;
    }
    const r = (i / N) | 0, c = i % N, b = boxOf(i), g = cage[i];
    for (let d = 1; d <= N; d++) {
      const bit = 1 << d;
      if (row[r] & bit || col[c] & bit || box[b] & bit || seen[g] & bit) continue;
      const total = acc[g] + d;
      if (total > sums[g]) continue;
      if (remaining[i] === 0 && total !== sums[g]) continue;
      grid[i] = d; row[r] |= bit; col[c] |= bit; box[b] |= bit; seen[g] |= bit; acc[g] = total;
      go(i + 1);
      grid[i] = 0; row[r] ^= bit; col[c] ^= bit; box[b] ^= bit; seen[g] ^= bit; acc[g] -= d;
    }
  };
  go(0);
  return { count, first };
}

function connected(cells) {
  const set = new Set(cells), seen = new Set([cells[0]]), q = [cells[0]];
  while (q.length) {
    const i = q.shift();
    const nbr = [[i - N, i >= N], [i + N, i < CELLS - N], [i - 1, i % N !== 0], [i + 1, i % N !== N - 1]];
    for (const [j, ok] of nbr) if (ok && set.has(j) && !seen.has(j)) { seen.add(j); q.push(j); }
  }
  return seen.size === set.size;
}

/* FNV-1a, the same mapping the page uses so the seeds exercised are ones a player could type. A
 * drift from the page's copy would only mean testing different seeds, not testing them wrongly. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

const PHRASES = ["brisk-otter", "tawny-heron", "amber-lynx", "quiet-shrew", "golden-tern",
  "restless-vole", "misty-godwit", "wily-marten", "zesty-pika", "noble-wren", "frosty-elk",
  "sunny-dipper"];

const count = Number(process.argv[2] ?? 24);
const seeds = [
  ...PHRASES.map((p) => [p, hash(p)]),
  // Raw integers too, including the edges a phrase is unlikely to land on.
  [0, 0], [1, 1], [-1, -1], [0x7fffffff, 0x7fffffff], [-0x80000000, -0x80000000],
  ...Array.from({ length: Math.max(0, count - PHRASES.length - 5) }, (_, i) => [i + 2, i + 2]),
];

let failed = 0;
const sizes = new Map();
const t0 = Date.now();

for (const [label, seed] of seeds) {
  const a = generate(seed);
  const nc = a[0];
  const cage = Array.from(a.slice(1, 1 + CELLS));
  const sums = Array.from(a.slice(1 + CELLS, 1 + CELLS + nc));
  const sol = Array.from(a.slice(1 + CELLS + nc));
  const bad = [];

  const members = sums.map(() => []);
  for (let i = 0; i < CELLS; i++) {
    if (cage[i] < 0 || cage[i] >= nc) { bad.push(`cell ${i} in cage ${cage[i]} of ${nc}`); continue; }
    members[cage[i]].push(i);
  }
  for (let g = 0; g < nc; g++) {
    const m = members[g];
    sizes.set(m.length, (sizes.get(m.length) ?? 0) + 1);
    if (m.length === 0) bad.push(`cage ${g} is empty`);
    else if (m.length === 1) bad.push(`cage ${g} is one cell — a free given`);
    else if (!connected(m)) bad.push(`cage ${g} is not connected`);
    if (m.reduce((t, i) => t + sol[i], 0) !== sums[g]) bad.push(`cage ${g} does not add to ${sums[g]}`);
    if (new Set(m.map((i) => sol[i])).size !== m.length) bad.push(`cage ${g} repeats a digit`);
  }
  const house = (k, j) => [k * N + j, j * N + k,
    (((k / (N / BW)) | 0) * BH + ((j / BW) | 0)) * N + (k % (N / BW)) * BW + (j % BW)];
  for (let k = 0; k < N; k++) {
    for (let w = 0; w < 3; w++) {
      const got = Array.from({ length: N }, (_, j) => sol[house(k, j)[w]]).sort();
      if (got.join() !== Array.from({ length: N }, (_, d) => d + 1).join())
        bad.push(`${["row", "column", "box"][w]} ${k} is not 1..${N}`);
    }
  }
  if (sums.reduce((a, b) => a + b, 0) !== (CELLS * (N + 1)) / 2)
    bad.push(`totals sum to ${sums.reduce((a, b) => a + b, 0)}, not ${(CELLS * (N + 1)) / 2}`);

  const { count: n, first } = countAll(cage, sums);
  if (n !== 1) bad.push(`${n} solutions`);
  else if (first.join() !== sol.join()) bad.push("the one solution is not the one it reported");

  if (bad.length) { failed++; console.error(`FAIL ${label}: ${bad.join("; ")}`); }
}

const sizeText = [...sizes].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}-cell x${v}`).join(", ");
console.log(`${seeds.length - failed}/${seeds.length} puzzles: exactly one solution, cages partition,`
  + ` connect and add up, no free givens.`);
console.log(`cage sizes: ${sizeText}   (${Date.now() - t0}ms)`);
process.exit(failed ? 1 : 0);
