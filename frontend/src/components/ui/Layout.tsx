import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Card } from './Card';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-[22px] flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        {eyebrow}
        <h1
          className={cn(
            'text-[22px] font-semibold tracking-[-0.01em] text-balance',
            eyebrow && 'mt-2.5',
          )}
        >
          {title}
        </h1>
        {description ? <p className="mt-0.5 text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stack({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-4', className)} {...rest} />;
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}

export function StatCard({ label, value, detail, children }: StatCardProps) {
  return (
    <Card className="px-[18px] py-4">
      <span className="text-xs text-text-tertiary">{label}</span>
      <div className="num mt-1.5 mb-0.5 text-[26px] leading-[1.5] font-semibold tracking-[-0.02em]">
        {value}
      </div>
      {children}
      {detail ? (
        <small className={cn('block text-xs text-text-tertiary', children && 'mt-2')}>
          {detail}
        </small>
      ) : null}
    </Card>
  );
}

export interface KeyValueItem {
  label: string;
  value: ReactNode;
}

export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn('m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]', className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-text-tertiary">{item.label}</dt>
          <dd className="num m-0 text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-skeleton rounded-md bg-surface-raised', className)}
    />
  );
}

export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
