// Fold the bindgen output into the page, so what deploys is one file with nothing to fetch.
//
//     node web/build.mjs [outDir]
//
// `export` is stripped on the way in because an inline module script has nobody to export to; the
// app calls `generate` directly out of the same module scope. Nothing else is transformed — no
// bundler, no minifier, no dependencies. The page you read in `web/index.template.html` is the
// page that ships, which is worth more here than the few KB a minifier would save.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? "dist";

const GLUE = join(root, "src", "webgen.gen.js");
let glue;
try {
  glue = readFileSync(GLUE, "utf8");
} catch {
  console.error(`build: ${GLUE} is missing — run \`wac bindgen src/webgen.wac --js\` first,`);
  console.error("       or just run ./bootstrap.sh, which does both.");
  process.exit(1);
}
glue = glue.replace(/^export function/gm, "function");

const MARK = "/*__WASM_GLUE__*/";
const html = readFileSync(join(root, "web", "index.template.html"), "utf8");
if (!html.includes(MARK)) {
  console.error(`build: web/index.template.html has no ${MARK} to substitute into`);
  process.exit(1);
}

// A page that loaded but could not generate would look like a styling bug rather than a build one,
// so the two things the template needs from the glue are checked here where the message can say so.
for (const need of ["const WASM =", "function generate("]) {
  if (!glue.includes(need)) {
    console.error(`build: the glue has no \`${need}\` — did src/webgen.wac stop exporting generate?`);
    process.exit(1);
  }
}

const page = html.replace(MARK, () => glue);
mkdirSync(join(root, out), { recursive: true });
writeFileSync(join(root, out, "index.html"), page);

// Pages serves the artefact as-is; .nojekyll stops it treating an underscore-led name as a template.
writeFileSync(join(root, out, ".nojekyll"), "");

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${out}/index.html  ${kb(page.length)}  (glue ${kb(glue.length)}, one file, no fetches)`);
