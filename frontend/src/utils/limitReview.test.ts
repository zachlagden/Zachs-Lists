import { describe, expect, it } from 'vitest';
import type { LimitReview } from '../types';
import { limitReviewMethodLabel, limitReviewSummary, openLimitReview } from './limitReview';

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

  it('names each measurement method and passes an unknown one through', () => {
    expect(limitReviewMethodLabel('exact')).toBe('Counted from files');
    expect(limitReviewMethodLabel('build')).toBe('Counted by a build');
    expect(limitReviewMethodLabel('stored')).toBe('Estimated from stored counts');
    expect(limitReviewMethodLabel('other')).toBe('other');
  });
});
