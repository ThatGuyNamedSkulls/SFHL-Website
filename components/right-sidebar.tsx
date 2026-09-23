"use client";

import { useCallback, useRef, useState } from "react";
import { NotificationsBell } from "@/components/notifications-bell";
import { ProfileMenu } from "@/components/profile-menu";
import { MyPartyRail, type PartyTab } from "@/components/my-party-rail";
import { SocialRail } from "@/components/social-panel";
import { VsMatchesPanel } from "@/components/vs-matches-panel";

type Panel = { kind: "social" } | { kind: "party"; tab: PartyTab } | null;

/** Narrow right-edge icon rail (FACEIT: avatar, VS, bell, Social, Party).
 *  Social and Party open as full-height panels beside it, one at a time. */
export function RightSidebar() {
  const railRef = useRef<HTMLElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const close = useCallback(() => setPanel(null), []);

  return (
    <aside
      ref={railRef}
      className="hidden md:flex flex-col items-center gap-1 w-[var(--hl-sidebar-w)] shrink-0 border-l border-white/[0.04] bg-[#181818] sticky top-0 h-dvh z-40"
    >
      <div className="h-[var(--hl-topbar-h)] flex items-center justify-center shrink-0">
        <ProfileMenu variant="rail" />
      </div>

      <VsMatchesPanel />
      <NotificationsBell variant="rail" />
      <SocialRail
        open={panel?.kind === "social"}
        onToggle={() => setPanel((p) => (p?.kind === "social" ? null : { kind: "social" }))}
        onClose={close}
        onOpenPartyChat={() => setPanel({ kind: "party", tab: "chat" })}
        railRef={railRef}
      />

      <div className="mt-1">
        <MyPartyRail
          open={panel?.kind === "party"}
          tab={panel?.kind === "party" ? panel.tab : "chat"}
          onOpen={(tab) => setPanel({ kind: "party", tab })}
          onClose={close}
          railRef={railRef}
        />
      </div>
    </aside>
  );
}
