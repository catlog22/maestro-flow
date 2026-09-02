#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVitestLaneParity } from './vitest-lanes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counts = assertVitestLaneParity(root);
console.log(`Vitest lane parity: ${counts.ordinary} ordinary + ${counts.heavy} heavy = ${counts.total}; ${counts.node} node:test files remain under test:node.`);
