import { useState, useEffect } from 'react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

interface StatItemProps {
  value: number;
  label: string;
  suffix?: string;
  delay?: number;
}

function AnimatedCounter({ value, duration = 2000 }: { value: number; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView || value === 0) return;

    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(value * eased));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [value, duration, isInView]);

  return <span ref={ref}>{count.toLocaleString()}</span>;
}

function StatItem({ value, label, suffix = '', delay = 0 }: StatItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="text-center"
    >
      <div className="text-4xl lg:text-5xl font-bold text-pihole-text mb-2">
        <AnimatedCounter value={value} />
        {suffix && <span className="text-pihole-accent">{suffix}</span>}
      </div>
      <div className="text-pihole-text-muted text-sm font-medium uppercase tracking-wider">
        {label}
      </div>
    </motion.div>
  );
}

interface StatsSectionProps {
  totalDomains: number;
  totalUsers: number;
  totalRequests: number;
}

export default function StatsSection({ totalDomains, totalUsers, totalRequests }: StatsSectionProps) {
  // Don't render if no data
  if (totalDomains === 0 && totalUsers === 0 && totalRequests === 0) {
    return null;
  }

  return (
    <section className="py-16 lg:py-20 bg-pihole-darker relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-pihole-accent/5 via-transparent to-pihole-accent/5" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center text-pihole-text-muted mb-10 text-sm font-medium uppercase tracking-wider"
        >
          The numbers speak for themselves
        </motion.p>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-16 max-w-3xl mx-auto">
          <StatItem
            value={totalDomains}
            label="Domains Blocked"
            suffix="+"
            delay={0}
          />
          <StatItem
            value={totalUsers}
            label="Active Users"
            delay={0.1}
          />
          <StatItem
            value={totalRequests}
            label="Requests Served"
            suffix="+"
            delay={0.2}
          />
        </div>
      </div>
    </section>
  );
}
