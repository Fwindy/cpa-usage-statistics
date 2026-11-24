import { create } from 'zustand';
import type { QuotaUpdater } from '@/features/quota/providers/types';
import type { AntigravityQuotaState, CodexQuotaState } from '@/types';

type CodexQuotas = Record<string, CodexQuotaState>;
type AntigravityQuotas = Record<string, AntigravityQuotaState>;

interface QuotaState {
  codexQuota: CodexQuotas;
  antigravityQuota: AntigravityQuotas;
  setCodexQuota: (update: QuotaUpdater<CodexQuotas>) => void;
  setAntigravityQuota: (update: QuotaUpdater<AntigravityQuotas>) => void;
}

export const useQuotaStore = create<QuotaState>((set) => ({
  codexQuota: {},
  antigravityQuota: {},
  setCodexQuota: (update) =>
    set(({ codexQuota }) => ({ codexQuota: typeof update === 'function' ? update(codexQuota) : update })),
  setAntigravityQuota: (update) =>
    set(({ antigravityQuota }) => ({
      antigravityQuota: typeof update === 'function' ? update(antigravityQuota) : update,
    })),
}));
