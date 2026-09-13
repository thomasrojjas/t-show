-- Canonical Chilean phone validation and safe profile creation after Auth signup.
-- Safe to run after migrations 001-026. Existing rows are preserved.
begin;

alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles drop constraint if exists profiles_chile_phone_check;
alter table public.profiles
  add constraint profiles_chile_phone_check
  check (phone ~ E'^\\+569[0-9]{8}$') not valid;

create or replace function public.tshow_create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_name_value text := nullif(btrim(new.raw_user_meta_data->>'first_name'), '');
  last_name_value text := nullif(btrim(new.raw_user_meta_data->>'last_name'), '');
  rut_value text := upper(nullif(btrim(new.raw_user_meta_data->>'rut'), ''));
  phone_value text := nullif(regexp_replace(new.raw_user_meta_data->>'phone', '[[:space:]()-]', '', 'g'), '');
  email_value text := lower(nullif(btrim(new.email), ''));
begin
  -- Auth signup must not be rolled back by an incomplete optional profile.
  -- The authenticated profile endpoint completes this record after signup.
  if first_name_value is not null
     and last_name_value is not null
     and char_length(first_name_value) between 2 and 80
     and char_length(last_name_value) between 2 and 80
     and first_name_value ~ '^[[:alpha:]À-ÖØ-öø-ÿÑñ]+([ ''-][[:alpha:]À-ÖØ-öø-ÿÑñ]+)*$'
     and last_name_value ~ '^[[:alpha:]À-ÖØ-öø-ÿÑñ]+([ ''-][[:alpha:]À-ÖØ-öø-ÿÑñ]+)*$'
     and rut_value ~ '^[0-9]{7,8}-[0-9K]$'
     and public.tshow_valid_rut(rut_value)
     and phone_value ~ E'^\\+569[0-9]{8}$'
     and email_value is not null
     and not exists (select 1 from public.profiles p where p.rut = rut_value or p.email = email_value)
  then
    insert into public.profiles (id, first_name, last_name, rut, email, phone)
    values (new.id, first_name_value, last_name_value, rut_value, email_value, phone_value)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

commit;
