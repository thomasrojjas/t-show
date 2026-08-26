-- Enforce Chilean identity and contact data for every new/updated profile.
-- NOT VALID preserves any historical rows while enforcing all future writes.
create or replace function public.tshow_valid_rut(value text) returns boolean
language plpgsql immutable as $$
declare
  digits text;
  verifier text;
  total integer := 0;
  multiplier integer := 2;
  expected integer;
  index integer;
begin
  if value !~ '^[0-9]{7,8}-[0-9K]$' then return false; end if;
  digits := split_part(value, '-', 1); verifier := split_part(value, '-', 2);
  for index in reverse length(digits)..1 loop
    total := total + cast(substr(digits, index, 1) as integer) * multiplier;
    multiplier := case when multiplier = 7 then 2 else multiplier + 1 end;
  end loop;
  expected := 11 - (total % 11);
  return verifier = case when expected = 11 then '0' when expected = 10 then 'K' else expected::text end;
end;
$$;

alter table public.profiles drop constraint if exists profiles_rut_valid_check;
alter table public.profiles add constraint profiles_rut_valid_check check (public.tshow_valid_rut(rut)) not valid;
alter table public.profiles drop constraint if exists profiles_chile_phone_check;
alter table public.profiles add constraint profiles_chile_phone_check check (phone ~ '^\+569[0-9]{8}$') not valid;
