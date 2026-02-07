"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function GoogleCalendarSettings() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const isAdmin = profile?.role === "admin";
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = async () => {
    if (!clinicId) return;
    const { data } = await supabase
      .from("calendar_connections")
      .select("id")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    setConnected(!!data);
  };

  useEffect(() => {
    loadStatus();
  }, [clinicId]);

  const handleConnect = () => {
    window.location.href = "/api/gcal/connect";
  };

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/gcal/sync", { method: "POST" });
    setSyncing(false);
  };

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Google Calendar</p>
          <p className="text-lg font-semibold">Sincronización con agenda externa</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {connected
            ? "Conectado. Importamos eventos busy y exportamos citas a tu calendario."
            : "Aún no hay una cuenta conectada. Conecta para importar disponibilidad."}
        </p>
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Solo los usuarios admin pueden conectar y sincronizar calendarios.
          </p>
        )}
        <div className="flex gap-3">
          <Button
            onClick={handleConnect}
            variant={connected ? "outline" : "default"}
            disabled={!isAdmin}
          >
            {connected ? "Re-conectar" : "Conectar Google Calendar"}
          </Button>
          {connected && (
            <Button onClick={handleSync} variant="soft" disabled={syncing || !isAdmin}>
              {syncing ? "Sincronizando..." : "Sync now"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
