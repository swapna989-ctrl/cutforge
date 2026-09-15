"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import LandingPage from "@/components/LandingPage";

export default function Home() {
  const { ready, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  // Signed in (or auth hasn't resolved yet, in which case the redirect above will fire the
  // moment it does): render nothing rather than flash the marketing page first.
  if (!ready || user) return null;

  return <LandingPage />;
}
