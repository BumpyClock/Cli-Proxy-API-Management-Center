import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { oauthApi } from '@/services/api';
import { useNotificationStore } from '@/stores';

export function OAuthCredentialImport({
  provider,
  onClose,
}: {
  provider: 'gitlab' | 'iflow';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const save = async () => {
    if (!secret.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    try {
      await oauthApi.importProviderCredential(provider, secret.trim(), controller.signal);
      if (controller.signal.aborted) return;
      notifyAuthFilesChanged();
      showNotification(t('auth_login.plus_import_success'), 'success');
      onClose();
    } catch {
      if (controller.signal.aborted) return;
      request.current = null;
      setSaving(false);
      showNotification(t('auth_login.plus_import_error'), 'error');
    }
  };

  return (
    <Modal
      open
      title={t(`auth_login.plus_import_${provider}`)}
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <Button
          form="plus-credential-import"
          type="submit"
          loading={saving}
          disabled={!secret.trim()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <form
        id="plus-credential-import"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          label={t(`auth_login.plus_secret_${provider}`)}
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          disabled={saving}
        />
      </form>
    </Modal>
  );
}
