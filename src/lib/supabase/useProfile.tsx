"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export function useProfile() {
  const supabase = createSupabaseBrowserClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        if (isMounted) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, clinic_id, role, full_name")
        .eq("user_id", authData.user.id)
        .single();

      if (!error && isMounted) {
        setProfile(data as Profile);
      }
      if (isMounted) {
        setLoading(false);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [supabase]);

  return { profile, loading };
}
