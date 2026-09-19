import { profileBackgroundImage, isProfileBackgroundColor } from "@/lib/profile-backgrounds";

/** Full-page fade behind a player's profile. */
export function ProfilePageBackdrop({ color }: { color: string | null | undefined }) {
  const image = profileBackgroundImage(color);
  if (!image) return null;
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{ backgroundImage: image }}
    />
  );
}

/** Inventory / shop swatch for a background cosmetic. */
export function BackgroundSwatch({
  color,
  className = "",
}: {
  color: string | null | undefined;
  className?: string;
}) {
  const image = profileBackgroundImage(color);
  return (
    <div
      className={`w-full h-full ${className}`}
      style={
        image
          ? { backgroundImage: image }
          : { background: "linear-gradient(to top, #333 0%, #000 100%)" }
      }
    >
      {isProfileBackgroundColor(color) ? null : (
        <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-hl-muted header-caps">
          Background
        </div>
      )}
    </div>
  );
}
