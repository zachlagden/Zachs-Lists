import {
  use,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';
import { FieldContext, type FieldWiring } from './fieldContext';

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const wiring: FieldWiring = { id, describedBy, invalid: Boolean(error) };
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <FieldContext value={wiring}>{children}</FieldContext>
      {hint ? (
        <p id={hintId} className="text-xs text-text-tertiary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full rounded-control border border-border-strong bg-sunken px-3 text-text placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-fail';

function useFieldWiring(own: {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid'];
}) {
  const field = use(FieldContext);
  return {
    id: own.id ?? field?.id,
    'aria-describedby': own['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': own['aria-invalid'] ?? (field?.invalid || undefined),
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ mono = false, className, ...rest }: InputProps) {
  const wiring = useFieldWiring(rest);
  return (
    <input
      {...rest}
      {...wiring}
      className={cn(CONTROL, 'h-9 narrow:min-h-11', mono && 'font-mono text-[13px]', className)}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ mono = false, className, rows = 4, ...rest }: TextareaProps) {
  const wiring = useFieldWiring(rest);
  return (
    <textarea
      {...rest}
      {...wiring}
      rows={rows}
      className={cn(CONTROL, 'py-2', mono && 'font-mono text-[13px]', className)}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ className, children, ...rest }: SelectProps) {
  const wiring = useFieldWiring(rest);
  return (
    <select {...rest} {...wiring} className={cn(CONTROL, 'h-9 narrow:min-h-11', className)}>
      {children}
    </select>
  );
}
