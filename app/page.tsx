"use client";

import { LandingPage } from "@/components/landing-page";
import { Dashboard } from "@/components/dashboard";
import { useSession } from "@/components/session-provider";

export default function HomePage() {
  const { session, loaded } = useSession();

  // Avoid a flash of the wrong view before we know the auth state.
  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-10 h-10 rounded-full border-2 border-hl-border border-t-hl-gold animate-spin" />
      </div>
    );
  }

  return session ? <Dashboard session={session} /> : <LandingPage />;
}
