import { useState } from 'react';
import { TerminalBlock } from './GuideComponents.js';

export interface ExecutionStep {
  name: string;
  description: string;
  detail?: string;
}

export interface CommandExample {
  scenario: string;
  command: string;
  steps: ExecutionStep[];
}

interface ExecutionFlowProps {
  examples: CommandExample[];
  isZh: boolean;
}

export function ExecutionFlow({ examples, isZh }: ExecutionFlowProps) {
  const [activeExample, setActiveExample] = useState(0);
  const [activeStep, setActiveStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  const example = examples[activeExample];
  if (!example) return null;

  const handlePlay = () => {
    setIsPlaying(true);
    setActiveStep(0);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step >= example.steps.length) {
        clearInterval(interval);
        setIsPlaying(false);
        return;
      }
      setActiveStep(step);
    }, 1200);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setActiveStep(-1);
  };

  return (
    <div className="flex flex-col gap-[var(--spacing-4)]">
      {/* Example selector pills — QuickStart category pill style */}
      {examples.length > 1 && (
        <div className="flex flex-wrap gap-[var(--spacing-1)]">
          {examples.map((ex, i) => (
            <button
              key={i}
              onClick={() => { setActiveExample(i); setActiveStep(-1); setIsPlaying(false); }}
              className={[
                'flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-1)]',
                'text-[length:var(--font-size-sm)] rounded-[var(--radius-full)]',
                'transition-all duration-[var(--duration-fast)]',
                i === activeExample
                  ? 'bg-accent-blue text-text-inverse font-[var(--font-weight-semibold)]'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
              ].join(' ')}
            >
              {ex.scenario}
            </button>
          ))}
        </div>
      )}

      {/* Command invocation in TerminalBlock — matches QuickStart ScenarioCard */}
      <TerminalBlock title="Terminal" compact>
        <div className="flex flex-col gap-[var(--spacing-0-5)]">
          <div className="flex items-center gap-[var(--spacing-2)]">
            <span className="text-[length:12px] text-[#8e8e8e] dark:text-[#686868]">$</span>
            <code className="text-[length:12px] text-[#bd9cfe] dark:text-[#bd9cfe]">/{example.command}</code>
          </div>
          <div className="flex items-center gap-[var(--spacing-2)]">
            <span className="text-[length:12px] text-[#8e8e8e] dark:text-[#686868] italic">
              # {example.scenario}
            </span>
          </div>
        </div>
      </TerminalBlock>

      {/* Play/Reset controls */}
      <div className="flex gap-[var(--spacing-2)]">
        <button
          onClick={handlePlay}
          disabled={isPlaying}
          className={[
            'flex items-center gap-[var(--spacing-1-5)] px-[var(--spacing-3)] py-[var(--spacing-1-5)]',
            'rounded-[var(--radius-full)] text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
            'transition-all duration-[var(--duration-fast)]',
            isPlaying
              ? 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
              : 'bg-accent-blue text-text-inverse hover:opacity-90',
          ].join(' ')}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          {isZh ? '模拟执行' : 'Simulate'}
        </button>
        {activeStep >= 0 && (
          <button
            onClick={handleReset}
            className="px-[var(--spacing-3)] py-[var(--spacing-1-5)] text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-[var(--radius-full)] text-[length:var(--font-size-sm)] transition-all duration-[var(--duration-fast)]"
          >
            {isZh ? '重置' : 'Reset'}
          </button>
        )}
      </div>

      {/* Step-by-step execution flow — QuickStart CommandCard style */}
      <div className="flex flex-col gap-[var(--spacing-2)]">
        {example.steps.map((step, i) => {
          const isActive = i === activeStep;
          const isDone = activeStep >= 0 && i < activeStep;
          const isPending = activeStep >= 0 && i > activeStep;

          return (
            <div
              key={i}
              onClick={() => { if (!isPlaying) setActiveStep(i); }}
              className={[
                'border rounded-[var(--radius-lg)] bg-bg-card px-[var(--spacing-4)] py-[var(--spacing-3)]',
                'transition-all duration-300 cursor-pointer',
                isActive
                  ? 'border-[var(--color-accent-blue)] ring-1 ring-[var(--color-accent-blue)] ring-opacity-30 shadow-md'
                  : isDone
                    ? 'border-[rgba(30,142,62,0.3)] bg-[rgba(30,142,62,0.03)]'
                    : isPending
                      ? 'border-border opacity-40'
                      : 'border-border hover:border-[var(--color-border-focused)] hover:shadow-md',
              ].join(' ')}
            >
              <div className="flex items-start gap-[var(--spacing-3)]">
                {/* Step number / status icon */}
                <span className={[
                  'flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-[length:13px] font-[var(--font-weight-bold)]',
                  isActive
                    ? 'bg-tint-blue text-accent-blue'
                    : isDone
                      ? 'bg-tint-green text-accent-green'
                      : 'bg-bg-secondary text-text-tertiary',
                ].join(' ')}>
                  {isDone ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    String(i + 1)
                  )}
                </span>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[var(--spacing-2)] mb-[var(--spacing-0-5)]">
                    <span className={[
                      'text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)]',
                      isActive ? 'text-accent-blue' : 'text-text-primary',
                    ].join(' ')}>
                      {step.name}
                    </span>
                    {isActive && (
                      <span className="flex items-center gap-[3px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                        <span className="text-[length:10px] text-accent-blue font-[var(--font-weight-medium)]">
                          {isZh ? '执行中' : 'Running'}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6]">
                    {step.description}
                  </p>
                  {step.detail && (isActive || isDone || activeStep < 0) && (
                    <p className="text-[length:11px] text-text-tertiary mt-[var(--spacing-1)] italic leading-[1.5]">
                      {step.detail}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
