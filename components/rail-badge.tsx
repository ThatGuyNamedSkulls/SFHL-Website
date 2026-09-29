/** FACEIT-style count chip on right-rail icons (1–9+). */
export function RailBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[0.875rem] h-[0.875rem] px-[0.1875rem] rounded-full bg-[#d4d4d4] text-[#111] text-[0.6875rem] font-black leading-[0.875rem] text-center pointer-events-none">
      {count > 9 ? "9+" : count}
    </span>
  );
}
