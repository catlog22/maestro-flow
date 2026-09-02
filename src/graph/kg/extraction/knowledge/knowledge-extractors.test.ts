import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractSpec } from './spec-extractor.js';
import { extractWiki } from './wiki-extractor.js';
import { wikiIdToNodeId } from '../../credibility.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-kg-knowledge-extract-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('canonical KG knowledge identities', () => {
  it('aligns Spec graph IDs with loadable Wiki entry IDs', () => {
    const projectRoot = root();
    const workflowRoot = join(projectRoot, '.workflow');
    const specsDir = join(workflowRoot, 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'coding-conventions.md'), `---
category: coding
---

<spec-entry category="coding" keywords="first" date="2026-07-28" sid="S-first" title="First rule">

### First rule

Use the first rule.

</spec-entry>

<spec-entry category="coding" keywords="second" date="2026-07-28" sid="S-second" title="Second rule">

### Second rule

Use the second rule.

</spec-entry>
`, 'utf8');

    const result = extractSpec(specsDir, workflowRoot);

    expect(result.nodes.map(node => node.id)).toEqual([
      'spec:project:coding-conventions-001',
      'spec:project:coding-conventions-002',
    ]);
    expect(result.nodes[0]).toMatchObject({
      name: 'First rule',
      metadata: {
        wikiId: 'spec:project:coding-conventions-001',
        sid: 'S-first',
      },
    });
    expect(wikiIdToNodeId('spec:project:coding-conventions-001'))
      .toBe('spec:project:coding-conventions-001');
  });

  it('normalizes legacy Knowhow metadata through the canonical content model', () => {
    const projectRoot = root();
    const workflowRoot = join(projectRoot, '.workflow');
    const knowhowDir = join(workflowRoot, 'knowhow');
    mkdirSync(knowhowDir, { recursive: true });
    writeFileSync(join(knowhowDir, 'DCS-20260728-Legacy.md'), `---
title: Legacy decision
type: decision
category: architecture-decision
specCategory: arch
tags:
  - auth
keywords:
  - tokens
source: issue:42
lang: typescript
status: superseded
assetType: api-contract
codePaths:
  - src/auth/token.ts
---

First useful paragraph.
`, 'utf8');

    const [node] = extractWiki(knowhowDir, workflowRoot).nodes;

    expect(node).toMatchObject({
      definition: 'First useful paragraph.',
      keywords: ['tokens', 'auth', 'architecture-decision', 'api-contract'],
      category: 'arch',
      status: 'deprecated',
      metadata: expect.objectContaining({
        language: 'typescript',
        sourceRef: 'issue:42',
        relatedPaths: ['src/auth/token.ts'],
        decisionState: 'superseded',
        lifecycleStatus: 'deprecated',
      }),
    });
  });

  it('normalizes Knowhow graph IDs to the canonical Wiki slug', () => {
    const projectRoot = root();
    const workflowRoot = join(projectRoot, '.workflow');
    const knowhowDir = join(workflowRoot, 'knowhow');
    mkdirSync(knowhowDir, { recursive: true });
    writeFileSync(join(knowhowDir, 'TIP-20260728-Identity.md'), `---
title: Identity recipe
type: tip
status: active
---

Keep one identity.
`, 'utf8');

    const result = extractWiki(knowhowDir, workflowRoot);

    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'knowhow:tip-20260728-identity',
        metadata: expect.objectContaining({
          wikiId: 'knowhow-tip-20260728-identity',
        }),
      }),
    ]);
    expect(wikiIdToNodeId('knowhow-tip-20260728-identity'))
      .toBe('knowhow:tip-20260728-identity');
  });
});
