import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateSlotRange } from "@/lib/calendar/slot-rules";

function normalizeEsPhone(rawPhone: string) {
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("34")) digits = digits.slice(2);

  if (!/^\d{9}$/.test(digits)) {
    return null;
  }

  return `+34${digits}`;
}

function getWebhookUrl() {
  return (
    process.env.N8N_MANUAL_BOOKING_WEBHOOK_URL ||
    "https://personal-n8n.brtnrr.easypanel.host/webhook/agendamiento%20manual"
  );
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("user_id", user.id)
    .single();

  if (!profile?.clinic_id) {
    return NextResponse.json({ error: "No clinic" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  const leadName = typeof body?.lead_name === "string" ? body.lead_name.trim() : "";
  const rawPhone = typeof body?.lead_phone === "string" ? body.lead_phone : "";
  const leadPhone = normalizeEsPhone(rawPhone);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (!leadName || !leadPhone || !title || !body?.start_at) {
    return NextResponse.json(
      { error: "lead_name, lead_phone, title y start_at son obligatorios." },
      { status: 400 }
    );
  }

  const slot = validateSlotRange({
    startAt: String(body.start_at),
    endAt: body.end_at ? String(body.end_at) : null,
  });

  if (!slot.ok) {
    return NextResponse.json({ error: slot.error }, { status: 400 });
  }

  const payload = {
    clinic_id: profile.clinic_id,
    lead_name: leadName,
    lead_phone: leadPhone,
    title,
    notes: notes || title,
    start_at: slot.startAt,
    end_at: slot.endAt,
    created_by: "staff",
    source_channel: "staff",
    source: "agenda_manual",
    requested_by_user_id: user.id,
    requested_at: new Date().toISOString(),
  };

  const webhookUrl = getWebhookUrl();

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con n8n." }, { status: 502 });
  }

  const text = await response.text();
  let webhookResponse: unknown = null;
  try {
    webhookResponse = text ? JSON.parse(text) : null;
  } catch {
    webhookResponse = text || null;
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "El webhook de n8n devolvió error.",
        status: response.status,
        details: webhookResponse,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, forwarded: true, webhook_response: webhookResponse });
}
