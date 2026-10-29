-- =====================================================================
--  Port of Beira · 09 · Desempenho das consultas (v2.30.0)
--  Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Corra depois do 08. Pode correr mais de uma vez.
--  Se voltar a correr o 01, o 05, o 06, o 07 ou o 08, corra também este.
--
--  O que faz:
--   1) Índices nas colunas usadas em filtros e ordenações que ainda não tinham.
--   2) Campos públicos: os visitantes deixam de receber dados só do CMS
--      (alertas de notícias, definições de segurança, avisos do plano).
--   3) A regra dos 2 passos deixa de ler todo o conteúdo do site a cada pedido.
--   4) Registo de consultas lentas (log_min_duration_statement, 250 ms).
--   5) Métricas por consulta (pg_stat_statements), guardadas de hora a hora,
--      para o painel CMS → Sistema → Desempenho (só administradores).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ÍNDICES
--    Todas as outras pesquisas já usam a chave primária ou um índice:
--    site_content.id, inbox.id, inbox(created_at), inbox(ip_hash, created_at),
--    cms_tasks.id, cms_tasks(done, pos, created_at), editors.email,
--    editors.user_id (08), site_content_history.id, site_backups.id.
-- ---------------------------------------------------------------------
-- CMS → Histórico de publicações: order by saved_at desc limit 30
create index if not exists site_content_history_saved_at_idx
  on public.site_content_history (saved_at desc);

-- Cópias de segurança (05): lista order by created_at desc limit 60;
-- limpeza das antigas por tipo (manual/automática) e data.
do $$ begin
  if to_regclass('public.site_backups') is not null then
    execute 'create index if not exists site_backups_kind_created_idx on public.site_backups (kind, created_at desc)';
    execute 'create index if not exists site_backups_created_idx on public.site_backups (created_at desc)';
  end if;
end $$;

-- Planeamento (07): contagem de pessoas activas por terminal
create index if not exists editors_berth_terminals_idx
  on public.editors using gin (terminals) where role::text = 'berth';

-- ---------------------------------------------------------------------
-- 2) CAMPOS PÚBLICOS DO CONTEÚDO
--    O site só precisa de public_body. O CMS (utilizadores com sessão)
--    continua a ler body completo.
-- ---------------------------------------------------------------------
create or replace function public.site_public_body(b jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb; k text; p jsonb;
begin
  if b is null then return null; end if;
  r := b - 'monitor' - 'cms';                       -- alertas de notícias e definições de segurança: só CMS
  if jsonb_typeof(r #> '{berth,plans}') = 'object' then
    for k in select jsonb_object_keys(r #> '{berth,plans}') loop
      p := r #> array['berth','plans',k];
      if jsonb_typeof(p) = 'object' then
        p := p - 'warnings';                           -- avisos da revisão: só CMS
        if jsonb_typeof(p -> 'vessels') = 'array' then
          p := jsonb_set(p, '{vessels}', coalesce((select jsonb_agg(v - 'issues') from jsonb_array_elements(p -> 'vessels') v), '[]'::jsonb));
        end if;
        r := jsonb_set(r, array['berth','plans',k], p);
      end if;
    end loop;
  end if;
  if jsonb_typeof(r #> '{berth,plan}') = 'object' then
    r := jsonb_set(r, '{berth,plan}', (r #> '{berth,plan}') - 'warnings');
  end if;
  return r;
end;
$$;

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'site_content' and column_name = 'public_body') then
    alter table public.site_content
      add column public_body jsonb generated always as (public.site_public_body(body)) stored;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'site_content' and column_name = 'mfa_all') then
    alter table public.site_content
      add column mfa_all boolean generated always as (coalesce(body #>> '{cms,mfaAll}', '') = 'true') stored;
  end if;
end $$;

-- Visitantes (anon): só id, public_body e updated_at. Utilizadores com sessão: tudo (RLS decide).
revoke select on public.site_content from anon;
grant select (id, public_body, updated_at) on public.site_content to anon;
grant select on public.site_content to authenticated;

-- ---------------------------------------------------------------------
-- 3) 2 PASSOS SEM LER O CONTEÚDO TODO (substitui a versão do 07)
-- ---------------------------------------------------------------------
create or replace function public.mfa_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
      or (public.cms_role() is not null
          and coalesce((select s.mfa_all from public.site_content s where s.id = 'main'), false));
$$;
revoke all on function public.mfa_required() from public, anon;
grant execute on function public.mfa_required() to authenticated;

-- ---------------------------------------------------------------------
-- 4) MÉTRICAS E REGISTO DE CONSULTAS LENTAS
-- ---------------------------------------------------------------------
create extension if not exists pg_stat_statements with schema extensions;
create schema if not exists perf;
revoke all on schema perf from public, anon, authenticated;

create table if not exists perf.settings (
  id           boolean primary key default true check (id),
  threshold_ms numeric not null default 250 check (threshold_ms between 10 and 60000),
  log_applied  text,
  updated_at   timestamptz not null default now()
);
insert into perf.settings (id) values (true) on conflict (id) do nothing;

-- Cópia horária dos totais de cada consulta (só as que correram desde a anterior)
create table if not exists perf.snapshots (
  captured_at       timestamptz not null,
  queryid           bigint not null,
  userid            oid not null,
  toplevel          boolean not null,
  calls             bigint not null,
  total_exec_time   double precision not null,
  max_exec_time     double precision not null,
  rows              bigint not null,
  shared_blks_hit   bigint not null,
  shared_blks_read  bigint not null,
  temp_blks_written bigint not null,
  wal_bytes         numeric not null,
  primary key (queryid, userid, toplevel, captured_at)
);
create index if not exists perf_snapshots_captured_idx on perf.snapshots (captured_at);
create table if not exists perf.queries (
  queryid bigint not null, userid oid not null, toplevel boolean not null,
  query text not null, first_seen timestamptz not null default now(),
  primary key (queryid, userid, toplevel)
);

create or replace function perf.capture()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into perf.queries (queryid, userid, toplevel, query)
  select s.queryid, s.userid, s.toplevel, left(s.query, 4000)
    from extensions.pg_stat_statements s
   where s.dbid = (select oid from pg_database where datname = current_database()) and s.queryid is not null
  on conflict (queryid, userid, toplevel) do update set query = excluded.query;

  insert into perf.snapshots
  select now(), s.queryid, s.userid, s.toplevel, s.calls, s.total_exec_time, s.max_exec_time, s.rows,
         s.shared_blks_hit, s.shared_blks_read, s.temp_blks_written, s.wal_bytes
    from extensions.pg_stat_statements s
    left join lateral (select p.calls from perf.snapshots p
                        where p.queryid = s.queryid and p.userid = s.userid and p.toplevel = s.toplevel
                        order by p.captured_at desc limit 1) last on true
   where s.dbid = (select oid from pg_database where datname = current_database()) and s.queryid is not null
     and (last.calls is null or last.calls <> s.calls);
  get diagnostics n = row_count;

  -- guarda 35 dias, mas mantém sempre a última cópia de cada consulta (base para a próxima diferença)
  delete from perf.snapshots p where p.captured_at < now() - interval '35 days'
     and exists (select 1 from perf.snapshots n where n.queryid = p.queryid and n.userid = p.userid
                  and n.toplevel = p.toplevel and n.captured_at > p.captured_at);
  delete from perf.queries q where not exists (select 1 from perf.snapshots s where s.queryid = q.queryid and s.userid = q.userid and s.toplevel = q.toplevel)
                               and q.first_seen < now() - interval '35 days';
  return n;
end;
$$;
revoke all on function perf.capture() from public, anon, authenticated;

-- Aplica o limite ao registo de consultas lentas dos papéis usados pelo site, CMS, funções e tarefas
create or replace function perf.apply_log_threshold(ms numeric)
returns text language plpgsql security definer set search_path = '' as $$
declare r text; ok text[] := '{}'; bad text[] := '{}';
begin
  foreach r in array array['postgres', 'authenticator', 'anon', 'authenticated', 'service_role'] loop
    continue when not exists (select 1 from pg_roles where rolname = r);
    begin
      execute format('alter role %I set log_min_duration_statement = %L', r, round(ms)::text || 'ms');
      ok := ok || r;
    exception when others then bad := bad || (r || ' (' || sqlerrm || ')');
    end;
  end loop;
  return 'aplicado: ' || coalesce(nullif(array_to_string(ok, ', '), ''), 'nenhum')
      || case when cardinality(bad) > 0 then ' · sem permissão: ' || array_to_string(bad, ', ') else '' end;
end;
$$;
revoke all on function perf.apply_log_threshold(numeric) from public, anon, authenticated;

update perf.settings set log_applied = perf.apply_log_threshold(threshold_ms), updated_at = now();

-- Tarefa horária (minuto 7) e primeira cópia
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cdm-perf-capture';
    perform cron.schedule('cdm-perf-capture', '7 * * * *', 'select perf.capture()');
  else
    raise notice 'pg_cron indisponível: active-o em Database → Extensions e corra este ficheiro outra vez. Sem ele, o painel mostra só os totais desde o último recomeço.';
  end if;
end $$;
select perf.capture();

-- ---------------------------------------------------------------------
-- 5) FUNÇÕES DO PAINEL (só administradores com 2 passos)
-- ---------------------------------------------------------------------
-- Quem corre cada consulta
create or replace function perf.who(u oid)
returns text language sql stable set search_path = '' as $$
  select case r.rolname
           when 'anon' then 'Site (visitantes)'
           when 'authenticated' then 'CMS (utilizadores)'
           when 'service_role' then 'Funções (cdm-admin, cdm-feeds)'
           when 'authenticator' then 'API (PostgREST)'
           when 'postgres' then 'Tarefas e SQL Editor'
           when 'supabase_auth_admin' then 'Supabase Auth'
           when 'supabase_storage_admin' then 'Supabase Storage'
           when 'supabase_admin' then 'Supabase (plataforma)'
           else r.rolname end
    from pg_roles r where r.oid = u;
$$;

-- Resumo por consulta numa janela de horas (deltas das cópias + parte desde a última cópia)
create or replace function public.perf_report(p_hours integer default 24, p_threshold_ms numeric default null)
returns table (
  queryid text, who text, query text,
  calls bigint, calls_per_hour numeric,
  total_ms numeric, mean_ms numeric, max_ms numeric,
  pct_time numeric, rows_per_call numeric,
  cache_hit_pct numeric, blks_read bigint, temp_mb numeric, wal_mb numeric,
  slow boolean, threshold_ms numeric, window_from timestamptz, stats_reset timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare th numeric; since timestamptz; rst timestamptz; base boolean;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Só administradores com a verificação em dois passos.' using errcode = '42501';
  end if;
  th := coalesce(p_threshold_ms, (select s.threshold_ms from perf.settings s));
  since := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 35)));
  select i.stats_reset into rst from extensions.pg_stat_statements_info i;
  -- há uma cópia anterior à janela (ou as estatísticas recomeçaram dentro dela): uma consulta sem
  -- cópia anterior é nova e todas as suas execuções contam; senão, só a partir da 1.ª cópia
  base := coalesce(rst >= since, false) or exists (select 1 from perf.snapshots p where p.captured_at <= since);
  return query
  with live as (
    select s.queryid as q, s.userid as u, s.toplevel as t, now() as at, s.calls, s.total_exec_time, s.max_exec_time, s.rows,
           s.shared_blks_hit, s.shared_blks_read, s.temp_blks_written, s.wal_bytes
      from extensions.pg_stat_statements s
     where s.dbid = (select oid from pg_database where datname = current_database()) and s.queryid is not null
  ), pts as (
    select p.queryid as q, p.userid as u, p.toplevel as t, p.captured_at as at, p.calls, p.total_exec_time, p.max_exec_time, p.rows,
           p.shared_blks_hit, p.shared_blks_read, p.temp_blks_written, p.wal_bytes
      from perf.snapshots p
    union all select * from live
  ), d as (
    select x.q, x.u, x.t, x.at, x.max_exec_time,
           lag(x.calls) over w as pc, x.calls,
           lag(x.total_exec_time) over w as pt, x.total_exec_time,
           lag(x.rows) over w as pr, x.rows,
           lag(x.shared_blks_hit) over w as ph, x.shared_blks_hit,
           lag(x.shared_blks_read) over w as pd, x.shared_blks_read,
           lag(x.temp_blks_written) over w as ptw, x.temp_blks_written,
           lag(x.wal_bytes) over w as pw, x.wal_bytes,
           lag(x.at) over w as pat
      from pts x
    window w as (partition by x.q, x.u, x.t order by x.at)
  ), win as (
    -- primeira cópia dentro da janela sem anterior: conta tudo desde o recomeço só se a janela o incluir
    select d.q, d.u, d.t,
           sum(case when d.pc is null then (case when base then d.calls else 0 end)
                    when d.calls < d.pc then d.calls else d.calls - d.pc end)::bigint as c,
           sum(case when d.pc is null then (case when base then d.total_exec_time else 0 end)
                    when d.calls < d.pc then d.total_exec_time else d.total_exec_time - d.pt end) as tt,
           sum(case when d.pc is null then (case when base then d.rows else 0 end)
                    when d.calls < d.pc then d.rows else d.rows - d.pr end) as rw,
           sum(case when d.pc is null then (case when base then d.shared_blks_hit else 0 end)
                    when d.calls < d.pc then d.shared_blks_hit else d.shared_blks_hit - d.ph end) as bh,
           sum(case when d.pc is null then (case when base then d.shared_blks_read else 0 end)
                    when d.calls < d.pc then d.shared_blks_read else d.shared_blks_read - d.pd end) as br,
           sum(case when d.pc is null then (case when base then d.temp_blks_written else 0 end)
                    when d.calls < d.pc then d.temp_blks_written else d.temp_blks_written - d.ptw end) as tw,
           sum(case when d.pc is null then (case when base then d.wal_bytes else 0 end)
                    when d.calls < d.pc then d.wal_bytes else d.wal_bytes - d.pw end) as wb,
           max(d.max_exec_time) as mx
      from d
     where d.at > since
     group by d.q, d.u, d.t
  ), tot as (select nullif(sum(win.tt), 0) as all_t from win where win.t)
  select w.q::text, perf.who(w.u), coalesce(pq.query, '(texto indisponível)'),
         w.c, round(w.c / greatest(extract(epoch from (now() - greatest(since, coalesce(rst, since)))) / 3600, 1)::numeric, 1),
         round(w.tt::numeric, 1), round((w.tt / nullif(w.c, 0))::numeric, 2), round(w.mx::numeric, 1),
         round((100 * w.tt / tot.all_t)::numeric, 1), round((w.rw / nullif(w.c, 0))::numeric, 1),
         round((100 * w.bh / nullif(w.bh + w.br, 0))::numeric, 1), w.br::bigint,
         round((w.tw * 8192 / 1048576.0)::numeric, 2), round((w.wb / 1048576.0)::numeric, 2),
         (w.tt / nullif(w.c, 0)) > th or w.mx > th, th, since, rst
    from win w cross join tot
    left join perf.queries pq on pq.queryid = w.q and pq.userid = w.u and pq.toplevel = w.t
   where w.c > 0 and w.t            -- só consultas de topo: as que correm dentro de funções já contam no tempo da função
   order by w.tt desc nulls last
   limit 200;
end;
$$;

-- Evolução hora a hora (todas as consultas, ou uma)
create or replace function public.perf_timeline(p_hours integer default 24, p_queryid text default null)
returns table (hour timestamptz, calls bigint, total_ms numeric, slow_calls_est bigint)
language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 35)));
        th numeric := (select s.threshold_ms from perf.settings s);
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Só administradores com a verificação em dois passos.' using errcode = '42501';
  end if;
  return query
  with d as (
    select p.captured_at as at, p.queryid,
           case when lag(p.calls) over w is null then null when p.calls < lag(p.calls) over w then p.calls else p.calls - lag(p.calls) over w end as c,
           case when lag(p.calls) over w is null then null when p.calls < lag(p.calls) over w then p.total_exec_time else p.total_exec_time - lag(p.total_exec_time) over w end as t
      from perf.snapshots p
     where p.toplevel and (p_queryid is null or p.queryid::text = p_queryid)
    window w as (partition by p.queryid, p.userid, p.toplevel order by p.captured_at)
  )
  select date_trunc('hour', d.at), sum(d.c)::bigint, round(sum(d.t)::numeric, 1),
         sum(case when d.t / nullif(d.c, 0) > th then d.c else 0 end)::bigint
    from d where d.at > since and d.c is not null
   group by 1 order by 1;
end;
$$;

-- Visão geral: limite, registo, base de dados, cache, recomeço das estatísticas
create or replace function public.perf_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j jsonb;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Só administradores com a verificação em dois passos.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'threshold_ms', s.threshold_ms,
    'log_applied', s.log_applied,
    'log_setting', (select string_agg(r.rolname || '=' || coalesce((select split_part(c, '=', 2) from unnest(d.setconfig) c where c like 'log_min_duration_statement=%'), '—'), ', ' order by r.rolname)
                      from pg_roles r left join pg_db_role_setting d on d.setrole = r.oid and d.setdatabase = 0
                     where r.rolname in ('postgres', 'authenticator', 'anon', 'authenticated', 'service_role')),
    'stats_reset', (select i.stats_reset from extensions.pg_stat_statements_info i),
    'last_capture', (select max(captured_at) from perf.snapshots),
    'first_capture', (select min(captured_at) from perf.snapshots),
    'cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'db_size_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
    'cache_hit_pct', (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) from pg_stat_database where datname = current_database()),
    'tables', (select jsonb_agg(jsonb_build_object('table', relname, 'rows', n_live_tup, 'seq_scan', seq_scan, 'idx_scan', coalesce(idx_scan, 0),
                                                   'size_kb', pg_total_relation_size(relid) / 1024) order by pg_total_relation_size(relid) desc)
                 from pg_stat_user_tables where schemaname = 'public'),
    'unused_indexes', (select jsonb_agg(indexrelname order by indexrelname) from pg_stat_user_indexes
                        where schemaname = 'public' and idx_scan = 0 and indexrelname not like '%_pkey' and indexrelname not like '%_key'))
    into j from perf.settings s;
  return j;
end;
$$;

-- Alterar o limite (também aplica ao registo de consultas lentas)
create or replace function public.perf_set_threshold(p_ms numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Só administradores com a verificação em dois passos.' using errcode = '42501';
  end if;
  if p_ms is null or p_ms < 10 or p_ms > 60000 then raise exception 'Limite entre 10 e 60000 ms.' using errcode = '22023'; end if;
  update perf.settings set threshold_ms = p_ms, log_applied = perf.apply_log_threshold(p_ms), updated_at = now();
  return public.perf_overview();
end;
$$;

-- Recomeçar a contagem (depois de uma correcção, para medir de novo)
create or replace function public.perf_reset()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Só administradores com a verificação em dois passos.' using errcode = '42501';
  end if;
  begin
    perform extensions.pg_stat_statements_reset();
  exception when others then
    raise exception 'O Supabase não permitiu recomeçar as estatísticas: %', sqlerrm using errcode = '42501';
  end;
  delete from perf.snapshots;
  perform perf.capture();
  return public.perf_overview();
end;
$$;

revoke all on function public.perf_report(integer, numeric), public.perf_timeline(integer, text), public.perf_overview(),
                       public.perf_set_threshold(numeric), public.perf_reset() from public, anon;
revoke all on function perf.who(oid) from public, anon, authenticated;
grant execute on function public.perf_report(integer, numeric), public.perf_timeline(integer, text), public.perf_overview(),
                          public.perf_set_threshold(numeric), public.perf_reset() to authenticated;

-- Verificação: deve devolver uma linha com "ok" e o estado do registo de consultas lentas.
select 'ok · ' || (select log_applied from perf.settings) as desempenho;
