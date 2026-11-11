---
name: add-language-dialect
description: Author a new OTB Gherkin dialect — the verbs, actor kinds and value types that let feature files talk to one service (a validator, a decoder, a repository). Use when asked to "add steps for X", "support X in the test language", "write a dialect", or to extend an existing dialect with new verbs.
---

# Adding a language dialect

A dialect is a plugin that teaches the test language one domain. It contributes
**verbs, actor kinds, value types and at most one conformance handler**, and
nothing else. It may not add a sentence shape: the six shapes belong to the core
language and are what make every dialect read alike. If the thing you want
cannot be said in an existing shape, you need a core change, which is a
different and much heavier conversation.

Everything here was checked against the compiler, not the prose docs. Where
`GRAMMAR.md` or `TUTORIAL.md` disagree with this file, they are wrong; see
`reference.md` for the list.

## 0. What you produce

**First decide which of two situations you are in**, because the whole shape of
the job differs and only one of them needs a repository.

### You are extending the language for your own tests

Then a dialect is **two YAML files in a folder**, and you need no npm package, no
repository and no membership of any organisation. Put it in your asset root:

```
my-tests/
  components/
    index.json            <- your id must be in this list or the dialect is invisible
    <id>/
      component.yml       identity, and which core language you target
      steps.yml           kinds, types, conforms, verbs
      scriptlets/*.xml    optional, each listed in component.yml
  features/
```

```bash
ITB_ASSET_ROOT=./my-tests npx otb-gherkin compile my-tests/features
```

The file you edit is the file the compiler reads — no sync step, no checkout of
`itb-cli`, and the golden corpus is not yours to maintain. Sections 1–4 below
apply in full; in section 5 read only "If the dialect is your own", and skip
section 6 entirely. `EXTENDING.md` in `itb-plugin-authoring` covers sharing it by
URL, which also needs no publishing.

### You are adding a dialect to the OTB plugin ecosystem

Then it is a plugin repository, and sections 5 and 6 apply as written:

```
itb-plugin-<name>/
  itb-plugin.yaml          name: <id>   +   dialect: { path: dialect/ }
  dialect/
    component.yml          identity, and which core language you target
    steps.yml              kinds, types, conforms, verbs
    scriptlets/*.xml       optional, each listed in component.yml
```

`itb-plugin.yaml`'s `name:` and `component.yml`'s `id:` **must be the same
string**. Nothing checks this. The sync uses the first for the folder name and
the compiler uses the second for kind and type ownership, so if they diverge the
dialect loads but `@dialect:<id>` tags and enablement silently stop working.

## 1. Write the service contract first, even if the service does not exist

The `archimate` plugin is the pattern. Its `component.yml` states the HTTP
endpoints it expects in a comment, the dialect is authored against that, and the
service is built to match afterwards. Doing it in this order forces the
vocabulary to be about the domain rather than about whatever the service happens
to return today.

Write down, for each verb: the endpoint, the request shape, and which part of the
response becomes the value the author binds.

## 2. `component.yml`

Only four things here affect compilation. `id`, `name`, and the `language` block:

```yaml
id: my-thing                 # === itb-plugin.yaml name:
name: My Thing
version: "0.1"               # the build, not the dialect spec
description: >
  One sentence. It appears in the catalogue.

language:
  steps: steps.yml
  version: "1.0.0"           # THIS dialect's spec version
  base: itb-core-en
  baseVersion: ">=2 <3"      # which core language you target — use this value
```

**Omitting the `language` block loads no steps at all** for a locally synced
dialect, with no warning. The only symptom is `No mapping for step` on every
line. (Remote-served dialects default to `steps.yml`; local ones do not. Do not
rely on that asymmetry.)

If `baseVersion` does not match the core's `specVersion`, the **entire dialect is
refused** at merge time with only a `console.warn`, and every one of your verbs
vanishes. Today the core is `itb-core-en` at `2.2.0` (2.1.0 in the published otb-gherkin 0.5.0).

Two optional keys say how the dialect relates to others and when it is
useful. Write both. They are what lets a workbench or a skill propose your
dialect for a specification nobody has tested yet.

```yaml
requires:                    # dialects whose kinds, types or handler your verbs use
  - { dialect: json-policy, version: "^0.1" }   # or: json-policy@^0.1
appliesWhen:                 # a condition over the spec ids and sample documents
  any:
    - { specification: '32023R1542|2023/1542' }                  # regex, case-insensitive
    - { mediaType: [application/json] }
    - { document: { pointer: /generalProductInformation/batteryCategory, exists: true } }
```

`requires:` is how a domain dialect builds on a domain-neutral one. Dialects
cannot inherit, but a feature can load both. When a feature tags the child
without its parent, compilation warns, and so does `otb-gherkin dialects` when
the parent is not in `components/`. `appliesWhen:` is evaluated by
`otb-gherkin applies --spec <id> <sample…>`. Its conditions are
`specification`, `mediaType`, `document` (with `exists`, `equals` or
`matches`), and `all`/`any`/`not`. An unknown key is reported as an error,
never as "does not apply". Both keys need otb-gherkin with core 2.2.0 or later.
Older builds ignore them.

`docker`, `healthCheck`, `actors` and `services` are optional and inert to the
compiler — the workbench uses the first two for a health dot. In particular
`actors:` does **not** declare actor kinds. Kinds come from `steps.yml`.

## 3. `steps.yml`

```yaml
id: my-thing
name: My Thing Steps
description: >
  One sentence.

kinds: [my-thing-service]          # a LIST, lower-kebab only: [a-z][a-z0-9-]*
                                   # as a mapping it is valid YAML, loads, and
                                   # used to kill the compiler with "object is
                                   # not iterable" — no file, no line. Same for
                                   # verbs: and steps:.

types:
  mything:Doc:                     # free-form key
    name: My document              # what an author types in `$x is a My document`
    path:                          # optional: how to read `$x at "..."`
      kind: my-thing-service
      actions: [ ... ]             # $subject, $path -> $pathVar

conforms:                          # optional, at most one per dialect
  kind: my-thing-service
  actions: [ ... ]                 # $subject, $profile, $ignore -> conformanceErrors

verbs:
  - text: '{actor} does the thing to {ref}( on {actor:my-thing-service})? as {var}'
    doc: One line for the catalogue.
    output: { type: 'mything:Doc' }
    actions:
      - ...
```

Four things to get right here:

**A kind must match `[a-z][a-z0-9-]*`.** A capital letter or an underscore makes
the kind unwritable, because the core's `is a/an {kind}` sentence will not match
it. Nothing validates this; you find out when no one can declare your actor.

**`output: { type: ... }` is what makes paths work.** It binds the type to the
verb's last `{var}`. Without it the author must write `$x is a My document` by
hand before any `at "path"` assertion.

**The conformance contract is one variable.** Your `conforms` handler must leave
the number of errors that count in a variable named `conformanceErrors`. The
core asserts it; that is the whole contract. Also publish `validationErrors`,
`validationWarnings`, `validationOutcome` and `validationSeverity`, because the
core's `$validation.*` references map onto those exact names. If your service
can say exactly which rule set it applied (a policy version and hash, a
validator and package version), put it in `validationFingerprint`. The core
then logs it right before the verdict. Option values from the author's
`with:` table arrive through `"$opt.<name>"`. Keep that quoted form: it is
what lets `| asOf | $today |` pass a bound variable.

**A verb with no `text:` is silently skipped.** A typo in the key (`txet:`)
produces no verb and no error.

For the action vocabulary, the `$N` substitution rules and the full list of
traps, read `reference.md` in this directory. Do not write actions from memory:
the `CatalogAction` type in the source is stale and omits several fields that
the compiler does read.

## 4. The rules that will actually bite you

1. **No backslashes, anywhere in any expression.** ITB has no escape character
   (TDL-042). Pick the quote the text does not use; if it needs both, splice with
   `concat(..., "'", ...)`. The compiler lints this and fails the build.
2. **`when:` and `unless:` guard an action**, on whether the guard
   substitutes to something or to nothing. Use them to branch on an optional
   slot. `unless:` was documented but unimplemented until 0.3.5, so an action
   carrying it always ran; on an older compiler, invert the condition and use
   `when:`.
3. **Any `assign` of a response body that will feed a template or a JSON body
   needs `type: 'string'`.** A messaging handler returns bytes when it does not
   recognise the content type, and FreeMarker then dies on a byte sequence.
4. **One typo in `text:` breaks every feature in the project**, including ones
   that never use your dialect. `compileStepText` throws rather than reporting a
   diagnostic, and the throw happens while merging the catalogue. You get a stack
   trace, not a line number. Compile after every verb you add.
5. **All TDL variables share one flat namespace per test case.** Prefix
   everything you invent with your dialect (`mythingHeaders`, not `headers`).
   Never use `i`, `row`, `tableRows`, `docString`, or any `$validation*` /
   `conformanceErrors` / `lastRequest` name for your own purposes.
6. **Core wins, and first dialect wins.** You cannot override a core sentence,
   and a duplicate actor kind or value type is dropped with a console warning
   you will not see.
7. **Actor kinds are for infrastructure, never for the system under test.**
   `is the system under test` has no kind slot, so `{actor:my-kind}` can never
   bind to the SUT; the author gets `No system under test among the declared
   actors` and no hint that the dialect is the cause. If your verbs talk *to* the
   measured system, use a plain `{actor}` slot and read its base as `$$NBase`,
   the way the core's own HTTP verbs do. Use a kind only for a service you stand
   up beside it. Compare `oauth` (the authorization server is the SUT: plain
   `{actor}`) with `jwt` (borrows a validator: `{actor:fhir-validator}`).

## 5. Verify

### If the dialect is your own

The file you edit is the file the compiler reads, so the loop is one command:

```
ITB_ASSET_ROOT=<your-root> npx otb-gherkin compile <features-dir>
```

Two things that are not optional:

- **Your id must be in `components/index.json`.** A folder missing from it is
  invisible, and the only symptom is `No mapping for step` against the feature
  file. `otb-gherkin dialects` maintains that file and now keeps a dialect it did
  not fetch, reporting it as `kept <id>`; on `@opentestbed/otb-gherkin` 0.4.0 or
  earlier it rewrote the list with only what it fetched, so check after a refresh.
- **Run `otb-gherkin dialects --from <your folder>` once.** It rejects the
  mistakes that otherwise fail silently: a folder name disagreeing with
  `component.yml`'s `id`, a missing steps file or scriptlet, a list-shaped key
  written as a mapping, and a `baseVersion` the installed core cannot satisfy.

Write a feature that exercises every verb and keep it beside the dialect. That is
your regression test; the golden corpus below belongs to the language package.

### If the dialect is going into the ecosystem

In order. Each one catches something the previous one does not.

```
node src/sync-dialects.mjs                                    # from itb-cli
node packages/gherkin/scripts/check-features.mjs <asset-root> <features-dir>
npm test --workspace packages/gherkin                         # the golden corpus
```

Editing `dialect/steps.yml` in the plugin repo **tests nothing on its own**. It
must be synced into the workbench's `public/components/` first, because that is
the asset root the compiler reads. The sync is a destructive whole-folder
replace, so any hand edit under `public/components/` is lost.

Write at least one feature file that exercises every verb and keep it with the
plugin. Add it to the golden corpus at
`itb-cli/packages/gherkin/test/corpus/features/` and record the snapshot with
`node test/corpus.mjs --update`, then read the diff before committing it. The
corpus holds **frozen copies** of the dialects, so a new dialect needs its
fixture added; without that, nothing anywhere tests your verbs.

## 6. Ship

**Ecosystem dialects only.** A dialect of your own is already finished at the end
of section 5 — it needs nothing here, and nothing here is available to you
anyway. To let other people use it, serve the folder at any URL and point
`otb-gherkin dialects --from <url>` at it, or add that URL under
**Components → Plugin dialects** in the workbench. See `EXTENDING.md`.

- Sync, which also rewrites `public/components/index.json`. A folder that is not
  in that file is invisible to the compiler.
- Mirror to the ITB manager. `sync-dialects.mjs` does this for
  `../itb-manager` or whatever `ITB_DIALECT_MIRRORS` names. A dialect missing
  from a mirror fails as `No mapping for step` in that app alone, which is a
  miserable way to find out.
- Add the plugin to `itb-plugins/index.yaml` with `dialect: true`, plus
  `kind: dialect` and `provides: []` if it deploys no service, and `requires:`
  listing the capability names it needs. Every name in `requires:` must have a
  spec under `itb-plugins/capabilities/`; the registry validator errors if not,
  and checks the list against the plugin's own `itb-plugin.yaml`.
- Regenerate the language catalogue docs so the new verbs are findable:
  `npm run gen:language-docs` in `itb-plugin-authoring/app`.
