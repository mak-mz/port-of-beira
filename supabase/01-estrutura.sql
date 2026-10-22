-- =====================================================================
--  Port of Beira · Cornelder de Moçambique
--  Estrutura da base de dados para o site + CMS (versão 2, Supabase)
--  Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Pode correr mais de uma vez sem estragar nada.
-- =====================================================================

-- 1) EDITORES ---------------------------------------------------------
--    Lista de emails com permissão para publicar e ler as mensagens.
create table if not exists public.editors (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);

-- Devolve true se a pessoa com sessão iniciada estiver na lista de editores.
create or replace function public.is_editor()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editors e
    where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to anon, authenticated;

-- 2) CONTEÚDO DO SITE -------------------------------------------------
--    Uma única linha (id = 'main') com todo o conteúdo em JSON.
create table if not exists public.site_content (
  id         text primary key default 'main' check (id = 'main'),
  body       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Histórico: cada publicação guarda a versão anterior (últimas 50).
create table if not exists public.site_content_history (
  id       bigint generated always as identity primary key,
  body     jsonb not null,
  saved_at timestamptz not null,
  saved_by text
);

create or replace function public.site_content_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end;
$$;

create or replace function public.site_content_keep_history()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.body is distinct from new.body then
    insert into public.site_content_history (body, saved_at, saved_by)
    values (old.body, old.updated_at, old.updated_by);
    delete from public.site_content_history
    where id not in (select id from public.site_content_history order by id desc limit 50);
  end if;
  return new;
end;
$$;
revoke all on function public.site_content_keep_history() from public, anon, authenticated;
revoke all on function public.site_content_stamp() from public, anon, authenticated;

drop trigger if exists site_content_stamp on public.site_content;
create trigger site_content_stamp before insert or update on public.site_content
  for each row execute function public.site_content_stamp();

drop trigger if exists site_content_history on public.site_content;
create trigger site_content_history after update on public.site_content
  for each row execute function public.site_content_keep_history();

-- 3) MENSAGENS (formulário de contacto e canal de denúncias) ----------
create table if not exists public.inbox (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind       text not null default 'contact' check (char_length(kind) <= 40),
  data       jsonb not null check (pg_column_size(data) < 20000),
  read       boolean not null default false
);
create index if not exists inbox_created_at_idx on public.inbox (created_at desc);

-- 4) SEGURANÇA (Row Level Security) -----------------------------------
alter table public.editors              enable row level security;
alter table public.site_content         enable row level security;
alter table public.site_content_history enable row level security;
alter table public.inbox                enable row level security;

-- Conteúdo: todos lêem; só editores publicam.
drop policy if exists "conteudo: leitura publica"  on public.site_content;
drop policy if exists "conteudo: editores inserem" on public.site_content;
drop policy if exists "conteudo: editores alteram" on public.site_content;
create policy "conteudo: leitura publica"  on public.site_content for select to anon, authenticated using (true);
create policy "conteudo: editores inserem" on public.site_content for insert to authenticated with check ((select public.is_editor()));
create policy "conteudo: editores alteram" on public.site_content for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));

-- Histórico: só editores lêem (as cópias são criadas pelo gatilho).
drop policy if exists "historico: editores lêem" on public.site_content_history;
create policy "historico: editores lêem" on public.site_content_history for select to authenticated using ((select public.is_editor()));

-- Mensagens: qualquer visitante envia; só editores lêem, marcam e apagam.
drop policy if exists "mensagens: envio publico"   on public.inbox;
drop policy if exists "mensagens: editores lêem"   on public.inbox;
drop policy if exists "mensagens: editores marcam" on public.inbox;
drop policy if exists "mensagens: editores apagam" on public.inbox;
create policy "mensagens: envio publico"   on public.inbox for insert to anon, authenticated with check (read = false);
create policy "mensagens: editores lêem"   on public.inbox for select to authenticated using ((select public.is_editor()));
create policy "mensagens: editores marcam" on public.inbox for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "mensagens: editores apagam" on public.inbox for delete to authenticated using ((select public.is_editor()));

-- Editores: só editores vêem e gerem a lista.
drop policy if exists "editores: ver"       on public.editors;
drop policy if exists "editores: adicionar" on public.editors;
drop policy if exists "editores: remover"   on public.editors;
create policy "editores: ver"       on public.editors for select to authenticated using ((select public.is_editor()));
create policy "editores: adicionar" on public.editors for insert to authenticated with check ((select public.is_editor()));
create policy "editores: remover"   on public.editors for delete to authenticated using ((select public.is_editor()) and email <> lower(coalesce(auth.jwt() ->> 'email', '')));

-- Permissões de tabela (o RLS acima decide linha a linha).
revoke all on public.editors, public.site_content, public.site_content_history, public.inbox from anon, authenticated;
grant select                         on public.site_content         to anon, authenticated;
grant insert, update                 on public.site_content         to authenticated;
grant select                         on public.site_content_history to authenticated;
grant insert                         on public.inbox                to anon, authenticated;
grant select, update, delete         on public.inbox                to authenticated;
grant select, insert, delete         on public.editors              to authenticated;

-- 5) FICHEIROS (imagens, vídeos, PDFs, fontes) ------------------------
--    Bucket público "media": todos vêem os ficheiros, só editores carregam.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif',
              'video/mp4','video/webm','application/pdf',
              'font/woff2','font/woff','font/ttf','font/otf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media: editores carregam" on storage.objects;
drop policy if exists "media: editores alteram"  on storage.objects;
drop policy if exists "media: editores apagam"   on storage.objects;
create policy "media: editores carregam" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_editor()));
create policy "media: editores alteram"  on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select public.is_editor()));
create policy "media: editores apagam"   on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_editor()));
