"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useAuth } from "@/lib/auth";

/**
 * Bridges a Google (NextAuth) session into the app's existing mock, localStorage-backed
 * auth state — so route guards, the dashboard, billing, etc. only ever need to know about
 * `useAuth()` regardless of whether someone signed in with email/password or Google.
 */
export default function GoogleAuthBridge() {
  const { data: session, status } = useSession();
  const auth = useAuth();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.email && auth.ready && !auth.user) {
      auth.login(session.user.email, session.user.name ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the session or our own auth state changes, not on every auth.login identity change
  }, [status, session, auth.ready, auth.user]);

  return null;
}
