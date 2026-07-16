import { useState, useMemo, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '@/client/i18n/index.js';
import { useVersion } from '@/client/version/index.js';
import { useSidebar } from './SidebarContext.js';
import { getInventory, getCommandsByCategory, getCommandSlug, type Command, type Skill } from '@/client/routes/route-config.js';
import { getAllGuideMeta } from '@/client/data/index.js';
import { getGuideIcon } from '@/client/utils/guideIcons.js';
import { getCategoryIcon } from '@/client/utils/categoryIcons.js';

// ---------------------------------------------------------------------------
// Sidebar — Gemini CLI style: clean grouped navigation, blue active pills
// ---------------------------------------------------------------------------

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
  const { version } = useVersion();
  const location = useLocation();
  const { isOpen: isMobileOpen, close: closeSidebar } = useSidebar();

  useEffect(() => {
    closeSidebar();
  }, [location.pathname, closeSidebar]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        closeSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, closeSidebar]);

  const inv = useMemo(() => getInventory(version), [version]);

  const defaultSections: CategorySection[] = useMemo(() => {
    return inv.categories.map((cat) => ({
      id: cat.id,
      titleKey: `categories.${cat.id.replace('-', '_')}`,
      commands: getCommandsByCategory(cat.id, version),
      claudeSkills: inv.claude_skills.filter((s) => s.category === cat.id),
      codexSkills: inv.codex_skills.filter((s) => s.category === cat.id),
      isOpen: ['maestro', 'spec', 'quality'].includes(cat.id),
    }));
  }, [inv, version]);

  const [sections, setSections] = useState<CategorySection[]>(defaultSections);

  useEffect(() => {
    setSections(defaultSections);
  }, [defaultSections]);

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
    <>
      {/* Mobile backdrop overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        role="navigation"
        aria-label={t('sidebar.categories')}
        className={[
          'fixed left-0 w-[var(--size-sidebar-width)] overflow-y-auto',
          'bg-bg-primary border-r border-border-divider z-50',
          'transition-transform duration-[var(--duration-smooth)] ease-[var(--ease-notion)]',
          'max-lg:-translate-x-full',
          isMobileOpen ? 'max-lg:translate-x-0' : '',
        ].join(' ')}
        style={{ top: 'calc(var(--size-banner-height) + var(--size-topbar-height))', bottom: 0 }}
      >
        <nav className="py-[var(--spacing-4)]" aria-label={t('sidebar.aria_nav')}>
          {/* Quick Start - top level */}
          <SidebarQuickStartLink />

          {/* Divider */}
          <div className="mx-[var(--spacing-4)] my-[var(--spacing-2)] border-t border-border-divider" />

          {/* Guides section */}
          <SidebarGuidesSection />

          {/* Divider */}
          <div className="mx-[var(--spacing-4)] my-[var(--spacing-2)] border-t border-border-divider" />

          {/* Changelog link */}
          <SidebarChangelogLink />

          {/* Divider */}
          <div className="mx-[var(--spacing-4)] my-[var(--spacing-2)] border-t border-border-divider" />

          {/* Category sections */}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// SidebarSection — collapsible section with group label
// ---------------------------------------------------------------------------

interface SidebarSectionProps {
  section: CategorySection;
  isActive: boolean;
  onToggle: () => void;
}

function SidebarSection({ section, isActive, onToggle }: SidebarSectionProps) {
  const { t } = useI18n();
  const hasItems = section.commands.length > 0 || section.claudeSkills.length > 0 || section.codexSkills.length > 0;

  return (
    <div className="px-[var(--spacing-3)] mb-[var(--spacing-1)]">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <NavLink
          to={`/${section.id}`}
          className={({ isActive: linkIsActive }) => [
            'flex items-center gap-[var(--spacing-2)] px-[8px] py-[4.8px]',
            'text-[length:14px] font-[var(--font-weight-semibold)]',
            'transition-colors duration-[var(--duration-fast)]',
            'rounded-[var(--radius-sm)] flex-1',
            linkIsActive || isActive
              ? 'text-accent-blue'
              : 'text-text-tertiary hover:text-text-secondary',
          ].join(' ')}
        >
          <span className="text-[length:14px]">{getCategoryIcon(section.id)}</span>
          {t(section.titleKey)}
        </NavLink>

        {hasItems && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={section.isOpen}
            aria-label={`Toggle ${t(section.titleKey)} section`}
            className="p-1.5 min-w-7 min-h-7 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-bg-hover text-text-tertiary transition-colors duration-[var(--duration-fast)]"
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
        <div className="mt-[var(--spacing-0-5)] flex flex-col gap-px">
          {section.commands.map((cmd) => (
            <SidebarItem
              key={cmd.name}
              category={section.id}
              item={getCommandSlug(cmd.name)}
              type="command"
            />
          ))}
          {section.claudeSkills.map((skill) => (
            <SidebarItem
              key={skill.name}
              category="skills"
              item={skill.name}
              type="claude-skill"
            />
          ))}
          {section.codexSkills.map((skill) => (
            <SidebarItem
              key={skill.name}
              category="codex"
              item={skill.name}
              type="codex-skill"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarItem — Gemini CLI style: blue pill for active state
// ---------------------------------------------------------------------------

interface SidebarItemProps {
  category: string;
  item: string;
  type: 'command' | 'claude-skill' | 'codex-skill';
}

function SidebarItem({ category, item, type }: SidebarItemProps) {
  const { t } = useI18n();
  const href = `/${category}/${item}`;
  const location = useLocation();
  const isActive = location.pathname === href;

  // Icon per type
  const icon = type === 'command' ? (
    <svg className="w-3.5 h-3.5 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ) : type === 'claude-skill' ? (
    <svg className="w-3.5 h-3.5 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  );

  const badge = type === 'claude-skill' ? (
    <span className="ml-auto text-[length:9px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[1px] rounded-[var(--radius-full)] bg-tint-purple text-accent-purple">
      {t('sidebar.badge_skill')}
    </span>
  ) : type === 'codex-skill' ? (
    <span className="ml-auto text-[length:9px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[1px] rounded-[var(--radius-full)] bg-tint-orange text-accent-orange">
      {t('sidebar.badge_codex')}
    </span>
  ) : null;

  return (
    <NavLink
      to={href}
      className={[
        'flex items-center gap-[var(--spacing-2)] px-[8px] py-[4.2px]',
        'text-[length:14px]',
        'transition-all duration-[var(--duration-fast)]',
        'rounded-[var(--radius-sm)]',
        isActive
          ? 'bg-accent-blue text-text-inverse font-[var(--font-weight-semibold)]'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className={isActive ? 'text-white' : ''}>{icon}</span>
      <span className="truncate">{item}</span>
      {badge}
    </NavLink>
  );
}

// ---------------------------------------------------------------------------
// SidebarGuidesSection
// ---------------------------------------------------------------------------

function SidebarGuidesSection() {
  const { t, locale } = useI18n();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);
  const isZh = locale === 'zh-CN';
  const guides = useMemo(() => getAllGuideMeta().filter((g) => g.slug !== 'quick-start'), []);
  const isGuidesActive = location.pathname.startsWith('/guides');

  return (
    <div className="px-[var(--spacing-3)] mb-[var(--spacing-1)]">
      <div className="flex items-center justify-between">
        <NavLink
          to="/guides"
          className={({ isActive: linkIsActive }) => [
            'flex items-center gap-[var(--spacing-2)] px-[8px] py-[4.8px]',
            'text-[length:14px] font-[var(--font-weight-semibold)]',
            'transition-colors duration-[var(--duration-fast)]',
            'rounded-[var(--radius-sm)] flex-1',
            linkIsActive || isGuidesActive
              ? 'text-accent-blue'
              : 'text-text-tertiary hover:text-text-secondary',
          ].join(' ')}
        >
          {getGuideIcon('book-open', 'w-3.5 h-3.5')}
          {t('sidebar.guides')}
        </NavLink>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className="p-1.5 min-w-7 min-h-7 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-bg-hover text-text-tertiary transition-colors duration-[var(--duration-fast)]"
        >
          <svg
            className={[
              'w-3 h-3 transition-transform duration-[var(--duration-fast)]',
              isOpen ? 'rotate-90' : '',
            ].join(' ')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="mt-[var(--spacing-0-5)] flex flex-col gap-px">
          {guides.map((guide) => {
            const href = `/guides/${guide.slug}`;
            const isActive = location.pathname === href;
            return (
              <NavLink
                key={guide.slug}
                to={href}
                className={[
                  'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-1)]',
                  'text-[length:var(--font-size-sm)]',
                  'transition-all duration-[var(--duration-fast)]',
                  'rounded-[var(--radius-sm)]',
                  isActive
                    ? 'bg-accent-blue text-text-inverse font-[var(--font-weight-semibold)]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                ].join(' ')}
              >
                <span className="shrink-0 text-text-tertiary">{getGuideIcon(guide.icon, 'w-3.5 h-3.5')}</span>
                <span className="truncate">{isZh && guide.title_zh ? guide.title_zh : guide.title}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarQuickStartLink — top-level entry, same hierarchy as Guides
// ---------------------------------------------------------------------------

function SidebarQuickStartLink() {
  const { t } = useI18n();
  const location = useLocation();
  const isActive = location.pathname === '/quick-start';

  return (
    <div className="px-[var(--spacing-3)]">
      <NavLink
        to="/quick-start"
        className={[
          'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-1-5)]',
          'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
          'transition-all duration-[var(--duration-fast)]',
          'rounded-[var(--radius-sm)]',
          isActive
            ? 'bg-accent-blue text-text-inverse'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
        ].join(' ')}
      >
        {getGuideIcon('rocket', 'w-4 h-4')}
        {t('sidebar.quick_start')}
      </NavLink>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarChangelogLink
// ---------------------------------------------------------------------------

function SidebarChangelogLink() {
  const { t } = useI18n();
  const location = useLocation();
  const isActive = location.pathname === '/changelog';

  return (
    <div className="px-[var(--spacing-3)]">
      <NavLink
        to="/changelog"
        className={[
          'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-1-5)]',
          'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
          'transition-all duration-[var(--duration-fast)]',
          'rounded-[var(--radius-sm)]',
          isActive
            ? 'bg-accent-blue text-text-inverse'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
        ].join(' ')}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        {t('nav.changelog')}
      </NavLink>
    </div>
  );
}
