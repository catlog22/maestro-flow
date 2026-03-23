import { useState } from 'react';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useI18n } from '@/client/i18n/index.js';
import type { ExtensionInfo } from '@/shared/extension-types.js';

// ---------------------------------------------------------------------------
// ExtensionsTab -- list-detail split pane for extensions
// ---------------------------------------------------------------------------

const TYPE_ICON_COLORS: Record<string, { bg: string; fg: string }> = {
  strategy: { bg: 'var(--color-tint-exploring)', fg: 'var(--color-accent-blue)' },
  builder: { bg: 'var(--color-tint-completed)', fg: 'var(--color-accent-green)' },
  adapter: { bg: 'var(--color-tint-verifying)', fg: 'var(--color-accent-orange)' },
  task: { bg: 'var(--color-tint-planning)', fg: 'var(--color-accent-purple)' },
  tool: { bg: 'var(--color-tint-pending)', fg: 'var(--color-accent-gray)' },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  strategy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  builder: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
  adapter: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  task: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  tool: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09"/></svg>,
};

export function ExtensionsTab() {
  const { t } = useI18n();
  const extensions = useSupervisorStore((s) => s.extensions);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = searchQuery
    ? extensions.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()) || e.type.toLowerCase().includes(searchQuery.toLowerCase()))
    : extensions;
  const selected = extensions.find((e) => e.name === selectedName) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* List pane */}
      <div style={{ width: 320, background: 'var(--color-bg-primary)', borderRight: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('supervisor.extensions.title')}</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('supervisor.extensions.loaded_count', { count: extensions.length })}</span>
        </div>

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('supervisor.extensions.filter')}
          style={{ margin: '10px 12px 6px', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-divider)', background: 'var(--color-bg-card)', fontSize: 12, color: 'var(--color-text-primary)', outline: 'none' }}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 16 }}>
              {searchQuery ? t('supervisor.extensions.no_matches') : t('supervisor.extensions.no_extensions')}
            </div>
          ) : (
            filtered.map((ext) => {
              const isActive = ext.name === selectedName;
              const colors = TYPE_ICON_COLORS[ext.type] ?? TYPE_ICON_COLORS.tool;
              return (
                <button
                  key={ext.name}
                  type="button"
                  onClick={() => setSelectedName(ext.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
                    background: isActive ? 'var(--color-tint-exploring)' : 'none',
                    borderLeft: `3px solid ${isActive ? 'var(--color-accent-blue)' : 'transparent'}`,
                    transition: 'all 120ms',
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg, color: colors.fg, flexShrink: 0 }}>
                    <span style={{ width: 14, height: 14, strokeWidth: 1.8, display: 'flex' }}>{TYPE_ICONS[ext.type] ?? TYPE_ICONS.tool}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ext.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', gap: 8 }}>
                      <span>v{ext.version}</span>
                      <span>{ext.type}</span>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: ext.status === 'enabled' ? 'var(--color-accent-green)' : 'var(--color-text-tertiary)' }} />
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
          <ExtensionDetail ext={selected} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
            {t('supervisor.extensions.select_detail')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtensionDetail
// ---------------------------------------------------------------------------

function ExtensionDetail({ ext }: { ext: ExtensionInfo }) {
  const { t } = useI18n();
  const colors = TYPE_ICON_COLORS[ext.type] ?? TYPE_ICON_COLORS.tool;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--color-border-divider)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg, color: colors.fg }}>
            <span style={{ width: 18, height: 18, strokeWidth: 1.8, display: 'flex' }}>{TYPE_ICONS[ext.type] ?? TYPE_ICONS.tool}</span>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{ext.name}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>v{ext.version}</div>
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: ext.status === 'enabled' ? 'rgba(90,158,120,0.12)' : 'rgba(160,157,151,0.12)', color: ext.status === 'enabled' ? 'var(--color-accent-green)' : 'var(--color-accent-gray)' }}>
          {ext.status}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* About */}
        <Section title={t('supervisor.extensions.about')}>
          <div style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
            {ext.description || t('supervisor.extensions.no_description')}
          </div>
        </Section>

        {/* Details */}
        <Section title={t('supervisor.extensions.details')}>
          <KvRow label={t('supervisor.extensions.name')} value={ext.name} />
          <KvRow label={t('supervisor.extensions.version')} value={ext.version} />
          <KvRow label={t('supervisor.extensions.type')} value={ext.type} />
          <KvRow label={t('supervisor.extensions.status')} value={ext.status} />
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

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

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-divider)' }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
