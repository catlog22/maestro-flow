import { Suspense, lazy } from 'react';
import { I18nProvider } from './i18n/index.js';
import { VersionProvider, useVersion } from './version/index.js';
import { Layout } from './components/layout/Layout.js';
import { getAllCommands, getAllCategories, getCommandSlug, getInventory, getSkillsByCategory } from './routes/route-config.js';

// Lazy load pages for code splitting
const LandingPage = lazy(() => import('./pages/LandingPage.js'));
const CategoryPage = lazy(() => import('./pages/CategoryPage.js'));
const CommandDetailPage = lazy(() => import('./pages/CommandDetailPage.js'));
const SkillDetailPage = lazy(() => import('./pages/SkillDetailPage.js'));
const SearchPage = lazy(() => import('./pages/SearchPage.js'));
const GuidePage = lazy(() => import('./pages/GuidePage.js'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage.js'));
const QuickStartPage = lazy(() => import('./pages/QuickStartPage.js'));

// Import Router components
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';

// Route wrapper for guide pages (extracts slug from URL params)
function GuideRouteWrapper() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return <Navigate to="/guides" replace />;
  return <GuidePage slug={slug} />;
}

// Pre-compute all routes (union of v1+v2 commands) so URLs are stable
const allCommands = getAllCommands();
const allCategories = getAllCategories();
const allSkills = {
  claude: getInventory('v1').claude_skills,
  codex: getInventory('v1').codex_skills,
};

// ---------------------------------------------------------------------------
// VersionAwareRoutes — renders routes with version-filtered data
// ---------------------------------------------------------------------------

function VersionAwareRoutes() {
  const { version } = useVersion();
  const inv = getInventory(version);

  return (
    <Routes>
      {/* Home */}
      <Route path="/" element={<LandingPage categories={inv.categories} />} />

      {/* Category pages — version-aware commands */}
      {allCategories.map((category) => (
        <Route
          key={category.id}
          path={`/${category.id}`}
          element={
            <CategoryPage
              categoryId={category.id}
              category={inv.categories.find((c) => c.id === category.id) || category}
              commands={inv.commands.filter((c) => c.category === category.id)}
              claudeSkills={inv.claude_skills.filter((s) => s.category === category.id)}
              codexSkills={inv.codex_skills.filter((s) => s.category === category.id)}
            />
          }
        />
      ))}

      {/* Command detail pages — all versions registered for stable URLs */}
      {allCommands.map((command) => {
        const slug = getCommandSlug(command.name);
        const cat = allCategories.find((c) => c.id === command.category);
        if (!cat) return null;
        return (
          <Route
            key={command.name}
            path={`/${command.category}/${slug}`}
            element={
              <CommandDetailPage
                commandName={command.name}
                category={cat}
                command={command}
              />
            }
          />
        );
      })}

      {/* Claude Skills detail pages */}
      {allSkills.claude.map((skill) => (
        <Route
          key={`claude-${skill.name}`}
          path={`/skills/${skill.name}`}
          element={
            <SkillDetailPage
              skillName={skill.name}
              skillType="claude"
              skill={skill}
              category={allCategories.find((c) => c.id === skill.category)!}
            />
          }
        />
      ))}

      {/* Codex Skills detail pages */}
      {allSkills.codex.map((skill) => (
        <Route
          key={`codex-${skill.name}`}
          path={`/codex/${skill.name}`}
          element={
            <SkillDetailPage
              skillName={skill.name}
              skillType="codex"
              skill={skill}
              category={allCategories.find((c) => c.id === skill.category)!}
            />
          }
        />
      ))}

      {/* Search page */}
      <Route path="/search" element={<SearchPage />} />

      {/* Changelog page */}
      <Route path="/changelog" element={<ChangelogPage />} />

      {/* Quick Start - top-level route */}
      <Route path="/quick-start" element={<QuickStartPage />} />

      {/* Guides */}
      <Route path="/guides" element={<Navigate to="/guides/command-usage" replace />} />
      <Route path="/guides/:slug" element={<GuideRouteWrapper />} />

      {/* Catch-all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ---------------------------------------------------------------------------
// App — root component with i18n, version provider, router, and layout
// ---------------------------------------------------------------------------

export function App() {
  return (
    <I18nProvider>
      <VersionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        <Layout>
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
              </div>
            }
          >
            <VersionAwareRoutes />
          </Suspense>
        </Layout>
      </BrowserRouter>
      </VersionProvider>
    </I18nProvider>
  );
}
