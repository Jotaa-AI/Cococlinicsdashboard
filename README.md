# Coco Clinics Dashboard

Dashboard interno para clínica estética con Next.js, Supabase y sincronización con Google Calendar.

## Requisitos
- Node.js 20+
- Proyecto en Supabase (Postgres + Auth + Realtime)
- Credenciales OAuth 2.0 de Google Calendar

## Variables de entorno
Crea `.env.local`:

```bash
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DEFAULT_CLINIC_ID=... # UUID de la clínica
WEBHOOK_SECRET=... # shared secret para n8n
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gcal/callback
GOOGLE_DEFAULT_CALENDAR_ID=primary
GOOGLE_TOKEN_ENCRYPTION_KEY=... # base64 32 bytes
NEXT_PUBLIC_CALL_COST_PER_MIN=1.5 # opcional
NEXT_PUBLIC_GCAL_SYNC_INTERVAL_SEC=120 # opcional (sync automático)
```

Para generar `GOOGLE_TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Base de datos
Ejecuta el SQL en `supabase/schema.sql` en tu proyecto Supabase. Reemplaza el `user_id` del seed por tu usuario real.

Para activar la agenda en bloques de 30 minutos (09:00-19:00) con bloqueo de solapes:

- abre `supabase/migrations/20260208_schedule_slots.sql`
- copia su contenido
- pégalo y ejecútalo en Supabase SQL Editor

Para activar el journey completo de llamadas IA + escalado a WhatsApp:

- abre `supabase/migrations/20260214_lead_journey_pipeline.sql`
- copia su contenido
- pégalo y ejecútalo en Supabase SQL Editor

Para activar el control operativo de agentes (pausa llamadas/WhatsApp + bloqueo por lead):

- abre `supabase/migrations/20260214_agent_runtime_controls.sql`
- copia su contenido
- pégalo y ejecútalo en Supabase SQL Editor

Para guardar nombre y teléfono también dentro de `appointments`:

- abre `supabase/migrations/20260216_appointments_contact_fields.sql`
- copia su contenido
- pégalo y ejecútalo en Supabase SQL Editor
- esta migración deja los campos finales como `appointments.lead_name` y `appointments.lead_phone`

RPCs clave para n8n:

- `rpc_find_nearest_slots(p_clinic_id, p_requested_start, p_window_hours, p_limit, p_timezone)`
- `rpc_book_appointment_slot(p_clinic_id, p_lead_id, p_start_at, p_title, p_notes, p_created_by, p_idempotency_key, p_source)`
- `rpc_transition_lead_stage(p_clinic_id, p_lead_id, p_to_stage_key, p_reason, p_actor_type, p_actor_id, p_meta)`

Comprobaciones útiles para n8n:

- Estado global de agentes:
```sql
select calls_agent_active, whatsapp_agent_active, hitl_mode_active
from agent_runtime_controls
where clinic_id = 'TU_CLINIC_ID';
```
- Bloqueo de WhatsApp por lead:
```sql
select whatsapp_blocked
from leads
where id = 'TU_LEAD_ID'
  and clinic_id = 'TU_CLINIC_ID';
```

## Instalar dependencias
```bash
npm install
```

## Desarrollo
```bash
npm run dev
```

## Webhooks (n8n)
Todos los endpoints exigen header `X-WEBHOOK-SECRET`.

### Lead created
```bash
curl -X POST http://localhost:3000/api/webhooks/lead_created \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "full_name": "Ana López",
    "phone": "+34 600 111 222",
    "treatment": "Láser facial",
    "source": "meta"
  }'
```

### Call started
```bash
curl -X POST http://localhost:3000/api/webhooks/call_started \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "call_id": "retell-123",
    "lead_id": "UUID_DEL_LEAD",
    "started_at": "2025-02-05T10:00:00Z"
  }'
```

### Call ended
```bash
curl -X POST http://localhost:3000/api/webhooks/call_ended \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "call_id": "retell-123",
    "ended_at": "2025-02-05T10:12:00Z",
    "duration": 720,
    "outcome": "appointment_scheduled",
    "summary": "Cita confirmada",
    "transcript": "..."
  }'
```

### Appointment created
```bash
curl -X POST http://localhost:3000/api/webhooks/appointment_created \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "lead_id": "UUID_DEL_LEAD",
    "start_at": "2025-02-06T09:00:00Z",
    "end_at": "2025-02-06T10:00:00Z",
    "export_google": true
  }'
```

## Google Calendar
1. Crea credenciales OAuth 2.0 en Google Cloud Console.
2. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI`.
3. Inicia sesión en el dashboard, ve a `Settings` y conecta el calendario.
4. Usa “Sync now” para importar eventos ocupados.
5. La sincronización automática usa `NEXT_PUBLIC_GCAL_SYNC_INTERVAL_SEC` (por defecto 120s).

## Seed (opcional)
```bash
npm run seed
```

> Nota: el seed requiere `DEFAULT_CLINIC_ID` y `SUPABASE_SERVICE_ROLE_KEY`.
> `npm run seed` limpia primero datos demo previos (`--reset-demo`) y luego inserta un dataset amplio para dashboard, calls, pipeline y agenda.
