export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Lead {
  id: string;
  clinic_id: string;
  full_name: string | null;
  phone: string | null;
  treatment: string | null;
  source: string | null;
  status: string;
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
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
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
  title: string | null;
  start_at: string;
  end_at: string;
  status: "scheduled" | "canceled" | "done";
  notes: string | null;
  gcal_event_id: string | null;
  created_by: "agent" | "staff";
  created_at: string;
}

export interface BusyBlock {
  id: string;
  clinic_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
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
