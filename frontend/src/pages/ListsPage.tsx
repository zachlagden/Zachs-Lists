import { useEffect, useState } from 'react';
import { useAuthStore, useUserDataStore } from '../store';
import { userApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import type { UserList } from '../types';
import { getUserListUrl } from '../config/site';

export default function ListsPage() {
  const { user } = useAuthStore();
  const { lists, setLists } = useUserDataStore();
  const [loading, setLoading] = useState(true);
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
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-pihole-text">{list.name}</h3>
                <p className="text-sm text-pihole-text-muted mt-1">
                  {list.domain_count?.toLocaleString()} domains • Last updated{' '}
                  {new Date(list.last_updated).toLocaleString()}
                </p>
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
        </div>
      </div>
    </div>
  );
}
