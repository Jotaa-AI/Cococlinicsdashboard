"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { AgentRuntimeControls } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ControlKey = "calls_agent_active" | "whatsapp_agent_active" | "hitl_mode_active";

const DEFAULT_CONTROLS: Pick<
  AgentRuntimeControls,
  "calls_agent_active" | "whatsapp_agent_active" | "hitl_mode_active"
> = {
  calls_agent_active: true,
  whatsapp_agent_active: true,
  hitl_mode_active: false,
};

function Row({
  title,
  description,
  active,
  disabled,
  loading,
  onToggle,
}: {
  title: string;
  description: string;
  active: boolean;
  disabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={active ? "success" : "warning"}>{active ? "Activo" : "Pausado"}</Badge>
          <Button
            type="button"
            size="sm"
            variant={active ? "outline" : "default"}
            disabled={disabled || loading}
            onClick={onToggle}
          >
            {loading ? "Guardando..." : active ? "Pausar" : "Activar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function AgentRuntimeControlsSettings() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const isAdmin = profile?.role === "admin";

  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<ControlKey | null>(null);

  const loadControls = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: selectError } = await supabase
      .from("agent_runtime_controls")
      .select("clinic_id, calls_agent_active, whatsapp_agent_active, hitl_mode_active")
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (selectError) {
      setError(selectError.message);
      setLoading(false);
      return;
    }

    if (!data && isAdmin) {
      const { data: inserted, error: insertError } = await supabase
        .from("agent_runtime_controls")
        .upsert(
          {
            clinic_id: clinicId,
            calls_agent_active: true,
            whatsapp_agent_active: true,
            hitl_mode_active: false,
            updated_by_user_id: profile?.user_id || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "clinic_id" }
        )
        .select("clinic_id, calls_agent_active, whatsapp_agent_active, hitl_mode_active")
        .single();

      if (insertError) {
        setError(insertError.message);
      } else if (inserted) {
        setControls({
          calls_agent_active: inserted.calls_agent_active,
          whatsapp_agent_active: inserted.whatsapp_agent_active,
          hitl_mode_active: inserted.hitl_mode_active,
        });
      }
    } else if (data) {
      setControls({
        calls_agent_active: data.calls_agent_active,
        whatsapp_agent_active: data.whatsapp_agent_active,
        hitl_mode_active: data.hitl_mode_active,
      });
    }

    setLoading(false);
  }, [supabase, clinicId, isAdmin, profile?.user_id]);

  useEffect(() => {
    loadControls();
  }, [loadControls]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("agent-runtime-controls")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_runtime_controls",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          loadControls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadControls]);

  const toggleControl = async (key: ControlKey) => {
    if (!clinicId || !isAdmin) return;

    setSavingKey(key);
    setError(null);

    const nextValue = !controls[key];
    const updatePayload: Record<string, boolean | string | null> = {
      updated_at: new Date().toISOString(),
      updated_by_user_id: profile?.user_id || null,
    };
    updatePayload[key] = nextValue;

    const { data, error: updateError } = await supabase
      .from("agent_runtime_controls")
      .update(updatePayload)
      .eq("clinic_id", clinicId)
      .select("calls_agent_active, whatsapp_agent_active, hitl_mode_active")
      .single();

    if (updateError) {
      setError(updateError.message);
    } else if (data) {
      setControls({
        calls_agent_active: data.calls_agent_active,
        whatsapp_agent_active: data.whatsapp_agent_active,
        hitl_mode_active: data.hitl_mode_active,
      });
    }

    setSavingKey(null);
  };

  const hasAnyPausedAgent = useMemo(
    () => !controls.calls_agent_active || !controls.whatsapp_agent_active,
    [controls.calls_agent_active, controls.whatsapp_agent_active]
  );

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Control operativo</p>
          <p className="text-lg font-semibold">Estado de agentes automáticos</p>
        </div>

        <p className="text-sm text-muted-foreground">
          n8n puede consultar la tabla <span className="font-medium text-foreground">agent_runtime_controls</span> para
          decidir si continúa el flujo automático o entra en Human In The Loop.
        </p>

        {loading ? <p className="text-sm text-muted-foreground">Cargando estado...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <div className="space-y-3">
          <Row
            title="Agente de llamadas"
            description="Controla si el flujo automático de llamadas IA puede ejecutarse."
            active={controls.calls_agent_active}
            disabled={!isAdmin}
            loading={savingKey === "calls_agent_active"}
            onToggle={() => toggleControl("calls_agent_active")}
          />
          <Row
            title="Agente de WhatsApp"
            description="Controla si el flujo automático por WhatsApp puede ejecutarse."
            active={controls.whatsapp_agent_active}
            disabled={!isAdmin}
            loading={savingKey === "whatsapp_agent_active"}
            onToggle={() => toggleControl("whatsapp_agent_active")}
          />
          <Row
            title="Human In The Loop"
            description="Si está activo, n8n debe detener automatizaciones y dejar gestión manual."
            active={controls.hitl_mode_active}
            disabled={!isAdmin}
            loading={savingKey === "hitl_mode_active"}
            onToggle={() => toggleControl("hitl_mode_active")}
          />
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">
            Solo usuarios admin pueden cambiar estos estados. El equipo puede visualizarlos.
          </p>
        ) : null}

        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Sugerencia para n8n:</span> bloquea ejecución automática cuando
          <span className="font-medium text-foreground"> hitl_mode_active = true</span> o cuando el agente del canal esté
          en pausa.
          {hasAnyPausedAgent ? " Actualmente hay al menos un agente pausado." : " Ambos agentes están activos."}
        </div>
      </div>
    </Card>
  );
}
