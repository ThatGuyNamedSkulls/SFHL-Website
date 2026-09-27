"use client";

import { useEffect, useState } from "react";

/** Ticks every 250 ms while `on` (the accept countdown). */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}
