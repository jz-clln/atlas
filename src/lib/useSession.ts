import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);

      if (event === "SIGNED_IN" && newSession?.provider_token) {
        fetch("/api/auth/store-tokens", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newSession.access_token}`,
          },
          body: JSON.stringify({
            provider_token: newSession.provider_token,
            provider_refresh_token: newSession.provider_refresh_token,
            expires_in: 3600,
          }),
        }).catch((err) => {
          console.error("Failed to persist Google tokens:", err);
        });
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { session, loading };
}