import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'default' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control border font-medium whitespace-nowrap no-underline disabled:cursor-not-allowed disabled:opacity-55';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-accent text-on-accent shadow-[0_6px_18px_-8px_var(--accent-start)] hover:brightness-[1.08] disabled:hover:brightness-100',
  default: 'border-border-strong bg-surface text-text hover:bg-surface-hover',
  ghost:
    'border-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-2.5 text-[13px] narrow:min-h-11 narrow:min-w-11',
  md: 'h-9 px-3.5 narrow:min-h-11 narrow:min-w-11',
  lg: 'h-11 px-5',
};

const ICON_ONLY: Record<ButtonSize, string> = {
  sm: 'w-[30px] px-0 narrow:min-w-11',
  md: 'w-9 px-0 narrow:min-w-11',
  lg: 'w-11 px-0',
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
}

export function buttonClasses({
  variant = 'default',
  size = 'md',
  iconOnly = false,
}: ButtonClassOptions = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], iconOnly && ICON_ONLY[size]);
}
