"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  output.setHours(output.getHours() + 1);
  return output;
}

export function NewAppointmentButton() {
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => nextHour(now), [now]);
  const defaultEnd = useMemo(() => new Date(defaultStart.getTime() + 60 * 60 * 1000), [defaultStart]);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(toDateInputValue(defaultStart));
  const [startTime, setStartTime] = useState(toTimeInputValue(defaultStart));
  const [endTime, setEndTime] = useState(toTimeInputValue(defaultEnd));
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setDate(toDateInputValue(defaultStart));
    setStartTime(toTimeInputValue(defaultStart));
    setEndTime(toTimeInputValue(defaultEnd));
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
      setError("El motivo es obligatorio.");
      return;
    }

    const startAt = new Date(`${date}T${startTime}:00`);
    const endAt = new Date(`${date}T${endTime}:00`);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      setError("Fecha u hora inválida.");
      return;
    }

    if (endAt <= startAt) {
      setError("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch("/api/appointments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: reason.trim(),
          notes: reason.trim(),
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          created_by: "staff",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error || "No se pudo crear la cita.");
        return;
      }

      handleClose();
    } catch {
      setError("No se pudo crear la cita.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex justify-end">
        <Button onClick={() => setOpen((prev) => !prev)} variant="default">
          {open ? "Cerrar" : "Nueva cita"}
        </Button>
      </div>

      {open ? (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 rounded-lg border border-border bg-white p-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="appointment-date">Día</Label>
            <Input
              id="appointment-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appointment-start">Hora inicio</Label>
            <Input
              id="appointment-start"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appointment-end">Hora fin</Label>
            <Input
              id="appointment-end"
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appointment-reason">Motivo</Label>
            <Input
              id="appointment-reason"
              type="text"
              placeholder="Ej. Revisión facial"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>

          {error ? <p className="md:col-span-4 text-sm text-rose-600">{error}</p> : null}

          <div className="md:col-span-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Crear cita"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
