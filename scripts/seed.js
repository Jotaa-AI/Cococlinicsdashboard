const { createClient } = require("@supabase/supabase-js");
const { addDays, addMinutes, subDays, subMinutes } = require("date-fns");
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clinicId = process.env.DEFAULT_CLINIC_ID;

if (!supabaseUrl || !serviceRoleKey || !clinicId) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEFAULT_CLINIC_ID");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RESET_DEMO = process.argv.includes("--reset-demo") || process.env.SEED_RESET_DEMO === "true";
const seedTag = `seed-${Date.now()}`;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedPick(weightedItems) {
  const total = weightedItems.reduce((acc, item) => acc + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of weightedItems) {
    cursor -= item.weight;
    if (cursor <= 0) return item.value;
  }
  return weightedItems[weightedItems.length - 1].value;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function composeDate(dayOffset, hour, minute) {
  const base = addDays(new Date(), dayOffset);
  base.setHours(hour, minute, 0, 0);
  return base;
}

async function assertClinic() {
  const { data, error } = await supabase.from("clinics").select("id").eq("id", clinicId).maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`Clinic ${clinicId} not found. Configure DEFAULT_CLINIC_ID correctly.`);
  }
}

async function getAnyProfileUserId() {
  const { data } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clinic_id", clinicId)
    .limit(1)
    .maybeSingle();
  return data?.user_id || null;
}

async function resetDemoData() {
  const { data: demoLeads } = await supabase
    .from("leads")
    .select("id")
    .eq("clinic_id", clinicId)
    .ilike("full_name", "Demo %");

  const leadIds = (demoLeads || []).map((row) => row.id);

  if (leadIds.length) {
    await supabase.from("calls").delete().eq("clinic_id", clinicId).in("lead_id", leadIds);
    await supabase.from("appointments").delete().eq("clinic_id", clinicId).in("lead_id", leadIds);
    await supabase.from("audit_log").delete().eq("clinic_id", clinicId).in("entity_id", leadIds);
    await supabase.from("leads").delete().eq("clinic_id", clinicId).in("id", leadIds);
  }

  await supabase.from("calls").delete().eq("clinic_id", clinicId).ilike("retell_call_id", "demo-%");
  await supabase.from("appointments").delete().eq("clinic_id", clinicId).ilike("title", "[DEMO]%");
  await supabase.from("busy_blocks").delete().eq("clinic_id", clinicId).ilike("reason", "[DEMO]%");
  await supabase.from("calendar_events").delete().eq("clinic_id", clinicId).ilike("title", "[DEMO]%");
  await supabase.from("audit_log").delete().eq("clinic_id", clinicId).contains("meta", { seed: "demo" });
}

async function ensureSystemState() {
  await supabase.from("system_state").upsert(
    {
      clinic_id: clinicId,
      current_call_retell_id: null,
      current_call_lead_id: null,
      current_call_started_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );
}

async function ensureAgentRuntimeControls() {
  await supabase.from("agent_runtime_controls").upsert(
    {
      clinic_id: clinicId,
      calls_agent_active: true,
      whatsapp_agent_active: true,
      hitl_mode_active: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );
}

async function run() {
  await assertClinic();
  await ensureSystemState();
  await ensureAgentRuntimeControls();

  if (RESET_DEMO) {
    console.log("Resetting existing demo data...");
    await resetDemoData();
  }

  const createdByUserId = await getAnyProfileUserId();

  const firstNames = [
    "Sofia", "Martina", "Lucia", "Valentina", "Paula", "Daniela", "Alba", "Andrea", "Irene", "Marta",
    "Laura", "Alicia", "Natalia", "Elena", "Sara", "Julia", "Camila", "Noa", "Claudia", "Nuria"
  ];

  const lastNames = [
    "Lopez", "Garcia", "Martinez", "Sanchez", "Gomez", "Diaz", "Ruiz", "Alonso", "Navarro", "Ortega",
    "Ramos", "Torres", "Vega", "Molina", "Herrera", "Serrano", "Castro", "Iglesias", "Pascual", "Fuentes"
  ];

  const treatments = [
    "Láser facial", "Botox", "Relleno de labios", "Hidratación profunda", "Peeling químico", "Depilación láser",
    "Radiofrecuencia", "Mesoterapia", "Lifting sin cirugía", "Tratamiento antimanchas"
  ];

  const leadStages = [
    { value: "new_lead", weight: 14 },
    { value: "first_call_in_progress", weight: 10 },
    { value: "no_answer_first_call", weight: 10 },
    { value: "second_call_scheduled", weight: 10 },
    { value: "second_call_in_progress", weight: 8 },
    { value: "no_answer_second_call", weight: 8 },
    { value: "contacting_whatsapp", weight: 10 },
    { value: "whatsapp_conversation_active", weight: 10 },
    { value: "whatsapp_followup_pending", weight: 7 },
    { value: "whatsapp_failed_team_review", weight: 5 },
    { value: "visit_scheduled", weight: 5 },
    { value: "not_interested", weight: 3 },
  ];

  const legacyStatusFromStage = {
    new_lead: "new",
    first_call_in_progress: "call_done",
    no_answer_first_call: "no_response",
    second_call_scheduled: "no_response",
    second_call_in_progress: "no_response",
    no_answer_second_call: "no_response",
    contacting_whatsapp: "whatsapp_sent",
    whatsapp_conversation_active: "contacted",
    whatsapp_followup_pending: "whatsapp_sent",
    whatsapp_failed_team_review: "no_response",
    visit_scheduled: "visit_scheduled",
    not_interested: "not_interested",
  };

  const callOutcomes = [
    { value: "contacted", weight: 30 },
    { value: "no_response", weight: 25 },
    { value: "not_interested", weight: 10 },
    { value: "appointment_proposed", weight: 20 },
    { value: "appointment_scheduled", weight: 15 },
  ];

  const leadRows = [];
  const basePhone = 640000000 + randInt(1000, 9000);

  for (let i = 0; i < 56; i += 1) {
    const name = `${pick(firstNames)} ${pick(lastNames)}`;
    const createdAt = subDays(new Date(), randInt(0, 50));
    createdAt.setHours(randInt(9, 20), randInt(0, 59), 0, 0);

    const stageKey = weightedPick(leadStages);
    const whatsappBlocked = Math.random() < 0.08;
    leadRows.push({
      clinic_id: clinicId,
      full_name: `Demo ${name}`,
      phone: `+34${basePhone + i}`,
      treatment: pick(treatments),
      source: "meta",
      stage_key: stageKey,
      status: legacyStatusFromStage[stageKey],
      whatsapp_blocked: whatsappBlocked,
      whatsapp_blocked_reason: whatsappBlocked ? "Bloqueado manualmente (demo)" : null,
      whatsapp_blocked_at: whatsappBlocked ? new Date().toISOString() : null,
      whatsapp_blocked_by_user_id: whatsappBlocked ? createdByUserId : null,
      created_at: createdAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const insertedLeads = [];
  for (const group of chunk(leadRows, 40)) {
    const { data, error } = await supabase.from("leads").insert(group).select("id, full_name, phone, treatment, created_at");
    if (error) throw error;
    insertedLeads.push(...(data || []));
  }

  const calls = [];
  let counter = 0;

  for (const lead of insertedLeads) {
    const callQty = randInt(0, 2);
    for (let i = 0; i < callQty; i += 1) {
      const startAt = addMinutes(new Date(lead.created_at), randInt(30, 60 * 24 * 10));
      const safeStart = startAt > subMinutes(new Date(), 30) ? subMinutes(new Date(), randInt(90, 240)) : startAt;
      const durationSec = randInt(80, 1100);
      const endedAt = new Date(safeStart.getTime() + durationSec * 1000);
      const outcome = weightedPick(callOutcomes);

      calls.push({
        clinic_id: clinicId,
        retell_call_id: `demo-call-${seedTag}-${counter}`,
        lead_id: lead.id,
        phone: lead.phone,
        status: "ended",
        started_at: safeStart.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_sec: durationSec,
        outcome,
        transcript: `Transcripción DEMO #${counter}. Conversación sobre ${lead.treatment}.`,
        summary: `Resumen DEMO: resultado ${outcome}.`,
        extracted: {
          treatment: lead.treatment,
          intent: outcome === "appointment_scheduled" ? "alta" : "media",
          objections: outcome === "not_interested" ? ["precio"] : [],
          seed: "demo",
        },
        recording_url: `https://example.com/recordings/${seedTag}-${counter}.mp3`,
        created_at: safeStart.toISOString(),
      });
      counter += 1;
    }
  }

  const liveLead = insertedLeads[randInt(0, insertedLeads.length - 1)];
  const liveStartAt = subMinutes(new Date(), randInt(2, 14));
  const liveRetellId = `demo-live-${seedTag}`;

  calls.push({
    clinic_id: clinicId,
    retell_call_id: liveRetellId,
    lead_id: liveLead.id,
    phone: liveLead.phone,
    status: "in_progress",
    started_at: liveStartAt.toISOString(),
    created_at: liveStartAt.toISOString(),
  });

  for (const group of chunk(calls, 80)) {
    const { error } = await supabase.from("calls").insert(group);
    if (error) throw error;
  }

  const appointments = [];
  for (let i = 0; i < 24; i += 1) {
    const lead = insertedLeads[randInt(0, insertedLeads.length - 1)];
    const day = randInt(0, 45);
    const hour = randInt(9, 18);
    const minute = pick([0, 30]);
    const startAt = composeDate(day, hour, minute);
    const endAt = addMinutes(startAt, 30);

    appointments.push({
      clinic_id: clinicId,
      lead_id: lead.id,
      title: `[DEMO] ${lead.treatment}`,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: "scheduled",
      notes: `[DEMO] ${lead.full_name} - primera valoración`,
      created_by: pick(["agent", "staff"]),
      created_at: subDays(startAt, randInt(1, 5)).toISOString(),
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const lead = insertedLeads[randInt(0, insertedLeads.length - 1)];
    const day = randInt(-30, -1);
    const hour = randInt(9, 18);
    const startAt = composeDate(day, hour, pick([0, 30]));
    const endAt = addMinutes(startAt, 30);

    appointments.push({
      clinic_id: clinicId,
      lead_id: lead.id,
      title: `[DEMO] Seguimiento ${lead.treatment}`,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: pick(["done", "canceled"]),
      notes: `[DEMO] seguimiento histórico`,
      created_by: "staff",
      created_at: subDays(startAt, randInt(1, 8)).toISOString(),
    });
  }

  for (const group of chunk(appointments, 60)) {
    const { error } = await supabase.from("appointments").insert(group);
    if (error) throw error;
  }

  const busyBlocks = [];
  const blockReasons = [
    "[DEMO] Reunión equipo",
    "[DEMO] Formación interna",
    "[DEMO] Pausa clínica",
    "[DEMO] Mantenimiento cabina",
  ];

  for (let i = 0; i < 12; i += 1) {
    const day = randInt(0, 25);
    const hour = randInt(9, 18);
    const startAt = composeDate(day, hour, pick([0, 30]));
    const endAt = addMinutes(startAt, 30);

    busyBlocks.push({
      clinic_id: clinicId,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      reason: pick(blockReasons),
      created_by_user_id: createdByUserId,
      created_at: subDays(startAt, 1).toISOString(),
    });
  }

  const { error: busyError } = await supabase.from("busy_blocks").insert(busyBlocks);
  if (busyError) throw busyError;

  const externalEvents = [];
  for (let i = 0; i < 16; i += 1) {
    const day = randInt(0, 55);
    const hour = randInt(8, 20);
    const startAt = composeDate(day, hour, pick([0, 30]));
    const endAt = addMinutes(startAt, pick([30, 60, 120]));

    externalEvents.push({
      clinic_id: clinicId,
      source: "google",
      gcal_event_id: `demo-gcal-${seedTag}-${i}`,
      title: `[DEMO] Evento Google ${i + 1}`,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: "confirmed",
      updated_at: new Date().toISOString(),
    });
  }

  const { error: gcalError } = await supabase
    .from("calendar_events")
    .upsert(externalEvents, { onConflict: "clinic_id,gcal_event_id" });
  if (gcalError) throw gcalError;

  const auditRows = insertedLeads.slice(0, 40).map((lead, index) => ({
    clinic_id: clinicId,
    entity_type: "lead",
    entity_id: lead.id,
    action: "status_changed",
    meta: {
      seed: "demo",
      from: pick(["new", "whatsapp_sent", "call_done"]),
      to: pick(["contacted", "visit_scheduled", "no_response"]),
      index,
    },
    created_at: subDays(new Date(), randInt(0, 20)).toISOString(),
  }));

  const { error: auditError } = await supabase.from("audit_log").insert(auditRows);
  if (auditError) throw auditError;

  const { error: systemStateError } = await supabase.from("system_state").upsert(
    {
      clinic_id: clinicId,
      current_call_retell_id: liveRetellId,
      current_call_lead_id: liveLead.id,
      current_call_started_at: liveStartAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );
  if (systemStateError) throw systemStateError;

  console.log("Seed completed with demo data:");
  console.log(`- Leads: ${insertedLeads.length}`);
  console.log(`- Calls: ${calls.length}`);
  console.log(`- Appointments: ${appointments.length}`);
  console.log(`- Busy blocks: ${busyBlocks.length}`);
  console.log(`- Google busy cache events: ${externalEvents.length}`);
  console.log(`- Audit log rows: ${auditRows.length}`);
  console.log("Tip: run with --reset-demo to clean old demo rows first.");
}

run().catch((error) => {
  console.error("Seed failed:", error.message || error);
  process.exit(1);
});
