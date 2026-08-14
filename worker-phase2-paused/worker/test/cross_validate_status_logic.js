// Cross-validates worker/src/status_logic.js against scripts/status_logic.py
// by running both against the same real fixture data and diffing outputs.
// Run with: node worker/test/cross_validate_status_logic.js
import { deriveStatus } from "../src/status_logic.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

function loadPapers(file) {
  return JSON.parse(readFileSync(path.join(ROOT, file), "utf-8")).papers;
}

const allPapers = [...loadPapers("data.json"), ...loadPapers("data.sample.json")];

// Ask the real Python implementation for its answer on the exact same
// inputs, via a tiny inline script — this is the actual source of truth,
// not a hand-copied expectation, so it catches drift automatically.
const pyScript = `
import json, sys
sys.path.insert(0, r"${path.join(ROOT, "scripts").replace(/\\/g, "\\\\")}")
from status_logic import derive_status
from datetime import date
papers = json.load(sys.stdin)
today = date(2026, 8, 11)
out = [derive_status(p["stage"], p["attempts"], p["latestDecision"], p["deadline"], p["publishedDate"], today=today) for p in papers]
print(json.dumps(out, ensure_ascii=False))
`;

const pyOutRaw = execFileSync("C:\\Python312\\python.exe", ["-c", pyScript], {
  input: JSON.stringify(allPapers),
  encoding: "utf-8",
});
const pyResults = JSON.parse(pyOutRaw);

const today = new Date(Date.UTC(2026, 7, 11)); // 2026-08-11
let mismatches = 0;
allPapers.forEach((p, i) => {
  const jsResult = deriveStatus(p.stage, p.attempts, p.latestDecision, p.deadline, p.publishedDate, today);
  const pyResult = pyResults[i];
  if (jsResult !== pyResult) {
    mismatches++;
    console.log(`MISMATCH ${p.id}: py=${JSON.stringify(pyResult)} js=${JSON.stringify(jsResult)}`);
  }
});

console.log(`Compared ${allPapers.length} papers against the real Python implementation. Mismatches: ${mismatches}`);
if (mismatches > 0) process.exit(1);
console.log("OK: JS port matches Python exactly.");
