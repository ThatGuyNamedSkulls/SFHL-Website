import type { MentionSegment } from "@/lib/discord-mentions";

const pill = "rounded px-1 font-semibold";

/** Discord post text with mentions shown like Discord does: @Role in the
 *  role's colour, #channel linking to Discord, @user highlighted. */
export function DiscordContent({
  content,
  segments,
}: {
  content: string;
  segments?: MentionSegment[] | null;
}) {
  if (!segments?.length) return <>{content || "(no text)"}</>;
  return (
    <>
      {segments.map((s, i) => {
        switch (s.type) {
          case "role":
            return (
              <span
                key={i}
                className={pill}
                style={
                  s.color
                    ? { color: s.color, backgroundColor: `${s.color}26` }
                    : { color: "#c9cdfb", backgroundColor: "rgba(88,101,242,0.3)" }
                }
              >
                {s.text}
              </span>
            );
          case "channel":
            return s.url ? (
              <a
                key={i}
                href={s.url}
                title="Opens in the Discord app"
                className={`${pill} text-[#c9cdfb] bg-[#5865f2]/30 hover:bg-[#5865f2]/50`}
              >
                {s.text}
              </a>
            ) : (
              <span key={i} className={`${pill} text-[#c9cdfb] bg-[#5865f2]/30`}>
                {s.text}
              </span>
            );
          case "user":
          case "everyone":
            return (
              <span key={i} className={`${pill} text-[#c9cdfb] bg-[#5865f2]/30`}>
                {s.text}
              </span>
            );
          default:
            return <span key={i}>{s.text}</span>;
        }
      })}
    </>
  );
}
