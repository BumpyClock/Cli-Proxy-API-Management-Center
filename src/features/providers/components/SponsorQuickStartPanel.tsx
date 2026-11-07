import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useNotificationStore } from '@/stores';
import { Button } from '@/components/ui/Button';
import { IconCheckCircle2, IconExternalLink, IconLoader2, IconPlus } from '@/components/ui/icons';
import {
  APIKEY_FUN_AFFILIATE_URL,
  APIKEY_FUN_DASHBOARD_URL,
  APIKEY_FUN_DISPLAY_NAME,
} from '../sponsor';
import { isSponsorPartialMutationError } from '../sponsorMutationRecovery';
import { getProviderCreateLabel } from '../createLabel';
import type { ProviderEntryFormInput, ProviderResource } from '../types';
import type { UseProviderWorkbenchResult } from '../useProviderWorkbench';
import { SponsorProviderForm } from '../sheets/forms/SponsorProviderForm';
import formStyles from '../sheets/forms/sharedForm.module.scss';
import styles from './SponsorQuickStartPanel.module.scss';
import { iconSize } from '@/design-system';

/**
 * Not configured: a plain optional entry point. No logo, promotion or sign-up link; the
 * sponsored sign-up link lives with the other optional resources on System.
 */
export function QuickStartOptionalKey({
  titleId,
  disabled,
  onAdd,
}: {
  titleId: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.optional} aria-labelledby={titleId}>
      <div className={styles.optionalText}>
        <h2 className={styles.title} id={titleId}>
          {t('providersPage.quickStart.optionalKeyTitle', { provider: APIKEY_FUN_DISPLAY_NAME })}
        </h2>
        <p className={styles.optionalHint}>
          {t('providersPage.quickStart.optionalKeyHint', { provider: APIKEY_FUN_DISPLAY_NAME })}
        </p>
      </div>
      <Button variant="secondary" onClick={onAdd} disabled={disabled}>
        <IconPlus size={iconSize['16']} aria-hidden="true" />
        {getProviderCreateLabel(t, 'apikeyFun')}
      </Button>
    </section>
  );
}

/**
 * The one quiet link key entry needs: the account dashboard once configured, otherwise where to
 * get a key. The latter is an affiliate link, so it is marked and labelled sponsored.
 */
export function QuickStartAccountLink({ configured }: { configured: boolean }) {
  const { t } = useTranslation();
  const href = configured ? APIKEY_FUN_DASHBOARD_URL : APIKEY_FUN_AFFILIATE_URL;
  const label = configured
    ? t('providersPage.sponsor.dashboardLink')
    : t('providersPage.quickStart.getKey');
  return (
    <>
      <a
        className={styles.accountLink}
        href={href}
        target="_blank"
        rel={configured ? 'noopener noreferrer' : 'noopener noreferrer sponsored'}
      >
        <span>{label}</span>
        <IconExternalLink size={iconSize['13']} aria-hidden="true" />
        <span className={styles.visuallyHidden}>{t('providersPage.quickStart.newTab')}</span>
      </a>
      {configured ? null : (
        <span className={styles.sponsoredTag}>{t('providersPage.sponsor.sponsoredLabel')}</span>
      )}
    </>
  );
}

interface SponsorQuickStartPanelProps {
  resource: ProviderResource | null;
  workbench: UseProviderWorkbenchResult;
  mutationDisabled?: boolean;
}

export function SponsorQuickStartPanel({
  resource,
  workbench,
  mutationDisabled = false,
}: SponsorQuickStartPanelProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const formId = useId();
  const titleId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const formMutating = submitting || mutationDisabled || workbench.mutating;
  const mode = resource ? 'edit' : 'create';
  const submitDisabled = formMutating || (mode === 'edit' && !isDirty);

  useUnsavedChangesGuard({
    shouldBlock: isDirty && !submitting,
    dialog: {
      title: t('providersPage.unsavedChanges.title'),
      message: t('providersPage.unsavedChanges.message'),
      confirmText: t('providersPage.unsavedChanges.discard'),
      cancelText: t('providersPage.unsavedChanges.keepEditing'),
      variant: 'danger',
    },
  });

  const handleSubmit = async (input: ProviderEntryFormInput) => {
    if (mutationDisabled) return;
    setSubmitting(true);
    try {
      if (resource) {
        await workbench.updateProvider(resource, input);
        showNotification(t('providersPage.toast.updated'), 'success');
      } else {
        await workbench.createProvider('apikeyFun', input);
        showNotification(t('providersPage.toast.created'), 'success');
        setShowCreateForm(false);
      }
      setIsDirty(false);
      setFormVersion((current) => current + 1);
    } catch (err) {
      if (isSponsorPartialMutationError(err)) {
        showNotification(t('providersPage.sponsor.partialMutationWarning'), 'warning');
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t(resource ? 'notification.update_failed' : 'notification.add_failed')}: ${msg}`,
        'error'
      );
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  if (!resource && !showCreateForm) {
    return (
      <QuickStartOptionalKey
        titleId={titleId}
        disabled={formMutating}
        onAdd={() => setShowCreateForm(true)}
      />
    );
  }

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 className={styles.title} id={titleId}>
          {APIKEY_FUN_DISPLAY_NAME}
        </h2>
        <QuickStartAccountLink configured={resource !== null} />
      </div>

      <SponsorProviderForm
        key={`${mode}:${resource?.id ?? 'new'}:${formVersion}`}
        resource={resource}
        mode={mode}
        mutating={formMutating}
        formId={formId}
        variant="quickStart"
        onSubmit={handleSubmit}
        onDirtyChange={setIsDirty}
      />

      <div className={styles.footer}>
        {!resource ? (
          <button
            type="button"
            className={`${formStyles.footerBtn} ${formStyles.footerBtnGhost}`}
            onClick={() => {
              setShowCreateForm(false);
              setIsDirty(false);
              setFormVersion((current) => current + 1);
            }}
            disabled={submitting}
          >
            {t('providersPage.actions.cancel')}
          </button>
        ) : null}
        <button
          type="submit"
          form={formId}
          className={`${formStyles.footerBtn} ${formStyles.footerBtnPrimary} ${
            styles.primaryAction
          }`}
          disabled={submitDisabled}
        >
          {submitting ? (
            <IconLoader2 className={styles.spin} size={iconSize['14']} />
          ) : mode === 'create' ? (
            <IconPlus size={iconSize['14']} />
          ) : (
            <IconCheckCircle2 size={iconSize['14']} />
          )}
          <span>
            {mode === 'create'
              ? t('providersPage.actions.create')
              : t('providersPage.actions.save')}
          </span>
        </button>
      </div>
    </section>
  );
}
