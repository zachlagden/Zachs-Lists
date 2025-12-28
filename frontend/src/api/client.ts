import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Don't redirect if:
      // 1. This is the /api/auth/me check (expected to fail when not logged in)
      // 2. Already on login page
      const isAuthMeRequest = error.config?.url?.includes('/api/auth/me');
      const isOnLoginPage = window.location.pathname === '/login';

      if (!isAuthMeRequest && !isOnLoginPage) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  getMe: async () => {
    const response = await api.get('/api/auth/me');
    return response.data;
  },

  logout: async () => {
    const response = await api.post('/api/auth/logout');
    return response.data;
  },

  getGitHubLoginUrl: () => `${API_BASE}/api/auth/github`,
};

// User API
export const userApi = {
  getConfig: async () => {
    const response = await api.get('/api/user/config');
    return response.data;
  },

  updateConfig: async (config: string, validationToken: string) => {
    const response = await api.put('/api/user/config', {
      config,
      validation_token: validationToken,
    });
    return response.data;
  },

  validateConfig: async (config: string) => {
    const response = await api.post('/api/user/config/validate', { config });
    return response.data;
  },

  getCategories: async () => {
    const response = await api.get('/api/user/config/categories');
    return response.data;
  },

  getLibrary: async () => {
    const response = await api.get('/api/user/library');
    return response.data;
  },

  getWhitelist: async () => {
    const response = await api.get('/api/user/whitelist');
    return response.data;
  },

  updateWhitelist: async (whitelist: string) => {
    const response = await api.put('/api/user/whitelist', { whitelist });
    return response.data;
  },

  getLists: async () => {
    const response = await api.get('/api/user/lists');
    return response.data;
  },

  triggerBuild: async () => {
    const response = await api.post('/api/user/build');
    return response.data;
  },

  getJobs: async (limit = 20) => {
    const response = await api.get('/api/user/jobs', { params: { limit } });
    return response.data;
  },

  getJob: async (jobId: string) => {
    const response = await api.get(`/api/user/jobs/${jobId}`);
    return response.data;
  },

  markJobsRead: async () => {
    const response = await api.post('/api/user/jobs/mark-read');
    return response.data;
  },

  copyDefaultTemplate: async (overwrite = false) => {
    const response = await api.post('/api/user/copy-default-template', {
      overwrite,
    });
    return response.data;
  },

  // Limit Requests
  submitLimitRequest: async (requestedTier: number, reason: string, intendedUse: string) => {
    const response = await api.post('/api/user/limit-request', {
      requested_tier: requestedTier,
      reason,
      intended_use: intendedUse,
    });
    return response.data;
  },

  getLimitRequests: async () => {
    const response = await api.get('/api/user/limit-request');
    return response.data;
  },

  // Notifications
  getNotifications: async () => {
    const response = await api.get('/api/user/notifications');
    return response.data;
  },

  markNotificationRead: async (notificationId: string) => {
    const response = await api.post(`/api/user/notifications/${notificationId}/read`);
    return response.data;
  },

  getUrlMetadata: async (urls: string[]) => {
    const response = await api.post('/api/user/config/url-metadata', { urls });
    return response.data;
  },
};

// Analytics API
export const analyticsApi = {
  getDefaultStats: async (days = 30) => {
    const response = await api.get('/api/analytics/default', {
      params: { days },
    });
    return response.data;
  },

  getUserStats: async (days = 30) => {
    const response = await api.get('/api/analytics/user', { params: { days } });
    return response.data;
  },

  getUserListStats: async (listName: string, days = 30) => {
    const response = await api.get(`/api/analytics/user/${listName}`, {
      params: { days },
    });
    return response.data;
  },

  getPublicStats: async () => {
    const response = await api.get('/api/analytics/public/stats');
    return response.data;
  },
};

// Lists API (public)
export const listsApi = {
  getDefaultLists: async () => {
    const response = await api.get('/api/lists');
    return response.data;
  },
};

// Admin API
interface GetUsersParams {
  page?: number;
  perPage?: number;
  search?: string;
  showAdmins?: boolean;
  showRegular?: boolean;
  showEnabled?: boolean;
  showDisabled?: boolean;
}

export const adminApi = {
  getUsers: async (params: GetUsersParams = {}) => {
    const response = await api.get('/api/admin/users', {
      params: {
        page: params.page ?? 1,
        per_page: params.perPage ?? 25,
        search: params.search || undefined,
        show_admins: params.showAdmins ?? true,
        show_regular: params.showRegular ?? true,
        show_enabled: params.showEnabled ?? true,
        show_disabled: params.showDisabled ?? true,
      },
    });
    return response.data;
  },

  getUser: async (userId: string) => {
    const response = await api.get(`/api/admin/users/${userId}`);
    return response.data;
  },

  updateUser: async (
    userId: string,
    data: { is_enabled?: boolean; limits?: Record<string, number> }
  ) => {
    const response = await api.put(`/api/admin/users/${userId}`, data);
    return response.data;
  },

  deleteUser: async (userId: string) => {
    const response = await api.delete(`/api/admin/users/${userId}`);
    return response.data;
  },

  triggerUserRebuild: async (userId: string) => {
    const response = await api.post(`/api/admin/rebuild/${userId}`);
    return response.data;
  },

  triggerDefaultRebuild: async () => {
    const response = await api.post('/api/admin/rebuild/default');
    return response.data;
  },

  getAllJobs: async (limit = 50) => {
    const response = await api.get('/api/admin/jobs', { params: { limit } });
    return response.data;
  },

  getJob: async (jobId: string) => {
    const response = await api.get(`/api/admin/jobs/${jobId}`);
    return response.data;
  },

  getStats: async () => {
    const response = await api.get('/api/admin/stats');
    return response.data;
  },

  getJobsPerDay: async (days = 30) => {
    const response = await api.get('/api/admin/stats/jobs-per-day', {
      params: { days },
    });
    return response.data;
  },

  getUserGrowth: async (days = 30) => {
    const response = await api.get('/api/admin/stats/user-growth', {
      params: { days },
    });
    return response.data;
  },

  getDefaultConfig: async () => {
    const response = await api.get('/api/admin/default/config');
    return response.data;
  },

  updateDefaultConfig: async (config?: string, whitelist?: string) => {
    const response = await api.put('/api/admin/default/config', {
      config,
      whitelist,
    });
    return response.data;
  },

  getFeaturedLists: async () => {
    const response = await api.get('/api/admin/featured');
    return response.data;
  },

  addFeaturedList: async (
    username: string,
    listName: string,
    description = ''
  ) => {
    const response = await api.post('/api/admin/featured', {
      username,
      list_name: listName,
      description,
    });
    return response.data;
  },

  removeFeaturedList: async (featuredId: string) => {
    const response = await api.delete(`/api/admin/featured/${featuredId}`);
    return response.data;
  },

  getAdminAnalytics: async (days = 30) => {
    const response = await api.get('/api/analytics/admin', {
      params: { days },
    });
    return response.data;
  },

  banUser: async (userId: string, duration: string, reason?: string) => {
    const response = await api.post(`/api/admin/users/${userId}/ban`, {
      duration,
      reason,
    });
    return response.data;
  },

  unbanUser: async (userId: string) => {
    const response = await api.post(`/api/admin/users/${userId}/unban`);
    return response.data;
  },

  getUserIps: async (userId: string) => {
    const response = await api.get(`/api/admin/users/${userId}/ips`);
    return response.data;
  },

  // Limit Request Management
  getLimitRequests: async (status?: string) => {
    const response = await api.get('/api/admin/limit-requests', {
      params: status ? { status } : undefined,
    });
    return response.data;
  },

  approveLimitRequest: async (requestId: string, customLimit?: number, responseMsg?: string) => {
    const response = await api.post(`/api/admin/limit-requests/${requestId}/approve`, {
      custom_limit: customLimit,
      response: responseMsg,
    });
    return response.data;
  },

  denyLimitRequest: async (requestId: string, responseMsg?: string) => {
    const response = await api.post(`/api/admin/limit-requests/${requestId}/deny`, {
      response: responseMsg,
    });
    return response.data;
  },

  setUserAdmin: async (userId: string, isAdmin: boolean) => {
    const response = await api.put(`/api/admin/users/${userId}/admin`, {
      is_admin: isAdmin,
    });
    return response.data;
  },

  // Blocklist Library Management
  getLibraryEntries: async () => {
    const response = await api.get('/api/admin/library');
    return response.data;
  },

  addLibraryEntry: async (data: {
    url: string;
    name: string;
    category: string;
    description?: string;
    recommended?: boolean;
    aggressiveness?: number;
    domain_count?: number;
  }) => {
    const response = await api.post('/api/admin/library', data);
    return response.data;
  },

  updateLibraryEntry: async (
    entryId: string,
    data: {
      url?: string;
      name?: string;
      category?: string;
      description?: string;
      recommended?: boolean;
      aggressiveness?: number;
      domain_count?: number;
    }
  ) => {
    const response = await api.put(`/api/admin/library/${entryId}`, data);
    return response.data;
  },

  deleteLibraryEntry: async (entryId: string) => {
    const response = await api.delete(`/api/admin/library/${entryId}`);
    return response.data;
  },
};
