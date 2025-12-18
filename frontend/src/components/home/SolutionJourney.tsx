import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, Zap, RefreshCw, ArrowRight, Timer, Database, Sparkles } from 'lucide-react';
import { getDefaultListUrl } from '../../config/site';

const steps = [
  {
    number: '01',
    title: 'ADD ONE URL',
    subtitle: '30 seconds to protection',
    icon: <Copy className="w-6 h-6" />,
    color: 'electric-pink',
    description: 'Copy a single URL. Paste it into your Pi-hole, AdGuard, or any DNS blocker. That\'s the entire setup.',
  },
  {
    number: '02',
    title: 'RUST-POWERED PROCESSING',
    subtitle: 'Built for speed',
    icon: <Zap className="w-6 h-6" />,
    color: 'rust',
    description: 'Our Rust worker aggregates, deduplicates, and validates millions of domains efficiently. Memory-safe, parallel processing.',
    isRust: true,
  },
  {
    number: '03',
    title: 'AUTO-UPDATES FOREVER',
    subtitle: 'Set it and forget it',
    icon: <RefreshCw className="w-6 h-6" />,
    color: 'matrix',
    description: 'Your lists update automatically every week. No maintenance, no manual downloads, no midnight gravity updates.',
  },
];

export default function SolutionJourney() {
  const [copied, setCopied] = useState(false);
  const listUrl = getDefaultListUrl('all_domains');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(listUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative py-24 lg:py-32 bg-void overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-grid-pattern opacity-20" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-radial-rust opacity-30" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-matrix/10 border border-matrix/20 mb-6">
            <Sparkles className="w-4 h-4 text-matrix" />
            <span className="text-sm font-medium text-matrix">The Solution</span>
          </div>

          <h2 className="font-display text-display-lg text-chrome-light mb-6">
            THREE STEPS TO
            <br />
            <span className="text-gradient">TOTAL PROTECTION</span>
          </h2>

          <p className="text-xl text-chrome max-w-2xl mx-auto">
            No complex setup. No manual maintenance. Just protection that works.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="max-w-5xl mx-auto">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="relative mb-16 last:mb-0"
            >
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className={`hidden lg:block absolute top-[100px] w-px h-[calc(100%-20px)] bg-gradient-to-b from-steel-light to-transparent ${index % 2 === 0 ? 'left-[60px]' : 'right-[60px]'}`} />
              )}

              <div className={`flex flex-col lg:flex-row gap-6 lg:gap-12 items-start ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
                {/* Step Number */}
                <div className="shrink-0">
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    className={`
                      w-[120px] h-[120px] rounded-2xl flex flex-col items-center justify-center
                      ${step.isRust ? 'bg-rust/20 border-rust/40' : `bg-${step.color}/10 border-${step.color}/30`}
                      border backdrop-blur-sm
                    `}
                  >
                    <span className={`font-display text-5xl ${step.isRust ? 'text-rust' : `text-${step.color}`}`}>
                      {step.number}
                    </span>
                  </motion.div>
                </div>

                {/* Content */}
                <div className="flex-1">
                  <div className="glass-card p-8 glass-card-hover">
                    <div className="flex items-start gap-4 mb-4">
                      <div className={`p-3 rounded-xl ${step.isRust ? 'bg-rust/20 text-rust' : `bg-${step.color}/10 text-${step.color}`}`}>
                        {step.icon}
                      </div>
                      <div>
                        <h3 className="font-display text-2xl text-chrome-light mb-1">
                          {step.title}
                        </h3>
                        <p className={`text-sm font-medium ${step.isRust ? 'text-rust-light' : `text-${step.color}`}`}>
                          {step.subtitle}
                        </p>
                      </div>
                    </div>

                    <p className="text-chrome mb-6">
                      {step.description}
                    </p>

                    {/* Step-specific content */}
                    {step.number === '01' && (
                      <div className="bg-void-deep rounded-xl p-4 border border-steel-light">
                        <div className="flex items-center justify-between gap-4">
                          <code className="text-matrix text-sm truncate flex-1 font-mono">
                            {listUrl}
                          </code>
                          <motion.button
                            onClick={handleCopy}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="btn btn-primary btn-sm shrink-0"
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
                        </div>
                      </div>
                    )}

                    {step.number === '02' && (
                      <div className="bg-void-deep rounded-xl p-4 border border-rust/30">
                        {/* Rust Pipeline Visualization */}
                        <div className="flex items-center justify-between gap-4 overflow-x-auto pb-2">
                          <div className="flex flex-col items-center gap-2 shrink-0">
                            <div className="w-12 h-12 rounded-lg bg-steel flex items-center justify-center">
                              <Database className="w-5 h-5 text-chrome" />
                            </div>
                            <span className="text-xs text-chrome">Sources</span>
                          </div>

                          <ArrowRight className="w-5 h-5 text-rust shrink-0" />

                          <div className="flex flex-col items-center gap-2 shrink-0">
                            <div className="w-12 h-12 rounded-lg bg-rust/20 border border-rust/40 flex items-center justify-center">
                              <img src="/assets/rust-logo.png" alt="Rust" className="w-6 h-6" />
                            </div>
                            <span className="text-xs text-rust-light">Rust Worker</span>
                          </div>

                          <ArrowRight className="w-5 h-5 text-rust shrink-0" />

                          <div className="flex flex-col items-center gap-2 shrink-0">
                            <div className="w-12 h-12 rounded-lg bg-matrix/20 border border-matrix/30 flex items-center justify-center">
                              <Sparkles className="w-5 h-5 text-matrix" />
                            </div>
                            <span className="text-xs text-matrix">Clean List</span>
                          </div>
                        </div>

                        <div className="mt-4 flex items-center gap-4 text-xs text-chrome">
                          <div className="flex items-center gap-1">
                            <Timer className="w-3 h-3 text-rust" />
                            <span>Parallel processing</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Zap className="w-3 h-3 text-rust" />
                            <span>Memory-safe processing</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {step.number === '03' && (
                      <div className="bg-void-deep rounded-xl p-4 border border-matrix/30">
                        <div className="flex items-center gap-4">
                          {/* Calendar visualization */}
                          <div className="grid grid-cols-7 gap-1">
                            {[...Array(28)].map((_, i) => (
                              <div
                                key={i}
                                className={`w-4 h-4 rounded ${
                                  i % 7 === 0
                                    ? 'bg-matrix/60'
                                    : 'bg-steel'
                                }`}
                              />
                            ))}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm text-chrome">
                              <span className="text-matrix font-medium">Every Sunday</span> at midnight,
                              your lists are automatically refreshed with the latest blocklists.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
