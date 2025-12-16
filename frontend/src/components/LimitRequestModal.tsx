import { useState } from 'react';
import { userApi } from '../api/client';
import LoadingSpinner from './LoadingSpinner';
import type { IntendedUse } from '../types';
import { INTENDED_USE_LABELS } from '../types';

interface LimitRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLimit: number;
  availableTiers: number[];
  onSuccess: () => void;
}

function formatDomains(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(0) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(0) + 'K';
  return count.toLocaleString();
}

export default function LimitRequestModal({
  isOpen,
  onClose,
  currentLimit,
  availableTiers,
  onSuccess,
}: LimitRequestModalProps) {
  const [selectedTier, setSelectedTier] = useState<number>(availableTiers[0] || 0);
  const [reason, setReason] = useState('');
  const [intendedUse, setIntendedUse] = useState<IntendedUse>('personal');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await userApi.submitLimitRequest(selectedTier, reason, intendedUse);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-pihole-card border border-pihole-border rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-pihole-text">Request Higher Limit</h2>
            <button
              onClick={onClose}
              className="text-pihole-text-muted hover:text-pihole-text"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-pihole-text-muted text-sm mb-6">
            Your current limit is <strong className="text-pihole-text">{formatDomains(currentLimit)}</strong> domains.
            Submit a request to increase your limit.
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Tier Selection */}
            <div>
              <label className="block text-sm font-medium text-pihole-text mb-2">
                Requested Limit
              </label>
              <select
                value={selectedTier}
                onChange={(e) => setSelectedTier(Number(e.target.value))}
                className="input w-full"
                required
              >
                {availableTiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {formatDomains(tier)} domains
                  </option>
                ))}
              </select>
            </div>

            {/* Intended Use */}
            <div>
              <label className="block text-sm font-medium text-pihole-text mb-2">
                Intended Use
              </label>
              <select
                value={intendedUse}
                onChange={(e) => setIntendedUse(e.target.value as IntendedUse)}
                className="input w-full"
                required
              >
                {Object.entries(INTENDED_USE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-pihole-text mb-2">
                Reason for Request
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input w-full h-24 resize-none"
                placeholder="Please explain why you need a higher domain limit..."
                required
                minLength={10}
                maxLength={1000}
              />
              <p className="text-xs text-pihole-text-muted mt-1">
                {reason.length}/1000 characters (minimum 10)
              </p>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary flex-1"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={loading || reason.length < 10}
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span className="ml-2">Submitting...</span>
                  </>
                ) : (
                  'Submit Request'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
