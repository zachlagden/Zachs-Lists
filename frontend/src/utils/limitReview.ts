import type { LimitReview } from '../types';

export function openLimitReview(review: LimitReview | null | undefined): LimitReview | null {
  return review && review.status === 'open' ? review : null;
}

export function limitReviewMethodLabel(method: string): string {
  if (method === 'exact') return 'Counted from files';
  if (method === 'build') return 'Counted by a build';
  if (method === 'stored') return 'Estimated from stored counts';
  return method;
}

export function limitConsequence(enforcing: boolean): string {
  return enforcing
    ? 'Builds over the limit fail, and your current lists stay published.'
    : 'Builds over the limit will start to fail once the limit is enforced. Your current lists stay published.';
}

export function limitReviewSummary(review: LimitReview): string {
  const measured = review.actual_domains.toLocaleString('en-GB');
  const limit = review.max_domains.toLocaleString('en-GB');
  const about = review.method === 'stored' ? 'about ' : '';
  return `Your lists contain ${about}${measured} domains across all categories. Your limit is ${limit}.`;
}
