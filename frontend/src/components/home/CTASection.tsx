import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Github, ArrowRight, Heart, Copy, Check, Shield } from 'lucide-react';
import { getDefaultListUrl } from '../../config/site';

interface CTASectionProps {
  isAuthenticated: boolean;
}

export default function CTASection({ isAuthenticated }: CTASectionProps) {
  const [copied, setCopied] = useState(false);
  const listUrl = getDefaultListUrl('all_domains');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(listUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative py-24 lg:py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-void via-void-deep to-void" />
      <div className="absolute inset-0 bg-grid-pattern opacity-20" />

      {/* Rust glow orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-gradient-radial-rust opacity-40" />

      {/* Content */}
      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center"
        >
          {/* Shield Icon */}
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ type: 'spring', damping: 15, delay: 0.1 }}
            className="mb-8"
          >
            <div className="inline-flex p-4 rounded-2xl bg-rust/10 border border-rust/30 shadow-rust-glow">
              <Shield className="w-10 h-10 text-rust" />
            </div>
          </motion.div>

          {/* Headline */}
          <h2 className="font-display text-display-lg text-chrome-light mb-4">
            YOUR PI-HOLE DESERVES
            <br />
            <span className="text-gradient">BETTER LISTS</span>
          </h2>

          <p className="text-xl text-chrome mb-8">Free forever. Setup takes 30 seconds.</p>

          {/* Inline Terminal */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            <div className="inline-flex items-center gap-3 px-4 py-3 rounded-xl bg-void-deep border border-steel-light max-w-full overflow-hidden">
              <code className="text-matrix text-sm font-mono truncate">{listUrl}</code>
              <motion.button
                onClick={handleCopy}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="shrink-0 p-2 rounded-lg bg-steel hover:bg-steel-light"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-matrix" />
                ) : (
                  <Copy className="w-4 h-4 text-chrome" />
                )}
              </motion.button>
            </div>
            {copied && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 text-sm text-matrix"
              >
                Copied! Now paste into your Pi-hole adlists.
              </motion.p>
            )}
          </motion.div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Go to Dashboard
                <ArrowRight className="w-5 h-5" />
              </Link>
            ) : (
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to="/login" className="btn btn-primary btn-lg">
                  <Github className="w-5 h-5" />
                  Create Custom Lists
                </Link>
              </motion.div>
            )}
            <Link to="/browse" className="btn btn-secondary btn-lg">
              Browse All Lists
            </Link>
          </div>

          {/* Sponsor Link */}
          <motion.a
            href="https://github.com/sponsors/zachlagden"
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 text-sm text-chrome hover:text-electric-pink group"
          >
            <Heart className="w-4 h-4 group-hover:text-electric-pink group-hover:fill-electric-pink" />
            Help keep this free
          </motion.a>
        </motion.div>
      </div>
    </section>
  );
}
