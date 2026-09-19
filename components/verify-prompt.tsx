"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SiDiscord } from "react-icons/si";
import { ShieldAlert } from "lucide-react";
import { useSession } from "@/components/session-provider";

type Gate = "join" | "verify" | null;

/**
 * After login: invite anyone who isn't in the HyperLeague Discord, then warn
 * anyone who hasn't verified with Bloxlink yet.
 */
export function VerifyPrompt() {
  const pathname = usePathname();
  const { session, discordInvite, loaded } = useSession();
  const [gate, setGate] = useState<Gate>(null);
  const [dismissed, setDismissed] = useState<Gate>(null);

  useEffect(() => {
    if (pathname === "/login" || !loaded) {
      setGate(null);
      return;
    }
    if (!session) {
      setGate(null);
      setDismissed(null);
      return;
    }
    const next: Gate = !session.inGuild
      ? "join"
      : session.verified === false
        ? "verify"
        : null;
    setGate(next);
    if (next !== dismissed) setDismissed(null);
  }, [pathname, loaded, session, session?.inGuild, session?.verified, dismissed]);

  const open = !!gate && dismissed !== gate;
  const joinUrl = discordInvite || "https://discord.gg/4UTrW6xJ39";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDismissed(gate)}>
      <DialogContent
        className="bg-hl-panel border border-hl-border sm:max-w-md"
        showCloseButton
      >
        {gate === "join" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-white header-caps flex items-center gap-2">
                <SiDiscord className="w-5 h-5 text-[#5865F2]" />
                Join the HyperLeague Discord
              </DialogTitle>
              <DialogDescription className="text-hl-muted">
                You need to be in the HyperLeague Discord server to play. Join it,
                then come back here.
              </DialogDescription>
            </DialogHeader>
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-sm transition-colors"
            >
              <SiDiscord className="w-4 h-4" />
              Join Discord server
            </a>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-white header-caps flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-hl-gold" />
                Unlock matchmaking
              </DialogTitle>
              <DialogDescription className="text-hl-muted">
                Press <strong>Get Matchmaking Access</strong> in the HyperLeague
                Discord to unlock ranked queue and your website profile, then
                refresh this page.
              </DialogDescription>
            </DialogHeader>
            {discordInvite ? (
              <a
                href={discordInvite}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-sm transition-colors"
              >
                <SiDiscord className="w-4 h-4" />
                Open Discord
              </a>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
