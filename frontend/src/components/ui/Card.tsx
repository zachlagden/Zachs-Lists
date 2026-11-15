import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type CardElement = 'section' | 'div' | 'article';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
}

export function Card({ as: Element = 'div', className, ...rest }: CardProps) {
  return (
    <Element
      className={cn('rounded-card border border-border bg-surface shadow-card', className)}
      {...rest}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, titleId, actions, className }: CardHeaderProps) {
  return (
    <div
      className={cn('flex items-center gap-2.5 border-b border-border px-[18px] py-3.5', className)}
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {title}
      </h2>
      {actions ? (
        <div className="ml-auto flex items-center gap-2 text-[13px] text-text-tertiary">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-[18px]', className)} {...rest} />;
}
