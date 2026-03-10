interface ResolveLeadInput {
  supabase: any;
  clinicId: string;
  leadId?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  treatment?: string | null;
  source?: string | null;
}

interface ResolveLeadResult {
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
}

export function normalizeEsPhone(rawPhone?: string | null) {
  if (!rawPhone) return null;
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("34")) digits = digits.slice(2);

  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

async function getLeadById(supabase: any, clinicId: string, leadId: string) {
  const { data } = await supabase
    .from("leads")
    .select("id, full_name, phone")
    .eq("clinic_id", clinicId)
    .eq("id", leadId)
    .maybeSingle();

  return data || null;
}

async function getLeadByPhone(supabase: any, clinicId: string, phone: string) {
  const { data } = await supabase
    .from("leads")
    .select("id, full_name, phone")
    .eq("clinic_id", clinicId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

async function getLeadByName(supabase: any, clinicId: string, name: string) {
  const { data } = await supabase
    .from("leads")
    .select("id, full_name, phone")
    .eq("clinic_id", clinicId)
    .eq("full_name", name)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

export async function resolveLeadForAppointment(input: ResolveLeadInput): Promise<ResolveLeadResult> {
  const { supabase, clinicId, leadId: initialLeadId, treatment = null, source = "manual" } = input;
  const inputLeadName = input.leadName?.trim() || null;
  const normalizedPhone = normalizeEsPhone(input.leadPhone);

  let leadId = initialLeadId || null;
  let leadName = inputLeadName;
  let leadPhone = normalizedPhone;
  let matchedLead: { id: string; full_name: string | null; phone: string | null } | null = null;

  if (leadId) {
    matchedLead = await getLeadById(supabase, clinicId, leadId);
  }

  if (!matchedLead && leadPhone) {
    matchedLead = await getLeadByPhone(supabase, clinicId, leadPhone);
    leadId = matchedLead?.id || leadId;
  }

  if (!matchedLead && leadName) {
    matchedLead = await getLeadByName(supabase, clinicId, leadName);
    leadId = matchedLead?.id || leadId;
  }

  if (!matchedLead && leadName && leadPhone) {
    const { data: upsertedLead, error } = await supabase
      .from("leads")
      .upsert(
        {
          clinic_id: clinicId,
          full_name: leadName,
          phone: leadPhone,
          source,
          treatment,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id,phone" }
      )
      .select("id, full_name, phone")
      .single();

    if (error || !upsertedLead?.id) {
      throw new Error(error?.message || "No se pudo crear o localizar el lead.");
    }

    matchedLead = upsertedLead;
    leadId = upsertedLead.id;
  }

  if (matchedLead?.id) {
    leadId = matchedLead.id;
    leadName = leadName || matchedLead.full_name || null;
    leadPhone = leadPhone || matchedLead.phone || null;

    if (inputLeadName || normalizedPhone || treatment) {
      await supabase
        .from("leads")
        .update({
          full_name: inputLeadName || matchedLead.full_name || null,
          phone: normalizedPhone || matchedLead.phone || null,
          treatment,
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", clinicId)
        .eq("id", matchedLead.id);
    }
  }

  return {
    leadId,
    leadName,
    leadPhone,
  };
}
