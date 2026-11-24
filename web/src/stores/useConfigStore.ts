import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { indexConfiguredCredentials, type ConfiguredCredential } from '@/services/api/configuredCredentials';
import { normalizeConfigResponse } from '@/services/api/transformers';
import type { Config } from '@/types/config';

interface ConfigState {
  config: Config | null;
  credentials: ReadonlyMap<string, ConfiguredCredential>;
  error: string;
  fetchConfig: () => Promise<void>;
}

let configRequest: Promise<void> | undefined;

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  credentials: new Map(),
  error: '',
  fetchConfig: () => {
    configRequest ??= apiClient.get('/config/api-keys')
      .catch((error: { status?: number }) => {
        if (error.status === 404) return {};
        throw error;
      })
      .then((groups) => set({
        config: normalizeConfigResponse({ 'api-keys': groups }),
        credentials: indexConfiguredCredentials(groups),
        error: '',
      }))
      .catch((error: Error) => set({ error: error.message }))
      .finally(() => { configRequest = undefined; });
    return configRequest;
  },
}));
