import { useTranslation } from 'react-i18next';
import { CONFIG_TAB_ICONS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { getValidationMessage } from '../blocks/shared';
import { SectionCard } from '../SectionCard';
import { FieldGrid, FieldStack } from '../fields/FieldPrimitives';
import {
  ApiKeysField,
  DebugToggle,
  HostField,
  LoggingToFileToggle,
  PortField,
  ProxyUrlField,
} from '../fields/sharedFields';
import { iconSize } from '@/design-system';

const Icon = CONFIG_TAB_ICONS.common;

/** Common fields share their controls with the canonical sections. */
export function SectionCommon({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const portError = getValidationMessage(t, validationErrors?.port);

  return (
    <SectionCard
      icon={<Icon size={iconSize['16']} />}
      title={t('config_management.visual.sections.common.title')}
      description={t('config_management.visual.sections.common.description')}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldGrid>
          <HostField values={values} disabled={disabled} onChange={onChange} />
          <PortField values={values} disabled={disabled} onChange={onChange} error={portError} />
          <ProxyUrlField values={values} disabled={disabled} onChange={onChange} />
        </FieldGrid>

        <ApiKeysField values={values} disabled={disabled} onChange={onChange} />

        <FieldGrid pairs>
          <DebugToggle values={values} disabled={disabled} onChange={onChange} />
          <LoggingToFileToggle values={values} disabled={disabled} onChange={onChange} />
        </FieldGrid>
      </FieldStack>
    </SectionCard>
  );
}
