// ---------------------------------------------------------------------------
// Route Configuration — version-aware inventory with v1/v2 support
// ---------------------------------------------------------------------------

import inventoryV1Json from '../data/inventory.json';
import inventoryV2Json from '../data/inventory-v2.json';
import type { DocVersion } from '../version/index.js';

// Type definitions
export interface Category {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

export interface Command {
  name: string;
  file: string;
  category: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  deprecated?: boolean;
  subcommands?: string[];
}

export interface Skill {
  name: string;
  path: string;
  category: string;
  description: string;
  roles?: string[];
  phases?: string[];
}

export interface InventoryData {
  categories: Category[];
  commands: Command[];
  claude_skills: Skill[];
  codex_skills: Skill[];
}

const v1Data = inventoryV1Json as InventoryData;
const v2Base = inventoryV2Json as InventoryData;

// v2 shares skills from v1 (skills haven't changed)
const v2Data: InventoryData = {
  ...v2Base,
  claude_skills: v1Data.claude_skills,
  codex_skills: v1Data.codex_skills,
};

// Default export (v1 for backward compat during static route generation)
export const inventory: InventoryData = v1Data;
export const inventoryData: InventoryData = v1Data;

// Version-aware accessor
export function getInventory(version: DocVersion): InventoryData {
  return version === 'v2' ? v2Data : v1Data;
}

// All commands across both versions (for static route generation)
export function getAllCommands(): Command[] {
  const seen = new Set<string>();
  const result: Command[] = [];
  for (const cmd of [...v1Data.commands, ...v2Data.commands]) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      result.push(cmd);
    }
  }
  return result;
}

// All categories across both versions
export function getAllCategories(): Category[] {
  const seen = new Set<string>();
  const result: Category[] = [];
  for (const cat of [...v1Data.categories, ...v2Data.categories]) {
    if (!seen.has(cat.id)) {
      seen.add(cat.id);
      result.push(cat);
    }
  }
  return result;
}

// Extract command slugs from names (e.g., "maestro-init" -> "init")
export const getCommandSlug = (commandName: string): string => {
  const parts = commandName.split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : commandName;
};

// Helper: Get category by ID
export const getCategoryById = (id: string): Category | undefined => {
  return getAllCategories().find((c) => c.id === id);
};

// Helper: Get commands by category (version-aware)
export const getCommandsByCategory = (categoryId: string, version?: DocVersion): Command[] => {
  const data = version ? getInventory(version) : v1Data;
  return data.commands.filter((c) => c.category === categoryId);
};

// Helper: Get skills by category
export const getSkillsByCategory = (categoryId: string): {
  claude: Skill[];
  codex: Skill[];
} => {
  return {
    claude: v1Data.claude_skills.filter((s) => s.category === categoryId),
    codex: v1Data.codex_skills.filter((s) => s.category === categoryId),
  };
};

// ---------------------------------------------------------------------------
// Search functionality — tokenized scoring with bilingual support
// ---------------------------------------------------------------------------

import commandsZhData from '../i18n/locales/commands-zh-CN.json';

const zhCommands = commandsZhData.commands as Record<string, {
  name_zh?: string;
  description_zh?: string;
  workflow_zh?: string;
  flags?: string[];
}>;
const zhSkills = (commandsZhData.skills || {}) as Record<string, {
  name_zh?: string;
  description_zh?: string;
}>;

export interface SearchResult {
  type: 'command' | 'claude_skill' | 'codex_skill';
  name: string;
  slug: string;
  category: string;
  description: string;
  descriptionZh?: string;
  score: number;
  matchedField?: string;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_/]+/)
    .filter((t) => t.length > 0);
}

function scoreMatch(tokens: string[], fields: Array<{ text: string; weight: number; field: string }>): { score: number; matchedField: string } {
  let totalScore = 0;
  let bestField = '';
  let bestFieldScore = 0;

  for (const { text, weight, field } of fields) {
    if (!text) continue;
    const lower = text.toLowerCase();
    let fieldScore = 0;

    for (const token of tokens) {
      if (lower === token) {
        fieldScore += 100 * weight;
      } else if (lower.startsWith(token)) {
        fieldScore += 60 * weight;
      } else if (lower.includes(token)) {
        fieldScore += 30 * weight;
      }
    }

    if (fieldScore > bestFieldScore) {
      bestFieldScore = fieldScore;
      bestField = field;
    }
    totalScore += fieldScore;
  }

  return { score: totalScore, matchedField: bestField };
}

export const searchInventory = (query: string, categoryFilter?: string, version?: DocVersion): SearchResult[] => {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const data = version ? getInventory(version) : v1Data;
  const results: SearchResult[] = [];

  data.commands.forEach((cmd) => {
    if (categoryFilter && cmd.category !== categoryFilter) return;
    const zh = zhCommands[cmd.name];
    const { score, matchedField } = scoreMatch(tokens, [
      { text: cmd.name, weight: 3, field: 'name' },
      { text: cmd.description, weight: 1, field: 'description' },
      { text: zh?.name_zh || '', weight: 2.5, field: 'name_zh' },
      { text: zh?.description_zh || '', weight: 1, field: 'description_zh' },
      { text: zh?.workflow_zh || '', weight: 0.5, field: 'workflow_zh' },
    ]);

    if (score > 0) {
      results.push({
        type: 'command',
        name: cmd.name,
        slug: getCommandSlug(cmd.name),
        category: cmd.category,
        description: cmd.description,
        descriptionZh: zh?.description_zh,
        score,
        matchedField,
      });
    }
  });

  data.claude_skills.forEach((skill) => {
    if (categoryFilter && skill.category !== categoryFilter) return;
    const zh = zhSkills[skill.name];
    const { score, matchedField } = scoreMatch(tokens, [
      { text: skill.name, weight: 3, field: 'name' },
      { text: skill.description, weight: 1, field: 'description' },
      { text: zh?.name_zh || '', weight: 2.5, field: 'name_zh' },
      { text: zh?.description_zh || '', weight: 1, field: 'description_zh' },
    ]);

    if (score > 0) {
      results.push({
        type: 'claude_skill',
        name: skill.name,
        slug: skill.name,
        category: skill.category,
        description: skill.description,
        descriptionZh: zh?.description_zh,
        score,
        matchedField,
      });
    }
  });

  data.codex_skills.forEach((skill) => {
    if (categoryFilter && skill.category !== categoryFilter) return;
    const { score, matchedField } = scoreMatch(tokens, [
      { text: skill.name, weight: 3, field: 'name' },
      { text: skill.description, weight: 1, field: 'description' },
    ]);

    if (score > 0) {
      results.push({
        type: 'codex_skill',
        name: skill.name,
        slug: skill.name,
        category: skill.category,
        description: skill.description,
        score,
        matchedField,
      });
    }
  });

  results.sort((a, b) => b.score - a.score);
  return results;
};
