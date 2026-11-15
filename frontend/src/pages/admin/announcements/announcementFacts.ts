import type { AnnouncementSubmission, AnnouncementType } from '../../../api/admin';
import type { AlertTone } from '../../../components/ui/Alert';
import type { IconName } from '../../../components/ui/icons';
import type { StatusTone } from '../../../components/ui/status';
import { parseApiDate } from '../../../lib/format';
import type { Announcement } from '../../../types';
import { localInputToUtcIso, utcIsoToLocalInput } from '../../../utils/datetimeLocal';

export const MAX_TITLE_LENGTH = 200;
export const MAX_MESSAGE_LENGTH = 5000;

export const ANNOUNCEMENT_TYPES: ReadonlyArray<{ value: AnnouncementType; label: string }> = [
  { value: 'info', label: 'Information' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

export const ANNOUNCEMENT_TONES: Record<AnnouncementType, AlertTone> = {
  info: 'info',
  warning: 'warn',
  critical: 'fail',
};

export interface PillDescription {
  tone: StatusTone;
  icon: IconName;
  label: string;
}

const TYPE_PILLS: Record<AnnouncementType, PillDescription> = {
  info: { tone: 'info', icon: 'info', label: 'Information' },
  warning: { tone: 'warn', icon: 'warn', label: 'Warning' },
  critical: { tone: 'fail', icon: 'fail', label: 'Critical' },
};

export function typePill(type: AnnouncementType): PillDescription {
  return TYPE_PILLS[type] ?? TYPE_PILLS.info;
}

export type AnnouncementState = 'showing' | 'off' | 'expired';

export function announcementState(
  announcement: Pick<Announcement, 'is_active' | 'expires_at'>,
  now: Date,
): AnnouncementState {
  if (!announcement.is_active) return 'off';
  const expires = parseApiDate(announcement.expires_at);
  return expires && expires.getTime() <= now.getTime() ? 'expired' : 'showing';
}

const STATE_PILLS: Record<AnnouncementState, PillDescription> = {
  showing: { tone: 'ok', icon: 'check', label: 'Showing' },
  off: { tone: 'neutral', icon: 'dash', label: 'Turned off' },
  expired: { tone: 'neutral', icon: 'clock', label: 'Expired' },
};

export function statePill(state: AnnouncementState): PillDescription {
  return STATE_PILLS[state];
}

export type AnnouncementField = 'title' | 'message' | 'type' | 'expires_at';

export const ANNOUNCEMENT_FIELDS: ReadonlyArray<AnnouncementField> = [
  'title',
  'message',
  'type',
  'expires_at',
];

export interface AnnouncementDraft {
  title: string;
  message: string;
  type: AnnouncementType;
  expiresLocal: string;
}

export function announcementDraft(announcement: Announcement | null): AnnouncementDraft {
  return {
    title: announcement?.title ?? '',
    message: announcement?.message ?? '',
    type: announcement?.type ?? 'info',
    expiresLocal: utcIsoToLocalInput(announcement?.expires_at),
  };
}

export function draftErrors(draft: AnnouncementDraft): Partial<Record<AnnouncementField, string>> {
  const errors: Partial<Record<AnnouncementField, string>> = {};
  if (draft.title.trim() === '') errors.title = 'Enter a title.';
  if (draft.message.trim() === '') errors.message = 'Enter a message.';
  if (draft.expiresLocal !== '' && localInputToUtcIso(draft.expiresLocal) === null) {
    errors.expires_at = 'Enter a full date and time, or clear the field.';
  }
  return errors;
}

export function draftSubmission(draft: AnnouncementDraft): Required<AnnouncementSubmission> {
  return {
    title: draft.title.trim(),
    message: draft.message.trim(),
    type: draft.type,
    expires_at: draft.expiresLocal === '' ? null : localInputToUtcIso(draft.expiresLocal),
  };
}
