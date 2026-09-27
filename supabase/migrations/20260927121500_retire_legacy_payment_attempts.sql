-- Close unapproved attempts that belong to the retired catalog. No payment
-- history or approved subscription is deleted; provider references remain for
-- support and reconciliation audit.
update public.tshow_payment_attempts a
set status = 'cancelled',
    failure_code = 'LEGACY_CATALOG_RETIRED',
    last_provider_error = 'El catálogo anterior fue retirado antes de confirmar esta contratación.',
    next_retry_at = null,
    updated_at = now()
from public.tshow_plans p
where a.plan_id = p.id
  and coalesce(p.catalog_version, 1) < 2
  and a.status in ('created','processing','pending','review');

delete from public.tshow_payment_attempt_reservations r
using public.tshow_payment_attempts a
where r.attempt_id = a.id
  and a.failure_code = 'LEGACY_CATALOG_RETIRED';
