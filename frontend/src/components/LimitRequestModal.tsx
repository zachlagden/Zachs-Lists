import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { accountKeys, submitLimitRequest } from '../api/account';
import { describeApiError } from '../api/errors';
import { formatInteger } from '../lib/format';
import { INTENDED_USE_LABELS, type IntendedUse } from '../types';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field, Select, Textarea } from './ui/Field';

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 1000;

export interface LimitRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLimit: number;
  availableTiers: number[];
  onSuccess?: () => void;
}

export default function LimitRequestModal({
  isOpen,
  onClose,
  currentLimit,
  availableTiers,
  onSuccess,
}: LimitRequestModalProps) {
  const formId = useId();
  const client = useQueryClient();
  const [requestedTier, setRequestedTier] = useState<number>(availableTiers[0] ?? 0);
  const [reason, setReason] = useState('');
  const [intendedUse, setIntendedUse] = useState<IntendedUse>('personal');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const trimmedLength = reason.trim().length;

  const submission = useMutation({
    mutationFn: submitLimitRequest,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: accountKeys.limitRequests() });
      onSuccess?.();
      onClose();
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmedLength < MIN_REASON_LENGTH) {
      setReasonError(`Write at least ${MIN_REASON_LENGTH} characters about why you need it.`);
      reasonRef.current?.focus();
      return;
    }
    setReasonError(null);
    submission.mutate({ requestedTier, reason: reason.trim(), intendedUse });
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Request a higher limit"
      description={`Your limit is ${formatInteger(currentLimit)} domains. An admin reviews each request.`}
      dismissible={!submission.isPending}
      closeOnBackdropClick={reason.trim() === ''}
      footer={
        <>
          <Button onClick={onClose} disabled={submission.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submission.isPending}>
            Send request
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="grid gap-4">
        {submission.isError ? (
          <Alert tone="fail">
            {describeApiError(submission.error, 'The request could not be sent. Try again.')}
          </Alert>
        ) : null}
        <Field label="Requested limit">
          <Select
            name="requested_tier"
            autoComplete="off"
            value={requestedTier}
            onChange={(event) => setRequestedTier(Number(event.target.value))}
            required
          >
            {availableTiers.map((tier) => (
              <option key={tier} value={tier}>
                {formatInteger(tier)} domains
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Who the list is for">
          <Select
            name="intended_use"
            autoComplete="off"
            value={intendedUse}
            onChange={(event) => setIntendedUse(event.target.value as IntendedUse)}
            required
          >
            {Object.entries(INTENDED_USE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Why you need it"
          error={reasonError}
          hint={`${formatInteger(trimmedLength)} of ${formatInteger(MAX_REASON_LENGTH)} characters, at least ${MIN_REASON_LENGTH}`}
        >
          <Textarea
            ref={reasonRef}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={MAX_REASON_LENGTH}
            autoComplete="off"
            placeholder="For example: I combine several large lists for a home network…"
          />
        </Field>
      </form>
    </Dialog>
  );
}
