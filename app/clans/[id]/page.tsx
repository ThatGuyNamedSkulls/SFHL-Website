import { Suspense } from "react";
import type { Metadata } from "next";
import { getClubByIdOrTag } from "@/lib/clubs";
import { nameFromSegment } from "@/lib/profile-link";
import { ClanSkeleton, ClanView } from "@/components/clans/clan-view";

type Props = { params: Promise<{ id: string }> };

/** Link previews (docs/CLANS_UI_PLAN.md §4.16): a pasted clan link shows its name, tag and size. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const club = await getClubByIdOrTag(nameFromSegment(id)).catch(() => null);
  if (!club) return { title: "Clan not found — HyperLeague" };
  const members = `${club.members.length} ${club.members.length === 1 ? "member" : "members"}`;
  const title = `${club.name} [${club.tag}] · ${members} — HyperLeague`;
  const description =
    club.description ||
    `${club.name} is a Counter Blox clan on HyperLeague with ${members}. ${club.private ? "Invite only." : "Open to everyone."}`;
  return { title, description, openGraph: { title, description, siteName: "HyperLeague" }, twitter: { card: "summary", title, description } };
}

/** A clan's page: /clans/<id> or /clans/<TAG> (Q2). */
export default async function ClanPage({ params }: Props) {
  const { id } = await params;
  const key = nameFromSegment(id);
  return (
    <Suspense fallback={<ClanSkeleton />}>
      <ClanView key={key} idOrTag={key} />
    </Suspense>
  );
}
