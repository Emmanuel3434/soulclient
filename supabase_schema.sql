-- ============================================================================
-- SCHEMA UNIFICADO COMPLETO — Panel + Launcher + Gestión de Usuarios (Supabase / Postgres)
-- Corré este script entero en el SQL Editor de tu proyecto Supabase.
-- Es totalmente idempotente (IF NOT EXISTS / ON CONFLICT), por lo que podés
-- ejecutarlo sin riesgo de borrar o duplicar datos existentes.
-- ============================================================================

create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ── Tabla: instances ─────────────────────────────────────────────────────
create table if not exists public.instances (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  version             text not null,
  modloader           text not null default 'vanilla'
                        check (modloader in ('vanilla','fabric','forge','quilt')),
  modloader_version   text,
  icon                text,
  description         text,
  whitelist_enabled   boolean not null default false,
  logo_path           text,
  background_path     text,
  content_version     integer not null default 1,
  created_at          timestamptz not null default now(),
  sha256              text
);

-- Columna sha256 (hash SHA-256 del ZIP que se descarga) para verificación de
-- integridad en el launcher. Idempotente: solo se agrega si aún no existe
-- (por si la tabla ya fue creada sin esta columna antes).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'instances' and column_name = 'sha256'
  ) then
    alter table public.instances add column sha256 text;
  end if;
end $$;

-- Columnas de catálogo remoto (publicar desde el launcher vía Supabase Storage):
-- size_bytes (tamaño del ZIP), downloads (contador de descargas),
-- published_at / updated_at (fechas de publicación/última actualización) y
-- allowed_discord_ids (lista de Discord IDs permitidos para instancias con
-- whitelist habilitada). Todas idempotentes.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'instances' and column_name = 'size_bytes'
  ) then
    alter table public.instances add column size_bytes bigint;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'instances' and column_name = 'downloads'
  ) then
    alter table public.instances add column downloads bigint not null default 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'instances' and column_name = 'published_at'
  ) then
    alter table public.instances add column published_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'instances' and column_name = 'updated_at'
  ) then
    alter table public.instances add column updated_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'instances' and column_name = 'allowed_discord_ids'
  ) then
    alter table public.instances add column allowed_discord_ids jsonb not null default '[]'::jsonb;
  end if;
end $$;

-- ── Tabla: mods ──────────────────────────────────────────────────────────
create table if not exists public.mods (
  id                    uuid primary key default gen_random_uuid(),
  instance_id           uuid not null references public.instances(id) on delete cascade,
  file_name             text not null,
  storage_path          text,
  sha1                  text,
  size_bytes            bigint,
  source                text not null default 'custom'
                          check (source in ('custom','modrinth','modpack')),
  modrinth_project_id   text,
  modrinth_version_id   text,
  download_url          text,
  created_at            timestamptz not null default now()
);

-- Columna is_mandatory (¿el launcher debe bloquear la instancia si falta este mod?)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mods' and column_name = 'is_mandatory'
  ) then
    alter table public.mods add column is_mandatory boolean not null default true;
  end if;
end $$;

-- Constraint para prevención de duplicados de Modrinth en la misma instancia
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mods_instance_modrinth_project_unique'
  ) then
    alter table public.mods add constraint mods_instance_modrinth_project_unique unique (instance_id, modrinth_project_id);
  end if;
end $$;

-- ── Tabla: config_files ──────────────────────────────────────────────────
create table if not exists public.config_files (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references public.instances(id) on delete cascade,
  target_path   text not null,
  storage_path  text,
  sha1          text,
  size_bytes    bigint,
  source        text not null default 'custom'
                  check (source in ('custom','external')),
  download_url  text,
  created_at    timestamptz not null default now()
);

-- ── Tabla: instance_folders (carpetas propias del panel de archivos) ────
create table if not exists public.instance_folders (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references public.instances(id) on delete cascade,
  path          text not null,
  created_at    timestamptz not null default now(),
  unique (instance_id, path)
);

-- ── Tabla: whitelist ─────────────────────────────────────────────────────
create table if not exists public.whitelist (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references public.instances(id) on delete cascade,
  provider      text not null check (provider in ('discord','microsoft')),
  external_id   text not null,
  display_name  text,
  created_at    timestamptz not null default now(),
  unique (instance_id, provider, external_id)
);

-- ── Tabla: access_codes ──────────────────────────────────────────────────
create table if not exists public.access_codes (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references public.instances(id) on delete cascade,
  code          text not null unique,
  max_uses      integer not null default 1,
  use_count     integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── Tabla: code_redemptions ──────────────────────────────────────────────
create table if not exists public.code_redemptions (
  id            uuid primary key default gen_random_uuid(),
  code_id       uuid not null references public.access_codes(id) on delete cascade,
  instance_id   uuid not null references public.instances(id) on delete cascade,
  provider      text not null check (provider in ('discord','microsoft')),
  external_id   text not null,
  display_name  text,
  redeemed_at   timestamptz not null default now()
);

-- ── Tabla: news ───────────────────────────────────────────────────────────
create table if not exists public.news (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  body           text,
  tag            text not null default 'Actualización',
  emoji          text not null default '📰',
  image_path     text,
  published_at   timestamptz not null default now()
);

-- ── Tabla: admins (quién puede entrar al panel / escribir en todo) ──────
create table if not exists public.admins (
  id            uuid primary key default gen_random_uuid(),
  email         text,
  discord_id    text unique,
  created_at    timestamptz not null default now()
);

-- ── Tabla: users (gestión unificada de usuarios del launcher) ───────────
create table if not exists public.users (
  id                 uuid primary key default gen_random_uuid(),
  discord_id         text not null unique,
  username           text not null,
  global_name        text,
  avatar_url         text,
  minecraft_username text,
  role               text not null default 'user' check (role in ('admin', 'user')),
  created_at         timestamptz not null default now(),
  last_login         timestamptz not null default now()
);

-- ── Tabla: login_logs (historial de accesos al launcher) ─────────────────
create table if not exists public.login_logs (
  id             uuid primary key default gen_random_uuid(),
  discord_id     text not null,
  username       text not null,
  logged_at      timestamptz not null default now(),
  client_version text not null default '0.1.0'
);

-- ── Índices para los FK y búsquedas más consultadas ──────────────────────
create index if not exists idx_mods_instance_id            on public.mods(instance_id);
create index if not exists idx_config_files_instance_id     on public.config_files(instance_id);
create index if not exists idx_instance_folders_instance_id on public.instance_folders(instance_id);
create index if not exists idx_whitelist_instance_id        on public.whitelist(instance_id);
create index if not exists idx_whitelist_lookup             on public.whitelist(provider, external_id);
create index if not exists idx_access_codes_instance_id     on public.access_codes(instance_id);
create index if not exists idx_code_redemptions_instance_id on public.code_redemptions(instance_id);
create index if not exists idx_code_redemptions_code_id     on public.code_redemptions(code_id);
create index if not exists idx_users_discord_id             on public.users(discord_id);
create index if not exists idx_login_logs_discord_id        on public.login_logs(discord_id);

-- ============================================================================
-- HELPER: is_admin() — true si el usuario actual tiene permisos de admin
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where id = auth.uid() or discord_id = auth.uid()::text
  ) or exists (
    select 1 from public.users where (discord_id = auth.uid()::text or id = auth.uid()) and role = 'admin'
  );
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
alter table public.instances        enable row level security;
alter table public.mods             enable row level security;
alter table public.config_files     enable row level security;
alter table public.instance_folders enable row level security;
alter table public.whitelist        enable row level security;
alter table public.access_codes     enable row level security;
alter table public.code_redemptions enable row level security;
alter table public.news             enable row level security;
alter table public.admins           enable row level security;
alter table public.users            enable row level security;
alter table public.login_logs       enable row level security;

-- Lectura pública para el launcher y usuarios autenticados
drop policy if exists "instances_public_read" on public.instances;
create policy "instances_public_read" on public.instances for select using (true);

drop policy if exists "mods_public_read" on public.mods;
create policy "mods_public_read" on public.mods for select using (true);

drop policy if exists "config_files_public_read" on public.config_files;
create policy "config_files_public_read" on public.config_files for select using (true);

drop policy if exists "whitelist_public_read" on public.whitelist;
create policy "whitelist_public_read" on public.whitelist for select using (true);

drop policy if exists "news_public_read" on public.news;
create policy "news_public_read" on public.news for select using (true);

drop policy if exists "users_public_read" on public.users;
create policy "users_public_read" on public.users for select using (true);

drop policy if exists "users_public_insert_update" on public.users;
create policy "users_public_insert_update" on public.users for all using (true) with check (true);

drop policy if exists "login_logs_public_insert" on public.login_logs;
create policy "login_logs_public_insert" on public.login_logs for insert with check (true);

-- Escrituras restringidas a Administradores
drop policy if exists "instances_admin_write" on public.instances;
create policy "instances_admin_write" on public.instances for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "mods_admin_write" on public.mods;
create policy "mods_admin_write" on public.mods for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "config_files_admin_write" on public.config_files;
create policy "config_files_admin_write" on public.config_files for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "instance_folders_admin_all" on public.instance_folders;
create policy "instance_folders_admin_all" on public.instance_folders for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "whitelist_admin_write" on public.whitelist;
create policy "whitelist_admin_write" on public.whitelist for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "access_codes_admin_all" on public.access_codes;
create policy "access_codes_admin_all" on public.access_codes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "code_redemptions_admin_all" on public.code_redemptions;
create policy "code_redemptions_admin_all" on public.code_redemptions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "news_admin_write" on public.news;
create policy "news_admin_write" on public.news for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- FUNCIÓN: redeem_code — canje de código de acceso
-- ============================================================================
create or replace function public.redeem_code(
  p_code text,
  p_provider text,
  p_external_id text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.access_codes%rowtype;
  v_already boolean := false;
begin
  select * into v_code
  from public.access_codes
  where code = upper(trim(p_code))
    and active = true
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Código inválido o inactivo.');
  end if;

  if v_code.use_count >= v_code.max_uses then
    return jsonb_build_object('success', false, 'error', 'Este código ya alcanzó su límite de usos.');
  end if;

  if exists (
    select 1 from public.whitelist
    where instance_id = v_code.instance_id
      and provider = p_provider
      and external_id = p_external_id
  ) then
    v_already := true;
  else
    insert into public.whitelist (instance_id, provider, external_id, display_name)
    values (v_code.instance_id, p_provider, p_external_id, p_display_name);

    update public.access_codes
    set use_count = use_count + 1
    where id = v_code.id;

    insert into public.code_redemptions (code_id, instance_id, provider, external_id, display_name)
    values (v_code.id, v_code.instance_id, p_provider, p_external_id, p_display_name);
  end if;

  return jsonb_build_object(
    'success', true,
    'instance_id', v_code.instance_id,
    'already_had_access', v_already
  );
end;
$$;

grant execute on function public.redeem_code(text, text, text, text) to anon, authenticated;

-- ============================================================================
-- ALTA INICIAL DEL ADMINISTRADOR PRINCIPAL (Discord ID: 1323020110155485326)
-- ============================================================================
insert into public.users (discord_id, username, global_name, role)
values ('1323020110155485326', 'Admin', 'Administrador Principal', 'admin')
on conflict (discord_id) do update set role = 'admin';

insert into public.admins (discord_id, email)
values ('1323020110155485326', 'admin@soulclient.net')
on conflict (discord_id) do nothing;

-- ============================================================================
-- BUCKETS DE ALMACENAMIENTO (Storage)
-- ============================================================================
insert into storage.buckets (id, name, public)
values
  ('assets', 'assets', true),
  ('mods', 'mods', true),
  ('configs', 'configs', true),
  ('instances', 'instances', true)
on conflict (id) do nothing;
