-- Añade la columna java_version a instances (usada por el selector "Java requerido" del panel)
alter table public.instances
  add column if not exists java_version text;

-- Opcional: valor por defecto para instancias existentes que no lo tengan
update public.instances
set java_version = '21'
where java_version is null;
