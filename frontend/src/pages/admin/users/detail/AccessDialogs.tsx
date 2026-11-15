import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminKeys,
  banUser,
  deleteAdminUser,
  setUserAdmin,
  triggerUserRebuild,
  unbanUser,
  updateAdminUser,
  type AdminUserDetail,
  type BanDuration,
} from '../../../../api/admin';
import { Field, Input, Select, Textarea } from '../../../../components/ui/Field';
import { showToast } from '../../../../components/ui/toasts';
import { ActionDialog } from '../../shared/ActionDialog';
import { forgetUser, patchUser, storeUser } from './userCache';

export type AccessAction =
  | 'enable'
  | 'disable'
  | 'ban'
  | 'unban'
  | 'grant-admin'
  | 'remove-admin'
  | 'rebuild'
  | 'delete';

interface DialogProps {
  user: AdminUserDetail;
  onClose: () => void;
}

const MAX_BAN_REASON_LENGTH = 500;

const BAN_DURATIONS: ReadonlyArray<{ value: BanDuration; label: string }> = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'permanent', label: 'Permanent' },
];

function EnabledDialog({ user, onClose, enable }: DialogProps & { enable: boolean }) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title={enable ? `Enable ${user.username}?` : `Disable ${user.username}?`}
      confirmLabel={enable ? 'Enable the account' : 'Disable the account'}
      destructive={!enable}
      run={() => updateAdminUser(user.id, { is_enabled: enable })}
      onDone={(updated) => {
        storeUser(client, updated);
        showToast('ok', `${updated.username} is ${enable ? 'enabled' : 'disabled'}.`);
      }}
      onClose={onClose}
      failureTitle="The account was not changed"
      fallback="Try again in a moment."
    >
      {enable ? (
        <p>The person can sign in again. Their configuration and lists are as they left them.</p>
      ) : (
        <p>
          The person is signed out and cannot sign in until the account is enabled again. Their
          configuration and published lists are kept.
        </p>
      )}
    </ActionDialog>
  );
}

function BanDialog({ user, onClose }: DialogProps) {
  const client = useQueryClient();
  const [duration, setDuration] = useState<BanDuration>('7d');
  const [reason, setReason] = useState('');
  return (
    <ActionDialog
      title={`Ban ${user.username}?`}
      confirmLabel="Ban the account"
      destructive
      run={() => banUser(user.id, duration, reason.trim() || undefined)}
      onDone={(result) => {
        patchUser(client, user.id, {
          is_banned: true,
          banned_until: result.banned_until,
          ban_reason: reason.trim() || null,
        });
        showToast('ok', `${user.username} is banned.`);
      }}
      onClose={onClose}
      failureTitle="The account was not banned"
      fallback="Try again in a moment."
      fields={['duration', 'reason']}
      closeOnBackdropClick={reason.trim() === ''}
    >
      {(errors) => (
        <>
          <p>The person is signed out and cannot sign in until the ban ends or is lifted.</p>
          <Field label="Length of the ban" error={errors.duration}>
            <Select
              value={duration}
              onChange={(event) => setDuration(event.target.value as BanDuration)}
            >
              {BAN_DURATIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Reason (optional)"
            hint={`Kept with the account for other admins. At most ${MAX_BAN_REASON_LENGTH} characters.`}
            error={errors.reason}
          >
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={MAX_BAN_REASON_LENGTH}
              rows={3}
            />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}

function UnbanDialog({ user, onClose }: DialogProps) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title={`Lift the ban on ${user.username}?`}
      confirmLabel="Lift the ban"
      run={() => unbanUser(user.id)}
      onDone={() => {
        patchUser(client, user.id, { is_banned: false, banned_until: null, ban_reason: null });
        showToast('ok', `The ban on ${user.username} is lifted.`);
      }}
      onClose={onClose}
      failureTitle="The ban was not lifted"
      fallback="Try again in a moment."
    >
      <p>The person can sign in again straight away. The recorded reason is removed.</p>
    </ActionDialog>
  );
}

function AdminRoleDialog({ user, onClose, grant }: DialogProps & { grant: boolean }) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title={
        grant ? `Make ${user.username} an admin?` : `Remove admin access from ${user.username}?`
      }
      confirmLabel={grant ? 'Grant admin access' : 'Remove admin access'}
      destructive={!grant}
      run={() => setUserAdmin(user.id, grant)}
      onDone={(updated) => {
        storeUser(client, updated);
        showToast('ok', `${updated.username} is ${grant ? 'now an admin' : 'no longer an admin'}.`);
      }}
      onClose={onClose}
      failureTitle="Admin access was not changed"
      fallback="Try again in a moment."
    >
      {grant ? (
        <p>
          Admins can see every account, change limits, ban and delete members, and edit the library,
          featured lists and announcements.
        </p>
      ) : (
        <p>The account becomes a member again and loses access to this admin area.</p>
      )}
    </ActionDialog>
  );
}

function RebuildDialog({ user, onClose }: DialogProps) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title={`Rebuild the lists of ${user.username}?`}
      confirmLabel="Start the build"
      run={() => triggerUserRebuild(user.id)}
      onDone={() => {
        showToast('ok', `A build for ${user.username} is queued.`);
        void client.invalidateQueries({ queryKey: adminKeys.jobs() });
      }}
      onClose={onClose}
      failureTitle="The build was not started"
      fallback="Try again in a moment."
    >
      <p>
        Every source is downloaded again, ignoring the cache. The build does not count against the
        weekly allowance of the account.
      </p>
    </ActionDialog>
  );
}

function DeleteDialog({ user, onClose }: DialogProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  return (
    <ActionDialog
      title={`Delete ${user.username}?`}
      confirmLabel="Delete the account"
      destructive
      run={() => deleteAdminUser(user.id)}
      onDone={() => {
        showToast('ok', `${user.username} and their data are deleted.`);
        navigate('/admin/users', { replace: true });
        forgetUser(client, user.id);
      }}
      onClose={onClose}
      failureTitle="The account was not deleted"
      fallback="Try again in a moment."
      confirmDisabled={typed.trim() !== user.username}
      closeOnBackdropClick={typed === ''}
    >
      <p>This cannot be undone. It signs the person out and permanently removes:</p>
      <ul className="m-0 grid list-disc gap-1 pl-5">
        <li>the account itself</li>
        <li>its saved configuration, whitelist and published lists, which stop being served</li>
        <li>its build history</li>
        <li>its limit requests and unfinished configuration checks</li>
        <li>any featured entry for one of its lists</li>
        <li>the download figures recorded for its lists</li>
      </ul>
      <Field label={`Type ${user.username} to confirm`}>
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
        />
      </Field>
    </ActionDialog>
  );
}

export function AccessDialog({ action, user, onClose }: DialogProps & { action: AccessAction }) {
  if (action === 'enable') return <EnabledDialog user={user} onClose={onClose} enable />;
  if (action === 'disable') return <EnabledDialog user={user} onClose={onClose} enable={false} />;
  if (action === 'ban') return <BanDialog user={user} onClose={onClose} />;
  if (action === 'unban') return <UnbanDialog user={user} onClose={onClose} />;
  if (action === 'grant-admin') return <AdminRoleDialog user={user} onClose={onClose} grant />;
  if (action === 'remove-admin') {
    return <AdminRoleDialog user={user} onClose={onClose} grant={false} />;
  }
  if (action === 'rebuild') return <RebuildDialog user={user} onClose={onClose} />;
  return <DeleteDialog user={user} onClose={onClose} />;
}
