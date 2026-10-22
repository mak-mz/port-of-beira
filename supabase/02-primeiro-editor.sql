-- Adiciona o primeiro editor do CMS.
-- Troque o email abaixo pelo seu (em minúsculas) e clique em Run.
-- Os editores seguintes podem ser adicionados dentro do próprio CMS (Dados e acesso → Editores).
insert into public.editors (email)
values (lower('o.seu.email@cornelder.co.mz'))
on conflict (email) do nothing;
