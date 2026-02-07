"use client";

import { useEffect } from "react";
import { useProfile } from "@/lib/supabase/useProfile";

export function GoogleCalendarAutoSync() {
  const { profile } = useProfile();

  useEffect(() => {
    if (!profile?.clinic_id) return;

    const intervalSeconds = Number(process.env.NEXT_PUBLIC_GCAL_SYNC_INTERVAL_SEC || 120);

    const runSync = async () => {
      try {
        await fetch("/api/gcal/sync", { method: "POST" });
      } catch {
        // Auto-sync should never break UI rendering.
      }
    };

    runSync();
    const interval = setInterval(runSync, intervalSeconds * 1000);

    return () => clearInterval(interval);
  }, [profile?.clinic_id]);

  return null;
}
