// ★ fix-commandcode-cache-tokens: portable baseline gate.
//
// Gate: compare the current test results against the committed known-fails list.
// PASS when no test that was passing before now fails. New tests are allowed.
//
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>
//
// NOTE (2026-10-11): this script previously did `f.name.split("/app/")[1]`, which
// assumed the suite ran from a container path containing "/app/". Off that path
// the split produced `undefined`, so EVERY failure was reported as a regression
// while the real known-fails were never matched. Paths are now derived portably.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, relative, sep } from "path";

const here = dirname(fileURLToPath(import.meta.url));
// tests/__baseline__ -> repo test root (the parent of unit/, translator/, ...)
const testsRoot = dirname(here);

function readKnownFails() {
  return new Set(
    readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"))
  );
}

// Normalize a vitest test-file path to the repo-relative form used in
// known-fails.txt: `tests/<dir>/<file>.test.js` with forward slashes.
// Handles absolute paths, Windows separators, and already-relative input, so the
// gate behaves the same on a laptop, in CI, and inside the docker image.
function normalizeFile(rawName) {
  if (!rawName) return rawName;

  // Prefer the path after the last "/tests/" (or "\tests\") segment — robust
  // regardless of where the checkout lives.
  const unified = String(rawName).replace(/\\/g, "/");
  const marker = "/tests/";
  const idx = unified.lastIndexOf(marker);
  if (idx !== -1) return "tests/" + unified.slice(idx + marker.length);

  // Fall back to resolving relative to the tests root when possible.
  try {
    const rel = relative(dirname(testsRoot), unified).split(sep).join("/");
    if (rel && !rel.startsWith("..")) return rel;
  } catch {
    /* fall through */
  }

  // Last resort: strip a leading "./" and return as-is.
  return unified.replace(/^\.\//, "");
}

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error("Missing results.json path");
  console.error("Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>");
  process.exit(2);
}

let r;
try {
  r = JSON.parse(readFileSync(resultsPath, "utf8"));
} catch (e) {
  console.error(`Could not read/parse results file: ${resultsPath}\n${e.message}`);
  process.exit(2);
}

if (!Array.isArray(r?.testResults)) {
  console.error(
    "Results file has no `testResults` array. Re-run vitest with " +
      "`--reporter=json --outputFile=<path>`."
  );
  process.exit(2);
}

const knownFails = readKnownFails();

// Build the current failure set in the same `<file> :: <test name>` shape.
const nowFails = new Set();
for (const f of r.testResults) {
  const file = normalizeFile(f.name);
  for (const a of f.assertionResults || []) {
    if (a.status === "failed") nowFails.add(`${file} :: ${a.fullName}`);
  }
}

// Regression = failing now but not catalogued as a known fail.
const regressions = [...nowFails].filter((f) => !knownFails.has(f));
// Informational: catalogued failures that now pass (prune them from known-fails).
const nowPassing = [...knownFails].filter((f) => !nowFails.has(f));

if (nowPassing.length) {
  console.log(
    `ℹ️  ${nowPassing.length} known-fail(s) now pass — consider pruning known-fails.txt:`
  );
  nowPassing.forEach((f) => console.log("   - " + f));
}

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test(s) failing that are not known-fails:\n`);
  regressions.forEach((f) => console.error("  - " + f));
  process.exit(1);
}

console.log(
  `✅ No regression. (now fails=${nowFails.size}, baseline known=${knownFails.size}, all catalogued)`
);
