-- ============================================================
-- T-Show / BaseAndes — Migración inicial Supabase
-- Ejecutar en el SQL Editor de Supabase (o vía CLI) una sola vez.
-- ============================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

do $$ begin
    create type user_role as enum ('superadmin', 'director', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
    create type project_role as enum ('director', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

-- --- Usuarios ---
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    username text not null unique,
    pin_hash text not null,
    role user_role not null default 'viewer',
    display_name text not null,
    email text,
    created_by uuid references users(id),
    is_active boolean not null default true,
    failed_login_attempts int not null default 0,
    locked_until timestamptz,
    last_login_at timestamptz,
    token_version int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_users_username on users(username);
create index if not exists idx_users_created_by on users(created_by);

-- --- Proyectos (reemplaza projects.json) ---
create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    event_name text not null,
    owner_id uuid not null references users(id),
    is_template boolean not null default false,
    template_source_id uuid references projects(id),
    convocatoria_time text,
    convocatoria_duration int,
    doors_time text,
    doors_duration int,
    show_start_mode text,
    show_start_time_input text,
    blocks jsonb not null default '[]',
    updated_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index if not exists idx_projects_owner on projects(owner_id);
create index if not exists idx_projects_is_template on projects(is_template);

-- --- Miembros de proyecto (autoservicio del director) ---
create table if not exists project_members (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    role project_role not null,
    invited_by uuid references users(id),
    created_at timestamptz not null default now(),
    unique (project_id, user_id)
);
create index if not exists idx_members_user on project_members(user_id);
create index if not exists idx_members_project on project_members(project_id);

-- --- Sesiones en vivo (reemplaza live_sessions.json) ---
create table if not exists live_sessions (
    project_id uuid primary key references projects(id) on delete cascade,
    status text not null default 'idle',
    tracking_mode text not null default 'schedule',
    current_index int not null default 0,
    current_block_start_time timestamptz,
    omitted_item_nums jsonb not null default '[]',
    muted_block_nums jsonb not null default '[]',
    block_extensions jsonb not null default '{}',
    history jsonb not null default '[]',
    updated_by uuid references users(id),
    last_updated timestamptz not null default now()
);

-- --- Historial de versiones ---
create table if not exists project_versions (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    snapshot jsonb not null,
    created_by uuid references users(id),
    label text,
    created_at timestamptz not null default now()
);
create index if not exists idx_versions_project on project_versions(project_id, created_at desc);

-- --- Comentarios con timecode ---
create table if not exists comments (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    block_id text,
    timecode text,
    body text not null,
    created_by uuid not null references users(id),
    resolved boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists idx_comments_project on comments(project_id, created_at desc);

-- Trigger genérico updated_at
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_users_updated on users;
create trigger trg_users_updated before update on users for each row execute function set_updated_at();

drop trigger if exists trg_projects_updated on projects;
create trigger trg_projects_updated before update on projects for each row execute function set_updated_at();

-- RLS activado como cinturón de seguridad. Express siempre usa la service_role key
-- (que bypassea RLS), así que la autorización real vive en el middleware de Express,
-- no aquí. No se crean policies para anon/authenticated porque no se usa Supabase Auth.
alter table users enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table live_sessions enable row level security;
alter table project_versions enable row level security;
alter table comments enable row level security;
