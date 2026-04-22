import { useEffect, useContext, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ViewSwitcherContext } from '@/client/hooks/useViewSwitcher.js';
import { useCollabStore } from '@/client/store/collab-store.js';
import { CollabMembersList } from '@/client/components/collab/CollabMembersList.js';
import { CollabActivityFeed } from '@/client/components/collab/CollabActivityFeed.js';
import { ConflictHeatmap } from '@/client/components/collab/ConflictHeatmap.js';
import { CollaborationTimeline } from '@/client/components/collab/CollaborationTimeline.js';
import type { CollabPreflightResult } from '@/shared/collab-types.js';

// ---------------------------------------------------------------------------
// CollabPage — collaboration hub with setup flow + 3-tab workspace
// ---------------------------------------------------------------------------

type CollabTab = 'overview' | 'analysis' | 'history' | 'tasks';

const TAB_ITEMS = [
  { label: 'Overview', key: 'overview' as const, shortcut: '1' },
  { label: 'Analysis', key: 'analysis' as const, shortcut: '2' },
  { label: 'History', key: 'history' as const, shortcut: '3' },
] as const;

const TABS: CollabTab[] = ['overview', 'analysis', 'history'];

const tabVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function CollabPage() {
  const members = useCollabStore((s) => s.members);
  const loading = useCollabStore((s) => s.loading);
  const error = useCollabStore((s) => s.error);
  const activeTab = useCollabStore((s) => s.activeTab);
  const fetchMembers = useCollabStore((s) => s.fetchMembers);
  const fetchActivity = useCollabStore((s) => s.fetchActivity);
  const fetchPresence = useCollabStore((s) => s.fetchPresence);
  const fetchAggregated = useCollabStore((s) => s.fetchAggregated);
  const fetchPreflight = useCollabStore((s) => s.fetchPreflight);
  const setActiveTab = useCollabStore((s) => s.setActiveTab);
  const clearAll = useCollabStore((s) => s.clearAll);

  const [preflight, setPreflight] = useState<CollabPreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);

  // Register ViewSwitcher items in TopBar
  const { register, unregister } = useContext(ViewSwitcherContext);

  const handleTabSwitch = useCallback(
    (index: number) => setActiveTab(TABS[index]),
    [setActiveTab],
  );

  useEffect(() => {
    register({
      items: TAB_ITEMS.map((t) => ({ label: t.label, icon: null, shortcut: t.shortcut })),
      activeIndex: TABS.indexOf(activeTab),
      onSwitch: handleTabSwitch,
    });
  }, [activeTab, register, handleTabSwitch]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setActiveTab('overview');
      else if (e.key === '2') setActiveTab('analysis');
      else if (e.key === '3') setActiveTab('history');
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setActiveTab]);

  // Fetch preflight first, then full data if collab exists
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPreflightLoading(true);
      const result = await fetchPreflight();
      if (cancelled) return;
      setPreflight(result);
      setPreflightLoading(false);
      if (result?.exists) {
        void fetchMembers();
        void fetchActivity();
        void fetchPresence();
        void fetchAggregated();
      }
    })();
    return () => { cancelled = true; clearAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loading
  if (preflightLoading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary text-[length:var(--font-size-sm)]">
        Loading...
      </div>
    );
  }

  // Setup flow — collab directory doesn't exist
  if (!preflight?.exists) {
    return <CollabSetupView onRefresh={async () => {
      const result = await fetchPreflight();
      setPreflight(result);
      if (result?.exists) {
        void fetchMembers();
        void fetchActivity();
        void fetchPresence();
        void fetchAggregated();
      }
    }} />;
  }

  // Error state
  if (error && members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <span className="text-accent-red text-[length:var(--font-size-sm)]">
          Failed to load collaboration data
        </span>
        <span className="text-text-tertiary text-[length:var(--font-size-xs)]">{error}</span>
        <button
          type="button"
          onClick={() => { void fetchMembers(); void fetchActivity(); void fetchPresence(); }}
          className="px-3 py-1.5 rounded-[var(--radius-md)] text-[11px] font-semibold bg-bg-secondary border border-border text-text-secondary hover:text-text-primary transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={activeTab}
            className="h-full flex flex-col overflow-hidden"
            variants={tabVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'overview' && <CollabOverview />}
            {activeTab === 'analysis' && (
              <div className="p-4 h-full overflow-y-auto">
                <ConflictHeatmap />
              </div>
            )}
            {activeTab === 'history' && (
              <div className="px-4 pt-4 pb-0 h-full flex flex-col overflow-visible">
                <CollaborationTimeline />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollabSetupView — onboarding when collab is not initialized
// ---------------------------------------------------------------------------

function CollabSetupView({ onRefresh }: { onRefresh: () => void }) {
  const initCollab = useCollabStore((s) => s.initCollab);
  const [initializing, setInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  async function handleInit() {
    setInitializing(true);
    setInitError(null);
    const result = await initCollab();
    if (result.success) {
      onRefresh();
    } else {
      setInitError(result.error ?? 'Unknown error');
      setInitializing(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-[480px] w-full px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-[12px] bg-bg-secondary border border-border flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h2 className="text-[length:var(--font-size-xl)] font-bold text-text-primary mb-2">
            Team Collaboration
          </h2>
          <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-relaxed">
            Track team activity, detect file conflicts, and coordinate phase assignments across multiple developers.
          </p>
        </div>

        {/* Capabilities */}
        <div className="border border-border rounded-[var(--radius-md,6px)] bg-bg-secondary p-4 mb-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[
              { label: 'Member presence', desc: 'Online/away/offline status' },
              { label: 'Activity feed', desc: 'Real-time team actions' },
              { label: 'Conflict detection', desc: 'Overlapping file edits' },
              { label: 'Phase coordination', desc: 'Who works on what' },
              { label: 'Activity heatmap', desc: 'Concentration analysis' },
              { label: 'Collaboration timeline', desc: 'Historical view' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2 py-1">
                <span className="w-1 h-1 rounded-full bg-accent-green mt-[7px] shrink-0" />
                <div>
                  <div className="text-[length:var(--font-size-xs)] text-text-primary font-medium">{item.label}</div>
                  <div className="text-[10px] text-text-tertiary">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Init button */}
        <div className="text-center">
          <button
            type="button"
            onClick={handleInit}
            disabled={initializing}
            className="px-5 py-2.5 rounded-[var(--radius-md,6px)] text-[length:var(--font-size-sm)] font-semibold bg-text-primary text-bg-primary hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {initializing ? 'Initializing...' : 'Enable Team Collaboration'}
          </button>
          {initError && (
            <p className="text-[length:var(--font-size-xs)] text-accent-red mt-2">{initError}</p>
          )}
          <p className="text-[10px] text-text-quaternary mt-2">
            Creates .workflow/collab/ and registers you as the team owner
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollabOverview — main overview tab with sidebar
// ---------------------------------------------------------------------------

function CollabOverview() {
  const members = useCollabStore((s) => s.members);
  const presence = useCollabStore((s) => s.presence);

  const onlineCount = presence.filter((p) => p.status === 'online').length;
  const awayCount = presence.filter((p) => p.status === 'away').length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content — members + quick actions */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4">
        {/* Status bar */}
        <div className="flex items-center gap-4 mb-4 text-[length:var(--font-size-xs)]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
            <span className="text-text-secondary">{onlineCount} online</span>
          </div>
          {awayCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#eab308]" />
              <span className="text-text-secondary">{awayCount} away</span>
            </div>
          )}
          <span className="text-text-quaternary">{members.length} members total</span>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-4">
          <AddMemberButton />
          <QuickAction
            label="Sync Activity"
            command="maestro team sync"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>}
          />
          <QuickAction
            label="Team Status"
            command="maestro team status"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
          />
        </div>

        {/* Members list */}
        <CollabMembersList />
      </div>

      {/* Activity sidebar */}
      <div className="w-[320px] shrink-0 border-l border-border flex flex-col h-full bg-bg-primary">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-[length:var(--font-size-sm)] font-semibold text-text-primary">
            Activity
          </h3>
        </div>
        <div className="flex-1 overflow-hidden px-4 py-2">
          <CollabActivityFeed />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddMemberButton — inline form to add a team member
// ---------------------------------------------------------------------------

function AddMemberButton() {
  const addMember = useCollabStore((s) => s.addMember);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    const result = await addMember(trimmed, '', role);
    setSubmitting(false);
    if (result.success) {
      setName('');
      setRole('member');
      setOpen(false);
    } else {
      setError(result.error ?? 'Failed to add member');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-md,6px)] border border-border bg-bg-primary text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-all"
      >
        <span className="text-text-tertiary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        </span>
        <span>Add Member</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="w-[120px] px-2 py-1.5 rounded-[var(--radius-md,6px)] border border-border bg-bg-primary text-[11px] text-text-primary placeholder:text-text-quaternary outline-none focus:border-text-tertiary"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="px-1.5 py-1.5 rounded-[var(--radius-md,6px)] border border-border bg-bg-primary text-[11px] text-text-secondary outline-none"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="viewer">Viewer</option>
      </select>
      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="px-2.5 py-1.5 rounded-[var(--radius-md,6px)] text-[11px] font-semibold bg-text-primary text-bg-primary hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {submitting ? '...' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null); }}
        className="px-1.5 py-1.5 text-[11px] text-text-tertiary hover:text-text-primary"
      >
        Cancel
      </button>
      {error && <span className="text-[10px] text-accent-red">{error}</span>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// QuickAction — copyable CLI shortcut
// ---------------------------------------------------------------------------

function QuickAction({ label, command, icon }: { label: string; command: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title={`Copy: ${command}`}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-md,6px)] border border-border bg-bg-primary text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-all"
    >
      <span className="text-text-tertiary">{icon}</span>
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  );
}
