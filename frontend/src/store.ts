import { create } from 'zustand';

type State = { date: string; lead: number; layer: 'raw' | 'corrected' | 'diff'; contrast: boolean; setDate: (date: string) => void; setLead: (lead: number) => void; setLayer: (layer: State['layer']) => void; toggleContrast: () => void };
export const useForecastStore = create<State>((set) => ({
  date: '2025-09-30', lead: 1, layer: 'corrected', contrast: false,
  setDate: (date) => set({date}), setLead: (lead) => set({lead}), setLayer: (layer) => set({layer}), toggleContrast: () => set((state) => ({contrast: !state.contrast})),
}));
