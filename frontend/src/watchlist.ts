import { create } from 'zustand';

const KEY = 'ml-saved-districts';
// ponytail: a small per-browser list; move to an account if saved districts must follow the user across devices.
const LIMIT = 8;

function stored(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, LIMIT) : [];
  } catch { return []; }
}

/** Adds a district to the front of the list, or removes it if already saved. Oldest entries drop past the limit. */
export function toggleSaved(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [id, ...ids].slice(0, LIMIT);
}

export const useSaved = create<{ ids: string[]; toggle: (id: string) => void }>((set) => ({
  ids: stored(),
  toggle: (id) => set((s) => {
    const ids = toggleSaved(s.ids, id);
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* storage unavailable: list lasts this visit */ }
    return { ids };
  }),
}));
