import { motion } from 'framer-motion';
import { Heart, Server, Zap, Shield } from 'lucide-react';

const costs = [
  { icon: <Server className="w-5 h-5" />, label: 'Server hosting' },
  { icon: <Zap className="w-5 h-5" />, label: 'Bandwidth & CDN' },
  { icon: <Shield className="w-5 h-5" />, label: 'Domain & SSL' },
];

export default function SupportSection() {
  return (
    <section className="relative py-20 lg:py-24 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-void-deep via-void to-void-deep" />
      <div className="absolute inset-0 bg-grid-pattern opacity-10" />

      {/* Pink glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-electric-pink/10 blur-[100px] rounded-full" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto"
        >
          {/* Card */}
          <div className="glass-card p-8 lg:p-10 border-electric-pink/20 text-center">
            {/* Heart Icon */}
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', damping: 15, delay: 0.1 }}
              className="mb-6"
            >
              <div className="inline-flex p-4 rounded-2xl bg-electric-pink/10 border border-electric-pink/30">
                <Heart className="w-8 h-8 text-electric-pink" />
              </div>
            </motion.div>

            <h2 className="font-display text-display-sm text-chrome-light mb-4">
              HELP KEEP THIS
              <span className="text-gradient"> FREE</span>
            </h2>

            <p className="text-chrome mb-6 max-w-xl mx-auto">
              Zach's Lists is a one-person project. Your support helps cover the costs of running this service
              and keeps it free for everyone.
            </p>

            {/* Costs */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
              {costs.map((cost) => (
                <div
                  key={cost.label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-steel/50 border border-steel-light text-sm text-chrome"
                >
                  <span className="text-chrome/60">{cost.icon}</span>
                  {cost.label}
                </div>
              ))}
            </div>

            {/* CTA */}
            <motion.a
              href="https://github.com/sponsors/zachlagden"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn btn-lg bg-gradient-to-r from-electric-pink to-pink-600 text-white hover:shadow-pink-glow border border-electric-pink/20"
            >
              <Heart className="w-5 h-5" />
              Become a Sponsor
            </motion.a>

            <p className="mt-4 text-sm text-chrome/60">
              Every contribution makes a difference
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
