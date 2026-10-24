-- =====================================================================
--  Port of Beira · reforço de segurança (v2.11.0)
--  Correr uma vez no SQL Editor, depois do 01-estrutura.sql. Pode repetir sem problema.
--  · Anti-spam no formulário de contacto/denúncias: limites por IP e globais,
--    campo-isco ("website") e tamanhos máximos.
--  · O IP nunca é guardado em claro (apenas um hash com sal), para proteger denunciantes.
-- =====================================================================

alter table public.inbox add column if not exists ip_hash text;

create or replace function public.inbox_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  hdrs jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  ip   text  := split_part(coalesce(hdrs->>'cf-connecting-ip', hdrs->>'x-real-ip', hdrs->>'x-forwarded-for', 'desconhecido'), ',', 1);
  h    text  := encode(extensions.digest('cdm-pob:' || ip || ':' || to_char(now(), 'YYYY-MM-DD'), 'sha256'), 'hex');
  n_ip int; n_all int;
begin
  -- campo-isco: só robôs o preenchem
  if coalesce(new.data->>'website', '') <> '' then
    raise exception 'pedido rejeitado' using errcode = '22023';
  end if;
  -- tamanhos máximos por campo
  if char_length(coalesce(new.data->>'message','')) > 5000
     or char_length(coalesce(new.data->>'name',''))    > 120
     or char_length(coalesce(new.data->>'email',''))   > 160
     or char_length(coalesce(new.data->>'subject','')) > 200
     or char_length(coalesce(new.data->>'contact','')) > 200 then
    raise exception 'campo demasiado longo' using errcode = '22001';
  end if;
  if new.kind not in ('contact', 'whistleblowing') then
    raise exception 'tipo inválido' using errcode = '22023';
  end if;
  -- limites: 5 mensagens por IP em 10 minutos; 200 por hora no total
  select count(*) into n_ip  from public.inbox where ip_hash = h and created_at > now() - interval '10 minutes';
  select count(*) into n_all from public.inbox where created_at > now() - interval '1 hour';
  if n_ip >= 5 or n_all >= 200 then
    raise exception 'demasiados pedidos, tente mais tarde' using errcode = '54000';
  end if;
  new.ip_hash := h;
  new.read := false;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.inbox_guard() from public, anon, authenticated;

drop trigger if exists inbox_guard on public.inbox;
create trigger inbox_guard before insert on public.inbox
  for each row execute function public.inbox_guard();

create index if not exists inbox_ip_recent_idx on public.inbox (ip_hash, created_at desc);
