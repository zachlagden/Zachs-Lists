import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, listsApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { getDefaultListUrl, getUserListUrl, SITE_DOMAIN } from '../config/site';

interface FeaturedList {
  id: string;
  username: string;
  list_name: string;
  description: string;
  domain_count: number;
  last_updated: string;
  display_order: number;
}

interface CommunityList {
  username: string;
  name: string;
  domain_count: number;
  last_updated: string;
}

interface DefaultList {
  name: string;
  domain_count: number;
  last_updated: string;
  description?: string;
}

export default function BrowsePage() {
  const [activeTab, setActiveTab] = useState<'default' | 'featured' | 'community'>('default');
  const [defaultLists, setDefaultLists] = useState<DefaultList[]>([]);
  const [featuredLists, setFeaturedLists] = useState<FeaturedList[]>([]);
  const [communityLists, setCommunityLists] = useState<CommunityList[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [defaultData, featuredData, communityData] = await Promise.all([
          listsApi.getDefaultLists().catch(() => []),
          api.get('/api/browse/featured').then((r) => r.data).catch(() => []),
          api.get('/api/browse/community').then((r) => r.data).catch(() => []),
        ]);
        setDefaultLists(defaultData);
        setFeaturedLists(featuredData);
        setCommunityLists(communityData);
      } catch (error) {
        console.error('Failed to fetch lists:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };


  const filteredCommunityLists = communityLists.filter(
    (list) =>
      list.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      list.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-pihole-darkest flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pihole-darkest">
      {/* Header */}
      <header className="bg-pihole-darker border-b border-pihole-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-pihole-accent rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">ZL</span>
              </div>
              <span className="font-bold text-xl text-pihole-text">Zach's Lists</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link to="/login" className="btn btn-primary">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-pihole-text mb-2">Browse Lists</h1>
          <p className="text-pihole-text-muted">
            Discover blocklists for your Pi-hole. Copy any URL and add it to your adlists.
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-pihole-border mb-8">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('default')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'default'
                  ? 'border-pihole-accent text-pihole-accent'
                  : 'border-transparent text-pihole-text-muted hover:text-pihole-text'
              }`}
            >
              Default Lists
            </button>
            <button
              onClick={() => setActiveTab('featured')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'featured'
                  ? 'border-pihole-accent text-pihole-accent'
                  : 'border-transparent text-pihole-text-muted hover:text-pihole-text'
              }`}
            >
              Featured
              {featuredLists.length > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-pihole-accent/20 text-pihole-accent rounded-full text-xs">
                  {featuredLists.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('community')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'community'
                  ? 'border-pihole-accent text-pihole-accent'
                  : 'border-transparent text-pihole-text-muted hover:text-pihole-text'
              }`}
            >
              Community
            </button>
          </div>
        </div>

        {/* Default Lists Tab */}
        {activeTab === 'default' && (
          <div>
            <p className="text-pihole-text-muted mb-6">
              Curated blocklists maintained by this site. Reliable and regularly updated.
            </p>
            {defaultLists.length === 0 ? (
              <div className="card text-center py-12 text-pihole-text-muted">
                No default lists available yet.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {defaultLists.map((list) => (
                  <div key={list.name} className="card">
                    <div className="mb-4">
                      <h3 className="font-semibold text-pihole-text">{list.name}</h3>
                      {list.description && (
                        <p className="text-sm text-pihole-text-muted mt-1">{list.description}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm text-pihole-text-muted mb-4">
                      <span>{list.domain_count?.toLocaleString()} domains</span>
                      <span>Updated {new Date(list.last_updated).toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(getDefaultListUrl(list.name))}
                        className="btn btn-primary flex-1 text-sm"
                      >
                        {copiedUrl === getDefaultListUrl(list.name) ? 'Copied!' : 'Copy URL'}
                      </button>
                      <a
                        href={`/api/lists/${list.name}.txt`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost text-sm"
                      >
                        View
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Featured Lists Tab */}
        {activeTab === 'featured' && (
          <div>
            <p className="text-pihole-text-muted mb-6">
              Hand-picked lists from the community. Verified and recommended.
            </p>
            {featuredLists.length === 0 ? (
              <div className="card text-center py-12 text-pihole-text-muted">
                No featured lists yet. Check back soon!
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                {featuredLists.map((list) => (
                  <div
                    key={list.id}
                    className="card border-pihole-accent/30 bg-gradient-to-br from-pihole-darker to-pihole-darkest"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-pihole-text">{list.list_name}</h3>
                          <span className="px-2 py-0.5 bg-pihole-accent/20 text-pihole-accent text-xs rounded-full">
                            Featured
                          </span>
                        </div>
                        <p className="text-sm text-pihole-text-muted">by {list.username}</p>
                      </div>
                    </div>
                    {list.description && (
                      <p className="text-sm text-pihole-text-muted mb-4">{list.description}</p>
                    )}
                    <div className="flex items-center justify-between text-sm text-pihole-text-muted mb-4">
                      <span>{list.domain_count?.toLocaleString()} domains</span>
                      <span>Updated {new Date(list.last_updated).toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(getUserListUrl(list.username, list.list_name))}
                        className="btn btn-primary flex-1 text-sm"
                      >
                        {copiedUrl === getUserListUrl(list.username, list.list_name)
                          ? 'Copied!'
                          : 'Copy URL'}
                      </button>
                      <a
                        href={`/api/u/${list.username}/${list.list_name}.txt`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost text-sm"
                      >
                        View
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Community Lists Tab */}
        {activeTab === 'community' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <p className="text-pihole-text-muted">
                Public lists shared by community members.
              </p>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search lists..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-pihole-darker border border-pihole-border rounded-lg px-4 py-2 text-sm text-pihole-text placeholder-pihole-text-muted focus:outline-none focus:border-pihole-accent w-64"
                />
                <SearchIcon className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-pihole-text-muted" />
              </div>
            </div>

            {filteredCommunityLists.length === 0 ? (
              <div className="card text-center py-12 text-pihole-text-muted">
                {searchQuery ? 'No lists match your search.' : 'No community lists available yet.'}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCommunityLists.map((list) => (
                  <div key={`${list.username}-${list.name}`} className="card">
                    <div className="mb-3">
                      <h3 className="font-semibold text-pihole-text">{list.name}</h3>
                      <p className="text-sm text-pihole-text-muted">by {list.username}</p>
                    </div>
                    <div className="flex items-center justify-between text-sm text-pihole-text-muted mb-4">
                      <span>{list.domain_count?.toLocaleString()} domains</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(getUserListUrl(list.username, list.name))}
                        className="btn btn-primary flex-1 text-sm"
                      >
                        {copiedUrl === getUserListUrl(list.username, list.name)
                          ? 'Copied!'
                          : 'Copy URL'}
                      </button>
                      <a
                        href={`/api/u/${list.username}/${list.name}.txt`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost text-sm"
                      >
                        View
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How to use */}
        <div className="mt-12 card">
          <h2 className="text-lg font-semibold text-pihole-text mb-4">How to Use These Lists</h2>
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <h3 className="font-medium text-pihole-text mb-2">1. Copy the URL</h3>
              <p className="text-pihole-text-muted">
                Click "Copy URL" on any list to copy its address to your clipboard.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-pihole-text mb-2">2. Add to Pi-hole</h3>
              <p className="text-pihole-text-muted">
                In Pi-hole, go to Group Management → Adlists and paste the URL.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-pihole-text mb-2">3. Update Gravity</h3>
              <p className="text-pihole-text-muted">
                Run "Update Gravity" in Pi-hole to fetch and activate the list.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-pihole-border py-8 mt-12">
        <div className="container mx-auto px-6 text-center">
          <p className="text-pihole-text-muted text-sm">
            © {new Date().getFullYear()} {SITE_DOMAIN}
          </p>
        </div>
      </footer>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}
