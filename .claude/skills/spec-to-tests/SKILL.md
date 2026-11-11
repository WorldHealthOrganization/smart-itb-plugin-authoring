---
name: spec-to-tests
description: Turn a specification into executable conformance tests — set the scope from its profiles or its actors, agree with the user which kinds of test to write, author them in Gherkin, prove they compile, and run them against a live Interoperability Test Bed. Use when someone brings a spec, an implementation guide, a profile, a capability statement, a regulation or a data model — in healthcare or any other domain — and wants tests for it, including when they ask for a FHIR Test Package from a specification that publishes no FHIR package of its own.
---

# From a specification to running tests

Four stages, in order, each with a gate you cannot skip: **scope, identify,
author, prove** — preceded by stage 0, which is deciding whether to do this at
all. The last stage has two gates — the tests must compile, and
they must run against a real Interoperability Test Bed. A test that has only
compiled has established nothing.

Work with the user at stages 1 and 2. Those are the decisions that determine
whether the suite is worth anything, and they are not yours to make alone.
Stages 3 and 4 you do.

If you have not run this before, read `references/setup.md` first and confirm
the prerequisites, because stage 4 fails late and confusingly without them.

## Stage 0 — Is this the right skill at all?

These tests measure **a system across an interface** or **an instance against a
profile**. A test case sends a request, receives a message, or validates a
document. That is the whole repertoire.

So before stage 1, work out what the subject actually is:

| The subject is | This skill? |
|---|---|
| A system that implements a specification's actor | **yes** — actor-scoped |
| Documents or messages that must conform | **yes** — profile-scoped |
| **A library's internals** — its classes, functions, error paths, coverage | **no** |

**If it is a library, say so and stop.** Do not reshape it into an actor plan:
there is no interface to drive and no instance to validate, so whatever you
produce will look like a test plan and measure nothing. Unit tests belong to
that project's own framework — JUnit, `cargo test`, Jest — named after the
requirements they verify, and a mature project usually already has them along
with coverage floors and a generator keeping the plan current. Say that, and
offer what this skill *can* add instead:

- the **content** the library produces or consumes, tested as instances against
  their profiles;
- its **agreement with a test bed** — the library and an ITB run over the same
  material and are compared.

Both are real plans and neither is the library's internals. A project can want
all three; they are separate deliverables and should not be conflated.

The tell is simple: **if you cannot name the request a test case sends, or the
document it validates, this is not the skill.**

## Stage 1 — Take the spec and set the scope

Ask for the specification, then read it. Not the website: the normative text
itself. What that is depends on the domain:

- **A FHIR IG:** the package, the profiles, the capability statements, the
  examples.
- **A regulation or a standard** (an EU regulation and its annexes, an ISO or
  CEN text): the articles and annexes, the data model it points to, and
  whichever delegated or implementing acts are adopted.
- **An API or data specification:** its schemas, its OpenAPI document, its
  examples.

What you are looking for is the same in every domain: what the spec says a
system must **do** and must **produce**. Cite it the way the domain does
(profile and element; article, paragraph and annex point; schema path), so
every test can name the rule it checks.

If a source you need cannot be read (a paywalled standard, a portal behind a
login), say so and leave that part out of scope. Never fill it from memory. A
rule that depends on an act or version not yet adopted is a stated
"not applicable until …", never a guess.

The language is not tied to healthcare. The core sentences (actors, HTTP
exchanges, JSON pointers, comparators, `should conform to`) work on any JSON
or XML interface. A domain needs its own dialect only when its sentences
should name domain things, such as access levels or a document type, or when
conformance is checked by a domain-specific service. `otb-gherkin applies
--spec <id> <sample>` lists the dialects whose `appliesWhen` matches, if your
otb-gherkin has that command. If none does, try the core first, and reach for
`add-language-dialect` when the core sentences get awkward.

Then fix the scope with the user. There are two shapes, and they lead to
different suites:

**Actor-scoped.** The spec names actors, each with its own obligations, often
with a capability statement per actor. One test plan per actor, and the system
under test plays one actor at a time. Choose this when the spec's own structure
is "a Creator must…, a Consumer must…".

**Profile-scoped.** The spec constrains resources and the question is whether
an instance conforms. The suite is about documents or messages rather than
about a system's behaviour. Choose this when the spec is mostly profiles,
or for a regulation, when it is mostly data points that a document must carry.

Most specs have both. Ask which one the user cares about now, and say what the
other would cover, so the omission is deliberate rather than accidental.

Write the scope down before writing any test: which actor or which profile,
which version of the spec (for a legal text, the act and the date of the
consolidated version you read, and the amendments you applied by hand), and
what is explicitly out of scope. Everything
after this stage is judged against that sentence.

## Stage 2 — Agree which kinds of test to write

**Ask the user. Do not assume.** Positive tests are the usual starting point
and they are never the whole answer. Offer the catalogue in
`references/test-types.md`, which lists each kind with what it is for and what
it costs, and ask which ones are in scope for this round.

At minimum establish:

- positive paths — always, unless the user says otherwise;
- whether **negative** tests are wanted, meaning the cases a conformant system
  must reject. These are where most real defects surface, and they are the
  most commonly skipped;
- whether anything must be **attested by an operator** rather than asserted,
  such as something the system displays. If the spec has requirements about
  presentation, no request will settle them.

Then produce a list of proposed test cases, one line each, grouped by kind,
and get the user to confirm it before you write a single step. A list is cheap
to change; a suite is not.

Each proposed case names the requirement it covers. A case that cannot name
one is a case nobody will dare delete later — either find the requirement or
drop the case.

## Stage 3 — Author them in Gherkin

Write the feature files. `references/authoring.md` has the conventions, the
sentence shapes and the traps. The short version:

- one system under test per scenario, everything else infrastructure;
- one scenario, one claim, named for the claim rather than the mechanics;
- declare the language and dialects in the tags;
- bind every value you produce with `as $x`, and never rely on a value some
  earlier step happened to leave behind;
- check the file is not generated before editing it.

Keep the test cases in the order the user confirmed, and keep the requirement
reference on each one.

## Stage 4 — Prove it

### Gate 1: it compiles

```
ITB_ASSET_ROOT=<root> node scripts/compile.mjs <features-dir>
```

Exits non-zero on any error and prints every diagnostic, not the first few.
Read the warnings too: an undeclared actor or a dialect that is not enabled
shows up there and is usually the real problem.

Fix everything before going further. Compilation is cheap and the next gate is
not.

### Gate 2: it runs against a real ITB

```
ITB_ASSET_ROOT=<root> node scripts/compile.mjs <features-dir> --out build --zip suite.zip
node scripts/run-on-itb.mjs deploy build/suite.zip
node scripts/run-on-itb.mjs run <testCaseId> ...
```

**One archive is one test suite.** `/api/rest/testsuite/deploy` takes a single
`testSuite`, so N features produce N archives: with more than one feature
`--zip suite.zip` writes `suite-<feature>.zip` for each and prints them, and
**each has to be deployed separately**. Deploying one and assuming the rest went
with it is the mistake this naming exists to prevent.

The two deliverables are different artifacts and both may be wanted:

| | What it is | Built by |
|---|---|---|
| **test suite archive** | `suite-<feature>.zip` — GITB TDL, deploys to ITB and runs | `compile.mjs --zip` |
| **FHIR Test Package** | an IG with one `TestPlan` per actor, `dist/package.tgz` | `spec-to-test-ig` |

`run` exits non-zero unless every session ends in SUCCESS, so it is a gate
rather than a report. Two results need care:

- **UNDEFINED** is not a pass. It means no verdict arrived, either because the
  session is still going or because it is waiting for an operator to answer a
  dialog. An unanswered test has established nothing.
- **A failure is a question, not an answer.** Do not report it as a defect in
  the system under test until you have localised it. The
  `diagnose-test-failure` skill is the procedure; its one rule is that you may
  not call something a defect in software you do not own until you have
  reproduced it outside the test bed.

A suite whose negative tests all pass on the first run deserves suspicion.
Check that a must-reject case actually fails when you feed it something valid;
a test that cannot fail is not a test.

## What you hand over

- the feature files;
- the scope sentence from stage 1 and the confirmed case list from stage 2,
  kept beside them in a README, with each case's requirement reference;
- the compile output and the run output, with the date and which build of the
  system under test they were measured against;
- what you did not cover, and why.

That last item is the one people skip and the one reviewers need. A suite that
does not say what it leaves out reads as a claim of completeness it cannot
support.

## Going further

If the user wants the suite published as a FHIR TestPlan and implementation
guide rather than kept as feature files, that is a different and later job;
use the `spec-to-test-ig` skill for it. If a step you need does not exist in
the language, that is a dialect change, not a reason to write the test badly;
see `add-language-dialect`.
