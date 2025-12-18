import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Github, ChevronDown, Copy, Check, Heart } from 'lucide-react';
import RustBadge from './RustBadge';
import PublicNav from '../PublicNav';
import { getDefaultListUrl } from '../../config/site';

interface CinematicHeroProps {
  isAuthenticated: boolean;
  totalDomains?: number;
}

export default function CinematicHero({ isAuthenticated }: CinematicHeroProps) {
  const [copied, setCopied] = useState(false);
  const listUrl = getDefaultListUrl('all_domains');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(listUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="relative h-screen flex flex-col overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 hero-gradient" />
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />

      {/* Rust-colored radial glow */}
      <div className="absolute top-1/3 right-0 w-[600px] h-[600px] bg-gradient-radial-rust opacity-40 translate-x-1/4" />

      {/* Navigation */}
      <PublicNav className="shrink-0" />

      {/* Main Hero Content - Two Column */}
      <div className="relative z-10 flex-1 flex items-center">
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left: Text Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center lg:text-left"
            >
              {/* Rust Badge */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 }}
                className="mb-6 flex justify-center lg:justify-start"
              >
                <RustBadge size="md" glowing />
              </motion.div>

              {/* Main Headline */}
              <h1 className="font-display text-display-xl text-chrome-light tracking-wide">
                YOUR NETWORK.
                <br />
                <span className="text-gradient">PROTECTED.</span>
              </h1>

              {/* Subheadline */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-6 text-xl text-chrome max-w-md mx-auto lg:mx-0"
              >
                Curated blocklists that update themselves. Just add one URL to your Pi-hole.
              </motion.p>

              {/* CTA Buttons */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-8 flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start"
              >
                {isAuthenticated ? (
                  <Link to="/dashboard" className="btn btn-primary btn-lg">
                    Go to Dashboard
                  </Link>
                ) : (
                  <Link to="/login" className="btn btn-primary btn-lg">
                    <Github className="w-5 h-5" />
                    Create Custom List
                  </Link>
                )}
                <Link to="/browse" className="btn btn-ghost btn-lg">
                  Browse all lists
                </Link>
              </motion.div>

              {/* Trust signal */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-6 flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-sm text-chrome"
              >
                <span>Free forever. No credit card required.</span>
                <a
                  href="https://github.com/sponsors/zachlagden"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-electric-pink hover:text-electric-pink-hover"
                >
                  <Heart className="w-3.5 h-3.5" />
                  Support this project
                </a>
              </motion.div>
            </motion.div>

            {/* Right: Terminal */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="hidden lg:block"
            >
              <div className="bg-void-deep rounded-xl border border-steel-light overflow-hidden shadow-glass">
                <div className="flex items-center gap-2 px-4 py-3 bg-steel/30 border-b border-steel-light">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                  </div>
                  <span className="text-xs text-chrome ml-2 font-mono">adlists.list</span>
                </div>
                <div className="p-5 space-y-3 font-mono text-sm">
                  <p className="text-chrome/50"># Pi-hole adlists configuration</p>
                  <p className="text-chrome/50"># Auto-updates weekly</p>
                  <p className="text-chrome/30">#</p>
                  <p className="text-matrix break-all pt-2">{listUrl}</p>
                  <p className="text-chrome/40 pt-2"># That's it. Add this URL and relax.</p>
                </div>
                <div className="px-5 pb-5">
                  <motion.button
                    onClick={handleCopy}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="btn btn-primary w-full"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied to clipboard!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy URL
                      </>
                    )}
                  </motion.button>
                </div>
              </div>

              {/* Copy success message */}
              <AnimatePresence>
                {copied && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-3 text-sm text-matrix text-center"
                  >
                    Now paste into your Pi-hole adlists.
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 shrink-0"
      >
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="flex flex-col items-center gap-1 text-chrome"
        >
          <span className="text-xs uppercase tracking-widest">Scroll</span>
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </motion.div>
    </header>
  );
}
