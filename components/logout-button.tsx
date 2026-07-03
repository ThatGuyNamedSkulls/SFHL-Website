"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Logs the user out via a POST (never a GET). Logout clears the session cookie,
 * so it MUST be a mutation the user actively triggers — a `<Link>`/GET is
 * prefetched by the App Router, which was silently firing logout in the
 * background and dropping the session on the next navigation.
 */
export function LogoutButton({
  className,
  children,
  onBeforeLogout,
}: {
  className?: string;
  children: React.ReactNode;
  /** Optional hook fired before logout (e.g. to close a menu). */
  onBeforeLogout?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    onBeforeLogout?.();
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* even if the request fails, fall through and send them home */
    }
    router.push("/");
    router.refresh();
  };

  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {children}
    </button>
  );
}
