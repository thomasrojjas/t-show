-- Correct the legacy profile phone constraint.
-- PostgreSQL regular expressions need one backslash to escape a literal plus.
alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles
  add constraint profiles_phone_check
  check (phone ~ '^\+?[0-9]{8,15}$') not valid;
