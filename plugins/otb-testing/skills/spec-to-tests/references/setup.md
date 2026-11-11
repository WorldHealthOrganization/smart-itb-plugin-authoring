# Prerequisites

Confirm these before stage 1. Stage 4 fails late and confusingly without them,
and the failure looks like a problem with the tests rather than with the setup.

## To compile: Node and the language package

```
npm install @opentestbed/otb-gherkin
```

Node 18 or newer. The package carries the compiler and the core language. It
does **not** carry the dialects, the CLI, or any of the `scripts/` from its
source repository, so nothing here depends on those.

## To compile: the dialects

`ITB_ASSET_ROOT` must point at a directory containing a `components/` folder.
That folder holds one subdirectory per dialect and an `index.json` listing
them:

```
<root>/
  components/
    index.json            { "components": ["fhir-validator", ...] }
    fhir-validator/
      component.yml
      steps.yml
```

Use `scripts/get-dialects.mjs` to assemble one. It reads each dialect's
`component.yml` to find out which files that dialect actually consists of, so
it needs no directory listing and works the same against a folder or a URL.

**Prefer installing them.** Each dialect is a package whose contents are the
dialect folder itself, so the set is pinned by your lockfile, needs no network
at build time and no containers:

```
npm install @opentestbed/dialect-fhir-validator @opentestbed/dialect-hcert-decoder
node scripts/get-dialects.mjs --installed --out assets
```

A package declares itself with an `otbDialect: { id }` field rather than by a
name prefix, so a dialect published under any scope is found.

The other sources, for a dialect that is not on npm or a checkout you are
working in:

```
# from a checkout of the authoring workbench (carries every dialect)
node scripts/get-dialects.mjs --from <workbench>/app/public --out assets

# from one plugin repository's dialect folder
node scripts/get-dialects.mjs --from <plugin>/dialect --out assets

# over http(s): the public repositories, or a deployed plugin's /gherkin-dialect
node scripts/get-dialects.mjs --out assets
node scripts/get-dialects.mjs --from http://host:8090/gherkin-dialect --out assets
```

It writes `assets/components/` with an `index.json`, prints the
`ITB_ASSET_ROOT` to use, and checks the two things that otherwise fail in
silence: that each folder name matches the `id` inside its `component.yml`,
and that each dialect's `baseVersion` accepts the core language you have
installed. A dialect that fails the second check is **refused at load with
only a console warning**, and every one of its steps then reports
`No mapping for step`, so the script says so loudly instead.

Without any dialect at all, an empty `components/` containing
`{"components": []}` compiles anything that uses only core sentences. Enough
to try the toolchain, not enough for a real suite.

**One core step needs a file no package ships.** `posts … N times, paced
manually` calls `scriptlets/instructUser.xml`, which is not in the language
package. Until that is fixed, either avoid that step or put the scriptlet in a
`scriptlets/` folder beside your feature files.

If `ITB_ASSET_ROOT` is unset or has no `components/`, `compile.mjs` says so and
exits 2 rather than producing a confusing diagnostic.

A dialect that is present but whose `baseVersion` does not match the core
language is **refused silently** at load, with only a console warning, and
every one of its steps then reports `No mapping for step`. If a whole
vocabulary seems to have vanished, look for that warning first.

## To run: an Interoperability Test Bed and five keys

You need a reachable ITB instance and API keys from it. `run-on-itb.mjs` reads
them from the environment:

| Variable | Needed for | What it is |
|---|---|---|
| `ITB_BASE_URL` | everything | e.g. `http://localhost:9000` |
| `ITB_COMMUNITY_KEY` | deploy | community API key, with permission to manage test suites |
| `ITB_SPEC_KEY` | deploy | the target specification's API key |
| `ITB_ORG_KEY` | run | organisation API key |
| `ITB_SYSTEM_KEY` | run | the system under test |
| `ITB_ACTOR_KEY` | run | the actor that system plays |
| `ITB_WAIT` | run | seconds to wait for a verdict, default 60 |
| `ITB_IGNORE_WARNINGS` | deploy | `1` deploys even when the Test Bed raises warnings |

`deploy` exits 1 unless the Test Bed answers `completed: true`. The Test Bed
answers HTTP 200 to a deployment it refused, so the status code proves
nothing. Warnings also refuse a deployment. Read them, then set
`ITB_IGNORE_WARNINGS=1` if they are harmless. On success, `deploy` prints each
actor's key as `ITB_ACTOR_KEY=…`.

The system must already exist in ITB. Creating it is a one-off administrative
step in the ITB UI or through its REST API. Before starting sessions, `run`
creates the conformance statement linking the system to the actor. It does
this with the organisation key, because the community key gets 403. Without
the statement, a fresh specification answers "test case not found". If `run`
still reports no session id, check that `ITB_ORG_KEY` belongs to the
organisation that owns `ITB_SYSTEM_KEY`.

These are ITB's own documented endpoints — `/api/rest/testsuite/deploy`,
`/api/rest/tests/start`, `/api/rest/tests/status` — so this works against any
ITB, not only one set up by the OpenTestBed tooling.

## If the OpenTestBed CLI is available

`otb deploy` and `otb run` wrap the same endpoints with a config file, and the
authoring workbench has buttons for them. Use whichever you have. The scripts
here exist so the skill works without them, and because `otb run` exits 0 even
when a session fails, which makes it unusable as a gate.

## Checking the setup before you start

```
ITB_ASSET_ROOT=<root> node scripts/compile.mjs <a known-good feature>
```

If that prints zero errors, the compile half is ready. For the run half, deploy
one small suite and run one case before writing the rest; discovering a missing
key after authoring forty scenarios is a bad afternoon.
