import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { adminApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';

interface UserDetail {
  id: string;
  username: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  github_id: number;
  is_admin: boolean;
  is_root: boolean;
  is_enabled: boolean;
  is_banned: boolean;
  banned_until?: string;
  ban_reason?: string;
  limits: {
    max_source_lists: number;
    max_domains: number;
    max_config_size_mb: number;
    manual_updates_per_week: number;
  };
  stats: {
    total_domains: number;
    total_output_size_bytes: number;
    last_build_at?: string;
    manual_updates_this_week: number;
  };
  lists: Array<{
    name: string;
    is_public: boolean;
    domain_count: number;
    last_updated: string;
  }>;
  ip_log: Array<{
    ip_hash: string;
    first_seen: string;
    last_seen: string;
    access_count: number;
  }>;
  created_at: string;
}

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable limits
  const [limits, setLimits] = useState({
    max_source_lists: 20,
    max_domains: 2000000,
    max_config_size_mb: 5,
    manual_updates_per_week: 3,
  });

  // Ban form
  const [banDuration, setBanDuration] = useState('7d');
  const [banReason, setBanReason] = useState('');
  const [showBanForm, setShowBanForm] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      if (!userId) return;
      try {
        const userData = await adminApi.getUser(userId);
        setUser(userData);
        setLimits(userData.limits);
      } catch (error) {
        console.error('Failed to fetch user:', error);
        setMessage({ type: 'error', text: 'Failed to load user' });
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [userId]);

  const handleSaveLimits = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await adminApi.updateUser(userId, { limits });
      const updatedUser = await adminApi.getUser(userId);
      setUser(updatedUser);
      setMessage({ type: 'success', text: 'Limits updated' });
    } catch (error) {
      console.error('Failed to update limits:', error);
      setMessage({ type: 'error', text: 'Failed to update limits' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!userId || !user) return;
    try {
      await adminApi.updateUser(userId, { is_enabled: !user.is_enabled });
      const updatedUser = await adminApi.getUser(userId);
      setUser(updatedUser);
      setMessage({ type: 'success', text: `User ${updatedUser.is_enabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
      console.error('Failed to toggle user:', error);
      setMessage({ type: 'error', text: 'Failed to update user' });
    }
  };

  const handleDeleteUser = async () => {
    if (!userId || !user) return;
    if (!confirm(`Are you sure you want to delete ${user.username}? This cannot be undone.`)) return;

    try {
      await adminApi.deleteUser(userId);
      navigate('/admin');
    } catch (error) {
      console.error('Failed to delete user:', error);
      setMessage({ type: 'error', text: 'Failed to delete user' });
    }
  };

  const handleTriggerRebuild = async () => {
    if (!userId) return;
    try {
      await adminApi.triggerUserRebuild(userId);
      setMessage({ type: 'success', text: 'Rebuild triggered' });
    } catch (error) {
      console.error('Failed to trigger rebuild:', error);
      setMessage({ type: 'error', text: 'Failed to trigger rebuild' });
    }
  };

  const handleBan = async () => {
    if (!userId) return;
    try {
      await adminApi.banUser(userId, banDuration, banReason || undefined);
      const updatedUser = await adminApi.getUser(userId);
      setUser(updatedUser);
      setShowBanForm(false);
      setBanReason('');
      setMessage({ type: 'success', text: 'User banned' });
    } catch (error) {
      console.error('Failed to ban user:', error);
      setMessage({ type: 'error', text: 'Failed to ban user' });
    }
  };

  const handleUnban = async () => {
    if (!userId) return;
    try {
      await adminApi.unbanUser(userId);
      const updatedUser = await adminApi.getUser(userId);
      setUser(updatedUser);
      setMessage({ type: 'success', text: 'User unbanned' });
    } catch (error) {
      console.error('Failed to unban user:', error);
      setMessage({ type: 'error', text: 'Failed to unban user' });
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-pihole-text-muted">User not found</p>
        <Link to="/admin" className="text-pihole-accent hover:underline mt-4 inline-block">
          Back to Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/admin?tab=users" className="text-pihole-text-muted hover:text-pihole-text">
            &larr; Back
          </Link>
          {user.avatar_url && (
            <img src={user.avatar_url} alt={user.username} className="w-12 h-12 rounded-full" />
          )}
          <div>
            <h1 className="text-2xl font-bold text-pihole-text flex items-center gap-2">
              {user.name || user.username}
              {user.is_root ? (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded">Root</span>
              ) : user.is_admin && (
                <span className="text-xs bg-pihole-accent/20 text-pihole-accent px-2 py-1 rounded">Admin</span>
              )}
              {user.is_banned && (
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">Banned</span>
              )}
              {!user.is_enabled && !user.is_banned && (
                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Disabled</span>
              )}
            </h1>
            <p className="text-pihole-text-muted">@{user.username}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!user.is_root && (
            <button onClick={handleTriggerRebuild} className="btn btn-secondary">
              Trigger Rebuild
            </button>
          )}
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`px-4 py-3 rounded-lg ${
            message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* User Info */}
        <div className="card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">User Information</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-pihole-text-muted">GitHub ID</span>
              <span className="text-pihole-text">{user.github_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pihole-text-muted">Email</span>
              <span className="text-pihole-text">{user.email || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pihole-text-muted">Created</span>
              <span className="text-pihole-text">{new Date(user.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pihole-text-muted">Last Build</span>
              <span className="text-pihole-text">
                {user.stats.last_build_at ? new Date(user.stats.last_build_at).toLocaleString() : 'Never'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-pihole-text-muted">Total Domains</span>
              <span className="text-pihole-text">{user.stats.total_domains.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pihole-text-muted">Output Size</span>
              <span className="text-pihole-text">{formatBytes(user.stats.total_output_size_bytes)}</span>
            </div>
          </div>
        </div>

        {/* Limits */}
        <div className="card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">Limits</h2>
          {user.is_admin ? (
            <p className="text-green-400">Admin users have unlimited access</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-pihole-text-muted mb-1">Max Source Lists</label>
                <input
                  type="number"
                  value={limits.max_source_lists}
                  onChange={(e) => setLimits({ ...limits, max_source_lists: parseInt(e.target.value) || 0 })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-pihole-text-muted mb-1">Max Domains</label>
                <input
                  type="number"
                  value={limits.max_domains}
                  onChange={(e) => setLimits({ ...limits, max_domains: parseInt(e.target.value) || 0 })}
                  className="input w-full"
                />
                <p className="text-xs text-pihole-text-muted mt-1">
                  {(limits.max_domains / 1000000).toFixed(1)}M domains
                </p>
              </div>
              <div>
                <label className="block text-sm text-pihole-text-muted mb-1">Max Config Size (MB)</label>
                <input
                  type="number"
                  value={limits.max_config_size_mb}
                  onChange={(e) => setLimits({ ...limits, max_config_size_mb: parseInt(e.target.value) || 0 })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-pihole-text-muted mb-1">Manual Updates Per Week</label>
                <input
                  type="number"
                  value={limits.manual_updates_per_week}
                  onChange={(e) => setLimits({ ...limits, manual_updates_per_week: parseInt(e.target.value) || 0 })}
                  className="input w-full"
                />
              </div>
              <button onClick={handleSaveLimits} disabled={saving} className="btn btn-primary w-full">
                {saving ? 'Saving...' : 'Save Limits'}
              </button>
            </div>
          )}
        </div>

        {/* User Lists */}
        <div className="card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">Lists ({user.lists.length})</h2>
          {user.lists.length === 0 ? (
            <p className="text-pihole-text-muted text-sm">No lists</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {user.lists.map((list) => (
                <div key={list.name} className="flex items-center justify-between bg-pihole-darkest p-2 rounded text-sm">
                  <span className="text-pihole-text">{list.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-pihole-text-muted">{list.domain_count.toLocaleString()}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${list.is_public ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {list.is_public ? 'Public' : 'Private'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* IP Log */}
        <div className="card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">IP Access Log ({user.ip_log.length})</h2>
          {user.ip_log.length === 0 ? (
            <p className="text-pihole-text-muted text-sm">No IP access recorded</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {user.ip_log.map((entry, idx) => (
                <div key={idx} className="bg-pihole-darkest p-2 rounded text-sm">
                  <div className="flex justify-between">
                    <span className="text-pihole-text font-mono">{entry.ip_hash}</span>
                    <span className="text-pihole-text-muted">{entry.access_count}x</span>
                  </div>
                  <div className="text-xs text-pihole-text-muted mt-1">
                    First: {new Date(entry.first_seen).toLocaleString()} | Last: {new Date(entry.last_seen).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ban Section */}
      {!user.is_admin && (
        <div className="card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">Ban Management</h2>
          {user.is_banned ? (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg">
                <p className="text-red-400 font-medium">User is currently banned</p>
                {user.ban_reason && <p className="text-red-400/80 text-sm mt-1">Reason: {user.ban_reason}</p>}
                {user.banned_until && (
                  <p className="text-red-400/80 text-sm mt-1">Until: {new Date(user.banned_until).toLocaleString()}</p>
                )}
              </div>
              <button onClick={handleUnban} className="btn btn-primary">
                Unban User
              </button>
            </div>
          ) : showBanForm ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-pihole-text-muted mb-1">Duration</label>
                <select
                  value={banDuration}
                  onChange={(e) => setBanDuration(e.target.value)}
                  className="input w-full"
                >
                  <option value="1d">1 Day</option>
                  <option value="7d">7 Days</option>
                  <option value="30d">30 Days</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-pihole-text-muted mb-1">Reason (optional)</label>
                <input
                  type="text"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Enter reason for ban..."
                  className="input w-full"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleBan} className="btn bg-red-600 hover:bg-red-700 text-white">
                  Confirm Ban
                </button>
                <button onClick={() => setShowBanForm(false)} className="btn btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowBanForm(true)} className="btn bg-red-600/20 text-red-400 hover:bg-red-600/30">
              Ban User
            </button>
          )}
        </div>
      )}

      {/* Danger Zone */}
      {!user.is_admin && (
        <div className="card border border-red-500/30">
          <h2 className="text-lg font-semibold text-red-400 mb-4">Danger Zone</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-pihole-text">{user.is_enabled ? 'Disable' : 'Enable'} Account</p>
              <p className="text-pihole-text-muted text-sm">
                {user.is_enabled ? 'User will not be able to log in' : 'Allow user to log in again'}
              </p>
            </div>
            <button
              onClick={handleToggleEnabled}
              className={`btn ${user.is_enabled ? 'bg-yellow-600/20 text-yellow-400' : 'bg-green-600/20 text-green-400'}`}
            >
              {user.is_enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          <hr className="border-pihole-border my-4" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-pihole-text">Delete Account</p>
              <p className="text-pihole-text-muted text-sm">Permanently delete user and all their data</p>
            </div>
            <button onClick={handleDeleteUser} className="btn bg-red-600 hover:bg-red-700 text-white">
              Delete User
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
