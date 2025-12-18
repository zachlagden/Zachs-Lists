import { useEffect, useState } from 'react';
import { useAuthStore, useUserDataStore } from '../store';
import { userApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import type { UserList } from '../types';
import { getUserListUrl } from '../config/site';

export default function ListsPage() {
  const { user } = useAuthStore();
  const { lists, setLists, updateListVisibility } = useUserDataStore();
  const [loading, setLoading] = useState(true);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchLists = async () => {
      try {
        const data = await userApi.getLists();
        setLists(data.lists || []);
      } catch (error) {
        console.error('Failed to fetch lists:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLists();
  }, [setLists]);

  const handleToggleVisibility = async (list: UserList) => {
    setTogglingVisibility(list.name);
    try {
      await userApi.toggleListVisibility(list.name, !list.is_public);
      updateListVisibility(list.name, !list.is_public);
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
    } finally {
      setTogglingVisibility(null);
    }
  };

  const getListUrl = (list: UserList, format?: string) => {
    const base = getUserListUrl(user?.username || '', list.name);
    return format ? `${base}?format=${format}` : base;
  };

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
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
        <h1 className="text-2xl font-bold text-pihole-text">My Lists</h1>
        <p className="text-pihole-text-muted">
          View and manage your generated blocklists
        </p>
      </div>

      {lists.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-pihole-text-muted mb-4">
            No lists generated yet
          </div>
          <p className="text-sm text-pihole-text-muted mb-6">
            Configure your blocklist sources and trigger a build to generate your first list.
          </p>
          <a href="/config" className="btn btn-primary">
            Go to Configuration
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {lists.map((list) => (
            <div key={list.name} className="card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-pihole-text">{list.name}</h3>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        list.is_public
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {list.is_public ? 'Public' : 'Private'}
                    </span>
                  </div>
                  <p className="text-sm text-pihole-text-muted mt-1">
                    {list.domain_count?.toLocaleString()} domains • Last updated{' '}
                    {new Date(list.last_updated).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleVisibility(list)}
                  disabled={togglingVisibility === list.name}
                  className="btn btn-ghost text-sm"
                >
                  {togglingVisibility === list.name ? (
                    <LoadingSpinner size="sm" />
                  ) : list.is_public ? (
                    'Make Private'
                  ) : (
                    'Make Public'
                  )}
                </button>
              </div>

              {/* Formats */}
              <div className="mb-4">
                <div className="text-sm text-pihole-text-muted mb-2">Available Formats</div>
                <div className="flex flex-wrap gap-2">
                  {(list.formats || ['hosts']).map((format) => (
                    <span
                      key={format}
                      className="px-2 py-1 bg-pihole-border rounded text-xs text-pihole-text"
                    >
                      {format}
                    </span>
                  ))}
                </div>
              </div>

              {/* URLs */}
              <div className="space-y-3">
                <div className="text-sm text-pihole-text-muted">Copy URL</div>

                {/* Default URL */}
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-pihole-darkest border border-pihole-border rounded px-3 py-2 text-sm text-pihole-text-muted overflow-x-auto">
                    {getListUrl(list)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(getListUrl(list))}
                    className="btn btn-ghost text-sm shrink-0"
                  >
                    {copiedUrl === getListUrl(list) ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                {/* Format-specific URLs */}
                <div className="flex flex-wrap gap-2">
                  {['hosts', 'plain', 'adblock'].map((format) => (
                    <button
                      key={format}
                      onClick={() => copyToClipboard(getListUrl(list, format))}
                      className="btn btn-ghost text-xs"
                    >
                      {copiedUrl === getListUrl(list, format)
                        ? 'Copied!'
                        : `Copy ${format.charAt(0).toUpperCase() + format.slice(1)} URL`}
                    </button>
                  ))}
                </div>
              </div>

              {/* View Link */}
              <div className="mt-4 pt-4 border-t border-pihole-border">
                <a
                  href={`/api/u/${user?.username}/${list.name}.txt`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-pihole-accent hover:underline"
                >
                  View raw list
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help */}
      <div className="card">
        <h3 className="font-semibold text-pihole-text mb-4">Using Your Lists</h3>
        <div className="space-y-4 text-sm">
          <div>
            <h4 className="text-pihole-text font-medium mb-1">In Pi-hole</h4>
            <p className="text-pihole-text-muted">
              Go to Group Management → Adlists → Add your list URL.
              Pi-hole will automatically fetch updates.
            </p>
          </div>
          <div>
            <h4 className="text-pihole-text font-medium mb-1">Format Options</h4>
            <ul className="text-pihole-text-muted space-y-1">
              <li>• <strong>hosts</strong> - <code>0.0.0.0 domain.com</code> (default, Pi-hole)</li>
              <li>• <strong>plain</strong> - <code>domain.com</code> (one per line)</li>
              <li>• <strong>adblock</strong> - <code>||domain.com^</code> (AdBlock/uBlock)</li>
            </ul>
          </div>
          <div>
            <h4 className="text-pihole-text font-medium mb-1">Privacy</h4>
            <p className="text-pihole-text-muted">
              Private lists require authentication. Public lists can be accessed by anyone with the URL.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
