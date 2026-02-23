"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLOSE_HOUR, OPEN_HOUR, SLOT_MINUTES, validateSlotRange } from "@/lib/calendar/slot-rules";

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

export function NewAppointmentButton() {
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => nextHour(now), [now]);

  const [open, setOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("+34");
  const [date, setDate] = useState(toDateInputValue(defaultStart));
  const [startTime, setStartTime] = useState(toTimeInputValue(defaultStart));
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endTime = useMemo(() => addMinutesToTime(startTime, SLOT_MINUTES), [startTime]);

  const resetForm = () => {
    setPatientName("");
    setPatientPhone("+34");
    setDate(toDateInputValue(defaultStart));
    setStartTime(toTimeInputValue(defaultStart));
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

    if (!patientName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }

    if (!/^\+34\d{9}$/.test(patientPhone)) {
      setError("El teléfono debe tener formato +34XXXXXXXXX.");
      return;
    }

    const startAt = new Date(`${date}T${startTime}:00`);
    if (Number.isNaN(startAt.getTime())) {
      setError("Fecha u hora invalida.");
      return;
    }

    const endAt = new Date(startAt.getTime() + SLOT_MINUTES * 60 * 1000);

    const slot = validateSlotRange({
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
          title: reason.trim(),
          notes: reason.trim(),
          lead_name: patientName.trim(),
          lead_phone: patientPhone,
          start_at: slot.startAt,
          end_at: slot.endAt,
          created_by: "staff",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error || "No se pudo enviar la cita a n8n.");
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
        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 rounded-lg border border-border bg-white p-4 md:grid-cols-6">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="appointment-patient-name">Nombre</Label>
            <Input
              id="appointment-patient-name"
              type="text"
              placeholder="Nombre del lead"
              value={patientName}
              onChange={(event) => setPatientName(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="appointment-patient-phone">Teléfono</Label>
            <Input
              id="appointment-patient-phone"
              type="tel"
              placeholder="+34600111222"
              value={patientPhone}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "");
                if (!digits) {
                  setPatientPhone("+34");
                  return;
                }

                if (digits.startsWith("34")) {
                  setPatientPhone(`+${digits.slice(0, 11)}`);
                  return;
                }

                setPatientPhone(`+34${digits.slice(0, 9)}`);
              }}
              required
            />
          </div>

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
              min={`${String(OPEN_HOUR).padStart(2, "0")}:00`}
              max={`${String(CLOSE_HOUR - 1).padStart(2, "0")}:30`}
              step={1800}
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
              step={1800}
              disabled
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

          {error ? <p className="md:col-span-6 text-sm text-rose-600">{error}</p> : null}
          <p className="md:col-span-6 text-xs text-muted-foreground">
            Solo bloques de {SLOT_MINUTES} minutos entre {OPEN_HOUR}:00 y {CLOSE_HOUR}:00.
          </p>

          <div className="md:col-span-6 flex justify-end gap-2">
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
