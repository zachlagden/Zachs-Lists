import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';
import { Icon } from './Icon';
import type { IconName } from './icons';

interface ButtonAppearance {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

type NativeButtonProps = ButtonAppearance &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    to?: undefined;
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

type RouterLinkProps = ButtonAppearance & {
  to: string;
  href?: undefined;
  state?: unknown;
  replace?: boolean;
  'aria-label'?: string;
};

type AnchorProps = ButtonAppearance &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'> & {
    href: string;
    to?: undefined;
  };

export type ButtonProps = NativeButtonProps | RouterLinkProps | AnchorProps;

function ButtonContent({ icon, loading, children }: ButtonAppearance) {
  return (
    <>
      {loading ? <Icon name="loop" spin /> : icon ? <Icon name={icon} /> : null}
      {children}
    </>
  );
}

export function Button(props: ButtonProps) {
  const {
    variant = 'default',
    size = 'md',
    icon,
    loading = false,
    fullWidth = false,
    className,
    children,
    ...rest
  } = props;
  const classes = cn(buttonClasses({ variant, size }), fullWidth && 'w-full', className);
  const content = (
    <ButtonContent icon={icon} loading={loading}>
      {children}
    </ButtonContent>
  );

  if ('to' in rest && rest.to !== undefined) {
    const { to, state, replace, ...linkRest } = rest;
    return (
      <Link to={to} state={state} replace={replace} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a className={classes} {...rest}>
        {content}
      </a>
    );
  }
  const {
    type = 'button',
    disabled,
    ...buttonRest
  } = rest as Omit<NativeButtonProps, keyof ButtonAppearance>;
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...buttonRest}
    >
      {content}
    </button>
  );
}
