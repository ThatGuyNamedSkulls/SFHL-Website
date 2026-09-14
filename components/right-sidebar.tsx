"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { NotificationsBell } from "@/components/notifications-bell";
import { ProfileMenu } from "@/components/profile-menu";
import { MyPartyRail } from "@/components/my-party-rail";
import { VsMatchesPanel } from "@/components/vs-matches-panel";
import { RailBadge } from "@/components/rail-badge";

function FriendsRailLink() {
  const [incoming, setIncoming] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/friends");
        if (!res.ok) return;
        const data = await res.json();
        setIncoming(Array.isArray(data.incoming) ? data.incoming.length : 0);
      } catch {
        /* not signed in / social not ready */
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <Link href="/friends" title="Friends" className="relative flex items-center justify-center w-9 h-9 rounded-md text-[#8b8b8b] hover:text-white hover:bg-white/5 transition-colors">
      <span className="relative">
        <Users className="w-[18px] h-[18px]" strokeWidth={1.75} />
        <RailBadge count={incoming} />
      </span>
    </Link>
  );
}

/** Narrow right-edge icon rail (FACEIT: avatar, VS, bell, friends, My Party). */
export function RightSidebar() {
  return (
    <aside className="hidden md:flex flex-col items-center gap-0.5 w-12 shrink-0 border-l border-white/[0.04] bg-[#181818] py-2.5 sticky top-0 h-screen z-40">
      <ProfileMenu variant="rail" />

      <VsMatchesPanel />
      <NotificationsBell variant="rail" />
      <FriendsRailLink />

      <div className="mt-1">
        <MyPartyRail />
      </div>
    </aside>
  );
}
