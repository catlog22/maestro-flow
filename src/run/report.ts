import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import {
  reportFrontmatterSchema,
  type Handoff,
  type ReportFrontmatter,
} from './schemas.js';

export function readReportFrontmatter(runDir: string): ReportFrontmatter {
  const path = join(runDir, 'report.md');
  if (!existsSync(path)) return reportFrontmatterSchema.parse({});
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return reportFrontmatterSchema.parse({});
  const parsed = YAML.parse(match[1]);
  return reportFrontmatterSchema.parse(parsed ?? {});
}

export function deriveHandoff(
  frontmatter: ReportFrontmatter,
  runId: string,
  command: string,
  artifactRefs: string[],
  evidenceRefs: string[],
): Handoff {
  return {
    schema_version: 'command-handoff/1.0',
    producer_run_id: runId,
    command,
    verdict: frontmatter.verdict,
    summary: frontmatter.summary,
    constraints: frontmatter.constraints,
    decisions: frontmatter.decisions,
    caveats: frontmatter.caveats,
    open_questions: frontmatter.open_questions,
    artifact_refs: artifactRefs,
    evidence_refs: evidenceRefs,
    next: frontmatter.next.map(item => ({
      command: item.command,
      reason: item.reason,
      required_artifact_refs: item.required,
    })),
    details: frontmatter.details,
  };
}

