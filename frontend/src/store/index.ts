import { create } from 'zustand';
import type { User, Job, UserList, UserStats, UserLimits } from '../types';
import type { ConnectionState } from '../realtime/backoff';
import { isStale, mergeFetchedList, mergeJob } from '../realtime/jobMerge';

// Auth store
interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  logout: () =>
    set({
      user: null,
      isAuthenticated: false,
    }),
}));

// User data store
interface UserDataState {
  config: string;
  whitelist: string;
  lists: UserList[];
  stats: UserStats | null;
  limits: UserLimits | null;
  remainingUpdates: number;

  setConfig: (config: string) => void;
  setWhitelist: (whitelist: string) => void;
  setLists: (lists: UserList[]) => void;
  setStats: (stats: UserStats) => void;
  setLimits: (limits: UserLimits) => void;
  setRemainingUpdates: (count: number) => void;
  reset: () => void;
}

export const useUserDataStore = create<UserDataState>((set) => ({
  config: '',
  whitelist: '',
  lists: [],
  stats: null,
  limits: null,
  remainingUpdates: 3,

  setConfig: (config) => set({ config }),
  setWhitelist: (whitelist) => set({ whitelist }),
  setLists: (lists) => set({ lists }),
  setStats: (stats) => set({ stats }),
  setLimits: (limits) => set({ limits }),
  setRemainingUpdates: (count) => set({ remainingUpdates: count }),
  reset: () =>
    set({
      config: '',
      whitelist: '',
      lists: [],
      stats: null,
      limits: null,
      remainingUpdates: 3,
    }),
}));

// Jobs store
interface JobsState {
  jobs: Job[];
  hasUnreadFailures: boolean;

  mergeFetchedJobs: (jobs: Job[]) => void;
  mergeJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (job: Job) => void;
  setHasUnreadFailures: (has: boolean) => void;
  reset: () => void;
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  hasUnreadFailures: false,

  mergeFetchedJobs: (jobs) => set((state) => ({ jobs: mergeFetchedList(state.jobs, jobs) })),
  mergeJobs: (jobs) => jobs.forEach((job) => get().updateJob(job)),

  addJob: (job) => get().updateJob(job),

  updateJob: (job) =>
    set((state) => {
      if (
        isStale(
          job,
          state.jobs.find((stored) => stored.job_id === job.job_id),
        )
      ) {
        return state;
      }
      return { jobs: mergeJob(state.jobs, job) };
    }),

  setHasUnreadFailures: (has) => set({ hasUnreadFailures: has }),

  reset: () => set({ jobs: [], hasUnreadFailures: false }),
}));

interface ConnectionStoreState {
  state: ConnectionState;
  setState: (state: ConnectionState) => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  state: 'connecting',
  setState: (state) => set({ state }),
}));
