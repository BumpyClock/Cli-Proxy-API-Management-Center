import type { ComponentType } from 'react';
import {
  IconCode,
  IconKey,
  IconNetwork,
  IconSatellite,
  IconScrollText,
  IconShield,
  IconSlidersHorizontal,
  type IconProps,
} from '@/components/ui/icons';
import type { VisualConfigFieldPath } from '@/types/visualConfig';
import type { VisualSectionId } from './searchIndex';

/** 编辑模式：可视化表单 or YAML 源码。 */
export type ConfigEditorMode = 'visual' | 'source';

export type ConfigTabId = 'common' | VisualSectionId;

export const CONFIG_SECTION_IDS = [
  'connectivity',
  'network',
  'logging',
  'streaming',
  'advanced',
  'payload',
] as const satisfies readonly VisualSectionId[];

export const CONFIG_TAB_IDS: readonly ConfigTabId[] = ['common', ...CONFIG_SECTION_IDS];

export const SECTION_INDEX_LABELS: Record<VisualSectionId, string> = {
  connectivity: '01',
  network: '02',
  logging: '03',
  streaming: '04',
  advanced: '05',
  payload: '06',
};

export const CONFIG_TAB_ICONS: Record<ConfigTabId, ComponentType<IconProps>> = {
  common: IconSlidersHorizontal,
  connectivity: IconKey,
  network: IconNetwork,
  logging: IconScrollText,
  streaming: IconSatellite,
  advanced: IconShield,
  payload: IconCode,
};

export const COMMON_FIELD_IDS = [
  'host',
  'port',
  'apiKeys',
  'proxyUrl',
  'debug',
  'loggingToFile',
] as const;

/**
 * 每个分区承载的校验字段路径（tab 错误徽章的分桶依据）。
 * payload 的校验不走字段路径，由 hasPayloadValidationErrors 旗标补记。
 */
export const SECTION_VALIDATION_FIELDS: Record<VisualSectionId, readonly VisualConfigFieldPath[]> =
  {
    connectivity: ['port'],
    network: ['requestRetry', 'maxRetryCredentials', 'maxRetryInterval', 'authAutoRefreshWorkers'],
    logging: ['errorLogsMaxFiles', 'logsMaxTotalSizeMb', 'redisUsageQueueRetentionSeconds'],
    streaming: [
      'streaming.keepaliveSeconds',
      'streaming.bootstrapRetries',
      'streaming.nonstreamKeepaliveInterval',
    ],
    advanced: [],
    payload: [],
  };

/** tab / tabpanel 的 DOM id：单点定义，ConfigTabs 与页面侧面板用同一函数生成 aria 关联。 */
export const configTabDomId = (id: ConfigTabId) => `config-tab-${id}`;
export const configPanelDomId = (id: ConfigTabId) => `config-panel-${id}`;

/** localStorage 键：mode 沿用旧键（'visual' | 'source' 值域不变）；section 为新键。 */
export const CONFIG_MODE_STORAGE_KEY = 'config-management:tab';
export const CONFIG_SECTION_STORAGE_KEY = 'config-management:section';
/** 旧「简单/完整」双模式的持久化键，模式轴已删除；挂载时清理。 */
export const LEGACY_EDITOR_MODE_STORAGE_KEY = 'config-management:editor-mode';
