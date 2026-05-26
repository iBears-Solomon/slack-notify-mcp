#!/usr/bin/env node
'use strict';

// Test driver for slack-notify MCP server.
// Spawns the server, walks through initialize → tools/list → tools/call,
// asserts each response, and prints a diagnostic block on any failure.
//
// Usage:
//   SLACK_BOT_TOKEN=xoxb-... TEST_CHANNEL_ID=C... node test-slack-notify.js

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER = path.join(__dirname, 'slack-notify.js');
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.TEST_CHANNEL_ID || 'C07LW2QSF3Q'; // #solomon-test default
const MARKER = process.env.TEST_MARKER || `mcp-test-${Date.now()}`;

if (!TOKEN) {
  console.error('Missing SLACK_BOT_TOKEN');
  process.exit(2);
}

const child = spawn(process.execPath, [SERVER], {
  env: { ...process.env, SLACK_BOT_TOKEN: TOKEN },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const stderrBuf = [];
child.stderr.on('data', (c) => stderrBuf.push(c.toString()));
child.on('error', (e) => {
  console.error('Failed to spawn server:', e.message);
  process.exit(2);
});

const rl = readline.createInterface({ input: child.stdout });
const pending = new Map(); // id → {resolve, reject}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    console.error('Server emitted non-JSON line:', trimmed);
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

let nextId = 1;
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

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

function dumpAndExit(code) {
  if (stderrBuf.length) {
    console.error('--- server stderr ---');
    console.error(stderrBuf.join(''));
  }
  if (failures.length) {
    console.error('--- failures ---');
    for (const f of failures) console.error(' • ' + f);
  }
  try {
    child.stdin.end();
  } catch (_) {}
  child.kill();
  process.exit(code);
}

(async () => {
  try {
    // 1. initialize
    const initResp = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-driver', version: '1.0.0' },
    });
    check(initResp.result, 'initialize: missing result');
    check(initResp.result && initResp.result.serverInfo, 'initialize: missing serverInfo');
    check(
      initResp.result && initResp.result.serverInfo && initResp.result.serverInfo.name === 'slack-notify-local',
      'initialize: serverInfo.name mismatch'
    );
    check(
      initResp.result && initResp.result.capabilities && initResp.result.capabilities.tools !== undefined,
      'initialize: capabilities.tools missing'
    );

    // 2. initialized notification (no reply)
    notify('notifications/initialized');

    // 3. tools/list
    const listResp = await rpc('tools/list');
    check(listResp.result, 'tools/list: missing result');
    const tools = listResp.result && listResp.result.tools;
    check(Array.isArray(tools), 'tools/list: tools is not an array');
    check(tools && tools.length === 1, 'tools/list: expected exactly 1 tool, got ' + (tools ? tools.length : '?'));
    const sm = tools && tools.find((t) => t.name === 'send_message');
    check(!!sm, 'tools/list: send_message tool not found');
    check(
      sm && sm.inputSchema && sm.inputSchema.required && sm.inputSchema.required.includes('channel_id') && sm.inputSchema.required.includes('text'),
      'tools/list: inputSchema missing required channel_id/text'
    );

    // 4. tools/call — real Slack message
    const callResp = await rpc('tools/call', {
      name: 'send_message',
      arguments: { channel_id: CHANNEL, text: MARKER },
    });
    check(callResp.result, 'tools/call: missing result');
    const content = callResp.result && callResp.result.content;
    check(Array.isArray(content) && content.length > 0, 'tools/call: empty content');
    const textBlock = content && content[0];
    check(textBlock && textBlock.type === 'text', 'tools/call: first content not text');
    check(
      !callResp.result.isError,
      'tools/call: isError=true — body: ' + (textBlock && textBlock.text)
    );
    check(
      textBlock && /ts=\d+\.\d+/.test(textBlock.text),
      'tools/call: response text missing ts=... — body: ' + (textBlock && textBlock.text)
    );

    // 5. Unknown tool error path
    const badResp = await rpc('tools/call', {
      name: 'nonexistent_tool',
      arguments: {},
    });
    check(badResp.error, 'unknown tool: expected error response');

    if (failures.length) {
      console.error('FAIL — ' + failures.length + ' assertion(s) failed');
      dumpAndExit(1);
    }
    console.log('PASS');
    console.log('marker:', MARKER);
    console.log('channel:', CHANNEL);
    console.log('send_message response text:', textBlock && textBlock.text);
    dumpAndExit(0);
  } catch (e) {
    console.error('Test driver error:', e.message);
    dumpAndExit(3);
  }
})();
