# itb-plugin-authoring

Write conformance tests in Gherkin, compile them to a GITB TDL test suite, and
package them as a FHIR implementation guide with the features as TestPlans.

You need Node 18 or newer. You do **not** need an Interoperability Test Bed or
Docker to write, compile or package tests — only to execute them.

> **New to this?** Start with
> [docs/first-test-package.md](docs/first-test-package.md) — step by step from a
> published IG to an installable test package, including the questions you will
> be asked and what to do when it goes wrong. The rest of this README is the
> reference.

## 1. Set up

Clone this repository. That gives you the skills, the written procedures an agent
follows.

```bash
git clone https://github.com/WorldHealthOrganization/smart-itb-plugin-authoring
cd itb-plugin-authoring
```

Install the language and the dialects you need:

```bash
npm install @opentestbed/otb-gherkin @opentestbed/dialect-fhir-validator @opentestbed/dialect-hcert-decoder
```

There is no `package.json` at the repo root and you do not need to make one. npm
creates a throwaway, and everything it writes here is ignored, so the checkout
stays clean.

Assemble the dialects into the directory the compiler reads, then check it works:

```bash
npx otb-gherkin dialects --installed --out assets
npx otb-gherkin --version
```

That is the whole setup.

## 2. Write tests

Start an agent session in the clone. The skills are on its path, so ask for what
you want and the right one loads:

```
Read the specification at <path> and propose test cases for it
```

Follow [the full path](#3-the-full-path-specification-to-test-ig) below for the
whole sequence, or read any `SKILL.md` and work through it by hand — they are
written as procedures, not as prompts.

### Or write them in the editor

For editing one file, run the workbench:

```bash
cd app
npm install
npm run dev
```

Open the URL it prints — `http://localhost:3000/test-workbench/`, or the next
free port. You get Monaco with the dialect-aware step catalogue on Ctrl+Space,
problems as you type, and the compiled suite XML beside your feature.

This needs no Test Bed. Everything except the deploy button works offline. Note
that `app/` has its own `npm install`, separate from the one in step 1.

Use these four:

| Skill | Use it when |
|---|---|
| `spec-to-tests` | Someone brings a specification and wants tests for it. Scope it, agree the test kinds, author, compile, run |
| `write-test-feature` | Adding or changing a test case. The day-to-day job |
| `diagnose-test-failure` | A suite went red and you need to know whose fault it is |
| `spec-to-test-ig` | Publishing a finished suite as a FHIR TestPlan and implementation guide |

Reach for `diagnose-test-failure` whenever something goes red. Its rule: do not
call anything a defect in software you do not own until you have reproduced it
outside the test bed.

Two further skills extend the language itself — adding a dialect for a new
service, or changing the core grammar. You do not need them to write tests; see
[EXTENDING.md](EXTENDING.md).

### Installing the skills in another project

They are packaged as a plugin, so you do not copy directories:

```
/plugin marketplace add WorldHealthOrganization/smart-itb-plugin-authoring
/plugin install otb-testing@otb-testing-toolkit
```

That gives you all six skills, plus `/spec-to-tests`, `/test-ig` and
`/diagnose`, and updates when this repository does.

`spec-to-tests` then works anywhere — it carries its own compile, dialects and
run scripts and needs only the published `@opentestbed/otb-gherkin`.
`spec-to-test-ig` and `change-core-language` still want a checkout, because they
call scripts that live here; [plugins/otb-testing/README.md](plugins/otb-testing/README.md)
has the table of what needs what.

**Using another agent?** The skills are plain Markdown with YAML frontmatter and
contain nothing Claude-specific. The same `skills/` directory is declared by
`.codex-plugin/plugin.json` and by `.agents/plugins/marketplace.json`, and if
your tool reads neither you can copy `plugins/otb-testing/skills/` wherever it
looks. You lose update-on-install and nothing else.

## 3. The full path: specification to test IG

The whole path. Numbered steps are prompts to an agent in a session started in
the clone; code blocks are what gets run. Substitute your own specification
throughout.

The repository ships one worked case to compare against: the IPS suite, in
`app/public/features/ips-creator.feature`, `ips-consumer.feature` and
`ips-server.feature`, its config in `app/public/data/ips-test-ig.json`, and the
record of how it was produced in `app/public/features/IPS-TESTS.md`.

**1. Check the ground.**

> Confirm I can author tests here: which dialects are available and what version
> of the language. Tell me whether a test bed is configured, but do not set one
> up — I only need it later, to execute.

```bash
npx otb-gherkin dialects --installed --out assets
```

Setup gaps surface here rather than at the run gate, which is where they
otherwise bite.

**2. Read the specification.**

> Read the specification at `<path>` and tell me what is testable. Is it
> actor-scoped or profile-scoped? Propose a scope and say what the alternative
> would cover.

The agent reads the package, the profiles, the capability statements and the
examples, not the website. What comes back should say which of two shapes the
specification has, because they lead to different suites. **Actor-scoped**: it
names actors with their own obligations, so one test plan per actor and the
system under test plays one at a time. **Profile-scoped**: it constrains
resources and the question is whether an instance conforms.

It should also say what the specification does *not* give you. A guide with no
example instances means test data has to be generated rather than borrowed, and
that changes the work.

**3. Fix the scope.** The agent stops here and makes you choose, because the
options lead to genuinely different suites.

> Scope it to `<the actor or the profile you care about>`. Write the scope
> sentence down, and say what is out of scope.

**4. Choose the kinds of test.**

> Which kinds of test should this round include? Show me the catalogue and your
> recommendation, then give me a case list with the requirement each one covers.

Positive paths are assumed. The question is whether negative, boundary,
value-set binding and operator-attested cases are in. Negative tests are where
most real defects surface and the most commonly skipped, so decide about them
deliberately rather than by omission.

Insist on the case list before any Gherkin exists: a list is cheap to change and
a suite is not.

**5. Author.**

> Approved, with `<any changes to the list>`. Write the features.

**6. Compile.** The gate: non-zero on any error, every diagnostic printed.

> Compile them and fix everything, including the warnings.

```bash
ITB_ASSET_ROOT=./assets npx otb-gherkin compile app/public/features/ --out build --zip suite.zip
```

**7. Run — the one step that needs a Test Bed.** Skip it if you have none: steps
1 to 6 and step 8 all work without one, and you still end up with a packaged IG.
But compiling only proves the suite is well formed, and nothing whatever about
the system under test, so a suite that has never run has established nothing.

> Deploy to the test bed and run every case. If anything fails, localise it
> before telling me it is a defect.

```bash
node plugins/otb-testing/skills/spec-to-tests/scripts/run-on-itb.mjs deploy build/suite.zip
node plugins/otb-testing/skills/spec-to-tests/scripts/run-on-itb.mjs run <testCaseId>
```

A session ending `UNDEFINED` is not a pass — it means nobody answered the
dialog. A failure hands over to `diagnose-test-failure` rather than to a
conclusion.

**8. Package as a FHIR IG.**

> Package these as a FHIR IG with the features as TestPlans.

```bash
node app/scripts/build-test-ig.mjs app/public/data/<spec>-test-ig.json --package
```

The config names the IG, the specification under test, and the plans; one plan is
one TestPlan, meaning a scope and its test cases. A plan takes its cases either
as one `feature` whose `Rule:` groupings become suites — the shape for an
actor-scoped specification — or as a `features` folder where each file becomes a
suite. Model yours on `app/public/data/ips-test-ig.json`.

The builder writes `sushi-config.yaml`, one TestPlan FSH per plan, the Binaries
that render the Gherkin, the pages and the scaffold. `--package` runs SUSHI and
produces `dist/package.tgz`. The output goes to its own directory outside this
repository, to be committed as its own guide.

**9. Hand it over.**

> Write the README: the scope sentence, the confirmed case list with requirement
> references, the compile and run output with dates and builds, and what is not
> covered and why.

That last item is the one people skip and reviewers need. A suite that does not
say what it leaves out reads as a claim of completeness it cannot support.
`app/public/features/IPS-TESTS.md` is what one looks like.

## Reference: the language

`app/public/lang/` documents the language. Two files are generated — regenerate
rather than editing them.

| File | What |
|---|---|
| `EXPRESSIONS.md` | Every sentence the language accepts, one filled-in example each. Generated by `npm run gen:language-docs` |
| `GENERATIONS.md` | Generation 1 against generation 2: what changed, why, how to migrate |
| `TUTORIAL.md`, `GRAMMAR.md`, `REFERENCE.md` | The long-form introduction, the formal grammar, the step reference |


## Reference: checking your work

```bash
# the feature you changed, or a folder; exits non-zero on any error
ITB_ASSET_ROOT=./assets npx otb-gherkin compile app/public/features/<file>.feature
```

Add `--verbose` for warnings. Read those too: an undeclared actor or a dialect
that is not enabled shows up there and is usually the real problem.

One caveat on `app/public/features/`: it is not green as a whole and is not a
gate. Every maintained suite in it compiles — IPS, MHD, RACSEL, MEOW, SPENSER,
terminology, certificate governance. Alongside them sit about twenty older
sample files with no `@lang:` tag whose steps belong to no released generation
of the language, `tutorial.feature` and `language-showcase.feature` among them.
They compile under neither generation, and adding a tag does not rescue them.
Check the file you are working on rather than the folder.

## Deploying inside an ITB installation (optional)

Skip this unless you want the tools served from your Test Bed rather than run
locally. To edit features you only need `npm run dev`
([above](#or-write-them-in-the-editor)); to execute tests you only need the five
keys in `plugins/otb-testing/skills/spec-to-tests/references/setup.md`.

Deployed this way the app is a **functionality plugin** — it extends an ITB
installation rather than the test language — and serves two things the local dev
server does not:

- **/** — the same workbench, but with deploy wired to that Test Bed.
- **/manager** — the test manager. Pick a feature, then Compile, Init, Deploy,
  Run or Status. Every button shells out to the mounted `itb-cli` one-to-one, so
  the CLI and the UI cannot disagree.

Bring it up beside the ITB core:

```powershell
cd itb-starter
docker compose -f docker-compose.yml `
  -f ..\itb-plugin-fhir-validator\compose.plugin.yml `
  -f ..\itb-plugin-hcert-decoder\compose.plugin.yml `
  -f ..\itb-plugin-authoring\compose.plugin.yml up -d --build
```

Then: http://localhost:10004 (workbench) and http://localhost:10004/manager.
The image build compiles the SPA (npm inside docker build — no local npm needed).

### Layout

| Path | What |
|---|---|
| `itb-plugin.yaml` | manifest (`kind: functionality`, no dialect, no GITB handler) |
| `compose.plugin.yml` | the service fragment; mounts `../itb-cli` at `/cli` |
| `Dockerfile` | stage 1 vite-builds `app/`, stage 2 runs `server.mjs` (no npm deps) |
| `server.mjs` | static SPA + `/manager` + `/api/cli` (allowlisted itb-suite commands) + `/itb-proxy` (same contract as the Vite dev proxy) |
| `app/` | the workbench sources; `itb-cli` syncs plugin dialects into `app/public/components/` (`sync-dialects.mjs`) |
|  `plugins/otb-testing/` | the procedures — see [Write tests](#2-write-tests) |
