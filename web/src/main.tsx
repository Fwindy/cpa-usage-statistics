import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import '@/i18n';
import { CredentialCenterPage } from '@/pages/CredentialCenterPage';
import { MonitoringCenterPage } from '@/pages/MonitoringCenterPage';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { followPanelTheme } from '@/stores/useThemeStore';
import '@/styles/global.scss';
import { apiBase, getSessionKey, saveSessionKey, usesPanelSession } from './panelSession';
import './shell.css';

const isCredentialPage = document.documentElement.dataset.center === 'credentials';

async function checkConnection(managementKey: string) {
  apiClient.setConfig({ apiBase, managementKey });
  await apiClient.get('/server/server-id');
  useAuthStore.setState({ apiBase, managementKey });
  void useConfigStore.getState().fetchConfig();
}

function PluginPage() {
  const { t, i18n } = useTranslation();
  const title = t(isCredentialPage ? 'credential_center.title' : 'monitoring_center.title');
  const configError = useConfigStore((state) => state.error);
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = title;
    document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN';
  }, [i18n.resolvedLanguage, title]);

  useEffect(() => {
    const saved = getSessionKey();
    if (!saved && !usesPanelSession) {
      setPending(false);
      return;
    }
    void checkConnection(saved)
      .then(() => setReady(true))
      .catch(() => saveSessionKey(''))
      .finally(() => setPending(false));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const expire = () => {
      saveSessionKey('');
      window.location.reload();
    };
    window.addEventListener('unauthorized', expire);
    return () => window.removeEventListener('unauthorized', expire);
  }, [ready]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError('');
    try {
      await checkConnection(trimmed);
      saveSessionKey(trimmed);
      setKey('');
      setReady(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const errorKey =
        status === 401 ? 'login.error_unauthorized' :
        status === 403 ? 'login.error_forbidden' : 'login.error_invalid';
      setError(t(errorKey));
    } finally {
      setPending(false);
    }
  }

  if (ready) {
    return (
      <main className="plugin-center">
        {configError && <p className="plugin-config-error" role="status">{configError}</p>}
        {isCredentialPage ? <CredentialCenterPage /> : <MonitoringCenterPage />}
        <ConfirmationModal />
        <NotificationContainer />
      </main>
    );
  }

  return (
    <main className="plugin-connect">
      <form className="card" onSubmit={submit}>
        <h1>{title}</h1>
        <Input
          id="management-key"
          label={t('login.management_key_label')}
          type="password"
          autoComplete="current-password"
          placeholder={t('login.management_key_placeholder')}
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          disabled={pending}
          required
        />
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={!key.trim() || pending}>
          {pending ? <LoadingSpinner size={16} /> : t('login.submit_button')}
        </Button>
      </form>
    </main>
  );
}

followPanelTheme();
createRoot(document.getElementById('root')!).render(<PluginPage />);
