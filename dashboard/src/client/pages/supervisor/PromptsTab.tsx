import { useState } from 'react';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// PromptsTab -- list-detail split pane for prompt builders
// ---------------------------------------------------------------------------

export function PromptsTab() {
  const { t } = useI18n();
  const promptModes = useSupervisorStore((s) => s.promptModes);
  const promptBindings = useSupervisorStore((s) => s.promptBindings);
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [templateText, setTemplateText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = searchQuery
    ? promptModes.filter((m) => m.toLowerCase().includes(searchQuery.toLowerCase()))
    : promptModes;

  const handleSelectMode = (mode: string) => {
    setSelectedMode(mode);
    setTemplateText(promptBindings[mode] ?? '');
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* List pane */}
      <div style={{ width: 320, background: 'var(--color-bg-primary)', borderRight: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('supervisor.prompts.title')}</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('supervisor.prompts.builders_count', { count: promptModes.length })}</span>
        </div>

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('supervisor.prompts.filter')}
          style={{ margin: '10px 12px 6px', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-divider)', background: 'var(--color-bg-card)', fontSize: 12, color: 'var(--color-text-primary)', outline: 'none' }}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 16 }}>
              {searchQuery ? t('supervisor.prompts.no_matches') : t('supervisor.prompts.no_modes')}
            </div>
          ) : (
            filtered.map((mode) => {
              const isActive = mode === selectedMode;
              const hasBinding = !!promptBindings[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleSelectMode(mode)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
                    background: isActive ? 'var(--color-tint-exploring)' : 'none',
                    borderLeft: `3px solid ${isActive ? 'var(--color-accent-blue)' : 'transparent'}`,
                    transition: 'all 120ms',
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-tint-planning)', color: 'var(--color-accent-purple)', flexShrink: 0 }}>
                    <svg style={{ width: 14, height: 14, strokeWidth: 1.8 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mode}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      {hasBinding ? t('supervisor.prompts.bound') : t('supervisor.prompts.unbound')}
                    </div>
                  </div>
                  {hasBinding && (
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(90,158,120,0.12)', color: 'var(--color-accent-green)' }}>
                      active
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {selectedMode ? (
          <>
            {/* Detail header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--color-border-divider)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-tint-planning)', color: 'var(--color-accent-purple)' }}>
                  <svg style={{ width: 18, height: 18, strokeWidth: 1.8 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{selectedMode}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('supervisor.prompts.prompt_builder')}</div>
                </div>
              </div>
            </div>

            {/* Detail body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Binding info */}
              <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.prompts.binding')}</span>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-divider)' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 120, flexShrink: 0 }}>{t('supervisor.prompts.mode')}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{selectedMode}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 120, flexShrink: 0 }}>{t('supervisor.prompts.status')}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: promptBindings[selectedMode] ? 'rgba(90,158,120,0.12)' : 'rgba(160,157,151,0.12)', color: promptBindings[selectedMode] ? 'var(--color-accent-green)' : 'var(--color-accent-gray)' }}>
                      {promptBindings[selectedMode] ? t('supervisor.prompts.bound') : t('supervisor.prompts.unbound')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Template editor */}
              <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.prompts.template')}</span>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <textarea
                    value={templateText}
                    onChange={(e) => setTemplateText(e.target.value)}
                    placeholder={t('supervisor.prompts.edit_placeholder')}
                    style={{
                      width: '100%', minHeight: 160, resize: 'vertical', borderRadius: 8, padding: 12,
                      fontSize: 12, fontFamily: "'SF Mono', Consolas, monospace", lineHeight: 1.6,
                      background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border-divider)', outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Preview */}
              {templateText && (
                <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.prompts.preview')}</span>
                  </div>
                  <div style={{ padding: 0 }}>
                    <pre style={{
                      margin: 0, padding: 16, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      fontFamily: "'SF Mono', Consolas, monospace", maxHeight: 200, overflowY: 'auto',
                      background: 'var(--color-text-primary)', color: '#d4d0ca', borderRadius: '0 0 12px 12px',
                    }}>
                      {templateText}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
            {t('supervisor.prompts.select_detail')}
          </div>
        )}
      </div>
    </div>
  );
}
