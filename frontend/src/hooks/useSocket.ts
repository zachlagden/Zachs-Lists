import { useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { Job } from '../types';
import { useConnectionStore } from '../store';
import { resyncJobs, type JobsSubscription } from '../realtime/resync';
import { createRoomSubscribers } from '../realtime/roomSubscribers';
import { getSocket, hasReconnected } from './socketConnection';

interface UseJobSocketOptions {
  userId?: string;
  isAdmin?: boolean;
  onJobCreated?: (job: Job) => void;
  onJobProgress?: (job: Job) => void;
  onJobCompleted?: (job: Job) => void;
  onReconnect?: () => void;
  knownJobs: () => Job[];
  fetchJob: (jobId: string) => Promise<Job>;
  onJobsSynced: (jobs: Job[]) => void;
  onResyncFailed: (jobIds: string[]) => void;
}

const jobRoomSubscribers = createRoomSubscribers();

interface UseSocketResult {
  isConnected: boolean;
}

function useIsConnected(): boolean {
  return useConnectionStore((connection) => connection.state === 'connected');
}

export function useJobSocket({
  userId,
  isAdmin = false,
  onJobCreated,
  onJobProgress,
  onJobCompleted,
  onReconnect,
  knownJobs,
  fetchJob,
  onJobsSynced,
  onResyncFailed,
}: UseJobSocketOptions): UseSocketResult {
  const callbacksRef = useRef({
    onJobCreated,
    onJobProgress,
    onJobCompleted,
    onReconnect,
    knownJobs,
    fetchJob,
    onJobsSynced,
    onResyncFailed,
  });

  useEffect(() => {
    callbacksRef.current = {
      onJobCreated,
      onJobProgress,
      onJobCompleted,
      onReconnect,
      knownJobs,
      fetchJob,
      onJobsSynced,
      onResyncFailed,
    };
  });

  useEffect(() => {
    const room = isAdmin ? { all: true } : userId ? { user_id: userId } : null;
    if (!room) return;
    const s = getSocket();
    let mounted = true;
    let subscribed = false;

    const catchUp = async (subscription: JobsSubscription, reconnected: boolean) => {
      if (!mounted || subscription.error) return;
      const unresolved = await resyncJobs({
        known: callbacksRef.current.knownJobs(),
        subscription,
        apply: (jobs) => {
          if (mounted) callbacksRef.current.onJobsSynced(jobs);
        },
        fetchJob: (jobId) => callbacksRef.current.fetchJob(jobId),
      });
      if (unresolved.length > 0) callbacksRef.current.onResyncFailed(unresolved);
      if (mounted && reconnected) callbacksRef.current.onReconnect?.();
    };

    const roomKey = JSON.stringify(room);
    const subscribe = (reconnected: boolean) => {
      if (!subscribed) jobRoomSubscribers.join(roomKey);
      subscribed = true;
      s.emit('subscribe:jobs', room, (subscription: JobsSubscription) => {
        void catchUp(subscription, reconnected);
      });
    };

    const handleJobCreated = (job: Job) => callbacksRef.current.onJobCreated?.(job);
    const handleJobProgress = (job: Job) => callbacksRef.current.onJobProgress?.(job);
    const handleJobCompleted = (job: Job) => callbacksRef.current.onJobCompleted?.(job);
    const handleConnect = () => subscribe(hasReconnected());

    s.on('job:created', handleJobCreated);
    s.on('job:progress', handleJobProgress);
    s.on('job:completed', handleJobCompleted);
    s.on('connect', handleConnect);
    if (s.connected) subscribe(false);

    return () => {
      mounted = false;
      s.off('job:created', handleJobCreated);
      s.off('job:progress', handleJobProgress);
      s.off('job:completed', handleJobCompleted);
      s.off('connect', handleConnect);
      if (!subscribed) return;
      const lastSubscriber = jobRoomSubscribers.leave(roomKey);
      if (lastSubscriber && s.connected) s.emit('unsubscribe:jobs', room);
    };
  }, [userId, isAdmin]);

  return { isConnected: useIsConnected() };
}
interface ValidationProgress {
  current: number;
  total: number;
  url: string;
  status: string;
}

interface ValidationResult {
  issues: Array<{
    severity: 'error' | 'warning';
    message: string;
    line?: number;
    url?: string;
  }>;
  validated_count: number;
  error_count: number;
  warning_count: number;
  has_errors: boolean;
  has_warnings: boolean;
}

interface UseValidationSocketOptions {
  userId?: string;
  onProgress?: (progress: ValidationProgress) => void;
  onComplete?: (result: ValidationResult) => void;
}
export function useValidationSocket({
  userId,
  onProgress,
  onComplete,
}: UseValidationSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const subscribedRef = useRef(false);
  const callbacksRef = useRef({ onProgress, onComplete });

  useEffect(() => {
    callbacksRef.current = { onProgress, onComplete };
  });

  const subscribe = useCallback(() => {
    if (!userId) return;

    const s = getSocket();
    socketRef.current = s;

    if (subscribedRef.current || !s.connected) return;

    s.emit('subscribe:validation', { user_id: userId });
    subscribedRef.current = true;
  }, [userId]);

  const unsubscribe = useCallback(() => {
    if (!userId) return;

    const s = socketRef.current;
    if (!s || !subscribedRef.current) return;

    s.emit('unsubscribe:validation', { user_id: userId });
    subscribedRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const s = getSocket();
    socketRef.current = s;

    const handleProgress = (progress: ValidationProgress) => {
      callbacksRef.current.onProgress?.(progress);
    };

    const handleComplete = (result: ValidationResult) => {
      callbacksRef.current.onComplete?.(result);
    };

    s.on('config:validation_progress', handleProgress);
    s.on('config:validation_complete', handleComplete);
    const handleConnect = () => {
      subscribedRef.current = false;
      subscribe();
    };
    s.on('connect', handleConnect);
    if (s.connected) handleConnect();

    return () => {
      s.off('config:validation_progress', handleProgress);
      s.off('config:validation_complete', handleComplete);
      s.off('connect', handleConnect);
      unsubscribe();
    };
  }, [userId, subscribe, unsubscribe]);

  return {
    isConnected: useIsConnected(),
    subscribe,
    unsubscribe,
  };
}
