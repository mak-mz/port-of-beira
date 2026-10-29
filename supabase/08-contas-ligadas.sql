-- =====================================================================
--  Port of Beira · 08 · Contas ligadas aos utilizadores do CMS (v2.29.1)
--  Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Corra depois do 07. Pode correr mais de uma vez.
--  Se voltar a correr o 05, o 06 ou o 07, corra também este ficheiro outra vez.
--
--  Porquê (auditoria 2.29.0, secção 6 e V-02):
--   Até à 2.29.0 o nível de cada pessoa era encontrado pelo EMAIL da sessão.
--   Se o registo livre de contas estivesse ligado no Supabase, alguém podia
--   criar uma conta com o email de um utilizador do CMS que ainda não tivesse
--   conta e herdar o seu nível.
--
--  O que muda:
--   · Cada linha de "editors" fica ligada ao identificador (id) da conta
--     do Supabase Auth (coluna user_id).
--   · Os níveis passam a ser procurados pelo id da sessão (auth.uid()),
--     não pelo email. Uma conta criada por fora, mesmo com o email certo,
--     não tem acesso a nada.
--   · A ligação é feita por este ficheiro (pessoas que já têm conta) e pela
--     função cdm-admin 2.29.1 (Criar utilizador / Nova palavra-passe).
--   · Antes de correr: em Authentication → Users, confirme que não há contas
--     que não reconheça com o email de alguém da lista de utilizadores.
--
--  Continua a ser obrigatório, no painel do Supabase:
--   Authentication → Sign In / Providers → "Allow new users to sign up": DESLIGADO.
-- =====================================================================

-- 1) Coluna da ligação --------------------------------------------------
alter table public.editors add column if not exists user_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'editors_user_id_fkey') then
    alter table public.editors add constraint editors_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'editors_user_id_key') then
    alter table public.editors add constraint editors_user_id_key unique (user_id);
  end if;
end $$;

-- 2) Quem liga a conta: a função cdm-admin (2.29.1), ao criar o utilizador ou ao
--    dar-lhe uma nova palavra-passe, e este ficheiro, para quem já existe.
--    Um utilizador comum nunca liga contas: só administradores alteram "editors".
drop trigger if exists editors_bind_user on public.editors;
drop function if exists public.editors_bind_user();

-- 3) Ligar as pessoas que já existem --------------------------------------
update public.editors e
   set user_id = u.id
  from auth.users u
 where e.user_id is null
   and lower(u.email) = e.email
   and not exists (select 1 from public.editors x where x.user_id = u.id);

-- 4) Níveis pelo id da sessão (substituem as versões do 07) ---------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select e.role::text from public.editors e
   where e.user_id = auth.uid()
     and coalesce(e.active, true) and e.role::text <> 'berth';
$$;

create or replace function public.berth_terminals()
returns text[] language sql stable security definer set search_path = '' as $$
  select e.terminals from public.editors e
   where e.user_id = auth.uid()
     and e.role::text = 'berth' and coalesce(e.active, true) and cardinality(e.terminals) > 0;
$$;

revoke all on function public.my_role(), public.berth_terminals() from public, anon;
grant execute on function public.my_role(), public.berth_terminals() to authenticated;

-- 5) Verificação ----------------------------------------------------------
--  Deve devolver uma linha com "ok". Se aparecerem pessoas em "sem conta ligada",
--  no CMS (Dados e acesso → Utilizadores) use "Nova palavra-passe" ou
--  "Criar utilizador" para essas pessoas: a conta fica ligada e a palavra-passe
--  temporária é enviada por si.
select case when count(*) filter (where user_id is null) = 0 then 'ok'
            else 'ok · sem conta ligada: ' || string_agg(email, ', ') filter (where user_id is null) end
       as contas_ligadas
  from public.editors;
