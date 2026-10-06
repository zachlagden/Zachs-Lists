import { useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { Job } from '../types';
import { getSocket, socket } from './socketConnection';
export { disconnectSocket } from './socketConnection';

interface JobSkippedData {
  job_id: string;
  reason: string;
}

interface UseJobSocketOptions {
  userId?: string;
  isAdmin?: boolean;
  onJobCreated?: (job: Job) => void;
  onJobProgress?: (job: Job) => void;
  onJobCompleted?: (job: Job) => void;
  onJobSkipped?: (data: JobSkippedData) => void;
}

/**
 * Hook for subscribing to job updates via WebSocket.
 *
 * Events:
 * - job:created - New job was created
 * - job:progress - Job progress updated (every 500ms when state changes)
 * - job:completed - Job finished (success/fail/skip)
 * - job:skipped - Job was skipped
 */
export function useJobSocket({
  userId,
  isAdmin = false,
  onJobCreated,
  onJobProgress,
  onJobCompleted,
  onJobSkipped,
}: UseJobSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const subscribedRef = useRef(false);

  // Store callbacks in a ref to avoid re-running the effect when they change
  const callbacksRef = useRef({
    onJobCreated,
    onJobProgress,
    onJobCompleted,
    onJobSkipped,
  });

  // Update the ref on every render so handlers always call latest callbacks
  useEffect(() => {
    callbacksRef.current = {
      onJobCreated,
      onJobProgress,
      onJobCompleted,
      onJobSkipped,
    };
  });

  const subscribe = useCallback(() => {
    const s = getSocket();
    socketRef.current = s;

    if (subscribedRef.current || !s.connected) return;

    // Subscribe to appropriate room
    if (isAdmin) {
      s.emit('subscribe:jobs', { all: true });
    } else if (userId) {
      s.emit('subscribe:jobs', { user_id: userId });
    }

    subscribedRef.current = true;
  }, [userId, isAdmin]);

  const unsubscribe = useCallback(() => {
    const s = socketRef.current;
    if (!s || !subscribedRef.current) return;

    if (isAdmin) {
      s.emit('unsubscribe:jobs', { all: true });
    } else if (userId) {
      s.emit('unsubscribe:jobs', { user_id: userId });
    }

    subscribedRef.current = false;
  }, [userId, isAdmin]);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    // Set up event listeners - read from ref to always get latest callbacks
    const handleJobCreated = (job: Job) => {
      callbacksRef.current.onJobCreated?.(job);
    };

    const handleJobProgress = (job: Job) => {
      callbacksRef.current.onJobProgress?.(job);
    };

    const handleJobCompleted = (job: Job) => {
      callbacksRef.current.onJobCompleted?.(job);
    };

    const handleJobSkipped = (data: JobSkippedData) => {
      callbacksRef.current.onJobSkipped?.(data);
    };

    // Register event listeners
    s.on('job:created', handleJobCreated);
    s.on('job:progress', handleJobProgress);
    s.on('job:completed', handleJobCompleted);
    s.on('job:skipped', handleJobSkipped);
    const handleConnect = () => {
      subscribedRef.current = false;
      subscribe();
    };
    s.on('connect', handleConnect);
    if (s.connected) handleConnect();

    // Cleanup on unmount
    return () => {
      s.off('job:created', handleJobCreated);
      s.off('job:progress', handleJobProgress);
      s.off('job:completed', handleJobCompleted);
      s.off('job:skipped', handleJobSkipped);
      s.off('connect', handleConnect);
      unsubscribe();
    };
  }, [subscribe, unsubscribe]);

  return {
    isConnected: socket?.connected ?? false,
    subscribe,
    unsubscribe,
  };
}

// Validation progress types
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

/**
 * Hook for subscribing to config validation progress.
 */
export function useValidationSocket({
  userId,
  onProgress,
  onComplete,
}: UseValidationSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const subscribedRef = useRef(false);

  // Store callbacks in ref
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
    isConnected: socket?.connected ?? false,
    subscribe,
    unsubscribe,
  };
}

interface UseStatsSocketOptions {
  onStatsUpdated?: () => void;
}

/**
 * Hook for subscribing to admin stats updates.
 */
export function useStatsSocket({ onStatsUpdated }: UseStatsSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const subscribedRef = useRef(false);

  // Store callback in ref
  const callbackRef = useRef(onStatsUpdated);

  useEffect(() => {
    callbackRef.current = onStatsUpdated;
  });

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    const handleStatsUpdated = () => {
      callbackRef.current?.();
    };

    s.on('stats:updated', handleStatsUpdated);
    const handleConnect = () => {
      s.emit('subscribe:stats');
      subscribedRef.current = true;
    };
    s.on('connect', handleConnect);
    if (s.connected) handleConnect();

    return () => {
      s.off('stats:updated', handleStatsUpdated);
      s.off('connect', handleConnect);
      if (subscribedRef.current) {
        s.emit('unsubscribe:stats');
        subscribedRef.current = false;
      }
    };
  }, []);

  return {
    isConnected: socket?.connected ?? false,
  };
}
