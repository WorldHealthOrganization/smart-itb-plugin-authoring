#!/usr/bin/env node
// Does every TestPlan in a built FHIR Test Package actually name a Gherkin
// feature, and do its assertions come from that feature?
//
//   node check-test-ig.mjs <ig folder>
//
// Exit 0 if every plan passes, 1 otherwise, so it works as a gate.
//
// WHY. A TestPlan is a *declaration of* a Gherkin script: the suite names the
// feature, each test is one of its Scenarios, and each assertion is one of that
// scenario's steps. Three ways that can quietly stop being true, none of which
// SUSHI or the IG Publisher will tell you about:
//
//   1. NO SCRIPT. suite.input.file is missing or names a file that is not in
//      the package. The plan reads fine and implements nothing.
//   2. EMPTY SCRIPT. The feature is present but has no Scenario:, so the plan
//      declares tests that the script does not contain.
//   3. ASSERTIONS ON THE SIDE. An assertion.human that appears nowhere in the
//      feature. It looks like a test and nothing executes it — the worst of
//      the three, because the plan looks MORE thorough than the suite is.
//
// The third is why this exists. Everything else about a Test Package can be
// checked by eye; a drifted assertion cannot.

import fs from 'node:fs';
import path from 'node:path';

const IG = process.argv[2];
if (!IG || !fs.existsSync(IG)) {
  console.error('usage: node check-test-ig.mjs <ig folder>');
  process.exit(2);
}

const RES = path.join(IG, 'fsh-generated', 'resources');
const GHERKIN = path.join(IG, 'input', 'testing', 'gherkin');
if (!fs.existsSync(RES)) {
  console.error(`no fsh-generated/resources under ${IG} — build the IG first`);
  process.exit(2);
}

/** The step lines of a feature, trimmed, with the Gherkin keyword removed. */
function stepsOf(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(Given|When|Then|And|But)\s+(.*\S)\s*$/.exec(raw);
    if (m) out.push(m[2]);
  }
  return out;
}

/** The cells of every data table, which a step with a table draws its rows
 *  from. One row becomes one assertion, so these are legitimate sources. */
function tableCellsOf(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(raw)) continue;
    for (const cell of raw.split('|').map(c => c.trim())) {
      if (cell) out.push(cell);
    }
  }
  return out;
}

/**
 * Is this assertion derived from the feature?
 *
 * Two shapes. A plain step is the step text verbatim. A step carrying a data
 * table yields one assertion per row, written "<row> — <step, colon stripped>",
 * so both halves have to be present in the feature for it to count. Accepting
 * the row alone would let a row drift away from any step and still pass.
 */
function derivedFrom(human, steps, cells) {
  if (!human) return false;
  if (steps.has(human)) return true;
  const i = human.lastIndexOf(' — ');
  if (i < 0) return false;
  const row = human.slice(0, i).trim();
  const step = human.slice(i + 3).trim();
  const stepHit = steps.has(step) || steps.has(step + ':');
  return cells.has(row) && stepHit;
}
const scenariosOf = (text) =>
  text.split(/\r?\n/)
    .map(l => /^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/.exec(l))
    .filter(Boolean).map(m => m[1]);

const plans = fs.readdirSync(RES).filter(f => /^TestPlan-.*\.json$/.test(f));
if (plans.length === 0) {
  console.error('no TestPlan resources — nothing to check');
  process.exit(2);
}

let failed = 0;
for (const file of plans.sort()) {
  const plan = JSON.parse(fs.readFileSync(path.join(RES, file), 'utf8'));
  const problems = [];
  let tests = 0, asserts = 0, matched = 0;

  const suites = plan.suite ?? [];
  if (suites.length === 0) problems.push('no suite at all');

  for (const suite of suites) {
    const named = (suite.input ?? []).map(i => i.file).filter(Boolean);
    if (named.length === 0) {
      problems.push(`suite "${suite.name ?? '?'}" names no script (suite.input.file)`);
      continue;
    }
    // One suite may legitimately name several scripts; pool their steps.
    let pooled = '';
    for (const f of named) {
      const p = path.join(GHERKIN, f);
      if (!fs.existsSync(p)) { problems.push(`script "${f}" is named but not in input/testing/gherkin/`); continue; }
      pooled += '\n' + fs.readFileSync(p, 'utf8');
    }
    if (!pooled.trim()) continue;

    const scenarios = scenariosOf(pooled);
    if (scenarios.length === 0) problems.push(`script ${named.join(', ')} contains no Scenario:`);

    const steps = new Set(stepsOf(pooled));
    const cells = new Set(tableCellsOf(pooled));
    for (const t of suite.test ?? []) {
      tests++;
      // The test should correspond to a scenario. Names carry an identifier
      // prefix, so compare on the whole name and fall back to the prefix.
      const id = (t.name ?? '').split(/\s+/)[0];
      const hit = scenarios.some(s => s === t.name || (id && s.startsWith(id)));
      if (!hit) problems.push(`test "${(t.name ?? '?').slice(0, 60)}" matches no Scenario: in the script`);
      for (const a of t.assertion ?? []) {
        asserts++;
        if (derivedFrom(a.human, steps, cells)) matched++;
        else problems.push(`ASSERTION ON THE SIDE — not a step in the script: ${JSON.stringify((a.human ?? '').slice(0, 70))}`);
      }
    }
  }

  // A plan with tests but no assertions declares behaviour it never checks.
  if (tests > 0 && asserts === 0) problems.push(`${tests} test(s) and not one assertion`);

  const id = plan.id ?? file;
  if (problems.length) {
    failed++;
    console.log(`FAIL  ${id}`);
    for (const p of problems.slice(0, 12)) console.log(`        ${p}`);
    if (problems.length > 12) console.log(`        … and ${problems.length - 12} more`);
  } else {
    console.log(`ok    ${id.padEnd(44)} ${tests} test(s), ${matched}/${asserts} assertion(s) found in the script`);
  }
}

console.log(`\n${plans.length - failed}/${plans.length} test plan(s) pass`);
process.exit(failed ? 1 : 0);
