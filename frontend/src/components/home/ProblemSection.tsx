import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { AlertTriangle, Eye, Clock, XCircle } from 'lucide-react';

// Sample tracking domains that scroll by
const TRACKER_DOMAINS = [
  'doubleclick.net', 'google-analytics.com', 'facebook.net', 'scorecardresearch.com',
  'quantserve.com', 'taboola.com', 'outbrain.com', 'criteo.net', 'amazon-adsystem.com',
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com',
  'advertising.com', 'spotxchange.com', 'sharethrough.com', 'contextweb.com',
];

const problems = [
  {
    icon: <Eye className="w-6 h-6" />,
    stat: '3,000+',
    label: 'trackers follow you daily',
    color: 'text-red-400',
  },
  {
    icon: <AlertTriangle className="w-6 h-6" />,
    stat: '28%',
    label: 'of web traffic is ads',
    color: 'text-orange-400',
  },
  {
    icon: <Clock className="w-6 h-6" />,
    stat: '4+ hours',
    label: 'monthly maintaining lists',
    color: 'text-yellow-400',
  },
];

export default function ProblemSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  // Parallax effects
  const chaosOpacity = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0, 1, 1, 0.3]);
  const textY = useTransform(scrollYProgress, [0, 0.5], [50, 0]);

  return (
    <section
      ref={sectionRef}
      className="relative py-24 lg:py-32 bg-void-deep overflow-hidden"
    >
      {/* Scrolling chaos background */}
      <motion.div
        style={{ opacity: chaosOpacity }}
        className="absolute inset-0 overflow-hidden pointer-events-none"
      >
        {/* Multiple scrolling rows of tracker domains */}
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="absolute whitespace-nowrap"
            style={{
              top: `${15 + row * 18}%`,
              animation: `scroll-left ${20 + row * 5}s linear infinite`,
              animationDelay: `${row * -3}s`,
            }}
          >
            <span className="text-red-500/10 font-mono text-sm tracking-wider">
              {[...TRACKER_DOMAINS, ...TRACKER_DOMAINS].map((domain, i) => (
                <span key={i} className="mx-8">{domain}</span>
              ))}
            </span>
          </div>
        ))}
      </motion.div>

      {/* Red gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-red-950/10 to-void-deep pointer-events-none" />

      {/* Content */}
      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          style={{ y: textY }}
          className="max-w-4xl mx-auto"
        >
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-400">The Problem</span>
            </div>

            <h2 className="font-display text-display-lg text-chrome-light mb-6">
              THE INTERNET IS
              <br />
              <span className="text-red-400">HOSTILE.</span>
            </h2>

            <p className="text-xl text-chrome max-w-2xl mx-auto">
              Every device on your network is under constant attack from trackers,
              ads, and malware. Manual protection is a losing battle.
            </p>
          </motion.div>

          {/* Problem Stats */}
          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {problems.map((problem, index) => (
              <motion.div
                key={problem.label}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="glass-card p-6 text-center border-red-500/10"
              >
                <div className={`inline-flex p-3 rounded-xl bg-red-500/10 mb-4 ${problem.color}`}>
                  {problem.icon}
                </div>
                <div className={`text-4xl lg:text-5xl font-display ${problem.color} mb-2`}>
                  {problem.stat}
                </div>
                <p className="text-chrome text-sm">
                  {problem.label}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Transition text */}
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="text-center mt-16 text-lg text-chrome"
          >
            There's a better way.
          </motion.p>
        </motion.div>
      </div>

      {/* CSS for scrolling animation */}
      <style>{`
        @keyframes scroll-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
