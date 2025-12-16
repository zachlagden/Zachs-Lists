import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Github, ArrowRight, Heart } from 'lucide-react';

interface CTASectionProps {
  isAuthenticated: boolean;
}

export default function CTASection({ isAuthenticated }: CTASectionProps) {
  return (
    <section className="py-20 lg:py-28 relative">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-pihole-darkest via-pihole-darker to-pihole-darkest" />
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />

      {/* Accent glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-pihole-accent/10 rounded-full blur-[100px]" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl mx-auto text-center"
        >
          <h2 className="text-3xl lg:text-4xl font-bold text-pihole-text mb-4">
            Ready for a cleaner network?
          </h2>
          <p className="text-lg text-pihole-text-muted mb-8">
            Free forever. Setup takes 30 seconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Go to Dashboard
                <ArrowRight className="w-5 h-5" />
              </Link>
            ) : (
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to="/login" className="btn btn-primary btn-lg">
                  <Github className="w-5 h-5" />
                  Get Started Free
                </Link>
              </motion.div>
            )}
            <Link
              to="/browse"
              className="btn btn-ghost btn-lg"
            >
              Browse lists first
            </Link>
          </div>

          <a
            href="https://github.com/sponsors/zachlagden"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-pihole-text-muted hover:text-pihole-accent transition-colors"
          >
            <Heart className="w-4 h-4" />
            Help keep this free
          </a>
        </motion.div>
      </div>
    </section>
  );
}
