"use client";

import { useState, useEffect } from "react";
import { UserSession } from "@/types";
import { LandingPage } from "@/components/landing-page";
import { Dashboard } from "@/components/dashboard";

export default function HomePage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user ?? null))
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);

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
