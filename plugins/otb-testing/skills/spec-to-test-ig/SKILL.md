---
name: spec-to-test-ig
description: Build a FHIR Test Package — an implementation guide carrying one TestPlan per actor plus the Gherkin it names — from a specification, self-testing the assertions against the spec's own examples first. Use when asked for a FHIR Test Package or a test IG, to "add test cases for the actors of <IG>", to cover obligations, or to publish an existing Gherkin suite as TestPlans.
---

# From a specification to a FHIR Test Package

A **FHIR Test Package** is an implementation guide carrying one `TestPlan` per
actor plus the Gherkin each plan names, published as `dist/package.tgz`. Not to
be confused with a **test suite archive** (`suite-<feature>.zip`), which is the
GITB TDL you upload to an ITB and run — a different artifact, built by
`spec-to-tests`. A user may want either or both; ask if "test package" is all
you were given.

## First: is this the right skill?

This procedure is **obligation-driven**. It derives test cases from the
`obligation` extensions on a FHIR IG's profiles, self-tests the assertions
against the IG's own examples, and then packages them.

**If the specification carries no obligations, use `spec-to-tests` for stages 1
to 3 and come back here for the packaging (step 6).** Check before starting:

```
node app/scripts/ips-obligations.mjs extract --spec <id>#<version> --url <site>
```

Nothing extracted means one of two things, and they differ:

- **a FHIR IG without obligations** — derive from `mustSupport` plus the
  narrative, as step 3 says, and continue here;
- **not a FHIR IG at all** — no package on the registry, so no profiles, no
  capability statements, no examples. IHE IUA is this case. There is nothing for
  this procedure to read, so hand stages 1 to 3 to `spec-to-tests`, which works
  from the narrative, then return for step 6 with the feature files it produced.
  Set `spec.dependency: false` in the config and quote the requirements in prose.

Either way the deliverable is the same, and step 6 does not care how the
features were authored.

The procedure that produced `ips-creator.feature`, `ips-consumer.feature`,
`ips-server.feature` and the `hl7-ips-test` IG. Follow it in order and keep the
record (step 7) as you go; the record is part of the deliverable.

## 0. What you produce

| Deliverable | Where |
|---|---|
| Obligation inventory | `app/public/data/<spec>-obligations.json` |
| Feature files, one per actor | `app/public/features/<spec>-<actor>.feature` |
| Coverage matrix (obligation → test) | `app/public/data/<spec>-obligation-coverage.json` |
| Process record | `app/public/features/<SPEC>-TESTS.md` |
| The IG package | `<igRoot>/<spec>-test/` with `dist/package.tgz` — `igRoot` comes from step 6, never from a guess |

Before handing any of it over, `scripts/check-test-ig.mjs` must pass: every plan
names a script, every script has scenarios, and **every assertion is a step of
that script**. Neither SUSHI nor the IG Publisher checks this.

## 1. Check the specification

Download the published package (`<site>/package.tgz`) and read, from the
package rather than the HTML: `package.json` (id, version, FHIR version), the
`Basic-*.json` / `ActorDefinition-*.json` actors, the `CapabilityStatement-*`
each actor points at, and the `example/` documents. Note which example is the
richest (the reference dataset) and which show missing information.

## 2. Check the actors

For each actor record: id, canonical, description, `derivedFrom` (a derived
actor inherits every obligation of its base and adds a transport, e.g. the IPS
Server adds `$summary` to the Creator), and the CapabilityStatement if any.

## 3. See the obligations

```
node app/scripts/ips-obligations.mjs extract --spec <id>#<version> --url <site>
```

reads every `obligation` extension on every profile's snapshot elements into
(profile, element, code, actor). The extractor is generic; if the spec has no
obligation extensions, stop here and derive the list from `mustSupport` plus
the narrative instead, recording each derived obligation with its source.

## 4. Define the test cases

One feature per actor. One scenario per profile that carries obligations for
that actor, plus document-level scenarios and the missing-information cases.
Each obligation code has one test pattern:

| Obligation | Pattern |
|---|---|
| `SHALL:populate` | `all(<element>.exists())` on every instance the SUT produced |
| `SHALL:populate-if-known` | present wherever the reference dataset has it: `all(...)` when every reference instance has it, `where(...).exists()` when some do, tester attestation when none does |
| `SHALL/SHOULD:able-to-populate` | present in the produced document, else attested |
| `MAY:able-to-populate` | `log`, no assertion |
| `SHALL:handle` | the operator attaches the import log or a screenshot (`submits evidence of … as $x`), then `confirms each of these is accepted for "…":` with the elements as table rows — one verdict per row |
| `SHOULD:display` | the operator displays the elements, attaches a screenshot, then `confirms each of these is displayed for "…":` — one verdict per row |

Rules that keep the tests meaningful:

- The reference dataset is the spec's own richest example: the Creator's system
  is loaded with it, the Consumer is handed it. That is what makes
  `populate-if-known` testable.
- Every scenario carries `@profile:<id>` and `@covers:<element>` tags and
  mentions every covered element in a step (an assertion path, or the prompt
  text). `check` fails otherwise.
- Every behavioural obligation (display, handle, attested capability) is
  proved with `<Actor> submits evidence of "…" as $x` (instruction, required
  file, optional note, kept in the session report) and judged with
  `<Actor> confirms each of these is <word> for "…":` plus a table of items.
  Those two core constructs are the whole vocabulary for operator-judged
  behaviour; a dialect adds rows, never a new way of asking.
- A derived actor gets a feature for its transport only; its inherited
  obligations are the base actor's feature run on the transport's output.
- Prefer the generator (`generate`) over hand-writing; hand-write only the
  transport features (Server) and adjust the SPEC-SPECIFIC block of the
  generator (required sections, value-set discriminators).

## 5. Create and test them

```
node app/scripts/ips-obligations.mjs all --spec <id>#<version> --url <site> --reference <example>
node ../itb-cli/packages/gherkin/scripts/check-features.mjs app/public app/public/features/<spec>-creator.feature
java -jar validator_cli.jar <reference example> -version 4.0.1 -ig <id>#<version>
```

`all` = extract → generate → **selftest** (every generated assertion is
evaluated with fhirpath.js against the spec's own examples; a form that does
not hold is downgraded or turned into an attestation, so what is written holds
on the reference) → **check** (every obligation covered and mentioned). Then
compile each feature to TDL with `check-features.mjs`, and validate the
reference example with the HL7 validator so the dataset itself is known good.
Run a scenario end to end on the ITB only when a system under test exists.

## 6. Package as an IG

### First: where do this user's IGs live?

Before writing the config, find out where the IG should go. **Do not guess** — an
IG written into the wrong place is easy to lose and annoying to move once a git
repository exists in it.

```
node scripts/ig-root.mjs status
```

It prints one of three states and tells you what to do:

| State | What it means | What you do |
|---|---|---|
| `set` | A default folder is recorded | **Do not ask.** Write the IG under it |
| `none` | The user said they have no default | **Do not ask again** for a default. Ask where this one IG goes, or default to `./<ig-name>` |
| `unset` | Never answered, or last answer was "not now" | **Ask, once**, offering the best candidate it found |

When the state is `unset`, `status` also lists folders on disk that already hold
several IGs. Offer the top candidate — it is a guess, not an answer — and give
the user all three ways out. Then record what they said:

```
node scripts/ig-root.mjs set E:\work\ImplementationGuides   # a folder, created if missing
node scripts/ig-root.mjs set none                           # no default; never ask again
node scripts/ig-root.mjs defer                              # "not now" — ask again next time
```

`defer` deliberately records no answer. "Not now" means *ask me again*, so it
must not become a silent "none".

Then get the output path, which goes in the config's `out`:

```
node scripts/ig-root.mjs out <ig-name>        # e.g. ihe-iua-test
```

The config is per user, at `~/.claude/otb-testing.json`, because where someone
keeps their IGs is a property of their machine and not of one specification.

### Then build it

```
node app/scripts/build-test-ig.mjs app/public/data/<spec>-test-ig.json --package
```

`out` may be absolute — which is what `ig-root.mjs out` gives you — or relative
to the config file.

### The FHIR version has to satisfy two things at once

`fhirVersion` is `6.0.0-snapshot1`. Verified 2026-10-15 with IG Publisher 3.0.1:
**exit 0, 0 errors.**

The reason it needs watching at all: `TestPlan`, `TestScript` and `TestReport`
are **not in R6 core**. They were there through `ballot3`, went out at `ballot5`,
and are not in `snapshot1`. They live only in `hl7.fhir.uv.testing`, which is
why every `TestPlan` instance is an *additional resource* needing the root-level
`resourceDefinition` that `_package.py` injects after SUSHI.

So the version must be one that **both** the publisher supports **and** the
Testing IG is built against. Those two drift independently, and for a fortnight
in October 2026 they had no version in common — the publisher had moved to
`snapshot1` while the Testing IG was still `ballot5`, so no FHIR version worked.
It resolved on 2026-10-13 when the Testing IG was rebuilt.

**If the IG stops building, that pairing is the first thing to check**, because
neither error message mentions it:

| Symptom | Means | Do |
|---|---|---|
| `The resource TestPlan cannot be converted from R5 to R4` | The IG's version and the Testing IG's disagree | Read the manifest below and match it |
| `Unable to support version 'X'` | The publisher does not build X | `./_updatePublisher.sh`, or `./_pinPublisher.sh <version>` |

```
curl -s https://build.fhir.org/ig/HL7/fhir-testing-ig/package.manifest.json
```

Its `fhirVersion` is what this IG's `fhirVersion` must be. Beware the package's
own label: through to October 2026 it was versioned `0.1.0-snapshot1` while
declaring `fhirVersions: ["6.0.0-ballot5"]` — **read the manifest, not the
version string.** Also check the local cache is not stale
(`~/.fhir/packages/hl7.fhir.uv.testing#current/package/package.json`), since the
dependency is `current` and a stale copy will reintroduce a resolved problem.

**SUSHI succeeds through both failures**, producing correct `fsh-generated/` and
`dist/package.tgz`. So a clean `--package` run says nothing about whether the IG
will publish, and the package is never the thing to doubt.

The config names the IG, the spec, its actors (scope canonical, feature file)
and the process page. The builder writes `sushi-config.yaml`, one TestPlan
FSH per actor (suite per `Rule:`, test per `Scenario:`, assertion per `Then`
step, covered obligations in each test's description), the Binaries that
render the Gherkin, the pages, and the vendored scaffold
(`app/scripts/test-ig-scaffold/`: `_package.py`, template, CI). `--package`
runs SUSHI and produces `dist/package.tgz`. Commit the IG folder as its own
repository.

### Then check that the plans are backed by the scripts — always

```
node scripts/check-test-ig.mjs <ig folder>
```

**Run this on every build. Exit non-zero means do not ship.** SUSHI and the IG
Publisher both pass a Test Package whose plans declare tests nothing implements,
because neither reads the Gherkin. Three ways that happens:

| What it catches | Why it matters |
|---|---|
| A suite naming no script, or naming one that is not in the package | The plan reads fine and implements nothing |
| A script present but with no `Scenario:` | The plan declares tests the script does not contain |
| **An assertion that is not a step of the script** | Looks like a test, nothing executes it — the plan reads as *more* thorough than the suite is |

The third is the reason this exists. The other two you would eventually notice;
a drifted assertion you would not. The check accepts two legitimate shapes: a
step verbatim, and a data-table row written `"<row> — <step>"`, where **both**
halves must be present — accepting the row alone would let a row drift away from
its step and still pass.

A passing line reads `54 test(s), 108/108 assertion(s) found in the script`. If
the two numbers differ, every unmatched assertion is listed.

### And look at the rendered Gherkin, not the redirect

An IG with `langs:` writes `output/<lang>/…` and leaves a small redirect stub at
`output/…`. The stub is ~580 bytes and contains the words "Redirect File", so
checking the top-level `Binary-*.html` makes a perfectly good page look empty.
**Open `output/en/Binary-<id>-gherkin-script.html`** — a real one is tens of
kilobytes and contains the `Feature:` and every `Scenario:`.

Known gap, worth stating when handing over: **`artifacts.html` lists nothing** —
not the Binaries and not the TestPlans either. Both are additional resources, so
the publisher has no renderer to group them under. The IG resource itself
declares all of them correctly with names, so this is publisher behaviour and
not something the config can fix.

The builder works around it by linking from the pages it does control: the
index page lists each script, and each TestPlan's description now ends with a
link to its Binary. Without that the TestPlan page explains that every test is a
`Scenario:` of a feature and then gives the reader no way to see the feature,
since `suite.input.file` renders as plain text.

## 7. Keep the record

Write `app/public/features/<SPEC>-TESTS.md` as you go: what was checked (spec
version, actors, counts), the decisions (reference dataset, patterns, what is
attested rather than asserted), the test results (selftest, check, compile,
validator), and how to rerun. It becomes the IG's "Method" page.

## Where obligation logic belongs

Rendering and structural checking of obligation extensions is the IG
Publisher's job (it does both). Checking an *instance* against `populate`
obligations for a named actor is a validator concern and the HL7 validator /
HAPI core does not offer it from the CLI today (no actor option). Behavioural
obligations (`handle`, `display`, `able-to-populate`) can only be tested by a
harness with a reference dataset and a tester, which is what these features
are. See the IPS record for the full argument.
