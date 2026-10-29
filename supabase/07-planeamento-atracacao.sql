-- =====================================================================
--  Port of Beira · 07 · Nível "Planeamento" (planos de atracação) (v2.29.0)
--  Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Corra depois do 05 e do 06. Pode correr mais de uma vez.
--  Se voltar a correr o 05 ou o 06, corra também este ficheiro outra vez.
--
--  Regras (aplicadas pela base de dados, não só pelo ecrã):
--   · Planeamento: só actualiza o plano de atracação do(s) terminal(is)
--     que lhe foram atribuídos (TCG e/ou CT) e só carrega PDFs.
--   · Não lê mensagens, denúncias, tarefas, histórico, utilizadores nem
--     cópias, e não altera mais nada do site.
--   · No máximo 2 pessoas activas por terminal.
--   · Verificação em dois passos: segue a regra "Exigir a todos" do CMS.
-- =====================================================================

-- 1) Coluna dos terminais e novo nível ---------------------------------
alter table public.editors add column if not exists terminals text[] not null default '{}';

do $$
declare c record; t text;
begin
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'editors' and column_name = 'role';
  if t = 'USER-DEFINED' then
    -- nível guardado como tipo enumerado: acrescenta o valor
    execute (select format('alter type %s add value if not exists %L', a.atttypid::regtype, 'berth')
               from pg_attribute a where a.attrelid = 'public.editors'::regclass and a.attname = 'role');
  else
    for c in select conname from pg_constraint
              where conrelid = 'public.editors'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) ilike '%role%' loop
      execute format('alter table public.editors drop constraint %I', c.conname);
    end loop;
    alter table public.editors add constraint editors_role_check
      check (role in ('admin', 'editor', 'viewer', 'berth'));
  end if;
end $$;

-- 2) Regras da lista de utilizadores: terminais válidos, máximo 2 por terminal
create or replace function public.editors_berth_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t text; n int;
begin
  if new.role::text <> 'berth' then
    new.terminals := '{}';
    return new;
  end if;
  new.terminals := array(select distinct x from unnest(coalesce(new.terminals, '{}')) x where x in ('tcg', 'ct') order by 1);
  if cardinality(new.terminals) = 0 then
    raise exception 'Escolha pelo menos um terminal (TCG ou CT) para o nível Planeamento.' using errcode = '23514';
  end if;
  if coalesce(new.active, true) then
    foreach t in array new.terminals loop
      select count(*) into n from public.editors e
       where e.role::text = 'berth' and coalesce(e.active, true)
         and t = any(e.terminals) and e.email <> new.email;
      if n >= 2 then
        raise exception 'O terminal % já tem 2 pessoas de Planeamento activas. Retire ou suspenda uma antes de acrescentar outra.', upper(t) using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.editors_berth_guard() from public, anon, authenticated;
drop trigger if exists editors_berth_guard on public.editors;
create trigger editors_berth_guard before insert or update on public.editors
  for each row execute function public.editors_berth_guard();

-- 3) Quem é quem ------------------------------------------------------
-- Terminais de quem pede, se for Planeamento activo (senão null).
create or replace function public.berth_terminals()
returns text[] language sql stable security definer set search_path = '' as $$
  select e.terminals from public.editors e
   where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and e.role::text = 'berth' and coalesce(e.active, true) and cardinality(e.terminals) > 0;
$$;

-- my_role() deixa de devolver "berth": assim nenhuma regra antiga (mensagens,
-- denúncias, tarefas, histórico, utilizadores, cópias, funções) dá acesso ao Planeamento.
create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select e.role::text from public.editors e
   where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and coalesce(e.active, true) and e.role::text <> 'berth';
$$;

-- Nível para o ecrã do CMS (inclui Planeamento).
create or replace function public.cms_role()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role(), case when public.berth_terminals() is not null then 'berth' end);
$$;

-- Verificação em dois passos: o Planeamento segue "Exigir a todos".
create or replace function public.mfa_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
      or (public.cms_role() is not null and coalesce(
            (select s.body -> 'cms' ->> 'mfaAll' from public.site_content s where s.id = 'main'), '') = 'true');
$$;

create or replace function public.mfa_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role',      public.cms_role(),
    'terminals', to_jsonb(coalesce(public.berth_terminals(), '{}')),
    'required',  public.mfa_required(),
    'enrolled',  public.mfa_enrolled(),
    'aal',       coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'ok',        public.mfa_ok());
$$;

create or replace function public.is_berth()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.berth_terminals() is not null and public.mfa_ok();
$$;

revoke all on function public.berth_terminals(), public.cms_role(), public.is_berth() from public, anon;
grant execute on function public.berth_terminals(), public.cms_role(), public.is_berth(), public.mfa_state(), public.mfa_required() to authenticated;
grant execute on function public.my_role() to authenticated;

-- 4) Publicar: o Planeamento só muda berth.plans dos seus terminais ---
-- Corre com os direitos de quem pede (security invoker): assim sabe se é um
-- utilizador do CMS ou o SQL Editor / chave de serviço (cópias e restauros).
create or replace function public.site_content_berth_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  terms text[]; ob jsonb; nb jsonb; k text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;  -- SQL Editor, chave de serviço
  if public.is_editor() then return new; end if;          -- administradores e editores: sem restrição
  terms := public.berth_terminals();
  if terms is null or not public.mfa_ok() then
    raise exception 'Sem permissão para publicar.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- o CMS publica com "upsert"; a linha já existe, por isso a verificação é feita no UPDATE
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
  -- plano antigo (2.26.0) do TCG: só quem tem o TCG o pode retirar
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

drop policy if exists "conteudo: planeamento insere" on public.site_content;
drop policy if exists "conteudo: planeamento altera" on public.site_content;
create policy "conteudo: planeamento insere" on public.site_content for insert to authenticated
  with check ((select public.is_berth()));
create policy "conteudo: planeamento altera" on public.site_content for update to authenticated
  using ((select public.is_berth())) with check ((select public.is_berth()));

-- 5) Ficheiros: o Planeamento só carrega PDFs na pasta "documentos" ---
drop policy if exists "media: planeamento carrega pdf" on storage.objects;
create policy "media: planeamento carrega pdf" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_berth())
              and (storage.foldername(name))[1] = 'documentos'
              and lower(storage.extension(name)) = 'pdf');

-- Verificação: deve devolver uma linha com "ok".
select 'ok' as planeamento_atracacao;
