import { LIST_FORMATS } from '../../lib/listCatalogue';
import type { ListFormat } from '../../types';
import { SegmentedControl } from '../ui/SegmentedControl';

export interface FormatSwitchProps {
  value: ListFormat;
  onChange: (format: ListFormat) => void;
  label?: string;
  className?: string;
}

export function FormatSwitch({
  value,
  onChange,
  label = 'List format',
  className,
}: FormatSwitchProps) {
  return (
    <SegmentedControl
      label={label}
      options={LIST_FORMATS}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}
