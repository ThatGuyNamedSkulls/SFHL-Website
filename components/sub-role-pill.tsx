/** SUB / LEFT tag for scoreboards and history. */

export function SubRolePill({
  isSub,
  leftEarly,
  share,
  compact = false,
}: {
  isSub?: boolean;
  leftEarly?: boolean;
  share?: number | null;
  compact?: boolean;
}) {
  if (!isSub && !leftEarly) return null;
  const pct =
    typeof share === "number" && share > 0 ? ` · ${Math.round(share * 100)}%` : "";
  if (compact) {
    return (
      <span
        title={isSub ? `Substitute${pct}` : `Left early${pct}`}
        className={`inline-flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded text-[9px] font-black ${
          isSub ? "bg-hl-gold/20 text-hl-gold" : "bg-white/10 text-[#8a8a8a]"
        }`}
      >
        {isSub ? "S" : "L"}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide shrink-0 ${
        isSub
          ? "bg-hl-gold/15 text-hl-gold border border-hl-gold/30"
          : "bg-white/[0.06] text-[#8a8a8a] border border-white/10"
      }`}
    >
      {isSub ? `SUB${pct}` : `LEFT${pct}`}
    </span>
  );
}
