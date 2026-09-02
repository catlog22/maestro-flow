import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initializeRepositoryIdentity } from '../repository/context.js';
import {
  applyKnowledgeNormalization,
  inspectKnowledgeCompatibility,
  planKnowledgeNormalization,
  writeKnowledgeNormalizationReport,
} from './normalize.js';

const roots: string[] = [];

function fixture(): { root: string; repoId: string; spec: string; knowhow: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-knowledge-normalize-'));
  roots.push(root);
  mkdirSync(join(root, '.workflow', 'specs'), { recursive: true });
  mkdirSync(join(root, '.workflow', 'knowhow'), { recursive: true });
  const repoId = initializeRepositoryIdentity(root, { repoName: 'Normalize' }).repo_id;
  const spec = join(root, '.workflow', 'specs', 'coding-conventions.md');
  writeFileSync(spec, `---\ncategory: coding\n---\n\n<spec-entry category="coding" tags="audit,legacy" date="2026-08-01" sid="S-legacy" source="issue:1" codePaths="src/a.ts" status="active">\n\n### Legacy spec\n\nKeep compatibility explicit.\n\n</spec-entry>\n`, 'utf8');
  const knowhow = join(root, '.workflow', 'knowhow', 'TIP-20260801-legacy.md');
  writeFileSync(knowhow, `---\ntitle: Legacy tip\ntype: tip\nspecCategory: coding\ntags: [legacy, audit]\nlang: typescript\nsource: issue:2\ncodePaths: [src/b.ts]\nstatus: active\nassetType: snippet\n---\n\nKeep migrations report-first.\n`, 'utf8');
  return { root, repoId, spec, knowhow };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('knowledge compatibility audit and normalization', () => {
  it('reports every legacy alias and legacy-unscoped entries without mutation', () => {
    const f = fixture();
    const beforeSpec = readFileSync(f.spec, 'utf8');
    const beforeKnowhow = readFileSync(f.knowhow, 'utf8');
    const report = inspectKnowledgeCompatibility(f.root);

    expect(report.current_repository).toMatchObject({ repo_id: f.repoId, identity_persisted: true, valid: true });
    expect(report.entries.flatMap(entry => entry.states)).toEqual(expect.arrayContaining([
      'legacy-tags', 'legacy-specCategory', 'legacy-status', 'legacy-source',
      'legacy-codePaths', 'legacy-lang', 'legacy-assetType', 'legacy-unscoped',
    ]));
    expect(readFileSync(f.spec, 'utf8')).toBe(beforeSpec);
    expect(readFileSync(f.knowhow, 'utf8')).toBe(beforeKnowhow);
  });

  it('requires a saved matching dry-run report, backs up, and writes canonical fields plus exact repo scope', () => {
    const f = fixture();
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    expect(() => applyKnowledgeNormalization(f.root, reportPath)).toThrow(/existing dry-run report/);

    const report = planKnowledgeNormalization(f.root);
    expect(report.actions).toHaveLength(2);
    expect(report.actions.every(action => action.blocked.length === 0)).toBe(true);
    writeKnowledgeNormalizationReport(reportPath, report);
    const applied = applyKnowledgeNormalization(f.root, reportPath);

    expect(applied.applied).toBe(2);
    expect(applied.backup_dir).toMatch(/^\.workflow\/\.trash\/knowledge-normalize-/);
    expect(existsSync(join(f.root, applied.backup_dir!))).toBe(true);
    const spec = readFileSync(f.spec, 'utf8');
    expect(spec).toContain('keywords="audit,legacy"');
    expect(spec).toContain('sourceRef="issue:1"');
    expect(spec).toContain('relatedPaths="src/a.ts"');
    expect(spec).toContain(`appliesToRepoIds="${f.repoId}"`);
    expect(spec).not.toMatch(/\s(tags|source|codePaths|status)=/);
    const knowhow = readFileSync(f.knowhow, 'utf8');
    expect(knowhow).toContain('category: coding');
    expect(knowhow).toContain('language: typescript');
    expect(knowhow).toContain('sourceRef: issue:2');
    expect(knowhow).toContain(`- ${f.repoId}`);
    expect(knowhow).not.toContain('specCategory:');
    expect(knowhow).not.toContain('assetType:');
  });

  it('fails closed when sources change after report generation and leaves files untouched', () => {
    const f = fixture();
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    writeKnowledgeNormalizationReport(reportPath, planKnowledgeNormalization(f.root));
    writeFileSync(f.spec, `${readFileSync(f.spec, 'utf8')}\nexternal change\n`, 'utf8');
    const changed = readFileSync(f.spec, 'utf8');

    expect(() => applyKnowledgeNormalization(f.root, reportPath)).toThrow(/changed after normalization dry-run/);
    expect(readFileSync(f.spec, 'utf8')).toBe(changed);
  });

  it('decodes XML entities before canonical re-encoding and is idempotent', () => {
    const f = fixture();
    writeFileSync(f.spec, `---\ncategory: coding\n---\n\n<spec-entry category="coding" keywords="a&amp;b" tags="legacy" date="2026-08-01" sid="S-entity" title="A &quot;quoted&quot; title" sourceRef="issue:1?x=1&amp;y=2" appliesToRepoIds="${f.repoId}">\n\nEntity-safe content.\n\n</spec-entry>\n`, 'utf8');
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    const first = planKnowledgeNormalization(f.root, 'spec');
    writeKnowledgeNormalizationReport(reportPath, first);
    expect(applyKnowledgeNormalization(f.root, reportPath).applied).toBe(1);
    const normalized = readFileSync(f.spec, 'utf8');
    expect(normalized).toContain('keywords="a&amp;b,legacy"');
    expect(normalized).toContain('title="A &quot;quoted&quot; title"');
    expect(normalized).not.toContain('&amp;amp;');
    expect(planKnowledgeNormalization(f.root, 'spec').actions).toEqual([]);
  });

  it('blocks and reports every canonical validation error without deleting legacy metadata', () => {
    const f = fixture();
    writeFileSync(f.knowhow, `---\ntitle: Invalid legacy\ntype: unsupported\ntags: [legacy]\ncodePaths:\n  - ../outside.ts\ndecisionState: impossible\nlifecycleStatus: archived\n---\n\nDo not rewrite this entry.\n`, 'utf8');
    const before = readFileSync(f.knowhow, 'utf8');
    const report = planKnowledgeNormalization(f.root, 'knowhow');
    expect(report.actions[0].blocked).toEqual(expect.arrayContaining([
      'Invalid Knowhow type: unsupported',
      'Related path must not traverse outside the project: ../outside.ts',
      'Invalid decision state: impossible',
      'Invalid lifecycle status: archived',
    ]));
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    writeKnowledgeNormalizationReport(reportPath, report);
    expect(applyKnowledgeNormalization(f.root, reportPath).applied).toBe(0);
    expect(readFileSync(f.knowhow, 'utf8')).toBe(before);
    expect(readFileSync(f.knowhow, 'utf8')).toContain('tags:');
    expect(readFileSync(f.knowhow, 'utf8')).toContain('codePaths:');
  });

  it('emits Knowhow from the canonical allowlist and maps supported aliases', () => {
    const f = fixture();
    writeFileSync(f.knowhow, `---\ntitle: Alias migration\ntype: tip\nid: TIP-20260801-ALIAS\ndescription: Legacy summary\ncontent: Inline canonical body\nbody: Ignored legacy body\ntool: Bash\nstatus: active\nunknownIndexField: 42\n---\n`, 'utf8');
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    writeKnowledgeNormalizationReport(reportPath, planKnowledgeNormalization(f.root, 'knowhow'));
    expect(applyKnowledgeNormalization(f.root, reportPath).applied).toBe(1);
    const normalized = readFileSync(f.knowhow, 'utf8');
    expect(normalized).toContain('explicitId: tip-20260801-alias');
    expect(normalized).toContain('summary: Legacy summary');
    expect(normalized).toContain('tool: true');
    expect(normalized).toContain('Inline canonical body');
    expect(normalized).not.toMatch(/^(id|description|content|body|status|unknownIndexField):/m);
    expect(planKnowledgeNormalization(f.root, 'knowhow').actions).toEqual([]);
  });

  it('rebuilds Spec attributes from the canonical allowlist while dual-reading aliases', () => {
    const f = fixture();
    writeFileSync(f.spec, `---\ncategory: coding\n---\n\n<spec-entry specCategory="coding" tags="allowlist,legacy" date="2026-08-12" sid="S-allowlist" title="Allowlist migration" source="issue:12" codePaths="src/allowed.ts" appliesToRepoIds="${f.repoId}" confidence="high" repoAlias="library" repositoryPath="../linked" unknownIndexField="blessed-before">\n\nAllow only canonical attributes.\n\n</spec-entry>\n`, 'utf8');
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    writeKnowledgeNormalizationReport(reportPath, planKnowledgeNormalization(f.root, 'spec'));
    expect(applyKnowledgeNormalization(f.root, reportPath).applied).toBe(1);

    const normalized = readFileSync(f.spec, 'utf8');
    expect(normalized).toContain('category="coding"');
    expect(normalized).toContain('keywords="allowlist,legacy"');
    expect(normalized).toContain('sourceRef="issue:12"');
    expect(normalized).toContain('relatedPaths="src/allowed.ts"');
    expect(normalized).toContain('confidence="high"');
    expect(normalized).not.toMatch(/\s(specCategory|tags|source|codePaths|repoAlias|repositoryPath|unknownIndexField)=/);
    expect(planKnowledgeNormalization(f.root, 'spec').actions).toEqual([]);
  });

  it('blocks repository aliases and paths in appliesToRepoIds without mutation', () => {
    const f = fixture();
    writeFileSync(f.spec, `---\ncategory: coding\n---\n\n<spec-entry category="coding" keywords="scope" date="2026-08-12" appliesToRepoIds="library,../other-repo">\n\nInvalid Spec scope.\n\n</spec-entry>\n`, 'utf8');
    writeFileSync(f.knowhow, `---\ntitle: Invalid scope\ntype: tip\ncategory: coding\nappliesToRepoIds:\n  - ${f.repoId}\n  - ../other-repo\n---\n\nInvalid Knowhow scope.\n`, 'utf8');
    const beforeSpec = readFileSync(f.spec, 'utf8');
    const beforeKnowhow = readFileSync(f.knowhow, 'utf8');
    const report = planKnowledgeNormalization(f.root);
    const blocked = report.actions.flatMap(action => action.blocked);
    expect(blocked).toEqual(expect.arrayContaining([
      'appliesToRepoIds must contain exact persisted repository IDs: library',
      'appliesToRepoIds must contain exact persisted repository IDs: ../other-repo',
    ]));
    const reportPath = join(f.root, '.workflow', 'knowledge-normalize.json');
    writeKnowledgeNormalizationReport(reportPath, report);
    expect(applyKnowledgeNormalization(f.root, reportPath).applied).toBe(0);
    expect(readFileSync(f.spec, 'utf8')).toBe(beforeSpec);
    expect(readFileSync(f.knowhow, 'utf8')).toBe(beforeKnowhow);
  });

  it('keeps free categories unresolved rather than guessing a canonical category', () => {
    const f = fixture();
    writeFileSync(f.knowhow, `---\ntitle: Free category\ntype: tip\ncategory: payments\n---\n\nChoose category manually.\n`, 'utf8');
    const report = planKnowledgeNormalization(f.root, 'knowhow');
    expect(report.actions[0].blocked).toContain('legacy-free-category-requires-canonical-category');
    expect(report.unresolved[0]).toMatchObject({ file: '.workflow/knowhow/TIP-20260801-legacy.md', normalizable: false });
  });
});
