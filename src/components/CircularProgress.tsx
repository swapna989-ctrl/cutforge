/** A ring gauge — the big, at-a-glance "how far along is this" a thumbnail-sized percentage number
 *  alone doesn't give. Starts at 12 o'clock and fills clockwise, matching how a clock/loading
 *  convention is normally read. */
export default function CircularProgress({ percent, size = 72 }: { percent: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = Math.round(size * 0.09);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ECE5E6" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#ed8395"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-[#1d1b1e]">{clamped}%</span>
      </div>
    </div>
  );
}
