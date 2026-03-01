insert into lead_stage_catalog (
  stage_key,
  pipeline_key,
  pipeline_label_es,
  label_es,
  description_es,
  pipeline_order,
  order_index,
  is_terminal,
  is_active
)
values
  ('post_visit_pending_decision', 'closed', 'Cerrados', 'Pendiente decisión', 'Visitó la clínica y está valorando la propuesta', 3, 20, false, true),
  ('post_visit_follow_up', 'closed', 'Cerrados', 'Seguimiento post-visita', 'Requiere seguimiento comercial tras la visita', 3, 30, false, true),
  ('post_visit_not_closed', 'closed', 'Cerrados', 'No cerró tras visita', 'Hizo la visita pero no se cerró la venta', 3, 40, true, true),
  ('client_closed', 'closed', 'Cerrados', 'Cliente cerrado', 'Venta cerrada y cliente convertido', 3, 50, true, true)
on conflict (stage_key) do update
set
  pipeline_key = excluded.pipeline_key,
  pipeline_label_es = excluded.pipeline_label_es,
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  pipeline_order = excluded.pipeline_order,
  order_index = excluded.order_index,
  is_terminal = excluded.is_terminal,
  is_active = excluded.is_active;

update lead_stage_catalog
set order_index = 60
where stage_key = 'not_interested';

update lead_stage_catalog
set order_index = 70
where stage_key = 'discarded';
