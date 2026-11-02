export const copilotQuotaResponse = {
  copilot_plan: 'individual',
  access_type_sku: 'copilot_individual',
  quota_reset_date: '2099-12-01',
  analytics_tracking_id: 'not-for-display',
  quota_snapshots: {
    premium_interactions: {
      entitlement: 300,
      overage_count: 0,
      overage_permitted: false,
      percent_remaining: 75,
      quota_id: 'premium_interactions',
      quota_remaining: 226,
      remaining: 225,
      unlimited: false,
    },
    chat: {
      entitlement: 0,
      overage_count: 0,
      overage_permitted: false,
      percent_remaining: 100,
      quota_id: 'chat',
      quota_remaining: 0,
      remaining: 0,
      unlimited: true,
    },
    completions: {
      entitlement: 2000,
      remaining: 1600,
      unlimited: false,
    },
  },
};
