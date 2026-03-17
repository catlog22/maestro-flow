import { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '@/client/i18n/index.js';
import { inventoryData, getCommandsByCategory, getCommandSlug, type Command, type Skill } from '@/client/routes/route-config.js';

// ---------------------------------------------------------------------------
// Sidebar — warm minimal collapsible category navigation with colored dots
// ---------------------------------------------------------------------------

// Category color mapping for nav dots
const categoryColors: Record<string, string> = {
  pipeline: 'bg-accent-green',
  spec: 'bg-accent-blue',
  quality: 'bg-accent-orange',
  manage: 'bg-accent-gray',
  maestro: 'bg-accent-purple',
  team: 'bg-accent-yellow',
  cli: 'bg-accent-blue',
  brainstorm: 'bg-accent-orange',
  workflow: 'bg-accent-green',
  ddd: 'bg-accent-purple',
  issue: 'bg-accent-red',
  ui_design: 'bg-accent-pink',
  session: 'bg-accent-blue',
};

interface CategorySection {
  id: string;
  titleKey: string;
  commands: Command[];
  claudeSkills: Skill[];
  codexSkills: Skill[];
  isOpen: boolean;
}

export function Sidebar() {
  const { t } = useI18n();
  const location = useLocation();

  const defaultSections: CategorySection[] = useMemo(() => {
    return inventoryData.categories.map((cat) => ({
      id: cat.id,
      titleKey: `categories.${cat.id.replace('-', '_')}`,
      commands: getCommandsByCategory(cat.id),
      claudeSkills: inventoryData.claude_skills.filter((s) => s.category === cat.id),
      codexSkills: inventoryData.codex_skills.filter((s) => s.category === cat.id),
      isOpen: ['pipeline', 'spec', 'quality'].includes(cat.id),
    }));
  }, []);

  const [sections, setSections] = useState<CategorySection[]>(defaultSections);

  const isActivePath = (categoryId: string): boolean => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    return pathParts[0] === categoryId;
  };

  const toggleSection = (id: string) => {
    setSections((prev) =>
      prev.map((section) =>
        section.id === id ? { ...section, isOpen: !section.isOpen } : section
      )
    );
  };

  return (
    <aside
      role="navigation"
      aria-label={t('sidebar.categories')}
      className="fixed top-[var(--size-topbar-height)] bottom-0 left-0 w-[var(--size-sidebar-width)] bg-bg-secondary border-r border-border overflow-y-auto z-50"
    >
      <nav className="py-[var(--spacing-4)]" aria-label="Command categories">
        {sections.map((section) => (
          <SidebarSection
            key={section.id}
            section={section}
            isActive={isActivePath(section.id)}
            onToggle={() => toggleSection(section.id)}
          />
        ))}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// SidebarSection — collapsible section with group label and items
// ---------------------------------------------------------------------------

interface SidebarSectionProps {
  section: CategorySection;
  isActive: boolean;
  onToggle: () => void;
}

function SidebarSection({ section, isActive, onToggle }: SidebarSectionProps) {
  const { t } = useI18n();
  const hasItems = section.commands.length > 0 || section.claudeSkills.length > 0 || section.codexSkills.length > 0;
  const dotColor = categoryColors[section.id] || 'bg-accent-gray';

  return (
    <div className="px-[var(--spacing-3)] mb-[var(--spacing-2)]">
      {/* Section header — group label style */}
      <div className="flex items-center justify-between">
        <NavLink
          to={`/${section.id}`}
          className={({ isActive: linkIsActive }) => [
            'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-2)]',
            'text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[var(--letter-spacing-wide)]',
            'transition-all duration-[var(--duration-fast)]',
            'rounded-[var(--radius-default)] flex-1',
            linkIsActive || isActive
              ? 'text-text-primary'
              : 'text-text-tertiary hover:text-text-secondary',
          ].join(' ')}
        >
          {hasItems && (
            <svg
              className={[
                'w-3 h-3 transition-transform duration-[var(--duration-fast)]',
                section.isOpen ? 'rotate-12' : '',
              ].join(' ')}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          )}
          {t(section.titleKey)}
        </NavLink>

        {hasItems && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={section.isOpen}
            aria-label={`Toggle ${t(section.titleKey)} section`}
            className="p-1 rounded-[var(--radius-sm)] hover:bg-bg-hover text-text-tertiary transition-all duration-[var(--duration-fast)]"
          >
            <svg
              className={[
                'w-3 h-3 transition-transform duration-[var(--duration-fast)]',
                section.isOpen ? 'rotate-90' : '',
              ].join(' ')}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Section items */}
      {section.isOpen && hasItems && (
        <div className="mt-[var(--spacing-0-5)] flex flex-col gap-[var(--spacing-0-5)]">
          {section.commands.map((cmd) => (
            <SidebarItem
              key={cmd.name}
              category={section.id}
              item={getCommandSlug(cmd.name)}
              type="command"
              dotColor={dotColor}
            />
          ))}
          {section.claudeSkills.map((skill) => (
            <SidebarItem
              key={skill.name}
              category="skills"
              item={skill.name}
              type="claude-skill"
              dotColor="bg-accent-purple"
            />
          ))}
          {section.codexSkills.map((skill) => (
            <SidebarItem
              key={skill.name}
              category="codex"
              item={skill.name}
              type="codex-skill"
              dotColor="bg-accent-orange"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarItem — individual navigation item with colored dot
// ---------------------------------------------------------------------------

interface SidebarItemProps {
  category: string;
  item: string;
  type: 'command' | 'claude-skill' | 'codex-skill';
  dotColor: string;
}

function SidebarItem({ category, item, type, dotColor }: SidebarItemProps) {
  const href = `/${category}/${item}`;
  const location = useLocation();
  const isActive = location.pathname === href;

  // Badge for skill types
  const badge = type === 'claude-skill' ? (
    <span className="ml-auto text-[length:9px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[1px] rounded-full bg-status-bg-planning text-accent-purple">
      Skill
    </span>
  ) : type === 'codex-skill' ? (
    <span className="ml-auto text-[length:9px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[1px] rounded-full bg-status-bg-verifying text-accent-orange">
      Codex
    </span>
  ) : null;

  return (
    <NavLink
      to={href}
      className={[
        'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-1-5)]',
        'text-[length:var(--font-size-sm)]',
        'transition-all duration-[var(--duration-fast)]',
        'rounded-[var(--radius-default)]',
        isActive
          ? 'bg-bg-active text-text-primary font-[var(--font-weight-semibold)]'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotColor}`}></span>
      <span className="truncate">{item}</span>
      {badge}
    </NavLink>
  );
}
