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

async function deploy(zipPath) {
  if (!zipPath || !fs.existsSync(zipPath)) die(`No such zip: ${zipPath}`);
  const community = env('ITB_COMMUNITY_KEY', true);
  const spec = env('ITB_SPEC_KEY', true);
  const form = new FormData();
  form.append('specification', spec);
  form.append('updateSpecification', 'true');
  form.append('testSuite', new Blob([fs.readFileSync(zipPath)], { type: 'application/zip' }), path.basename(zipPath));
  const data = await call('/api/rest/testsuite/deploy', { headers: { ITB_API_KEY: community }, body: form });
  console.log('deployed');
  const ids = data?.identifiers ?? data;
  if (ids?.testSuite) console.log(`  suite:      ${ids.testSuite}`);
  for (const tc of ids?.testCases ?? []) console.log(`  test case:  ${typeof tc === 'string' ? tc : tc.identifier ?? JSON.stringify(tc)}`);
  return data;
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
