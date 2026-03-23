// ---------------------------------------------------------------------------
// Requirement expansion prompts -- system prompt, user prompt builder, output schema
// ---------------------------------------------------------------------------

import type { OutputFormat } from '@anthropic-ai/claude-agent-sdk';

import type { ExpansionDepth, ExpandedRequirement } from '../../shared/requirement-types.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const REQUIREMENT_SYSTEM_PROMPT = `You are a requirements analyst for a software development workflow system.

## Role
You decompose user requirements into structured, actionable checklist items. Each item should be independently estimable and assignable. You produce ONLY valid JSON — no markdown, no explanation.

## Principles
- Break requirements down along natural boundaries (feature, module, layer)
- Each item must have a clear definition of done implied by its title + description
- Dependencies should be explicit — if item B needs item A done first, list A in deps
- Estimated effort should be realistic relative to the scope
- Priority reflects business value and risk, not just implementation order
- Types: "feature" for new capabilities, "task" for infrastructure/setup, "bug" for defects, "improvement" for enhancements
`;

// ---------------------------------------------------------------------------
// Depth-specific instructions
// ---------------------------------------------------------------------------

const DEPTH_INSTRUCTIONS: Record<ExpansionDepth, string> = {
  'high-level': [
    '## Depth: High-Level',
    'Produce 3-7 coarse-grained items. Each item represents a major feature area or epic.',
    'Focus on business capabilities, not implementation details.',
    'Estimated effort should be in t-shirt sizes: "small", "medium", "large", "xlarge".',
  ].join('\n'),

  'standard': [
    '## Depth: Standard',
    'Produce 5-15 items at a user-story level of granularity.',
    'Each item should be completable by a single developer in 1-3 days.',
    'Include both functional and non-functional items (testing, docs, config).',
    'Estimated effort: "small" (~hours), "medium" (~1 day), "large" (~2-3 days).',
  ].join('\n'),

  'atomic': [
    '## Depth: Atomic',
    'Produce 10-30 fine-grained, atomic tasks.',
    'Each item should be completable in under 4 hours by a single developer.',
    'Include specific file paths, function names, or API endpoints where relevant.',
    'Break down into implementation-level detail: create file, add function, write test, etc.',
    'Estimated effort: "tiny" (~30min), "small" (~1-2h), "medium" (~2-4h).',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

export function buildExpandPrompt(text: string, depth: ExpansionDepth): string {
  const lines = [
    '## User Requirement',
    text,
    '',
    DEPTH_INSTRUCTIONS[depth],
    '',
    '## Output',
    'Return a JSON object with these fields:',
    '- title: concise name for this requirement set',
    '- summary: 1-2 sentence overview',
    '- items: array of checklist items, each with:',
    '  - title: concise item title',
    '  - description: detailed description of what needs to be done',
    '  - type: "feature" | "task" | "bug" | "improvement"',
    '  - priority: "low" | "medium" | "high" | "urgent"',
    '  - dependencies: array of item ids this depends on (empty if none)',
    '  - estimated_effort: effort estimate appropriate for the depth level',
    '',
    'Return ONLY valid JSON. No markdown fences, no explanation.',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Refine prompt builder
// ---------------------------------------------------------------------------

export function buildRefinePrompt(requirement: ExpandedRequirement, feedback: string): string {
  const existingItems = requirement.items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    type: item.type,
    priority: item.priority,
    dependencies: item.dependencies,
    estimated_effort: item.estimated_effort,
  }));

  const lines = [
    '## Original Requirement',
    requirement.userInput,
    '',
    '## Current Expansion',
    `Title: ${requirement.title}`,
    `Summary: ${requirement.summary}`,
    `Depth: ${requirement.depth}`,
    '',
    '### Current Items',
    JSON.stringify(existingItems, null, 2),
    '',
    '## User Feedback',
    feedback,
    '',
    '## Instructions',
    'Apply the user feedback to modify the existing expansion.',
    'You may add, remove, reorder, or modify items.',
    'Preserve item IDs for items that are unchanged or only slightly modified.',
    'Use new sequential IDs (continuing from the highest existing number) for new items.',
    'Return the complete updated result in the same JSON format.',
    '',
    'Return ONLY valid JSON. No markdown fences, no explanation.',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Continue prompt builder (expand on top of a prior expansion)
// ---------------------------------------------------------------------------

export function buildContinuePrompt(
  text: string,
  depth: ExpansionDepth,
  previousRequirement: ExpandedRequirement,
): string {
  const prevItems = previousRequirement.items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    type: item.type,
    priority: item.priority,
    dependencies: item.dependencies,
    estimated_effort: item.estimated_effort,
  }));

  const lines = [
    '## Previous Expansion (context)',
    `Title: ${previousRequirement.title}`,
    `Summary: ${previousRequirement.summary}`,
    `Depth: ${previousRequirement.depth}`,
    `Original input: ${previousRequirement.userInput}`,
    '',
    '### Previous Items',
    JSON.stringify(prevItems, null, 2),
    '',
    '## New Requirement (continue planning)',
    text,
    '',
    DEPTH_INSTRUCTIONS[depth],
    '',
    '## Instructions',
    'The user wants to continue planning on top of the previous expansion.',
    'Use the previous expansion as context and foundation.',
    'You may reference, extend, or build upon the previous items.',
    'Produce a NEW expansion that incorporates both the previous work and the new requirement.',
    'Do NOT simply copy the previous items — merge, extend, or restructure as needed.',
    '',
    '## Output',
    'Return a JSON object with these fields:',
    '- title: concise name for this combined requirement set',
    '- summary: 1-2 sentence overview covering both previous and new scope',
    '- items: array of checklist items (merged/extended), each with:',
    '  - title, description, type, priority, dependencies, estimated_effort',
    '',
    'Return ONLY valid JSON. No markdown fences, no explanation.',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output schema for Agent SDK structured output
// ---------------------------------------------------------------------------

export const REQUIREMENT_OUTPUT_SCHEMA: OutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Concise name for this requirement set' },
      summary: { type: 'string', description: '1-2 sentence overview' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short unique id. Only present for existing items during refine.' },
            title: { type: 'string', description: 'Concise item title' },
            description: { type: 'string', description: 'Detailed description' },
            type: {
              type: 'string',
              enum: ['feature', 'task', 'bug', 'improvement'],
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
            },
            dependencies: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of items this depends on',
            },
            estimated_effort: {
              type: 'string',
              description: 'Effort estimate appropriate for the depth level',
            },
          },
          required: ['title', 'description', 'type', 'priority', 'dependencies', 'estimated_effort'],
        },
      },
    },
    required: ['title', 'summary', 'items'],
  },
};
