import { useI18n } from '@/client/i18n/index.js';
import { useSettingsStore } from '@/client/store/settings-store.js';
import type { CommanderConfig, CommanderSafetyConfig } from '@/shared/commander-types.js';
import type { WorkspacePolicy } from '@/shared/execution-types.js';
import type { AgentType } from '@/shared/agent-types.js';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsSelect,
  SettingsSaveBar,
  SettingsToggle,
} from '../SettingsComponents.js';

// ---------------------------------------------------------------------------
// CommanderSection -- Commander agent configuration (5 card groups)
// ---------------------------------------------------------------------------

const PROFILE_KEYS = ['development', 'staging', 'production', 'custom'] as const;

const MODEL_KEYS = ['haiku', 'sonnet', 'opus'] as const;

const THRESHOLD_KEYS = ['low', 'medium', 'high'] as const;

const EXECUTOR_OPTIONS: { value: AgentType; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'agent-sdk', label: 'Agent SDK' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'opencode', label: 'OpenCode' },
];

function NumberField({
  label,
  description,
  value,
  onChange,
  id,
  min = 0,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  id: string;
  min?: number;
}) {
  return (
    <SettingsField label={label} description={description} htmlFor={id}>
      <SettingsInput
        id={id}
        type="text"
        value={String(value)}
        onChange={(v) => {
          const n = Number(v);
          if (!isNaN(n) && n >= min) onChange(n);
        }}
        className="w-32 font-mono"
      />
    </SettingsField>
  );
}

export function CommanderSection() {
  const { t } = useI18n();
  const draft = useSettingsStore((s) => s.draft?.commander);
  const saving = useSettingsStore((s) => s.saving);
  const isDirty = useSettingsStore((s) => s.isDirty('commander'));
  const updateDraft = useSettingsStore((s) => s.updateDraft);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const discardDraft = useSettingsStore((s) => s.discardDraft);

  const profileOptions = PROFILE_KEYS.map((key) => ({
    value: key,
    label: t(`settings.commander.profile_${key}`),
  }));

  const modelOptions = MODEL_KEYS.map((key) => ({
    value: key,
    label: t(`settings.commander.model_${key}`),
  }));

  const thresholdOptions = THRESHOLD_KEYS.map((key) => ({
    value: key,
    label: t(`settings.commander.threshold_${key}`),
  }));

  if (!draft) return null;

  const update = (patch: Partial<CommanderConfig>) => {
    updateDraft('commander', { ...draft, ...patch });
  };

  const updateSafety = (patch: Partial<CommanderSafetyConfig>) => {
    updateDraft('commander', { ...draft, safety: { ...draft.safety, ...patch } });
  };

  const updateWorkspace = (patch: Partial<WorkspacePolicy>) => {
    updateDraft('commander', { ...draft, workspace: { ...draft.workspace, ...patch } });
  };

  return (
    <div className="flex flex-col gap-[var(--spacing-4)]">
      {/* Profile */}
      <SettingsCard
        title={t('settings.commander.profile_card')}
        description={t('settings.commander.profile_desc')}
      >
        <SettingsField
          label={t('settings.commander.environment_label')}
          description={t('settings.commander.environment_desc')}
          htmlFor="cmd-profile"
        >
          <SettingsSelect
            id="cmd-profile"
            value={draft.profile}
            onChange={(v) => update({ profile: v })}
            options={profileOptions}
          />
        </SettingsField>
      </SettingsCard>

      {/* Core Loop */}
      <SettingsCard
        title={t('settings.commander.core_card')}
        description={t('settings.commander.core_desc')}
      >
        <NumberField
          id="cmd-poll-interval"
          label={t('settings.commander.poll_interval_label')}
          description={t('settings.commander.poll_interval_desc')}
          value={draft.pollIntervalMs}
          onChange={(v) => update({ pollIntervalMs: v })}
        />
        <NumberField
          id="cmd-max-workers"
          label={t('settings.commander.max_workers_label')}
          description={t('settings.commander.max_workers_desc')}
          value={draft.maxConcurrentWorkers}
          onChange={(v) => update({ maxConcurrentWorkers: v })}
        />
        <NumberField
          id="cmd-stall-timeout"
          label={t('settings.commander.stall_timeout_label')}
          description={t('settings.commander.stall_timeout_desc')}
          value={draft.stallTimeoutMs}
          onChange={(v) => update({ stallTimeoutMs: v })}
        />
        <NumberField
          id="cmd-max-retries"
          label={t('settings.commander.max_retries_label')}
          description={t('settings.commander.max_retries_desc')}
          value={draft.maxRetries}
          onChange={(v) => update({ maxRetries: v })}
        />
        <NumberField
          id="cmd-retry-backoff"
          label={t('settings.commander.retry_backoff_label')}
          description={t('settings.commander.retry_backoff_desc')}
          value={draft.retryBackoffMs}
          onChange={(v) => update({ retryBackoffMs: v })}
        />
      </SettingsCard>

      {/* Decision */}
      <SettingsCard
        title={t('settings.commander.decision_card')}
        description={t('settings.commander.decision_desc')}
      >
        <SettingsField
          label={t('settings.commander.decision_model_label')}
          description={t('settings.commander.decision_model_desc')}
          htmlFor="cmd-decision-model"
        >
          <SettingsSelect
            id="cmd-decision-model"
            value={draft.decisionModel}
            onChange={(v) => update({ decisionModel: v })}
            options={modelOptions}
          />
        </SettingsField>
        <NumberField
          id="cmd-assess-turns"
          label={t('settings.commander.assess_turns_label')}
          description={t('settings.commander.assess_turns_desc')}
          value={draft.assessMaxTurns}
          onChange={(v) => update({ assessMaxTurns: v })}
        />
        <SettingsField
          label={t('settings.commander.threshold_label')}
          description={t('settings.commander.threshold_desc')}
          htmlFor="cmd-approve-threshold"
        >
          <SettingsSelect
            id="cmd-approve-threshold"
            value={draft.autoApproveThreshold}
            onChange={(v) => update({ autoApproveThreshold: v })}
            options={thresholdOptions}
          />
        </SettingsField>
        <SettingsField
          label={t('settings.commander.executor_label')}
          description={t('settings.commander.executor_desc')}
          htmlFor="cmd-executor"
        >
          <SettingsSelect
            id="cmd-executor"
            value={draft.defaultExecutor}
            onChange={(v) => update({ defaultExecutor: v })}
            options={EXECUTOR_OPTIONS}
          />
        </SettingsField>
      </SettingsCard>

      {/* Safety */}
      <SettingsCard
        title={t('settings.commander.safety_card')}
        description={t('settings.commander.safety_desc')}
      >
        <NumberField
          id="cmd-debounce"
          label={t('settings.commander.debounce_label')}
          description={t('settings.commander.debounce_desc')}
          value={draft.safety.eventDebounceMs}
          onChange={(v) => updateSafety({ eventDebounceMs: v })}
        />
        <NumberField
          id="cmd-circuit-breaker"
          label={t('settings.commander.circuit_breaker_label')}
          description={t('settings.commander.circuit_breaker_desc')}
          value={draft.safety.circuitBreakerThreshold}
          onChange={(v) => updateSafety({ circuitBreakerThreshold: v })}
        />
        <NumberField
          id="cmd-max-ticks"
          label={t('settings.commander.max_ticks_label')}
          description={t('settings.commander.max_ticks_desc')}
          value={draft.safety.maxTicksPerHour}
          onChange={(v) => updateSafety({ maxTicksPerHour: v })}
        />
        <NumberField
          id="cmd-max-tokens"
          label={t('settings.commander.max_tokens_label')}
          description={t('settings.commander.max_tokens_desc')}
          value={draft.safety.maxTokensPerHour}
          onChange={(v) => updateSafety({ maxTokensPerHour: v })}
        />
        <SettingsField
          label={t('settings.commander.protected_paths_label')}
          description={t('settings.commander.protected_paths_desc')}
          htmlFor="cmd-protected-paths"
        >
          <SettingsInput
            id="cmd-protected-paths"
            value={draft.safety.protectedPaths.join(', ')}
            onChange={(v) =>
              updateSafety({
                protectedPaths: v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder=".env, *.key, credentials.*"
            className="w-72 font-mono text-[length:var(--font-size-xs)]"
          />
        </SettingsField>
      </SettingsCard>

      {/* Workspace */}
      <SettingsCard
        title={t('settings.commander.workspace_card')}
        description={t('settings.commander.workspace_desc')}
      >
        <SettingsField
          label={t('settings.commander.workspace_enabled_label')}
          description={t('settings.commander.workspace_enabled_desc')}
        >
          <SettingsToggle
            enabled={draft.workspace.enabled}
            onClick={() => updateWorkspace({ enabled: !draft.workspace.enabled })}
          />
        </SettingsField>
        <SettingsField
          label={t('settings.commander.workspace_worktree_label')}
          description={t('settings.commander.workspace_worktree_desc')}
        >
          <SettingsToggle
            enabled={draft.workspace.useWorktree}
            onClick={() => updateWorkspace({ useWorktree: !draft.workspace.useWorktree })}
          />
        </SettingsField>
        <SettingsField
          label={t('settings.commander.workspace_autocleanup_label')}
          description={t('settings.commander.workspace_autocleanup_desc')}
        >
          <SettingsToggle
            enabled={draft.workspace.autoCleanup}
            onClick={() => updateWorkspace({ autoCleanup: !draft.workspace.autoCleanup })}
          />
        </SettingsField>
        <SettingsField
          label={t('settings.commander.workspace_strict_label')}
          description={t('settings.commander.workspace_strict_desc')}
        >
          <SettingsToggle
            enabled={draft.workspace.strict}
            onClick={() => updateWorkspace({ strict: !draft.workspace.strict })}
          />
        </SettingsField>
      </SettingsCard>

      <SettingsSaveBar
        dirty={isDirty}
        saving={saving}
        onSave={() => void saveConfig('commander')}
        onDiscard={() => discardDraft('commander')}
      />
    </div>
  );
}
