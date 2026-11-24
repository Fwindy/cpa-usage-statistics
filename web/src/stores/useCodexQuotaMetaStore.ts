import { create } from 'zustand';
import type { CodexQuotaMeta } from '@/utils/codexQuotaMeta';

interface CodexQuotaMetaStoreState {
  codexQuotaMeta: Record<string, CodexQuotaMeta>;
  setCodexQuotaMeta: (key: string, meta: CodexQuotaMeta) => void;
  clearCodexQuotaMeta: () => void;
}

export const useCodexQuotaMetaStore = create<CodexQuotaMetaStoreState>((set) => ({
  codexQuotaMeta: {},
  setCodexQuotaMeta: (key, meta) =>
    set((state) => ({
      codexQuotaMeta: {
        ...state.codexQuotaMeta,
        [key]: meta,
      },
    })),
  clearCodexQuotaMeta: () => set({ codexQuotaMeta: {} }),
}));
