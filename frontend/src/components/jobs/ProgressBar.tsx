interface ProgressBarProps {
  percent: number;
  color?: 'accent' | 'green' | 'blue' | 'yellow' | 'red';
  size?: 'sm' | 'md' | 'lg';
  showPercent?: boolean;
  animated?: boolean;
  className?: string;
}

const colorClasses = {
  accent: 'bg-pihole-accent',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

const sizeClasses = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export default function ProgressBar({
  percent,
  color = 'accent',
  size = 'md',
  showPercent = false,
  animated = false,
  className = '',
}: ProgressBarProps) {
  const clampedPercent = Math.min(100, Math.max(0, percent));

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`flex-1 bg-pihole-border rounded-full overflow-hidden ${sizeClasses[size]}`}>
        <div
          className={`${colorClasses[color]} ${sizeClasses[size]} rounded-full transition-all duration-300 ${
            animated ? 'animate-pulse' : ''
          }`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      {showPercent && (
        <span className="text-xs text-pihole-text-muted w-10 text-right">
          {Math.round(clampedPercent)}%
        </span>
      )}
    </div>
  );
}
