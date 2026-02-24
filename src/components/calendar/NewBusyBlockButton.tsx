"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLOSE_HOUR, OPEN_HOUR, SLOT_MINUTES, validateBusyBlockRange } from "@/lib/calendar/slot-rules";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextHour(date: Date) {
  const output = new Date(date);
  output.setMinutes(0, 0, 0);
  const nextHourValue = output.getHours() + 1;
  const safeHour = Math.min(Math.max(nextHourValue, OPEN_HOUR), CLOSE_HOUR - 1);
  output.setHours(safeHour);
  return output;
}

function addMinutesToTime(value: string, minutes: number) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return toTimeInputValue(date);
}

export function NewBusyBlockButton() {
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => nextHour(now), [now]);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(toDateInputValue(defaultStart));
  const [startTime, setStartTime] = useState(toTimeInputValue(defaultStart));
  const [endTime, setEndTime] = useState(addMinutesToTime(toTimeInputValue(defaultStart), SLOT_MINUTES));
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setDate(toDateInputValue(defaultStart));
    setStartTime(toTimeInputValue(defaultStart));
    setEndTime(addMinutesToTime(toTimeInputValue(defaultStart), SLOT_MINUTES));
    setReason("");
    setError(null);
  };

  const handleClose = () => {
    setOpen(false);
    resetForm();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!reason.trim()) {
      setError("El motivo del bloqueo es obligatorio.");
      return;
    }

    const startAt = new Date(`${date}T${startTime}:00`);
    const endAt = new Date(`${date}T${endTime}:00`);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      setError("Fecha u hora invalida.");
      return;
    }

    const slot = validateBusyBlockRange({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    if (!slot.ok) {
      setError(slot.error);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch("/api/appointments/manual-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_type: "busy_block",
          title: reason.trim(),
          reason: reason.trim(),
          notes: reason.trim(),
          start_at: slot.startAt,
          end_at: slot.endAt,
          created_by: "staff",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error || "No se pudo enviar el bloqueo a n8n.");
        return;
      }

      handleClose();
    } catch {
      setError("No se pudo crear el bloqueo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex justify-end">
        <Button onClick={() => setOpen((prev) => !prev)} variant="outline">
          {open ? "Cerrar bloqueo" : "Bloquear hueco"}
        </Button>
      </div>

      {open ? (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 rounded-lg border border-border bg-white p-4 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="block-date">Día</Label>
            <Input id="block-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="block-start">Hora inicio</Label>
            <Input
              id="block-start"
              type="time"
              min={`${String(OPEN_HOUR).padStart(2, "0")}:00`}
              max={`${String(CLOSE_HOUR - 1).padStart(2, "0")}:30`}
              step={1800}
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value);
                if (event.target.value >= endTime) {
                  setEndTime(addMinutesToTime(event.target.value, SLOT_MINUTES));
                }
              }}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="block-end">Hora fin</Label>
            <Input
              id="block-end"
              type="time"
              min={`${String(OPEN_HOUR).padStart(2, "0")}:30`}
              max={`${String(CLOSE_HOUR).padStart(2, "0")}:00`}
              step={1800}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="block-reason">Motivo</Label>
            <Input
              id="block-reason"
              type="text"
              placeholder="Ej. Médico, descanso, reunión..."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>

          {error ? <p className="md:col-span-5 text-sm text-rose-600">{error}</p> : null}
          <p className="md:col-span-5 text-xs text-muted-foreground">
            Solo tramos de {SLOT_MINUTES} minutos entre {OPEN_HOUR}:00 y {CLOSE_HOUR}:00 (lunes a viernes).
          </p>

          <div className="md:col-span-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar bloqueo"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
