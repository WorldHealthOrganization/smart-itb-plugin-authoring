# otb-testing

Six skills and three commands for turning a published specification into
executable conformance tests, and publishing them as a FHIR implementation
guide with TestPlan resources.

## Install

```
/plugin marketplace add WorldHealthOrganization/smart-itb-plugin-authoring
/plugin install otb-testing@otb-testing-toolkit
```

Then `/spec-to-tests <spec url>` to start, or just describe what you want — the
skills trigger on their own.

## Commands

| Command | What it does |
|---|---|
| `/spec-to-tests <spec>` | The whole arc: scope → case list → Gherkin → compile → run |
| `/test-ig <spec>` | Package an existing suite as a FHIR IG, one TestPlan per actor |
| `/diagnose <case>` | Work out why a test failed before calling it a defect |

## Skills

| Skill | Use it when |
|---|---|
| `spec-to-tests` | Someone brings a spec and wants tests for it |
| `write-test-feature` | Day-to-day: add a case, cover a requirement, fix a step |
| `diagnose-test-failure` | A suite went red and you need to localise the fault |
| `spec-to-test-ig` | Publish the suite as a TestPlan + Gherkin IG package |
| `add-language-dialect` | The language cannot say what your test needs |
| `change-core-language` | A new comparator or sentence shape. Rare, and governed |

## What needs what

Most of this works with Node and one npm package. Two skills do not, and it is
better to know now than halfway through.

| Skill | Needs |
|---|---|
| `spec-to-tests` | `@opentestbed/otb-gherkin`. Its compile / dialects / run scripts are bundled here |
| `write-test-feature`, `diagnose-test-failure` | Nothing — they are procedure |
| `add-language-dialect` | Nothing for a dialect of your own. The golden-corpus step needs the `itb-cli` checkout |
| `spec-to-test-ig` | **A checkout of `itb-plugin-authoring`** — it calls `app/scripts/build-test-ig.mjs` and `app/scripts/ips-obligations.mjs`, which are not bundled here |
| `change-core-language` | A checkout of the language package |

```bash
npm install @opentestbed/otb-gherkin @opentestbed/dialect-fhir-validator
```

Running tests — as opposed to writing them — additionally needs a reachable
Interoperability Test Bed, and a system under test to measure. Neither is needed
for anything up to and including "it compiles".

## Other agents

The skills are plain Markdown with YAML frontmatter and carry nothing
Claude-specific. The same `skills/` directory is declared by
`.codex-plugin/plugin.json` and by `.agents/plugins/marketplace.json` at the
repository root, so the marketplace is a front door rather than a lock-in. If
your tool reads neither, copy `skills/` wherever it looks for skills — you lose
update-on-install, nothing else.

## Three things the skills will insist on

**Agree the case list before writing any test.** Each case names the requirement
it covers; one that cannot name a requirement gets dropped. A list is cheap to
change and a suite is not.

**A clean compile is not a passing test.** It means the sentences parsed. The
IUA suite's first draft compiled cleanly while sending form-encoded bodies
labelled `application/json`.

**Say what you did not cover.** A suite that does not state its omissions reads
as a claim of completeness it cannot support.
