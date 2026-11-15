import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { jobsKeys, markFailedJobsRead, type JobsResponse } from '../../api/jobs';
import { useConnectionStore } from '../../store';
import type { Job } from '../../types';

export function useUpdatesPaused(): boolean {
  return useConnectionStore(
    (connection) => connection.state === 'reconnecting' || connection.state === 'offline',
  );
}

export function useMarkFailuresRead(unreadFailureShown: boolean, shownJobId?: string): void {
  const client = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: markFailedJobsRead,
    onSuccess: () => {
      client.setQueryData<JobsResponse>(jobsKeys.list(), (current) =>
        current ? { ...current, has_unread_failures: false } : current,
      );
      if (shownJobId === undefined) return;
      client.setQueryData<Job>(jobsKeys.detail(shownJobId), (current) =>
        current ? { ...current, read: true } : current,
      );
    },
  });
  const sent = useRef(false);

  useEffect(() => {
    if (!unreadFailureShown) {
      sent.current = false;
      return;
    }
    if (sent.current) return;
    sent.current = true;
    mutate();
  }, [unreadFailureShown, mutate]);
}
