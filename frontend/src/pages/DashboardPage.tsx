import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore, useUserDataStore, useJobsStore } from '../store';
import { userApi, analyticsApi } from '../api/client';
import { useJobSocket } from '../hooks/useSocket';
import type { Job, Notification } from '../types';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import LoadingSpinner from '../components/LoadingSpinner';
import NotificationBanner from '../components/NotificationBanner';
import LimitRequestModal from '../components/LimitRequestModal';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface UserAnalytics {
  total_requests: number;
  total_bandwidth: number;
  requests_over_time: { date: string; count: number }[];
  format_breakdown: Record<string, number>;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { lists, stats, limits, setLists, setStats, setLimits, remainingUpdates, setRemainingUpdates } = useUserDataStore();
  const { jobs, hasUnreadFailures, setJobs, updateJob, setHasUnreadFailures } = useJobsStore();
  const [analytics, setAnalytics] = useState<UserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [buildLoading, setBuildLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showLimitRequestModal, setShowLimitRequestModal] = useState(false);
  const [availableTiers, setAvailableTiers] = useState<number[]>([]);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);

  // Handle real-time job updates
  const handleJobCreated = useCallback(
    (job: Job) => {
      setJobs([job, ...jobs.slice(0, 4)]); // Keep only 5 most recent
    },
    [jobs, setJobs]
  );

  const handleJobProgress = useCallback(
    (job: Job) => {
      updateJob(job);
    },
    [updateJob]
  );

  const handleJobCompleted = useCallback(
    (job: Job) => {
      updateJob(job);
      if (job.status === 'failed') {
        setHasUnreadFailures(true);
      }
      // Refresh lists data when job completes
      if (job.status === 'completed') {
        userApi.getLists().then((listsData) => {
          setLists(listsData.lists || []);
          setStats(listsData.stats || null);
        }).catch(() => {});
      }
    },
    [updateJob, setHasUnreadFailures, setLists, setStats]
  );

  // Subscribe to real-time updates
  useJobSocket({
    userId: user?.id,
    onJobCreated: handleJobCreated,
    onJobProgress: handleJobProgress,
    onJobCompleted: handleJobCompleted,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [listsData, jobsData, analyticsData, limitRequestData, notificationsData] = await Promise.all([
          userApi.getLists(),
          userApi.getJobs(5),
          analyticsApi.getUserStats(30).catch(() => null),
          userApi.getLimitRequests().catch(() => ({ available_tiers: [], has_pending: false })),
          userApi.getNotifications().catch(() => ({ notifications: [] })),
        ]);

        setLists(listsData.lists || []);
        setStats(listsData.stats || null);
        setLimits(listsData.limits || null);
        setRemainingUpdates(listsData.remaining_updates ?? 3);
        setJobs(jobsData.jobs || []);

        // Check for unread failures
        const hasFailures = (jobsData.jobs || []).some(
          (job: { status: string; read: boolean }) => job.status === 'failed' && !job.read
        );
        setHasUnreadFailures(hasFailures);

        setAnalytics(analyticsData);
        setAvailableTiers(limitRequestData.available_tiers || []);
        setHasPendingRequest(limitRequestData.has_pending || false);
        setNotifications(notificationsData.notifications || []);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [setLists, setStats, setLimits, setRemainingUpdates, setJobs, setHasUnreadFailures]);

  const handleTriggerBuild = async () => {
    if (buildLoading || remainingUpdates <= 0) return;

    setBuildLoading(true);
    try {
      const result = await userApi.triggerBuild();
      setRemainingUpdates(result.remaining_updates);
      // Refresh jobs
      const jobsData = await userApi.getJobs(5);
      setJobs(jobsData.jobs || []);
    } catch (error) {
      console.error('Failed to trigger build:', error);
    } finally {
      setBuildLoading(false);
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#9ca3af' },
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#9ca3af' },
      },
    },
  };

  const chartData = {
    labels: analytics?.requests_over_time?.map((d) => d.date) || [],
    datasets: [
      {
        data: analytics?.requests_over_time?.map((d) => d.count) || [],
        borderColor: '#d93025',
        backgroundColor: 'rgba(217, 48, 37, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const handleNotificationDismiss = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const handleLimitRequestSuccess = () => {
    setHasPendingRequest(true);
    // Refresh limit request data
    userApi.getLimitRequests().then((data) => {
      setAvailableTiers(data.available_tiers || []);
      setHasPendingRequest(data.has_pending || false);
    });
  };

  return (
    <div className="space-y-8">
      {/* Notifications Banner */}
      <NotificationBanner notifications={notifications} onDismiss={handleNotificationDismiss} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pihole-text">Dashboard</h1>
          <p className="text-pihole-text-muted">Welcome back, {user?.name || user?.username}</p>
        </div>
        <button
          onClick={handleTriggerBuild}
          disabled={buildLoading || (!user?.is_admin && remainingUpdates <= 0)}
          className="btn btn-primary"
        >
          {buildLoading ? (
            <>
              <LoadingSpinner size="sm" />
              <span className="ml-2">Building...</span>
            </>
          ) : (
            <>
              Rebuild Lists
              {!user?.is_admin && (
                <span className="ml-2 text-xs opacity-75">({remainingUpdates} left)</span>
              )}
            </>
          )}
        </button>
      </div>

      {/* Failed jobs notification */}
      {hasUnreadFailures && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>Some recent builds have failed. Check your job history for details.</span>
          <Link to="/jobs" className="text-red-400 hover:text-red-300 underline">
            View Jobs
          </Link>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="card">
          <div className="text-sm text-pihole-text-muted mb-1">Total Domains</div>
          <div className="text-2xl font-bold text-pihole-text">
            {stats?.total_domains?.toLocaleString() || 0}
          </div>
        </div>
        <div className="card">
          <div className="text-sm text-pihole-text-muted mb-1">Output Size</div>
          <div className="text-2xl font-bold text-pihole-text">
            {formatBytes(stats?.total_output_size_bytes || 0)}
          </div>
        </div>
        <div className="card">
          <div className="text-sm text-pihole-text-muted mb-1">Lists</div>
          <div className="text-2xl font-bold text-pihole-text">{lists.length}</div>
        </div>
        <div className="card">
          <div className="text-sm text-pihole-text-muted mb-1">Total Requests</div>
          <div className="text-2xl font-bold text-pihole-text">
            {analytics?.total_requests?.toLocaleString() || 0}
          </div>
        </div>
      </div>

      {/* Limits */}
      {limits && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-pihole-text">
              Usage Limits
              {user?.is_admin && (
                <span className="ml-2 text-xs bg-pihole-accent/20 text-pihole-accent px-2 py-1 rounded">Admin - Unlimited</span>
              )}
            </h2>
            {!user?.is_admin && availableTiers.length > 0 && !hasPendingRequest && (
              <button
                onClick={() => setShowLimitRequestModal(true)}
                className="btn btn-secondary text-sm"
              >
                Request Higher Limit
              </button>
            )}
            {!user?.is_admin && hasPendingRequest && (
              <span className="text-sm text-yellow-400">Limit request pending</span>
            )}
          </div>
          {user?.is_admin ? (
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-pihole-text-muted">Domains</span>
                  <span className="text-pihole-text">
                    {formatDomains(stats?.total_domains || 0)} / <span className="text-green-400">Unlimited</span>
                  </span>
                </div>
                <div className="w-full bg-pihole-border rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '0%' }} />
                </div>
                <div className="text-xs text-pihole-text-muted mt-1">
                  Storage: {formatBytes(stats?.total_output_size_bytes || 0)}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-pihole-text-muted">Source Lists</span>
                  <span className="text-pihole-text">— / <span className="text-green-400">Unlimited</span></span>
                </div>
                <div className="w-full bg-pihole-border rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '0%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-pihole-text-muted">Manual Updates</span>
                  <span className="text-pihole-text">— / <span className="text-green-400">Unlimited</span></span>
                </div>
                <div className="w-full bg-pihole-border rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '0%' }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-pihole-text-muted">Domains</span>
                  <span className="text-pihole-text">
                    {formatDomains(stats?.total_domains || 0)} / {formatDomains(limits.max_domains)}
                  </span>
                </div>
                <div className="w-full bg-pihole-border rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      (stats?.total_domains || 0) / limits.max_domains > 0.9
                        ? 'bg-red-500'
                        : (stats?.total_domains || 0) / limits.max_domains > 0.7
                        ? 'bg-yellow-500'
                        : 'bg-pihole-accent'
                    }`}
                    style={{
                      width: `${Math.min(((stats?.total_domains || 0) / limits.max_domains) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-pihole-text-muted">Source Lists</span>
                  <span className="text-pihole-text">— / {limits.max_source_lists}</span>
                </div>
                <div className="w-full bg-pihole-border rounded-full h-2">
                  <div className="bg-pihole-accent h-2 rounded-full" style={{ width: '0%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-pihole-text-muted">Manual Updates</span>
                  <span className="text-pihole-text">
                    {limits.manual_updates_per_week - remainingUpdates} / {limits.manual_updates_per_week}
                  </span>
                </div>
                <div className="w-full bg-pihole-border rounded-full h-2">
                  <div
                    className="bg-pihole-accent h-2 rounded-full"
                    style={{
                      width: `${((limits.manual_updates_per_week - remainingUpdates) / limits.manual_updates_per_week) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Limit Request Modal */}
      {showLimitRequestModal && limits && (
        <LimitRequestModal
          isOpen={showLimitRequestModal}
          onClose={() => setShowLimitRequestModal(false)}
          currentLimit={limits.max_domains}
          availableTiers={availableTiers}
          onSuccess={handleLimitRequestSuccess}
        />
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Analytics Chart */}
        <div className="card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">Requests (30 days)</h2>
          {analytics?.requests_over_time?.length ? (
            <div className="h-48">
              <Line data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-pihole-text-muted">
              No data available yet
            </div>
          )}
        </div>

        {/* Recent Jobs */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-pihole-text">Recent Jobs</h2>
            <Link to="/jobs" className="text-sm text-pihole-accent hover:underline">
              View All
            </Link>
          </div>
          {jobs.length > 0 ? (
            <div className="space-y-3">
              {jobs.slice(0, 5).map((job) => (
                <div
                  key={job.job_id}
                  className="flex items-center justify-between py-2 border-b border-pihole-border last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <JobStatusBadge status={job.status} />
                    <div>
                      <div className="text-sm text-pihole-text capitalize">{job.type} Build</div>
                      <div className="text-xs text-pihole-text-muted">
                        {new Date(job.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {job.result && (
                    <div className="text-sm text-pihole-text-muted">
                      {job.result.unique_domains?.toLocaleString()} domains
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-pihole-text-muted py-8">
              No jobs yet. Trigger your first build!
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid md:grid-cols-3 gap-6">
        <Link to="/config" className="card hover:border-pihole-accent transition-colors">
          <h3 className="font-semibold text-pihole-text mb-2">Configuration</h3>
          <p className="text-sm text-pihole-text-muted">
            Edit your blocklist sources and whitelist
          </p>
        </Link>
        <Link to="/lists" className="card hover:border-pihole-accent transition-colors">
          <h3 className="font-semibold text-pihole-text mb-2">My Lists</h3>
          <p className="text-sm text-pihole-text-muted">
            View and manage your generated lists
          </p>
        </Link>
        <Link to="/browse" className="card hover:border-pihole-accent transition-colors">
          <h3 className="font-semibold text-pihole-text mb-2">Browse Lists</h3>
          <p className="text-sm text-pihole-text-muted">
            Discover community and featured lists
          </p>
        </Link>
      </div>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: 'bg-yellow-500/20 text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || colors.queued}`}>
      {status}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDomains(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(0) + 'K';
  return count.toLocaleString();
}
