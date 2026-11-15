import { describe, expect, it } from 'vitest';
import type { LimitReview } from '../types';
import { limitConsequence, limitReviewSummary, openLimitReview } from './limitReview';

const review: LimitReview = {
  actual_domains: 5200000,
  max_domains: 4000000,
  method: 'exact',
  detected_at: '2026-01-15T12:00:00Z',
  notified_at: '2026-01-15T12:00:00Z',
  status: 'open',
  resolved_at: null,
  resolved_by: null,
  resolved_reason: null,
};

describe('limit review', () => {
  it('returns only a review that is still open', () => {
    expect(openLimitReview(review)).toBe(review);
    expect(openLimitReview({ ...review, status: 'resolved' })).toBeNull();
    expect(openLimitReview(null)).toBeNull();
    expect(openLimitReview(undefined)).toBeNull();
  });

  it('states both numbers and marks a stored count as approximate', () => {
    expect(limitReviewSummary(review)).toBe(
      'Your lists contain 5,200,000 domains across all categories. Your limit is 4,000,000.',
    );
    expect(limitReviewSummary({ ...review, method: 'stored' })).toBe(
      'Your lists contain about 5,200,000 domains across all categories. Your limit is 4,000,000.',
    );
  });

  it('says builds fail now only when the limit is enforced', () => {
    expect(limitConsequence(true)).toBe(
      'Builds over the limit fail, and your current lists stay published.',
    );
    expect(limitConsequence(false)).toBe(
      'Builds over the limit will start to fail once the limit is enforced. Your current lists stay published.',
    );
  });
});
