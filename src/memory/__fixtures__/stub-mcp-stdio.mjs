#!/usr/bin/env node
/** Line-delimited JSON-RPC MCP stub: tools/list + tools/call only. */
import { writeSync } from 'node:fs';
import readline from 'node:readline';

const tools = [
  {
    name: 'memory_search',
    description: 'Search stub memories',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_add',
    description: 'Add a stub memory',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        project: { type: 'string' },
      },
      required: ['text'],
    },
  },
];

const stored = [];

function send(obj) {
  writeSync(1, `${JSON.stringify(obj)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'stub-memory', version: '0' },
      },
    });
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    if (name === 'memory_add') {
      stored.push(String(args.text ?? ''));
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: `added:${args.text}` }] },
      });
      return;
    }
    if (name === 'memory_search') {
      const query = String(args.query ?? '');
      const hit = stored.find((item) => item.includes(query)) ?? `stub-search-hit:${query}`;
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: hit }] },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { content: [{ type: 'text', text: `unknown:${name}` }], isError: true },
    });
  }
});
