"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { LeadAbMetricsRow, LeadAbTestSettings } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const DEFAULT_SETTINGS = {
  is_enabled: false,
  variant_a_weight: 50,
  variant_a_name: "Aviso WhatsApp + llamada",
  variant_b_name: "WhatsApp conversacional",
  variant_a_script:
    "Hola [Nombre], soy [Agente] de Coco Clinics. Te llamo en 1 minuto para valorar tu caso y ver citas.",
  variant_b_script:
    "Hola [Nombre], soy [Agente] de Coco Clinics. Gracias por escribirnos. ¿Qué te gustaría mejorar primero de tu piel?",
};

interface FormState {
  is_enabled: boolean;
  variant_a_weight: number;
  variant_a_name: string;
  variant_b_name: string;
  variant_a_script: string;
  variant_b_script: string;
}

function toFormState(row: Partial<LeadAbTestSettings> | null): FormState {
  return {
    is_enabled: row?.is_enabled ?? DEFAULT_SETTINGS.is_enabled,
    variant_a_weight: row?.variant_a_weight ?? DEFAULT_SETTINGS.variant_a_weight,
    variant_a_name: row?.variant_a_name ?? DEFAULT_SETTINGS.variant_a_name,
    variant_b_name: row?.variant_b_name ?? DEFAULT_SETTINGS.variant_b_name,
    variant_a_script: row?.variant_a_script ?? DEFAULT_SETTINGS.variant_a_script,
    variant_b_script: row?.variant_b_script ?? DEFAULT_SETTINGS.variant_b_script,
  };
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AbTestSettings() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const isAdmin = profile?.role === "admin";

  const [form, setForm] = useState<FormState>(toFormState(null));
  const [metrics, setMetrics] = useState<LeadAbMetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const variantBWeight = useMemo(() => Math.max(0, 100 - asNumber(form.variant_a_weight)), [form.variant_a_weight]);

  const loadData = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);

    const [settingsResponse, metricsResponse] = await Promise.all([
      supabase.from("lead_ab_test_settings").select("*").eq("clinic_id", clinicId).maybeSingle(),
      supabase.rpc("rpc_ab_test_metrics", { p_clinic_id: clinicId, p_days: 30 }),
    ]);

    if (settingsResponse.error) {
      setError(settingsResponse.error.message);
      setLoading(false);
      return;
    }

    setForm(toFormState(settingsResponse.data as LeadAbTestSettings | null));

    if (!metricsResponse.error && Array.isArray(metricsResponse.data)) {
      const rows: LeadAbMetricsRow[] = metricsResponse.data.map((row: Record<string, unknown>) => ({
        variant: (String(row.variant) === "B" ? "B" : "A") as "A" | "B",
        assigned_count: asNumber(row.assigned_count),
        contacted_count: asNumber(row.contacted_count),
        booked_count: asNumber(row.booked_count),
        conversion_pct: asNumber(row.conversion_pct),
      }));
      setMetrics(rows);
    } else {
      setMetrics([]);
    }

    setLoading(false);
  }, [supabase, clinicId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!clinicId || !isAdmin) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    const clampedWeight = Math.min(100, Math.max(0, Math.round(asNumber(form.variant_a_weight))));

    const { error: upsertError } = await supabase.from("lead_ab_test_settings").upsert(
      {
        clinic_id: clinicId,
        is_enabled: form.is_enabled,
        variant_a_weight: clampedWeight,
        variant_a_name: form.variant_a_name.trim() || DEFAULT_SETTINGS.variant_a_name,
        variant_b_name: form.variant_b_name.trim() || DEFAULT_SETTINGS.variant_b_name,
        variant_a_script: form.variant_a_script.trim() || null,
        variant_b_script: form.variant_b_script.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id" }
    );

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    setSaveMessage("Configuración guardada.");
    setSaving(false);
    await loadData();
  };

  const metricsByVariant = useMemo(() => {
    const map: Record<string, LeadAbMetricsRow> = {};
    for (const row of metrics) map[row.variant] = row;
    return {
      A: map.A || { variant: "A", assigned_count: 0, contacted_count: 0, booked_count: 0, conversion_pct: 0 },
      B: map.B || { variant: "B", assigned_count: 0, contacted_count: 0, booked_count: 0, conversion_pct: 0 },
    };
  }, [metrics]);

  return (
    <Card className="p-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Experimentación de captación</p>
            <p className="text-lg font-semibold">Test A/B Meta Lead: llamada vs WhatsApp conversacional</p>
          </div>
          <Badge variant={form.is_enabled ? "success" : "default"}>
            {form.is_enabled ? "Test activo" : "Test inactivo"}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          Configura reparto, guion base y revisa métricas de conversión de los últimos 30 días.
        </p>

        {loading ? <p className="text-sm text-muted-foreground">Cargando configuración...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {saveMessage ? <p className="text-sm text-emerald-700">{saveMessage}</p> : null}
        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">
            Solo usuarios admin pueden editar la configuración. Visualización habilitada para staff.
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Variante A</p>
            <p className="text-sm font-medium">{form.variant_a_name}</p>
            <p className="mt-2 text-xs text-muted-foreground">Asignados: {metricsByVariant.A.assigned_count}</p>
            <p className="text-xs text-muted-foreground">Contactados: {metricsByVariant.A.contacted_count}</p>
            <p className="text-xs text-muted-foreground">Citas: {metricsByVariant.A.booked_count}</p>
            <p className="mt-2 text-sm font-semibold">{metricsByVariant.A.conversion_pct.toFixed(2)}% conversión</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Variante B</p>
            <p className="text-sm font-medium">{form.variant_b_name}</p>
            <p className="mt-2 text-xs text-muted-foreground">Asignados: {metricsByVariant.B.assigned_count}</p>
            <p className="text-xs text-muted-foreground">Contactados: {metricsByVariant.B.contacted_count}</p>
            <p className="text-xs text-muted-foreground">Citas: {metricsByVariant.B.booked_count}</p>
            <p className="mt-2 text-sm font-semibold">{metricsByVariant.B.conversion_pct.toFixed(2)}% conversión</p>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ab-enabled">Estado del test</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={form.is_enabled ? "default" : "outline"}
                disabled={!isAdmin}
                onClick={() => setForm((prev) => ({ ...prev, is_enabled: true }))}
              >
                Activar
              </Button>
              <Button
                type="button"
                variant={!form.is_enabled ? "default" : "outline"}
                disabled={!isAdmin}
                onClick={() => setForm((prev) => ({ ...prev, is_enabled: false }))}
              >
                Pausar
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ab-split">Reparto A/B (A en %)</Label>
            <Input
              id="ab-split"
              type="number"
              min={0}
              max={100}
              value={form.variant_a_weight}
              disabled={!isAdmin}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, variant_a_weight: Math.min(100, Math.max(0, Number(event.target.value))) }))
              }
            />
            <p className="text-xs text-muted-foreground">A: {form.variant_a_weight}% · B: {variantBWeight}%</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ab-a-name">Nombre variante A</Label>
            <Input
              id="ab-a-name"
              value={form.variant_a_name}
              disabled={!isAdmin}
              onChange={(event) => setForm((prev) => ({ ...prev, variant_a_name: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ab-b-name">Nombre variante B</Label>
            <Input
              id="ab-b-name"
              value={form.variant_b_name}
              disabled={!isAdmin}
              onChange={(event) => setForm((prev) => ({ ...prev, variant_b_name: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ab-a-script">Guion base A</Label>
            <Textarea
              id="ab-a-script"
              rows={3}
              disabled={!isAdmin}
              value={form.variant_a_script}
              onChange={(event) => setForm((prev) => ({ ...prev, variant_a_script: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ab-b-script">Guion base B</Label>
            <Textarea
              id="ab-b-script"
              rows={3}
              disabled={!isAdmin}
              value={form.variant_b_script}
              onChange={(event) => setForm((prev) => ({ ...prev, variant_b_script: event.target.value }))}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" disabled={!isAdmin || saving} onClick={handleSave}>
            {saving ? "Guardando..." : "Guardar configuración A/B"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
