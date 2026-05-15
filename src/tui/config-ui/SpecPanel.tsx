import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpecEntryBrief {
  title: string;
  keywords: string[];
}

interface SpecFileInfo {
  name: string;
  entries: number;
  size: number;
  /** Brief info for each <spec-entry> in the file */
  entryBriefs: SpecEntryBrief[];
}

interface ScopeInfo {
  scope: string;
  exists: boolean;
  files: SpecFileInfo[];
}

export interface SpecPanelProps {
  workDir: string;
  onBack?: () => void;
}

type PanelMode = 'view' | 'browse' | 'preview' | 'config';

/** Flat entry used by Browse mode — parsed from spec files. */
interface BrowseEntry {
  title: string;
  category: string;
  keywords: string[];
  content: string;
}

/** Result of evaluateSpecInjection for Preview mode. */
interface PreviewResult {
  inject: boolean;
  content?: string;
  categories?: string[];
  specCount?: number;
  budgetAction?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<string, string> = {
  project: 'Project',
  global: 'Global',
  team: 'Team',
};

const MODE_TABS: { key: string; mode: PanelMode; label: string }[] = [
  { key: 'v', mode: 'view', label: 'view' },
  { key: 'b', mode: 'browse', label: 'browse' },
  { key: 'p', mode: 'preview', label: 'preview' },
  { key: 'c', mode: 'config', label: 'config' },
];

/**
 * Agent types from AGENT_CATEGORY_MAP in spec-injector — kept as a static
 * list so the panel does not import the internal constant directly.
 */
const AGENT_TYPES = [
  'code-developer',
  'tdd-developer',
  'workflow-executor',
  'universal-executor',
  'test-fix-agent',
  'cli-lite-planning-agent',
  'action-planning-agent',
  'workflow-planner',
  'workflow-reviewer',
  'debug-explore-agent',
  'workflow-debugger',
  'general',
];

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SpecPanel({ workDir, onBack }: SpecPanelProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<PanelMode>('view');

  // Shared: scope data for View mode (loaded once)
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);

  useEffect(() => {
    loadScopeStatus();
  }, []);

  async function loadScopeStatus() {
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { resolveSpecDir } = await import('../../tools/spec-loader.js');
    const { parseSpecEntries } = await import('../../tools/spec-entry-parser.js');

    const result: ScopeInfo[] = [];
    for (const scope of ['project', 'global', 'team'] as const) {
      const dir = resolveSpecDir(workDir, scope);
      const exists = existsSync(dir);
      const files: SpecFileInfo[] = [];

      if (exists) {
        const mdFiles = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
        for (const file of mdFiles) {
          const content = readFileSync(join(dir, file), 'utf-8');
          const parsed = parseSpecEntries(content);
          const entryBriefs: SpecEntryBrief[] = parsed.entries.map(e => ({
            title: e.title || '(untitled)',
            keywords: e.keywords,
          }));
          files.push({ name: file, entries: entryBriefs.length, size: content.length, entryBriefs });
        }
      }

      result.push({ scope, exists, files });
    }
    setScopes(result);
  }

  // Mode switching input — only at top level (sub-components handle their own)
  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (onBack) onBack();
      else exit();
      return;
    }
    for (const tab of MODE_TABS) {
      if (input === tab.key) {
        setMode(tab.mode);
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">SPEC SYSTEM</Text>
        <Text> </Text>

        {/* Mode tabs */}
        <Box gap={1}>
          {MODE_TABS.map(tab => (
            <Box key={tab.mode}>
              {mode === tab.mode
                ? <Text bold inverse color="cyan">{` [${tab.key}]${tab.label} `}</Text>
                : <Text dimColor>{` [${tab.key}]${tab.label} `}</Text>
              }
            </Box>
          ))}
        </Box>
        <Text> </Text>

        {/* Mode content */}
        {mode === 'view' && <ViewMode scopes={scopes} />}
        {mode === 'browse' && <BrowseMode workDir={workDir} />}
        {mode === 'preview' && <PreviewMode workDir={workDir} />}
        {mode === 'config' && <ConfigMode workDir={workDir} />}

        <Text> </Text>
        <Text dimColor>  [v/b/p/c] mode  [q] back</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// View mode (existing behavior)
// ---------------------------------------------------------------------------

function ViewMode({ scopes }: { scopes: ScopeInfo[] }) {
  const [activeScope, setActiveScope] = useState(0);
  const [cursor, setCursor] = useState(0);

  const currentScope = scopes[activeScope];
  const fileCount = currentScope?.files.length ?? 0;

  useInput((input, key) => {
    if (key.leftArrow) {
      setActiveScope(s => Math.max(0, s - 1));
      setCursor(0);
    }
    if (key.rightArrow) {
      setActiveScope(s => Math.min(scopes.length - 1, s + 1));
      setCursor(0);
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(fileCount - 1, c + 1));
  });

  if (scopes.length === 0) {
    return <Text dimColor>Loading spec status...</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* Scope tabs */}
      <Box gap={1}>
        {scopes.map((s, i) => (
          <Box key={s.scope} paddingX={1}>
            {i === activeScope
              ? <Text bold inverse color="cyan">{` ${SCOPE_LABELS[s.scope]} `}</Text>
              : <Text dimColor>{` ${SCOPE_LABELS[s.scope]} `}</Text>
            }
          </Box>
        ))}
      </Box>
      <Text> </Text>

      {!currentScope.exists ? (
        <Box flexDirection="column">
          <Text color="red">  Directory not initialized</Text>
          <Text dimColor>  Run: maestro spec init --scope {currentScope.scope}</Text>
        </Box>
      ) : currentScope.files.length === 0 ? (
        <Text dimColor>  No spec files found</Text>
      ) : (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>{pad('', 2)}</Text>
            <Text dimColor bold>{pad('File', 30)}</Text>
            <Text dimColor bold>{pad('Entries', 10)}</Text>
            <Text dimColor bold>Size</Text>
          </Box>
          {currentScope.files.map((f, i) => {
            const isCurrent = i === cursor;
            const hasEntries = f.entries > 0;
            return (
              <Box key={f.name} gap={1}>
                <Text color="cyan">{isCurrent ? '>' : ' '}</Text>
                <Text color={hasEntries ? 'green' : 'yellow'}>{hasEntries ? '+' : 'o'}</Text>
                <Text bold={isCurrent}>{pad(f.name, 29)}</Text>
                <Text dimColor={!isCurrent}>{pad(String(f.entries), 10)}</Text>
                <Text dimColor>{formatSize(f.size)}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Entry briefs for selected file */}
      {currentScope?.files[cursor]?.entryBriefs.length > 0 && (
        <>
          <Text> </Text>
          <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
            <Text bold dimColor>Entries in {currentScope.files[cursor].name}:</Text>
            {currentScope.files[cursor].entryBriefs.map((e, i) => (
              <Box key={`${e.title}-${i}`} gap={1}>
                <Text color="green">*</Text>
                <Text>{truncate(e.title, 30)}</Text>
                <Text dimColor color="yellow">[{truncate(e.keywords.join(', '), 40)}]</Text>
              </Box>
            ))}
          </Box>
        </>
      )}

      <Text> </Text>
      <Text dimColor>  {'\u2190'}/{'\u2192'} scope  {'\u2191'}/{'\u2193'} navigate</Text>
      <Text dimColor>  CLI: maestro spec {'<'}init|load|add|list|status{'>'}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Browse mode — keyword-granularity content viewer
// ---------------------------------------------------------------------------

function BrowseMode({ workDir }: { workDir: string }) {
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntries();
  }, []);

  async function loadEntries() {
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { resolveSpecDir } = await import('../../tools/spec-loader.js');
    const { parseSpecEntries } = await import('../../tools/spec-entry-parser.js');
    const { CATEGORY_MAP } = await import('../../tools/spec-loader.js');

    const allEntries: BrowseEntry[] = [];

    for (const scope of ['project', 'global', 'team'] as const) {
      const dir = resolveSpecDir(workDir, scope);
      if (!existsSync(dir)) continue;

      let files: string[];
      try {
        files = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
      } catch {
        continue;
      }

      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8');
        const parsed = parseSpecEntries(content);

        // Derive category from CATEGORY_MAP or filename
        const fileCategory = CATEGORY_MAP[file] ?? file.replace('.md', '');

        for (const entry of parsed.entries) {
          allEntries.push({
            title: entry.title || '(untitled)',
            category: entry.category || fileCategory,
            keywords: entry.keywords,
            content: entry.content,
          });
        }
      }
    }

    setEntries(allEntries);
    setLoading(false);
  }

  // Filter entries by keyword text
  const filtered = filterText
    ? entries.filter(e =>
        e.keywords.some(kw => kw.toLowerCase().includes(filterText.toLowerCase())),
      )
    : entries;

  useInput((input, key) => {
    // Filter mode: capture text
    if (filterMode) {
      if (key.escape || key.return) {
        setFilterMode(false);
        setCursor(0);
        return;
      }
      if (key.backspace || key.delete) {
        setFilterText(t => t.slice(0, -1));
        setCursor(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilterText(t => t + input);
        setCursor(0);
        return;
      }
      return;
    }

    // Normal mode
    if (input === '/') {
      setFilterMode(true);
      setFilterText('');
      return;
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(filtered.length - 1, c + 1));
  });

  if (loading) {
    return <Text dimColor>Loading spec entries...</Text>;
  }

  if (entries.length === 0) {
    return <Text dimColor>No spec entries found across any scope.</Text>;
  }

  const selected = filtered[cursor];

  // Determine visible window for scrolling
  const MAX_VISIBLE = 12;
  const windowStart = Math.max(0, cursor - Math.floor(MAX_VISIBLE / 2));
  const visibleEntries = filtered.slice(windowStart, windowStart + MAX_VISIBLE);
  const visibleOffset = windowStart;

  return (
    <Box flexDirection="column">
      {/* Filter bar */}
      <Box gap={1}>
        <Text dimColor>Filter:</Text>
        {filterMode ? (
          <Text color="yellow">/{filterText}<Text inverse> </Text></Text>
        ) : filterText ? (
          <Text color="green">/{filterText}</Text>
        ) : (
          <Text dimColor>(press / to filter by keyword)</Text>
        )}
        <Text dimColor>  [{filtered.length}/{entries.length}]</Text>
      </Box>
      <Text> </Text>

      {/* Entry list */}
      <Box flexDirection="column">
        <Box gap={1}>
          <Text dimColor>{pad('', 2)}</Text>
          <Text dimColor bold>{pad('Title', 30)}</Text>
          <Text dimColor bold>{pad('Category', 12)}</Text>
          <Text dimColor bold>Keywords</Text>
        </Box>
        {visibleEntries.map((e, i) => {
          const realIdx = visibleOffset + i;
          const isCurrent = realIdx === cursor;
          return (
            <Box key={`${e.category}-${e.title}-${realIdx}`} gap={1}>
              <Text color="cyan">{isCurrent ? '>' : ' '}</Text>
              <Text color="green">*</Text>
              <Text bold={isCurrent}>{pad(truncate(e.title, 28), 29)}</Text>
              <Text dimColor={!isCurrent} color="yellow">{pad(e.category, 12)}</Text>
              <Text dimColor>{truncate(e.keywords.join(', '), 40)}</Text>
            </Box>
          );
        })}
        {filtered.length > MAX_VISIBLE && (
          <Text dimColor>  ... {filtered.length - MAX_VISIBLE} more (scroll with arrows)</Text>
        )}
      </Box>

      {/* Content preview */}
      {selected && (
        <>
          <Text> </Text>
          <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
            <Text bold color="cyan">{selected.title}</Text>
            <Text dimColor>[{selected.category}] {selected.keywords.join(', ')}</Text>
            <Text> </Text>
            <Text>{truncate(selected.content.replace(/^###\s+.+\n*/m, '').trim(), 300)}</Text>
          </Box>
        </>
      )}

      <Text> </Text>
      <Text dimColor>  {'\u2191'}/{'\u2193'} navigate  [/] filter  [esc] clear filter</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Preview mode — injection preview for agent types
// ---------------------------------------------------------------------------

function PreviewMode({ workDir }: { workDir: string }) {
  const [agentIdx, setAgentIdx] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  const agentType = AGENT_TYPES[agentIdx];

  useEffect(() => {
    runPreview();
  }, [agentIdx]);

  async function runPreview() {
    setLoading(true);
    try {
      const { evaluateSpecInjection } = await import('../../hooks/spec-injector.js');
      const { loadSpecInjectionConfig } = await import('../../config/index.js');

      const config = loadSpecInjectionConfig(workDir);
      const res = evaluateSpecInjection(agentType, workDir, undefined, config);
      setResult(res);
    } catch {
      setResult({ inject: false });
    }
    setLoading(false);
  }

  useInput((_input, key) => {
    if (key.leftArrow) {
      setAgentIdx(i => (i > 0 ? i - 1 : AGENT_TYPES.length - 1));
    }
    if (key.rightArrow) {
      setAgentIdx(i => (i < AGENT_TYPES.length - 1 ? i + 1 : 0));
    }
  });

  return (
    <Box flexDirection="column">
      {/* Agent type selector */}
      <Box gap={1}>
        <Text dimColor>{'\u2190'}</Text>
        <Text bold inverse color="cyan">{` ${agentType} `}</Text>
        <Text dimColor>{'\u2192'}</Text>
        <Text dimColor>  ({agentIdx + 1}/{AGENT_TYPES.length})</Text>
      </Box>
      <Text> </Text>

      {loading ? (
        <Text dimColor>Evaluating injection...</Text>
      ) : result ? (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>Inject:</Text>
            {result.inject
              ? <Text bold color="green">yes</Text>
              : <Text bold color="red">no</Text>
            }
          </Box>

          {result.inject && (
            <>
              <Box gap={1}>
                <Text dimColor>Categories:</Text>
                <Text color="yellow">{result.categories?.join(', ') ?? '-'}</Text>
              </Box>
              <Box gap={1}>
                <Text dimColor>Matched entries:</Text>
                <Text>{result.specCount ?? 0}</Text>
              </Box>
              <Box gap={1}>
                <Text dimColor>Content size:</Text>
                <Text>{formatSize(result.content?.length ?? 0)}</Text>
              </Box>
              {result.budgetAction && (
                <Box gap={1}>
                  <Text dimColor>Budget action:</Text>
                  <Text color={result.budgetAction === 'skip' ? 'red' : 'yellow'}>
                    {result.budgetAction}
                  </Text>
                </Box>
              )}
            </>
          )}

          {result.inject && result.content && (
            <>
              <Text> </Text>
              <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
                <Text bold dimColor>Content preview (first 500 chars):</Text>
                <Text>{truncate(result.content, 500)}</Text>
              </Box>
            </>
          )}
        </Box>
      ) : (
        <Text dimColor>No result.</Text>
      )}

      <Text> </Text>
      <Text dimColor>  {'\u2190'}/{'\u2192'} select agent type</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Config mode — interactive spec injection config editor
// ---------------------------------------------------------------------------

const ALL_CATEGORIES = ['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui'] as const;

type ConfigSection = 'agents' | 'catdocs' | 'always' | 'filters' | 'preview';

const CONFIG_SECTIONS: { key: string; id: ConfigSection; label: string }[] = [
  { key: '1', id: 'agents', label: 'Agent Mappings' },
  { key: '2', id: 'catdocs', label: 'Category Docs' },
  { key: '3', id: 'always', label: 'Always Inject' },
  { key: '4', id: 'filters', label: 'Global Filters' },
  { key: '5', id: 'preview', label: 'Preview' },
];

interface SpecInjectionConfig {
  mapping?: Record<string, AgentSpecMapping>;
  categoryDocs?: Record<string, CategoryDocConfig>;
  always?: AlwaysInjectConfig;
  keywordFilters?: KeywordFilterConfig;
  maxContentLength?: number;
}

interface AgentSpecMapping {
  categories: string[];
  extras?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
}

interface CategoryDocConfig {
  specFiles?: string[];
  docs?: string[];
}

interface AlwaysInjectConfig {
  docs?: string[];
  keywords?: string[];
  categories?: string[];
}

interface KeywordFilterConfig {
  include?: string[];
  exclude?: string[];
}

function ConfigMode({ workDir }: { workDir: string }) {
  const [config, setConfig] = useState<SpecInjectionConfig>({});
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<ConfigSection>('agents');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const { loadSpecInjectionConfig } = await import('../../config/index.js');
      const c = loadSpecInjectionConfig(workDir);
      setConfig(c);
    } catch {
      setConfig({});
    }
    setLoading(false);
  }

  async function persistConfig(next: SpecInjectionConfig) {
    setConfig(next);
    try {
      const { saveSpecInjectionConfig } = await import('../../config/index.js');
      saveSpecInjectionConfig(workDir, next as any);
      setStatusMsg('Saved');
    } catch {
      setStatusMsg('Save failed');
    }
    setTimeout(() => setStatusMsg(''), 2000);
  }

  if (loading) {
    return <Text dimColor>Loading config...</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* Section nav */}
      <Box gap={1}>
        {CONFIG_SECTIONS.map(s => (
          <Box key={s.id}>
            {section === s.id
              ? <Text bold inverse color="cyan">{` [${s.key}]${s.label} `}</Text>
              : <Text dimColor>{` [${s.key}]${s.label} `}</Text>
            }
          </Box>
        ))}
      </Box>
      <Text> </Text>

      {/* Section content */}
      {section === 'agents' && (
        <AgentMappingsSection config={config} onChange={persistConfig} onStatus={setStatusMsg} />
      )}
      {section === 'catdocs' && (
        <CategoryDocsSection config={config} onChange={persistConfig} onStatus={setStatusMsg} />
      )}
      {section === 'always' && (
        <AlwaysInjectSection config={config} onChange={persistConfig} onStatus={setStatusMsg} />
      )}
      {section === 'filters' && (
        <GlobalFiltersSection config={config} onChange={persistConfig} onStatus={setStatusMsg} />
      )}
      {section === 'preview' && (
        <ConfigPreviewSection workDir={workDir} config={config} />
      )}

      <Text> </Text>
      <Box gap={1}>
        <Text dimColor>  [1-5] section</Text>
        {statusMsg ? <Text color="green"> | {statusMsg}</Text> : null}
      </Box>

      {/* Section switching input */}
      <ConfigSectionSwitcher section={section} onSwitch={setSection} />
    </Box>
  );
}

/** Invisible component that handles 1-5 section switching at ConfigMode level. */
function ConfigSectionSwitcher({
  section: _section,
  onSwitch,
}: {
  section: ConfigSection;
  onSwitch: (s: ConfigSection) => void;
}) {
  useInput((input, _key) => {
    for (const s of CONFIG_SECTIONS) {
      if (input === s.key) {
        onSwitch(s.id);
        return;
      }
    }
  });
  return null;
}

// ---------------------------------------------------------------------------
// Section 1: Agent Mappings
// ---------------------------------------------------------------------------

function AgentMappingsSection({
  config,
  onChange,
  onStatus,
}: {
  config: SpecInjectionConfig;
  onChange: (c: SpecInjectionConfig) => void;
  onStatus: (msg: string) => void;
}) {
  const mapping = config.mapping ?? {};
  const agentNames = Object.keys(mapping);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [subCursor, setSubCursor] = useState(0);
  const [inputMode, setInputMode] = useState<'none' | 'add-agent' | 'add-include' | 'add-exclude' | 'add-extra'>('none');
  const [inputBuf, setInputBuf] = useState('');
  // For add-agent: pick from AGENT_TYPES list
  const [addAgentCursor, setAddAgentCursor] = useState(0);

  // Sub-editor rows for expanded agent
  function getSubRows(name: string): string[] {
    const m = mapping[name];
    if (!m) return [];
    const rows: string[] = [];
    // Category toggles header
    rows.push('__categories__');
    // Include keywords
    const incl = m.includeKeywords ?? [];
    rows.push('__include_header__');
    for (const kw of incl) rows.push(`inc:${kw}`);
    rows.push('__include_add__');
    // Exclude keywords
    const excl = m.excludeKeywords ?? [];
    rows.push('__exclude_header__');
    for (const kw of excl) rows.push(`exc:${kw}`);
    rows.push('__exclude_add__');
    // Extras
    const extras = m.extras ?? [];
    rows.push('__extras_header__');
    for (const p of extras) rows.push(`ext:${p}`);
    rows.push('__extras_add__');
    return rows;
  }

  useInput((input, key) => {
    // --- Add agent mode: pick from AGENT_TYPES ---
    if (inputMode === 'add-agent') {
      const available = AGENT_TYPES.filter(a => !mapping[a]);
      if (key.escape) { setInputMode('none'); return; }
      if (key.upArrow) { setAddAgentCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setAddAgentCursor(c => Math.min(available.length - 1, c + 1)); return; }
      if (key.return && available.length > 0) {
        const chosen = available[addAgentCursor];
        const next = { ...config, mapping: { ...mapping, [chosen]: { categories: [] } } };
        onChange(next);
        onStatus(`Added ${chosen}`);
        setInputMode('none');
      }
      return;
    }

    // --- Text input modes ---
    if (inputMode === 'add-include' || inputMode === 'add-exclude' || inputMode === 'add-extra') {
      if (key.escape) { setInputMode('none'); setInputBuf(''); return; }
      if (key.return && inputBuf.trim() && expanded) {
        const m = { ...(mapping[expanded] ?? { categories: [] }) };
        if (inputMode === 'add-include') {
          m.includeKeywords = [...(m.includeKeywords ?? []), inputBuf.trim()];
        } else if (inputMode === 'add-exclude') {
          m.excludeKeywords = [...(m.excludeKeywords ?? []), inputBuf.trim()];
        } else {
          m.extras = [...(m.extras ?? []), inputBuf.trim()];
        }
        onChange({ ...config, mapping: { ...mapping, [expanded]: m } });
        setInputBuf('');
        setInputMode('none');
        return;
      }
      if (key.backspace || key.delete) { setInputBuf(b => b.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setInputBuf(b => b + input); return; }
      return;
    }

    // --- Expanded sub-editor ---
    if (expanded) {
      const rows = getSubRows(expanded);
      if (key.escape) { setExpanded(null); setSubCursor(0); return; }
      if (key.upArrow) { setSubCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setSubCursor(c => Math.min(rows.length - 1, c + 1)); return; }

      const currentRow = rows[subCursor];
      // Toggle category
      if (currentRow === '__categories__' && input === ' ') {
        // Noop on header; actual toggling not here
      }
      // Space on categories row: open a toggle cycle through categories
      if (currentRow === '__categories__') {
        if (key.return) {
          // Not used here; categories shown inline
        }
      }

      // Handle [+] add rows
      if (key.return) {
        if (currentRow === '__include_add__') { setInputMode('add-include'); setInputBuf(''); return; }
        if (currentRow === '__exclude_add__') { setInputMode('add-exclude'); setInputBuf(''); return; }
        if (currentRow === '__extras_add__') { setInputMode('add-extra'); setInputBuf(''); return; }
      }

      // Space toggles on categories row
      if (currentRow === '__categories__' && input) {
        const catIdx = parseInt(input, 10);
        if (catIdx >= 1 && catIdx <= ALL_CATEGORIES.length) {
          const cat = ALL_CATEGORIES[catIdx - 1];
          const m = { ...(mapping[expanded] ?? { categories: [] }) };
          const cats = [...m.categories];
          const idx = cats.indexOf(cat);
          if (idx >= 0) cats.splice(idx, 1);
          else cats.push(cat);
          m.categories = cats;
          onChange({ ...config, mapping: { ...mapping, [expanded]: m } });
          return;
        }
      }

      // [d] delete on keyword/extra items
      if (input === 'd') {
        if (currentRow?.startsWith('inc:')) {
          const kw = currentRow.slice(4);
          const m = { ...(mapping[expanded] ?? { categories: [] }) };
          m.includeKeywords = (m.includeKeywords ?? []).filter(k => k !== kw);
          onChange({ ...config, mapping: { ...mapping, [expanded]: m } });
          setSubCursor(c => Math.max(0, c - 1));
          return;
        }
        if (currentRow?.startsWith('exc:')) {
          const kw = currentRow.slice(4);
          const m = { ...(mapping[expanded] ?? { categories: [] }) };
          m.excludeKeywords = (m.excludeKeywords ?? []).filter(k => k !== kw);
          onChange({ ...config, mapping: { ...mapping, [expanded]: m } });
          setSubCursor(c => Math.max(0, c - 1));
          return;
        }
        if (currentRow?.startsWith('ext:')) {
          const p = currentRow.slice(4);
          const m = { ...(mapping[expanded] ?? { categories: [] }) };
          m.extras = (m.extras ?? []).filter(e => e !== p);
          onChange({ ...config, mapping: { ...mapping, [expanded]: m } });
          setSubCursor(c => Math.max(0, c - 1));
          return;
        }
      }
      return;
    }

    // --- Top-level agent list ---
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor(c => Math.min(agentNames.length - 1, c + 1)); return; }
    if (key.return && agentNames[cursor]) {
      setExpanded(agentNames[cursor]);
      setSubCursor(0);
      return;
    }
    if (input === 'a') {
      setInputMode('add-agent');
      setAddAgentCursor(0);
      return;
    }
    if (input === 'd' && agentNames[cursor]) {
      const name = agentNames[cursor];
      const next = { ...mapping };
      delete next[name];
      onChange({ ...config, mapping: next });
      setCursor(c => Math.max(0, c - 1));
      onStatus(`Deleted ${name}`);
      return;
    }
  });

  // --- Add agent picker overlay ---
  if (inputMode === 'add-agent') {
    const available = AGENT_TYPES.filter(a => !mapping[a]);
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Select agent type to add:</Text>
        {available.length === 0 ? (
          <Text dimColor>All agent types already mapped.</Text>
        ) : (
          available.map((a, i) => (
            <Box key={a}>
              <Text color="cyan">{i === addAgentCursor ? '> ' : '  '}</Text>
              <Text bold={i === addAgentCursor}>{a}</Text>
            </Box>
          ))
        )}
        <Text> </Text>
        <Text dimColor>  Enter to select, Esc to cancel</Text>
      </Box>
    );
  }

  // --- Text input overlay ---
  if (inputMode === 'add-include' || inputMode === 'add-exclude' || inputMode === 'add-extra') {
    const label = inputMode === 'add-include' ? 'include keyword'
      : inputMode === 'add-exclude' ? 'exclude keyword'
      : 'extra doc path';
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color="cyan">Add {label}:</Text>
          <Text color="yellow">{inputBuf}<Text inverse> </Text></Text>
        </Box>
        <Text dimColor>  Enter to confirm, Esc to cancel</Text>
      </Box>
    );
  }

  // --- Expanded agent sub-editor ---
  if (expanded) {
    const m = mapping[expanded] ?? { categories: [] };
    const rows = getSubRows(expanded);
    const incl = m.includeKeywords ?? [];
    const excl = m.excludeKeywords ?? [];
    const extras = m.extras ?? [];

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{expanded}</Text>
        <Text> </Text>

        {rows.map((row, i) => {
          const isCur = i === subCursor;
          const prefix = isCur ? '> ' : '  ';

          if (row === '__categories__') {
            return (
              <Box key="cats" flexDirection="column">
                <Text bold={isCur}>{prefix}Categories (press 1-7 to toggle):</Text>
                <Box paddingLeft={4} gap={1} flexWrap="wrap">
                  {ALL_CATEGORIES.map((cat, ci) => {
                    const on = m.categories.includes(cat);
                    return (
                      <Text key={cat} color={on ? 'green' : 'gray'}>
                        {`[${on ? 'x' : ' '}]${ci + 1}:${cat}`}
                      </Text>
                    );
                  })}
                </Box>
              </Box>
            );
          }
          if (row === '__include_header__') {
            return <Text key="inh" dimColor>{prefix}Include keywords ({incl.length}):</Text>;
          }
          if (row === '__exclude_header__') {
            return <Text key="exh" dimColor>{prefix}Exclude keywords ({excl.length}):</Text>;
          }
          if (row === '__extras_header__') {
            return <Text key="exth" dimColor>{prefix}Extras ({extras.length}):</Text>;
          }
          if (row === '__include_add__' || row === '__exclude_add__' || row === '__extras_add__') {
            return <Text key={row} color={isCur ? 'yellow' : 'gray'}>{prefix}[+] add</Text>;
          }
          if (row.startsWith('inc:')) {
            return (
              <Box key={`i-${row}`}>
                <Text color="cyan">{prefix}</Text>
                <Text color="green" bold={isCur}>{row.slice(4)}</Text>
                {isCur && <Text dimColor> [d]del</Text>}
              </Box>
            );
          }
          if (row.startsWith('exc:')) {
            return (
              <Box key={`e-${row}`}>
                <Text color="cyan">{prefix}</Text>
                <Text color="red" bold={isCur}>{row.slice(4)}</Text>
                {isCur && <Text dimColor> [d]del</Text>}
              </Box>
            );
          }
          if (row.startsWith('ext:')) {
            return (
              <Box key={`x-${row}`}>
                <Text color="cyan">{prefix}</Text>
                <Text bold={isCur}>{row.slice(4)}</Text>
                {isCur && <Text dimColor> [d]del</Text>}
              </Box>
            );
          }
          return null;
        })}

        <Text> </Text>
        <Text dimColor>  Esc back | Enter expand | 1-7 toggle cat | d delete</Text>
      </Box>
    );
  }

  // --- Agent list ---
  return (
    <Box flexDirection="column">
      <Text bold>Agent Mappings</Text>
      <Text> </Text>

      {agentNames.length === 0 ? (
        <Text dimColor>No agent mappings configured. Press [a] to add.</Text>
      ) : (
        agentNames.map((name, i) => {
          const m = mapping[name];
          const isCur = i === cursor;
          return (
            <Box key={name} gap={1}>
              <Text color="cyan">{isCur ? '>' : ' '}</Text>
              <Text bold={isCur}>{pad(name, 25)}</Text>
              <Box gap={1}>
                {m.categories.map(c => (
                  <Text key={c} color="yellow">{c}</Text>
                ))}
              </Box>
              <Text dimColor>
                {` kw:${(m.includeKeywords?.length ?? 0) + (m.excludeKeywords?.length ?? 0)}`}
              </Text>
            </Box>
          );
        })
      )}

      <Text> </Text>
      <Text dimColor>  Enter expand | [a]dd | [d]el | Up/Down navigate</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 2: Category Docs
// ---------------------------------------------------------------------------

function CategoryDocsSection({
  config,
  onChange,
  onStatus,
}: {
  config: SpecInjectionConfig;
  onChange: (c: SpecInjectionConfig) => void;
  onStatus: (msg: string) => void;
}) {
  const catDocs = config.categoryDocs ?? {};
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [subCursor, setSubCursor] = useState(0);
  const [inputMode, setInputMode] = useState<'none' | 'add-spec' | 'add-doc'>('none');
  const [inputBuf, setInputBuf] = useState('');

  function getSubRows(cat: string): string[] {
    const cd = catDocs[cat];
    const rows: string[] = [];
    rows.push('__specs_header__');
    for (const f of cd?.specFiles ?? []) rows.push(`spec:${f}`);
    rows.push('__specs_add__');
    rows.push('__docs_header__');
    for (const d of cd?.docs ?? []) rows.push(`doc:${d}`);
    rows.push('__docs_add__');
    return rows;
  }

  useInput((input, key) => {
    // Text input
    if (inputMode === 'add-spec' || inputMode === 'add-doc') {
      if (key.escape) { setInputMode('none'); setInputBuf(''); return; }
      if (key.return && inputBuf.trim() && expanded) {
        const cd = { ...(catDocs[expanded] ?? {}) };
        if (inputMode === 'add-spec') {
          cd.specFiles = [...(cd.specFiles ?? []), inputBuf.trim()];
        } else {
          cd.docs = [...(cd.docs ?? []), inputBuf.trim()];
        }
        onChange({ ...config, categoryDocs: { ...catDocs, [expanded]: cd } });
        setInputBuf('');
        setInputMode('none');
        return;
      }
      if (key.backspace || key.delete) { setInputBuf(b => b.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setInputBuf(b => b + input); return; }
      return;
    }

    // Expanded sub-editor
    if (expanded) {
      const rows = getSubRows(expanded);
      if (key.escape) { setExpanded(null); setSubCursor(0); return; }
      if (key.upArrow) { setSubCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setSubCursor(c => Math.min(rows.length - 1, c + 1)); return; }

      const currentRow = rows[subCursor];
      if (key.return) {
        if (currentRow === '__specs_add__') { setInputMode('add-spec'); setInputBuf(''); return; }
        if (currentRow === '__docs_add__') { setInputMode('add-doc'); setInputBuf(''); return; }
      }
      if (input === 'd') {
        if (currentRow?.startsWith('spec:')) {
          const f = currentRow.slice(5);
          const cd = { ...(catDocs[expanded] ?? {}) };
          cd.specFiles = (cd.specFiles ?? []).filter(s => s !== f);
          onChange({ ...config, categoryDocs: { ...catDocs, [expanded]: cd } });
          setSubCursor(c => Math.max(0, c - 1));
          return;
        }
        if (currentRow?.startsWith('doc:')) {
          const d = currentRow.slice(4);
          const cd = { ...(catDocs[expanded] ?? {}) };
          cd.docs = (cd.docs ?? []).filter(x => x !== d);
          onChange({ ...config, categoryDocs: { ...catDocs, [expanded]: cd } });
          setSubCursor(c => Math.max(0, c - 1));
          return;
        }
      }
      return;
    }

    // Top-level category list
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor(c => Math.min(ALL_CATEGORIES.length - 1, c + 1)); return; }
    if (key.return) {
      const cat = ALL_CATEGORIES[cursor];
      setExpanded(cat);
      setSubCursor(0);
      return;
    }
    if (input === 'd' && ALL_CATEGORIES[cursor]) {
      const cat = ALL_CATEGORIES[cursor];
      if (catDocs[cat]) {
        const next = { ...catDocs };
        delete next[cat];
        onChange({ ...config, categoryDocs: next });
        onStatus(`Cleared docs for ${cat}`);
      }
      return;
    }
  });

  // Text input overlay
  if (inputMode === 'add-spec' || inputMode === 'add-doc') {
    const label = inputMode === 'add-spec' ? 'spec file' : 'doc path';
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color="cyan">Add {label} to {expanded}:</Text>
          <Text color="yellow">{inputBuf}<Text inverse> </Text></Text>
        </Box>
        <Text dimColor>  Enter to confirm, Esc to cancel</Text>
      </Box>
    );
  }

  // Expanded sub-editor
  if (expanded) {
    const cd = catDocs[expanded] ?? {};
    const rows = getSubRows(expanded);
    const specs = cd.specFiles ?? [];
    const docs = cd.docs ?? [];

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{expanded}</Text>
        <Text> </Text>

        {rows.map((row, i) => {
          const isCur = i === subCursor;
          const prefix = isCur ? '> ' : '  ';

          if (row === '__specs_header__') {
            return <Text key="sh" dimColor>{prefix}Spec files ({specs.length}):</Text>;
          }
          if (row === '__docs_header__') {
            return <Text key="dh" dimColor>{prefix}Doc paths ({docs.length}):</Text>;
          }
          if (row === '__specs_add__' || row === '__docs_add__') {
            return <Text key={row} color={isCur ? 'yellow' : 'gray'}>{prefix}[+] add</Text>;
          }
          if (row.startsWith('spec:')) {
            return (
              <Box key={`s-${row}`}>
                <Text color="cyan">{prefix}</Text>
                <Text bold={isCur}>{row.slice(5)}</Text>
                {isCur && <Text dimColor> [d]del</Text>}
              </Box>
            );
          }
          if (row.startsWith('doc:')) {
            return (
              <Box key={`d-${row}`}>
                <Text color="cyan">{prefix}</Text>
                <Text bold={isCur}>{row.slice(4)}</Text>
                {isCur && <Text dimColor> [d]del</Text>}
              </Box>
            );
          }
          return null;
        })}

        <Text> </Text>
        <Text dimColor>  Esc back | Enter add | d delete</Text>
      </Box>
    );
  }

  // Category list
  return (
    <Box flexDirection="column">
      <Text bold>Category Docs</Text>
      <Text> </Text>

      {ALL_CATEGORIES.map((cat, i) => {
        const isCur = i === cursor;
        const cd = catDocs[cat];
        const hasData = cd && ((cd.specFiles?.length ?? 0) + (cd.docs?.length ?? 0) > 0);
        return (
          <Box key={cat} gap={1}>
            <Text color="cyan">{isCur ? '>' : ' '}</Text>
            <Text bold={isCur} color={hasData ? 'green' : undefined}>{pad(cat, 12)}</Text>
            {hasData ? (
              <Text dimColor>
                specs:{cd!.specFiles?.length ?? 0} docs:{cd!.docs?.length ?? 0}
              </Text>
            ) : (
              <Text dimColor>-</Text>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>  Enter expand | [d]el docs | Up/Down navigate</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 3: Always Inject
// ---------------------------------------------------------------------------

function AlwaysInjectSection({
  config,
  onChange,
  onStatus: _onStatus,
}: {
  config: SpecInjectionConfig;
  onChange: (c: SpecInjectionConfig) => void;
  onStatus: (msg: string) => void;
}) {
  const always = config.always ?? {};
  const TABS = ['docs', 'keywords', 'categories'] as const;
  type AlwaysTab = typeof TABS[number];
  const [tab, setTab] = useState<AlwaysTab>('docs');
  const [cursor, setCursor] = useState(0);
  const [inputMode, setInputMode] = useState(false);
  const [inputBuf, setInputBuf] = useState('');

  const currentList: string[] = always[tab] ?? [];

  useInput((input, key) => {
    if (inputMode) {
      if (key.escape) { setInputMode(false); setInputBuf(''); return; }
      if (key.return && inputBuf.trim()) {
        const updated = { ...always, [tab]: [...currentList, inputBuf.trim()] };
        onChange({ ...config, always: updated });
        setInputBuf('');
        setInputMode(false);
        return;
      }
      if (key.backspace || key.delete) { setInputBuf(b => b.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setInputBuf(b => b + input); return; }
      return;
    }

    if (input === '\t') {
      const idx = TABS.indexOf(tab);
      setTab(TABS[(idx + 1) % TABS.length]);
      setCursor(0);
      return;
    }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor(c => Math.min(currentList.length - 1, c + 1)); return; }
    if (input === 'a') { setInputMode(true); setInputBuf(''); return; }
    if (input === 'd' && currentList[cursor]) {
      const next = currentList.filter((_, i) => i !== cursor);
      const updated = { ...always, [tab]: next.length > 0 ? next : undefined };
      onChange({ ...config, always: updated });
      setCursor(c => Math.max(0, c - 1));
      return;
    }
  });

  if (inputMode) {
    const hint = tab === 'docs' ? 'doc path' : tab === 'keywords' ? 'keyword' : 'category';
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color="cyan">Add {hint}:</Text>
          <Text color="yellow">{inputBuf}<Text inverse> </Text></Text>
        </Box>
        <Text dimColor>  Enter to confirm, Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Always Inject (session start)</Text>
      <Text> </Text>

      {/* Tab switcher */}
      <Box gap={1}>
        {TABS.map(t => (
          <Box key={t}>
            {t === tab
              ? <Text bold inverse color="cyan">{` ${t} `}</Text>
              : <Text dimColor>{` ${t} `}</Text>
            }
          </Box>
        ))}
        <Text dimColor>(Tab to switch)</Text>
      </Box>
      <Text> </Text>

      {currentList.length === 0 ? (
        <Text dimColor>No {tab} configured. Press [a] to add.</Text>
      ) : (
        currentList.map((p, i) => {
          const isCur = i === cursor;
          const color = tab === 'keywords' ? 'green' : tab === 'categories' ? 'yellow' : undefined;
          return (
            <Box key={`${p}-${i}`} gap={1}>
              <Text color="cyan">{isCur ? '>' : ' '}</Text>
              <Text bold={isCur} color={color}>{p}</Text>
              {isCur && <Text dimColor> [d]del</Text>}
            </Box>
          );
        })
      )}

      <Text> </Text>
      <Text dimColor>  [a]dd | [d]el | Tab switch | Up/Down navigate</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 4: Global Filters
// ---------------------------------------------------------------------------

function GlobalFiltersSection({
  config,
  onChange,
  onStatus: _onStatus,
}: {
  config: SpecInjectionConfig;
  onChange: (c: SpecInjectionConfig) => void;
  onStatus: (msg: string) => void;
}) {
  const filters = config.keywordFilters ?? {};
  const includeKw = filters.include ?? [];
  const excludeKw = filters.exclude ?? [];
  const [activeList, setActiveList] = useState<'include' | 'exclude'>('include');
  const [cursor, setCursor] = useState(0);
  const [inputMode, setInputMode] = useState(false);
  const [inputBuf, setInputBuf] = useState('');

  const currentList = activeList === 'include' ? includeKw : excludeKw;

  useInput((input, key) => {
    if (inputMode) {
      if (key.escape) { setInputMode(false); setInputBuf(''); return; }
      if (key.return && inputBuf.trim()) {
        const f = { ...filters };
        if (activeList === 'include') {
          f.include = [...includeKw, inputBuf.trim()];
        } else {
          f.exclude = [...excludeKw, inputBuf.trim()];
        }
        onChange({ ...config, keywordFilters: f });
        setInputBuf('');
        setInputMode(false);
        return;
      }
      if (key.backspace || key.delete) { setInputBuf(b => b.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setInputBuf(b => b + input); return; }
      return;
    }

    if (key.tab) {
      setActiveList(l => l === 'include' ? 'exclude' : 'include');
      setCursor(0);
      return;
    }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor(c => Math.min(currentList.length - 1, c + 1)); return; }
    if (input === 'a') { setInputMode(true); setInputBuf(''); return; }
    if (input === 'd' && currentList[cursor]) {
      const f = { ...filters };
      if (activeList === 'include') {
        f.include = includeKw.filter((_, i) => i !== cursor);
      } else {
        f.exclude = excludeKw.filter((_, i) => i !== cursor);
      }
      onChange({ ...config, keywordFilters: f });
      setCursor(c => Math.max(0, c - 1));
      return;
    }
  });

  if (inputMode) {
    const label = activeList === 'include' ? 'include keyword' : 'exclude keyword';
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color="cyan">Add {label}:</Text>
          <Text color="yellow">{inputBuf}<Text inverse> </Text></Text>
        </Box>
        <Text dimColor>  Enter to confirm, Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Global Filters</Text>
      <Text> </Text>

      {/* Tab headers */}
      <Box gap={2}>
        <Text bold={activeList === 'include'} inverse={activeList === 'include'} color="green">
          {' Include '}
        </Text>
        <Text bold={activeList === 'exclude'} inverse={activeList === 'exclude'} color="red">
          {' Exclude '}
        </Text>
        <Text dimColor>(Tab to switch)</Text>
      </Box>
      <Text> </Text>

      {currentList.length === 0 ? (
        <Text dimColor>No {activeList} keywords. Press [a] to add.</Text>
      ) : (
        currentList.map((kw, i) => {
          const isCur = i === cursor;
          return (
            <Box key={`${kw}-${i}`} gap={1}>
              <Text color="cyan">{isCur ? '>' : ' '}</Text>
              <Text bold={isCur} color={activeList === 'include' ? 'green' : 'red'}>{kw}</Text>
              {isCur && <Text dimColor> [d]del</Text>}
            </Box>
          );
        })
      )}

      <Text> </Text>
      <Text dimColor>  Tab switch | [a]dd | [d]el | Up/Down navigate</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 5: Config Preview (reuses PreviewMode logic)
// ---------------------------------------------------------------------------

function ConfigPreviewSection({
  workDir,
  config,
}: {
  workDir: string;
  config: SpecInjectionConfig;
}) {
  const [agentIdx, setAgentIdx] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  const agentType = AGENT_TYPES[agentIdx];

  useEffect(() => {
    runPreview();
  }, [agentIdx, config]);

  async function runPreview() {
    setLoading(true);
    try {
      const { evaluateSpecInjection } = await import('../../hooks/spec-injector.js');
      const res = evaluateSpecInjection(agentType, workDir, undefined, config as any);
      setResult(res);
    } catch {
      setResult({ inject: false });
    }
    setLoading(false);
  }

  useInput((_input, key) => {
    if (key.leftArrow) {
      setAgentIdx(i => (i > 0 ? i - 1 : AGENT_TYPES.length - 1));
    }
    if (key.rightArrow) {
      setAgentIdx(i => (i < AGENT_TYPES.length - 1 ? i + 1 : 0));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Preview (live from current config)</Text>
      <Text> </Text>

      {/* Agent type selector */}
      <Box gap={1}>
        <Text dimColor>{'\u2190'}</Text>
        <Text bold inverse color="cyan">{` ${agentType} `}</Text>
        <Text dimColor>{'\u2192'}</Text>
        <Text dimColor>  ({agentIdx + 1}/{AGENT_TYPES.length})</Text>
      </Box>
      <Text> </Text>

      {loading ? (
        <Text dimColor>Evaluating injection...</Text>
      ) : result ? (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>Inject:</Text>
            {result.inject
              ? <Text bold color="green">yes</Text>
              : <Text bold color="red">no</Text>
            }
          </Box>

          {result.inject && (
            <>
              <Box gap={1}>
                <Text dimColor>Categories:</Text>
                <Text color="yellow">{result.categories?.join(', ') ?? '-'}</Text>
              </Box>
              <Box gap={1}>
                <Text dimColor>Matched entries:</Text>
                <Text>{result.specCount ?? 0}</Text>
              </Box>
              <Box gap={1}>
                <Text dimColor>Content size:</Text>
                <Text>{formatSize(result.content?.length ?? 0)}</Text>
              </Box>
              {result.budgetAction && (
                <Box gap={1}>
                  <Text dimColor>Budget action:</Text>
                  <Text color={result.budgetAction === 'skip' ? 'red' : 'yellow'}>
                    {result.budgetAction}
                  </Text>
                </Box>
              )}
            </>
          )}

          {result.inject && result.content && (
            <>
              <Text> </Text>
              <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
                <Text bold dimColor>Content preview (first 500 chars):</Text>
                <Text>{truncate(result.content, 500)}</Text>
              </Box>
            </>
          )}
        </Box>
      ) : (
        <Text dimColor>No result.</Text>
      )}

      <Text> </Text>
      <Text dimColor>  {'\u2190'}/{'\u2192'} select agent type</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}
