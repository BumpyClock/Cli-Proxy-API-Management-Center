import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { pluginsApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginListResponse } from '@/types';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  resolvePluginAssetURL,
} from './pluginResources';
import styles from './PluginResourcePage.module.scss';

const hasStatus = (error: unknown, status: number) => isRecord(error) && error.status === status;

const safeDecodeURIComponent = (value = '') => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseMenuIndex = (value = '') => {
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : -1;
};

export function PluginResourcePage() {
  const { t } = useTranslation();
  const params = useParams<{ pluginId: string; menuIndex: string }>();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  const [data, setData] = useState<PluginListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [frameFailed, setFrameFailed] = useState(false);
  const [frameLoading, setFrameLoading] = useState(true);

  const connected = connectionStatus === 'connected';
  const pluginID = useMemo(() => safeDecodeURIComponent(params.pluginId), [params.pluginId]);
  const menuIndex = useMemo(() => parseMenuIndex(params.menuIndex), [params.menuIndex]);

  const loadResource = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }

    setLoading(true);
    setError('');
    setFrameFailed(false);
    setFrameLoading(true);
    try {
      const plugins = await pluginsApi.list();
      setData(plugins);
    } catch (err: unknown) {
      setError(
        hasStatus(err, 404)
          ? t('plugin_management.unsupported_backend')
          : getErrorMessage(err, t('plugin_resource.load_failed'))
      );
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useHeaderRefresh(loadResource, connected);

  useEffect(() => {
    void loadResource();
  }, [loadResource]);

  useEffect(() => {
    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadResource);

    return () => {
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadResource);
    };
  }, [loadResource]);

  const resource = useMemo(() => {
    const entries = collectPluginResourceEntries(data?.plugins ?? []);
    return entries.find((entry) => entry.pluginID === pluginID && entry.menuIndex === menuIndex);
  }, [data?.plugins, menuIndex, pluginID]);

  const iframeSrc = resource ? resolvePluginAssetURL(resource.menu.path, apiBase) : '';

  return (
    <div className={styles.page}>
      <PageHeader
        title={resource?.label || t('plugin_resource.unavailable')}
        meta={resource ? `${resource.pluginTitle} · ${resource.menu.path}` : pluginID}
        actions={
          <>
            <Link to="/plugins">{t('plugin_management.title')}</Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadResource()}
              disabled={loading}
            >
              {t('common.refresh')}
            </Button>
          </>
        }
      />
      {loading ? (
        <div className={styles.stateShell}>
          <div className={styles.statusPanel}>{t('common.loading')}</div>
        </div>
      ) : error ? (
        <div className={styles.stateShell}>
          <EmptyState title={t('plugin_resource.unavailable')} description={error} />
        </div>
      ) : !resource ? (
        <div className={styles.stateShell}>
          <EmptyState
            title={t('plugin_resource.not_found')}
            description={t('plugin_resource.not_found_desc')}
          />
        </div>
      ) : !iframeSrc ? (
        <div className={styles.stateShell}>
          <EmptyState
            title={t('plugin_resource.empty_src')}
            description={t('plugin_resource.empty_src_desc')}
          />
        </div>
      ) : frameFailed ? (
        <div className={styles.stateShell}>
          <EmptyState title={t('plugin_resource.load_failed')} />
        </div>
      ) : (
        <div className={styles.frameShell} aria-busy={frameLoading}>
          {frameLoading && (
            <div className={styles.statusPanel} role="status">
              {t('common.loading')}
            </div>
          )}
          <iframe
            className={styles.frame}
            src={iframeSrc}
            title={resource.label}
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
            onLoad={() => setFrameLoading(false)}
            onError={() => {
              setFrameLoading(false);
              setFrameFailed(true);
            }}
          />
        </div>
      )}
    </div>
  );
}
