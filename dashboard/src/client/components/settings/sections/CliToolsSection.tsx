import { useState, useCallback } from 'react';
import { useSettingsStore } from '@/client/store/settings-store.js';
import { SettingsCard, SettingsSaveBar } from '../SettingsComponents.js';
import { cn } from '@/client/lib/utils.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// CliToolsSection — JSON textarea editor for cli-tools.json
// ---------------------------------------------------------------------------

export function CliToolsSection() {
  const { t } = useI18n();
  const draft = useSettingsStore((s) => s.draft?.cliTools ?? '{}');
  const saving = useSettingsStore((s) => s.saving);
  const isDirty = useSettingsStore((s) => s.isDirty('cliTools'));
  const updateDraft = useSettingsStore((s) => s.updateDraft);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const discardDraft = useSettingsStore((s) => s.discardDraft);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleChange = useCallback(
    (value: string) => {
      updateDraft('cliTools', value);
      try {
        JSON.parse(value);
        setJsonError(null);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
      }
    },
    [updateDraft],
  );

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(draft);
      const formatted = JSON.stringify(parsed, null, 2);
      updateDraft('cliTools', formatted);
      setJsonError(null);
    } catch {
      // Cannot format invalid JSON
    }
  }, [draft, updateDraft]);

  return (
    <div className="flex flex-col gap-[var(--spacing-4)]">
      <SettingsCard
        title={t('settings.cli_tools.config_card')}
        description={t('settings.cli_tools.config_desc')}
      >
        <div className="flex items-center justify-between mb-[var(--spacing-2)]">
          <span className="text-[length:var(--font-size-xs)] text-text-tertiary">
            ~/.maestro/cli-tools.json
          </span>
          <button
            type="button"
            onClick={handleFormat}
            className={cn(
              'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
              'text-accent-blue hover:underline',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] rounded-[var(--radius-sm)]',
            )}
          >
            {t('settings.cli_tools.format_json')}
          </button>
        </div>

        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck={false}
          className={cn(
            'w-full h-80 px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)]',
            'border bg-bg-primary text-text-primary text-[length:var(--font-size-sm)]',
            'font-mono leading-relaxed resize-y',
            'focus:outline-none focus:shadow-[var(--shadow-focus-ring)]',
            'transition-colors duration-[var(--duration-fast)]',
            jsonError ? 'border-status-blocked' : 'border-border focus:border-accent-blue',
          )}
        />

        {jsonError && (
          <p className="mt-[var(--spacing-1)] text-[length:var(--font-size-xs)] text-status-blocked">
            {jsonError}
          </p>
        )}
      </SettingsCard>

      <SettingsSaveBar
        dirty={isDirty && !jsonError}
        saving={saving}
        onSave={() => void saveConfig('cliTools')}
        onDiscard={() => {
          discardDraft('cliTools');
          setJsonError(null);
        }}
      />
    </div>
  );
}
