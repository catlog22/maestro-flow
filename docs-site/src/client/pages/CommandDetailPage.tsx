import { useI18n } from '@/client/i18n/index.js';
import { MarkdownRenderer } from '@/client/components/content/MarkdownRenderer.js';
import { loadCommand, type CommandContent } from '@/client/data/index.js';
import { getCategoryIcon } from '@/client/utils/categoryIcons.js';
import type { Category, Command } from '@/client/routes/route-config.js';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// CommandDetailPage — warm minimal command documentation
// ---------------------------------------------------------------------------

interface CommandDetailPageProps {
  commandName: string;
  category: Category;
  command: Command;
}

export default function CommandDetailPage({ commandName, category, command }: CommandDetailPageProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<CommandContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
          <span className="text-[length:24px]">{getCategoryIcon(category.id)}</span>
          <div>
            <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3]">
              {content?.name || command.name}
            </h1>
            <p className="text-[length:12px] text-text-tertiary">{category.name}</p>
          </div>
        </div>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)]">
          {content?.description || command.description}
        </p>
      </div>

      {/* Usage */}
      {(content?.argumentHint || command.argumentHint) && (
        <Section title={t('content.usage')}>
          <code className="block px-[var(--spacing-4)] py-[var(--spacing-3)] bg-bg-code text-text-code rounded-[var(--radius-lg)] text-[length:var(--font-size-sm)] font-mono overflow-x-auto">
            /{command.name} {content?.argumentHint || command.argumentHint}
          </code>
        </Section>
      )}

      {/* Purpose */}
      {content?.purpose && (
        <Section title="Purpose">
          <div className="text-text-secondary"><MarkdownRenderer content={content.purpose} /></div>
        </Section>
      )}

      {/* Required Reading */}
      {content?.requiredReading && (
        <Section title="Required Reading">
          <div className="text-text-secondary"><MarkdownRenderer content={content.requiredReading} /></div>
        </Section>
      )}

      {/* Context */}
      {content?.context && (
        <Section title="Context">
          <div className="text-text-secondary"><MarkdownRenderer content={content.context} /></div>
        </Section>
      )}

      {/* Execution */}
      {content?.execution && (
        <Section title="Execution">
          <div className="text-text-secondary"><MarkdownRenderer content={content.execution} /></div>
        </Section>
      )}

      {/* Error Codes */}
      {content?.errorCodes && (
        <Section title="Error Codes">
          <div className="text-text-secondary"><MarkdownRenderer content={content.errorCodes} /></div>
        </Section>
      )}

      {/* Success Criteria */}
      {content?.successCriteria && (
        <Section title="Success Criteria">
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
          <code className="inline-block px-[var(--spacing-2)] py-[var(--spacing-1)] bg-bg-secondary border border-border-divider rounded-[var(--radius-sm)] text-[length:12px] text-accent-purple font-mono">
            {command.file}
          </code>
        </Section>
      )}

      {/* Full documentation fallback */}
      {content?.rawContent && !content.purpose && (
        <Section title="Documentation">
          <div className="text-text-secondary"><MarkdownRenderer content={content.rawContent} /></div>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — warm minimal section with h2 border-bottom
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
