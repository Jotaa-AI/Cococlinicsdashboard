type SupabaseLike = any;

interface PersistAppointmentInput {
  supabase: SupabaseLike;
  appointmentId?: string | null;
  payload: Record<string, any>;
  select?: string;
}

function extractMissingColumn(message?: string | null) {
  if (!message) return null;
  const quotedMatch = message.match(/'([^']+)' column/);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const relationMatch = message.match(/column \"([^\"]+)\" of relation/);
  if (relationMatch?.[1]) return relationMatch[1];
  const schemaMatch = message.match(/column (?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+) does not exist/);
  if (schemaMatch?.[1]) return schemaMatch[1];
  const simpleMatch = message.match(/column \"?([a-zA-Z0-9_]+)\"? does not exist/);
  if (simpleMatch?.[1]) return simpleMatch[1];
  return null;
}

export async function persistAppointmentWithCompat(input: PersistAppointmentInput) {
  const { supabase, appointmentId = null, select = "*"} = input;
  const payload = { ...input.payload };

  for (let attempt = 0; attempt < 8; attempt++) {
    const query = appointmentId
      ? supabase.from("appointments").update(payload).eq("id", appointmentId)
      : supabase.from("appointments").insert(payload);

    const { data, error } = await query.select(select).single();

    if (!error && data) {
      return { data, error: null, sanitizedPayload: payload };
    }

    const missingColumn = extractMissingColumn(error?.message);
    if (!missingColumn || !(missingColumn in payload)) {
      return { data: null, error, sanitizedPayload: payload };
    }

    delete payload[missingColumn];
  }

  return {
    data: null,
    error: { message: "No se pudo guardar la cita por incompatibilidad de esquema." },
    sanitizedPayload: payload,
  };
}
