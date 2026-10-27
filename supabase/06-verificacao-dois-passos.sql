-- =====================================================================
--  Port of Beira · 06 · Verificação em dois passos (v2.25.0)
--  Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Corra depois do 05. Pode correr mais de uma vez.
--  Se voltar a correr o 05, corra também este ficheiro outra vez.
--
--  Regras (aplicadas pela base de dados, não só pelo ecrã):
--   · Administradores: verificação em dois passos obrigatória.
--   · Editores e Consulta: obrigatória se "Exigir a todos" estiver ligado
--     no CMS (Dados e acesso → Segurança) e publicado.
--   · Quem activou a verificação tem sempre de a usar ao entrar.
--  Enquanto não confirmar o código, a pessoa entra no Supabase, mas a
--  base de dados não lhe deixa ler nem alterar nada do CMS.
-- =====================================================================

-- A verificação está activa (app autenticadora confirmada) para quem pede?
create or replace function public.mfa_enrolled()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f
                 where f.user_id = auth.uid() and f.status::text = 'verified');
$$;

-- É obrigatória para quem pede?
create or replace function public.mfa_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
      or (public.my_role() is not null and coalesce(
            (select s.body -> 'cms' ->> 'mfaAll' from public.site_content s where s.id = 'main'), '') = 'true');
$$;

-- A sessão actual cumpre a regra?
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or (not public.mfa_enrolled() and not public.mfa_required());
$$;

-- Estado para o CMS decidir que ecrã mostrar.
create or replace function public.mfa_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role',     public.my_role(),
    'required', public.mfa_required(),
    'enrolled', public.mfa_enrolled(),
    'aal',      coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'ok',       public.mfa_ok());
$$;

-- Nível de acesso só quando a verificação está cumprida (usado pelas Edge Functions).
create or replace function public.my_access()
returns text language sql stable security definer set search_path = '' as $$
  select case when public.mfa_ok() then public.my_role() end;
$$;

-- As regras de todas as tabelas, ficheiros e funções passam a exigir a verificação.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_role() is not null and public.mfa_ok();
$$;
create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin','editor'), false) and public.mfa_ok();
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false) and public.mfa_ok();
$$;

revoke all on function public.mfa_enrolled(), public.mfa_required(), public.mfa_ok(), public.mfa_state(), public.my_access() from public, anon;
grant execute on function public.mfa_enrolled(), public.mfa_required(), public.mfa_ok(), public.mfa_state(), public.my_access() to authenticated;
grant execute on function public.is_member(), public.is_editor(), public.is_admin() to anon, authenticated;

-- Verificação: deve devolver uma linha com "ok".
select 'ok' as verificacao_dois_passos;
