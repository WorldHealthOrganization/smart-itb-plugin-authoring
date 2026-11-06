---
name: write-test-feature
description: Write or change a Gherkin feature file — the day-to-day authoring task. Use when asked to add a test case, cover a requirement with a test, fix a failing step, or turn a scenario description into an executable suite.
---

# Writing a feature file

## 0. First, find out whether you are allowed to edit this file

Most feature files in this project are **generated** and carry a banner saying
so. Editing one is wasted work: the next regeneration silently discards it.

```
head -3 <file>.feature
```

If it says it was generated, change the generator and rerun it. The generators
live in `app/scripts/` and each one documents its own arguments.

## 1. Say what the test is for before writing a step

A scenario name should say the thing being established, not the mechanics. A
reader who only sees the names should be able to tell what the suite claims.

If the test exists to cover a requirement from a specification, name that
requirement in a comment or a tag. A test that cannot be traced to a reason is
a test nobody dares delete later.

## 2. Declare the systems, then write the exchange

Every scenario needs exactly one system under test; that is what the
conformance result is about. Everything else is infrastructure or a service.

```gherkin
@lang:itb-core-en@^2 @dialect:fhir-validator@^2
Feature: What this file establishes

  Background:
    Given Server is the system under test at "https://example.org/fhir"
    And FHIRValidator is a fhir-validator at "http://fhir-validator:8081"

  Scenario: the document it returns is a conformant summary
    When Client gets from Server at "/Patient/" with id "pat-1" as $patient
    Then $response.status should be 200
    And $patient at "Patient.name.family" should exist
    And $patient should conform to "http://hl7.org/fhir/StructureDefinition/Patient"
```

The `@lang:` tag picks the language generation and the `@dialect:` tags load the
vocabularies. A dialect verb used without its tag still compiles, but the file
then lies about what it depends on.

For the full vocabulary, read `app/public/lang/EXPRESSIONS.md`. It lists every
sentence the language accepts with a filled-in example, and it is generated from
the language itself, so it is never out of date.

## 3. Rules that keep a suite trustworthy

- **Ask only for inputs the scenario uses.** `Background` executes before every
  scenario. Keep token, patient and resource prompts in the scenarios that need
  them; a public `/metadata` check should ask for none of those. Run a case alone
  and inspect its actual ITB input forms, including when automation answers them.
- **Make search assertions reject empty and unrelated results.** When a known
  matching fixture is a prerequisite, assert matching entries exist before using
  `all(...)`. Check resource type and the requested patient's reference. Inspect
  `search.mode` on `Bundle.entry`, not on its `resource`; ignore explicit includes
  without discarding entries whose optional search metadata is absent. Probe
  empty, wrong-type, wrong-patient, mixed and missing-reference responses.
- **Inspect the executed sequence.** Requests to a validator originate from the
  test harness, not the SUT. Name the human lane distinctly (for example, Test
  operator), keep arrow labels short, and retain full expressions in step details.
  Compilation success does not establish correct runtime bindings or actor mapping.


- **Assert the status of a raw exchange.** `posts to`, `gets from` and friends
  deliberately do not check it, because for a raw exchange the status is part of
  what you are testing. A dialect verb does assert its own success, so do not
  follow one with a status check.
- **Bind what you produce.** Every step that yields something ends `as $x`. Never
  rely on a value a previous step happened to leave behind.
- **Prefer a path assertion to a second request.** `$doc at "..." should be ...`
  reads better and fails more precisely than fetching and re-parsing.
- **Verify against the system, not against its own reply.** After a write, read
  it back before asserting it took effect.
- **One scenario, one claim.** If the name needs "and", it is two scenarios.
- **Give scenarios names that do not collide when slugified.** "Happy path" and
  "Happy Path" compile to the same test case id, the second silently overwrites
  the first, and the suite reports no error at all. Nothing catches this yet.

## 4. Compile it before you believe it

```
node <itb-cli>/packages/gherkin/scripts/check-features.mjs <asset-root> <features-dir>
```

The asset root is the folder containing `components/`, normally
`itb-plugin-authoring/app/public`. It exits non-zero if any file has errors and
prints the first three per file; add `--verbose` for warnings too.

Read the warnings, not only the errors. "Step requires component X which is not
enabled" and the actor-declaration warnings are usually the real problem.

If a step will not match, check in this order: the `@dialect:` tag is present,
the actor is declared with the kind the verb needs, and the sentence matches the
catalogue exactly. `EXPRESSIONS.md` is the catalogue.

## 5. Run it

Compiling proves the suite is well formed. It proves nothing about the system
under test. Deploy and run before claiming a test passes.

```
node <itb-cli>/bin/itb-suite.mjs run --case <testCaseId>
```

Two things to know about that command. It prints the verdict but **exits 0 even
when the session fails**, so read the output rather than the exit code. And a
session that needs an operator to answer a dialog reports `UNDEFINED` until
someone does, which is not the same as a failure.

When a run goes red, do not guess at the cause. Use the `diagnose-test-failure`
skill.

## 6. Leave it findable

A feature file is documentation that executes. If the suite is new, add a short
README beside it saying what it covers, what it needs to run, and what is known
to fail and why. If you discovered something about the environment while
getting it green, that belongs in the README too — it is the most perishable
knowledge in the project.
