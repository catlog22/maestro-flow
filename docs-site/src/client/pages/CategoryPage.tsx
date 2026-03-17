import { useI18n } from '@/client/i18n/index.js';
import type { Category, Command, Skill } from '@/client/routes/route-config.js';
import { Link } from 'react-router-dom';
import { getCategoryIcon } from '@/client/utils/categoryIcons.js';

// ---------------------------------------------------------------------------
// CategoryPage — warm minimal category listing
// ---------------------------------------------------------------------------

interface CategoryPageProps {
  categoryId: string;
  category: Category;
  commands: Command[];
  claudeSkills: Skill[];
  codexSkills: Skill[];
}

export default function CategoryPage({
  categoryId,
  category,
  commands,
  claudeSkills,
  codexSkills,
}: CategoryPageProps) {
  const { t } = useI18n();

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
          <span className="text-[length:24px]">{getCategoryIcon(categoryId)}</span>
          <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3]">
            {category.name}
          </h1>
        </div>
        <p className="text-[length:var(--font-size-md)] text-text-secondary">
          {category.description}
        </p>
      </div>

      {/* Commands */}
      {commands.length > 0 && (
        <section className="mb-[var(--spacing-8)]">
          <h2 className="text-[length:20px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-4)] pb-[var(--spacing-2)] border-b border-border-divider">
            {t('sidebar.commands')} ({commands.length})
          </h2>
          <div className="space-y-[var(--spacing-2)]">
            {commands.map((cmd) => (
              <CommandCard key={cmd.name} command={cmd} categoryId={categoryId} />
            ))}
          </div>
        </section>
      )}

      {/* Claude Skills */}
      {claudeSkills.length > 0 && (
        <section className="mb-[var(--spacing-8)]">
          <h2 className="text-[length:20px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-4)] pb-[var(--spacing-2)] border-b border-border-divider">
            {t('sidebar.skills')} ({claudeSkills.length})
          </h2>
          <div className="space-y-[var(--spacing-2)]">
            {claudeSkills.map((skill) => (
              <SkillCard key={skill.name} skill={skill} skillType="claude" />
            ))}
          </div>
        </section>
      )}

      {/* Codex Skills */}
      {codexSkills.length > 0 && (
        <section className="mb-[var(--spacing-8)]">
          <h2 className="text-[length:20px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-4)] pb-[var(--spacing-2)] border-b border-border-divider">
            {t('sidebar.codex_skills')} ({codexSkills.length})
          </h2>
          <div className="space-y-[var(--spacing-2)]">
            {codexSkills.map((skill) => (
              <SkillCard key={skill.name} skill={skill} skillType="codex" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandCard
// ---------------------------------------------------------------------------

function CommandCard({ command, categoryId }: { command: Command; categoryId: string }) {
  const slug = getCommandSlug(command.name);
  return (
    <Link
      to={`/${categoryId}/${slug}`}
      className="block p-[var(--spacing-4)] bg-bg-card border border-border rounded-[var(--radius-lg)] no-underline transition-all duration-[180ms] ease-[var(--ease-bounce)] hover:border-text-placeholder hover:-translate-y-[1px] hover:shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start justify-between gap-[var(--spacing-3)]">
        <div className="min-w-0 flex-1">
          <h3 className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-1)]">
            {command.name}
          </h3>
          <p className="text-[length:12px] text-text-secondary line-clamp-2">
            {command.description}
          </p>
        </div>
        <svg className="w-4 h-4 text-text-placeholder shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// SkillCard
// ---------------------------------------------------------------------------

function SkillCard({ skill, skillType }: { skill: Skill; skillType: 'claude' | 'codex' }) {
  const href = skillType === 'claude' ? `/skills/${skill.name}` : `/codex/${skill.name}`;
  return (
    <Link
      to={href}
      className="block p-[var(--spacing-4)] bg-bg-card border border-border rounded-[var(--radius-lg)] no-underline transition-all duration-[180ms] ease-[var(--ease-bounce)] hover:border-text-placeholder hover:-translate-y-[1px] hover:shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start justify-between gap-[var(--spacing-3)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[var(--spacing-2)] mb-[var(--spacing-1)]">
            <h3 className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary">
              {skill.name}
            </h3>
            <span
              className={[
                'px-[var(--spacing-2)] py-[1px] text-[length:10px] rounded-full font-[var(--font-weight-semibold)]',
                skillType === 'claude' ? 'bg-status-bg-planning text-accent-purple' : 'bg-status-bg-verifying text-accent-orange',
              ].join(' ')}
            >
              {skillType === 'claude' ? 'Claude' : 'Codex'}
            </span>
          </div>
          <p className="text-[length:12px] text-text-secondary line-clamp-2">
            {skill.description}
          </p>
        </div>
        <svg className="w-4 h-4 text-text-placeholder shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </Link>
  );
}

function getCommandSlug(commandName: string): string {
  const parts = commandName.split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : commandName;
}
