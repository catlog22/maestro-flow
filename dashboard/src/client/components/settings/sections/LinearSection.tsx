import { useState } from 'react';
import { useSettingsStore } from '@/client/store/settings-store.js';
import { useLinearStore } from '@/client/store/linear-store.js';
import {
  SettingsCard,
  SettingsField,
  SettingsSaveBar,
} from '../SettingsComponents.js';
import { cn } from '@/client/lib/utils.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// LinearSection — API Key configuration + connection test + team selector
// ---------------------------------------------------------------------------

export function LinearSection() {
  const { t } = useI18n();
  const draft = useSettingsStore((s) => s.draft?.linear);
  const saving = useSettingsStore((s) => s.saving);
  const isDirty = useSettingsStore((s) => s.isDirty('linear'));
  const updateDraft = useSettingsStore((s) => s.updateDraft);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const discardDraft = useSettingsStore((s) => s.discardDraft);

  const configured = useLinearStore((s) => s.configured);
  const teams = useLinearStore((s) => s.teams);
  const checkStatus = useLinearStore((s) => s.checkStatus);
  const fetchTeams = useLinearStore((s) => s.fetchTeams);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!draft) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await checkStatus();
      const res = await fetch('/api/linear/teams');
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((body as { error: string }).error);
      }
      const teamsData = await res.json() as Array<{ name: string }>;
      await fetchTeams();
      setTestResult({ ok: true, message: `Connected! Found ${teamsData.length} team(s)` });
    } catch (err) {
      setTestResult({ ok: false, message: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    await saveConfig('linear');
    // Refresh status after saving
    await checkStatus();
    if (draft.apiKey) {
      await fetchTeams();
    }
  };

  return (
    <div className="flex flex-col gap-[var(--spacing-4)]">
      <SettingsCard title={t('settings.linear.integration_card')} description={t('settings.linear.integration_desc')}>
        <SettingsField
          label={t('settings.linear.api_key_label')}
          description={t('settings.linear.api_key_desc')}
          htmlFor="settings-linear-api-key"
        >
          <input
            id="settings-linear-api-key"
            type="password"
            value={draft.apiKey}
            onChange={(e) => updateDraft('linear', { ...draft, apiKey: e.target.value })}
            placeholder="lin_api_..."
            className={cn(
              'w-48 px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
              'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-sm)]',
              'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
              'transition-colors duration-[var(--duration-fast)]',
              'placeholder:text-text-tertiary',
            )}
          />
        </SettingsField>

        {/* Connection status */}
        <div className="flex items-center gap-[var(--spacing-2)] pt-[var(--spacing-2)]">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              configured === true ? 'bg-status-completed' : configured === false ? 'bg-status-blocked' : 'bg-bg-hover'
            }`}
          />
          <span className="text-[length:var(--font-size-sm)] text-text-secondary">
            {configured === true ? t('settings.linear.connected') : configured === false ? t('settings.linear.not_configured') : t('settings.linear.checking')}
          </span>
        </div>

        {/* Test button */}
        <div className="flex items-center gap-[var(--spacing-2)] pt-[var(--spacing-2)]">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing}
            className={cn(
              'px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)]',
              'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
              'border border-border text-text-secondary',
              'hover:bg-bg-hover hover:text-text-primary',
              'transition-colors duration-[var(--duration-fast)]',
              'disabled:opacity-50 disabled:pointer-events-none',
            )}
          >
            {testing ? t('settings.linear.testing') : t('settings.linear.test_connection')}
          </button>
          {testResult && (
            <span
              className={cn(
                'text-[length:var(--font-size-xs)]',
                testResult.ok ? 'text-status-completed' : 'text-status-blocked',
              )}
            >
              {testResult.message}
            </span>
          )}
        </div>
      </SettingsCard>

      {/* Team list (shown when connected) */}
      {configured && teams.length > 0 && (
        <SettingsCard title={t('settings.linear.teams_card')} description={t('settings.linear.teams_desc')}>
          <div className="flex flex-col gap-[var(--spacing-1)]">
            {teams.map((team) => (
              <div
                key={team.id}
                className="flex items-center gap-[var(--spacing-2)] py-[var(--spacing-1-5)] text-[length:var(--font-size-sm)]"
              >
                <span className="font-mono text-text-tertiary text-[length:var(--font-size-xs)]">{team.key}</span>
                <span className="text-text-primary">{team.name}</span>
              </div>
            ))}
          </div>
        </SettingsCard>
      )}

      <SettingsSaveBar
        dirty={isDirty}
        saving={saving}
        onSave={() => void handleSave()}
        onDiscard={() => discardDraft('linear')}
      />
    </div>
  );
}
