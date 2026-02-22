"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CALL_OUTCOME_LABELS } from "@/lib/constants/call-outcomes";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import type { Call } from "@/lib/types";
import { formatDateTimeEs } from "@/lib/utils/dates";

interface CallRow extends Call {
  leads?: { full_name: string | null; treatment: string | null; phone: string | null } | null;
}

export function RecentCallsTable() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [calls, setCalls] = useState<CallRow[]>([]);

  const loadCalls = async () => {
    if (!clinicId) return;
    const { data } = await supabase
      .from("calls")
      .select("id, status, started_at, ended_at, duration_sec, outcome, lead_id, phone, leads(full_name, treatment, phone)")
      .eq("clinic_id", clinicId)
      .eq("status", "ended")
      .order("started_at", { ascending: false })
      .limit(8);

    if (data) {
      const rows = ((data || []) as unknown as CallRow[]).map((row) => {
        const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
        return { ...row, leads: lead || null };
      });
      setCalls(rows);
    }
  };

  useEffect(() => {
    loadCalls();
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel("recent-calls")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `clinic_id=eq.${clinicId}` },
        loadCalls
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clinicId]);

  return (
    <Table className="min-w-[680px]">
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Lead</TableHead>
          <TableHead>Tratamiento</TableHead>
          <TableHead>Duración</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.map((call) => {
          const callDate = call.ended_at || call.started_at;

          return (
            <TableRow key={call.id}>
              <TableCell>
                {formatDateTimeEs(callDate)}
              </TableCell>
              <TableCell>{call.leads?.full_name || call.leads?.phone || call.phone || "Lead"}</TableCell>
              <TableCell>{call.leads?.treatment || "—"}</TableCell>
              <TableCell>{call.duration_sec ? `${Math.round(call.duration_sec / 60)} min` : "—"}</TableCell>
              <TableCell>
                <Badge variant={call.outcome === "appointment_scheduled" ? "success" : "soft"}>
                  {call.outcome && call.outcome in CALL_OUTCOME_LABELS
                    ? CALL_OUTCOME_LABELS[call.outcome as keyof typeof CALL_OUTCOME_LABELS]
                    : call.outcome || "pendiente"}
                </Badge>
              </TableCell>
              <TableCell>
                <Link className="text-sm font-medium text-primary" href={`/calls/${call.id}`}>
                  Ver detalle
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
        {!calls.length ? (
          <TableRow>
            <TableCell colSpan={6} className="text-sm text-muted-foreground">
              Sin llamadas finalizadas todavía.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
