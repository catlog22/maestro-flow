import { useState } from 'react';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useI18n } from '@/client/i18n/index.js';
import type { CommandPattern, KnowledgeEntry } from '@/shared/learning-types.js';

// ---------------------------------------------------------------------------
// LearningTab -- list-detail split pane for patterns + knowledge base
// ---------------------------------------------------------------------------

const SUGGESTION_COLORS: Record<string, string> = {
  optimize: 'var(--color-accent-blue)',
  alert: 'var(--color-accent-red)',
  automate: 'var(--color-accent-green)',
};

type SelectedItem = { type: 'pattern'; data: CommandPattern } | { type: 'knowledge'; data: KnowledgeEntry };

export function LearningTab() {
  const { t } = useI18n();
  const learningStats = useSupervisorStore((s) => s.learningStats);
  const learningPatterns = useSupervisorStore((s) => s.learningPatterns);
  const knowledgeEntries = useSupervisorStore((s) => s.knowledgeEntries);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<SelectedItem | null>(null);

  const filteredKB = searchQuery
    ? knowledgeEntries.filter(
        (e) =>
          e.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : knowledgeEntries;

  const maxFrequency = learningPatterns.reduce((max, p) => Math.max(max, p.frequency), 1);

  return (
    <div className="flex h-full overflow-hidden">
      {/* List pane */}
      <div style={{ width: 320, background: 'var(--color-bg-primary)', borderRight: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* List header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('supervisor.learning.title')}</span>
          {learningStats && (
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              {t('supervisor.learning.cmds_patterns', { cmds: learningStats.totalCommands, patterns: learningStats.uniquePatterns })}
            </span>
          )}
        </div>

        {/* Search */}
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('supervisor.learning.search')}
          style={{ margin: '10px 12px 6px', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-divider)', background: 'var(--color-bg-card)', fontSize: 12, color: 'var(--color-text-primary)', outline: 'none' }}
        />

        {/* List body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Patterns section */}
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-tertiary)', padding: '10px 16px 4px' }}>
            {t('supervisor.learning.command_patterns')}
          </div>
          {learningPatterns.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 12 }}>{t('supervisor.learning.no_patterns')}</div>
          ) : (
            learningPatterns.map((pattern) => {
              const isActive = selected?.type === 'pattern' && selected.data.command === pattern.command;
              return (
                <button
                  key={pattern.command}
                  type="button"
                  onClick={() => setSelected({ type: 'pattern', data: pattern })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
                    background: isActive ? 'var(--color-tint-exploring)' : 'none',
                    borderLeft: `3px solid ${isActive ? 'var(--color-accent-blue)' : 'transparent'}`,
                    transition: 'all 120ms',
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-tint-exploring)', color: 'var(--color-accent-blue)', flexShrink: 0 }}>
                    <svg style={{ width: 14, height: 14, strokeWidth: 1.8 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pattern.command}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', gap: 8 }}>
                      <span>x{pattern.frequency}</span>
                      <span>{Math.round(pattern.successRate * 100)}% {t('supervisor.learning.success_label')}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}

          {/* Knowledge Base section */}
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-tertiary)', padding: '10px 16px 4px' }}>
            {t('supervisor.learning.knowledge_base')} ({filteredKB.length})
          </div>
          {filteredKB.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 12 }}>
              {searchQuery ? t('supervisor.learning.no_matches') : t('supervisor.learning.empty')}
            </div>
          ) : (
            filteredKB.map((entry) => {
              const isActive = selected?.type === 'knowledge' && selected.data.id === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelected({ type: 'knowledge', data: entry })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
                    background: isActive ? 'var(--color-tint-exploring)' : 'none',
                    borderLeft: `3px solid ${isActive ? 'var(--color-accent-blue)' : 'transparent'}`,
                    transition: 'all 120ms',
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-tint-completed)', color: 'var(--color-accent-green)', flexShrink: 0 }}>
                    <svg style={{ width: 14, height: 14, strokeWidth: 1.8 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.topic}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', gap: 8 }}>
                      <span>{entry.source}</span>
                      <span>{t('supervisor.learning.used_count', { count: entry.usageCount })}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          selected.type === 'pattern'
            ? <PatternDetail pattern={selected.data} maxFrequency={maxFrequency} suggestions={learningStats?.suggestions ?? []} />
            : <KnowledgeDetail entry={selected.data} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
            {t('supervisor.learning.select_detail')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatternDetail
// ---------------------------------------------------------------------------

function PatternDetail({ pattern, maxFrequency, suggestions }: {
  pattern: CommandPattern;
  maxFrequency: number;
  suggestions: { type: string; title: string; description: string; confidence: number }[];
}) {
  const { t } = useI18n();
  const pct = Math.round((pattern.frequency / maxFrequency) * 100);
  const rateColor = pattern.successRate >= 0.9 ? 'var(--color-accent-green)' : pattern.successRate >= 0.7 ? 'var(--color-accent-blue)' : 'var(--color-accent-yellow)';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--color-border-divider)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-tint-exploring)', color: 'var(--color-accent-blue)' }}>
            <svg style={{ width: 18, height: 18, strokeWidth: 1.8 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{pattern.command}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('supervisor.learning.command_pattern')}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16 }}>
          <StatBox label={t('supervisor.learning.frequency')} value={String(pattern.frequency)} />
          <StatBox label={t('supervisor.learning.success_rate')} value={`${Math.round(pattern.successRate * 100)}%`} valueColor={rateColor} />
          <StatBox label={t('supervisor.learning.avg_duration')} value={`${Math.round(pattern.avgDuration / 1000)}s`} />
        </div>

        {/* Frequency bar */}
        <Section title={t('supervisor.learning.usage')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 80 }}>{t('supervisor.learning.relative')}</span>
            <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 100, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 100, background: rateColor }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{pct}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--color-border-divider)' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 120 }}>{t('supervisor.learning.last_used')}</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{pattern.lastUsed ? new Date(pattern.lastUsed).toLocaleString() : '-'}</span>
          </div>
        </Section>

        {/* Contexts */}
        {pattern.contexts && pattern.contexts.length > 0 && (
          <Section title={t('supervisor.learning.contexts')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pattern.contexts.map((ctx) => (
                <span key={ctx} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(145,120,181,0.12)', color: 'var(--color-accent-purple)' }}>
                  {ctx}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <Section title={t('supervisor.learning.suggestions')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {suggestions.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: SUGGESTION_COLORS[s.type] ?? 'var(--color-bg-tertiary)', color: '#fff', flexShrink: 0 }}>{s.type}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{s.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// KnowledgeDetail
// ---------------------------------------------------------------------------

function KnowledgeDetail({ entry }: { entry: KnowledgeEntry }) {
  const { t } = useI18n();
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--color-border-divider)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-tint-completed)', color: 'var(--color-accent-green)' }}>
            <svg style={{ width: 18, height: 18, strokeWidth: 1.8 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{entry.topic}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('supervisor.learning.knowledge_entry')} - {entry.source}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <StatBox label={t('supervisor.learning.usage_count')} value={String(entry.usageCount)} />
          <StatBox label={t('supervisor.learning.source')} value={entry.source} />
          <StatBox label={t('supervisor.learning.last_accessed')} value={entry.lastAccessed ? new Date(entry.lastAccessed).toLocaleDateString() : '-'} />
        </div>

        <Section title={t('supervisor.learning.content')}>
          <div style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {entry.content}
          </div>
        </Section>

        {entry.tags.length > 0 && (
          <Section title={t('supervisor.learning.tags')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {entry.tags.map((tag) => (
                <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(91,141,184,0.12)', color: 'var(--color-accent-blue)' }}>
                  {tag}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function StatBox({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--color-bg-primary)', borderRadius: 10, padding: 14, border: '1px solid var(--color-border-divider)' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor ?? 'var(--color-text-primary)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</span>
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  );
}
