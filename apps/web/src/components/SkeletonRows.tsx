interface Props {
  rows?: number;
  columns?: number;
  label?: string;
}

/**
 * Institutional Geometric Skeleton Loader (Zero Layout Shift / Zero Centered Spinners).
 * Renders structured tabular row placeholders matching the exact density of financial tables.
 */
export function SkeletonRows({ rows = 4, columns = 4, label = 'Loading financial records...' }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className="space-y-2.5 py-2"
    >
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="grid gap-3 rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-3 animate-pulse"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((__, colIdx) => (
            <div
              key={colIdx}
              className={`h-3.5 rounded bg-slate-800 ${
                colIdx === columns - 1 ? 'w-2/3 justify-self-end' : colIdx === 0 ? 'w-3/4' : 'w-1/2'
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
