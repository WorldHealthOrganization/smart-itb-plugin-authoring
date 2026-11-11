#!/usr/bin/env node
// Build a FHIR IG that publishes a set of Gherkin features as TestPlans —
// the pharm-MEOW-test layout, generated from a config and the features.
//
//   node scripts/build-test-ig.mjs <config.json> [--package]
//
// The config names the IG, the specification under test, and the plans. A plan
// is one TestPlan: one thing under test (its `scope`) and the test cases for
// it. It takes its test cases in one of two shapes, and which one follows from
// how the specification is organised:
//
//   "feature": "x.feature"        ONE plan per actor, and that feature's `Rule:`
//                                 groupings become its suites. For a specification
//                                 that defines actors, each with its own test cases
//                                 (IPS: Creator, Consumer, Server).
//
//   "features": "folder"          ONE plan over many feature files, and each FILE
//   "features": ["a.feature", …]  becomes a suite. For one system under test whose
//                                 test cases are already grouped into suites (the
//                                 HL7 terminology-ecosystem set: one terminology
//                                 server, 38 suites).
//
// From that this writes:
//
//   <out>/sushi-config.yaml               IG metadata, dependencies, resources, pages, parameters
//   <out>/input/fsh/testplan-<plan>.fsh   the TestPlan: a suite per Rule or per feature file, a
//                                         test per Scenario, an assertion per Then step, and the
//                                         @covers: obligations in each test's description
//   <out>/input/fsh/binary-gherkin.fsh    the Binary that renders each feature on the site
//   <out>/input/testing/gherkin/*.feature the features, as shipped to runners (path-test)
//   <out>/input/pagecontent/index.md, testing.md, README.md
//   + the scaffolding vendored in scripts/test-ig-scaffold/ (build scripts, template, CI)
//
// Hand-authored FSH in <out>/input/fsh (a requirements CapabilityStatement, say)
// is left alone; list it under "extraResources" to give it a name on the site.
//
// --package then runs the scaffold's _package.py (SUSHI + resourceDefinition
// repair + tarball) so <out>/dist/package.tgz is ready to hand to a runner.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..');
const SCAFFOLD = path.join(here, 'test-ig-scaffold');

const args = process.argv.slice(2);
const configPath = args.find(a => !a.startsWith('--'));
if (!configPath) { console.error('usage: build-test-ig.mjs <config.json> [--package]'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const OUT = path.resolve(path.dirname(configPath), cfg.out);
const FEATURES = path.resolve(APP, cfg.features ?? 'public/features');
const today = new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────
// Feature → plan model
// ─────────────────────────────────────────────────────────────────────

function parseFeature(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const f = { file: path.basename(file), title: '', description: [], tags: [], background: [], rules: [] };
  let pending = [], comments = [], rule = null, sc = null, inDoc = false, inPreamble = false;
  const suite = () => rule ?? (rule = { title: 'Test cases', scenarios: [] }, f.rules.push(rule), rule);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('"""')) { inDoc = !inDoc; continue; }
    if (inDoc) continue;
    if (line.startsWith('#')) { comments.push(line.replace(/^#\s?/, '')); continue; }
    if (line === '') { if (!inPreamble) comments = []; continue; }
    if (line.startsWith('@')) { pending.push(...line.split(/\s+/)); continue; }
    if (/^Feature:/.test(line)) { f.title = line.replace(/^Feature:\s*/, ''); f.tags = pending; pending = []; comments = []; inPreamble = true; continue; }
    if (/^Background:/.test(line)) { inPreamble = false; sc = null; comments = []; continue; }
    if (/^Rule:/.test(line)) { inPreamble = false; rule = { title: line.replace(/^Rule:\s*/, ''), scenarios: [] }; f.rules.push(rule); sc = null; comments = []; continue; }
    if (/^Scenario:/.test(line)) {
      inPreamble = false;
      sc = { title: line.replace(/^Scenario:\s*/, ''), tags: pending, description: comments.join(' '), steps: [], covers: [], profile: undefined };
      sc.covers = pending.filter(t => t.startsWith('@covers:')).flatMap(t => t.slice(8).split(','));
      sc.profile = pending.find(t => t.startsWith('@profile:'))?.slice(9);
      suite().scenarios.push(sc);
      pending = []; comments = [];
      continue;
    }
    if (inPreamble) { f.description.push(line); continue; }
    const m = /^(Given|When|Then|And|But)\s+(.*)$/.exec(line);
    if (m && sc) { sc.steps.push({ kw: m[1], text: m[2], note: comments.join(' '), rows: [] }); comments = []; continue; }
    // A data table belongs to the step above it (a checklist's items).
    if (line.startsWith('|') && sc && sc.steps.length) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const last = sc.steps[sc.steps.length - 1];
      if (!last.header) last.header = cells; else last.rows.push(Object.fromEntries(last.header.map((h, i) => [h, cells[i] ?? ''])));
      continue;
    }
    if (m && !sc) { f.background.push({ kw: m[1], text: m[2] }); comments = []; }
  }
  return f;
}

/** Assertions are the Then steps and the And/But steps that follow one. */
function assertions(sc) {
  const out = [];
  let inThen = false;
  for (const s of sc.steps) {
    if (s.kw === 'Then') inThen = true;
    else if (s.kw === 'Given' || s.kw === 'When') inThen = false;
    if (inThen) out.push(s);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// FSH
// ─────────────────────────────────────────────────────────────────────

const fsh = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const fshBlock = s => `"""\n${String(s).replace(/"""/g, '\\"\\"\\"')}\n"""`;
const idOf = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const nameOf = s => s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('');

// ─────────────────────────────────────────────────────────────────────
// The plan model: whichever shape the config uses, a plan ends up as
// { id, title, scope, suites: [{ name, description, file, scenarios }] }.
// ─────────────────────────────────────────────────────────────────────

/** The suite name a feature file carries: what follows the last dash of its
 *  title ("Terminology server — simple-cases" → "simple-cases"), else the title. */
const suiteNameOf = title => (title.split(/\s+[—–-]\s+/).pop() || title).trim();

function featureFilesOf(plan) {
  if (plan.feature) return [plan.feature];
  if (Array.isArray(plan.features)) return plan.features;
  if (typeof plan.features === 'string') {
    const dir = path.join(FEATURES, plan.features);
    return fs.readdirSync(dir).filter(f => f.endsWith('.feature')).sort()
      .map(f => path.posix.join(plan.features, f));
  }
  throw new Error(`plan "${plan.id}" names neither "feature" nor "features"`);
}

function buildPlan(plan) {
  const files = featureFilesOf(plan);
  const parsed = files.map(f => parseFeature(path.join(FEATURES, f)));
  const multi = !plan.feature;
  const suites = multi
    // One suite per feature file: the file is the grouping. A Rule inside it is
    // a heading within that suite, so it goes into each test's description.
    ? parsed.map(f => ({
        name: suiteNameOf(f.title),
        description: f.description.join(' '),
        file: f.file,
        scenarios: f.rules.flatMap(r => r.scenarios.map(s => ({ ...s, rule: r.title }))),
      })).filter(s => s.scenarios.length)
    // One suite per Rule of the single feature.
    : parsed[0].rules.filter(r => r.scenarios.length).map(r => ({
        name: r.title,
        description: `Rule: ${r.title} — the scenarios grouped under it in the feature file.`,
        file: parsed[0].file,
        scenarios: r.scenarios,
      }));
  const scenarios = suites.flatMap(s => s.scenarios);
  return {
    ...plan, multi, files, parsed, suites,
    description: plan.description ?? parsed[0].description.join('\n'),
    scenarioCount: scenarios.length,
    coversCount: scenarios.flatMap(s => s.covers).length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// FSH: the TestPlan, and the Binaries that render the scripts
// ─────────────────────────────────────────────────────────────────────

function testPlanFsh(plan) {
  // "instanceId" names the resource outright; otherwise it is the plan id with
  // "-tests", which reads well for a plan per actor (ips-creator-tests).
  const id = plan.instanceId ?? `${plan.id}-tests`;
  const lines = [];
  lines.push(`// GENERATED by build-test-ig.mjs from ${plan.files.length === 1 ? path.basename(plan.files[0]) : `${plan.files.length} feature files`}. Edit the feature, not this file.`);
  lines.push(`//`);
  lines.push(`// TestPlan comes from hl7.fhir.uv.testing (an "additional resource" for this FHIR`);
  lines.push(`// version); _package.py injects the root-level resourceDefinition after SUSHI runs.`);
  lines.push(`Instance: ${id}`);
  lines.push(`InstanceOf: TestPlan`);
  lines.push(`Usage: #definition`);
  lines.push(`Title: "${fsh(plan.title)} Test Plan"`);
  lines.push(`Description: "${fsh(plan.planDescription ?? `Test plan for the ${plan.title} actor of ${cfg.spec.title}.`)}"`);
  lines.push('');
  lines.push(`* url = "${cfg.canonical}/TestPlan/${id}"`);
  lines.push(`* version = "${cfg.version}"`);
  lines.push(`* name = "${nameOf(plan.title)}TestPlan"`);
  lines.push(`* title = "${fsh(plan.title)} Test Plan"`);
  lines.push(`* status = #draft`);
  lines.push(`* experimental = true`);
  lines.push(`* date = "${today}"`);
  lines.push(`* publisher = "${fsh(cfg.publisher.name)}"`);
  lines.push(`* contact`);
  lines.push(`  * name = "${fsh(cfg.publisher.name)}"`);
  if (cfg.publisher.url) { lines.push(`  * telecom`); lines.push(`    * system = #url`); lines.push(`    * value = "${cfg.publisher.url}"`); }
  lines.push('');
  const shape = plan.multi
    ? "Each `suite` below is one suite of the test set, carried by the feature file its `suite.input.file` names, and each `suite.test` one of that file's `Scenario:` lines. The assertions are the scenario's `Then` steps, verbatim."
    : "Each `suite` below is a `Rule:` of the Gherkin feature named by `suite.input.file`, and each `suite.test` one of its `Scenario:` lines, matched by the scenario's identifier. The assertions are the scenario's `Then` steps, verbatim.";
  // A reader of this page has no other way to reach the script: the publisher
  // does not list TestPlan or Binary in artifacts.html (both are additional
  // resources, so it has no renderer to group them under), and
  // `suite.input.file` renders as plain text. Without this line the page
  // explains that each test is a Scenario of a feature and then offers no way
  // to see that feature.
  // Binary ids are the feature basename without the extension — the same rule
  // featureIndex() uses, so the two cannot disagree.
  const scripts = (plan.files ?? [])
    .map(f => path.basename(f))
    .map(file => `[${file}](Binary-${file.replace(/\.feature$/, '')}-gherkin-script.html)`)
    .join(', ');
  const desc = [
    plan.intro ?? `Test plan for the **${plan.title}** actor of [${cfg.spec.title}](${cfg.spec.site}).`,
    '',
    plan.description,
    '',
    shape,
    scripts ? `The script itself is rendered at ${scripts}, and ships in the package under \`tests/gherkin/\`.` : '',
    plan.multi ? `${plan.scenarioCount} test cases across ${plan.suites.length} suites.` : '',
    plan.coversCount ? `The tests declare which specification obligations they cover (${plan.coversCount} element obligations across the plan); the coverage matrix is checked mechanically against the specification package.` : '',
    plan.note ?? '',
  ].filter(Boolean).join('\n');
  lines.push(`* description = ${fshBlock(desc)}`);
  lines.push(`* purpose = "${fsh(plan.purpose ?? `To declare, in a machine-readable and runnable form, which behaviours a system claiming conformance to the ${plan.title} actor must demonstrate.`)}"`);
  lines.push('');
  lines.push(`// What is under test.`);
  lines.push(`* scope`);
  lines.push(`  * reference = "${plan.scope}"`);
  lines.push(`  * description = "${fsh(plan.scopeDescription ?? `${plan.title} — the system under test.`)}"`);
  lines.push('');
  lines.push(`* runner = "${cfg.runner ?? 'https://www.itb.ec.europa.eu/docs/guides/latest/'}"`);
  let si = 0;
  for (const suite of plan.suites) {
    lines.push('');
    if (plan.multi) lines.push(`// ── ${suite.name}: ${suite.scenarios.length} test case(s)`);
    lines.push(`* suite[${si === 0 ? '0' : '+'}]`);
    lines.push(`  * name = "${fsh(suite.name)}"`);
    if (suite.description) lines.push(`  * description = "${fsh(suite.description)}"`);
    lines.push(`  * input`);
    lines.push(`    * name = "gherkin-script"`);
    lines.push(`    * file = "${path.basename(suite.file)}"`);
    let ti = 0;
    for (const sc of suite.scenarios) {
      lines.push(`  * test[${ti === 0 ? '0' : '+'}]`);
      lines.push(`    * name = "${fsh(sc.title)}"`);
      const d = [
        sc.rule ? `${sc.rule}.` : '',
        sc.description,
        sc.covers.length ? `Covers ${sc.profile ? sc.profile + ': ' : ''}${sc.covers.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
      if (d) lines.push(`    * description = "${fsh(d)}"`);
      lines.push(`    * operation = #gherkin/Scenario`);
      let ai = 0;
      for (const a of assertions(sc)) {
        // A checklist step yields one assertion per row, so the plan lists
        // every item the operator judges.
        const humans = a.rows?.length
          ? a.rows.map(r => `${r.item ?? Object.values(r)[0]}${r.detail ? ` (${r.detail})` : ''} — ${a.text.replace(/:$/, '')}`)
          : [a.note ? `${a.note}: ${a.text}` : a.text];
        for (const h of humans) {
          lines.push(`    * assertion[${ai === 0 ? '0' : '+'}]`);
          lines.push(`      * severity = #error`);
          lines.push(`      * human = "${fsh(h)}"`);
          ai++;
        }
      }
      ti++;
    }
    si++;
  }
  return lines.join('\n') + '\n';
}

/** Every feature file of every plan, with the identity its Binary carries. */
function featureIndex(plans) {
  const out = new Map();
  for (const plan of plans) {
    plan.files.forEach((f, i) => {
      const file = path.basename(f);
      out.set(file, {
        file, source: f, id: file.replace(/\.feature$/, ''),
        name: plan.multi ? `Gherkin: ${suiteNameOf(plan.parsed[i].title)}` : `${plan.title} Gherkin Script`,
        description: plan.multi
          ? `Gherkin feature file with the test cases of one suite of ${cfg.spec.title}.`
          : `Gherkin feature file with the test scenarios for the ${plan.title} actor.`,
      });
    });
  }
  return [...out.values()];
}

function binaryFsh(featureFiles) {
  const out = [`// ===== RENDERING ONLY — delete with the Binary resource entries in sushi-config.yaml =====`,
    `// The Gherkin ships to runners as raw .feature files under package/tests/ via the`,
    `// path-test parameter. These Binaries only make each script render as a`,
    `// syntax-highlighted page on the IG site ("ig-loader-<file>" inlines the file).`];
  for (const f of featureFiles) {
    out.push('', `Instance: ${f.id}-gherkin-script`, `InstanceOf: Binary`, `Usage: #definition`, `* language = #en`, `* contentType = #text/x-gherkin`, `* data = "ig-loader-${f.file}"`);
  }
  return out.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────
// sushi-config.yaml and pages
// ─────────────────────────────────────────────────────────────────────

function sushiConfig(plans, featureFiles) {
  const y = [];
  y.push(`# GENERATED by build-test-ig.mjs. Regenerate rather than edit.`);
  y.push(`id: ${cfg.id}`);
  y.push(`canonical: ${cfg.canonical}`);
  y.push(`url: ${cfg.canonical}/ImplementationGuide/${cfg.id}`);
  y.push(`name: ${cfg.name}`);
  y.push(`title: "${cfg.title}"`);
  y.push(`description: >-`);
  y.push(`  ${cfg.description}`);
  y.push(`status: active`);
  y.push(`license: ${cfg.license ?? 'CC0-1.0'}`);
  y.push(`date: ${today}`);
  y.push(`version: ${cfg.version}`);
  // snapshot1, which is what the current publisher builds. This was ballot5
  // until 2026-10-13, when hl7.fhir.uv.testing was rebuilt against snapshot1 —
  // before that, snapshot1 passed SUSHI and then died in the publisher with
  // "The resource TestPlan cannot be converted from R5 to R4", because
  // TestPlan is in neither hl7.fhir.r6.core#6.0.0-snapshot1 nor a snapshot1
  // build of the Testing IG. Verified with publisher 3.0.1: exit 0, 0 errors.
  y.push(`fhirVersion: ${cfg.fhirVersion ?? '6.0.0-snapshot1'}`);
  y.push(`copyrightYear: ${today.slice(0, 4)}+`);
  y.push(`releaseLabel: ci-build`);
  y.push(`publisher:`);
  y.push(`  name: ${cfg.publisher.name}`);
  y.push(`contact:`);
  y.push(`  - name: ${cfg.publisher.name}`);
  if (cfg.publisher.url) { y.push(`    telecom:`); y.push(`      - system: url`); y.push(`        value: ${cfg.publisher.url}`); }
  y.push(`jurisdiction: http://unstats.un.org/unsd/methods/m49/m49.htm#001 "World"`);
  y.push('');
  y.push(`# TestPlan lives in the FHIR Testing IG (removed from R6 core at 6.0.0-ballot5).`);
  y.push(`dependencies:`);
  y.push(`  hl7.fhir.uv.testing: current`);
  // Extra dependencies a guide needs, "package: version". Typically a newer
  // hl7.fhir.uv.tools.r5 than the testing IG pins, so that the publisher
  // validates IG parameters against a CodeSystem that knows them.
  for (const [pkg, ver] of Object.entries(cfg.dependencies ?? {})) y.push(`  ${pkg}: ${ver}`);
  // "dependency": false leaves the specification out of the dependency list. Its
  // package may ship files the IG Publisher refuses to load (the terminology
  // ecosystem package carries its test cases, which are matchetypes with $instant$
  // and $id$ placeholders, not valid FHIR), and a plan that only quotes canonicals
  // in prose does not need the package to resolve.
  if (cfg.spec.dependency !== false) {
    y.push(`  # The specification whose actors these plans test — tracking only, so the`);
    y.push(`  # canonicals the plans point at resolve. A cross-version reference when the`);
    y.push(`  # spec is R4: only canonicals are used, no profiles are derived.`);
    y.push(`  ${cfg.spec.id}:`);
    y.push(`    id: ${cfg.spec.alias ?? 'spec'}`);
    y.push(`    uri: ${cfg.spec.uri}`);
    y.push(`    version: ${cfg.spec.version}`);
  } else {
    y.push(`  # ${cfg.spec.id} is deliberately NOT a dependency: ${cfg.specDependencyNote ?? 'its package carries content the publisher cannot load'}.`);
  }
  y.push('');
  y.push(`resources:`);
  y.push(`  # TestPlan is an "additional resource": the publisher needs a root-level`);
  y.push(`  # resourceDefinition that FSH cannot emit; _package.py injects it after SUSHI.`);
  for (const p of plans) {
    y.push(`  TestPlan/${p.instanceId ?? `${p.id}-tests`}:`);
    y.push(`    name: ${p.title} Test Plan`);
    y.push(`    description: ${p.resourceDescription ?? `Declares the Gherkin test cases for the ${p.title} actor of ${cfg.spec.title}.`}`);
    y.push(`    exampleBoolean: false`);
  }
  // Hand-authored FSH this guide also publishes (a requirements CapabilityStatement, say).
  for (const r of cfg.extraResources ?? []) {
    y.push(`  ${r.reference}:`);
    y.push(`    name: ${r.name}`);
    y.push(`    description: ${r.description}`);
    y.push(`    exampleBoolean: false`);
  }
  y.push(`  # ===== RENDERING ONLY — delete this block, path-binary below, and input/fsh/binary-gherkin.fsh together`);
  for (const f of featureFiles) {
    y.push(`  Binary/${f.id}-gherkin-script:`);
    y.push(`    name: ${/[:#]/.test(f.name) ? `"${f.name}"` : f.name}`);
    y.push(`    description: ${f.description}`);
    y.push(`    exampleBoolean: false`);
    y.push(`    extension:`);
    y.push(`      - url: http://hl7.org/fhir/tools/StructureDefinition/implementationguide-resource-format`);
    y.push(`        valueCode: text/x-gherkin`);
  }
  y.push(`  # ===== END RENDERING ONLY`);
  y.push('');
  y.push(`pages:`);
  y.push(`  index.md:`);
  y.push(`    title: Home`);
  y.push(`  testing.md:`);
  y.push(`    title: Testing`);
  if (cfg.processPage) { y.push(`  process.md:`); y.push(`    title: Method`); }
  y.push(`  changes.xml:`);
  y.push(`  downloads.xml:`);
  y.push('');
  y.push(`menu:`);
  y.push(`  Home: index.html`);
  y.push(`  Testing: testing.html`);
  if (cfg.processPage) y.push(`  Method: process.html`);
  y.push(`  Artifacts: artifacts.html`);
  y.push(`  Downloads: downloads.html`);
  y.push(`  Changes: changes.html`);
  y.push('');
  y.push(`parameters:`);
  y.push(`  # path-test mirrors input/testing into package/tests/: the .feature files travel`);
  y.push(`  # as Gherkin, and a runner resolves TestPlan.suite.input.file against them.`);
  y.push(`  path-test: input/testing`);
  y.push(`  incubator-ig: hl7.fhir.uv.testing`);
  y.push(`  # RENDERING ONLY — resolves the "ig-loader-<file>" data of the Binaries.`);
  y.push(`  path-binary: input/testing/gherkin`);
  y.push('');
  y.push(`FSHOnly: false`);
  return y.join('\n') + '\n';
}

/** A config text block: a string, or an array of lines. */
const block = (v, dflt) => (v === undefined ? dflt : Array.isArray(v) ? v.join('\n') : v);
/** Extra prose sections a config adds to a page. */
const sections = list => (list ?? []).map(s =>
  `<a name="${s.anchor}"> </a>\n\n### ${s.title}\n\n${block(s.body, '')}\n`).join('\n');

function indexMd(plans) {
  const rows = plans.map(p => `* **[${p.title} Test Plan](TestPlan-${p.instanceId ?? `${p.id}-tests`}.html)** — ${p.summary ?? ''}` +
    (p.multi ? '' : ` ([Gherkin](Binary-${path.basename(p.files[0]).replace(/\.feature$/, '')}-gherkin-script.html))`)).join('\n');
  return `<a name="scope"> </a>

${cfg.description}

<blockquote class="stu-note">
<strong>${cfg.disclaimer ?? 'This is not an approved test specification.'}</strong>
${block(cfg.blurb, `It exists to exercise the tooling: the TestPlan resource, the Gherkin scripts, the
mechanical coverage of the specification's obligations, and the packaging of all three.`)}
</blockquote>

### What is here
<a name="content"> </a>

| | |
| --- | --- |
| [Testing](testing.html) | ${cfg.testingPageSummary ?? "How the test plans are derived from the specification's actors and obligations, how the Gherkin scripts are pointed at and packaged, and how they are rendered here."} |
${cfg.processPage ? '| [Method](process.html) | The step-by-step record of how these tests were produced and checked. |\n' : ''}| [Artifacts](artifacts.html) | ${cfg.artifactsSummary ?? 'The TestPlan resources, one per actor, and the Gherkin scripts they name.'} |
| [Downloads](downloads.html) | The published package, including the raw \`.feature\` files under \`tests/gherkin/\`. |

${block(cfg.planIntro, `One test plan per actor of [${cfg.spec.title}](${cfg.spec.site}):`)}

${rows}

${plans.length === 1 ? 'It is' : 'All are'} written for the [Interoperability Test Bed](${cfg.runner ?? 'https://www.itb.ec.europa.eu/docs/guides/latest/'}) in the OTB Gherkin language (generation 2).

${sections(cfg.indexSections)}<a name="navigation"> </a>

The top menu navigates the sections, and a [Table of Contents](toc.html) lists the full content.
`;
}

function testingMd(plans) {
  const rows = plans.map(p => {
    const content = p.multi
      ? `${p.suites.length} suites, ${p.scenarioCount} test cases`
      : `${p.scenarioCount} scenarios${p.coversCount ? `, ${p.coversCount} element obligations covered` : ''}`;
    const files = p.multi ? `${p.files.length} files` : `\`${path.basename(p.files[0])}\``;
    return `| [${p.title} Test Plan](TestPlan-${p.instanceId ?? `${p.id}-tests`}.html) | [${p.title}](${p.scope}) | ${content} | ${files} |`;
  }).join('\n');
  // When a plan's suites are whole feature files, list them: that table is the
  // map from the test set's own grouping to what is published here.
  const suiteTables = plans.filter(p => p.multi).map(p => `
<a name="suites"> </a>

### The suites

| Suite | Test cases | Feature file |
| ----- | ---------- | ------------ |
${p.suites.map(s => `| [${s.name}](Binary-${path.basename(s.file).replace(/\.feature$/, '')}-gherkin-script.html) | ${s.scenarios.length} | \`${path.basename(s.file)}\` |`).join('\n')}
`).join('\n');

  const obligations = cfg.obligationsSection === false ? '' : `<a name="obligations"> </a>

### From obligations to test cases

The specification states its expectations as **obligations** on profile elements (the \`obligation\` extension): which actor must populate, be able to populate, handle or display which element, and how strongly. The test cases are derived from that list, not written from a reading of the narrative:

| Obligation | Test pattern |
| ---------- | ------------ |
| \`SHALL:populate\` | The element is present in every instance the Creator produces. |
| \`SHALL:populate-if-known\` | The element is present wherever the reference dataset the system was loaded with has it. |
| \`SHALL:able-to-populate\`, \`SHOULD:able-to-populate\` | Present in the produced document; where the reference data cannot exercise it, the tester attests the capability. |
| \`MAY:able-to-populate\` | Recorded in the test, not asserted. |
| \`SHALL:handle\` | The Consumer accepts a document carrying the element without error. |
| \`SHOULD:display\` | The Consumer shows the element to a human; the tester names the ones it does not, and each is asserted separately. |

Every scenario declares the profile and elements it covers (\`@profile:\`, \`@covers:\` tags) and must mention each element in a step; a script checks both against the specification package, so an obligation cannot be silently dropped when the specification or the tests change. The assertions themselves are self-tested against the specification's own example documents before they are published.

`;

  return `<a name="scope"> </a>

### ${cfg.testingTitle ?? `Testing the ${cfg.spec.title} actors`}

${block(cfg.testingIntro, `This guide declares its tests with the [TestPlan](https://build.fhir.org/ig/HL7/fhir-testing-ig/en/StructureDefinition-TestPlan.html) resource from the [FHIR Testing IG](https://build.fhir.org/ig/HL7/fhir-testing-ig/en/) (\`hl7.fhir.uv.testing\`), one plan per actor the specification defines. Each plan's \`scope\` names the actor — what is under test — and each of its tests is one \`Scenario:\` of a Gherkin feature file that the plan points at through \`suite.input.file\`.`)}

| Test plan | Under test | Content | Feature file |
| --------- | ---------- | ------- | ------------ |
${rows}
${suiteTables}
${sections(cfg.testingSections)}${obligations}<a name="gherkin"> </a>

### The Gherkin feature files

The executable test cases live under \`input/testing/gherkin/\`. They ship **as Gherkin, not as a FHIR resource**: the \`path-test\` parameter mirrors the test tree into the published package under \`package/tests/gherkin/\`, which is what a test runner consumes. \`TestPlan.suite.input.file\` names the file, and each \`suite.test\` matches a \`Scenario:\` by its identifier.

The Binary resources on this site exist only so the scripts render as syntax-highlighted pages; removing them changes nothing for a runner.
`;
}

function readmeMd(plans) {
  const extra = (cfg.extraResources ?? []).map(r => `| \`input/fsh/${r.fsh}\` | ${r.description} Hand-authored; the generator leaves it alone. |`).join('\n');
  return `${cfg.title}
---

${cfg.description}

**${cfg.disclaimer ?? 'This is not an approved test specification.'}** It exists to exercise the tooling.

GENERATED by \`itb-plugin-authoring/app/scripts/build-test-ig.mjs\` from the feature files; regenerate rather than edit the generated files.

### What is in here

| Path | |
| --- | --- |
${plans.map(p => `| \`input/fsh/testplan-${p.id}.fsh\` | TestPlan for the ${p.title}${p.multi ? ` (${p.suites.length} suites, ${p.scenarioCount} test cases)` : ''} |`).join('\n')}
${extra}${extra ? '\n' : ''}| \`input/testing/gherkin/*.feature\` | The Gherkin scripts the plans point at, for the [Interoperability Test Bed](https://www.itb.ec.europa.eu/docs/guides/latest/) |
| \`input/fsh/binary-gherkin.fsh\` | Binaries that render the scripts on the IG site (presentational only) |
| \`_package.py\` | Builds \`dist/package.tgz\` from SUSHI output without the IG Publisher |

### Building

\`\`\`
python _package.py    # sushi + package only, no publisher -> dist/package.tgz
_genonce.sh           # or _genonce.bat: the full IG Publisher build
\`\`\`

### If the publisher refuses this IG's FHIR version

This IG targets \`${cfg.fhirVersion ?? '6.0.0-snapshot1'}\`, which the current
publisher builds — \`_updatePublisher.sh\` and \`_genonce.sh\` are all you need.

It is worth knowing why that pairing matters, because it broke once and will
break again. \`TestPlan\`, \`TestScript\` and \`TestReport\` are not in R6 core: they
were there through \`ballot3\`, went out at \`ballot5\`, and are not in
\`snapshot1\`. They live in \`hl7.fhir.uv.testing\`, so this IG's FHIR version has
to be one that **both** the publisher supports **and** that package is built
against. For a fortnight in October 2026 no such version existed — the publisher
had moved to \`snapshot1\` while the Testing IG was still on \`ballot5\` — and the
symptom was:

\`\`\`
Publishing Content Failed: The resource TestPlan cannot be converted from R5 to R4
\`\`\`

If that returns, check what \`hl7.fhir.uv.testing\` is built against:

\`\`\`
curl -s https://build.fhir.org/ig/HL7/fhir-testing-ig/package.manifest.json
\`\`\`

and set this IG's \`fhirVersion\` to match. If instead the publisher rejects the
version outright — *"Unable to support version X"* — it is the publisher that is
behind or ahead, and \`./_pinPublisher.sh <version>\` will fetch a specific one.
SUSHI succeeds throughout either failure, so \`dist/package.tgz\` is never the
thing to doubt.
`;
}

/**
 * Fit a standalone record into an IG page.
 *
 * The record is written to be read on its own, so it opens with an `#` title
 * and uses `##` for its sections. The IG template supplies the page's own
 * heading from `pages:` in sushi-config ("Method"), which renders as an `<h2>`,
 * so copying the file verbatim gives a page whose first heading is below a
 * later one and which has several top-level headings. The publisher reports
 * both as WCAG errors:
 *
 *   The heading <h1> '…' is at a higher level than the first heading on the
 *   page (<h2> 'Method'). The first heading on a page must be its top level
 *   heading (WCAG compliance test)
 *
 * So drop the title — the page already has one — and push everything else down
 * a level, leaving exactly one top-level heading. Fenced code blocks are left
 * alone, or a `#` comment inside a bash example would be mangled into a
 * heading.
 */
function asPageContent(md) {
  const out = [];
  let fence = null;
  let droppedTitle = false;
  for (const line of md.split(/\r?\n/)) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence) { out.push(line); continue; }
    const h = /^(#{1,5})(\s+)(.*)$/.exec(line);
    if (h) {
      if (h[1].length === 1 && !droppedTitle) { droppedTitle = true; continue; }
      out.push('#' + h[1] + h[2] + h[3]);
      continue;
    }
    out.push(line);
  }
  // Dropping the title usually leaves a blank first line.
  while (out.length && out[0].trim() === '') out.shift();
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

const plans = (cfg.plans ?? cfg.actors).map(buildPlan);
const featureFiles = featureIndex(plans);

fs.mkdirSync(OUT, { recursive: true });
copyDir(SCAFFOLD, OUT);
fs.mkdirSync(path.join(OUT, 'input', 'fsh'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'input', 'testing', 'gherkin'), { recursive: true });
for (const d of ['examples', 'extensions', 'images', 'images-source', 'models', 'profiles', 'resources', 'vocabulary']) fs.mkdirSync(path.join(OUT, 'input', d), { recursive: true });

// Feature files and plans this guide no longer publishes (a reused folder, a
// renamed suite) must not travel in the package.
const wanted = new Set(featureFiles.map(f => f.file));
for (const f of fs.readdirSync(path.join(OUT, 'input', 'testing', 'gherkin'))) {
  if (f.endsWith('.feature') && !wanted.has(f)) fs.unlinkSync(path.join(OUT, 'input', 'testing', 'gherkin', f));
}
for (const f of fs.readdirSync(path.join(OUT, 'input', 'fsh'))) {
  if (/^testplan-.*\.fsh$/.test(f) && !plans.some(p => `testplan-${p.id}.fsh` === f)) fs.unlinkSync(path.join(OUT, 'input', 'fsh', f));
}

fs.writeFileSync(path.join(OUT, 'sushi-config.yaml'), sushiConfig(plans, featureFiles));
for (const p of plans) fs.writeFileSync(path.join(OUT, 'input', 'fsh', `testplan-${p.id}.fsh`), testPlanFsh(p));
for (const f of featureFiles) fs.copyFileSync(path.join(FEATURES, f.source), path.join(OUT, 'input', 'testing', 'gherkin', f.file));
fs.writeFileSync(path.join(OUT, 'input', 'fsh', 'binary-gherkin.fsh'), binaryFsh(featureFiles));
fs.writeFileSync(path.join(OUT, 'input', 'pagecontent', 'index.md'), indexMd(plans));
fs.writeFileSync(path.join(OUT, 'input', 'pagecontent', 'testing.md'), testingMd(plans));
if (cfg.processPage) {
  fs.writeFileSync(
    path.join(OUT, 'input', 'pagecontent', 'process.md'),
    asPageContent(fs.readFileSync(path.resolve(path.dirname(configPath), cfg.processPage), 'utf8')));
}
else if (fs.existsSync(path.join(OUT, 'input', 'pagecontent', 'process.md'))) fs.unlinkSync(path.join(OUT, 'input', 'pagecontent', 'process.md'));
fs.writeFileSync(path.join(OUT, 'README.md'), readmeMd(plans));
// The scaffold's ig.ini names the IG file by id.
fs.writeFileSync(path.join(OUT, 'ig.ini'), fs.readFileSync(path.join(SCAFFOLD, 'ig.ini'), 'utf8').replace(/ImplementationGuide-[^\s]+\.json/, `ImplementationGuide-${cfg.id}.json`));

const caseCount = plans.reduce((n, p) => n + p.scenarioCount, 0);
console.log(`wrote ${path.relative(process.cwd(), OUT) || OUT}: sushi-config.yaml, ${plans.length} TestPlan(s) with ${caseCount} test case(s), ${featureFiles.length} feature(s), pages`);
for (const r of cfg.extraResources ?? []) console.log(`  left alone (hand-authored): input/fsh/${r.fsh}`);

if (args.includes('--package')) {
  console.log('== _package.py ==');
  execSync('python _package.py', { cwd: OUT, stdio: 'inherit' });
}
