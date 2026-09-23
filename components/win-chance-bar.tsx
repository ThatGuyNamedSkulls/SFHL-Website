export const WIN_CHANCE_NOTE =
  "A higher-rated opponent means a smaller chance to win, more Elo if you win, and less Elo lost if you lose. Against a lower-rated opponent, the opposite.";

export function WinChanceBar({
  left,
  right,
}: {
  left: number;
  right: number;
}) {
  return (
    <div className="mt-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between text-[12px] font-bold tabular-nums mb-1.5">
        <span className="text-white">{left}%</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8a8a]">
          Win chance
        </span>
        <span className="text-white">{right}%</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-white/15">
        <div className="bg-[#ff5500] h-full" style={{ width: `${left}%` }} />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-center text-[#b0b0b0]">{WIN_CHANCE_NOTE}</p>
    </div>
  );
}
