import { motion } from 'framer-motion';

interface RustBadgeProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  glowing?: boolean;
}

export default function RustBadge({
  size = 'md',
  showText = true,
  className = '',
  glowing = false,
}: RustBadgeProps) {
  const sizes = {
    sm: { logo: 16, text: 'text-xs', gap: 'gap-1.5', padding: 'px-2 py-1' },
    md: { logo: 20, text: 'text-sm', gap: 'gap-2', padding: 'px-3 py-1.5' },
    lg: { logo: 28, text: 'text-base', gap: 'gap-2.5', padding: 'px-4 py-2' },
  };

  const config = sizes[size];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`
        inline-flex items-center ${config.gap} ${config.padding}
        bg-rust/10 border border-rust/30 rounded-full
        ${glowing ? 'shadow-rust-glow' : ''}
        ${className}
      `}
    >
      <img
        src="/assets/rust-logo.png"
        alt="Rust"
        width={config.logo}
        height={config.logo}
        className="object-contain"
      />
      {showText && (
        <span className={`${config.text} font-medium text-rust-light`}>Powered by Rust</span>
      )}
    </motion.div>
  );
}

// Inline version for use within text
export function RustInline({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <img
        src="/assets/rust-logo.png"
        alt="Rust"
        width={18}
        height={18}
        className="object-contain inline"
      />
      <span className="text-rust-light font-medium">Rust</span>
    </span>
  );
}
