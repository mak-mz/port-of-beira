/* ============================================================
   Port of Beira · ligação ao Supabase
   Preencha os dois valores abaixo (Supabase → Project Settings → API Keys / Data API).
   Deixe-os vazios para o site funcionar em modo local (conteúdo guardado só no navegador).
   A chave publicável é pública por natureza: a segurança está nas regras (RLS) do ficheiro supabase/01-estrutura.sql.
   NUNCA coloque aqui a chave "secret" nem a "service_role".
   ============================================================ */
window.CDM_SUPABASE = {
  url: "",   // ex.: "https://tllyfyuqwzlrocyrkflp.supabase.co/rest/v1/"
  key: ""    // ex.: "sb_publishable_rl1JrewgoRWB1ko2NU4O2A_kjGpSVuz" (ou a chave "anon" antiga)
};
