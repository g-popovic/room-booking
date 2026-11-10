import { Plus, Users } from 'lucide-react';
import type { Room, RoomDetails } from '../lib/api';
import { RoomEditor } from './RoomEditor';
import styles from './BookingList.module.css';

export function ManageRooms({
  rooms,
  editing,
  onEdit,
  onSave,
}: {
  rooms: Room[] | undefined;
  editing: Room | null | undefined;
  onEdit: (room: Room | null | undefined) => void;
  onSave: (room: RoomDetails, id?: number) => Promise<void>;
}) {
  return (
    <>
      {editing !== undefined ? (
        <RoomEditor
          key={editing?.id ?? 'new'}
          room={editing}
          onSave={onSave}
          onClose={() => onEdit(undefined)}
        />
      ) : (
        <div className={styles.list}>
          <div className={styles.adminActions}>
            <button
              type="button"
              className="primary"
              onClick={() => onEdit(null)}
            >
              <Plus size={18} /> Add room
            </button>
          </div>
          {rooms?.map((room) => (
            <article key={room.id} className={styles.listItem}>
              <div>
                <h3>{room.name}</h3>
                <p>
                  <Users size={15} /> Capacity {room.capacity}
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                aria-label={`Edit ${room.name}`}
                onClick={() => onEdit(room)}
              >
                Edit room
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
