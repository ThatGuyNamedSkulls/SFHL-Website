/** FACEIT-style count chip on right-rail icons (1–9+). */
export function RailBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d4d4d4] text-[#111] text-[9px] font-black leading-[14px] text-center pointer-events-none">
      {count > 9 ? "9+" : count}
    </span>
  );
}
