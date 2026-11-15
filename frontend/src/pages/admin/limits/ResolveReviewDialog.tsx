import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { adminKeys, resolveLimitReview } from '../../../api/admin';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Field, Textarea } from '../../../components/ui/Field';
import { showToast } from '../../../components/ui/toasts';
import { formatInteger } from '../../../lib/format';
import { focusFirstInvalid, formFailure } from '../shared/fieldErrors';
import { MAX_RESOLVE_REASON_LENGTH } from './limitFacts';

export interface ReviewSubject {
  user_id: string;
  username: string;
  actual_domains: number;
  max_domains: number;
}

export interface ResolveReviewDialogProps {
  review: ReviewSubject;
  onClose: () => void;
  onResolved?: () => void;
}

export function ResolveReviewDialog({ review, onClose, onResolved }: ResolveReviewDialogProps) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const resolve = useMutation({
    mutationFn: (text: string) => resolveLimitReview(review.user_id, text),
    onSuccess: () => {
      showToast('ok', `The limit review for ${review.username} is resolved.`);
      onResolved?.();
      onClose();
      return Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.limitReviews() }),
        client.invalidateQueries({ queryKey: adminKeys.user(review.user_id) }),
      ]);
    },
  });
  const failure = resolve.isError
    ? formFailure(resolve.error, {
        fields: ['reason'],
        fallback: 'The review could not be resolved.',
      })
    : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = reason.trim();
    setMissing(text === '');
    if (text !== '') resolve.mutate(text);
    else focusFirstInvalid(event.currentTarget);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Resolve the limit review for ${review.username}`}
      description={`Measured at ${formatInteger(review.actual_domains)} domains against a limit of ${formatInteger(review.max_domains)}.`}
      dismissible={!resolve.isPending}
      closeOnBackdropClick={false}
      footer={
        <>
          <Button onClick={onClose} disabled={resolve.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="resolve-review" loading={resolve.isPending}>
            Resolve the review
          </Button>
        </>
      }
    >
      <form id="resolve-review" onSubmit={submit} className="grid gap-3">
        <p className="text-[13px] text-text-secondary">
          Resolving closes the review without changing the account or its lists. A later build over
          the limit opens a new one.
        </p>
        <Field
          label="Reason"
          hint={`Kept with the review. At most ${MAX_RESOLVE_REASON_LENGTH} characters.`}
          error={missing ? 'Give a reason for resolving the review.' : failure?.fields.reason}
        >
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MAX_RESOLVE_REASON_LENGTH}
            rows={3}
            aria-required="true"
          />
        </Field>
        {failure?.form ? <Alert tone="fail">{failure.form}</Alert> : null}
      </form>
    </Dialog>
  );
}
