#!/usr/bin/env node
'use strict';

// Minimal stdio MCP server: exposes `send_message` calling Slack chat.postMessage.
// Channel is bound at configuration time via SLACK_CHANNEL_ID env var — one
// MCP instance = one notification destination. For multiple destinations,
// configure multiple slack-notify entries in ~/.claude.json.
//
// Required env:
//   SLACK_BOT_TOKEN  — Bot User OAuth Token (xoxb-...)
//   SLACK_CHANNEL_ID — Channel/user ID this instance posts to (e.g. C07XXXX)
//
// Zero npm deps — uses Node stdlib only.

const readline = require('readline');
const https = require('https');

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const PROTOCOL_VERSION = '2024-11-05';

// Tool schema — text + optional thread_ts. Channel is NOT a tool argument;
// it is bound to this MCP instance via SLACK_CHANNEL_ID.
const TOOLS = [
  {
    name: 'send_message',
    description:
      'Send a message via the configured Slack bot to the configured channel ' +
      "(SLACK_CHANNEL_ID set in this MCP's env). One MCP instance posts to " +
      'exactly one channel — to target other channels, configure additional ' +
      'slack-notify entries.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Message text. Supports Slack mrkdwn.',
        },
        thread_ts: {
          type: 'string',
          description: 'Optional: parent message ts to reply in thread',
        },
      },
      required: ['text'],
    },
  },
];

function checkRequiredEnv() {
  const missing = [];
  if (!BOT_TOKEN) missing.push('SLACK_BOT_TOKEN');
  if (!CHANNEL_ID) missing.push('SLACK_CHANNEL_ID');
  if (missing.length === 0) return null;
  return (
    'slack-notify: missing required env var(s): ' +
    missing.join(', ') +
    '. Add to the `env` block of this MCP server entry in ~/.claude.json ' +
    'and restart Claude Code. The tool will refuse to call Slack until both are set.'
  );
}

// Warn at startup but DO NOT exit — the MCP client can still list tools,
// and the operator sees the actionable error in stderr. Tool calls will
// return the same error message via isError so the model can relay it.
const startupErr = checkRequiredEnv();
if (startupErr) {
  process.stderr.write(startupErr + '\n');
}

function writeMessage(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function slackPost(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'slack.com',
        path: '/api/' + method,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: 'Bearer ' + BOT_TOKEN,
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks));
          } catch (e) {
            reject(new Error('Non-JSON response: ' + chunks.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function callSendMessage(args) {
  // Re-check env at call time — covers the case where the operator started
  // the server with partial env. We don't want the model to silently fail.
  const envErr = checkRequiredEnv();
  if (envErr) {
    return { content: [{ type: 'text', text: envErr }], isError: true };
  }
  if (!args || typeof args !== 'object') {
    return { content: [{ type: 'text', text: 'Error: missing arguments' }], isError: true };
  }
  const { text, thread_ts } = args;
  if (!text || typeof text !== 'string') {
    return {
      content: [{ type: 'text', text: 'Error: `text` is required and must be a string' }],
      isError: true,
    };
  }
  const body = { channel: CHANNEL_ID, text };
  if (thread_ts) body.thread_ts = thread_ts;
  try {
    const r = await slackPost('chat.postMessage', body);
    if (!r.ok) {
      return {
        content: [{ type: 'text', text: 'Slack API error: ' + (r.error || JSON.stringify(r)) }],
        isError: true,
      };
    }
    const ts = r.ts || '';
    const ch = r.channel || CHANNEL_ID;
    return {
      content: [
        {
          type: 'text',
          text: `Sent. channel=${ch} ts=${ts}`,
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: 'Network error: ' + e.message }],
      isError: true,
    };
  }
}

async function handle(req) {
  const { id, method, params } = req;

  // Notifications have no id and expect no response
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'slack-notify-local', version: '2.0.0' },
      },
    };
  }
  if (method === 'notifications/initialized' || method === 'initialized') {
    return null;
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    if (name !== 'send_message') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Unknown tool: ' + name },
      };
    }
    const result = await callSendMessage(params && params.arguments);
    return { jsonrpc: '2.0', id, result };
  }

  if (isNotification) return null;
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found: ' + method },
  };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: ' + e.message },
    });
    return;
  }
  try {
    const resp = await handle(req);
    if (resp) writeMessage(resp);
  } catch (e) {
    if (req && req.id !== undefined && req.id !== null) {
      writeMessage({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: 'Internal error: ' + e.message },
      });
    }
  }
});

rl.on('close', () => process.exit(0));
