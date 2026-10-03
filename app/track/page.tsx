import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Gauge, LineChart, Map as MapIcon } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getAllPlayers } from "@/lib/db";
import { trackHref } from "@/lib/track-link";

const FEATURES = [
  { icon: Gauge, title: "Performance", text: "Win rate, rating, K/D, ADR and more — each with its change since the period before." },
  { icon: LineChart, title: "Against your tier", text: "Bars that show where you sit among players at your skill level this season." },
  { icon: CalendarDays, title: "Form and sessions", text: "A bar per match, your play days, and your best and worst games." },
  { icon: MapIcon, title: "Maps", text: "Your numbers on every map, with your best map and the one that needs work." },
];

/**
 * /track opens your own tracker (docs/TRACK_UI_PLAN.md Q1); anyone's is at
 * /track/<name>. Not linked: the Bloxlink step. Logged out: what Track shows.
 */
export default async function TrackIndex({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (session?.playerName) {
    const query = await searchParams;
    const params = new URLSearchParams();
    for (const k of ["tab", "range", "map", "mode"]) {
      const v = query[k];
      if (typeof v === "string" && v) params.set(k, v);
    }
    const rest = params.toString();
    redirect(`${trackHref(session.playerName)}${rest ? `?${rest}` : ""}`);
  }

  if (session) {
    return (
      <div className="hl-page-wide py-16 text-center">
        <h1 className="mb-4 text-2xl font-bold text-white">
          Your Discord account isn&apos;t linked to a HyperLeague player yet.
        </h1>
        <p className="mb-6 text-hl-muted">Join the Discord server and verify with Bloxlink first.</p>
        <Link href="/leaderboards" className="text-hl-gold hover:underline">
          Return to Rankings
        </Link>
      </div>
    );
  }

  const [top] = await getAllPlayers(1).catch(() => []);
  return (
    <div className="hl-page-wide max-w-[56rem] py-10 md:py-14">
      <div className="text-center">
        <div className="header-caps text-xs tracking-[0.14em] text-[#ff5500]">Counter Blox</div>
        <h1 className="mt-1 text-[1.875rem] font-black text-white">Track</h1>
        <p className="mx-auto mt-2 max-w-[34rem] text-sm text-[#8a8a8a]">
          Are you getting better, and at what? Track compares your recent matches with the ones before and with
          players at your skill level.
        </p>
      </div>
      <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3.5 rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.625rem] bg-[#ff5500]/15">
              <Icon className="h-5 w-5 text-[#ff5500]" />
            </span>
            <span>
              <b className="block text-[0.9375rem] text-white">{title}</b>
              <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-[#8a8a8a]">{text}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Link
          href="/login"
          className="inline-flex rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-black text-hl-base header-caps"
        >
          Log in to see yours
        </Link>
        {top ? (
          <Link href={trackHref(top.name)} className="text-[0.8125rem] font-bold text-[#8a8a8a] hover:text-white">
            Or look at {top.name}&apos;s tracker (#1)
          </Link>
        ) : null}
      </div>
    </div>
  );
}
