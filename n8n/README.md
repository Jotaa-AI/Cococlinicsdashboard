# n8n workflow (A/B con un solo trigger)

Archivo importable:

- `n8n/workflows/coco_ab_test_full.json`

## Cambios clave de esta version

- Usa **un solo trigger**: `Facebook Lead Ads Trigger`.
- Alterna A/B justo despues del trigger con contador global (`A, B, A, B...`).
- Usa **nodos nativos de Supabase** para operaciones CRUD:
  - `leads` (get/create/update)
  - `lead_ab_assignments` (get/create/update)
  - `lead_ab_events` (create)
- Usa HTTP Request solo para integraciones externas y acciones no-Supabase:
  - Evolution API (WhatsApp)
  - Retell API (llamada)
- Incluye **AI Agent** en la rama B para generar la apertura conversacional de WhatsApp con el guion comercial.

## Flujo

1. Trigger Meta -> normaliza lead.
2. Nodo alternador decide variante A/B.
3. Upsert de lead en Supabase con nodos nativos (get + create/update).
4. Upsert de asignacion A/B en `lead_ab_assignments`.
5. Log de asignacion en `lead_ab_events`.
6. Rama A: WhatsApp aviso -> espera 1 minuto -> dispara llamada Retell.
7. Rama B: AI Agent crea mensaje de apertura -> se envia por WhatsApp.

## Variables necesarias en n8n

- `DEFAULT_CLINIC_ID`
- `EVOLUTION_BASE_URL`
- `EVOLUTION_INSTANCE`
- `EVOLUTION_API_KEY`
- `RETELL_CREATE_CALL_URL`
- `RETELL_API_KEY`

## Credenciales n8n a configurar

- `Facebook Lead Ads OAuth2` en el trigger.
- `Supabase API` en todos los nodos Supabase.
- `OpenAI API` en `OpenAI Chat Model`.

## Nota importante de alcance

Este workflow arranca el test A/B desde Meta con un solo trigger, y en la rama B crea la apertura inteligente por WhatsApp.
Para cerrar una conversacion multi-turno completa por WhatsApp (leer respuestas del lead, detectar hora exacta y reservar automaticamente) necesitas un workflow adicional de entrada de mensajes de Evolution o polling de conversaciones.
