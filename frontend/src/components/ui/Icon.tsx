import { cn } from '../../lib/cn';
import { ICONS, type IconName } from './icons';

export interface IconProps {
  name: IconName;
  size?: number;
  spin?: boolean;
  className?: string;
}

export function Icon({ name, size = 16, spin = false, className }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      strokeWidth={1.6}
      className={cn('flex-none', spin && 'animate-spin-slow', className)}
    />
  );
}
