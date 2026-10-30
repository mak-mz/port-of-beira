-- =====================================================================
--  Port of Beira · 10 · Nível "Posição do Porto" (v2.33.0)
--  Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Corra depois do 07, do 08 e do 09. Pode correr mais de uma vez.
--  Se voltar a correr o 05, o 06, o 07 ou o 08, corra também este ficheiro outra vez.
--
--  Regras (aplicadas pela base de dados, não só pelo ecrã):
--   · Posição do Porto: só actualiza a Posição do Porto interactiva (chave "portpos"
--     do conteúdo) e só carrega PDFs na pasta "documentos".
--   · Não lê mensagens, denúncias, tarefas, histórico, utilizadores nem cópias,
--     e não altera mais nada do site.
--   · Verificação em dois passos: segue a regra "Exigir a todos" do CMS.
-- =====================================================================

-- 1) Novo nível --------------------------------------------------------
do $$
declare c record; t text;
begin
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'editors' and column_name = 'role';
  if t = 'USER-DEFINED' then
    execute (select format('alter type %s add value if not exists %L', a.atttypid::regtype, 'portpos')
               from pg_attribute a where a.attrelid = 'public.editors'::regclass and a.attname = 'role');
  else
    for c in select conname from pg_constraint
              where conrelid = 'public.editors'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) ilike '%role%' loop
      execute format('alter table public.editors drop constraint %I', c.conname);
    end loop;
    alter table public.editors add constraint editors_role_check
      check (role in ('admin', 'editor', 'viewer', 'berth', 'portpos'));
  end if;
end $$;

-- 2) Quem é quem (pelo id da conta, como no 08) ------------------------
-- my_role() não devolve os níveis limitados: assim nenhuma regra antiga
-- (mensagens, denúncias, tarefas, histórico, utilizadores, cópias, funções) lhes dá acesso.
create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select e.role::text from public.editors e
   where e.user_id = auth.uid()
     and coalesce(e.active, true) and e.role::text not in ('berth', 'portpos');
$$;

create or replace function public.is_portpos_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.editors e
    where e.user_id = auth.uid() and e.role::text = 'portpos' and coalesce(e.active, true));
$$;

-- Nível para o ecrã do CMS (inclui Planeamento e Posição do Porto).
create or replace function public.cms_role()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role(),
                  case when public.berth_terminals() is not null then 'berth' end,
                  case when public.is_portpos_user() then 'portpos' end);
$$;

create or replace function public.is_portpos()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_portpos_user() and public.mfa_ok();
$$;

revoke all on function public.my_role(), public.is_portpos_user(), public.cms_role(), public.is_portpos() from public, anon;
grant execute on function public.my_role(), public.is_portpos_user(), public.cms_role(), public.is_portpos() to authenticated;

-- 3) Publicar: Planeamento só muda berth.plans; Posição do Porto só muda "portpos" -
create or replace function public.site_content_berth_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  terms text[]; ob jsonb; nb jsonb; k text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;  -- SQL Editor, chave de serviço
  if public.is_editor() then return new; end if;          -- administradores e editores: sem restrição

  -- Posição do Porto
  if public.is_portpos() then
    if tg_op = 'INSERT' then
      if exists (select 1 from public.site_content s where s.id = new.id) then return new; end if;
      raise exception 'A Posição do Porto não pode criar o conteúdo do site.' using errcode = '42501';
    end if;
    if (new.body - 'portpos' - 'updatedAt') is distinct from (old.body - 'portpos' - 'updatedAt') then
      raise exception 'O nível Posição do Porto só pode alterar a Posição do Porto.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Planeamento (igual ao 07)
  terms := public.berth_terminals();
  if terms is null or not public.mfa_ok() then
    raise exception 'Sem permissão para publicar.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.site_content s where s.id = new.id) then return new; end if;
    raise exception 'O Planeamento não pode criar o conteúdo do site.' using errcode = '42501';
  end if;
  if (new.body - 'berth' - 'updatedAt') is distinct from (old.body - 'berth' - 'updatedAt') then
    raise exception 'O Planeamento só pode alterar o plano de atracação.' using errcode = '42501';
  end if;
  ob := coalesce(old.body -> 'berth', '{}'); nb := coalesce(new.body -> 'berth', '{}');
  if (nb - 'plans' - 'plan') is distinct from (ob - 'plans' - 'plan') then
    raise exception 'O Planeamento só pode alterar os planos interactivos.' using errcode = '42501';
  end if;
  if not ('tcg' = any(terms)) and (nb -> 'plan') is distinct from (ob -> 'plan') then
    raise exception 'Sem permissão para o plano do TCG.' using errcode = '42501';
  end if;
  if ('tcg' = any(terms)) and (nb ? 'plan') and (nb -> 'plan') is distinct from (ob -> 'plan') then
    raise exception 'O plano antigo do TCG só pode ser retirado, não alterado.' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(coalesce(ob -> 'plans', '{}')) union select jsonb_object_keys(coalesce(nb -> 'plans', '{}')) loop
    if not (k = any(terms)) and (nb -> 'plans' -> k) is distinct from (ob -> 'plans' -> k) then
      raise exception 'Sem permissão para o plano do terminal %.', upper(k) using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.site_content_berth_guard() from public, anon, authenticated;
drop trigger if exists site_content_berth_guard on public.site_content;
create trigger site_content_berth_guard before insert or update on public.site_content
  for each row execute function public.site_content_berth_guard();

drop policy if exists "conteudo: posicao insere" on public.site_content;
drop policy if exists "conteudo: posicao altera" on public.site_content;
create policy "conteudo: posicao insere" on public.site_content for insert to authenticated
  with check ((select public.is_portpos()));
create policy "conteudo: posicao altera" on public.site_content for update to authenticated
  using ((select public.is_portpos())) with check ((select public.is_portpos()));

-- 4) Ficheiros: a Posição do Porto só carrega PDFs na pasta "documentos" -
drop policy if exists "media: posicao carrega pdf" on storage.objects;
create policy "media: posicao carrega pdf" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_portpos())
              and (storage.foldername(name))[1] = 'documentos'
              and lower(storage.extension(name)) = 'pdf');

-- Verificação: deve devolver uma linha com "ok".
select 'ok' as posicao_porto;
