export type BuildRefusalCode =
  | 'no_config'
  | 'invalid_config'
  | 'weekly_limit'
  | 'build_active'
  | 'user_not_found'
  | 'cooldown';

export interface BuildRefusal {
  error?: string;
  code?: BuildRefusalCode;
  remaining_updates?: number;
  cooldown_remaining?: number;
  resets_at?: string;
  job_id?: string;
}

export function buildRefusalMessage(refusal: BuildRefusal | undefined): string {
  if (!refusal?.error) return 'Could not start the build. Check your connection and try again.';
  if (refusal.code === 'weekly_limit' && refusal.resets_at) {
    return `${refusal.error}. It resets on ${new Date(refusal.resets_at).toLocaleString()}.`;
  }
  if (refusal.code === 'invalid_config') {
    return `${refusal.error}. Fix it on the Configuration page, then rebuild.`;
  }
  return refusal.error;
}
