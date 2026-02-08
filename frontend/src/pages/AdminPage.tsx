import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/client';
import { useAuthStore } from '../store';
import { useJobSocket, useStatsSocket } from '../hooks/useSocket';
import LoadingSpinner from '../components/LoadingSpinner';
import { JobList, JobDetailView } from '../components/jobs';
import type { Job, SourceProgress, WhitelistProgress, FormatProgress } from '../types';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

import type { LimitRequest, Announcement } from '../types';
import { INTENDED_USE_LABELS } from '../types';

type TabType =
  | 'overview'
  | 'users'
  | 'limits'
  | 'default'
  | 'featured'
  | 'jobs'
  | 'library'
  | 'announcements';

interface AdminStats {
  total_users: number;
  active_users: number;
  total_jobs: number;
  total_domains: number;
  total_requests: number;
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
  avatar_url?: string;
  is_enabled: boolean;
  is_admin: boolean;
  is_root: boolean;
  created_at: string;
  stats?: {
    total_domains: number;
    last_build_at?: string;
  };
}

interface FeaturedList {
  _id: string;
  username: string;
  list_name: string;
  description: string;
  display_order: number;
  created_at: string;
}

interface LibraryEntry {
  id: string;
  url: string;
  name: string;
  category: string;
  description: string;
  recommended: boolean;
  aggressiveness: number;
  domain_count: number;
  added_by: string;
  created_at: string;
  updated_at: string;
}

const VALID_TABS: TabType[] = [
  'overview',
  'users',
  'limits',
  'default',
  'featured',
  'jobs',
  'library',
  'announcements',
];

const LIBRARY_CATEGORIES = [
  'comprehensive',
  'malicious',
  'advertising',
  'tracking',
  'suspicious',
  'nsfw',
];

export default function AdminPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuthStore();

  // Read tab from URL, validate it, default to 'overview'
  const tabParam = searchParams.get('tab') as TabType;
  const activeTab = VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const setActiveTab = (tab: TabType) => {
    setSearchParams({ tab });
  };
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [featured, setFeatured] = useState<FeaturedList[]>([]);
  const [_defaultConfig, setDefaultConfig] = useState({ config: '', whitelist: '' });
  const [localConfig, setLocalConfig] = useState({ config: '', whitelist: '' });
  const [analytics, setAnalytics] = useState<{
    requests_over_time: { date: string; count: number }[];
    geo_distribution: Record<string, number>;
  } | null>(null);
  const [jobsPerDay, setJobsPerDay] = useState<
    { date: string; total: number; completed: number; failed: number }[]
  >([]);
  const [userGrowth, setUserGrowth] = useState<
    { date: string; new_users: number; total_users: number }[]
  >([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebuildingDefault, setRebuildingDefault] = useState(false);

  // New featured list form
  const [newFeatured, setNewFeatured] = useState({ username: '', list_name: '', description: '' });

  // Limit requests
  const [limitRequests, setLimitRequests] = useState<LimitRequest[]>([]);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  // Library state
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [newLibraryEntry, setNewLibraryEntry] = useState({
    url: '',
    name: '',
    category: 'comprehensive',
    description: '',
    recommended: false,
    aggressiveness: 3,
    domain_count: 0,
  });
  const [editingEntry, setEditingEntry] = useState<LibraryEntry | null>(null);

  // Announcements state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    message: '',
    type: 'info' as 'info' | 'warning' | 'critical',
    expires_at: '',
  });
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [editExpiresAt, setEditExpiresAt] = useState('');

  // Users table pagination, search, and filters (server-side)
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [userFilters, setUserFilters] = useState({
    showAdmins: true,
    showRegular: true,
    showEnabled: true,
    showDisabled: true,
  });
  const [usersLoading, setUsersLoading] = useState(false);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Handle real-time job updates (admin sees all jobs)
  const handleJobCreated = useCallback((job: Job) => {
    setJobs((prev) => [job, ...prev.slice(0, 49)]); // Keep 50 most recent
    // Auto-select newly created jobs
    setSelectedJob(job);
  }, []);

  const handleJobProgress = useCallback((job: Job) => {
    setJobs((prev) => prev.map((j) => (j.job_id === job.job_id ? job : j)));
    // Update selected job if it matches
    setSelectedJob((prev) => (prev?.job_id === job.job_id ? job : prev));
  }, []);

  const handleJobCompleted = useCallback((job: Job) => {
    setJobs((prev) => prev.map((j) => (j.job_id === job.job_id ? job : j)));
    // Update selected job if it matches
    setSelectedJob((prev) => (prev?.job_id === job.job_id ? job : prev));
  }, []);

  // Subscribe to all jobs (admin view)
  useJobSocket({
    isAdmin: true,
    onJobCreated: handleJobCreated,
    onJobProgress: handleJobProgress,
    onJobCompleted: handleJobCompleted,
  });

  // Refresh stats when stats:updated event received
  const handleStatsUpdated = useCallback(async () => {
    try {
      const statsData = await adminApi.getStats();
      setStats(statsData);
    } catch (error) {
      console.error('Failed to refresh stats:', error);
    }
  }, []);

  useStatsSocket({ onStatsUpdated: handleStatsUpdated });

  // Debounce search input (1.5 second delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 1500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset to page 1 when filters/items per page change
  useEffect(() => {
    setCurrentPage(1);
  }, [userFilters, itemsPerPage]);

  // Fetch users from server with current filters
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await adminApi.getUsers({
        page: currentPage,
        perPage: itemsPerPage,
        search: debouncedSearch || undefined,
        showAdmins: userFilters.showAdmins,
        showRegular: userFilters.showRegular,
        showEnabled: userFilters.showEnabled,
        showDisabled: userFilters.showDisabled,
      });
      setUsers(data.users || []);
      setTotalUsers(data.total || 0);
      setTotalPages(data.pages || 1);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, [currentPage, itemsPerPage, debouncedSearch, userFilters]);

  // Fetch users when params change
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Toggle filter helper
  const toggleUserFilter = (key: keyof typeof userFilters) => {
    setUserFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [
          statsData,
          jobsData,
          featuredData,
          configData,
          analyticsData,
          jobsPerDayData,
          userGrowthData,
          limitRequestsData,
          libraryData,
          announcementsData,
        ] = await Promise.all([
          adminApi.getStats().catch(() => null),
          adminApi.getAllJobs().catch(() => ({ jobs: [] })),
          adminApi.getFeaturedLists().catch(() => ({ featured: [] })),
          adminApi.getDefaultConfig().catch(() => ({ config: '', whitelist: '' })),
          adminApi.getAdminAnalytics(30).catch(() => null),
          adminApi.getJobsPerDay(30).catch(() => ({ jobs_per_day: [] })),
          adminApi.getUserGrowth(30).catch(() => ({ user_growth: [] })),
          adminApi.getLimitRequests().catch(() => ({ requests: [], pending_count: 0 })),
          adminApi.getLibraryEntries().catch(() => ({ entries: [] })),
          adminApi.getAnnouncements().catch(() => ({ announcements: [] })),
        ]);

        setStats(statsData);
        setJobs(jobsData.jobs || []);
        setFeatured(featuredData?.featured || []);
        setDefaultConfig(configData);
        setLocalConfig(configData);
        setAnalytics(analyticsData);
        setJobsPerDay(jobsPerDayData?.jobs_per_day || []);
        setUserGrowth(userGrowthData?.user_growth || []);
        setLimitRequests(limitRequestsData?.requests || []);
        setPendingRequestCount(limitRequestsData?.pending_count || 0);
        setLibraryEntries(libraryData?.entries || []);
        setAnnouncements(announcementsData?.announcements || []);
      } catch (error) {
        console.error('Failed to fetch admin data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleToggleUser = async (userId: string, enabled: boolean) => {
    try {
      await adminApi.updateUser(userId, { is_enabled: enabled });
      setMessage({ type: 'success', text: `User ${enabled ? 'enabled' : 'disabled'}` });
      fetchUsers(); // Refetch to update list based on filters
    } catch (error) {
      console.error('Failed to update user:', error);
      setMessage({ type: 'error', text: 'Failed to update user' });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      await adminApi.deleteUser(userId);
      setMessage({ type: 'success', text: 'User deleted' });
      fetchUsers(); // Refetch to update list
    } catch (error) {
      console.error('Failed to delete user:', error);
      setMessage({ type: 'error', text: 'Failed to delete user' });
    }
  };

  const handleToggleAdmin = async (userId: string, isAdmin: boolean) => {
    try {
      await adminApi.setUserAdmin(userId, isAdmin);
      setMessage({
        type: 'success',
        text: `User ${isAdmin ? 'promoted to' : 'demoted from'} admin`,
      });
      fetchUsers(); // Refetch to update list based on filters
    } catch (error) {
      console.error('Failed to toggle admin status:', error);
      setMessage({ type: 'error', text: 'Failed to toggle admin status' });
    }
  };

  const handleRebuildUser = async (userId: string) => {
    try {
      await adminApi.triggerUserRebuild(userId);
      setMessage({ type: 'success', text: 'Rebuild triggered' });
    } catch (error) {
      console.error('Failed to trigger rebuild:', error);
      setMessage({ type: 'error', text: 'Failed to trigger rebuild' });
    }
  };

  const handleRebuildDefault = async () => {
    setRebuildingDefault(true);
    try {
      await adminApi.triggerDefaultRebuild();
      setMessage({ type: 'success', text: 'Default lists rebuild triggered' });
    } catch (error) {
      console.error('Failed to trigger rebuild:', error);
      setMessage({ type: 'error', text: 'Failed to trigger rebuild' });
    } finally {
      setRebuildingDefault(false);
    }
  };

  const handleSaveDefaultConfig = async () => {
    setSaving(true);
    try {
      await adminApi.updateDefaultConfig(localConfig.config, localConfig.whitelist);
      setDefaultConfig(localConfig);
      setMessage({ type: 'success', text: 'Default config saved' });
    } catch (error) {
      console.error('Failed to save config:', error);
      setMessage({ type: 'error', text: 'Failed to save config' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddFeatured = async () => {
    if (!newFeatured.username || !newFeatured.list_name) return;

    try {
      const result = await adminApi.addFeaturedList(
        newFeatured.username,
        newFeatured.list_name,
        newFeatured.description,
      );
      setFeatured([...featured, result]);
      setNewFeatured({ username: '', list_name: '', description: '' });
      setMessage({ type: 'success', text: 'Featured list added' });
    } catch (error) {
      console.error('Failed to add featured list:', error);
      setMessage({ type: 'error', text: 'Failed to add featured list' });
    }
  };

  const handleRemoveFeatured = async (id: string) => {
    try {
      await adminApi.removeFeaturedList(id);
      setFeatured(featured.filter((f) => f._id !== id));
      setMessage({ type: 'success', text: 'Featured list removed' });
    } catch (error) {
      console.error('Failed to remove featured list:', error);
      setMessage({ type: 'error', text: 'Failed to remove featured list' });
    }
  };

  const handleApproveLimitRequest = async (requestId: string, customLimit?: number) => {
    try {
      const result = await adminApi.approveLimitRequest(requestId, customLimit);
      setLimitRequests(limitRequests.map((r) => (r.id === requestId ? result.request : r)));
      setPendingRequestCount((prev) => Math.max(0, prev - 1));
      setMessage({ type: 'success', text: 'Limit request approved' });
    } catch (error) {
      console.error('Failed to approve limit request:', error);
      setMessage({ type: 'error', text: 'Failed to approve limit request' });
    }
  };

  const handleDenyLimitRequest = async (requestId: string, reason?: string) => {
    try {
      const result = await adminApi.denyLimitRequest(requestId, reason);
      setLimitRequests(limitRequests.map((r) => (r.id === requestId ? result.request : r)));
      setPendingRequestCount((prev) => Math.max(0, prev - 1));
      setMessage({ type: 'success', text: 'Limit request denied' });
    } catch (error) {
      console.error('Failed to deny limit request:', error);
      setMessage({ type: 'error', text: 'Failed to deny limit request' });
    }
  };

  // Library handlers
  const handleAddLibraryEntry = async () => {
    if (!newLibraryEntry.url || !newLibraryEntry.name) return;

    try {
      const result = await adminApi.addLibraryEntry(newLibraryEntry);
      setLibraryEntries([...libraryEntries, result.entry]);
      setNewLibraryEntry({
        url: '',
        name: '',
        category: 'comprehensive',
        description: '',
        recommended: false,
        aggressiveness: 3,
        domain_count: 0,
      });
      setMessage({ type: 'success', text: 'Library entry added' });
    } catch (error: any) {
      console.error('Failed to add library entry:', error);
      const errorMsg = error.response?.data?.error || 'Failed to add library entry';
      setMessage({ type: 'error', text: errorMsg });
    }
  };

  const handleUpdateLibraryEntry = async () => {
    if (!editingEntry) return;

    try {
      const result = await adminApi.updateLibraryEntry(editingEntry.id, {
        url: editingEntry.url,
        name: editingEntry.name,
        category: editingEntry.category,
        description: editingEntry.description,
        recommended: editingEntry.recommended,
        aggressiveness: editingEntry.aggressiveness,
        domain_count: editingEntry.domain_count,
      });
      setLibraryEntries(libraryEntries.map((e) => (e.id === editingEntry.id ? result.entry : e)));
      setEditingEntry(null);
      setMessage({ type: 'success', text: 'Library entry updated' });
    } catch (error: any) {
      console.error('Failed to update library entry:', error);
      const errorMsg = error.response?.data?.error || 'Failed to update library entry';
      setMessage({ type: 'error', text: errorMsg });
    }
  };

  const handleDeleteLibraryEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this library entry?')) return;

    try {
      await adminApi.deleteLibraryEntry(entryId);
      setLibraryEntries(libraryEntries.filter((e) => e.id !== entryId));
      setMessage({ type: 'success', text: 'Library entry deleted' });
    } catch (error) {
      console.error('Failed to delete library entry:', error);
      setMessage({ type: 'error', text: 'Failed to delete library entry' });
    }
  };

  // Announcement handlers
  const handleCreateAnnouncement = async () => {
    if (!newAnnouncement.title || !newAnnouncement.message) return;

    try {
      const result = await adminApi.createAnnouncement({
        title: newAnnouncement.title,
        message: newAnnouncement.message,
        type: newAnnouncement.type,
        expires_at: newAnnouncement.expires_at || null,
      });
      setAnnouncements([result.announcement, ...announcements]);
      setNewAnnouncement({ title: '', message: '', type: 'info', expires_at: '' });
      setMessage({ type: 'success', text: 'Announcement created' });
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || 'Failed to create announcement';
      setMessage({ type: 'error', text: errorMsg });
    }
  };

  const handleUpdateAnnouncement = async () => {
    if (!editingAnnouncement) return;

    try {
      const result = await adminApi.updateAnnouncement(editingAnnouncement.id, {
        title: editingAnnouncement.title,
        message: editingAnnouncement.message,
        type: editingAnnouncement.type,
        is_active: editingAnnouncement.is_active,
        expires_at: editExpiresAt || null,
      });
      setAnnouncements(
        announcements.map((a) => (a.id === editingAnnouncement.id ? result.announcement : a)),
      );
      setEditingAnnouncement(null);
      setEditExpiresAt('');
      setMessage({ type: 'success', text: 'Announcement updated' });
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || 'Failed to update announcement';
      setMessage({ type: 'error', text: errorMsg });
    }
  };

  const handleToggleAnnouncement = async (id: string, isActive: boolean) => {
    try {
      const result = await adminApi.updateAnnouncement(id, { is_active: isActive });
      setAnnouncements(announcements.map((a) => (a.id === id ? result.announcement : a)));
      setMessage({
        type: 'success',
        text: `Announcement ${isActive ? 'activated' : 'deactivated'}`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update announcement' });
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return;

    try {
      await adminApi.deleteAnnouncement(id);
      setAnnouncements(announcements.filter((a) => a.id !== id));
      setMessage({ type: 'success', text: 'Announcement deleted' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to delete announcement' });
    }
  };

  const formatDomainCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#9ca3af' } },
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-pihole-text">Admin Panel</h1>
        <p className="text-pihole-text-muted">Manage users, default lists, and system settings</p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`px-4 py-3 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-pihole-border">
        <div className="flex gap-4">
          {(
            [
              'overview',
              'users',
              'limits',
              'default',
              'featured',
              'jobs',
              'announcements',
            ] as TabType[]
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors capitalize flex items-center gap-2 ${
                activeTab === tab
                  ? 'border-pihole-accent text-pihole-accent'
                  : 'border-transparent text-pihole-text-muted hover:text-pihole-text'
              }`}
            >
              {tab}
              {tab === 'limits' && pendingRequestCount > 0 && (
                <span className="px-1.5 py-0.5 bg-pihole-accent text-white text-xs rounded-full">
                  {pendingRequestCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={handleRebuildDefault}
              disabled={rebuildingDefault}
              className="card hover:bg-pihole-darkest transition-colors text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-pihole-accent/20 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-pihole-accent"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-pihole-text">
                  {rebuildingDefault ? 'Rebuilding...' : 'Rebuild Default Lists'}
                </div>
                <div className="text-sm text-pihole-text-muted">Regenerate official blocklists</div>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('jobs')}
              className="card hover:bg-pihole-darkest transition-colors text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-pihole-text">View All Jobs</div>
                <div className="text-sm text-pihole-text-muted">
                  {jobs.filter((j) => j.status === 'failed').length > 0 ? (
                    <span className="text-red-400">
                      {jobs.filter((j) => j.status === 'failed').length} failed jobs
                    </span>
                  ) : (
                    'Monitor job queue'
                  )}
                </div>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className="card hover:bg-pihole-darkest transition-colors text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-pihole-text">Manage Users</div>
                <div className="text-sm text-pihole-text-muted">
                  {stats?.total_users || 0} registered users
                </div>
              </div>
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="card">
              <div className="text-sm text-pihole-text-muted mb-1">Total Users</div>
              <div className="text-2xl font-bold text-pihole-text">
                {stats?.total_users?.toLocaleString() || 0}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-pihole-text-muted mb-1">Active Users</div>
              <div className="text-2xl font-bold text-pihole-text">
                {stats?.active_users?.toLocaleString() || 0}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-pihole-text-muted mb-1">Total Jobs</div>
              <div className="text-2xl font-bold text-pihole-text">
                {stats?.total_jobs?.toLocaleString() || 0}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-pihole-text-muted mb-1">Total Domains</div>
              <div className="text-2xl font-bold text-pihole-text">
                {stats?.total_domains?.toLocaleString() || 0}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-pihole-text-muted mb-1">Total Requests</div>
              <div className="text-2xl font-bold text-pihole-text">
                {stats?.total_requests?.toLocaleString() || 0}
              </div>
            </div>
          </div>

          {/* Charts - Row 1: Requests & Geographic */}
          <div className="grid md:grid-cols-2 gap-6">
            {(analytics?.requests_over_time?.length ?? 0) > 0 && analytics && (
              <div className="card">
                <h3 className="font-semibold text-pihole-text mb-4">Requests (30 days)</h3>
                <div className="h-48">
                  <Line
                    data={{
                      labels: analytics.requests_over_time.map((d) => d.date),
                      datasets: [
                        {
                          data: analytics.requests_over_time.map((d) => d.count),
                          borderColor: '#d93025',
                          backgroundColor: 'rgba(217, 48, 37, 0.1)',
                          fill: true,
                          tension: 0.4,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              </div>
            )}
            {Object.keys(analytics?.geo_distribution || {}).length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-pihole-text mb-4">Top Countries</h3>
                <div className="h-48">
                  <Bar
                    data={{
                      labels: Object.keys(analytics!.geo_distribution).slice(0, 10),
                      datasets: [
                        {
                          data: Object.values(analytics!.geo_distribution).slice(0, 10),
                          backgroundColor: '#d93025',
                          borderRadius: 4,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Charts - Row 2: Jobs Per Day & User Growth */}
          <div className="grid md:grid-cols-2 gap-6">
            {jobsPerDay.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-pihole-text mb-4">Jobs Per Day (30 days)</h3>
                <div className="h-48">
                  <Bar
                    data={{
                      labels: jobsPerDay.map((d) => d.date),
                      datasets: [
                        {
                          label: 'Completed',
                          data: jobsPerDay.map((d) => d.completed),
                          backgroundColor: '#22c55e',
                          borderRadius: 4,
                        },
                        {
                          label: 'Failed',
                          data: jobsPerDay.map((d) => d.failed),
                          backgroundColor: '#ef4444',
                          borderRadius: 4,
                        },
                      ],
                    }}
                    options={{
                      ...chartOptions,
                      plugins: { legend: { display: true, labels: { color: '#9ca3af' } } },
                      scales: {
                        ...chartOptions.scales,
                        x: { ...chartOptions.scales.x, stacked: true },
                        y: { ...chartOptions.scales.y, stacked: true },
                      },
                    }}
                  />
                </div>
              </div>
            )}
            {userGrowth.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-pihole-text mb-4">User Growth (30 days)</h3>
                <div className="h-48">
                  <Line
                    data={{
                      labels: userGrowth.map((d) => d.date),
                      datasets: [
                        {
                          label: 'Total Users',
                          data: userGrowth.map((d) => d.total_users),
                          borderColor: '#3b82f6',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          fill: true,
                          tension: 0.4,
                        },
                      ],
                    }}
                    options={{
                      ...chartOptions,
                      plugins: { legend: { display: true, labels: { color: '#9ca3af' } } },
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Recent Failed Jobs */}
          {jobs.filter((j) => j.status === 'failed').length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-pihole-text mb-4">Recent Failed Jobs</h3>
              <div className="space-y-2">
                {jobs
                  .filter((j) => j.status === 'failed')
                  .slice(0, 5)
                  .map((job) => (
                    <div
                      key={job.job_id}
                      onClick={() => navigate(`/admin/jobs/${job.job_id}`)}
                      className="flex items-center justify-between p-3 bg-red-500/10 border border-red-500/20 rounded-lg cursor-pointer hover:bg-red-500/20 transition-colors"
                    >
                      <div>
                        <span className="text-pihole-text font-medium">
                          {job.username || 'default'}
                        </span>
                        <span className="text-pihole-text-muted text-sm ml-2">({job.type})</span>
                      </div>
                      <span className="text-sm text-pihole-text-muted">
                        {new Date(job.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="card">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              {/* Search */}
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by username or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-pihole-text-muted">Filters:</span>
                <button
                  onClick={() => toggleUserFilter('showAdmins')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    userFilters.showAdmins
                      ? 'bg-pihole-accent/20 border-pihole-accent text-pihole-accent'
                      : 'bg-pihole-darkest border-pihole-border text-pihole-text-muted hover:border-pihole-text-muted'
                  }`}
                >
                  Admins
                </button>
                <button
                  onClick={() => toggleUserFilter('showRegular')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    userFilters.showRegular
                      ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                      : 'bg-pihole-darkest border-pihole-border text-pihole-text-muted hover:border-pihole-text-muted'
                  }`}
                >
                  Regular
                </button>
                <button
                  onClick={() => toggleUserFilter('showEnabled')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    userFilters.showEnabled
                      ? 'bg-green-500/20 border-green-500 text-green-400'
                      : 'bg-pihole-darkest border-pihole-border text-pihole-text-muted hover:border-pihole-text-muted'
                  }`}
                >
                  Enabled
                </button>
                <button
                  onClick={() => toggleUserFilter('showDisabled')}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    userFilters.showDisabled
                      ? 'bg-red-500/20 border-red-500 text-red-400'
                      : 'bg-pihole-darkest border-pihole-border text-pihole-text-muted hover:border-pihole-text-muted'
                  }`}
                >
                  Disabled
                </button>
              </div>
            </div>
          </div>

          {/* Results info and items per page */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-pihole-text-muted">
              {usersLoading ? (
                'Loading...'
              ) : (
                <>
                  Showing {users.length} of {totalUsers} users
                  {debouncedSearch && ` matching "${debouncedSearch}"`}
                </>
              )}
            </div>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="bg-pihole-darkest border border-pihole-border rounded-lg px-3 py-1.5 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
            >
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
          </div>

          {/* Users Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-pihole-border">
                    <th className="text-left p-4 text-sm font-medium text-pihole-text-muted">
                      User
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-pihole-text-muted">
                      Status
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-pihole-text-muted">
                      Domains
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-pihole-text-muted">
                      Joined
                    </th>
                    <th className="text-right p-4 text-sm font-medium text-pihole-text-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-pihole-text-muted">
                        <LoadingSpinner size="sm" />
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-pihole-text-muted">
                        {debouncedSearch || !Object.values(userFilters).every(Boolean)
                          ? 'No users match your filters'
                          : 'No users found'}
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-pihole-border last:border-0 hover:bg-pihole-darkest cursor-pointer"
                        onClick={() => navigate(`/admin/users/${user.id}`)}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 bg-pihole-border rounded-full flex items-center justify-center">
                                <span className="text-pihole-text text-sm">
                                  {user.username?.[0]?.toUpperCase()}
                                </span>
                              </div>
                            )}
                            <div>
                              <div className="text-sm font-medium text-pihole-text">
                                {user.username}
                                {user.is_root ? (
                                  <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded">
                                    Root
                                  </span>
                                ) : (
                                  user.is_admin && (
                                    <span className="ml-2 px-1.5 py-0.5 bg-pihole-accent/20 text-pihole-accent text-xs rounded">
                                      Admin
                                    </span>
                                  )
                                )}
                              </div>
                              <div className="text-xs text-pihole-text-muted">{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              user.is_enabled
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {user.is_enabled ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-pihole-text-muted">
                          {user.stats?.total_domains?.toLocaleString() || 0}
                        </td>
                        <td className="p-4 text-sm text-pihole-text-muted">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-2">
                            {/* Root users cannot have any actions performed on them */}
                            {user.is_root ? (
                              <span className="text-xs text-pihole-text-muted">Protected</span>
                            ) : (
                              <>
                                {/* Admin toggle - only root can do this */}
                                {currentUser?.is_root && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleAdmin(user.id, !user.is_admin);
                                    }}
                                    className={`btn btn-ghost text-xs ${user.is_admin ? 'text-amber-400' : 'text-green-400'}`}
                                  >
                                    {user.is_admin ? 'Revoke Admin' : 'Make Admin'}
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRebuildUser(user.id);
                                  }}
                                  className="btn btn-ghost text-xs"
                                >
                                  Rebuild
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleUser(user.id, !user.is_enabled);
                                  }}
                                  className="btn btn-ghost text-xs"
                                >
                                  {user.is_enabled ? 'Disable' : 'Enable'}
                                </button>
                                {!user.is_admin && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteUser(user.id);
                                    }}
                                    className="btn btn-ghost text-xs text-red-400 hover:text-red-300"
                                  >
                                    Delete
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-pihole-border bg-pihole-darkest text-pihole-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pihole-dark transition-colors"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-pihole-border bg-pihole-darkest text-pihole-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pihole-dark transition-colors"
              >
                Previous
              </button>
              <span className="px-4 py-1.5 text-sm text-pihole-text">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-pihole-border bg-pihole-darkest text-pihole-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pihole-dark transition-colors"
              >
                Next
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-pihole-border bg-pihole-darkest text-pihole-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pihole-dark transition-colors"
              >
                Last
              </button>
            </div>
          )}
        </div>
      )}

      {/* Limits Tab */}
      {activeTab === 'limits' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-pihole-text">Limit Requests</h2>
            <p className="text-sm text-pihole-text-muted">
              Review and manage user requests for higher domain limits
            </p>
          </div>

          {limitRequests.length === 0 ? (
            <div className="card">
              <p className="text-pihole-text-muted text-center py-8">No limit requests yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Pending Requests */}
              {limitRequests.filter((r) => r.status === 'pending').length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-pihole-text mb-4">Pending Requests</h3>
                  <div className="space-y-4">
                    {limitRequests
                      .filter((r) => r.status === 'pending')
                      .map((request) => (
                        <LimitRequestCard
                          key={request.id}
                          request={request}
                          onApprove={handleApproveLimitRequest}
                          onDeny={handleDenyLimitRequest}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Recent Decisions */}
              {limitRequests.filter((r) => r.status !== 'pending').length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-pihole-text mb-4">Recent Decisions</h3>
                  <div className="space-y-4">
                    {limitRequests
                      .filter((r) => r.status !== 'pending')
                      .slice(0, 10)
                      .map((request) => (
                        <LimitRequestCard
                          key={request.id}
                          request={request}
                          onApprove={handleApproveLimitRequest}
                          onDeny={handleDenyLimitRequest}
                          readOnly
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Default Config Tab */}
      {activeTab === 'default' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-pihole-text">Default List Configuration</h2>
              <p className="text-sm text-pihole-text-muted">
                Configure the default/official blocklists for the site
              </p>
            </div>
            <button onClick={handleRebuildDefault} className="btn btn-primary">
              Rebuild Default Lists
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold text-pihole-text mb-4">Blocklist Sources</h3>
              <textarea
                value={localConfig.config}
                onChange={(e) => setLocalConfig({ ...localConfig, config: e.target.value })}
                className="w-full h-80 bg-pihole-darkest border border-pihole-border rounded-lg p-4 font-mono text-sm text-pihole-text focus:outline-none focus:border-pihole-accent resize-none"
                placeholder="# Enter blocklist URLs..."
              />
            </div>
            <div className="card">
              <h3 className="font-semibold text-pihole-text mb-4">Whitelist</h3>
              <textarea
                value={localConfig.whitelist}
                onChange={(e) => setLocalConfig({ ...localConfig, whitelist: e.target.value })}
                className="w-full h-80 bg-pihole-darkest border border-pihole-border rounded-lg p-4 font-mono text-sm text-pihole-text focus:outline-none focus:border-pihole-accent resize-none"
                placeholder="# Enter whitelist patterns..."
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveDefaultConfig} disabled={saving} className="btn btn-primary">
              {saving ? <LoadingSpinner size="sm" /> : 'Save Configuration'}
            </button>
          </div>
        </div>
      )}

      {/* Featured Tab */}
      {activeTab === 'featured' && (
        <div className="space-y-6">
          {/* Add Featured */}
          <div className="card">
            <h3 className="font-semibold text-pihole-text mb-4">Add Featured List</h3>
            <div className="grid md:grid-cols-4 gap-4">
              <input
                type="text"
                placeholder="Username"
                value={newFeatured.username}
                onChange={(e) => setNewFeatured({ ...newFeatured, username: e.target.value })}
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <input
                type="text"
                placeholder="List Name"
                value={newFeatured.list_name}
                onChange={(e) => setNewFeatured({ ...newFeatured, list_name: e.target.value })}
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newFeatured.description}
                onChange={(e) => setNewFeatured({ ...newFeatured, description: e.target.value })}
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <button onClick={handleAddFeatured} className="btn btn-primary">
                Add Featured
              </button>
            </div>
          </div>

          {/* Featured List */}
          <div className="card">
            <h3 className="font-semibold text-pihole-text mb-4">Featured Lists</h3>
            {featured.length === 0 ? (
              <p className="text-pihole-text-muted">No featured lists yet.</p>
            ) : (
              <div className="space-y-3">
                {featured.map((f) => (
                  <div
                    key={f._id}
                    className="flex items-center justify-between p-4 bg-pihole-darkest rounded-lg"
                  >
                    <div>
                      <div className="font-medium text-pihole-text">
                        {f.username}/{f.list_name}
                      </div>
                      {f.description && (
                        <div className="text-sm text-pihole-text-muted">{f.description}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveFeatured(f._id)}
                      className="btn btn-ghost text-sm text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {activeTab === 'jobs' &&
        (() => {
          // Get progress data from the selected job
          const progressData = selectedJob?.progress;
          const selectedJobSources: SourceProgress[] = progressData?.sources || [];
          const selectedJobWhitelist: WhitelistProgress | null = progressData?.whitelist || null;
          const selectedJobFormats: Record<string, FormatProgress> = {};

          // Convert formats array to record
          if (progressData?.generation?.formats) {
            for (const fmt of progressData.generation.formats) {
              selectedJobFormats[fmt.format] = fmt;
            }
          }

          return (
            <div className="grid md:grid-cols-3 gap-6">
              {/* Job List Sidebar */}
              <div className="md:col-span-1">
                <div className="card max-h-[calc(100vh-200px)] overflow-hidden flex flex-col">
                  <h2 className="font-semibold text-pihole-text mb-4 flex-shrink-0">
                    All Jobs
                    {jobs.some((j) => j.status === 'processing' || j.status === 'queued') && (
                      <span className="ml-2 inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    )}
                  </h2>
                  <div className="overflow-y-auto flex-1 -mr-2 pr-2">
                    <JobList
                      jobs={jobs}
                      selectedJobId={selectedJob?.job_id || null}
                      onSelectJob={setSelectedJob}
                      showUsername={true}
                    />
                  </div>
                </div>
              </div>

              {/* Job Details */}
              <div className="md:col-span-2">
                {selectedJob ? (
                  <JobDetailView
                    job={selectedJob}
                    sources={selectedJobSources}
                    whitelist={selectedJobWhitelist}
                    formats={selectedJobFormats}
                    showUsername={true}
                  />
                ) : (
                  <div className="card text-center py-12">
                    <svg
                      className="w-16 h-16 mx-auto mb-4 text-pihole-border"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      />
                    </svg>
                    <div className="text-pihole-text-muted">Select a job to view details</div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Library Tab */}
      {activeTab === 'library' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-pihole-text">Blocklist Library</h2>
            <p className="text-sm text-pihole-text-muted">
              Curated blocklist sources available in the visual config editor
            </p>
          </div>

          {/* Add Entry Form */}
          <div className="card">
            <h3 className="font-semibold text-pihole-text mb-4">Add Library Entry</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <input
                type="url"
                placeholder="URL"
                value={newLibraryEntry.url}
                onChange={(e) => setNewLibraryEntry({ ...newLibraryEntry, url: e.target.value })}
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <input
                type="text"
                placeholder="Name"
                value={newLibraryEntry.name}
                onChange={(e) => setNewLibraryEntry({ ...newLibraryEntry, name: e.target.value })}
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <select
                value={newLibraryEntry.category}
                onChange={(e) =>
                  setNewLibraryEntry({ ...newLibraryEntry, category: e.target.value })
                }
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              >
                {LIBRARY_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Domain count"
                value={newLibraryEntry.domain_count || ''}
                onChange={(e) =>
                  setNewLibraryEntry({
                    ...newLibraryEntry,
                    domain_count: parseInt(e.target.value) || 0,
                  })
                }
                className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <input
                type="text"
                placeholder="Description"
                value={newLibraryEntry.description}
                onChange={(e) =>
                  setNewLibraryEntry({ ...newLibraryEntry, description: e.target.value })
                }
                className="md:col-span-2 bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
              />
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-pihole-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newLibraryEntry.recommended}
                    onChange={(e) =>
                      setNewLibraryEntry({ ...newLibraryEntry, recommended: e.target.checked })
                    }
                    className="rounded border-pihole-border bg-pihole-dark"
                  />
                  Recommended
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-pihole-text-muted">Aggressiveness:</span>
                  <select
                    value={newLibraryEntry.aggressiveness}
                    onChange={(e) =>
                      setNewLibraryEntry({
                        ...newLibraryEntry,
                        aggressiveness: parseInt(e.target.value),
                      })
                    }
                    className="bg-pihole-darkest border border-pihole-border rounded px-2 py-1 text-sm text-pihole-text"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={handleAddLibraryEntry} className="btn btn-primary">
                  Add Entry
                </button>
              </div>
            </div>
          </div>

          {/* Entries by Category */}
          {LIBRARY_CATEGORIES.map((category) => {
            const entries = libraryEntries.filter((e) => e.category === category);
            if (entries.length === 0) return null;

            return (
              <div key={category} className="card">
                <h3 className="font-semibold text-pihole-text mb-4 capitalize">
                  {category}
                  <span className="ml-2 text-pihole-text-muted font-normal text-sm">
                    ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
                  </span>
                </h3>
                <div className="space-y-3">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-4 bg-pihole-darkest rounded-lg flex items-start justify-between gap-4"
                    >
                      {editingEntry?.id === entry.id ? (
                        <div className="flex-1 grid md:grid-cols-2 gap-3">
                          <input
                            type="url"
                            value={editingEntry.url}
                            onChange={(e) =>
                              setEditingEntry({ ...editingEntry, url: e.target.value })
                            }
                            className="bg-pihole-dark border border-pihole-border rounded px-3 py-1.5 text-sm text-pihole-text"
                            placeholder="URL"
                          />
                          <input
                            type="text"
                            value={editingEntry.name}
                            onChange={(e) =>
                              setEditingEntry({ ...editingEntry, name: e.target.value })
                            }
                            className="bg-pihole-dark border border-pihole-border rounded px-3 py-1.5 text-sm text-pihole-text"
                            placeholder="Name"
                          />
                          <select
                            value={editingEntry.category}
                            onChange={(e) =>
                              setEditingEntry({ ...editingEntry, category: e.target.value })
                            }
                            className="bg-pihole-dark border border-pihole-border rounded px-3 py-1.5 text-sm text-pihole-text"
                          >
                            {LIBRARY_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            value={editingEntry.domain_count || ''}
                            onChange={(e) =>
                              setEditingEntry({
                                ...editingEntry,
                                domain_count: parseInt(e.target.value) || 0,
                              })
                            }
                            className="bg-pihole-dark border border-pihole-border rounded px-3 py-1.5 text-sm text-pihole-text"
                            placeholder="Domain count"
                          />
                          <input
                            type="text"
                            value={editingEntry.description}
                            onChange={(e) =>
                              setEditingEntry({ ...editingEntry, description: e.target.value })
                            }
                            className="md:col-span-2 bg-pihole-dark border border-pihole-border rounded px-3 py-1.5 text-sm text-pihole-text"
                            placeholder="Description"
                          />
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-pihole-text cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editingEntry.recommended}
                                onChange={(e) =>
                                  setEditingEntry({
                                    ...editingEntry,
                                    recommended: e.target.checked,
                                  })
                                }
                                className="rounded"
                              />
                              Recommended
                            </label>
                            <select
                              value={editingEntry.aggressiveness}
                              onChange={(e) =>
                                setEditingEntry({
                                  ...editingEntry,
                                  aggressiveness: parseInt(e.target.value),
                                })
                              }
                              className="bg-pihole-dark border border-pihole-border rounded px-2 py-1 text-sm text-pihole-text"
                            >
                              {[1, 2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  Aggr: {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingEntry(null)}
                              className="btn btn-ghost text-sm"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleUpdateLibraryEntry}
                              className="btn btn-primary text-sm"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-pihole-text">{entry.name}</span>
                              {entry.recommended && (
                                <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                                  Recommended
                                </span>
                              )}
                              <span className="text-xs text-pihole-text-muted">
                                {formatDomainCount(entry.domain_count)} domains
                              </span>
                              <span className="text-xs text-pihole-text-muted">
                                Aggr: {entry.aggressiveness}/5
                              </span>
                            </div>
                            <p className="text-sm text-pihole-text-muted truncate">{entry.url}</p>
                            {entry.description && (
                              <p className="text-sm text-pihole-text-muted mt-1">
                                {entry.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setEditingEntry(entry)}
                              className="btn btn-ghost text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteLibraryEntry(entry.id)}
                              className="btn btn-ghost text-sm text-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {libraryEntries.length === 0 && (
            <div className="card text-center py-8">
              <p className="text-pihole-text-muted">No library entries yet. Add one above.</p>
            </div>
          )}
        </div>
      )}

      {/* Announcements Tab */}
      {activeTab === 'announcements' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-pihole-text">Announcements</h2>
            <p className="text-sm text-pihole-text-muted">
              Create site-wide announcements visible to all logged-in users
            </p>
          </div>

          {/* Create Announcement Form */}
          <div className="card">
            <h3 className="font-semibold text-pihole-text mb-4">Create Announcement</h3>
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Title"
                  value={newAnnouncement.title}
                  onChange={(e) =>
                    setNewAnnouncement({ ...newAnnouncement, title: e.target.value })
                  }
                  className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                />
                <div className="flex gap-4">
                  <select
                    value={newAnnouncement.type}
                    onChange={(e) =>
                      setNewAnnouncement({
                        ...newAnnouncement,
                        type: e.target.value as 'info' | 'warning' | 'critical',
                      })
                    }
                    className="flex-1 bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                  <input
                    type="datetime-local"
                    value={newAnnouncement.expires_at}
                    onChange={(e) =>
                      setNewAnnouncement({ ...newAnnouncement, expires_at: e.target.value })
                    }
                    className="flex-1 bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                    placeholder="Expires at (optional)"
                  />
                </div>
              </div>
              <textarea
                placeholder="Message"
                value={newAnnouncement.message}
                onChange={(e) =>
                  setNewAnnouncement({ ...newAnnouncement, message: e.target.value })
                }
                rows={3}
                className="w-full bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent resize-none"
              />
              <div className="flex justify-end">
                <button onClick={handleCreateAnnouncement} className="btn btn-primary">
                  Create Announcement
                </button>
              </div>
            </div>
          </div>

          {/* Announcements List */}
          {announcements.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-pihole-text-muted">No announcements yet. Create one above.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((announcement) => {
                const isExpired =
                  announcement.expires_at && new Date(announcement.expires_at) < new Date();
                const isEditing = editingAnnouncement?.id === announcement.id;

                return (
                  <div
                    key={announcement.id}
                    className={`card border ${
                      !announcement.is_active || isExpired
                        ? 'border-pihole-border opacity-60'
                        : announcement.type === 'critical'
                          ? 'border-red-500/30'
                          : announcement.type === 'warning'
                            ? 'border-yellow-500/30'
                            : 'border-blue-500/30'
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                          <input
                            type="text"
                            value={editingAnnouncement.title}
                            onChange={(e) =>
                              setEditingAnnouncement({
                                ...editingAnnouncement,
                                title: e.target.value,
                              })
                            }
                            className="bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                          />
                          <div className="flex gap-4">
                            <select
                              value={editingAnnouncement.type}
                              onChange={(e) =>
                                setEditingAnnouncement({
                                  ...editingAnnouncement,
                                  type: e.target.value as 'info' | 'warning' | 'critical',
                                })
                              }
                              className="flex-1 bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                            >
                              <option value="info">Info</option>
                              <option value="warning">Warning</option>
                              <option value="critical">Critical</option>
                            </select>
                            <input
                              type="datetime-local"
                              value={editExpiresAt}
                              onChange={(e) => setEditExpiresAt(e.target.value)}
                              className="flex-1 bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent"
                            />
                          </div>
                        </div>
                        <textarea
                          value={editingAnnouncement.message}
                          onChange={(e) =>
                            setEditingAnnouncement({
                              ...editingAnnouncement,
                              message: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full bg-pihole-darkest border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text focus:outline-none focus:border-pihole-accent resize-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditingAnnouncement(null);
                              setEditExpiresAt('');
                            }}
                            className="btn btn-ghost text-sm"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleUpdateAnnouncement}
                            className="btn btn-primary text-sm"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-pihole-text">
                              {announcement.title}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                announcement.type === 'critical'
                                  ? 'bg-red-500/20 text-red-400'
                                  : announcement.type === 'warning'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-blue-500/20 text-blue-400'
                              }`}
                            >
                              {announcement.type}
                            </span>
                            {announcement.is_active && !isExpired ? (
                              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                                Active
                              </span>
                            ) : isExpired ? (
                              <span className="px-2 py-0.5 bg-pihole-border text-pihole-text-muted text-xs rounded">
                                Expired
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-pihole-border text-pihole-text-muted text-xs rounded">
                                Inactive
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-pihole-text-muted mb-2">
                            {announcement.message}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-pihole-text-muted">
                            <span>By {announcement.created_by}</span>
                            <span>
                              Created {new Date(announcement.created_at).toLocaleDateString()}
                            </span>
                            {announcement.expires_at && (
                              <span>
                                Expires {new Date(announcement.expires_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              handleToggleAnnouncement(announcement.id, !announcement.is_active)
                            }
                            className="btn btn-ghost text-sm"
                          >
                            {announcement.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => {
                              setEditingAnnouncement(announcement);
                              setEditExpiresAt(
                                announcement.expires_at ? announcement.expires_at.slice(0, 16) : '',
                              );
                            }}
                            className="btn btn-ghost text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAnnouncement(announcement.id)}
                            className="btn btn-ghost text-sm text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Limit Request Card Component
function LimitRequestCard({
  request,
  onApprove,
  onDeny,
  readOnly = false,
}: {
  request: LimitRequest;
  onApprove: (id: string, customLimit?: number) => void;
  onDeny: (id: string, reason?: string) => void;
  readOnly?: boolean;
}) {
  const [customLimit, setCustomLimit] = useState<string>('');
  const [denyReason, setDenyReason] = useState('');
  const [showDenyForm, setShowDenyForm] = useState(false);

  const formatDomains = (count: number) => {
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(0) + 'K';
    return count.toLocaleString();
  };

  return (
    <div
      className={`p-4 rounded-lg border ${
        request.status === 'pending'
          ? 'bg-pihole-darkest border-pihole-border'
          : request.status === 'approved'
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-red-500/5 border-red-500/20'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        {request.avatar_url ? (
          <img src={request.avatar_url} alt="" className="w-10 h-10 rounded-full" />
        ) : (
          <div className="w-10 h-10 bg-pihole-border rounded-full flex items-center justify-center">
            <span className="text-pihole-text text-sm">{request.username?.[0]?.toUpperCase()}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-pihole-text">{request.username}</span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                request.status === 'pending'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : request.status === 'approved'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
              }`}
            >
              {request.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
            <div>
              <span className="text-pihole-text-muted">Current: </span>
              <span className="text-pihole-text">{formatDomains(request.current_limit)}</span>
            </div>
            <div>
              <span className="text-pihole-text-muted">Requested: </span>
              <span className="text-pihole-text">{formatDomains(request.requested_tier)}</span>
            </div>
            <div>
              <span className="text-pihole-text-muted">Usage: </span>
              <span className="text-pihole-text">{formatDomains(request.current_usage)}</span>
            </div>
            <div>
              <span className="text-pihole-text-muted">Intent: </span>
              <span className="text-pihole-text">
                {INTENDED_USE_LABELS[request.intended_use] || request.intended_use}
              </span>
            </div>
          </div>

          <div className="text-sm mb-3">
            <span className="text-pihole-text-muted">Reason: </span>
            <span className="text-pihole-text">{request.reason}</span>
          </div>

          {request.status !== 'pending' && (
            <div className="text-sm text-pihole-text-muted">
              {request.status === 'approved' && request.approved_limit && (
                <span>
                  Approved for {formatDomains(request.approved_limit)} domains by{' '}
                  {request.reviewed_by}
                </span>
              )}
              {request.status === 'denied' && (
                <span>
                  Denied by {request.reviewed_by}
                  {request.admin_response && `: ${request.admin_response}`}
                </span>
              )}
            </div>
          )}

          {/* Actions for pending requests */}
          {!readOnly && request.status === 'pending' && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={() => onApprove(request.id)} className="btn btn-primary text-sm">
                Approve ({formatDomains(request.requested_tier)})
              </button>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Custom limit"
                  value={customLimit}
                  onChange={(e) => setCustomLimit(e.target.value)}
                  className="w-32 px-3 py-1.5 bg-pihole-darkest border border-pihole-border rounded text-sm text-pihole-text"
                />
                <button
                  onClick={() => {
                    const limit = parseInt(customLimit);
                    if (limit > 0) onApprove(request.id, limit);
                  }}
                  disabled={!customLimit || parseInt(customLimit) <= 0}
                  className="btn btn-secondary text-sm"
                >
                  Approve Custom
                </button>
              </div>

              {!showDenyForm ? (
                <button
                  onClick={() => setShowDenyForm(true)}
                  className="btn btn-ghost text-sm text-red-400"
                >
                  Deny
                </button>
              ) : (
                <div className="flex items-center gap-2 w-full mt-2">
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-pihole-darkest border border-pihole-border rounded text-sm text-pihole-text"
                  />
                  <button
                    onClick={() => {
                      onDeny(request.id, denyReason || undefined);
                      setShowDenyForm(false);
                      setDenyReason('');
                    }}
                    className="btn btn-ghost text-sm text-red-400"
                  >
                    Confirm Deny
                  </button>
                  <button
                    onClick={() => {
                      setShowDenyForm(false);
                      setDenyReason('');
                    }}
                    className="btn btn-ghost text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date */}
        <div className="text-sm text-pihole-text-muted whitespace-nowrap">
          {new Date(request.created_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
