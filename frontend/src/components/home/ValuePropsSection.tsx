import { motion } from 'framer-motion';
import { RefreshCw, Shield, Sliders, BadgeCheck } from 'lucide-react';
import BentoCard from './BentoCard';

const valueProps = [
  {
    icon: <RefreshCw className="w-6 h-6" />,
    headline: 'Configure once, relax forever',
    body: 'Your lists auto-update weekly. No more midnight gravity updates or manual maintenance.',
  },
  {
    icon: <Shield className="w-6 h-6" />,
    headline: 'Millions of domains',
    body: 'Block trackers, ads, and malware from curated sources worldwide.',
  },
  {
    icon: <Sliders className="w-6 h-6" />,
    headline: 'Your rules, your list',
    body: 'Whitelist favorites. Mix sources. Make it yours.',
  },
  {
    icon: <BadgeCheck className="w-6 h-6" />,
    headline: 'Trusted origins only',
    body: 'Aggregated from proven blocklist maintainers. No sketchy lists, no surprises.',
  },
];

export default function ValuePropsSection() {
  return (
    <section className="py-20 lg:py-28 bg-pihole-darkest relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 bg-dot-pattern opacity-50" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12 lg:mb-16"
        >
          <h2 className="text-3xl lg:text-4xl font-bold text-pihole-text mb-4">
            Why Zach's Lists?
          </h2>
          <p className="text-pihole-text-muted max-w-2xl mx-auto">
            Everything you need to keep your network clean, without the hassle.
          </p>
        </motion.div>

        {/* Grid - 2x2 on medium, 4 cols on large, equal heights */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 auto-rows-fr">
          {valueProps.map((prop, index) => (
            <BentoCard
              key={prop.headline}
              icon={prop.icon}
              headline={prop.headline}
              body={prop.body}
              delay={index * 0.1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
