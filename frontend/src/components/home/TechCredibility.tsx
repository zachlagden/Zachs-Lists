import { motion } from 'framer-motion';
import { Github, Shield, Zap, Lock, Server, CheckCircle2 } from 'lucide-react';

const techStack = [
  {
    name: 'Rust Worker',
    description: 'Memory-safe, blazing fast list processing',
    icon: '/assets/rust-logo.png',
    isImage: true,
    highlight: true,
  },
  {
    name: 'MongoDB',
    description: 'Flexible, scalable data storage',
    icon: <Server className="w-6 h-6" />,
    isImage: false,
    highlight: false,
  },
  {
    name: 'Flask API',
    description: 'Python-powered REST backend',
    icon: <Server className="w-6 h-6" />,
    isImage: false,
    highlight: false,
  },
  {
    name: 'React + Vite',
    description: 'Modern, fast frontend with Tailwind',
    icon: <Zap className="w-6 h-6" />,
    isImage: false,
    highlight: false,
  },
];

const features = [
  { icon: <Zap className="w-5 h-5" />, text: 'Parallel list processing' },
  { icon: <Lock className="w-5 h-5" />, text: 'No tracking, no telemetry' },
  { icon: <CheckCircle2 className="w-5 h-5" />, text: 'Open source infrastructure' },
  { icon: <Shield className="w-5 h-5" />, text: 'Validated & deduplicated lists' },
];

const compatibleWith = [
  { name: 'Pi-hole', verified: true },
  { name: 'AdGuard Home', verified: true },
  { name: 'uBlock Origin', verified: true },
  { name: 'pfBlockerNG', verified: true },
  { name: 'Technitium DNS', verified: true },
  { name: 'Any DNS blocker', verified: false },
];

export default function TechCredibility() {
  return (
    <section className="relative py-24 lg:py-32 bg-void-deep overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-grid-pattern-dense opacity-30" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-display-md text-chrome-light mb-4">
            BUILT FOR
            <span className="text-gradient-rust"> RELIABILITY</span>
          </h2>
          <p className="text-lg text-chrome max-w-2xl mx-auto">
            Enterprise-grade infrastructure, open source transparency.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start max-w-6xl mx-auto">
          {/* Left: Tech Stack */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h3 className="font-display text-xl text-chrome-light mb-6 uppercase tracking-wider">
              Our Stack
            </h3>

            <div className="space-y-4">
              {techStack.map((tech, index) => (
                <motion.div
                  key={tech.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="glass-card p-5 flex items-center gap-4 glass-card-hover"
                >
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                    tech.highlight ? 'bg-rust/20 border border-rust/40' : 'bg-steel border border-steel-light'
                  }`}>
                    {tech.isImage ? (
                      <img src={tech.icon as string} alt={tech.name} className="w-8 h-8" />
                    ) : (
                      <span className="text-chrome">{tech.icon}</span>
                    )}
                  </div>
                  <div>
                    <h4 className={`font-semibold ${tech.highlight ? 'text-rust-light' : 'text-chrome-light'}`}>
                      {tech.name}
                    </h4>
                    <p className="text-sm text-chrome">{tech.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* GitHub Link */}
            <motion.a
              href="https://github.com/zachlagden/Zachs-Lists"
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="mt-6 inline-flex items-center gap-2 text-chrome hover:text-chrome-light"
            >
              <Github className="w-5 h-5" />
              <span className="text-sm font-medium">View on GitHub</span>
            </motion.a>
          </motion.div>

          {/* Right: Features & Compatibility */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            {/* Features */}
            <h3 className="font-display text-xl text-chrome-light mb-6 uppercase tracking-wider">
              Why It Matters
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-10">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.text}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-steel/30 border border-steel-light/50"
                >
                  <span className="text-rust">{feature.icon}</span>
                  <span className="text-sm text-chrome">{feature.text}</span>
                </motion.div>
              ))}
            </div>

            {/* Compatibility */}
            <h3 className="font-display text-xl text-chrome-light mb-6 uppercase tracking-wider">
              Compatible With
            </h3>

            <div className="flex flex-wrap gap-2">
              {compatibleWith.map((item, index) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className={`
                    inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm
                    ${item.verified
                      ? 'bg-matrix/10 border border-matrix/30 text-matrix'
                      : 'bg-steel/50 border border-steel-light text-chrome'
                    }
                  `}
                >
                  {item.verified && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {item.name}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Rust Performance Highlight */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-16 max-w-4xl mx-auto"
        >
          <div className="glass-card p-8 border-rust/30 text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <img src="/assets/rust-logo.png" alt="Rust" className="w-10 h-10" />
              <h3 className="font-display text-2xl text-rust-light">
                WHY RUST?
              </h3>
            </div>
            <p className="text-chrome max-w-2xl mx-auto">
              Our worker processes <span className="text-chrome-light font-semibold">millions of domains</span> with zero-copy parsing and parallel deduplication.
              Rust's zero-cost abstractions and memory safety mean reliable, fast list generation
              without the overhead of garbage collection or runtime errors.
            </p>
            <div className="mt-6 flex items-center justify-center gap-8 text-sm">
              <div className="text-center">
                <div className="text-2xl font-display text-rust">100%</div>
                <div className="text-chrome">Validated domains</div>
              </div>
              <div className="w-px h-12 bg-steel-light" />
              <div className="text-center">
                <div className="text-2xl font-display text-rust">0</div>
                <div className="text-chrome">Memory leaks</div>
              </div>
              <div className="w-px h-12 bg-steel-light" />
              <div className="text-center">
                <div className="text-2xl font-display text-rust">99.9%</div>
                <div className="text-chrome">Uptime</div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
