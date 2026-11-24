import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRecord } from '@/utils/helpers';

export interface ConfiguredCredential {
  name: string;
  provider: string;
}

const nameOf = (entry: Record<string, unknown>) =>
  typeof entry.name === 'string' ? entry.name.trim() : '';

// The v8 API supplies the runtime index for all configured provider groups.
// Keep only display metadata here. The upstream API key is never an identity.
export function indexConfiguredCredentials(groups: unknown): ReadonlyMap<string, ConfiguredCredential> {
  const result = new Map<string, ConfiguredCredential>();
  if (!isRecord(groups)) return result;

  for (const [provider, entries] of Object.entries(groups)) {
    if (!Array.isArray(entries)) continue;

    for (const group of entries) {
      if (!isRecord(group)) continue;
      const groupName = nameOf(group);
      const keys = Array.isArray(group.keys) ? group.keys : [];
      for (const entry of [...keys, group]) {
        if (!isRecord(entry)) continue;
        const index = normalizeAuthIndex(entry.auth_index ?? entry['auth-index']);
        if (!index) continue;
        const name = nameOf(entry) || groupName;
        const previous = result.get(index);
        if (!previous || (!previous.name && name)) result.set(index, { name, provider });
      }
    }
  }
  return result;
}
