#!/usr/bin/env node
// Deploy a compiled suite to a running ITB and run its test cases.
//
//   node run-on-itb.mjs deploy <suite.zip>
//   node run-on-itb.mjs run <testCaseId> [...]
//   node run-on-itb.mjs status <sessionId>
//
// Configuration comes from the environment, so nothing is written to disk:
//
//   ITB_BASE_URL      e.g. http://localhost:9000
//   ITB_COMMUNITY_KEY community API key  — needed to deploy
//   ITB_SPEC_KEY      the target specification's API key — needed to deploy
//   ITB_ORG_KEY       organisation API key — needed to run
//   ITB_SYSTEM_KEY    the system under test's API key — needed to run
//   ITB_ACTOR_KEY     the actor the system plays — needed to run
//   ITB_WAIT          seconds to wait for a verdict (default 60)
//   ITB_IGNORE_WARNINGS  1 = deploy even when the Test Bed raises warnings
//
// `deploy` exits 1 unless the Test Bed says the deployment completed, and
// prints each actor's key for ITB_ACTOR_KEY. `run` first makes sure the
// system has a conformance statement for the actor (organisation key).
//
// These are ITB's own documented REST endpoints, not an OpenTestBed wrapper,
// so this works against any ITB instance.
//
// EXIT CODES ARE THE POINT. `run` exits 1 if any session ends in anything
// other than SUCCESS, so it is usable as a gate. A session that needs an
// operator to answer a dialog stays UNDEFINED until someone does; that is
// reported distinctly from a failure, and also exits 1, because an
// unanswered test has established nothing.

import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
const env = (k, required) => {
  const v = process.env[k];
  if (!v && required) die(`${k} is not set. See references/setup.md for which keys each command needs.`);
  return v;
};
function die(msg) { console.error(msg); process.exit(2); }

const BASE = (env('ITB_BASE_URL', true) || '').replace(/\/+$/, '');

async function call(pathname, { headers = {}, body, method = 'POST' } = {}) {
  let resp;
  try {
    resp = await fetch(`${BASE}${pathname}`, { method, headers, body });
  } catch (e) {
    throw new Error(`cannot reach ${BASE}${pathname} — ${e.message}. Check ITB_BASE_URL and that the instance is up.`);
  }
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!resp.ok) {
    const shown = typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500);
    throw new Error(`${pathname} → HTTP ${resp.status}: ${shown}`);
  }
  return data;
}

// The Test Bed answers HTTP 200 to a deployment it REFUSED: the body says
// `completed: false` and lists why (TDL errors, or warnings when
// ignoreWarnings is not set). Printing "deployed" for that sent the next
// `run` after test cases that do not exist. Only `completed: true` counts.
const reportItems = (data) => {
  const out = [];
  for (const k of ['errors', 'warnings', 'messages']) {
    for (const m of [].concat(data?.[k] ?? [])) {
      const text = typeof m === 'string' ? m : (m.description ?? m.message ?? JSON.stringify(m));
      out.push(`  ${k.replace(/s$/, '').padEnd(8)} ${text}`);
    }
  }
  return out;
};

async function deploy(zipPath) {
  if (!zipPath || !fs.existsSync(zipPath)) die(`No such zip: ${zipPath}`);
  const community = env('ITB_COMMUNITY_KEY', true);
  const spec = env('ITB_SPEC_KEY', true);
  const form = new FormData();
  form.append('specification', spec);
  form.append('updateSpecification', 'true');
  // Warnings refuse a deployment unless this is set. Off by default, so a
  // warning is seen once; ITB_IGNORE_WARNINGS=1 deploys past it.
  if (/^(1|true|yes)$/i.test(process.env.ITB_IGNORE_WARNINGS ?? '')) form.append('ignoreWarnings', 'true');
  form.append('testSuite', new Blob([fs.readFileSync(zipPath)], { type: 'application/zip' }), path.basename(zipPath));
  const data = await call('/api/rest/testsuite/deploy', { headers: { ITB_API_KEY: community }, body: form });
  if (data?.completed !== true) {
    console.error(`NOT DEPLOYED: the Test Bed answered completed: ${JSON.stringify(data?.completed)}`);
    for (const l of reportItems(data)) console.error(l);
    if ((data?.warnings ?? []).length && !(data?.errors ?? []).length) {
      console.error('  Only warnings: set ITB_IGNORE_WARNINGS=1 to deploy past them, once you have read them.');
    }
    // exitCode, not exit(): exiting while fetch's sockets are still closing
    // aborts Node on Windows (libuv assertion in async.c).
    process.exitCode = 1;
    return data;
  }
  console.log('deployed');
  for (const l of reportItems(data)) console.log(l);
  const ids = data?.identifiers ?? data;
  if (ids?.testSuite) console.log(`  suite:      ${ids.testSuite}`);
  for (const tc of ids?.testCases ?? []) console.log(`  test case:  ${typeof tc === 'string' ? tc : tc.identifier ?? JSON.stringify(tc)}`);
  // The actor keys `run` needs (ITB_ACTOR_KEY) come back here and nowhere
  // else without another API call. Each is { name: <actor id in the suite>,
  // identifier: <API key> }.
  for (const s of [].concat(ids?.specifications ?? [])) {
    for (const a of s?.actors ?? []) console.log(`  actor:      ${String(a.name).padEnd(20)} ITB_ACTOR_KEY=${a.identifier}`);
  }
  return data;
}

// A system can only run a test case for an actor it has a conformance
// statement for; without one, tests/start answers that the test case was not
// found (506) — on a fresh specification, every time. The statement belongs
// to the system's organisation, so the ORGANISATION key creates it (the
// community key gets 403). Idempotent: an existing statement is fine.
async function ensureConformance() {
  const org = env('ITB_ORG_KEY', true);
  const system = env('ITB_SYSTEM_KEY', true);
  const actor = env('ITB_ACTOR_KEY', true);
  let resp;
  try {
    resp = await fetch(`${BASE}/api/rest/conformance/${system}/${actor}`, { method: 'PUT', headers: { ITB_API_KEY: org } });
  } catch (e) {
    throw new Error(`cannot reach ${BASE} — ${e.message}. Check ITB_BASE_URL and that the instance is up.`);
  }
  if (resp.ok || resp.status === 409) return;
  const text = (await resp.text()).slice(0, 300);
  // The Test Bed answers an existing statement with 400, error_code 514.
  if (/"error_code"\s*:\s*"514"/.test(text)) return;
  // Not fatal: some builds refuse a duplicate with another status. If the
  // statement really is missing, start reports it, and this line says why.
  console.warn(`conformance statement for the system and actor: HTTP ${resp.status} ${text}`);
  if (resp.status === 403) console.warn('  403: ITB_ORG_KEY must be the key of the organisation that owns ITB_SYSTEM_KEY.');
}

async function start(testCaseId) {
  const org = env('ITB_ORG_KEY', true);
  const system = env('ITB_SYSTEM_KEY', true);
  const actor = env('ITB_ACTOR_KEY', true);
  const data = await call('/api/rest/tests/start', {
    headers: { ITB_API_KEY: org, 'Content-Type': 'application/json' },
    // testCase is an ARRAY. Sent as a string the Test Bed ignores the filter and
    // starts EVERY test case of the actor, and createdSessions[0] is then the
    // first of those rather than the one asked for — so `run` reported another
    // case's result for every case. itb-cli issue #3.
    body: JSON.stringify({ testCase: [testCaseId], system, actor, forceSequentialExecution: true }),
  });
  const created = data.createdSessions;
  if (Array.isArray(created) && created.length !== 1) {
    die(`tests/start created ${created.length} session(s) for "${testCaseId}", expected 1.\n` +
        `  The testCase filter was not applied, so any result reported here would be another case's.`);
  }
  return data.sessionId ?? data.session ?? created?.[0]?.session ?? null;
}

async function status(sessionId, { withLogs = true } = {}) {
  const org = env('ITB_ORG_KEY', true);
  // withLogs is on by default here: when a case fails, the step that failed
  // is the whole point, and a second round trip to find it is wasted.
  const data = await call('/api/rest/tests/status', {
    headers: { ITB_API_KEY: org, 'Content-Type': 'application/json' },
    // session is an ARRAY, and the answer is { sessions: [ {...} ] }. Sent as a
    // string the Test Bed answers { sessions: [] }, so a finished session read
    // as UNDEFINED and the run gate could never see a verdict — which is why
    // "UNDEFINED is not a pass" looked like an interactive-test quirk rather
    // than a bug. itb-cli issue #4.
    body: JSON.stringify({ session: [sessionId], withLogs }),
  });
  const s = data.sessions?.find(x => x.session === sessionId) ?? data.sessions?.[0];
  return { result: s?.result ?? data.result ?? data.status ?? 'UNDEFINED', raw: s ?? data };
}

async function poll(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { result: 'UNDEFINED', raw: null };
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    last = await status(sessionId);
    if (!['UNDEFINED', 'RUNNING', 'PENDING'].includes(String(last.result).toUpperCase())) return last;
  }
  return last;
}

function showFailure(raw) {
  const logs = raw?.logs ?? raw?.log ?? [];
  const lines = (Array.isArray(logs) ? logs : String(logs).split('\n'))
    .map(l => (typeof l === 'string' ? l : JSON.stringify(l)))
    .filter(l => /error|fail|assert/i.test(l));
  for (const l of lines.slice(-12)) console.log(`      ${l}`);
}

try {
  if (cmd === 'deploy') {
    await deploy(args[0]);
  } else if (cmd === 'run') {
    if (args.length === 0) die('Usage: node run-on-itb.mjs run <testCaseId> [...]');
    const waitMs = Number(process.env.ITB_WAIT ?? 60) * 1000;
    await ensureConformance();
    let bad = 0;
    for (const tc of args) {
      const sessionId = await start(tc);
      if (!sessionId) { console.log(`${tc}: no session id returned`); bad++; continue; }
      const { result, raw } = await poll(sessionId, waitMs);
      const verdict = String(result).toUpperCase();
      console.log(`${verdict.padEnd(9)} ${tc}   (session ${sessionId})`);
      if (verdict === 'UNDEFINED') {
        console.log('      no verdict within the wait. Either it is still running, or it is');
        console.log('      waiting for an operator to answer a dialog in the ITB UI.');
        bad++;
      } else if (verdict !== 'SUCCESS') {
        showFailure(raw);
        bad++;
      }
    }
    console.log(`\n${args.length - bad} of ${args.length} succeeded`);
    process.exit(bad ? 1 : 0);
  } else if (cmd === 'status') {
    if (!args[0]) die('Usage: node run-on-itb.mjs status <sessionId>');
    const { result, raw } = await status(args[0]);
    console.log(result);
    if (String(result).toUpperCase() !== 'SUCCESS') showFailure(raw);
    process.exit(String(result).toUpperCase() === 'SUCCESS' ? 0 : 1);
  } else {
    die('Usage: node run-on-itb.mjs <deploy|run|status> ...');
  }
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(2);
}
