#!/usr/bin/env node
'use strict';

// Minimal stdio MCP server: exposes `send_message` calling Slack chat.postMessage.
// Zero npm deps — uses node stdlib only.

const readline = require('readline');
const https = require('https');

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!BOT_TOKEN) {
  process.stderr.write('slack-notify: missing SLACK_BOT_TOKEN env\n');
  process.exit(1);
}

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'send_message',
    description:
      'Send a Slack message via the Claude Notify bot. ' +
      'channel_id is a Slack channel ID (e.g. C07LW2QSF3Q) or user ID for DM (e.g. U024Y9EG53P). ' +
      'The bot must be invited to the target channel first.',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Slack channel ID or user ID for DM',
        },
        text: {
          type: 'string',
          description: 'Message text. Supports Slack mrkdwn.',
        },
        thread_ts: {
          type: 'string',
          description: 'Optional: parent message ts to reply in thread',
        },
      },
      required: ['channel_id', 'text'],
    },
  },
];

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
  if (!args || typeof args !== 'object') {
    return { content: [{ type: 'text', text: 'Error: missing arguments' }], isError: true };
  }
  const { channel_id, text, thread_ts } = args;
  if (!channel_id || !text) {
    return {
      content: [{ type: 'text', text: 'Error: channel_id and text are required' }],
      isError: true,
    };
  }
  const body = { channel: channel_id, text };
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
    const ch = r.channel || channel_id;
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
        serverInfo: { name: 'slack-notify-local', version: '1.0.0' },
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
