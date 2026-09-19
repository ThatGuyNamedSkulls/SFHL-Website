"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { UserSession } from "@/types";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";

type SessionState = {
  session: UserSession | null;
  discordInvite: string | null;
  coins: number;
  loaded: boolean;
};

type SessionContextValue = SessionState & {
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  clear: () => void;
};

const AUTH_URL = "/api/auth/me";

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({
    session: null,
    discordInvite: null,
    coins: 0,
    loaded: false,
  });

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const { ok, json } = await apiGetJson<{
        user?: UserSession | null;
        discordInvite?: string | null;
        coins?: number;
      }>(AUTH_URL, { ttlMs: opts?.force ? 0 : 2500, force: opts?.force });
      if (!ok) {
        setState((s) => ({ ...s, loaded: true }));
        return;
      }
      setState({
        session: json?.user ?? null,
        discordInvite:
          typeof json?.discordInvite === "string" ? json.discordInvite : null,
        coins: typeof json?.coins === "number" ? json.coins : 0,
        loaded: true,
      });
    } catch {
      setState((s) => ({ ...s, loaded: true }));
    }
  }, []);

  const clear = useCallback(() => {
    invalidateClientApi(AUTH_URL);
    setState({ session: null, discordInvite: null, coins: 0, loaded: true });
  }, []);

  useEffect(() => {
    refresh({ force: true });
  }, [refresh]);

  useEffect(() => {
    if (!state.loaded || !state.session) return;
    const gated = !state.session.inGuild || state.session.verified === false;
    const ms = gated ? 8000 : 30000;
    const id = window.setInterval(() => refresh({ force: gated }), ms);
    return () => window.clearInterval(id);
  }, [
    state.loaded,
    state.session?.discordId,
    state.session?.inGuild,
    state.session?.verified,
    refresh,
  ]);

  const value = useMemo(
    () => ({ ...state, refresh, clear }),
    [state, refresh, clear]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
