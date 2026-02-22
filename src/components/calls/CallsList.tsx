"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/supabase/useProfile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS } from "@/lib/constants/call-outcomes";
import { formatDateTimeEs } from "@/lib/utils/dates";

interface CallRow {
  id: string;
  status: "in_progress" | "ended";
  started_at: string | null;
  ended_at: string | null;
  phone: string | null;
  duration_sec: number | null;
  outcome: string | null;
  agent_id: string | null;
  leads?: { full_name: string | null; treatment: string | null; phone: string | null } | null;
}

const DATE_OPTIONS = [
  { label: "Últimos 7 días", value: "7" },
  { label: "Últimos 30 días", value: "30" },
  { label: "Todo", value: "all" },
];

export function CallsList() {
  const supabase = createSupabaseBrowserClient();
  const { profile } = useProfile();
  const clinicId = profile?.clinic_id;
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [dateRange, setDateRange] = useState("7");
  const [outcome, setOutcome] = useState("all");
  const [search, setSearch] = useState("");

  const startDate = useMemo(() => {
    if (dateRange === "all") return null;
    const days = Number(dateRange);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  }, [dateRange]);

  const loadCalls = async () => {
    if (!clinicId) return;
    let query = supabase
      .from("calls")
      .select("id, status, started_at, ended_at, phone, duration_sec, outcome, agent_id, leads(full_name, treatment, phone)")
      .eq("clinic_id", clinicId)
      .order("started_at", { ascending: false });

    if (startDate) {
      query = query.gte("started_at", startDate);
    }

    if (outcome !== "all") {
      query = query.eq("outcome", outcome);
    }

    const { data } = await query;
    let rows = ((data || []) as unknown as CallRow[]).map((row) => {
      const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
      return { ...row, leads: lead || null };
    });

    if (search.trim()) {
      const term = search.toLowerCase();
      rows = rows.filter((row) => {
        const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
        return `${lead?.full_name || ""} ${lead?.treatment || ""}`.toLowerCase().includes(term);
      });
    }

    setCalls(rows);
  };

  useEffect(() => {
    loadCalls();
  }, [clinicId, dateRange, outcome, search]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel("calls-list")
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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Rango" />
          </SelectTrigger>
          <SelectContent>
            {DATE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los outcomes</SelectItem>
            {CALL_OUTCOMES.map((item) => (
              <SelectItem key={item} value={item}>
                {CALL_OUTCOME_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-full sm:w-64"
          placeholder="Buscar por lead o tratamiento"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Table className="min-w-[720px]">
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
          {calls.map((call) => (
            <TableRow key={call.id}>
              <TableCell>
                {formatDateTimeEs(call.started_at)}
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
