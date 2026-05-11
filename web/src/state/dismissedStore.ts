import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const KEY = 'dismissed_announcements.v1';

type State = {
  ids: number[];
  dismiss: (id: number) => void;
  isDismissed: (id: number) => boolean;
};

export const useDismissedStore = create<State>((set, get) => ({
  ids: [],
  dismiss: (id) => {
    const s = get().ids;
    if (s.includes(id)) return;
    const next = [...s, id];
    set({ ids: next });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void idbSet(KEY, next), 500);
  },
  isDismissed: (id) => get().ids.includes(id),
}));

let saveTimer: number | undefined;

void (async () => {
  try {
    const stored = (await idbGet(KEY)) as number[] | undefined;
    if (stored) useDismissedStore.setState({ ids: stored });
  } catch {
    // ignore
  }
})();
