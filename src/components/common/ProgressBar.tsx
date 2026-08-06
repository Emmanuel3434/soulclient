interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
}

export default function ProgressBar({ value, max, label }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full">
      {label && <p className="text-xs text-neutral-400 mb-1">{label}</p>}
      <div className="w-full h-2 bg-bg-card rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
