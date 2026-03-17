import type { ReactNode } from 'react';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { MainContent } from './MainContent.js';

// ---------------------------------------------------------------------------
// Layout — warm minimal 3-panel layout (fixed TopBar + fixed Sidebar + Content)
// ---------------------------------------------------------------------------

export function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-bg-primary">
      {/* Fixed Top Bar */}
      <TopBar />

      {/* Main area: Fixed Sidebar + Scrollable Content */}
      <div className="flex pt-[var(--size-topbar-height)] min-h-screen">
        <Sidebar />
        <MainContent>{children}</MainContent>
      </div>
    </div>
  );
}
