import { useEffect } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { useSettingsStore } from '@/client/store/settings-store.js';
import type { GeneralSettings } from '@/client/store/settings-store.js';
import { useUIPrefsStore } from '@/client/store/ui-prefs-store.js';
import type { StylePreset } from '@/client/store/ui-prefs-store.js';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsSelect,
  SettingsSaveBar,
  SettingsToggle,
} from '../SettingsComponents.js';
import { cn } from '@/client/lib/utils.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// GeneralSection — connection status, theme, dashboard config
// ---------------------------------------------------------------------------

const STYLE_PRESET_KEYS: StylePreset[] = ['default', 'cowork'];
const STYLE_PRESET_I18N_KEYS: Record<string, string> = {
  default: 'settings.general.style_default',
  cowork: 'settings.general.style_cowork',
};

function StylePresetField() {
  const { t } = useI18n();
  const preset = useUIPrefsStore((s) => s.stylePreset);
  const setPreset = useUIPrefsStore((s) => s.setStylePreset);

  return (
    <SettingsField
      label={t('settings.general.style_preset_label')}
      description={t('settings.general.style_preset_desc')}
    >
      <div className="flex items-center gap-[var(--spacing-1)]">
        {STYLE_PRESET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            className={cn(
              'px-3 py-1 rounded-[var(--radius-sm)] text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] transition-all duration-[var(--duration-fast)]',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
              preset === key
                ? 'bg-accent-blue text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
            )}
          >
            {t(STYLE_PRESET_I18N_KEYS[key])}
          </button>
        ))}
      </div>
    </SettingsField>
  );
}

export function GeneralSection() {
  const { t } = useI18n();
  const connected = useBoardStore((s) => s.connected);
  const draft = useSettingsStore((s) => s.draft?.general);
  const saving = useSettingsStore((s) => s.saving);
  const isDirty = useSettingsStore((s) => s.isDirty('general'));
  const updateDraft = useSettingsStore((s) => s.updateDraft);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const discardDraft = useSettingsStore((s) => s.discardDraft);
  const searchTool = useSettingsStore((s) => s.draft?.searchTool ?? 'mcp__ace-tool__search_context');
  const searchToolDirty = useSettingsStore((s) => s.isDirty('searchTool'));
  const chineseResponse = useSettingsStore((s) => s.chineseResponse);
  const loadChineseResponse = useSettingsStore((s) => s.loadChineseResponse);
  const toggleChineseResponse = useSettingsStore((s) => s.toggleChineseResponse);

  useEffect(() => {
    void loadChineseResponse();
  }, [loadChineseResponse]);

  if (!draft) return null;

  const update = (patch: Partial<GeneralSettings>) => {
    updateDraft('general', { ...draft, ...patch });
  };

  return (
    <div className="flex flex-col gap-[var(--spacing-4)]">
      <SettingsCard title={t('settings.general.connection_card')} description={t('settings.general.connection_desc')}>
        <div className="flex items-center gap-[var(--spacing-2)]">
          <span
            className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-status-completed' : 'bg-status-blocked'}`}
          />
          <span className="text-[length:var(--font-size-sm)] text-text-primary">
            {connected ? t('settings.general.connected') : t('settings.general.disconnected')}
          </span>
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.general.appearance_card')} description={t('settings.general.appearance_desc')}>
        <SettingsField
          label={t('settings.general.theme_label')}
          description={t('settings.general.theme_desc')}
          htmlFor="settings-theme"
        >
          <SettingsSelect
            id="settings-theme"
            value={draft.theme}
            onChange={(v) => update({ theme: v })}
            options={[
              { value: 'system', label: t('settings.general.theme_system') },
              { value: 'dark', label: t('settings.general.theme_dark') },
              { value: 'light', label: t('settings.general.theme_light') },
            ]}
          />
        </SettingsField>

        <SettingsField
          label={t('settings.general.language_label')}
          description={t('settings.general.language_desc')}
          htmlFor="settings-language"
        >
          <SettingsSelect
            id="settings-language"
            value={draft.language}
            onChange={(v) => update({ language: v })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '中文' },
            ]}
          />
        </SettingsField>

        <StylePresetField />
      </SettingsCard>

      <SettingsCard
        title={t('settings.general.search_tool_card')}
        description={t('settings.general.search_tool_desc')}
      >
        <SettingsField
          label={t('settings.general.search_tool_label')}
          description={t('settings.general.search_tool_desc')}
          htmlFor="settings-search-tool"
        >
          <SettingsInput
            id="settings-search-tool"
            value={searchTool}
            onChange={(v) => updateDraft('searchTool', v)}
            placeholder="mcp__ace-tool__search_context"
            className="w-72 font-mono text-[length:var(--font-size-xs)]"
          />
        </SettingsField>
        <SettingsSaveBar
          dirty={searchToolDirty}
          saving={saving}
          onSave={() => void saveConfig('searchTool')}
          onDiscard={() => discardDraft('searchTool')}
        />
      </SettingsCard>

      {chineseResponse && (
        <SettingsCard
          title={t('settings.general.response_lang_card')}
          description={t('settings.general.response_lang_desc')}
        >
          <SettingsField
            label={t('settings.general.chinese_claude_label')}
            description={t('settings.general.chinese_claude_desc')}
          >
            <div className="flex items-center gap-[var(--spacing-2)]">
              <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-accent-blue bg-accent-blue/10 px-[var(--spacing-1-5)] py-0.5 rounded-[var(--radius-sm)]">
                Claude
              </span>
              <SettingsToggle
                enabled={chineseResponse.claudeEnabled}
                onClick={() => void toggleChineseResponse(!chineseResponse.claudeEnabled, 'claude')}
              />
            </div>
          </SettingsField>

          <SettingsField
            label={t('settings.general.chinese_codex_label')}
            description={t('settings.general.chinese_codex_desc')}
          >
            <div className="flex items-center gap-[var(--spacing-2)]">
              <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-green-400 bg-green-400/10 px-[var(--spacing-1-5)] py-0.5 rounded-[var(--radius-sm)]">
                Codex
              </span>
              <SettingsToggle
                enabled={chineseResponse.codexEnabled}
                onClick={() => void toggleChineseResponse(!chineseResponse.codexEnabled, 'codex')}
              />
            </div>
          </SettingsField>

          {chineseResponse.codexNeedsMigration && (
            <div className="mt-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] bg-status-blocked/10 border border-status-blocked/30">
              <p className="text-[length:var(--font-size-xs)] text-status-blocked">
                {t('settings.general.codex_migrate_hint')}
              </p>
            </div>
          )}

          {!chineseResponse.guidelinesExists && (
            <div className="mt-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] bg-status-blocked/10 border border-status-blocked/30">
              <p className="text-[length:var(--font-size-xs)] text-status-blocked">
                {t('settings.general.guidelines_missing')}
              </p>
            </div>
          )}
        </SettingsCard>
      )}

      <SettingsSaveBar
        dirty={isDirty}
        saving={saving}
        onSave={() => void saveConfig('general')}
        onDiscard={() => discardDraft('general')}
      />
    </div>
  );
}
