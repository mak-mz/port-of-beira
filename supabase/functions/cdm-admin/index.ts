// ============================================================
// Port of Beira · Edge Function "cdm-admin" (v2.29.0)
// Gestão de utilizadores do CMS, só para administradores.
// 2.29.1: cada utilizador fica ligado ao id da conta (editors.user_id, SQL 08) ao criar e ao dar nova palavra-passe.
//   POST { action: "list" }                                  → utilizadores, nível, último acesso
//   POST { action: "create", email, name, role, terminals?, password? } → cria a conta com palavra-passe temporária
//   POST { action: "reset", email, password? }               → nova palavra-passe temporária
//   POST { action: "update", email, role?, terminals?, name?, active? } → nível, terminais, nome, activo/suspenso
// Nível "berth" (Planeamento, 07): só planos de atracação dos terminais indicados ("tcg", "ct"), máx. 2 por terminal.
//   POST { action: "remove", email, deleteAccount? }         → retira o acesso (e apaga a conta, se pedido)
//   POST { action: "mfareset", email }                       → repõe a verificação em dois passos (telemóvel perdido)
// A chave de serviço é fornecida automaticamente pelo Supabase (SUPABASE_SERVICE_ROLE_KEY);
// em alternativa, defina o segredo CDM_SERVICE_KEY. Nunca é enviada ao navegador.
// Publicar com "Verify JWT" desligado: a função confirma que quem pede é administrador.
// ============================================================
const VERSION = "2.29.1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const URL_ = () => env("SUPABASE_URL").replace(/\/+$/, "");
const SKEY = () => env("CDM_SERVICE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
const svc = (extra: Record<string, string> = {}) => {
  const k = SKEY(), h: Record<string, string> = { apikey: k, "Content-Type": "application/json", ...extra };
  if (k.startsWith("eyJ")) h.Authorization = `Bearer ${k}`; // chave antiga (JWT); as novas sb_secret_ vão só em apikey
  return h;
};
const ROLES = ["admin", "editor", "viewer", "berth"];
const TERMS = ["tcg", "ct"];
const terms = (x: unknown) => Array.isArray(x) ? [...new Set(x.map(String).filter((t) => TERMS.includes(t)))].sort() : [];
const okEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

class Fail extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function callerRole(auth: string | null, apikey: string | null): Promise<{ role: string | null; email: string }> {
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return { role: null, email: "" };
  const h = { apikey: apikey || env("SUPABASE_ANON_KEY"), Authorization: auth, "Content-Type": "application/json" };
  // my_access (06) só devolve o nível quando a verificação em dois passos está cumprida; sem o 06, usa my_role (05).
  let r = await fetch(`${URL_()}/rest/v1/rpc/my_access`, { method: "POST", headers: h, body: "{}" });
  if (r.status === 404) r = await fetch(`${URL_()}/rest/v1/rpc/my_role`, { method: "POST", headers: h, body: "{}" });
  if (r.status === 404) throw new Fail("Corra primeiro o ficheiro supabase/05-utilizadores-e-copias.sql no SQL Editor.", 412);
  const role = r.ok ? await r.json() : null;
  const u = await fetch(`${URL_()}/auth/v1/user`, { headers: h });
  const email = u.ok ? ((await u.json()).email || "").toLowerCase() : "";
  return { role: typeof role === "string" ? role : null, email };
}

function tempPassword(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ", a = "abcdefghijkmnopqrstuvwxyz", n = "23456789", s = "!@#%*?";
  const all = A + a + n + s, b = new Uint32Array(14); crypto.getRandomValues(b);
  const pick = (set: string, i: number) => set[b[i] % set.length];
  const chars = [pick(A, 0), pick(a, 1), pick(n, 2), pick(s, 3), ...Array.from({ length: 10 }, (_, i) => pick(all, i + 4))];
  for (let i = chars.length - 1; i > 0; i--) { const j = b[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
function checkPassword(p: string) {
  if (p.length < 10) throw new Fail("A palavra-passe temporária tem de ter pelo menos 10 caracteres.");
  if (/^(cornelder|password|12345678|porto|beira)/i.test(p)) throw new Fail("Escolha uma palavra-passe menos previsível (não use o nome da empresa).");
}

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_()}/rest/v1/${path}`, { ...init, headers: svc((init.headers as Record<string, string>) || {}) });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* texto */ }
  if (!r.ok) throw new Fail((j && (j.message || j.hint)) || `Base de dados: HTTP ${r.status}`, r.status);
  return j;
}
async function admin(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_()}/auth/v1/admin/${path}`, { ...init, headers: svc() });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* texto */ }
  if (!r.ok) throw new Fail((j && (j.msg || j.message || j.error_description)) || `Autenticação: HTTP ${r.status}`, r.status);
  return j;
}
async function authUsers(): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const j = await admin(`users?page=${page}&per_page=200`);
    const list = Array.isArray(j) ? j : (j.users || []);
    out.push(...list); if (list.length < 200) break;
  }
  return out;
}
const findUser = async (email: string) => (await authUsers()).find((u) => (u.email || "").toLowerCase() === email);
// editors.user_id (SQL 08). Sem o 08 a coluna não existe: grava sem ela.
const noCol = (e: unknown) => /user_id/.test(String((e as Error)?.message || "")) && /column|schema cache/i.test(String((e as Error)?.message || ""));
async function upsertEditor(withId: Record<string, unknown>, without: Record<string, unknown>) {
  const go = (b: unknown) => rest("editors?on_conflict=email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(b) });
  try { await go(withId); } catch (e) { if (noCol(e)) await go(without); else throw e; }
}
async function bindEditor(email: string, uid: string) {
  try { await rest(`editors?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: uid }) }); }
  catch (e) { if (!noCol(e)) throw e; }
}

Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { const f = e instanceof Fail ? e : new Fail(String((e as any)?.message || e), 500); return json({ error: f.message }, f.status); }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ ok: true, function: "cdm-admin", version: VERSION, serviceKey: !!SKEY() });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!SKEY()) throw new Fail("Falta a chave de serviço: defina o segredo CDM_SERVICE_KEY em Edge Functions → Secrets.", 500);
  const me = await callerRole(req.headers.get("Authorization"), req.headers.get("apikey"));
  if (me.role !== "admin") return json({ error: "Só administradores com a verificação em dois passos confirmada podem gerir utilizadores." }, 403);
  let body: any = {}; try { body = await req.json(); } catch { /* vazio */ }
  const email = String(body.email || "").trim().toLowerCase();

  switch (body.action) {
    case "list": {
      const eds0 = rest("editors?select=email,name,role,active,terminals,user_id,created_at&order=created_at.asc").catch(() => rest("editors?select=email,name,role,active,terminals,created_at&order=created_at.asc")).catch(() => rest("editors?select=email,name,role,active,created_at&order=created_at.asc"));
      const [eds, us] = await Promise.all([eds0, authUsers()]);
      const by = new Map(us.map((u: any) => [(u.email || "").toLowerCase(), u]));
      return json({ me: me.email, users: eds.map((e: any) => { const u: any = by.get(e.email); return { ...e, account: !!u, confirmed: !!(u && (u.email_confirmed_at || u.confirmed_at)), last_sign_in: u?.last_sign_in_at || null, must_change: !!u?.user_metadata?.must_change, linked: e.user_id === undefined ? null : !!(u && e.user_id === u.id), mfa: !!(u?.factors || []).some((f: any) => f.status === "verified") }; }) });
    }
    case "create": {
      if (!okEmail(email)) throw new Fail("Email inválido.");
      const role = ROLES.includes(body.role) ? body.role : "editor", name = String(body.name || "").trim().slice(0, 80), tm = terms(body.terminals);
      if (role === "berth" && !tm.length) throw new Fail("Escolha o terminal (TCG e/ou CT) para o nível Planeamento.");
      const pw = body.password ? String(body.password) : tempPassword(); checkPassword(pw);
      let existed = false, uid: string | null = null;
      try { const c = await admin("users", { method: "POST", body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name, must_change: true } }) }); uid = (c && (c.id || c.user?.id)) || null; }
      catch (e) { if ((e as Fail).status === 422 || /already/i.test((e as Error).message)) existed = true; else throw e; }
      // conta já existente (por exemplo criada por fora): recebe a nova palavra-passe e passa a ser desta pessoa
      if (existed) { const u = await findUser(email); if (u) { uid = u.id; await admin(`users/${u.id}`, { method: "PUT", body: JSON.stringify({ password: pw, user_metadata: { ...(u.user_metadata || {}), name: name || u.user_metadata?.name, must_change: true } }) }); } }
      if (!uid) { const u = await findUser(email); uid = u ? u.id : null; }
      const row: Record<string, unknown> = role === "berth" ? { email, name: name || null, role, active: true, terminals: tm } : { email, name: name || null, role, active: true };
      await upsertEditor({ ...row, user_id: uid }, row);
      return json({ ok: true, email, role, terminals: tm, password: pw, existed });
    }
    case "reset": {
      const u = await findUser(email); if (!u) throw new Fail("Não existe conta com este email.", 404);
      const pw = body.password ? String(body.password) : tempPassword(); checkPassword(pw);
      await admin(`users/${u.id}`, { method: "PUT", body: JSON.stringify({ password: pw, user_metadata: { ...(u.user_metadata || {}), must_change: true } }) });
      await bindEditor(email, u.id);
      return json({ ok: true, email, password: pw });
    }
    case "update": {
      const patch: Record<string, unknown> = {};
      if (body.role !== undefined) { if (!ROLES.includes(body.role)) throw new Fail("Nível inválido."); patch.role = body.role; }
      if (body.terminals !== undefined) patch.terminals = terms(body.terminals);
      if (patch.role === "berth" && patch.terminals === undefined) { const cur = await rest(`editors?select=terminals&email=eq.${encodeURIComponent(email)}`).catch(() => []); const t0 = terms(cur && cur[0] && cur[0].terminals); patch.terminals = t0.length ? t0 : ["tcg"]; }
      if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 80) || null;
      if (body.active !== undefined) patch.active = !!body.active;
      if (email === me.email && (patch.role && patch.role !== "admin" || patch.active === false)) throw new Fail("Não pode baixar o seu próprio nível nem suspender a sua conta.");
      await rest(`editors?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      return json({ ok: true });
    }
    case "mfareset": {
      const u = await findUser(email); if (!u) throw new Fail("Não existe conta com este email.", 404);
      if (email === me.email) throw new Fail("Não pode repor a sua própria verificação. Peça a outro administrador.");
      let n = 0;
      for (const f of (u.factors || [])) { await admin(`users/${u.id}/factors/${f.id}`, { method: "DELETE" }); n++; }
      return json({ ok: true, removed: n });
    }
    case "remove": {
      if (email === me.email) throw new Fail("Não pode retirar o seu próprio acesso.");
      await rest(`editors?email=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (body.deleteAccount) { const u = await findUser(email); if (u) await admin(`users/${u.id}`, { method: "DELETE" }); }
      return json({ ok: true });
    }
  }
  return json({ error: "action" }, 400);
}
