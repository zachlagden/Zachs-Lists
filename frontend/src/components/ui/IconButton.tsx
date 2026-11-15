import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/cn';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';
import { Icon } from './Icon';
import type { IconName } from './icons';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  label: string;
  icon: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(buttonClasses({ variant, size, iconOnly: true }), className)}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
