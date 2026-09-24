alter table public.tshow_tasks drop constraint if exists tshow_tasks_status_check;
alter table public.tshow_tasks add constraint tshow_tasks_status_check
  check (status in ('pending','in_progress','blocked','completed','cancelled','not_applicable'));
alter table public.tshow_tasks add constraint tshow_tasks_not_applicable_reason_check
  check (status <> 'not_applicable' or char_length(trim(not_applicable_reason)) > 0);
