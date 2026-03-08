# Coco Clinics Dashboard

Dashboard interno para clínica estética con Next.js y Supabase. La agenda operativa vive en Supabase; n8n y Retell escriben sobre Supabase mediante endpoints y webhooks de la app.

## Requisitos
- Node.js 20+
- Proyecto en Supabase (Postgres + Auth + Realtime)
- n8n para automatizaciones opcionales (Retell, WhatsApp de doctora, recordatorios)

## Variables de entorno
Crea `/Users/jotajimenez/PROYECTOS/Vibe Coding/Codex/Dashboard Coco Clinics/.env.local` con:

```bash
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DEFAULT_CLINIC_ID=... # UUID de la clínica
WEBHOOK_SECRET=... # secreto compartido para n8n / Retell / webhooks
NEXT_PUBLIC_CALL_COST_PER_MIN=1.5 # opcional
```

## Base de datos
Ejecuta `/Users/jotajimenez/PROYECTOS/Vibe Coding/Codex/Dashboard Coco Clinics/supabase/schema.sql` en tu proyecto Supabase. Sustituye el `user_id` del seed por tu usuario real.

Migraciones útiles:
- `/Users/jotajimenez/PROYECTOS/Vibe Coding/Codex/Dashboard Coco Clinics/supabase/migrations/20260208_schedule_slots.sql`
  - activa bloques de 30 minutos, horario L-V 09:00-19:00 y validación de solapes.
- `/Users/jotajimenez/PROYECTOS/Vibe Coding/Codex/Dashboard Coco Clinics/supabase/migrations/20260214_lead_journey_pipeline.sql`
  - journey completo de llamadas IA y pipeline.
- `/Users/jotajimenez/PROYECTOS/Vibe Coding/Codex/Dashboard Coco Clinics/supabase/migrations/20260214_agent_runtime_controls.sql`
  - pausa operativa de agentes y human-in-the-loop.
- `/Users/jotajimenez/PROYECTOS/Vibe Coding/Codex/Dashboard Coco Clinics/supabase/migrations/20260216_appointments_contact_fields.sql`
  - añade `appointments.lead_name` y `appointments.lead_phone`.

RPCs disponibles para n8n:
- `rpc_find_nearest_slots(p_clinic_id, p_requested_start, p_window_hours, p_limit, p_timezone)`
- `rpc_book_appointment_slot(p_clinic_id, p_lead_id, p_start_at, p_title, p_notes, p_created_by, p_idempotency_key, p_source)`
- `rpc_transition_lead_stage(p_clinic_id, p_lead_id, p_to_stage_key, p_reason, p_actor_type, p_actor_id, p_meta)`

Comprobaciones útiles para n8n:

```sql
select calls_agent_active, whatsapp_agent_active, hitl_mode_active
from agent_runtime_controls
where clinic_id = 'TU_CLINIC_ID';
```

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

## Agenda operativa
La agenda de la app (`/calendar`) lee directamente estas tablas de Supabase:
- `appointments`
- `busy_blocks`

La app permite:
- crear citas manuales
- bloquear tramos manualmente
- ver agenda en calendario mensual o semanal

Reglas de agenda:
- lunes a viernes
- 09:00 a 19:00
- bloques de 30 minutos
- sin solapes entre citas y bloqueos activos

## Webhooks para n8n
Todos los endpoints exigen `X-WEBHOOK-SECRET` o `Authorization: Bearer <WEBHOOK_SECRET>`.

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

### Appointment created or updated
n8n puede usar este endpoint para crear o actualizar citas en Supabase.

```bash
curl -X POST http://localhost:3000/api/webhooks/appointment_created \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "appointment_id": "UUID_OPCIONAL",
    "lead_name": "Paula Navarro",
    "lead_phone": "+34600111222",
    "title": "Valoración gratuita",
    "treatment": "Firmeza facial",
    "start_at": "2026-03-10T10:00:00Z",
    "end_at": "2026-03-10T10:30:00Z",
    "status": "scheduled",
    "source_channel": "call_ai"
  }'
```

### Busy block sync
n8n puede crear, actualizar o cancelar bloqueos en Supabase.

Crear o actualizar:
```bash
curl -X POST http://localhost:3000/api/webhooks/busy_block_sync \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "busy_block_id": "UUID_OPCIONAL",
    "start_at": "2026-03-10T09:00:00Z",
    "end_at": "2026-03-10T11:00:00Z",
    "reason": "Bloqueo doctora",
    "status": "active",
    "source": "doctor_whatsapp",
    "external_reference": "doctor-whatsapp-20260310-0900"
  }'
```

Cancelar:
```bash
curl -X POST http://localhost:3000/api/webhooks/busy_block_sync \
  -H "Content-Type: application/json" \
  -H "X-WEBHOOK-SECRET: $WEBHOOK_SECRET" \
  -d '{
    "busy_block_id": "UUID_DEL_BLOQUEO",
    "status": "canceled"
  }'
```

## Endpoints directos para Retell
Si prefieres saltarte n8n para la reserva síncrona, la app expone estos endpoints:

### Buscar disponibilidad
```text
POST https://TU_DOMINIO/api/retell/check-availability
```

Body:
```json
{
  "appointment_requested_ts": "2026-03-10T11:00:00+01:00",
  "time_zone": "Europe/Madrid"
}
```

### Agendar cita
```text
POST https://TU_DOMINIO/api/retell/book-appointment
```

Body:
```json
{
  "start_at": "2026-03-10T11:00:00+01:00",
  "lead_name": "Paula Navarro",
  "lead_phone": "+34600111222",
  "treatment": "Radiofrecuencia facial",
  "notes": "Primera valoración gratuita",
  "source_channel": "call_ai"
}
```

### Cancelar próxima cita futura por teléfono
```text
POST https://TU_DOMINIO/api/retell/cancel-appointment
```

Body:
```json
{
  "lead_phone": "+34600111222",
  "reason": "El paciente solicita cancelar la cita"
}
```

## Operativa recomendada con n8n
- Retell puede consultar y reservar directo contra la app, o bien pasar por n8n si necesitas lógica adicional.
- El agente de WhatsApp de la doctora debería escribir bloqueos y cancelaciones en Supabase usando los webhooks anteriores.
- La app solo lee Supabase, por lo que dashboard, pipeline, inbound y reporting usan una única fuente de verdad.

## Seed (opcional)
```bash
npm run seed
```

Notas:
- el seed requiere `DEFAULT_CLINIC_ID` y `SUPABASE_SERVICE_ROLE_KEY`
- `npm run seed` limpia primero datos demo previos (`--reset-demo`) y luego inserta dataset de ejemplo para dashboard, calls, pipeline y agenda
