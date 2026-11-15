import { useState, type ReactNode } from 'react';
import type { AdminUserDetail } from '../../../../api/admin';
import { Alert } from '../../../../components/ui/Alert';
import { Button } from '../../../../components/ui/Button';
import { Card, CardHeader } from '../../../../components/ui/Card';
import type { Permission } from '../../shared/permissions';
import { banEnd } from '../userFacts';
import { AccessDialog, type AccessAction } from './AccessDialogs';

function ActionRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-[18px] py-3 last:border-b-0 narrow:px-3">
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="font-medium">{title}</p>
        <p className="text-[13px] break-words text-text-secondary">{detail}</p>
      </div>
      {children}
    </li>
  );
}

export interface AccessCardProps {
  user: AdminUserDetail;
  manage: Permission;
  adminRole: Permission;
  now: Date;
}

export function AccessCard({ user, manage, adminRole, now }: AccessCardProps) {
  const [action, setAction] = useState<AccessAction | null>(null);
  const locked = !manage.allowed;
  return (
    <Card as="section" aria-labelledby="user-access">
      <CardHeader title="Access and actions" titleId="user-access" />
      {manage.reason ? (
        <Alert tone="info" live={false} className="mx-[18px] mt-3.5 narrow:mx-3">
          {manage.reason}
        </Alert>
      ) : null}
      <ul className="m-0 list-none p-0">
        <ActionRow
          title={user.is_enabled ? 'The account is enabled' : 'The account is disabled'}
          detail={
            user.is_enabled
              ? 'Disabling signs the person out and blocks sign-in.'
              : 'The person cannot sign in.'
          }
        >
          <Button
            size="sm"
            disabled={locked}
            onClick={() => setAction(user.is_enabled ? 'disable' : 'enable')}
          >
            {user.is_enabled ? 'Disable' : 'Enable'}
          </Button>
        </ActionRow>
        <ActionRow
          title={user.is_banned ? 'The account is banned' : 'The account is not banned'}
          detail={
            user.is_banned
              ? `${banEnd(user.banned_until, now)}. ${user.ban_reason ? `Reason: ${user.ban_reason}` : 'No reason was recorded.'}`
              : 'A ban blocks sign-in for a set time or permanently.'
          }
        >
          {user.is_banned ? (
            <Button size="sm" onClick={() => setAction('unban')}>
              Lift the ban
            </Button>
          ) : (
            <Button size="sm" disabled={locked} onClick={() => setAction('ban')}>
              Ban
            </Button>
          )}
        </ActionRow>
        <ActionRow
          title={user.is_admin || user.is_root ? 'Has admin access' : 'No admin access'}
          detail={adminRole.reason ?? 'Admins can manage every account and the shared content.'}
        >
          <Button
            size="sm"
            disabled={!adminRole.allowed}
            onClick={() => setAction(user.is_admin ? 'remove-admin' : 'grant-admin')}
          >
            {user.is_admin ? 'Remove admin access' : 'Grant admin access'}
          </Button>
        </ActionRow>
        <ActionRow
          title="Rebuild the lists"
          detail="Queues a build that downloads every source again."
        >
          <Button size="sm" icon="bolt" disabled={locked} onClick={() => setAction('rebuild')}>
            Rebuild
          </Button>
        </ActionRow>
        <ActionRow
          title="Delete the account"
          detail="Removes the account, its lists and its history for good."
        >
          <Button size="sm" icon="trash" disabled={locked} onClick={() => setAction('delete')}>
            Delete
          </Button>
        </ActionRow>
      </ul>
      {action ? <AccessDialog action={action} user={user} onClose={() => setAction(null)} /> : null}
    </Card>
  );
}
