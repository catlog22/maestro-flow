import { Suspense, lazy } from 'react';
import { I18nProvider } from './i18n/index.js';
import { Layout } from './components/layout/Layout.js';
import { inventoryData, getCommandSlug } from './routes/route-config.js';

// Lazy load pages for code splitting
const LandingPage = lazy(() => import('./pages/LandingPage.js'));
const CategoryPage = lazy(() => import('./pages/CategoryPage.js'));
const CommandDetailPage = lazy(() => import('./pages/CommandDetailPage.js'));
const SkillDetailPage = lazy(() => import('./pages/SkillDetailPage.js'));
const SearchPage = lazy(() => import('./pages/SearchPage.js'));
const GuidesIndexPage = lazy(() => import('./pages/GuidesIndexPage.js'));
const GuidePage = lazy(() => import('./pages/GuidePage.js'));

// Import Router components
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';

// Route wrapper for guide pages (extracts slug from URL params)
function GuideRouteWrapper() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return <Navigate to="/guides" replace />;
  return <GuidePage slug={slug} />;
}

// ---------------------------------------------------------------------------
// App — root component with i18n provider, router, and layout
// ---------------------------------------------------------------------------

export function App() {
  return (
    <I18nProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        <Layout>
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
              </div>
            }
          >
            <Routes>
              {/* Home */}
              <Route path="/" element={<LandingPage categories={inventoryData.categories} />} />

              {/* Category pages */}
              {inventoryData.categories.map((category) => (
                <Route
                  key={category.id}
                  path={`/${category.id}`}
                  element={
                    <CategoryPage
                      categoryId={category.id}
                      category={category}
                      commands={inventoryData.commands.filter((c) => c.category === category.id)}
                      claudeSkills={inventoryData.claude_skills.filter((s) => s.category === category.id)}
                      codexSkills={inventoryData.codex_skills.filter((s) => s.category === category.id)}
                    />
                  }
                />
              ))}

              {/* Command detail pages */}
              {inventoryData.commands.map((command) => {
                const slug = getCommandSlug(command.name);
                return (
                  <Route
                    key={command.name}
                    path={`/${command.category}/${slug}`}
                    element={
                      <CommandDetailPage
                        commandName={command.name}
                        category={inventoryData.categories.find((c) => c.id === command.category)!}
                        command={command}
                      />
                    }
                  />
                );
              })}

              {/* Claude Skills detail pages */}
              {inventoryData.claude_skills.map((skill) => (
                <Route
                  key={`claude-${skill.name}`}
                  path={`/skills/${skill.name}`}
                  element={
                    <SkillDetailPage
                      skillName={skill.name}
                      skillType="claude"
                      skill={skill}
                      category={inventoryData.categories.find((c) => c.id === skill.category)!}
                    />
                  }
                />
              ))}

              {/* Codex Skills detail pages */}
              {inventoryData.codex_skills.map((skill) => (
                <Route
                  key={`codex-${skill.name}`}
                  path={`/codex/${skill.name}`}
                  element={
                    <SkillDetailPage
                      skillName={skill.name}
                      skillType="codex"
                      skill={skill}
                      category={inventoryData.categories.find((c) => c.id === skill.category)!}
                    />
                  }
                />
              ))}

              {/* Search page */}
              <Route path="/search" element={<SearchPage />} />

              {/* Guides */}
              <Route path="/guides" element={<GuidesIndexPage />} />
              <Route path="/guides/:slug" element={<GuideRouteWrapper />} />

              {/* Catch-all - redirect to home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </I18nProvider>
  );
}
