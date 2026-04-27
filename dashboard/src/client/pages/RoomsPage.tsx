import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Presentation from 'lucide-react/dist/esm/icons/presentation.js';
import { useRoomListStore } from '@/client/store/room-list-store.js';
import { RoomCard } from '@/client/components/rooms/RoomCard.js';
import { CreateRoomDialog } from '@/client/components/rooms/CreateRoomDialog.js';

// ---------------------------------------------------------------------------
// RoomsPage — list all meeting room sessions
// ---------------------------------------------------------------------------

export function RoomsPage() {
  const navigate = useNavigate();
  const rooms = useRoomListStore((s) => s.rooms);
  const loading = useRoomListStore((s) => s.loading);
  const fetchRooms = useRoomListStore((s) => s.fetchRooms);
  const deleteRoom = useRoomListStore((s) => s.deleteRoom);

  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const handleDelete = useCallback(async (sessionId: string) => {
    await deleteRoom(sessionId);
  }, [deleteRoom]);

  // Filter out destroyed rooms by default
  const visibleRooms = rooms.filter((r) => r.status !== 'destroyed');

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border-divider bg-bg-secondary shrink-0">
        <h1 className="text-[length:var(--font-size-base)] font-semibold text-text-primary">
          Meeting Rooms
        </h1>
        <span className="text-[11px] text-text-tertiary bg-bg-hover px-1.5 py-0.5 rounded-full">
          {visibleRooms.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent-blue text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          New Room
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading && visibleRooms.length === 0 && (
          <div className="flex items-center justify-center h-48 text-text-tertiary text-[length:var(--font-size-sm)]">
            Loading...
          </div>
        )}

        {!loading && visibleRooms.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-tertiary">
            <Presentation size={40} strokeWidth={1.2} className="opacity-30" />
            <p className="text-[length:var(--font-size-sm)]">No meeting rooms yet</p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent-blue text-white hover:opacity-90 transition-opacity"
            >
              <Plus size={14} />
              Create your first room
            </button>
          </div>
        )}

        {visibleRooms.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {visibleRooms.map((room) => (
              <RoomCard
                key={room.sessionId}
                room={room}
                onClick={() => navigate(`/meeting-room/${room.sessionId}`)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
