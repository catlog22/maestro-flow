import { useI18n } from '@/client/i18n/index.js';
import { MarkdownRenderer } from '@/client/components/content/MarkdownRenderer.js';
import { ExecutionFlow } from '@/client/components/content/ExecutionFlow.js';
import { TerminalBlock } from '@/client/components/content/GuideComponents.js';
import { loadCommand, type CommandContent } from '@/client/data/index.js';
import { getCommandMetadata, type CommandMetadata } from '@/client/data/commandMetadata.js';
import { getCommandExamples } from '@/client/data/commandExamples.js';
import { getCategoryIcon } from '@/client/utils/categoryIcons.js';
import type { Category, Command } from '@/client/routes/route-config.js';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// CommandDetailPage — bilingual command documentation with structured intro
// ---------------------------------------------------------------------------

interface CommandDetailPageProps {
  commandName: string;
  category: Category;
  command: Command;
}

export default function CommandDetailPage({ commandName, category, command }: CommandDetailPageProps) {
  const { t, locale } = useI18n();
  const [content, setContent] = useState<CommandContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const meta = getCommandMetadata(commandName);
  const examples = getCommandExamples(commandName);
  const isZh = locale === 'zh-CN';

  useEffect(() => {
    async function fetchContent() {
      try {
        setLoading(true);
        setError(null);
        const data = await loadCommand(commandName);
        setContent(data);
        if (!data) setError(`Command "${commandName}" not found`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load command');
      } finally {
        setLoading(false);
      }
    }
    fetchContent();
  }, [commandName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[var(--spacing-12)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-[var(--spacing-4)] bg-tint-orange border border-border rounded-[var(--radius-lg)]">
        <p className="text-accent-red">{error}</p>
      </div>
    );
  }

  // Resolve display name and description based on locale
  const displayName = isZh && meta?.name_zh ? `${content?.name || command.name} · ${meta.name_zh}` : (content?.name || command.name);
  const displayDescription = isZh && meta?.description_zh ? meta.description_zh : (content?.description || command.description);

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
          <span className="text-[length:24px]">{getCategoryIcon(category.id)}</span>
          <div>
            <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3]">
              {displayName}
            </h1>
            <p className="text-[length:12px] text-text-tertiary">{t(`categories.${category.id}`) !== `categories.${category.id}` ? t(`categories.${category.id}`) : category.name}</p>
          </div>
        </div>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)]">
          {displayDescription}
        </p>
      </div>

      {/* Usage */}
      {(content?.argumentHint || command.argumentHint) && (
        <Section title={t('content.usage')}>
          <TerminalBlock title="Terminal" compact>
            <code className="text-[length:12px] text-[#bd9cfe] dark:text-[#bd9cfe]">
              /{command.name} {content?.argumentHint || command.argumentHint}
            </code>
          </TerminalBlock>
        </Section>
      )}

      {/* Workflow Connections — shown when metadata available */}
      {meta && (meta.workflow || meta.workflow_zh || (meta.prev_commands?.length ?? 0) > 0 || (meta.next_commands?.length ?? 0) > 0) && (
        <Section title={t('content.section_workflow')}>
          <WorkflowSection meta={meta} isZh={isZh} commandName={commandName} />
        </Section>
      )}

      {/* Flags / Key Options — shown when in zh-CN and flags available */}
      {isZh && meta?.flags && meta.flags.length > 0 && (
        <Section title="主要参数">
          <div className="flex flex-col gap-[var(--spacing-1-5)]">
            {meta.flags.map((flag, i) => (
              <div key={i} className="flex items-start gap-[var(--spacing-3)] px-[var(--spacing-3)] py-[var(--spacing-2)] bg-bg-secondary rounded-[var(--radius-default)]">
                <span className="text-[length:var(--font-size-sm)] text-text-secondary leading-relaxed">{flag}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Execution Flow Simulation */}
      {examples && examples.length > 0 && (
        <Section title={isZh ? '执行流程模拟' : 'Execution Flow'}>
          <ExecutionFlow examples={examples} isZh={isZh} />
        </Section>
      )}

      {/* Purpose */}
      {content?.purpose && (
        <Section title={t('content.section_purpose')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.purpose} /></div>
        </Section>
      )}

      {/* Required Reading */}
      {content?.requiredReading && (
        <Section title={t('content.section_required_reading')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.requiredReading} /></div>
        </Section>
      )}

      {/* Context */}
      {content?.context && (
        <Section title={t('content.section_context')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.context} /></div>
        </Section>
      )}

      {/* Execution */}
      {content?.execution && (
        <Section title={t('content.section_execution')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.execution} /></div>
        </Section>
      )}

      {/* Error Codes */}
      {content?.errorCodes && (
        <Section title={t('content.section_error_codes')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.errorCodes} /></div>
        </Section>
      )}

      {/* Success Criteria */}
      {content?.successCriteria && (
        <Section title={t('content.section_success_criteria')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.successCriteria} /></div>
        </Section>
      )}

      {/* Allowed tools */}
      {content?.allowedTools && content.allowedTools.length > 0 && (
        <Section title={t('content.allowed_tools')}>
          <div className="flex flex-wrap gap-[var(--spacing-2)]">
            {content.allowedTools.map((tool) => (
              <span key={tool} className="px-[var(--spacing-2)] py-[var(--spacing-1)] bg-bg-secondary border border-border rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)] text-text-secondary font-mono">
                {tool}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* File reference */}
      {command.file && (
        <Section title={t('content.file_reference')}>
          <TerminalBlock title="Source" compact>
            <code className="text-[length:12px] text-[#bd9cfe] dark:text-[#bd9cfe]">{command.file}</code>
          </TerminalBlock>
        </Section>
      )}

      {/* Full documentation fallback */}
      {content?.rawContent && !content.purpose && (
        <Section title={t('content.section_documentation')}>
          <div className="text-text-secondary"><MarkdownRenderer content={content.rawContent} /></div>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowSection — visual workflow position with prev/next links
// ---------------------------------------------------------------------------

function WorkflowSection({ meta, isZh, commandName }: { meta: CommandMetadata; isZh: boolean; commandName: string }) {
  const { t } = useI18n();
  const workflowText = isZh ? (meta.workflow_zh || meta.workflow) : meta.workflow;
  const hasPrev = (meta.prev_commands?.length ?? 0) > 0;
  const hasNext = (meta.next_commands?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-[var(--spacing-4)]">
      {/* Workflow position string */}
      {workflowText && (
        <TerminalBlock title="Workflow" compact>
          <code className="text-[length:12px] text-[#bd9cfe] dark:text-[#bd9cfe]">
            {workflowText}
          </code>
        </TerminalBlock>
      )}

      {/* Prev / Next command links */}
      {(hasPrev || hasNext) && (
        <div className="flex flex-col sm:flex-row gap-[var(--spacing-4)]">
          {hasPrev && (
            <div className="flex-1">
              <p className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[var(--letter-spacing-wide)] text-text-tertiary mb-[var(--spacing-2)]">
                {t('content.workflow_previous')}
              </p>
              <div className="flex flex-wrap gap-[var(--spacing-2)]">
                {meta.prev_commands!.map((cmd) => (
                  <CommandChip key={cmd} name={cmd} commandName={commandName} />
                ))}
              </div>
            </div>
          )}
          {hasNext && (
            <div className="flex-1">
              <p className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[var(--letter-spacing-wide)] text-text-tertiary mb-[var(--spacing-2)]">
                {t('content.workflow_next')}
              </p>
              <div className="flex flex-wrap gap-[var(--spacing-2)]">
                {meta.next_commands!.map((cmd) => (
                  <CommandChip key={cmd} name={cmd} commandName={commandName} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandChip — clickable chip linking to a related command
// ---------------------------------------------------------------------------

function CommandChip({ name, commandName }: { name: string; commandName: string }) {
  // Derive category and slug from command name
  const parts = name.split('-');
  const category = parts[0];
  const slug = parts.length > 1 ? parts.slice(1).join('-') : name;

  // Map known prefixes to categories
  const categoryMap: Record<string, string> = {
    maestro: 'maestro',
    spec: 'spec',
    quality: 'quality',
    manage: 'manage',
    team: 'team',
  };
  const resolvedCategory = categoryMap[category] || category;
  const href = `/${resolvedCategory}/${slug}`;

  const isCurrent = name === commandName;

  return (
    <Link
      to={href}
      className={[
        'px-[var(--spacing-3)] py-[var(--spacing-1)] rounded-full text-[length:var(--font-size-sm)] font-mono transition-colors duration-[var(--duration-fast)]',
        isCurrent
          ? 'bg-accent-blue/10 text-accent-blue cursor-default pointer-events-none'
          : 'bg-bg-secondary border border-border text-text-secondary hover:border-text-placeholder hover:text-text-primary',
      ].join(' ')}
    >
      /{name}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section — section with h2 border-bottom
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-[var(--spacing-8)]">
      <h2 className="text-[length:20px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-4)] pb-[var(--spacing-2)] border-b border-border-divider">
        {title}
      </h2>
      {children}
    </section>
  );
}
