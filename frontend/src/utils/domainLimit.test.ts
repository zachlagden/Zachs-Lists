import { describe, expect, it } from 'vitest';
import progress from '../../../tests/fixtures/job-progress.json';
import domainLimit from '../../../tests/fixtures/domain-limit.json';
import type { JobResult } from '../types';
import { domainLimitNotice } from './domainLimit';

const overLimit = domainLimit.over_limit;
const completed: JobResult = { ...progress.completed.result, limit: overLimit.limit };

describe('domain limit notice', () => {
  it('shows the sentence of a build that failed over the limit', () => {
    const result: JobResult = {
      ...completed,
      errors: [overLimit.error],
      warnings: [],
      error_code: 'domain_limit_exceeded',
      generation_id: null,
    };

    expect(domainLimitNotice({ status: 'failed', result })).toEqual({
      kind: 'failed',
      message: overLimit.error,
    });
  });

  it('shows the warning of a completed build that is over the limit', () => {
    const result: JobResult = {
      ...completed,
      warnings: [...completed.warnings, overLimit.warning],
    };

    expect(domainLimitNotice({ status: 'completed', result })).toEqual({
      kind: 'warning',
      message: overLimit.warning,
    });
  });

  it('shows nothing for other warnings, other failures and jobs without a result', () => {
    expect(domainLimitNotice({ status: 'completed', result: completed })).toBeNull();
    expect(
      domainLimitNotice({
        status: 'failed',
        result: {
          ...completed,
          errors: ['All source downloads failed'],
          error_code: 'all_sources_failed',
        },
      }),
    ).toBeNull();
    expect(domainLimitNotice({ status: 'failed', result: undefined })).toBeNull();
    expect(
      domainLimitNotice({
        status: 'processing',
        result: { ...completed, warnings: [overLimit.warning] },
      }),
    ).toBeNull();
  });
});
