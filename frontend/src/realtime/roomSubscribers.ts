export interface RoomSubscribers {
  join: (room: string) => void;
  leave: (room: string) => boolean;
  count: (room: string) => number;
}

export function createRoomSubscribers(): RoomSubscribers {
  const counts = new Map<string, number>();
  return {
    join: (room) => {
      counts.set(room, (counts.get(room) ?? 0) + 1);
    },
    leave: (room) => {
      const remaining = (counts.get(room) ?? 0) - 1;
      if (remaining > 0) {
        counts.set(room, remaining);
        return false;
      }
      counts.delete(room);
      return true;
    },
    count: (room) => counts.get(room) ?? 0,
  };
}
