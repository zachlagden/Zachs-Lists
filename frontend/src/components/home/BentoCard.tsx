import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface BentoCardProps {
  icon: ReactNode;
  headline: string;
  body: string;
  delay?: number;
}

export default function BentoCard({
  icon,
  headline,
  body,
  delay = 0,
}: BentoCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      whileHover={{ y: -4 }}
      className="bento-card group h-full"
    >
      {/* Icon */}
      <div className="w-12 h-12 rounded-xl bg-pihole-accent/10 flex items-center justify-center text-pihole-accent mb-4 group-hover:bg-pihole-accent/20 transition-colors">
        {icon}
      </div>

      {/* Content */}
      <h3 className="text-xl font-semibold text-pihole-text mb-2">
        {headline}
      </h3>
      <p className="text-pihole-text-muted leading-relaxed">
        {body}
      </p>
    </motion.div>
  );
}
