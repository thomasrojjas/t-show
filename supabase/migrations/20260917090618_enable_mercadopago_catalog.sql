-- Publish the recurring plans now that the Mercado Pago integration is ready.
-- Provider credentials remain operational secrets; this migration only exposes
-- the already-defined Pro and Max products in the authenticated catalog.
update public.tshow_plans
set active = true
where code in ('pro_monthly', 'pro_annual', 'max_monthly', 'max_annual')
  and amount_clp is not null
  and amount_clp > 0;
