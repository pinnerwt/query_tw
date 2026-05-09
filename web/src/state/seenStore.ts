import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const KEY = 'seen.v1';
const MAX = 5000;

type State = {
  seen: string[]; // LRU front-to-back
  markSeen: (id: string) => void;
  isSeen: (id: string) => boolean;
};

export const useSeenStore = create<State>((set, get) => ({
  seen: [],
  markSeen: (id) => {
    const s = get().seen;
    const next = [id, ...s.filter((x) => x !== id)].slice(0, MAX);
    set({ seen: next });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void idbSet(KEY, next), 500);
  },
  isSeen: (id) => get().seen.includes(id),
}));

let saveTimer: number | undefined;

void (async () => {
  try {
    const stored = (await idbGet(KEY)) as string[] | undefined;
    if (stored) useSeenStore.setState({ seen: stored });
  } catch {
    // ignore
  }
})();
