import { useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import type { AdminLimitReview } from '../types';
import { limitReviewMethodLabel } from '../utils/limitReview';

interface LimitReviewTableProps {
  reviews: AdminLimitReview[];
  total: number;
  enforcing: boolean | null;
  onResolve: (userId: string, reason: string) => Promise<boolean>;
}

const MAX_REASON_LENGTH = 200;

export default function LimitReviewTable({
  reviews,
  total,
  enforcing,
  onResolve,
}: LimitReviewTableProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<AdminLimitReview | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const askForReason = (review: AdminLimitReview): void => {
    setSelected(review);
    setReason('');
    dialogRef.current?.showModal();
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!selected || !trimmed) return;
    setSaving(true);
    const resolved = await onResolve(selected.user_id, trimmed);
    setSaving(false);
    if (resolved) dialogRef.current?.close();
  };

  return (
    <div className="card">
      <h3 className="font-semibold text-pihole-text">Over the domain limit</h3>
      <p className="text-sm text-pihole-text-muted mb-4">
        {enforcing === null
          ? 'Enforcement state is unknown.'
          : enforcing
            ? 'Enforcement is on. Builds over the limit fail and the previous lists stay published.'
            : 'Enforcement is off. Builds over the limit complete with a warning.'}
      </p>
      {reviews.length === 0 ? (
        <p className="text-pihole-text-muted text-center py-4">No accounts are over the limit.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-pihole-text-muted">
                <th className="p-2 font-medium">User</th>
                <th className="p-2 font-medium">Limit</th>
                <th className="p-2 font-medium">Measured</th>
                <th className="p-2 font-medium">Over by</th>
                <th className="p-2 font-medium">Method</th>
                <th className="p-2 font-medium">Detected</th>
                <th className="p-2 font-medium">Notified</th>
                <th className="p-2 font-medium">Limit request</th>
                <th className="p-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => (
                <tr key={review.user_id} className="border-t border-pihole-border">
                  <td className="p-2 text-pihole-text">{review.username}</td>
                  <td className="p-2 text-pihole-text">{review.max_domains.toLocaleString()}</td>
                  <td className="p-2 text-pihole-text">{review.actual_domains.toLocaleString()}</td>
                  <td className="p-2 text-red-400">{review.percent_over}%</td>
                  <td className="p-2 text-pihole-text-muted">
                    {limitReviewMethodLabel(review.method)}
                  </td>
                  <td className="p-2 text-pihole-text-muted">
                    {review.detected_at ? new Date(review.detected_at).toLocaleString() : 'Unknown'}
                  </td>
                  <td className="p-2 text-pihole-text-muted">{review.notified ? 'Yes' : 'No'}</td>
                  <td className="p-2 text-pihole-text-muted">
                    {review.has_pending_request ? 'Pending' : 'None'}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => askForReason(review)}
                      className="btn btn-secondary text-sm"
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > reviews.length ? (
            <p className="text-sm text-pihole-text-muted mt-3">
              Showing {reviews.length} of {total} accounts, largest first.
            </p>
          ) : null}
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="resolve-review-title"
        className="!m-auto bg-pihole-card rounded-xl shadow-xl max-w-lg w-full p-0 text-pihole-text backdrop:bg-black/50"
      >
        <form onSubmit={submit}>
          <div className="p-4 border-b border-pihole-border">
            <h2 id="resolve-review-title" className="text-lg font-semibold text-pihole-text">
              Resolve the review for {selected?.username}?
            </h2>
          </div>
          <div className="p-4 space-y-3 text-sm text-pihole-text-muted">
            <p>
              This removes the account from this table and the warning from the user's dashboard. It
              does not change the user's limit. A later build or audit that finds the account over
              the limit opens a new review.
            </p>
            <label htmlFor="resolve-review-reason" className="block text-pihole-text">
              Reason
            </label>
            <input
              id="resolve-review-reason"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={MAX_REASON_LENGTH}
              required
              className="input w-full"
            />
          </div>
          <div className="flex items-center justify-end gap-3 p-4 border-t border-pihole-border">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving || !reason.trim()} className="btn btn-primary">
              Resolve
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
