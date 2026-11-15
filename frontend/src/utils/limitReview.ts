import { formatInteger } from '../lib/format';
import type { LimitReview } from '../types';

export function openLimitReview(review: LimitReview | null | undefined): LimitReview | null {
  return review && review.status === 'open' ? review : null;
}

export function limitConsequence(enforcing: boolean): string {
  return enforcing
    ? 'Builds over the limit fail, and your current lists stay published.'
    : 'Builds over the limit will start to fail once the limit is enforced. Your current lists stay published.';
}

export function limitReviewSummary(review: LimitReview): string {
  const measured = formatInteger(review.actual_domains);
  const limit = formatInteger(review.max_domains);
  const about = review.method === 'stored' ? 'about ' : '';
  return `Your lists contain ${about}${measured} domains across all categories. Your limit is ${limit}.`;
}
