import { create } from 'zustand';
import type {
  User,
  Job,
  UserList,
  UserStats,
  UserLimits,
  SourceProgress,
  WhitelistProgress,
  FormatProgress,
} from '../types';

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

// Jobs store - simplified for new architecture
// Progress data is now embedded in job.progress, no separate state needed
interface JobsState {
  jobs: Job[];
  activeJob: Job | null;
  hasUnreadFailures: boolean;

  // Legacy granular progress state - kept for backward compatibility
  // These are populated from job.progress when needed
  sourceProgress: Record<string, Record<string, SourceProgress>>;
  whitelistProgress: Record<string, WhitelistProgress>;
  formatProgress: Record<string, Record<string, FormatProgress>>;

  // Basic setters
  setJobs: (jobs: Job[]) => void;
  setActiveJob: (job: Job | null) => void;
  addJob: (job: Job) => void;
  updateJob: (job: Job) => void;
  setHasUnreadFailures: (has: boolean) => void;

  // Clear progress state for a completed job
  clearJobProgress: (jobId: string) => void;

  // Utility
  getSourcesSorted: (jobId: string) => SourceProgress[];
  reset: () => void;
}

// Sort order for source statuses
const sourceStatusOrder: Record<string, number> = {
  downloading: 0,
  processing: 1,
  pending: 2,
  failed: 3,
  completed: 4,
};

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  activeJob: null,
  hasUnreadFailures: false,
  sourceProgress: {},
  whitelistProgress: {},
  formatProgress: {},

  setJobs: (jobs) => set({ jobs }),
  setActiveJob: (job) => set({ activeJob: job }),

  addJob: (job) =>
    set((state) => {
      // Don't add if already exists
      if (state.jobs.some((j) => j.job_id === job.job_id)) {
        return state;
      }
      return { jobs: [job, ...state.jobs] };
    }),

  updateJob: (job) =>
    set((state) => {
      const existingIndex = state.jobs.findIndex((j) => j.job_id === job.job_id);
      let updatedJobs: Job[];

      if (existingIndex === -1) {
        // Job doesn't exist, add it
        updatedJobs = [job, ...state.jobs];
      } else {
        // Update existing job
        updatedJobs = state.jobs.map((j) => (j.job_id === job.job_id ? job : j));
      }

      // Update granular progress state from job.progress for compatibility
      const newSourceProgress = { ...state.sourceProgress };
      const newWhitelistProgress = { ...state.whitelistProgress };
      const newFormatProgress = { ...state.formatProgress };

      if (job.progress) {
        // Update source progress
        if (job.progress.sources && job.progress.sources.length > 0) {
          newSourceProgress[job.job_id] = {};
          for (const source of job.progress.sources) {
            newSourceProgress[job.job_id][source.id] = source;
          }
        }

        // Update whitelist progress
        if (job.progress.whitelist) {
          newWhitelistProgress[job.job_id] = job.progress.whitelist;
        }

        // Update format progress
        if (job.progress.generation?.formats) {
          newFormatProgress[job.job_id] = {};
          for (const format of job.progress.generation.formats) {
            newFormatProgress[job.job_id][format.format] = format;
          }
        }
      }

      return {
        jobs: updatedJobs,
        activeJob: state.activeJob?.job_id === job.job_id ? job : state.activeJob,
        sourceProgress: newSourceProgress,
        whitelistProgress: newWhitelistProgress,
        formatProgress: newFormatProgress,
      };
    }),

  setHasUnreadFailures: (has) => set({ hasUnreadFailures: has }),

  clearJobProgress: (jobId) =>
    set((state) => {
      const { [jobId]: _sources, ...restSources } = state.sourceProgress;
      const { [jobId]: _whitelist, ...restWhitelist } = state.whitelistProgress;
      const { [jobId]: _formats, ...restFormats } = state.formatProgress;

      return {
        sourceProgress: restSources,
        whitelistProgress: restWhitelist,
        formatProgress: restFormats,
      };
    }),

  getSourcesSorted: (jobId) => {
    const state = get();
    const jobSources = state.sourceProgress[jobId];
    if (!jobSources) return [];

    return Object.values(jobSources).sort((a, b) => {
      const orderA = sourceStatusOrder[a.status] ?? 99;
      const orderB = sourceStatusOrder[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      // Secondary sort by name
      return a.name.localeCompare(b.name);
    });
  },

  reset: () =>
    set({
      jobs: [],
      activeJob: null,
      hasUnreadFailures: false,
      sourceProgress: {},
      whitelistProgress: {},
      formatProgress: {},
    }),
}));

// UI store (theme, sidebar, etc.)
interface UIState {
  theme: 'dark' | 'light';
  sidebarOpen: boolean;

  setTheme: (theme: 'dark' | 'light') => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  sidebarOpen: true,

  setTheme: (theme) => {
    set({ theme });
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
