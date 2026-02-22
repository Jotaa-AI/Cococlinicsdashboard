"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface LeadWhatsappRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  treatment: string | null;
  whatsapp_blocked: boolean;
  whatsapp_blocked_reason: string | null;
  whatsapp_blocked_at: string | null;
}

function leadLabel(lead: LeadWhatsappRow) {
  const name = lead.full_name || "Lead sin nombre";
  const phone = lead.phone || "Sin teléfono";
  return `${name} · ${phone}`;
}

export function WhatsappLeadBlockSettings() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;

  const [leads, setLeads] = useState<LeadWhatsappRow[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("leads")
      .select("id, full_name, phone, treatment, whatsapp_blocked, whatsapp_blocked_reason, whatsapp_blocked_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    const rows = (data || []) as LeadWhatsappRow[];
    setLeads(rows);

    if (!selectedLeadId && rows.length) {
      setSelectedLeadId(rows[0].id);
      setReason(rows[0].whatsapp_blocked_reason || "");
    }

    if (selectedLeadId && !rows.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(rows[0]?.id || "");
      setReason(rows[0]?.whatsapp_blocked_reason || "");
    }

    setLoading(false);
  }, [supabase, clinicId, selectedLeadId]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!clinicId) return;

    const channel = supabase
      .channel("settings-whatsapp-block")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` },
        loadLeads
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, loadLeads]);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) => {
      const name = (lead.full_name || "").toLowerCase();
      const phone = (lead.phone || "").toLowerCase();
      return name.includes(term) || phone.includes(term);
    });
  }, [leads, search]);

  const selectLeads = useMemo(() => {
    if (!selectedLead) return filteredLeads;
    if (filteredLeads.some((lead) => lead.id === selectedLead.id)) return filteredLeads;
    return [selectedLead, ...filteredLeads];
  }, [filteredLeads, selectedLead]);

  const blockedCount = useMemo(() => leads.filter((lead) => lead.whatsapp_blocked).length, [leads]);

  const updateLeadBlock = async (blocked: boolean) => {
    if (!clinicId || !selectedLead) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    const blockReason = (reason || "").trim();
    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("leads")
      .update({
        whatsapp_blocked: blocked,
        whatsapp_blocked_reason: blocked ? blockReason || "Bloqueado manualmente desde settings" : null,
        whatsapp_blocked_at: blocked ? nowIso : null,
        whatsapp_blocked_by_user_id: blocked ? profile?.user_id || null : null,
        updated_at: nowIso,
      })
      .eq("clinic_id", clinicId)
      .eq("id", selectedLead.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await supabase.from("audit_log").insert({
      clinic_id: clinicId,
      entity_type: "lead",
      entity_id: selectedLead.id,
      action: blocked ? "whatsapp_blocked" : "whatsapp_unblocked",
      meta: {
        source: "settings",
        reason: blocked ? blockReason || null : null,
        actor_id: profile?.user_id || null,
      },
    });

    setNotice(blocked ? "WhatsApp bloqueado para este lead." : "WhatsApp desbloqueado para este lead.");
    setSaving(false);
    await loadLeads();
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Control por lead</p>
            <p className="text-lg font-semibold">Bloqueo de conversación WhatsApp</p>
          </div>
          <Badge variant="soft">Bloqueados: {blockedCount}</Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          Selecciona un lead para bloquear o desbloquear el agente de WhatsApp solo para ese contacto.
        </p>

        {loading ? <p className="text-sm text-muted-foreground">Cargando leads...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

        <div className="space-y-1.5">
          <Label htmlFor="lead-search">Buscar lead</Label>
          <Input
            id="lead-search"
            placeholder="Nombre o teléfono"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Lead</Label>
          <Select
            value={selectedLeadId}
            onValueChange={(value) => {
              setSelectedLeadId(value);
              const lead = leads.find((item) => item.id === value);
              setReason(lead?.whatsapp_blocked_reason || "");
              setNotice(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={filteredLeads.length ? "Selecciona un lead" : "Sin leads disponibles"} />
            </SelectTrigger>
            <SelectContent>
              {filteredLeads.length ? (
                selectLeads.slice(0, 200).map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {leadLabel(lead)}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__no_results" disabled>
                  Sin resultados
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {selectedLead ? (
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{selectedLead.full_name || "Lead sin nombre"}</p>
              <Badge variant={selectedLead.whatsapp_blocked ? "warning" : "success"}>
                {selectedLead.whatsapp_blocked ? "WhatsApp bloqueado" : "WhatsApp activo"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">{selectedLead.phone || "Sin teléfono"}</p>
            <p className="text-xs text-muted-foreground">Tratamiento: {selectedLead.treatment || "No especificado"}</p>

            <div className="space-y-1.5">
              <Label htmlFor="block-reason">Motivo del bloqueo</Label>
              <Textarea
                id="block-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej: Lead pidió no ser contactado por WhatsApp"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving || !selectedLead.whatsapp_blocked}
                onClick={() => updateLeadBlock(false)}
              >
                {saving ? "Actualizando..." : "Desbloquear WhatsApp"}
              </Button>
              <Button
                type="button"
                disabled={saving || selectedLead.whatsapp_blocked}
                onClick={() => updateLeadBlock(true)}
              >
                {saving ? "Actualizando..." : "Bloquear WhatsApp"}
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </Card>
  );
}
