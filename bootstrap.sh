#!/bin/sh
# Build the site from source, fetching a wac compiler if there is not one here already.
#
#     ./bootstrap.sh                  # dist/index.html
#     ./bootstrap.sh --verify         # ...and prove a sample of puzzles have one solution each
#     ./bootstrap.sh --clean          # throw away .wac/ and dist/ and stop
#
# **Node is the only thing you need installed.** wac's own `bootstrap.sh --host nodejs` builds the
# compiler from source by a ladder whose lowest rung is hand-written wasm assembly text — no cargo,
# no C++ toolchain, and nothing unpacks a binary somebody compiled once and checked in. It takes
# about 50 seconds on a cold machine, which is why `.wac/` is worth caching but not worth
# committing.
#
# **`sh`, not `bash`**, and it never reads stdin: every decision is a flag, so a failure is an
# error rather than a prompt. That is what makes it the same script in CI and on a laptop.

set -eu

verify=0
clean=0
out=dist

usage() {
  cat >&2 <<'USAGE'
usage: bootstrap.sh [--verify] [--clean] [-o DIR]

  --verify   after building, generate puzzles through the compiled wasm and check with an
             independent solver that each has exactly one solution
  --clean    remove .wac/ and dist/ and do nothing else
  -o DIR     write the site somewhere other than dist/

  $WAC       a wac command to use instead of building one
  $WAC_REPO  where to fetch wac from     (default https://github.com/voltrevo/wac.git)
  $WAC_REF   branch, tag or commit       (default: the line in wac-ref.txt)
USAGE
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --verify) verify=1; shift ;;
    --clean) clean=1; shift ;;
    -o) [ $# -ge 2 ] || usage; out="$2"; shift 2 ;;
    -o=*|--output=*) out="${1#*=}"; shift ;;
    -h|--help) usage ;;
    *) echo "bootstrap.sh: unknown argument '$1'" >&2; usage ;;
  esac
done

root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"

# **The wac version is pinned in `wac-ref.txt` rather than here**, so that the build and the CI
# cache key read the same one line and a bump is a one-line diff with a commit message on it.
WAC_REPO="${WAC_REPO:-https://github.com/voltrevo/wac.git}"
if [ -z "${WAC_REF:-}" ]; then
  if [ -f wac-ref.txt ]; then WAC_REF="$(tr -d ' \t\r\n' < wac-ref.txt)"; else WAC_REF=master; fi
fi

say() { echo "wac-sudoku: $*" >&2; }
die() { echo "wac-sudoku: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$clean" -eq 1 ]; then
  rm -rf .wac "$out" src/webgen.gen.js
  say "removed .wac/, $out/ and the generated glue"
  exit 0
fi

have node || die "node is not installed. Node 22 or newer, for wasm GC — https://nodejs.org"

# ------------------------------------------------------------------ the compiler
#
# Checked in this order so that a machine which already has wac never waits for a build, and a
# machine which built one once never builds it twice.

if [ -n "${WAC:-}" ]; then
  [ -x "$WAC" ] || die "\$WAC is set to '$WAC', which is not executable"
  wac="$WAC"
  say "using \$WAC — $wac"
elif have wac; then
  wac="$(command -v wac)"
  say "using the wac on PATH — $wac"
elif [ -x .wac/wac ]; then
  wac="$root/.wac/wac"
  say "using the wac built here earlier — .wac/wac"
else
  have git || die "no wac here, and no git to fetch one with"
  say "no wac here — building one from $WAC_REPO at $WAC_REF (about 50s)"
  rm -rf .wac/src
  mkdir -p .wac/src
  # Fetch by refspec rather than `clone --branch`, because that accepts a branch or a tag and this
  # also accepts the commit sha you would want to pin CI to.
  git -C .wac/src init -q
  git -C .wac/src remote add origin "$WAC_REPO"
  git -C .wac/src fetch -q --depth 1 origin "$WAC_REF" || die "could not fetch $WAC_REF from $WAC_REPO"
  git -C .wac/src checkout -q FETCH_HEAD
  ( cd .wac/src && ./bootstrap.sh --host nodejs -o "$root/.wac/wac" )
  wac="$root/.wac/wac"
fi

# ------------------------------------------------------------------ the build
#
# Two steps, and the first is the interesting one: `bindgen` compiles `src/webgen.wac` to wasm and
# writes the JavaScript that calls it, with the module inlined as base64. That is what lets the
# whole app be one file with nothing to fetch.

say "bindgen src/webgen.wac"
"$wac" bindgen src/webgen.wac --js

say "assembling $out/index.html"
node web/build.mjs "$out"

if [ "$verify" -eq 1 ]; then
  say "verifying"
  node tools/verify.mjs "${VERIFY_COUNT:-24}"
fi

say "done — $out/index.html"
