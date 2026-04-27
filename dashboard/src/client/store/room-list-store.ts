import { create } from 'zustand';
import type { RoomSessionSummary } from '@/shared/team-types.js';

// ---------------------------------------------------------------------------
// Room List Store — manages room discovery/listing (separate from active room)
// ---------------------------------------------------------------------------

export interface RoomListStore {
  rooms: RoomSessionSummary[];
  loading: boolean;

  fetchRooms: () => Promise<void>;
  deleteRoom: (sessionId: string) => Promise<boolean>;

  // WS event handlers for real-time updates
  handleRoomCreated: (summary: RoomSessionSummary) => void;
  handleRoomClosed: (sessionId: string) => void;
}

export const useRoomListStore = create<RoomListStore>((set, get) => ({
  rooms: [],
  loading: false,

  fetchRooms: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const rooms = (await res.json()) as RoomSessionSummary[];
        set({ rooms, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  deleteRoom: async (sessionId) => {
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      if (res.ok) {
        set((s) => ({ rooms: s.rooms.filter((r) => r.sessionId !== sessionId) }));
        return true;
      }
    } catch { /* ignore */ }
    return false;
  },

  handleRoomCreated: (summary) =>
    set((s) => {
      if (s.rooms.some((r) => r.sessionId === summary.sessionId)) return s;
      return { rooms: [...s.rooms, summary] };
    }),

  handleRoomClosed: (sessionId) =>
    set((s) => ({
      rooms: s.rooms.map((r) =>
        r.sessionId === sessionId ? { ...r, status: 'destroyed' as const } : r,
      ),
    })),
}));
