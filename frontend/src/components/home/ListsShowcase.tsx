import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Copy, Check, ExternalLink, ArrowRight, Star, Clock, Database } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { getDefaultListUrl } from '../../config/site';

interface DefaultList {
  name: string;
  domain_count: number;
  last_updated: string;
  description?: string;
}

interface ListCardProps {
  list: DefaultList;
  delay?: number;
  isFeatured?: boolean;
}

function ListCard({ list, delay = 0, isFeatured = false }: ListCardProps) {
  const [copied, setCopied] = useState(false);

  const listUrl = getDefaultListUrl(list.name);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(listUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const relativeTime = formatDistanceToNow(new Date(list.last_updated), { addSuffix: true });
  const isRecent = Date.now() - new Date(list.last_updated).getTime() < 24 * 60 * 60 * 1000;

  if (isFeatured) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="col-span-full mb-8"
      >
        <div className="glass-card p-8 border-rust/30 relative overflow-hidden">
          {/* Featured badge */}
          <div className="absolute top-4 right-4">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rust/20 border border-rust/40">
              <Star className="w-3.5 h-3.5 text-rust fill-rust" />
              <span className="text-xs font-medium text-rust-light">Recommended</span>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            {/* Info */}
            <div className="flex-1">
              <h3 className="font-display text-3xl text-chrome-light mb-2">
                {list.name.toUpperCase().replace(/_/g, ' ')}
              </h3>
              <p className="text-chrome mb-4">
                {list.description ||
                  'Complete aggregated blocklist with all sources combined. The only URL you need.'}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-2 text-chrome-light">
                  <Database className="w-4 h-4 text-rust" />
                  <span className="font-semibold">{list.domain_count?.toLocaleString()}</span>
                  <span className="text-chrome">domains</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-matrix" />
                  <span className="text-chrome">Updated {relativeTime}</span>
                  {isRecent && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-matrix/20 text-matrix border border-matrix/30">
                      FRESH
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <motion.button
                onClick={handleCopy}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn btn-primary btn-lg"
              >
                {copied ? (
                  <>
                    <Check className="w-5 h-5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-5 h-5" />
                    Copy URL
                  </>
                )}
              </motion.button>
              <a
                href={`/lists/${list.name}.txt`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-lg"
              >
                <ExternalLink className="w-5 h-5" />
                View List
              </a>
            </div>
          </div>

          {/* URL Preview */}
          <div className="mt-6 p-4 rounded-xl bg-void-deep border border-steel-light">
            <code className="text-matrix text-sm font-mono break-all">{listUrl}</code>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -4 }}
      className="glass-card p-5 glass-card-hover group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-chrome-light group-hover:text-electric-pink transition-colors truncate">
            {list.name}
          </h3>
          {list.description && (
            <p className="text-sm text-chrome mt-1 line-clamp-2">{list.description}</p>
          )}
        </div>
        {isRecent && (
          <span className="shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] bg-matrix/20 text-matrix border border-matrix/30">
            NEW
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-sm text-chrome mb-4">
        <span className="font-medium text-chrome-light">
          {list.domain_count?.toLocaleString()} domains
        </span>
        <span className="text-steel-light">|</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {relativeTime}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <motion.button
          onClick={handleCopy}
          whileTap={{ scale: 0.97 }}
          className="btn btn-primary flex-1 text-sm"
        >
          {copied ? (
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
        </motion.button>
        <a
          href={`/lists/${list.name}.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost text-sm"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </motion.div>
  );
}

interface ListsShowcaseProps {
  lists: DefaultList[];
  loading: boolean;
}

export default function ListsShowcase({ lists, loading }: ListsShowcaseProps) {
  // Find the "all_domains" list for featuring
  const featuredList = lists.find(
    (l) => l.name === 'all_domains' || l.name === 'all_domains_hosts',
  );
  const otherLists = lists.filter(
    (l) => l.name !== 'all_domains' && l.name !== 'all_domains_hosts',
  );

  return (
    <section className="py-24 lg:py-32 bg-void relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-dot-pattern opacity-30" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-display-md text-chrome-light mb-4">
            READY-TO-USE
            <span className="text-gradient"> BLOCKLISTS</span>
          </h2>
          <p className="text-lg text-chrome max-w-2xl mx-auto">
            Curated from trusted sources. Copy a URL and add it directly to your Pi-hole.
          </p>
        </motion.div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-steel-light border-t-rust animate-spin" />
            <p className="text-chrome text-sm">Loading blocklists...</p>
          </div>
        ) : (
          <>
            {/* Featured List */}
            {featuredList && <ListCard list={featuredList} isFeatured />}

            {/* Other Lists Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
              {otherLists.slice(0, 6).map((list, index) => (
                <ListCard key={list.name} list={list} delay={index * 0.05} />
              ))}
            </div>

            {/* View All Link */}
            {lists.length > 6 && (
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                className="text-center mt-10"
              >
                <Link
                  to="/browse"
                  className="inline-flex items-center gap-2 text-electric-pink hover:text-electric-pink-hover transition-colors font-medium group"
                >
                  View all {lists.length} lists
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </motion.div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
