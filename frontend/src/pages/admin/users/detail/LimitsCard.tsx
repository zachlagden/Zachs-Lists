import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { updateAdminUser, type AdminUserDetail } from '../../../../api/admin';
import { Alert } from '../../../../components/ui/Alert';
import { Button } from '../../../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../../../components/ui/Card';
import { Field, Input } from '../../../../components/ui/Field';
import { StatusPill } from '../../../../components/ui/StatusPill';
import { showToast } from '../../../../components/ui/toasts';
import { acceptingSaved, withEdit, withoutEdit } from '../../../../lib/editOverlay';
import type { UserLimits } from '../../../../types';
import { focusFirstInvalid, formFailure } from '../../shared/fieldErrors';
import type { Permission } from '../../shared/permissions';
import {
  LIMIT_FIELDS,
  LIMIT_KEYS,
  NO_LIMIT_EDITS,
  changedLimits,
  describeChangedUnderneath,
  hasEdits,
  isOverride,
  limitErrors,
  limitHint,
  limitValues,
  limitsChangedUnderneath,
  shownLimits,
  type LimitEdits,
  type LimitKey,
} from './limitsForm';
import { storeUser } from './userCache';
import { LeaveDialog } from '../../../../components/ui/LeaveDialog';
import { useUnsavedChangesGuard } from '../../../../hooks/useUnsavedChangesGuard';

export function LimitsCard({
  user,
  permission,
}: {
  user: AdminUserDetail;
  permission: Permission;
}) {
  const client = useQueryClient();
  const [edits, setEdits] = useState<LimitEdits>(NO_LIMIT_EDITS);
  const [checked, setChecked] = useState(false);
  const save = useMutation({
    mutationFn: (limits: Partial<UserLimits>) => updateAdminUser(user.id, { limits }),
    onSuccess: (updated) => {
      storeUser(client, updated);
      setEdits(NO_LIMIT_EDITS);
      setChecked(false);
      showToast('ok', `Limits saved for ${updated.username}.`);
    },
  });

  const saved = limitValues(user.limits);
  const values = shownLimits(user, edits);
  const clientErrors = checked ? limitErrors(user, values) : {};
  const failure = save.isError
    ? formFailure<LimitKey>(save.error, {
        fields: LIMIT_KEYS,
        prefix: 'limits.',
        fallback: 'The limits could not be saved.',
      })
    : null;
  const changes = changedLimits(user, edits);
  const dirty = hasEdits(user, edits);
  const changedUnderneath = limitsChangedUnderneath(user, edits);
  const blocker = useUnsavedChangesGuard(dirty && permission.allowed);

  const change = (key: LimitKey, value: string) => {
    setEdits((current) => withEdit(saved, current, key, value));
    if (save.isError) save.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(limitErrors(user, values)).length > 0) {
      focusFirstInvalid(event.currentTarget);
      return;
    }
    save.mutate(changes);
  };

  return (
    <Card as="section" aria-labelledby="user-limits">
      <CardHeader title="Limits" titleId="user-limits" />
      <CardBody>
        {user.is_root ? (
          <p className="text-[13px] text-text-secondary">The root account has no limits.</p>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 narrow:grid-cols-[minmax(0,1fr)]">
              {LIMIT_FIELDS.map((field) => {
                const override = isOverride(user, field.key);
                const standard = String(user.default_limits[field.key]);
                return (
                  <div key={field.key} className="grid content-start gap-1.5">
                    <Field
                      label={field.label}
                      hint={limitHint(user, field)}
                      error={clientErrors[field.key] ?? failure?.fields[field.key]}
                    >
                      <Input
                        inputMode="numeric"
                        value={values[field.key]}
                        onChange={(event) => change(field.key, event.target.value)}
                        disabled={!permission.allowed}
                        autoComplete="off"
                        className="num"
                      />
                    </Field>
                    <div className="flex min-h-[30px] flex-wrap items-center gap-2 narrow:min-h-11">
                      {override ? (
                        <StatusPill tone="info" icon="info">
                          Override
                        </StatusPill>
                      ) : (
                        <StatusPill icon="dash">Default</StatusPill>
                      )}
                      {values[field.key] !== standard && permission.allowed ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => change(field.key, standard)}
                          aria-label={`Reset to the default for ${field.label.toLowerCase()}`}
                        >
                          Reset to the default
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {changedUnderneath.length > 0 ? (
              <Alert
                tone="warn"
                title="Someone else changed a limit you are editing"
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEdits((current) => acceptingSaved(saved, current))}
                    >
                      Keep my edit
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setEdits((current) => changedUnderneath.reduce(withoutEdit, current))
                      }
                    >
                      Use the new value
                    </Button>
                  </>
                }
              >
                {describeChangedUnderneath(user, changedUnderneath)} Saving replaces it with what
                you typed.
              </Alert>
            ) : null}
            {failure?.form ? <Alert tone="fail">{failure.form}</Alert> : null}
            {permission.allowed ? (
              <div className="flex flex-wrap items-center gap-3">
                {dirty ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEdits(NO_LIMIT_EDITS);
                      setChecked(false);
                      save.reset();
                    }}
                  >
                    Discard changes
                  </Button>
                ) : null}
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
                  Save limits
                </Button>
                <p className="text-[13px] text-text-tertiary">
                  A value equal to the default is stored as no override, so it follows later changes
                  to the default.
                </p>
              </div>
            ) : (
              <p className="text-[13px] text-text-secondary">{permission.reason}</p>
            )}
          </form>
        )}
      </CardBody>
      <LeaveDialog blocker={blocker}>
        Your unsaved changes to the limits of {user.username} will be lost.
      </LeaveDialog>
    </Card>
  );
}
