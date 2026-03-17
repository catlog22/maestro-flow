import { useI18n } from '@/client/i18n/index.js';
import { MarkdownRenderer } from '@/client/components/content/MarkdownRenderer.js';
import { loadSkill, type SkillContent } from '@/client/data/index.js';
import type { Category, Skill } from '@/client/routes/route-config.js';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// SkillDetailPage — warm minimal skill documentation
// ---------------------------------------------------------------------------

interface SkillDetailPageProps {
  skillName: string;
  skillType: 'claude' | 'codex';
  skill: Skill;
  category: Category;
}

export default function SkillDetailPage({ skillName, skillType, skill, category }: SkillDetailPageProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<SkillContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchContent() {
      try {
        setLoading(true);
        setError(null);
        const data = await loadSkill(skillType, skillName);
        setContent(data);
        if (!data) setError(`Skill "${skillName}" not found in ${skillType} skills`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load skill');
      } finally {
        setLoading(false);
      }
    }
    fetchContent();
  }, [skillName, skillType]);

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

  const allRoles = content?.roles || skill.roles || [];
  const allPhases = content?.phases || skill.phases || [];

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
          <span className="text-[length:24px]">{skillType === 'claude' ? '🤖' : '⚡'}</span>
          <div>
            <div className="flex items-center gap-[var(--spacing-2)]">
              <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3]">
                {content?.name || skill.name}
              </h1>
              <span
                className={[
                  'px-[var(--spacing-2)] py-[2px] text-[length:10px] rounded-full font-[var(--font-weight-semibold)] uppercase',
                  skillType === 'claude' ? 'bg-status-bg-planning text-accent-purple' : 'bg-status-bg-verifying text-accent-orange',
                ].join(' ')}
              >
                {skillType === 'claude' ? 'Claude Skill' : 'Codex Skill'}
              </span>
            </div>
            <p className="text-[length:12px] text-text-tertiary">{category.name}</p>
          </div>
        </div>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)]">
          {content?.description || skill.description}
        </p>
      </div>

      {/* Usage */}
      {content?.argumentHint && (
        <Section title={t('content.usage')}>
          <code className="block px-[var(--spacing-4)] py-[var(--spacing-3)] bg-bg-code text-text-code rounded-[var(--radius-lg)] text-[length:var(--font-size-sm)] font-mono overflow-x-auto">
            {`Skill({ skill: "${skillName}" }${content.argumentHint !== 'true' ? `, args: "${content.argumentHint}"` : ''})`}
          </code>
        </Section>
      )}

      {/* Roles */}
      {allRoles.length > 0 && (
        <Section title={t('content.roles')}>
          <div className="flex flex-wrap gap-[var(--spacing-2)]">
            {allRoles.map((role) => (
              <span key={role} className="px-[var(--spacing-3)] py-[var(--spacing-1)] bg-bg-secondary border border-border rounded-full text-[length:12px] text-text-secondary">
                {role}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Phases */}
      {allPhases.length > 0 && (
        <Section title={t('content.phases')}>
          <ol className="space-y-[var(--spacing-2)]">
            {allPhases.map((phase, index) => (
              <li key={phase} className="flex items-start gap-[var(--spacing-3)] text-[length:var(--font-size-sm)] text-text-secondary">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-tint-blue text-[length:11px] font-[var(--font-weight-semibold)] text-accent-blue shrink-0">
                  {index + 1}
                </span>
                <span>{phase}</span>
              </li>
            ))}
          </ol>
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

      {/* Path reference */}
      {skill.path && (
        <Section title={t('content.file_reference')}>
          <code className="inline-block px-[var(--spacing-2)] py-[var(--spacing-1)] bg-bg-secondary border border-border-divider rounded-[var(--radius-sm)] text-[length:12px] text-accent-purple font-mono">
            {skill.path}
          </code>
        </Section>
      )}

      {/* Full documentation */}
      {content?.rawContent && (
        <Section title="Documentation">
          <div className="text-text-secondary"><MarkdownRenderer content={content.rawContent} /></div>
        </Section>
      )}
    </div>
  );
}

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
