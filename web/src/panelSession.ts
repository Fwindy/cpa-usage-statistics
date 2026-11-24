import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { normalizeApiBase } from '@/utils/connection';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { isCurrentObfuscated } from '@/utils/encryption';

const resourcePrefix = '/v0/resource/plugins/usage-statistics/';
const { pathname: path, origin } = new URL(window.location.href);
const mountIndex = path.lastIndexOf(resourcePrefix);
export const apiBase = origin + (mountIndex < 0 ? '' : path.slice(0, mountIndex));
export const usesPanelSession = path.startsWith('/api/v1/plugin-host/');
const sessionKey = `cpa-usage-statistics:session:${apiBase}`;

export function getSessionKey(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH);
    if (raw && isCurrentObfuscated(raw)) {
      const stored = obfuscatedStorage.getItem<{
        state?: { apiBase?: string; managementKey?: string };
      }>(STORAGE_KEY_AUTH)?.state;
      if (typeof stored?.apiBase === 'string' && normalizeApiBase(stored.apiBase) === apiBase) {
        if (typeof stored.managementKey === 'string' && stored.managementKey.trim()) {
          return stored.managementKey.trim();
        }
      }
    }
  } catch {
    // The key can also be entered in the plugin.
  }
  try {
    return sessionStorage.getItem(sessionKey) ?? '';
  } catch {
    return '';
  }
}

export function saveSessionKey(key: string) {
  try {
    if (key) sessionStorage.setItem(sessionKey, key);
    else sessionStorage.removeItem(sessionKey);
  } catch {
    // The current page keeps the key in memory if storage is blocked.
  }
}
