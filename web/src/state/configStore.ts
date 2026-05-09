import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ulid } from 'ulid';
import type { Config, Profile, Filters } from '../types';
import { defaultFilters } from '../types';

const KEY = 'config.v1';

function newProfile(name: string): Profile {
  return { id: ulid(), name, filters: defaultFilters() };
}

function emptyConfig(): Config {
  const p = newProfile('預設');
  return { version: 1, profiles: [p], active_profile_id: p.id, favorites: [] };
}

type State = {
  ready: boolean;
  config: Config;
  setActiveProfile: (id: string) => void;
  addProfile: (name: string) => string;
  renameProfile: (id: string, name: string) => void;
  deleteProfile: (id: string) => void;
  updateActiveFilters: (mut: (f: Filters) => Filters) => void;
  toggleFavorite: (jobId: string) => void;
  isFavorite: (jobId: string) => boolean;
  importConfig: (c: Config) => void;
  reset: () => void;
};

export const useConfigStore = create<State>((set, get) => ({
  ready: false,
  config: emptyConfig(),

  setActiveProfile: (id) => {
    const c = get().config;
    if (!c.profiles.find((p) => p.id === id)) return;
    persist({ ...c, active_profile_id: id }, set);
  },
  addProfile: (name) => {
    const c = get().config;
    const p = newProfile(name);
    persist({ ...c, profiles: [...c.profiles, p], active_profile_id: p.id }, set);
    return p.id;
  },
  renameProfile: (id, name) => {
    const c = get().config;
    const profiles = c.profiles.map((p) => (p.id === id ? { ...p, name } : p));
    persist({ ...c, profiles }, set);
  },
  deleteProfile: (id) => {
    const c = get().config;
    if (c.profiles.length <= 1) return;
    const profiles = c.profiles.filter((p) => p.id !== id);
    const active_profile_id = c.active_profile_id === id ? profiles[0].id : c.active_profile_id;
    persist({ ...c, profiles, active_profile_id }, set);
  },
  updateActiveFilters: (mut) => {
    const c = get().config;
    const profiles = c.profiles.map((p) =>
      p.id === c.active_profile_id ? { ...p, filters: mut(p.filters) } : p
    );
    persist({ ...c, profiles }, set);
  },
  toggleFavorite: (jobId) => {
    const c = get().config;
    const has = c.favorites.includes(jobId);
    const favorites = has ? c.favorites.filter((x) => x !== jobId) : [...c.favorites, jobId];
    persist({ ...c, favorites }, set);
  },
  isFavorite: (jobId) => get().config.favorites.includes(jobId),
  importConfig: (c) => persist(c, set),
  reset: () => persist(emptyConfig(), set),
}));

let saveTimer: number | undefined;
function persist(next: Config, set: (s: Partial<State>) => void) {
  set({ config: next, ready: true });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void idbSet(KEY, next);
  }, 250);
}

export function activeFilters(): Filters {
  const c = useConfigStore.getState().config;
  return c.profiles.find((p) => p.id === c.active_profile_id)!.filters;
}

export function useActiveProfile(): Profile {
  return useConfigStore((s) => s.config.profiles.find((p) => p.id === s.config.active_profile_id)!);
}

let loaded = false;
export async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const stored = (await idbGet(KEY)) as Config | undefined;
    if (stored && stored.profiles?.length) {
      useConfigStore.setState({ config: stored, ready: true });
      return;
    }
  } catch {
    // ignore
  }
  useConfigStore.setState({ ready: true });
}
