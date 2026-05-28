#!/usr/bin/env node
'use strict';

// Test driver for slack-notify MCP server.
//
// Scenarios:
//   1. Happy path — all three env vars set, send a message, expect ok + ts +
//      response text containing #<channel-name>
//   2. Missing SLACK_CHANNEL_ID — server starts, tool call returns isError
//      naming the missing var; Slack API is NOT called
//   3. Missing SLACK_BOT_TOKEN — same as (2) but for the token
//   4. Missing SLACK_CHANNEL_NAME — same, for the channel name
//   5. Missing all three — error names all three
//
// Usage:
//   SLACK_BOT_TOKEN=xoxb-... SLACK_CHANNEL_ID=C... SLACK_CHANNEL_NAME=... \
//     node test-slack-notify.js

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER = path.join(__dirname, 'slack-notify.js');
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID || process.env.TEST_CHANNEL_ID;
const CHANNEL_NAME = process.env.SLACK_CHANNEL_NAME || 'test-channel';
const MARKER = process.env.TEST_MARKER || `mcp-test-${Date.now()}`;

if (!TOKEN || !CHANNEL) {
  console.error(
    'Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID — required for the happy-path test'
  );
  process.exit(2);
}

// ----------------------------------------------------------------------
// JSON-RPC helpers operating on a spawned server.
// ----------------------------------------------------------------------

function startServer(envOverrides) {
  // Inherit non-SLACK_* vars from parent (PATH, HOME, ...), then apply
  // ONLY the SLACK_* vars the caller explicitly provided. This lets us
  // truly omit SLACK_BOT_TOKEN or SLACK_CHANNEL_ID for the missing-env
  // test scenarios — passing undefined via spread would have stringified
  // to "undefined" in the child process.
  const childEnv = {};
  for (const k of Object.keys(process.env)) {
    if (!k.startsWith('SLACK_')) childEnv[k] = process.env[k];
  }
  for (const k of Object.keys(envOverrides)) {
    childEnv[k] = envOverrides[k];
  }
  const child = spawn(process.execPath, [SERVER], {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderrBuf = [];
  child.stderr.on('data', (c) => stderrBuf.push(c.toString()));
  const pending = new Map();
  let nextId = 1;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_) {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });
  function rpc(method, params) {
    const id = nextId++;
    const req = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;
    const p = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout waiting for ${method} (id=${id})`));
        }
      }, 15000);
    });
    child.stdin.write(JSON.stringify(req) + '\n');
    return p;
  }
  function notify(method, params) {
    const req = { jsonrpc: '2.0', method };
    if (params !== undefined) req.params = params;
    child.stdin.write(JSON.stringify(req) + '\n');
  }
  function stop() {
    try {
      child.stdin.end();
    } catch (_) {}
    child.kill();
  }
  return { child, stderrBuf, rpc, notify, stop };
}

// ----------------------------------------------------------------------
// Assertions.
// ----------------------------------------------------------------------

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

function dumpAndExit(code, stderrBufs) {
  for (const buf of stderrBufs || []) {
    if (buf.length) {
      console.error('--- server stderr ---');
      console.error(buf.join(''));
    }
  }
  if (failures.length) {
    console.error('--- failures ---');
    for (const f of failures) console.error(' • ' + f);
  }
  process.exit(code);
}

// ----------------------------------------------------------------------
// Scenario 1: happy path.
// ----------------------------------------------------------------------

async function happyPath() {
  const s = startServer({
    SLACK_BOT_TOKEN: TOKEN,
    SLACK_CHANNEL_ID: CHANNEL,
    SLACK_CHANNEL_NAME: CHANNEL_NAME,
  });
  try {
    // initialize
    const initResp = await s.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-driver', version: '2.1.0' },
    });
    check(initResp.result && initResp.result.serverInfo, 'happy: initialize missing serverInfo');
    check(
      initResp.result && initResp.result.serverInfo && initResp.result.serverInfo.name === 'slack-notify-local',
      'happy: serverInfo.name mismatch'
    );

    // initialized notification (no reply)
    s.notify('notifications/initialized');

    // tools/list
    const listResp = await s.rpc('tools/list');
    const tools = listResp.result && listResp.result.tools;
    check(Array.isArray(tools) && tools.length === 1, 'happy: expected 1 tool');
    const sm = tools && tools[0];
    check(sm && sm.name === 'send_message', 'happy: tool name mismatch');
    check(
      sm && sm.inputSchema && Array.isArray(sm.inputSchema.required) && sm.inputSchema.required.length === 1 && sm.inputSchema.required[0] === 'text',
      'happy: inputSchema.required should be exactly [text], got: ' + JSON.stringify(sm && sm.inputSchema && sm.inputSchema.required)
    );
    check(
      sm && sm.inputSchema && sm.inputSchema.properties && !sm.inputSchema.properties.channel_id,
      'happy: channel_id must NOT appear as a tool input — it is config-time only'
    );
    // Tool description should expose channel name so the model can choose
    // between multiple slack-notify-* MCP instances at tools/list time.
    check(
      sm && typeof sm.description === 'string' && sm.description.includes(`#${CHANNEL_NAME}`),
      `happy: tool description should include #${CHANNEL_NAME}, got: ${sm && sm.description}`
    );

    // tools/call send_message — only text arg, no channel_id
    const callResp = await s.rpc('tools/call', {
      name: 'send_message',
      arguments: { text: MARKER },
    });
    const content = callResp.result && callResp.result.content;
    const textBlock = content && content[0];
    check(textBlock && textBlock.type === 'text', 'happy: response content not text');
    check(!callResp.result.isError, 'happy: isError=true — body: ' + (textBlock && textBlock.text));
    check(textBlock && /ts=\d+\.\d+/.test(textBlock.text), 'happy: response missing ts=...');
    check(
      textBlock && textBlock.text.includes(`#${CHANNEL_NAME}`),
      `happy: response should include #${CHANNEL_NAME}, got: ${textBlock && textBlock.text}`
    );

    // Unknown tool error path
    const badResp = await s.rpc('tools/call', { name: 'nope', arguments: {} });
    check(badResp.error, 'happy: unknown tool should return JSON-RPC error');

    console.log('[happy] PASS — ' + (textBlock && textBlock.text));
    return { textBlock, stderr: s.stderrBuf };
  } finally {
    s.stop();
  }
}

// ----------------------------------------------------------------------
// Scenario 2/3: missing env vars. Server should start (so tools/list works)
// but tool calls return isError naming the missing var, without contacting Slack.
// ----------------------------------------------------------------------

async function missingEnv(label, env, expectedMissing) {
  const s = startServer(env);
  try {
    await s.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-driver', version: '2.1.0' },
    });
    s.notify('notifications/initialized');

    // tools/list should still succeed even with missing env
    const listResp = await s.rpc('tools/list');
    check(
      listResp.result && listResp.result.tools && listResp.result.tools.length === 1,
      `${label}: tools/list should still work with missing env`
    );

    // tools/call should error out without calling Slack
    const callResp = await s.rpc('tools/call', {
      name: 'send_message',
      arguments: { text: 'should-never-reach-slack' },
    });
    check(callResp.result, `${label}: tools/call must produce a result (not transport error)`);
    check(
      callResp.result && callResp.result.isError === true,
      `${label}: tools/call should set isError=true`
    );
    const txt = callResp.result && callResp.result.content && callResp.result.content[0] && callResp.result.content[0].text;
    for (const name of expectedMissing) {
      check(
        txt && txt.includes(name),
        `${label}: error text should mention "${name}", got: ${txt}`
      );
    }

    // stderr warning should also mention the missing var (operator visibility)
    const stderrJoined = s.stderrBuf.join('');
    for (const name of expectedMissing) {
      check(
        stderrJoined.includes(name),
        `${label}: stderr should warn about "${name}", got: ${stderrJoined.slice(0, 200)}`
      );
    }

    console.log(`[${label}] PASS — error text: ${txt}`);
    return { stderr: s.stderrBuf };
  } finally {
    s.stop();
  }
}

// ----------------------------------------------------------------------
// Main.
// ----------------------------------------------------------------------

(async () => {
  const stderrBufs = [];
  try {
    const r1 = await happyPath();
    stderrBufs.push(r1.stderr);

    const r2 = await missingEnv(
      'missing-channel-id',
      { SLACK_BOT_TOKEN: TOKEN, SLACK_CHANNEL_NAME: CHANNEL_NAME }, // no SLACK_CHANNEL_ID
      ['SLACK_CHANNEL_ID']
    );
    stderrBufs.push(r2.stderr);

    const r3 = await missingEnv(
      'missing-bot-token',
      { SLACK_CHANNEL_ID: CHANNEL, SLACK_CHANNEL_NAME: CHANNEL_NAME }, // no SLACK_BOT_TOKEN
      ['SLACK_BOT_TOKEN']
    );
    stderrBufs.push(r3.stderr);

    const r4 = await missingEnv(
      'missing-channel-name',
      { SLACK_BOT_TOKEN: TOKEN, SLACK_CHANNEL_ID: CHANNEL }, // no SLACK_CHANNEL_NAME
      ['SLACK_CHANNEL_NAME']
    );
    stderrBufs.push(r4.stderr);

    const r5 = await missingEnv(
      'missing-all',
      {}, // none set
      ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_CHANNEL_NAME']
    );
    stderrBufs.push(r5.stderr);

    if (failures.length) {
      console.error(`FAIL — ${failures.length} assertion(s) failed`);
      dumpAndExit(1, stderrBufs);
    }
    console.log('---');
    console.log('ALL PASS');
    console.log('marker:', MARKER);
    console.log('channel:', CHANNEL);
    process.exit(0);
  } catch (e) {
    console.error('Test driver error:', e.message);
    dumpAndExit(3, stderrBufs);
  }
})();
