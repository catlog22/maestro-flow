import { useState } from 'react';
import { useSettingsStore } from '@/client/store/settings-store.js';
import type { AgentSettingsEntry } from '@/client/store/settings-store.js';
import type { AgentType } from '@/shared/agent-types.js';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsSelect,
  SettingsSaveBar,
} from '../SettingsComponents.js';
import { cn } from '@/client/lib/utils.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// AgentsSection — per-agent-type config with type-appropriate fields
// ---------------------------------------------------------------------------

interface AgentFieldConfig {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyEnvHint: string;
  showBaseUrl: boolean;
  baseUrlPlaceholder?: string;
  showSettingsFile: boolean;
  settingsFileLabel?: string;
  settingsFilePlaceholder?: string;
  settingsFileDescription?: string;
}

const AGENT_FIELD_CONFIG: Partial<Record<AgentType, AgentFieldConfig>> = {
  'claude-code': {
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyEnvHint: 'ANTHROPIC_API_KEY',
    showBaseUrl: true,
    baseUrlPlaceholder: 'https://api.anthropic.com',
    showSettingsFile: true,
    settingsFileDescription: 'Path to Claude Code settings JSON (maps model aliases, sets env vars)',
  },
  'agent-sdk': {
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyEnvHint: 'ANTHROPIC_API_KEY',
    showBaseUrl: true,
    baseUrlPlaceholder: 'https://api.anthropic.com',
    showSettingsFile: true,
    settingsFileDescription: 'Path to Claude Code settings JSON (maps model aliases, sets env vars)',
  },
  codex: {
    apiKeyLabel: 'OpenAI API Key',
    apiKeyPlaceholder: 'sk-...',
    apiKeyEnvHint: 'OPENAI_API_KEY',
    showBaseUrl: false,
    showSettingsFile: true,
    settingsFileLabel: 'Profile',
    settingsFilePlaceholder: 'my-profile',
    settingsFileDescription: 'Profile name from ~/.codex/config.toml (passed as --profile)',
  },
  'codex-server': {
    apiKeyLabel: 'OpenAI API Key',
    apiKeyPlaceholder: 'sk-...',
    apiKeyEnvHint: 'OPENAI_API_KEY',
    showBaseUrl: false,
    showSettingsFile: true,
    settingsFileLabel: 'Profile',
    settingsFilePlaceholder: 'my-profile',
    settingsFileDescription: 'Profile name from ~/.codex/config.toml',
  },
  gemini: {
    apiKeyLabel: 'Gemini API Key',
    apiKeyPlaceholder: 'AIza...',
    apiKeyEnvHint: 'GEMINI_API_KEY',
    showBaseUrl: false,
    showSettingsFile: false,
  },
  qwen: {
    apiKeyLabel: 'DashScope API Key',
    apiKeyPlaceholder: 'sk-...',
    apiKeyEnvHint: 'DASHSCOPE_API_KEY',
    showBaseUrl: false,
    showSettingsFile: false,
  },
  opencode: {
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: '',
    apiKeyEnvHint: 'OPENAI_API_KEY',
    showBaseUrl: false,
    showSettingsFile: false,
  },
};

const AGENT_TYPES: { type: AgentType; label: string }[] = [
  { type: 'claude-code', label: 'Claude Code' },
  { type: 'agent-sdk', label: 'Agent SDK' },
  { type: 'codex', label: 'Codex' },
  { type: 'gemini', label: 'Gemini' },
  { type: 'qwen', label: 'Qwen' },
  { type: 'opencode', label: 'OpenCode' },
];

export function AgentsSection() {
  const { t } = useI18n();
  const draft = useSettingsStore((s) => s.draft?.agents);
  const saving = useSettingsStore((s) => s.saving);
  const isDirty = useSettingsStore((s) => s.isDirty('agents'));
  const updateDraft = useSettingsStore((s) => s.updateDraft);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const discardDraft = useSettingsStore((s) => s.discardDraft);
  const [expanded, setExpanded] = useState<AgentType | null>(null);

  const agentDescription = (type: AgentType): string => {
    const keyMap: Record<string, string> = {
      'claude-code': 'settings.agents.claude_code_desc',
      'agent-sdk': 'settings.agents.agent_sdk_desc',
      codex: 'settings.agents.codex_desc',
      gemini: 'settings.agents.gemini_desc',
      qwen: 'settings.agents.qwen_desc',
      opencode: 'settings.agents.opencode_desc',
    };
    return t(keyMap[type] ?? 'settings.agents.claude_code_desc');
  };

  if (!draft) return null;

  const updateAgent = (type: AgentType, patch: Partial<AgentSettingsEntry>) => {
    updateDraft('agents', {
      ...draft,
      [type]: { ...draft[type], ...patch },
    });
  };

  const toggle = (type: AgentType) => {
    setExpanded((prev) => (prev === type ? null : type));
  };

  return (
    <div className="flex flex-col gap-[var(--spacing-3)]">
      {AGENT_TYPES.map(({ type, label }) => {
        const agent = draft[type];
        const isExpanded = expanded === type;
        const fieldCfg = AGENT_FIELD_CONFIG[type];

        return (
          <SettingsCard key={type} title={label} description={agentDescription(type)}>
            <button
              type="button"
              onClick={() => toggle(type)}
              className={cn(
                'w-full text-left text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
                'text-accent-blue hover:underline',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] rounded-[var(--radius-sm)]',
              )}
            >
              {isExpanded ? t('settings.agents.hide_config') : t('settings.agents.show_config')}
            </button>

            {isExpanded && (
              <div className="mt-[var(--spacing-3)] border-t border-border-divider pt-[var(--spacing-3)]">
                <SettingsField
                  label={t('settings.agents.model_label')}
                  description={t('settings.agents.model_desc')}
                  htmlFor={`agent-model-${type}`}
                >
                  <SettingsInput
                    id={`agent-model-${type}`}
                    value={agent.model}
                    onChange={(v) => updateAgent(type, { model: v })}
                    placeholder={t('settings.agents.model_placeholder')}
                  />
                </SettingsField>

                <SettingsField
                  label={t('settings.agents.approval_label')}
                  description={t('settings.agents.approval_desc')}
                  htmlFor={`agent-approval-${type}`}
                >
                  <SettingsSelect
                    id={`agent-approval-${type}`}
                    value={agent.approvalMode}
                    onChange={(v) => updateAgent(type, { approvalMode: v })}
                    options={[
                      { value: 'suggest', label: t('settings.agents.approval_suggest') },
                      { value: 'auto', label: t('settings.agents.approval_auto') },
                    ]}
                  />
                </SettingsField>

                {fieldCfg?.showBaseUrl && (
                  <SettingsField
                    label={t('settings.agents.base_url_label')}
                    description={t('settings.agents.base_url_desc')}
                    htmlFor={`agent-baseurl-${type}`}
                  >
                    <SettingsInput
                      id={`agent-baseurl-${type}`}
                      value={agent.baseUrl ?? ''}
                      onChange={(v) => updateAgent(type, { baseUrl: v })}
                      placeholder={fieldCfg.baseUrlPlaceholder ?? ''}
                    />
                  </SettingsField>
                )}

                {fieldCfg && (
                  <SettingsField
                    label={fieldCfg.apiKeyLabel}
                    description={`Overrides ${fieldCfg.apiKeyEnvHint} env var`}
                    htmlFor={`agent-apikey-${type}`}
                  >
                    <SettingsInput
                      id={`agent-apikey-${type}`}
                      value={agent.apiKey ?? ''}
                      onChange={(v) => updateAgent(type, { apiKey: v })}
                      placeholder={fieldCfg.apiKeyPlaceholder}
                      type="password"
                    />
                  </SettingsField>
                )}

                {fieldCfg?.showSettingsFile && (
                  <SettingsField
                    label={fieldCfg.settingsFileLabel ?? t('settings.agents.settings_file_label')}
                    description={fieldCfg.settingsFileDescription ?? t('settings.agents.settings_file_desc')}
                    htmlFor={`agent-settings-file-${type}`}
                  >
                    <SettingsInput
                      id={`agent-settings-file-${type}`}
                      value={agent.settingsFile ?? ''}
                      onChange={(v) => updateAgent(type, { settingsFile: v })}
                      placeholder={fieldCfg.settingsFilePlaceholder ?? 'D:\\settings.json'}
                    />
                  </SettingsField>
                )}

                <SettingsField
                  label={t('settings.agents.env_file_label')}
                  description={t('settings.agents.env_file_desc')}
                  htmlFor={`agent-envfile-${type}`}
                >
                  <SettingsInput
                    id={`agent-envfile-${type}`}
                    value={agent.envFile ?? ''}
                    onChange={(v) => updateAgent(type, { envFile: v })}
                    placeholder="~/.env.gemini"
                  />
                </SettingsField>
              </div>
            )}
          </SettingsCard>
        );
      })}

      <SettingsSaveBar
        dirty={isDirty}
        saving={saving}
        onSave={() => void saveConfig('agents')}
        onDiscard={() => discardDraft('agents')}
      />
    </div>
  );
}
