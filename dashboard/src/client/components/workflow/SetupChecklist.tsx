import { useState } from 'react';
import type { ProjectState } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// SetupChecklist -- guidance for empty projects (no phases yet)
// ---------------------------------------------------------------------------

interface SetupStep {
  id: string;
  label: string;
  command: string;
  description: string;
  done: (project: ProjectState | undefined) => boolean;
}

const SETUP_STEPS: SetupStep[] = [
  {
    id: 'init',
    label: 'Initialize Project',
    command: '/maestro-init',
    description: 'Set up project configuration and workspace',
    done: (project) => Boolean(project?.project_name && project.project_name !== ''),
  },
  {
    id: 'roadmap',
    label: 'Create Roadmap',
    command: '/maestro-roadmap',
    description: 'Define phases and milestones for your project',
    done: (_project) => false,
  },
  {
    id: 'plan',
    label: 'Plan Phase 1',
    command: '/maestro-plan 1',
    description: 'Create execution plan for the first phase',
    done: (_project) => false,
  },
];

export function SetupChecklist({ project }: { project?: ProjectState }) {
  const [copied, setCopied] = useState<string | null>(null);

  const currentStepId = SETUP_STEPS.find((s) => !s.done(project))?.id ?? null;

  function handleCopy(step: SetupStep) {
    navigator.clipboard.writeText(step.command).catch(() => {});
    setCopied(step.id);
    setTimeout(() => setCopied((prev) => (prev === step.id ? null : prev)), 2000);
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-4)] px-[var(--spacing-6)] py-[var(--spacing-6)] h-full overflow-y-auto">
      <div className="flex flex-col gap-[var(--spacing-1)]">
        <h2 className="text-[length:var(--font-size-lg)] font-bold text-text-primary">
          Project Setup
        </h2>
        <p className="text-[length:var(--font-size-sm)] text-text-tertiary">
          Run these commands to initialize your project
        </p>
      </div>

      <div className="flex flex-col gap-[var(--spacing-3)]">
        {SETUP_STEPS.map((step) => {
          const isDone = step.done(project);
          const isCurrent = step.id === currentStepId;

          const cardClass = isDone
            ? 'rounded-[var(--radius-lg)] border border-border-divider bg-bg-primary p-[var(--spacing-4)] opacity-60'
            : isCurrent
              ? 'rounded-[var(--radius-lg)] border border-border-focus bg-bg-secondary p-[var(--spacing-4)]'
              : 'rounded-[var(--radius-lg)] border border-border-divider bg-bg-primary p-[var(--spacing-4)]';

          return (
            <div key={step.id} className={cardClass}>
              <div className="flex items-start gap-[var(--spacing-3)]">
                {/* Status icon */}
                <div className="flex-shrink-0 mt-[var(--spacing-0-5)]">
                  {isDone ? (
                    <span className="text-[#5A9E78] text-[length:var(--font-size-base)] font-bold leading-none">
                      &#10003;
                    </span>
                  ) : (
                    <span className="text-text-tertiary text-[length:var(--font-size-base)] leading-none">
                      &#9675;
                    </span>
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0 flex flex-col gap-[var(--spacing-1-5)]">
                  <span className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary">
                    {step.label}
                  </span>
                  <p className="text-[length:var(--font-size-sm)] text-text-tertiary">
                    {step.description}
                  </p>
                  <div className="flex items-center gap-[var(--spacing-2)]">
                    <code className="font-mono text-[length:var(--font-size-sm)] bg-bg-primary border border-border-divider rounded px-[var(--spacing-2)] py-[var(--spacing-0-5)] text-text-primary">
                      {step.command}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(step)}
                      className="cursor-pointer text-text-tertiary hover:text-text-primary text-[length:var(--font-size-sm)] transition-colors"
                    >
                      {copied === step.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
