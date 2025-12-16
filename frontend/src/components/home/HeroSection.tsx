import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Github } from 'lucide-react';
import TerminalPreview from './TerminalPreview';
import RotatingText from './RotatingText';

const heroWords = ['Pi-hole', 'AdGuard', 'uBlock', 'Security'];

interface HeroSectionProps {
  isAuthenticated: boolean;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as const },
  },
};

export default function HeroSection({ isAuthenticated }: HeroSectionProps) {
  return (
    <header className="relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-pihole-darker via-pihole-darkest to-pihole-darkest" />
      <div className="absolute inset-0 bg-grid-pattern" />

      {/* Gradient orb - subtle background effect */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-pihole-accent/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />

      {/* Navigation */}
      <nav className="relative z-10 container mx-auto px-6 py-5">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-pihole-accent rounded-lg flex items-center justify-center group-hover:glow-accent transition-shadow duration-300">
              <span className="text-white font-bold text-sm">ZL</span>
            </div>
            <span className="font-bold text-xl text-pihole-text">Zach's Lists</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              to="/browse"
              className="text-pihole-text-muted hover:text-pihole-text transition-colors text-sm font-medium"
            >
              Browse Lists
            </Link>
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn btn-primary">
                Dashboard
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary">
                <Github className="w-4 h-4" />
                Sign In
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Content */}
      <div className="relative z-10 container mx-auto px-6 py-16 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text Content */}
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="text-center lg:text-left"
          >
            <motion.h1
              variants={itemVariants}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold text-pihole-text leading-tight"
            >
              Your <RotatingText words={heroWords} className="text-gradient" />,{' '}
              <span className="text-gradient">on autopilot.</span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mt-6 text-lg text-pihole-text-muted max-w-xl mx-auto lg:mx-0"
            >
              Curated blocklists that update themselves. Just add one URL.
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="mt-8 flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start"
            >
              {isAuthenticated ? (
                <Link to="/dashboard" className="btn btn-primary btn-lg">
                  Go to Dashboard
                </Link>
              ) : (
                <Link to="/login" className="btn btn-primary btn-lg">
                  <Github className="w-5 h-5" />
                  Get Started Free
                </Link>
              )}
              <Link to="/browse" className="btn btn-ghost btn-lg">
                Browse lists first
              </Link>
            </motion.div>

            <motion.p
              variants={itemVariants}
              className="mt-4 text-sm text-pihole-text-muted"
            >
              Free forever. No credit card required.
            </motion.p>
          </motion.div>

          {/* Terminal Preview */}
          <div className="lg:pl-8">
            <TerminalPreview />
          </div>
        </div>
      </div>
    </header>
  );
}
