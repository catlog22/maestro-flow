/**
 * Spec Init
 *
 * Initialize .workflow/specs/ directory with frontmatter-enabled seed documents.
 * Idempotent: skips existing files, only creates missing ones.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface InitResult {
  created: string[];
  skipped: string[];
  directories: string[];
}

interface SeedDoc {
  filename: string;
  frontmatter: {
    title: string;
    readMode: string;
    priority: string;
    category: string;
    keywords: string[];
  };
  body: string;
}

// ============================================================================
// Seed Documents
// ============================================================================

const SEED_DOCS: SeedDoc[] = [
  {
    filename: 'coding-conventions.md',
    frontmatter: {
      title: 'Coding Conventions',
      readMode: 'required',
      priority: 'high',
      category: 'coding',
      keywords: ['style', 'naming', 'import', 'pattern', 'convention', 'formatting'],
    },
    body: `# Coding Conventions

## Formatting

## Naming

## Imports

## Patterns

## Entries

`,
  },
  {
    filename: 'architecture-constraints.md',
    frontmatter: {
      title: 'Architecture Constraints',
      readMode: 'required',
      priority: 'high',
      category: 'arch',
      keywords: ['architecture', 'module', 'layer', 'boundary', 'dependency', 'structure'],
    },
    body: `# Architecture Constraints

## Module Structure

## Layer Boundaries

## Dependency Rules

## Technology Constraints

## Entries

`,
  },
  {
    filename: 'learnings.md',
    frontmatter: {
      title: 'Learnings',
      readMode: 'optional',
      priority: 'medium',
      category: 'learning',
      keywords: ['bug', 'lesson', 'gotcha', 'learning'],
    },
    body: `# Learnings

## Entries

`,
  },
  {
    filename: 'quality-rules.md',
    frontmatter: {
      title: 'Quality Rules',
      readMode: 'required',
      priority: 'medium',
      category: 'quality',
      keywords: ['quality', 'lint', 'rule', 'enforcement'],
    },
    body: `# Quality Rules

## Entries

`,
  },
  {
    filename: 'debug-notes.md',
    frontmatter: {
      title: 'Debug Notes',
      readMode: 'optional',
      priority: 'medium',
      category: 'debug',
      keywords: ['debug', 'issue', 'workaround', 'root-cause', 'gotcha'],
    },
    body: `# Debug Notes

## Entries

`,
  },
  {
    filename: 'test-conventions.md',
    frontmatter: {
      title: 'Test Conventions',
      readMode: 'required',
      priority: 'high',
      category: 'test',
      keywords: ['test', 'coverage', 'mock', 'fixture', 'assertion', 'framework'],
    },
    body: `# Test Conventions

## Framework

## Directory Structure

## Naming Conventions

## Patterns

## Entries

`,
  },
  {
    filename: 'review-standards.md',
    frontmatter: {
      title: 'Review Standards',
      readMode: 'required',
      priority: 'medium',
      category: 'review',
      keywords: ['review', 'checklist', 'gate', 'approval', 'standard'],
    },
    body: `# Review Standards

## Entries

`,
  },
];

// ============================================================================
// Helpers
// ============================================================================

function formatFrontmatter(fm: SeedDoc['frontmatter']): string {
  const keywordsYaml = fm.keywords.map(k => `  - ${k}`).join('\n');
  return [
    '---',
    `title: "${fm.title}"`,
    `readMode: ${fm.readMode}`,
    `priority: ${fm.priority}`,
    `category: ${fm.category}`,
    'keywords:',
    keywordsYaml,
    '---',
  ].join('\n');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the spec system directory structure and seed documents.
 * Idempotent: creates directories if missing, writes seed files only when absent.
 */
export function initSpecSystem(projectPath: string): InitResult {
  const result: InitResult = { created: [], skipped: [], directories: [] };

  const specsDir = join(projectPath, '.workflow', 'specs');

  // Create directory
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
    result.directories.push(specsDir);
  }

  // Write seed documents
  for (const doc of SEED_DOCS) {
    const filePath = join(specsDir, doc.filename);

    if (existsSync(filePath)) {
      result.skipped.push(filePath);
      continue;
    }

    const content = formatFrontmatter(doc.frontmatter) + '\n\n' + doc.body;
    writeFileSync(filePath, content, 'utf-8');
    result.created.push(filePath);
  }

  return result;
}
