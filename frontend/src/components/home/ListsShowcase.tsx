import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Copy, Check, ExternalLink, ArrowRight } from 'lucide-react';
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
}

function ListCard({ list, delay = 0 }: ListCardProps) {
  const [copied, setCopied] = useState(false);

  const listUrl = getDefaultListUrl(list.name);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(listUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const relativeTime = formatDistanceToNow(new Date(list.last_updated), { addSuffix: true });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -4 }}
      className="group bg-pihole-darker rounded-xl border border-pihole-border p-5 hover:border-pihole-accent/40 hover:glow-accent-subtle"
      style={{ transition: 'border-color 0.3s, box-shadow 0.3s' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-pihole-text group-hover:text-pihole-accent transition-colors">
            {list.name}
          </h3>
          {list.description && (
            <p className="text-sm text-pihole-text-muted mt-1 line-clamp-2">
              {list.description}
            </p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-pihole-text-muted mb-4">
        <span className="font-medium text-pihole-text">
          {list.domain_count?.toLocaleString()} domains
        </span>
        <span className="text-pihole-border">|</span>
        <span>Updated {relativeTime}</span>
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
          href={`/api/lists/${list.name}.txt`}
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
  return (
    <section className="py-20 lg:py-28 bg-pihole-darkest">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl lg:text-4xl font-bold text-pihole-text mb-4">
            Ready-to-use blocklists
          </h2>
          <p className="text-pihole-text-muted max-w-2xl mx-auto">
            Curated from trusted sources. Copy a URL and add it directly to your Pi-hole.
          </p>
        </motion.div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-pihole-border border-t-pihole-accent" />
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
              {lists.slice(0, 6).map((list, index) => (
                <ListCard key={list.name} list={list} delay={index * 0.05} />
              ))}
            </div>

            {lists.length > 6 && (
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                className="text-center mt-10"
              >
                <Link
                  to="/browse"
                  className="inline-flex items-center gap-2 text-pihole-accent hover:text-pihole-accent-hover transition-colors font-medium"
                >
                  View all {lists.length} lists
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
