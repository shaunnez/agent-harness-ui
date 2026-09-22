with latest_register as (
  select distinct on (r.tender_id) r.id, r.tender_id, r.account_id, r.label, r.claim_count
  from claim_registers r
  where r.tender_id is not null
  order by r.tender_id, r.created_at desc, r.id desc
),
latest_job as (
  select distinct on (j.register_id) j.id, j.register_id, j.catalogue_id, j.created_at
  from construction_pricing_jobs j
  join latest_register lr on lr.id = j.register_id
  where j.state in ('succeeded','partial')
  order by j.register_id, j.created_at desc, j.id desc
),
claim as (
  select lr.id as register_id, c->>'id' as claim_id, c as body
  from latest_register lr
  join claim_registers r on r.id = lr.id,
       jsonb_array_elements(r.document->'claims') c
)
select jsonb_pretty(jsonb_agg(row order by account, tender, claim_id)) from (
  select a.name as account,
         t.name as tender,
         jsonb_build_object(
           'account', a.name,
           'tender', t.name,
           'tender_id', t.id,
           'jurisdiction', t.jurisdiction,
           'register_id', lr.id,
           'claim_id', cl.claim_id,
           'rule', cl.body->>'rule',
           'claim_type', cl.body->>'claim_type',
           'grade', cl.body->>'grade',
           'verification', cl.body->>'verification',
           'claim', cl.body->>'claim',
           'trigger', cl.body->>'trigger',
           'why_a_gap_basis', cl.body->'why_a_gap'->>'basis',
           'counter_position', cl.body->'why_a_gap'->>'counter_position',
           'remedy_action', cl.body->'remedy'->>'action',
           'remedy_unit', cl.body->'remedy'->>'unit',
           'evidence', (
             select jsonb_agg(jsonb_build_object(
               'document', e->>'document', 'page', e->>'page', 'quote', e->>'text'))
             from jsonb_array_elements(cl.body->'evidence') e
           ),
           'pricing_state', p.state,
           'pricing_reason', p.reason,
           'near_miss_scenarios', p.candidates
         ) as row,
         cl.claim_id
  from latest_job lj
  join latest_register lr on lr.id = lj.register_id
  join accounts a on a.id = lr.account_id
  join tenders t on t.id = lr.tender_id
  join construction_pricing_results p on p.job_id = lj.id
  join claim cl on cl.register_id = lr.id and cl.claim_id = p.claim_id
  where p.state = 'unmatched' and p.reason = 'no_match'
) s;
