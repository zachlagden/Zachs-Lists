import { io, Socket } from 'socket.io-client';
import { fetchCurrentUser } from '../api/auth';
import { toApiError } from '../api/errors';
import { useAuthStore, useConnectionStore } from '../store';
import { reconnectDelay, stateAfterFailures } from '../realtime/backoff';
import { expireSession, onSessionEnd } from '../session';
import { isDeadSessionStatus } from '../sessionExpiry';

const SOCKET_URL = import.meta.env.VITE_API_URL || '';
let socket: Socket | null = null;
let sessionCheckSocket: Socket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let connections = 0;

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

export function hasReconnected(): boolean {
  return connections > 1;
}

function disconnectSocket(): void {
  clearRetry();
  socket?.disconnect();
  socket = null;
  sessionCheckSocket = null;
  failures = 0;
  connections = 0;
  useConnectionStore.getState().setState('connecting');
}

function scheduleReconnect(current: Socket): void {
  if (socket !== current || retryTimer !== null) return;
  failures += 1;
  useConnectionStore.getState().setState(stateAfterFailures(failures, navigator.onLine));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (socket === current) current.connect();
  }, reconnectDelay(failures));
}

async function reconnectIfSignedIn(current: Socket, immediately: boolean): Promise<void> {
  if (socket !== current || sessionCheckSocket === current) return;
  if (!useAuthStore.getState().isAuthenticated) return;
  sessionCheckSocket = current;
  try {
    const user = await fetchCurrentUser();
    if (socket !== current) return;
    useAuthStore.getState().setUser(user);
    if (immediately) current.connect();
    else scheduleReconnect(current);
  } catch (error: unknown) {
    if (socket !== current) return;
    if (isDeadSessionStatus(toApiError(error).status)) expireSession();
    else scheduleReconnect(current);
  } finally {
    if (sessionCheckSocket === current) sessionCheckSocket = null;
  }
}

function isTransportFailure(error: Error): boolean {
  return 'type' in error || error.message === 'timeout';
}

function retryNow(): void {
  if (!socket || socket.connected) return;
  clearRetry();
  socket.connect();
}

function reportBrowserOffline(): void {
  if (socket && !socket.connected) useConnectionStore.getState().setState('offline');
}

export function getSocket(): Socket {
  if (!socket) {
    const current = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: false,
    });
    socket = current;
    onSessionEnd(disconnectSocket);
    current.on('connect', () => {
      clearRetry();
      failures = 0;
      connections += 1;
      useConnectionStore.getState().setState('connected');
    });
    current.on('disconnect', (reason) => {
      if (socket !== current || reason === 'io client disconnect') return;
      useConnectionStore.getState().setState('reconnecting');
      if (reason === 'io server disconnect') void reconnectIfSignedIn(current, true);
      else scheduleReconnect(current);
    });
    current.on('connect_error', (error) => {
      if (isTransportFailure(error)) scheduleReconnect(current);
      else void reconnectIfSignedIn(current, false);
    });
    window.removeEventListener('online', retryNow);
    window.removeEventListener('offline', reportBrowserOffline);
    window.addEventListener('online', retryNow);
    window.addEventListener('offline', reportBrowserOffline);
  }
  return socket;
}
