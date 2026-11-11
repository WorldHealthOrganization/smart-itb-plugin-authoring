# Your first test package, starting from an implementation guide

For someone who has a published FHIR IG and none of this installed. Follow it
top to bottom; it assumes no prior knowledge of the test language, the test bed,
or Gherkin.

Allow an hour the first time. Most of that is you answering questions, which is
the part that decides whether the suite is worth anything.

## What you will have at the end

```
ImplementationGuides/<your-spec>-test/
  fsh-generated/resources/
    TestPlan-<actor>-tests.json      one per actor, with every test case
    Binary-<actor>-gherkin-script.json
  input/testing/gherkin/*.feature    the executable scripts
  dist/package.tgz                   installable, like any other IG package
```

A FHIR package declaring your tests as `TestPlan` resources, each test traceable
to the requirement it covers. Nothing is executed — see
[What the result does and does not mean](#what-the-result-does-and-does-not-mean).

## Before you start

| You need | Why | Check |
|---|---|---|
| **Node 18 or newer** | the compiler | `node --version` |
| **Claude Code** | runs the skills | `claude --version` |
| **Your IG published somewhere** | the agent reads the package, not the website | a URL ending in a site the publisher built |
| Java 11+ *(optional)* | only to render the IG as a website at the very end | `java -version` |

You do **not** need Docker, a running test bed, or a system to test against.
None of those are involved until you want to *execute* the tests, which is a
later and separate job.

## Step 1 — get the tooling

Four lines, and nothing to configure:

```bash
git clone https://github.com/WorldHealthOrganization/smart-itb-plugin-authoring
cd itb-plugin-authoring
npm install @opentestbed/otb-gherkin @opentestbed/dialect-fhir-validator
claude
```

That is the whole install. The skills live in `.claude/skills/` in the clone, so
the agent picks them up automatically — **there is nothing to install, enable or
restart.**

To check, ask the agent:

> What skills do you have for authoring conformance tests?

It should name `spec-to-tests`, `write-test-feature`, `diagnose-test-failure` and
`spec-to-test-ig`. If it names none, you are not in the clone — `cd` into it and
start `claude` again.

You need the clone rather than just the npm packages because the step that builds
the IG package lives in it.

## Step 2 — point it at your IG

One prompt, in your own words. Substitute your own IG:

> I want conformance tests for https://profiles.ihe.net/ITI/PCF/ — all of it.

Naming the skill makes it certain, if you would rather not rely on it triggering:

> Use the spec-to-tests skill to build a test plan for
> https://profiles.ihe.net/ITI/PCF/

The agent downloads the IG's **package**, not its HTML, and reads the actors,
the capability statements, the profiles and the examples. It will tell you what
it found. Read that summary: if it misread your IG, everything after it is
wrong, and this is the cheapest moment to say so.

## Step 3 — answer the questions

This is the real work, and the agent is supposed to stop and ask. There are
three decisions, and they are yours.

**1. Actor-scoped or profile-scoped?**

| | Means | Choose it when |
|---|---|---|
| **Actor-scoped** | one test plan per actor; the system plays one role at a time | your IG says "a Creator shall…, a Consumer shall…" |
| **Profile-scoped** | does this instance conform? | your IG is mostly profiles |

Most IGs are both. Pick the one you care about now; the agent will tell you what
the other would have covered, so the omission is on purpose.

**2. Which kinds of test?**

Say yes to **negative tests** — the cases a conformant system must *reject*.
They are where most real defects turn up and they are the most commonly skipped.
If your IG requires anything to be *displayed* to a user, you also want
**operator attestation**, because no HTTP request can settle that.

**3. The case list.**

You get one line per proposed test case, each naming the requirement it covers:

```
CR-02  A recorded consent conforms to the Basic profile      IHE.PCF.consentBasic
CR-07  A consent with no patient reference is rejected        Consent.patient 1..1
```

**Read this list and push back on it.** Adding, cutting or rewording a line here
costs a sentence. Doing it after thirty scenarios exist costs an afternoon. Any
case that cannot name a requirement should be dropped — say so if you see one.

Only when you confirm the list does it write any tests.

## Step 4 — the tests get written and compiled

The agent writes one feature file per actor and compiles them:

```
0 pcf-consent-recorder.feature   [12 test cases]
0 pcf-consent-registry.feature   [9 test cases]

clean: 2, with errors: 0
```

`0` is the error count for that file. You want `with errors: 0`.

The files are readable on purpose — this is the whole point of the language:

```gherkin
Scenario: CR-02 a recorded consent conforms to the Basic profile
  When ConsentRecorder gets from ConsentRegistry at "/Consent/" with id $consentId as $consent
  Then $response.status should be 200
  And $consent should conform to "https://profiles.ihe.net/ITI/PCF/StructureDefinition/IHE.PCF.consentBasic"
```

Read them. You are the only person who can tell whether a scenario tests what
its name claims.

## Step 5 — turn it into an IG package

> Now publish these as a FHIR IG with one TestPlan per actor.

The first time, you will be asked **where your IGs live**. It offers a folder it
found on your disk. Answer once and it never asks again; you can also say
*"not now"* (it asks again next time) or *"I have no default"* (it stops asking
and puts each IG where you say).

Then it builds:

```
wrote ImplementationGuides/pcf-test:
  sushi-config.yaml, 2 TestPlan(s) with 21 test case(s), 2 feature(s), pages
== sushi ==                                        0 Errors
== package ==   dist/package.tgz    6 resources, 2 feature files
```

What it produced, and why each part matters:

- **one `TestPlan` per actor**, its `scope` naming what is under test;
- **one test per scenario**, whose `description` is the requirement — so a
  reviewer can check your coverage without reading a line of Gherkin;
- **one assertion per `Then` step**;
- **the feature file as a `Binary`**, so the declaration and the script it names
  cannot drift apart;
- **your process record as the IG's Method page** — the scope, the case list and
  what you deliberately left out.

## Step 6 — optional, and later

**Render it as a website** (needs Java):

```bash
cd ImplementationGuides/<your-spec>-test
./_updatePublisher.sh      # first time only
./_genonce.sh
```

> **If that fails on the FHIR version, it is not your IG.** `TestPlan` lives in
> the `hl7.fhir.uv.testing` package rather than in FHIR core, so your IG's FHIR
> version has to be one the publisher supports *and* that package is built
> against. Those two occasionally drift apart — they did for a fortnight in
> October 2026, when no version satisfied both.
>
> Check what the package is built against and match it:
>
> ```bash
> curl -s https://build.fhir.org/ig/HL7/fhir-testing-ig/package.manifest.json
> ```
>
> If instead the publisher says *"Unable to support version X"*, it is the
> publisher that is out of step: `./_updatePublisher.sh`, or
> `./_pinPublisher.sh <version>` for a specific one.
>
> Either way `dist/package.tgz` is still produced correctly — only the rendered
> website is affected. Your IG's own README carries this with the current
> versions filled in.

**Actually run the tests.** This is where Docker, a test bed and a real system
under test finally come in:

```bash
ITB_ASSET_ROOT=. npx otb-gherkin compile features --out build --zip suite.zip
```

Deploy `build/suite.zip` to an Interoperability Test Bed and run it. Ask the
agent — that is what `spec-to-tests` stage 4 and the `diagnose-test-failure`
skill are for.

## What the result does and does not mean

**It means:** your tests are written down, traceable to requirements, and
syntactically valid — they compile to the test bed's own format.

**It does not mean they pass, and it does not mean anything conforms.** Until a
suite has run against a real implementation there is no verdict anywhere in the
package: no `TestReport`, no results. Your IG publishes tests, not findings.

And one trap worth internalising early: **a clean compile only means your
sentences were understood.** The first IUA suite built this way compiled with
zero errors while sending form-encoded bodies labelled `application/json`. If a
test matters, ask the agent to show you the generated request, not just the
error count.

When you do run them: if a must-reject case passes on the very first run, be
suspicious. Feed it something *valid* and check that it then fails. A test that
cannot fail is not a test.

## When it goes wrong

| Symptom | Almost always |
|---|---|
| `No mapping for step: "…"` | A dialect is not listed in `components/index.json`. The error blames your feature file; the fault is the index |
| `object is not iterable` | In a dialect you wrote: `kinds:` must be a **list**, `kinds: [my-thing]`, never a mapping |
| `No system under test among the declared actors` | A dialect verb used `{actor:some-kind}` for the system under test. Kinds are for infrastructure only |
| A verb you need does not exist | That is a dialect, not a reason to write a worse test. Ask the agent; it needs no repo and no npm package — two YAML files in a folder |
| `UNDEFINED` after a run | Not a pass and not a failure: no verdict arrived, usually because an operator prompt is unanswered |
| `Unable to support version 'X'` | Your publisher does not build that FHIR version. `./_updatePublisher.sh`, or `./_pinPublisher.sh <version>` |
| `TestPlan cannot be converted from R5 to R4` | Your IG's FHIR version and the `hl7.fhir.uv.testing` package's disagree. Match the manifest (see step 6) |

## Later: the skills in your own project

Everything above works inside the clone, which is where you want to be the first
time. Once you are past that, you may want the authoring skills available in a
project of your own without cloning this one. They are also published as a
plugin:

```
/plugin marketplace add WorldHealthOrganization/smart-itb-plugin-authoring
/plugin install otb-testing@otb-testing-toolkit
```

That adds the same six skills plus `/spec-to-tests`, `/test-ig` and `/diagnose`
anywhere. Note the one thing it does *not* carry: building the IG package still
needs this clone, because the builder lives here. So the plugin is for authoring
and diagnosis, and the clone is for the full arc.

Deeper reading: [README.md](../README.md) for the full path,
[EXTENDING.md](../EXTENDING.md) for writing your own dialect, and
[walkthrough.md](walkthrough.md) — a slide deck telling the same story twice,
once for a narrative specification and once for a FHIR IG.
