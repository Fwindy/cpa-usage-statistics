import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/utils/recentRequests';
import { parseTimestampMs } from '@/utils/timestamp';
import { normalizeAuthFileCooldowns, normalizeCooldownTimestamp } from './authFileCooldowns';

type AuthFileEntry = AuthFilesResponse['files'][number];

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => entry['runtime_only'] === true;

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      // Cooldown snapshots are atomic: [] and null are meaningful, not missing fields.
      if (key === 'cooldowns' && Object.prototype.hasOwnProperty.call(merged, key)) return;
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

const readIntegerField = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const readRuntimeOnlyField = (entry: AuthFileEntry): boolean => {
  const raw = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

const readBooleanField = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
};

/**
 * Normalize backend kebab/snake_case fields into AuthFileItem camelCase fields.
 * Preserve raw fields for quota resolvers that read plan_type, id_token,
 * metadata and attributes directly.
 */
const normalizeAuthFileEntry = (
  entry: AuthFileEntry,
  observedAt: string | undefined,
  receivedAtMs: number
): AuthFileEntry => {
  const declaredStatusMessage =
    typeof entry.statusMessage === 'string' ? entry.statusMessage.trim() : '';
  const statusMessage = readTextField(entry, 'status_message') || declaredStatusMessage;
  const note = readTextField(entry, 'note');
  const email = readTextField(entry, 'email');
  // Never normalize account/account_type: API-key credentials expose secrets there.
  const projectId = readTextField(entry, 'project_id');
  const modified = readDateField(entry);
  const priority = readIntegerField(entry['priority']);
  const weight = readIntegerField(entry['weight']);
  const supportsQuota = readBooleanField(entry['supports_quota'] ?? entry.supportsQuota);
  const quotaProvider =
    readTextField(entry, 'quota_provider') || readTextField(entry, 'quotaProvider');
  const quotaPluginId =
    readTextField(entry, 'quota_plugin_id') || readTextField(entry, 'quotaPluginId');

  return {
    ...entry,
    siwcBindSupported: entry.siwc_bind_supported === true,
    useSiwc: entry.use_siwc === true,
    siwcBound: entry.siwc_bound === true,
    siwcExpiresAt: readTextField(entry, 'siwc_expires_at') || undefined,
    cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
    runtimeOnly: readRuntimeOnlyField(entry),
    authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
    ...(supportsQuota !== undefined ? { supportsQuota } : {}),
    ...(quotaProvider ? { quotaProvider } : {}),
    quotaPluginId: quotaPluginId || undefined,
    recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
    successCount: normalizeUsageTotal(entry.success),
    failureCount: normalizeUsageTotal(entry.failed),
    ...(statusMessage ? { statusMessage } : {}),
    ...(modified > 0 ? { modified } : {}),
    priority,
    weight,
    ...(note ? { note } : {}),
    ...(email ? { email } : {}),
    ...(projectId ? { projectId } : {}),
  };
};

export const normalizeAuthFilesResponse = (
  payload: AuthFilesResponse,
  receivedAtMs = Date.now()
): AuthFilesResponse => {
  const observedAt = normalizeCooldownTimestamp(payload?.observed_at);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const key = name
      ? getQuotaCacheKey({
          ...entry,
          name,
          authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
        })
      : JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map((entries) =>
    normalizeAuthFileEntry(mergeAuthFileEntries(entries), observedAt, receivedAtMs)
  );
  normalizedFiles.sort((left, right) => {
    const nameOrder = readTextField(left, 'name').localeCompare(
      readTextField(right, 'name'),
      undefined,
      { sensitivity: 'accent' }
    );
    if (nameOrder !== 0) return nameOrder;
    return String(left.authIndex ?? '').localeCompare(String(right.authIndex ?? ''), undefined, {
      sensitivity: 'accent',
    });
  });

  return {
    ...payload,
    observedAt,
    files: normalizedFiles,
    total: normalizedFiles.length,
  };
};

interface AuthFileCooldownResetResponse {
  status: 'ok';
  auth_index: string;
  models: string[];
}

export const authFilesApi = {
  list: async () => normalizeAuthFilesResponse(await apiClient.get<AuthFilesResponse>('/credentials')),

  resetCooldown: (authIndex: string) =>
    apiClient.post<AuthFileCooldownResetResponse>('/routing/cooldown/reset', {
      auth_index: authIndex,
    }),

  downloadText: async (name: string): Promise<string> => {
    const { data } = await apiClient.getRaw('/credentials/download', {
      params: { name },
      responseType: 'blob',
    });
    return (data as Blob).text();
  },
};
