import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  adminKeys,
  adminUserQuery,
  approveLimitRequest,
  denyLimitRequest,
} from '../../../api/admin';
import { toApiError } from '../../../api/errors';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Field, Input, Textarea } from '../../../components/ui/Field';
import { showToast } from '../../../components/ui/toasts';
import { formatInteger } from '../../../lib/format';
import type { LimitRequest } from '../../../types';
import { focusFirstInvalid, formFailure } from '../shared/fieldErrors';
import {
  MAX_RESPONSE_LENGTH,
  customLimitError,
  customLimitRange,
  isAlreadyHandled,
} from './limitFacts';

export type Decision = 'approve' | 'deny';

type LimitChoice = 'requested' | 'custom';

export interface RequestDecisionDialogProps {
  request: LimitRequest;
  decision: Decision;
  onClose: () => void;
}

export function RequestDecisionDialog({ request, decision, onClose }: RequestDecisionDialogProps) {
  const client = useQueryClient();
  const approving = decision === 'approve';
  const [choice, setChoice] = useState<LimitChoice>('requested');
  const [custom, setCustom] = useState(String(request.requested_tier));
  const [response, setResponse] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const requester = useQuery({ ...adminUserQuery(request.user_id), enabled: approving });
  const range = customLimitRange(request, requester.data?.limit_maximums.max_domains ?? null);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: adminKeys.limitRequests() }),
      client.invalidateQueries({ queryKey: adminKeys.limitReviews() }),
      client.invalidateQueries({ queryKey: adminKeys.users() }),
    ]);

  const decide = useMutation({
    mutationFn: () => {
      const text = response.trim() || undefined;
      if (!approving) return denyLimitRequest(request.id, text);
      return approveLimitRequest(request.id, {
        customLimit: choice === 'custom' ? Number(custom.trim()) : undefined,
        response: text,
      });
    },
    onSuccess: (result) => {
      showToast(
        'ok',
        approving
          ? `The limit of ${request.username} is now ${formatInteger(result.request.approved_limit ?? request.requested_tier)} domains.`
          : `The request from ${request.username} is denied.`,
      );
      onClose();
      return refresh();
    },
    onError: (error) => {
      if (isAlreadyHandled(toApiError(error).code)) void refresh();
    },
  });

  const alreadyHandled = decide.isError && isAlreadyHandled(toApiError(decide.error).code);
  const failure =
    decide.isError && !alreadyHandled
      ? formFailure(decide.error, {
          fields: ['custom_limit', 'response'],
          fallback: 'The decision could not be saved.',
        })
      : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = approving && choice === 'custom' ? customLimitError(custom, range) : null;
    setCustomError(error);
    if (!error) decide.mutate();
    else focusFirstInvalid(event.currentTarget);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        approving
          ? `Approve the request from ${request.username}`
          : `Deny the request from ${request.username}`
      }
      description={`Asked for ${formatInteger(request.requested_tier)} domains. The limit was ${formatInteger(request.current_limit)} when they asked.`}
      dismissible={!decide.isPending}
      closeOnBackdropClick={false}
      footer={
        alreadyHandled ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="request-decision"
              loading={decide.isPending}
            >
              {approving ? 'Approve and raise the limit' : 'Deny the request'}
            </Button>
          </>
        )
      }
    >
      {alreadyHandled ? (
        <Alert tone="warn" title="This request was already handled">
          Another admin decided it while this dialog was open. The list now shows their decision.
        </Alert>
      ) : (
        <form id="request-decision" onSubmit={submit} noValidate className="grid gap-4">
          {approving ? (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1.5 text-[13px] font-medium">New domain limit</legend>
              <label className="flex min-h-9 items-center gap-2 narrow:min-h-11">
                <input
                  type="radio"
                  name="limit-choice"
                  checked={choice === 'requested'}
                  onChange={() => setChoice('requested')}
                  className="size-4 accent-[var(--accent-start)]"
                />
                <span className="num">
                  The requested limit, {formatInteger(request.requested_tier)}
                </span>
              </label>
              <label className="flex min-h-9 items-center gap-2 narrow:min-h-11">
                <input
                  type="radio"
                  name="limit-choice"
                  checked={choice === 'custom'}
                  onChange={() => setChoice('custom')}
                  className="size-4 accent-[var(--accent-start)]"
                />
                A different limit
              </label>
              {choice === 'custom' ? (
                <Field
                  label="Domain limit"
                  hint={
                    range.max === null
                      ? `At least ${formatInteger(range.min)}.`
                      : `Between ${formatInteger(range.min)} and ${formatInteger(range.max)}.`
                  }
                  error={customError ?? failure?.fields.custom_limit}
                >
                  <Input
                    inputMode="numeric"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    autoComplete="off"
                    className="num"
                  />
                </Field>
              ) : null}
            </fieldset>
          ) : null}
          <Field
            label="Message to the account (optional)"
            hint={`Sent with the notification. At most ${formatInteger(MAX_RESPONSE_LENGTH)} characters.`}
            error={failure?.fields.response}
          >
            <Textarea
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              maxLength={MAX_RESPONSE_LENGTH}
              rows={3}
            />
          </Field>
          {failure?.form ? <Alert tone="fail">{failure.form}</Alert> : null}
        </form>
      )}
    </Dialog>
  );
}
