"use client";

import { useCallback, useEffect, useState } from "react";
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
import { UserSession } from "@/types";

type Gate = "join" | "verify" | null;

/**
 * After login: invite anyone who isn't in the HyperLeague Discord, then warn
 * anyone who hasn't verified with Bloxlink yet.
 */
export function VerifyPrompt() {
  const pathname = usePathname();
  const [gate, setGate] = useState<Gate>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Gate>(null);

  const load = useCallback(async () => {
    if (pathname === "/login") {
      setGate(null);
      return;
    }
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      const user = data?.user as UserSession | null;
      if (typeof data?.discordInvite === "string" && data.discordInvite) {
        setInvite(data.discordInvite);
      }
      if (!user) {
        setGate(null);
        setDismissed(null);
        return;
      }
      const next: Gate = !user.inGuild
        ? "join"
        : user.verified === false
          ? "verify"
          : null;
      setGate(next);
      if (next !== dismissed) setDismissed(null);
    } catch {
      /* ignore */
    }
  }, [pathname, dismissed]);

  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    if (!gate || dismissed === gate) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [gate, dismissed, load]);

  const open = !!gate && dismissed !== gate;
  const joinUrl = invite || "https://discord.gg/4UTrW6xJ39";

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
                Verify with Bloxlink
              </DialogTitle>
              <DialogDescription className="text-hl-muted">
                You have to verify with Bloxlink in the HyperLeague Discord before
                you can queue or appear on the league. Use the Bloxlink verify
                command in the server, then refresh this page.
              </DialogDescription>
            </DialogHeader>
            {invite ? (
              <a
                href={invite}
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
