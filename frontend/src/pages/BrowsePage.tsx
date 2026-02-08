import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Star } from 'lucide-react';
import { api, listsApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PublicNav from '../components/PublicNav';
import { Footer } from '../components/home';
import { getDefaultListUrl, getUserListUrl } from '../config/site';

interface FeaturedList {
  id: string;
  username: string;
  list_name: string;
  description: string;
  domain_count: number;
  last_updated: string;
  display_order: number;
}

interface DefaultList {
  name: string;
  domain_count: number;
  last_updated: string;
  description?: string;
}

export default function BrowsePage() {
  const [activeTab, setActiveTab] = useState<'default' | 'featured'>('default');
  const [defaultLists, setDefaultLists] = useState<DefaultList[]>([]);
  const [featuredLists, setFeaturedLists] = useState<FeaturedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [defaultData, featuredData] = await Promise.all([
          listsApi.getDefaultLists().catch(() => []),
          api
            .get('/api/browse/featured')
            .then((r) => r.data)
            .catch(() => []),
        ]);
        setDefaultLists(defaultData);
        setFeaturedLists(featuredData);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 bg-grid-pattern opacity-20 pointer-events-none" />

      {/* Navigation */}
      <PublicNav />

      <main className="container mx-auto px-6 py-8 flex-1 relative z-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-display-sm text-chrome-light mb-2">BROWSE LISTS</h1>
          <p className="text-chrome">
            Discover blocklists for your Pi-hole. Copy any URL and add it to your adlists.
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-steel-light mb-8">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('default')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'default'
                  ? 'border-rust text-rust'
                  : 'border-transparent text-chrome hover:text-chrome-light'
              }`}
            >
              Default Lists
            </button>
            <button
              onClick={() => setActiveTab('featured')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'featured'
                  ? 'border-rust text-rust'
                  : 'border-transparent text-chrome hover:text-chrome-light'
              }`}
            >
              Featured
              {featuredLists.length > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-rust/20 text-rust rounded-full text-xs">
                  {featuredLists.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Default Lists Tab */}
        {activeTab === 'default' && (
          <div>
            <p className="text-chrome mb-6">
              Curated blocklists maintained by this site. Reliable and regularly updated.
            </p>
            {defaultLists.length === 0 ? (
              <div className="glass-card text-center py-12 text-chrome">
                No default lists available yet.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {defaultLists.map((list) => (
                  <div key={list.name} className="glass-card p-6">
                    <div className="mb-4">
                      <h3 className="font-semibold text-chrome-light">{list.name}</h3>
                      {list.description && (
                        <p className="text-sm text-chrome mt-1">{list.description}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm text-chrome mb-4">
                      <span>{list.domain_count?.toLocaleString()} domains</span>
                      <span>Updated {new Date(list.last_updated).toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(getDefaultListUrl(list.name))}
                        className="btn btn-primary flex-1 text-sm"
                      >
                        {copiedUrl === getDefaultListUrl(list.name) ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy URL
                          </>
                        )}
                      </button>
                      <a
                        href={`/lists/${list.name}.txt`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost text-sm"
                      >
                        <ExternalLink className="w-4 h-4" />
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
            <p className="text-chrome mb-6">
              Hand-picked lists from the community. Verified and recommended.
            </p>
            {featuredLists.length === 0 ? (
              <div className="glass-card text-center py-12 text-chrome">
                No featured lists yet. Check back soon!
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                {featuredLists.map((list) => (
                  <div key={list.id} className="glass-card p-6 border-rust/30">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-chrome-light">{list.list_name}</h3>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rust/20 text-rust text-xs rounded-full">
                            <Star className="w-3 h-3" />
                            Featured
                          </span>
                        </div>
                        <p className="text-sm text-chrome">by {list.username}</p>
                      </div>
                    </div>
                    {list.description && (
                      <p className="text-sm text-chrome mb-4">{list.description}</p>
                    )}
                    <div className="flex items-center justify-between text-sm text-chrome mb-4">
                      <span>{list.domain_count?.toLocaleString()} domains</span>
                      <span>Updated {new Date(list.last_updated).toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          copyToClipboard(getUserListUrl(list.username, list.list_name))
                        }
                        className="btn btn-primary flex-1 text-sm"
                      >
                        {copiedUrl === getUserListUrl(list.username, list.list_name) ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy URL
                          </>
                        )}
                      </button>
                      <a
                        href={`/api/u/${list.username}/${list.list_name}.txt`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost text-sm"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How to use */}
        <div className="mt-12 glass-card p-8">
          <h2 className="font-display text-xl text-chrome-light mb-6">HOW TO USE THESE LISTS</h2>
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="w-8 h-8 rounded-lg bg-rust/20 text-rust flex items-center justify-center font-display text-lg mb-3">
                1
              </div>
              <h3 className="font-medium text-chrome-light mb-2">Copy the URL</h3>
              <p className="text-chrome">
                Click "Copy URL" on any list to copy its address to your clipboard.
              </p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-lg bg-rust/20 text-rust flex items-center justify-center font-display text-lg mb-3">
                2
              </div>
              <h3 className="font-medium text-chrome-light mb-2">Add to Pi-hole</h3>
              <p className="text-chrome">
                In Pi-hole, go to Group Management &rarr; Adlists and paste the URL.
              </p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-lg bg-rust/20 text-rust flex items-center justify-center font-display text-lg mb-3">
                3
              </div>
              <h3 className="font-medium text-chrome-light mb-2">Update Gravity</h3>
              <p className="text-chrome">
                Run "Update Gravity" in Pi-hole to fetch and activate the list.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
