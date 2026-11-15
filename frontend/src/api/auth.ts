import type { User } from '../types';
import { API_BASE, get, post } from './http';

export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
};

export function fetchCurrentUser(): Promise<User> {
  return get<User>('/api/auth/me');
}

export async function fetchSession(): Promise<User | null> {
  const session = await get<{ user: User | null }>('/api/auth/session');
  return session.user;
}

export function signOut(): Promise<{ success: boolean }> {
  return post<{ success: boolean }>('/api/auth/logout');
}

export function gitHubSignInUrl(): string {
  return `${API_BASE}/api/auth/github`;
}
