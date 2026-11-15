import { cn } from '../../lib/cn';
import {
  SEGMENT_BUTTON,
  SEGMENT_BUTTON_SELECTED,
  SEGMENT_BUTTON_UNSELECTED,
  SEGMENT_FRAME,
} from './segmentClasses';

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
}

export interface SegmentedControlProps<Value extends string> {
  label: string;
  options: ReadonlyArray<SegmentOption<Value>>;
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
}

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<Value>) {
  return (
    <div role="group" aria-label={label} className={cn(SEGMENT_FRAME, className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              SEGMENT_BUTTON,
              selected ? SEGMENT_BUTTON_SELECTED : SEGMENT_BUTTON_UNSELECTED,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
