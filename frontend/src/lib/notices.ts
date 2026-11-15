import type { AlertTone } from '../components/ui/Alert';
import type { Announcement } from '../types';

export const ANNOUNCEMENT_TONES: Record<Announcement['type'], AlertTone> = {
  info: 'info',
  warning: 'warn',
  critical: 'fail',
};
