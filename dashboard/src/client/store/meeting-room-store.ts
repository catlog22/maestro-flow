import { create } from 'zustand';
import type {
  RoomAgentStatus,
  RoomAgent,
  RoomTask,
  RoomMailboxMessage,
  RoomSessionSnapshot,
  RoomSessionStatus,
} from '@/shared/team-types.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LayoutMode = 'chat' | 'terminal' | 'split';
export type TerminalLayoutMode = 'single' | 'split-h' | 'split-v' | 'grid-2x2';

export interface InputTarget {
  mode: 'broadcast' | 'direct';
  role?: string;
}

// ---------------------------------------------------------------------------
// MeetingRoom store — state for a single room session
// ---------------------------------------------------------------------------

export interface MeetingRoomStore {
  // State
  sessionId: string | null;
  sessionStatus: RoomSessionStatus | null;
  layoutMode: LayoutMode;
  terminalLayoutMode: TerminalLayoutMode;
  expandedTerminals: string[];
  splitRatio: number;
  inputTarget: InputTarget;
  agents: RoomAgent[];
  messages: RoomMailboxMessage[];
  tasks: RoomTask[];

  // Actions
  setSessionId: (sessionId: string | null) => void;
  setSessionStatus: (status: RoomSessionStatus) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setTerminalLayoutMode: (mode: TerminalLayoutMode) => void;
  expandTerminal: (role: string) => void;
  collapseTerminal: (role: string) => void;
  setSplitRatio: (ratio: number) => void;
  setInputTarget: (target: InputTarget) => void;
  sendMessage: (content: string) => void;

  // Room event handlers (called from WS dispatch)
  handleSnapshot: (snapshot: RoomSessionSnapshot) => void;
  handleAgentJoined: (agent: RoomAgent) => void;
  handleAgentLeft: (role: string) => void;
  handleAgentStatus: (role: string, status: RoomAgentStatus) => void;
  handleMessage: (msg: RoomMailboxMessage) => void;
  handleTaskCreated: (task: RoomTask) => void;
  handleTaskUpdated: (taskId: string, patch: Partial<RoomTask>) => void;
  handleRoomClosed: () => void;

  // Reset
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const INITIAL_STATE = {
  sessionId: null as string | null,
  sessionStatus: null as RoomSessionStatus | null,
  layoutMode: 'split' as LayoutMode,
  terminalLayoutMode: 'grid-2x2' as TerminalLayoutMode,
  expandedTerminals: [] as string[],
  splitRatio: 60,
  inputTarget: { mode: 'broadcast' } as InputTarget,
  agents: [] as RoomAgent[],
  messages: [] as RoomMailboxMessage[],
  tasks: [] as RoomTask[],
};

export const useMeetingRoomStore = create<MeetingRoomStore>((set, get) => ({
  ...INITIAL_STATE,

  setSessionId: (sessionId) => set({ sessionId }),

  setSessionStatus: (status) => set({ sessionStatus: status }),

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  setTerminalLayoutMode: (mode) => set({ terminalLayoutMode: mode }),

  expandTerminal: (role) =>
    set((s) => {
      if (s.expandedTerminals.includes(role)) return s;
      return { expandedTerminals: [...s.expandedTerminals, role] };
    }),

  collapseTerminal: (role) =>
    set((s) => ({
      expandedTerminals: s.expandedTerminals.filter((r) => r !== role),
    })),

  setSplitRatio: (ratio) => set({ splitRatio: ratio }),

  setInputTarget: (target) => set({ inputTarget: target }),

  sendMessage: (content) => {
    const { sessionId, inputTarget, agents } = get();
    if (!sessionId || !content.trim()) return;
    const trimmed = content.trim();

    // Parse @mention at start of message: "@role message" → direct to role
    const mentionMatch = trimmed.match(/^@(\S+)\s+([\s\S]+)/);
    if (mentionMatch) {
      const role = mentionMatch[1];
      const body = mentionMatch[2].trim();
      if (agents.some((a) => a.role === role) && body) {
        sendWsMessage({
          action: 'room:send_message',
          sessionId,
          to: role,
          content: body,
        });
        return;
      }
    }

    if (inputTarget.mode === 'broadcast') {
      sendWsMessage({
        action: 'room:broadcast',
        sessionId,
        content: trimmed,
      });
    } else if (inputTarget.role) {
      sendWsMessage({
        action: 'room:send_message',
        sessionId,
        to: inputTarget.role,
        content: trimmed,
      });
    }
  },

  // Room event handlers

  handleSnapshot: (snapshot) =>
    set({
      sessionId: snapshot.sessionId,
      sessionStatus: snapshot.status,
      agents: snapshot.agents,
      messages: snapshot.messages,
      tasks: snapshot.tasks,
    }),

  handleAgentJoined: (agent) =>
    set((s) => {
      const exists = s.agents.some((a) => a.role === agent.role);
      if (exists) {
        return { agents: s.agents.map((a) => (a.role === agent.role ? agent : a)) };
      }
      return { agents: [...s.agents, agent] };
    }),

  handleAgentLeft: (role) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.role !== role),
    })),

  handleAgentStatus: (role, status) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.role === role ? { ...a, status, lastActivityAt: new Date().toISOString() } : a,
      ),
    })),

  handleMessage: (msg) =>
    set((s) => {
      const exists = s.messages.some((m) => m.id === msg.id);
      if (exists) return s;
      return { messages: [...s.messages, msg] };
    }),

  handleTaskCreated: (task) =>
    set((s) => ({
      tasks: [...s.tasks, task],
    })),

  handleTaskUpdated: (taskId, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    })),

  handleRoomClosed: () =>
    set({ sessionStatus: 'destroyed' }),

  reset: () => set({ ...INITIAL_STATE, expandedTerminals: [] }),
}));
