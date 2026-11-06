# Writing the feature files

The conventions for stage 3. If a full catalogue of the language is available
(`EXPRESSIONS.md` in the workbench's `lang/` folder, generated from the
language itself) read that for the exact sentences; this file is the shape and
the traps.

## The skeleton

```gherkin
@lang:itb-core-en@^2 @dialect:fhir-validator@^2
Feature: What this file establishes
  One paragraph: the scope sentence from stage 1, and what is out of scope.

  Background:
    Given Server is the system under test at "https://example.org/fhir" as defined by "https://example.org/spec"
    And FHIRValidator is a fhir-validator at "http://fhir-validator:8081"
    And Client is infrastructure

  # REQ-014: the summary carries a patient name
  Scenario: the document it returns names the patient
    When Client gets from Server at "/Patient/" with id "pat-1" as $patient
    Then $response.status should be 200
    And $patient at "Patient.name.family" should exist
    And $patient should conform to "https://example.org/spec/StructureDefinition/ThePatient"
```

The first line declares the language generation and the dialects. A dialect
verb used without its tag still compiles, but the file then lies about what it
depends on, and nothing will tell you.

## Six sentence shapes, and no more

Declaration, action, assertion, conformance, binding, interaction. A dialect
adds verbs within those shapes; it never adds a shape. If what you want to say
does not fit one, you need a dialect verb, not a creative sentence.

| Shape | Looks like |
|---|---|
| Declaration | `X is the system under test at "…"` / `X is a fhir-validator at "…"` |
| Action | `Client posts to Server at "/Thing" with body $x` |
| Assertion | `$x at "path" should be "value"` |
| Conformance | `$x should conform to "canonical"` |
| Binding | `extract "/id" from $response as $id` |
| Interaction | `Client is asked for $pin with "Enter the PIN"` |

## Rules that keep a suite trustworthy

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


- **One system under test per scenario.** That is what the conformance result
  is about. Everything else is infrastructure or a service.
- **One scenario, one claim.** If the name needs "and", it is two scenarios.
  Name it for the claim, not the mechanics.
- **Assert the status of a raw exchange.** `posts to` and `gets from`
  deliberately do not check it, because for a raw exchange the status is part
  of what you are testing. A dialect verb does assert its own success, so do
  not follow one with a status check.
- **Bind what you produce.** Every step that yields something ends `as $x`.
  Never rely on a value an earlier step happened to leave behind.
- **Verify against the system, not against its own reply.** After a write,
  read it back before asserting it took effect.
- **Carry the requirement reference.** A comment naming the requirement above
  each scenario, as in the skeleton. This is what makes the suite auditable and
  what lets someone delete a case safely later.

## Negative tests need a specific expectation

```gherkin
  # REQ-022: a summary without a patient must be refused
  Scenario: a document with no subject is rejected
    When Client posts to Server at "/Bundle" with body $noSubject
    Then $response.status should be 422
    And $response.body should contain "subject"
```

Asserting only "it failed" lets the test pass when the server is down. Assert
the status you expect and something about the reason.

After writing one, check it can fail: feed the same scenario a valid instance
and confirm it goes red. A must-reject test that passes on everything is not a
test.

## Traps

- **Scenario names that collide when slugified.** "Happy path" and "Happy Path"
  produce the same test case id; the second silently overwrites the first and
  nothing reports an error. Give scenarios distinct names.
- **Generated files.** Check the first lines before editing. Many feature files
  are produced by a generator and say so; an edit to one is discarded at the
  next regeneration. Change the generator instead.
- **Doc strings that start with a brace.** If a request body begins with `{`
  and contains `$variables`, the compiler rewrites it into a template behind
  your back. Pass a bound variable with `with body $x` instead, which is
  clearer anyway.
- **Backslashes.** The test bed has no escape character. A backslash anywhere
  in an expression is rejected at compile time. Use the other quote character,
  or build the string with `concat`.

## Where to put them

One feature file per coherent group of cases, named for what it covers. A
README beside them carrying the scope sentence, the confirmed case list, what
is not covered, and how to run them. The README is the part reviewers read.
