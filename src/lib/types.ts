export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Lead {
  id: string;
  clinic_id: string;
  full_name: string | null;
  phone: string | null;
  treatment: string | null;
  source: string | null;
  status: string;
  converted_to_client: boolean;
  converted_value_eur: number | string | null;
  converted_service_name: string | null;
  converted_at: string | null;
  post_visit_outcome_reason: string | null;
  contacto_futuro: string | null;
  whatsapp_blocked: boolean;
  whatsapp_blocked_reason: string | null;
  whatsapp_blocked_at: string | null;
  whatsapp_blocked_by_user_id: string | null;
  stage_key: string | null;
  ab_variant: "A" | "B" | null;
  last_contact_at: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Call {
  id: string;
  clinic_id: string;
  retell_call_id: string;
  lead_id: string | null;
  phone: string | null;
  agent_id: string | null;
  status: "in_progress" | "ended";
  attempt_no: number;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  call_cost_eur: number | string | null;
  outcome: string | null;
  transcript: string | null;
  summary: string | null;
  extracted: Json | null;
  recording_url: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  title: string | null;
  start_at: string;
  end_at: string;
  status: "scheduled" | "canceled" | "done";
  reminder_2d_status: "no_enviado" | "enviado";
  reminder_1d_status: "no_enviado" | "enviado";
  reminder_1h_status: "no_enviado" | "enviado";
  notes: string | null;
  gcal_event_id: string | null;
  source_channel: "call_ai" | "whatsapp_ai" | "staff";
  created_by: "agent" | "staff";
  created_at: string;
}

export interface BusyBlock {
  id: string;
  clinic_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  cal_block_group_id: string | null;
  cal_booking_uids: Json | null;
  created_at: string;
  created_by_user_id: string | null;
}

export interface CalendarEvent {
  id: string;
  clinic_id: string;
  source: "google";
  gcal_event_id: string;
  title: string | null;
  start_at: string;
  end_at: string;
  status: string | null;
  updated_at: string;
}

export interface SystemState {
  id: string;
  clinic_id: string;
  current_call_retell_id: string | null;
  current_call_lead_id: string | null;
  current_call_started_at: string | null;
  updated_at: string;
}

export interface Profile {
  user_id: string;
  clinic_id: string;
  role: "admin" | "staff";
  full_name: string | null;
}

export interface AgentRuntimeControls {
  clinic_id: string;
  calls_agent_active: boolean;
  whatsapp_agent_active: boolean;
  hitl_mode_active: boolean;
  updated_by_user_id: string | null;
  updated_at: string;
  created_at: string;
}

export interface LeadAbTestSettings {
  id: string;
  clinic_id: string;
  is_enabled: boolean;
  variant_a_weight: number;
  variant_a_name: string;
  variant_b_name: string;
  variant_a_script: string | null;
  variant_b_script: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadAbMetricsRow {
  variant: "A" | "B";
  assigned_count: number;
  contacted_count: number;
  booked_count: number;
  conversion_pct: number;
}

export interface LeadStageCatalog {
  stage_key: string;
  pipeline_key: string;
  pipeline_label_es: string;
  label_es: string;
  description_es: string | null;
  pipeline_order: number;
  order_index: number;
  is_terminal: boolean;
  is_active: boolean;
}

export interface LeadStageHistory {
  id: string;
  clinic_id: string;
  lead_id: string;
  from_stage_key: string | null;
  to_stage_key: string;
  reason: string | null;
  actor_type: string;
  actor_id: string | null;
  meta: Json;
  created_at: string;
}
