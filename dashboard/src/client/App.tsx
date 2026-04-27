import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/client/components/layout/AppLayout.js';

// ---------------------------------------------------------------------------
// Lazy-loaded routes
// ---------------------------------------------------------------------------

const KanbanPage = lazy(() =>
  import('@/client/pages/KanbanPage.js').then((m) => ({ default: m.KanbanPage }))
);

const ArtifactsPage = lazy(() =>
  import('@/client/pages/ArtifactsPage.js').then((m) => ({ default: m.ArtifactsPage }))
);

const ChatPage = lazy(() =>
  import('@/client/pages/chat/ChatPage.js').then((m) => ({ default: m.ChatPage })),
);

const WorkflowPage = lazy(() =>
  import('@/client/pages/WorkflowPage.js').then((m) => ({ default: m.WorkflowPage })),
);

const McpPage = lazy(() =>
  import('@/client/pages/McpPage.js').then((m) => ({ default: m.McpPage })),
);

const SpecsPage = lazy(() =>
  import('@/client/pages/SpecsPage.js').then((m) => ({ default: m.SpecsPage })),
);


const TeamsPage = lazy(() =>
  import('@/client/pages/TeamsPage.js').then((m) => ({ default: m.TeamsPage })),
);

const RequirementPage = lazy(() =>
  import('@/client/pages/RequirementPage.js').then((m) => ({ default: m.RequirementPage })),
);

const RequirementBoardPage = lazy(() =>
  import('@/client/pages/RequirementBoardPage.js').then((m) => ({ default: m.RequirementBoardPage })),
);

const SupervisorPage = lazy(() =>
  import('@/client/pages/SupervisorPage.js').then((m) => ({ default: m.SupervisorPage })),
);

const CollabPage = lazy(() =>
  import('@/client/pages/CollabPage.js').then((m) => ({ default: m.CollabPage })),
);

const MeetingRoomPage = lazy(() =>
  import('@/client/pages/MeetingRoomPage.js').then((m) => ({ default: m.MeetingRoomPage })),
);

const RoomsPage = lazy(() =>
  import('@/client/pages/RoomsPage.js').then((m) => ({ default: m.RoomsPage })),
);

// ---------------------------------------------------------------------------
// App — root component with React Router v6 layout routes
// ---------------------------------------------------------------------------

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
      Loading...
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/kanban" replace />} />
          <Route
            path="kanban"
            element={
              <Suspense fallback={<LazyFallback />}>
                <KanbanPage />
              </Suspense>
            }
          />
          <Route
            path="artifacts"
            element={
              <Suspense fallback={<LazyFallback />}>
                <ArtifactsPage />
              </Suspense>
            }
          />
          <Route
            path="chat"
            element={
              <Suspense fallback={<LazyFallback />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="workflow"
            element={
              <Suspense fallback={<LazyFallback />}>
                <WorkflowPage />
              </Suspense>
            }
          />
          <Route
            path="mcp"
            element={
              <Suspense fallback={<LazyFallback />}>
                <McpPage />
              </Suspense>
            }
          />
          <Route
            path="specs"
            element={
              <Suspense fallback={<LazyFallback />}>
                <SpecsPage />
              </Suspense>
            }
          />
          {/* Wiki merged into /artifacts */}
          <Route path="wiki" element={<Navigate to="/artifacts" replace />} />
          <Route
            path="teams"
            element={
              <Suspense fallback={<LazyFallback />}>
                <TeamsPage />
              </Suspense>
            }
          />
          <Route
            path="requirement"
            element={
              <Suspense fallback={<LazyFallback />}>
                <RequirementPage />
              </Suspense>
            }
          />
          <Route
            path="requirement/:id/board"
            element={
              <Suspense fallback={<LazyFallback />}>
                <RequirementBoardPage />
              </Suspense>
            }
          />
          <Route
            path="supervisor"
            element={
              <Suspense fallback={<LazyFallback />}>
                <SupervisorPage />
              </Suspense>
            }
          />
          <Route
            path="collab"
            element={
              <Suspense fallback={<LazyFallback />}>
                <CollabPage />
              </Suspense>
            }
          />
          <Route
            path="rooms"
            element={
              <Suspense fallback={<LazyFallback />}>
                <RoomsPage />
              </Suspense>
            }
          />
          <Route
            path="meeting-room/:sessionId"
            element={
              <Suspense fallback={<LazyFallback />}>
                <MeetingRoomPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/kanban" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
