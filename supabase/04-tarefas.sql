-- ============================================================
-- Port of Beira · 04 · Tarefas do CMS (lista "Por completar")
-- Lista partilhada pelos editores, privada (não é pública como o conteúdo do site).
-- Pode correr este ficheiro mais de uma vez.
-- ============================================================
create table if not exists public.cms_tasks (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(btrim(text)) between 1 and 300),
  done        boolean not null default false,
  due         date,
  pos         integer not null default 0,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists cms_tasks_pos_idx on public.cms_tasks (done, pos, created_at);

alter table public.cms_tasks enable row level security;
revoke all on public.cms_tasks from anon;
grant select, insert, update, delete on public.cms_tasks to authenticated;

drop policy if exists "tarefas: editores lêem"    on public.cms_tasks;
drop policy if exists "tarefas: editores criam"   on public.cms_tasks;
drop policy if exists "tarefas: editores alteram" on public.cms_tasks;
drop policy if exists "tarefas: editores apagam"  on public.cms_tasks;
create policy "tarefas: editores lêem"    on public.cms_tasks for select to authenticated using ((select public.is_editor()));
create policy "tarefas: editores criam"   on public.cms_tasks for insert to authenticated with check ((select public.is_editor()));
create policy "tarefas: editores alteram" on public.cms_tasks for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "tarefas: editores apagam"  on public.cms_tasks for delete to authenticated using ((select public.is_editor()));
