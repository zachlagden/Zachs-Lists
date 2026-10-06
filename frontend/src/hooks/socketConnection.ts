import { io, Socket } from 'socket.io-client';
import { authApi } from '../api/client';
import { useAuthStore, useJobsStore, useUserDataStore } from '../store';

const SOCKET_URL = import.meta.env.VITE_API_URL || '';
const MAX_RECONNECT_ATTEMPTS = 5;
export let socket: Socket | null = null;
let authCheckSocket: Socket | null = null;
let connectionAttempts = 0;

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  authCheckSocket = null;
  connectionAttempts = 0;
}

async function reconnectAuthenticated(current: Socket, attempt = 0): Promise<void> {
  if (socket !== current || !useAuthStore.getState().isAuthenticated) return;
  authCheckSocket = current;
  try {
    const user = await authApi.getMe();
    if (socket === current) {
      useAuthStore.getState().setUser(user);
      current.connect();
    }
  } catch (error: unknown) {
    if (socket !== current) return;
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) {
      disconnectSocket();
      useAuthStore.getState().setUser(null);
      useUserDataStore.getState().reset();
      useJobsStore.getState().reset();
    } else if (attempt < MAX_RECONNECT_ATTEMPTS) {
      setTimeout(() => void reconnectAuthenticated(current, attempt + 1), 1000);
    }
  } finally {
    if (authCheckSocket === current) authCheckSocket = null;
  }
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.on('connect', () => {
      connectionAttempts = 0;
    });
    const current = socket;
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect' && authCheckSocket !== current) {
        void reconnectAuthenticated(current);
      }
    });
    socket.on('connect_error', () => {
      connectionAttempts++;
      if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('Realtime connection is unavailable');
      }
    });
  }
  return socket;
}
