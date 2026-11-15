import { create } from 'zustand';
import type { AlertTone } from './Alert';

export const TOAST_LIFETIME_MS = 6000;

export interface Toast {
  id: number;
  tone: AlertTone;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  show: (tone: AlertTone, message: string) => number;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (tone, message) => {
    const id = nextToastId;
    nextToastId += 1;
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }] }));
    setTimeout(() => get().dismiss(id), TOAST_LIFETIME_MS);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export function showToast(tone: AlertTone, message: string): number {
  return useToastStore.getState().show(tone, message);
}
