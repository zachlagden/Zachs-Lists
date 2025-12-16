import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { getDefaultListUrl } from '../../config/site';

export default function TerminalPreview() {
  const [copied, setCopied] = useState(false);

  const listUrl = getDefaultListUrl('all_domains');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(listUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, rotateY: -5 }}
      animate={{ opacity: 1, x: 0, rotateY: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 90, delay: 0.3 }}
      className="terminal w-full max-w-xl mx-auto lg:mx-0"
      style={{ perspective: '1000px' }}
    >
      {/* Terminal Header */}
      <div className="terminal-header">
        <div className="flex gap-2">
          <div className="terminal-dot bg-red-500" />
          <div className="terminal-dot bg-yellow-500" />
          <div className="terminal-dot bg-green-500" />
        </div>
        <span className="text-xs text-pihole-text-muted ml-2">adlists.list</span>
      </div>

      {/* Terminal Body */}
      <div className="terminal-body relative">
        <div className="space-y-2">
          <p className="text-pihole-terminal-comment"># Pi-hole adlists.list</p>
          <p className="text-pihole-terminal-comment"># Your personalized blocklist - auto-updates weekly</p>
          <p className="text-pihole-terminal-comment">#</p>
          <p className="mt-4">
            <span className="text-pihole-terminal-green">{listUrl}</span>
          </p>
          <p className="mt-4 text-pihole-terminal-comment"># That's it. Seriously.</p>
        </div>

        {/* Copy Button */}
        <motion.button
          onClick={handleCopy}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="absolute top-3 right-3 p-2 rounded-lg bg-pihole-border/50 hover:bg-pihole-border transition-colors text-pihole-text-muted hover:text-pihole-text"
        >
          {copied ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 15 }}
            >
              <Check className="w-4 h-4 text-pihole-success" />
            </motion.div>
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </motion.button>

        {/* Copied Toast */}
        {copied && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-pihole-success/20 text-pihole-success text-xs font-medium"
          >
            Copied to clipboard!
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
