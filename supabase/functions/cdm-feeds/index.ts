// ============================================================
// Port of Beira · Edge Function "cdm-feeds"
// Usada pelo CMS (só editores):
//   POST { kind: "news", topics: [{label, query, lang}], sources: [{label, url}], google: true }
//        → alertas: Google Notícias (RSS) + sites indicados (WordPress: pesquisa; senão RSS /feed/; senão links da página inicial)
//   POST { kind: "social" }                                 → comentários no Facebook, Instagram e LinkedIn
// Segredos (Supabase → Edge Functions → Secrets), todos opcionais:
//   FB_PAGE_ID, FB_PAGE_TOKEN          página de Facebook + token de página (pages_read_engagement, pages_read_user_content)
//   IG_USER_ID                          conta Instagram profissional ligada à página (usa FB_PAGE_TOKEN; instagram_basic, instagram_manage_comments)
//   LI_ORG_URN, LI_TOKEN, LI_VERSION    LinkedIn: urn:li:organization:123, token com r_organization_social (Community Management API), versão AAAAMM
//   GRAPH_VERSION                       por defeito v23.0
// SUPABASE_URL e SUPABASE_ANON_KEY são fornecidos automaticamente pelo Supabase.
// Segurança (2.29.1): os sites de "Fontes de notícias" só são lidos por https, em servidores públicos
// (recusa localhost, redes privadas e endereços internos, também depois de redireccionamentos),
// com tempo e tamanho máximos; os erros devolvidos ao CMS são genéricos. Opcional:
//   NEWS_ALLOWED_HOSTS  lista de domínios permitidos, separados por vírgulas (ex.: fimdesemana.co.mz,clubofmozambique.com)
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const iso = (s: string) => { const d = new Date(s || ""); return isNaN(+d) ? "" : d.toISOString(); };
type Item = { network: string; id: string; text: string; author: string; created: string; url: string; postText?: string; postUrl?: string; topic?: string; source?: string };

// ---------- só utilizadores do CMS: Administrador, Editor e Consulta (is_member, 05/06; sem o 05 usa is_editor) ----------
// O Planeamento não tem acesso (my_role não o devolve, ver 07).
async function isMember(auth: string | null, apikey: string | null): Promise<boolean> {
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return false;
  const h = { apikey: apikey || env("SUPABASE_ANON_KEY"), Authorization: auth, "Content-Type": "application/json" };
  let r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/is_member`, { method: "POST", headers: h, body: "{}" });
  if (r.status === 404) r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/is_editor`, { method: "POST", headers: h, body: "{}" });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

// ---------- pedidos a sites externos: só https e só servidores públicos (S-06) ----------
class Blocked extends Error {}
const ALLOWED = env("NEWS_ALLOWED_HOSTS").split(",").map((h) => h.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean);
function v4Private(ip: string): boolean {
  const p = ip.split(".").map(Number); if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19));
}
function v6Private(ip: string): boolean {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const m = x.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/); if (m) return v4Private(m[1]);
  const mh = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mh) { const a = parseInt(mh[1], 16), b = parseInt(mh[2], 16); return v4Private(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8:");
}
const isV4 = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h);
async function checkHost(hostname: string): Promise<void> {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[")) { if (v6Private(h)) throw new Blocked("Endereço não permitido."); return; }
  if (isV4(h)) { if (v4Private(h)) throw new Blocked("Endereço não permitido."); return; }
  if (!h.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h)) throw new Blocked("Endereço não permitido.");
  if (ALLOWED.length && !ALLOWED.some((a) => h === a || h.endsWith("." + a))) throw new Blocked("Este site não está na lista de fontes permitidas.");
  // nomes que apontam para redes internas
  for (const t of ["A", "AAAA"] as const) {
    let ips: string[] = [];
    try { ips = await (Deno as any).resolveDns(h, t); } catch { continue; }
    if (ips.some((ip) => (t === "A" ? v4Private(ip) : v6Private(ip)))) throw new Blocked("Endereço não permitido.");
  }
}
// https apenas, porta 443, redireccionamentos verificados um a um (máx. 3), 10 s
async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let u = new URL(url);
  for (let hop = 0; hop <= 3; hop++) {
    if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) throw new Blocked("Só são aceites endereços https.");
    await checkHost(u.hostname);
    const r = await fetch(u.href, { ...init, redirect: "manual", signal: AbortSignal.timeout(10000) });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { try { await r.body?.cancel(); } catch { /* */ } u = new URL(loc, u); continue; }
    return r;
  }
  throw new Blocked("Demasiados redireccionamentos.");
}
// lê no máximo 3 MB
async function readText(r: Response, max = 3_000_000): Promise<string> {
  const rd = r.body?.getReader(); if (!rd) return "";
  const chunks: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > max) { try { await rd.cancel(); } catch { /* */ } break; } chunks.push(value); }
  const all = new Uint8Array(chunks.reduce((k, c) => k + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}
const publicError = (e: unknown) => e instanceof Blocked ? e.message : "Não foi possível ler esta fonte.";

// ---------- cache simples em memória (a função pode reiniciar a qualquer momento) ----------
const cache = new Map<string, { t: number; v: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ms) return c.v as T;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// ---------- alertas: Google Notícias (RSS) ----------
const GN = env("GN_BASE", "https://news.google.com");
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").trim();
const tag = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ""; };

async function newsFor(topic: { label: string; query: string; lang?: string }): Promise<Item[]> {
  const langs = topic.lang === "pt" ? [["pt-PT", "MZ", "MZ:pt-150"]] : topic.lang === "en" ? [["en", "ZA", "ZA:en"]] : [["pt-PT", "MZ", "MZ:pt-150"], ["en", "ZA", "ZA:en"]];
  const out: Item[] = [];
  for (const [hl, gl, ceid] of langs) {
    const url = `${GN}/rss/search?q=${encodeURIComponent(topic.query + " when:30d")}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
    const xml = await cached("gn:" + url, 10 * 60e3, async () => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`Google HTTP ${r.status}`); return await r.text(); });
    for (const m of (xml as string).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const x = m[1], title = tag(x, "title"), link = tag(x, "link"), source = tag(x, "source");
      const d = new Date(tag(x, "pubDate"));
      if (!title || !link) continue;
      out.push({ network: "news", id: link, text: title.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), ""), author: source, source, created: isNaN(+d) ? "" : d.toISOString(), url: link, topic: topic.label });
    }
  }
  return out;
}

// ---------- alertas: sites indicados pelo CMS ----------
// termos de pesquisa a partir das consultas: "Porto da Beira" OR "Port of Beira" → ["porto da beira","port of beira"]
function terms(q: string): string[] {
  const out: string[] = [];
  for (const part of q.split(/\s+OR\s+/i)) { const t = part.replace(/["()]/g, " ").replace(/\s+/g, " ").trim(); if (t.length > 2) out.push(t.toLowerCase()); }
  return out;
}
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function matchTopics(text: string, topics: { label: string; query: string }[]): string[] {
  const t = fold(text);
  return topics.filter((tp) => terms(tp.query).some((term) => fold(term).split(" ").every((w) => w.length < 3 || t.includes(w)))).map((tp) => tp.label);
}
const UA = { "User-Agent": "Mozilla/5.0 (compatible; CdM-CMS-alerts/1.0)", Accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8" };
async function siteNews(src: { label: string; url: string }, topics: { label: string; query: string }[]): Promise<{ items: Item[]; via: string }> {
  let base = src.url.trim().replace(/^http:\/\//i, "https://"); if (!/^https:\/\//i.test(base)) base = "https://" + base.replace(/^[a-z]+:\/\//i, ""); base = base.replace(/\/+$/, "");
  await checkHost(new URL(base).hostname);
  const host = new URL(base).host, name = src.label || host, items: Item[] = [];
  const push = (title: string, link: string, date: string, extra = "") => {
    const tps = matchTopics(title + " " + extra, topics); if (!tps.length || !title || !link) return;
    items.push({ network: "news", id: link, text: title, author: name, source: name, created: date, url: link, topic: tps.join(" · ") });
  };
  // 1) WordPress: pesquisa por cada termo (rápido e preciso)
  try {
    const qs = [...new Set(topics.flatMap((t) => terms(t.query)))].slice(0, 20); let ok = false;
    for (const q of qs) {
      const r = await safeFetch(`${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&_fields=title,link,date_gmt,excerpt`, { headers: UA });
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) break;
      ok = true;
      for (const p of JSON.parse(await readText(r))) push(decode(p.title?.rendered || ""), p.link, p.date_gmt ? new Date(p.date_gmt + "Z").toISOString() : "", decode(p.excerpt?.rendered || ""));
    }
    if (ok) return { items: [...new Map(items.map((i) => [i.url, i])).values()], via: "wordpress" };
  } catch { /* segue */ }
  // 2) RSS (/feed/ ou o próprio endereço)
  for (const u of [base, base + "/feed/", base + "/rss"]) {
    try {
      const r = await safeFetch(u, { headers: UA }); if (!r.ok) continue; const x = await readText(r);
      if (!/<rss|<feed/i.test(x.slice(0, 2000))) continue;
      for (const m of x.matchAll(/<(item|entry)>([\s\S]*?)<\/\1>/g)) {
        const it = m[2], link = tag(it, "link") || ((it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ""), d = new Date(tag(it, "pubDate") || tag(it, "updated") || tag(it, "published"));
        push(tag(it, "title"), link, isNaN(+d) ? "" : d.toISOString(), tag(it, "description") || tag(it, "summary"));
      }
      return { items, via: "rss" };
    } catch { /* segue */ }
  }
  // 3) página inicial: links com títulos
  const r = await safeFetch(base, { headers: UA }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await readText(r);
  for (const m of html.matchAll(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]{20,300}?)<\/a>/g)) {
    let link = m[1]; const title = decode(m[2]); if (title.length < 20) continue;
    try { link = new URL(link, base + "/").href; } catch { continue; } if (new URL(link).host !== host) continue;
    push(title, link, "");
  }
  return { items: [...new Map(items.map((i) => [i.url, i])).values()], via: "pagina" };
}

// ---------- comentários: Facebook, Instagram, LinkedIn ----------
const GRAPH = `${env("GRAPH_BASE", "https://graph.facebook.com")}/${env("GRAPH_VERSION", "v23.0")}`;
async function gget(path: string, token: string) {
  const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j;
}
async function facebook(): Promise<Item[]> {
  const id = env("FB_PAGE_ID"), tk = env("FB_PAGE_TOKEN");
  if (!id || !tk) throw new Error("não configurado");
  const j = await gget(`${id}/posts?fields=id,message,permalink_url,created_time,comments.limit(50).order(reverse_chronological){id,message,from,created_time,permalink_url}&limit=25`, tk);
  const out: Item[] = [];
  for (const p of j.data || []) for (const c of p.comments?.data || [])
    out.push({ network: "facebook", id: c.id, text: c.message || "", author: c.from?.name || "", created: iso(c.created_time), url: c.permalink_url || p.permalink_url, postText: (p.message || "").slice(0, 160), postUrl: p.permalink_url });
  return out;
}
async function instagram(): Promise<Item[]> {
  const id = env("IG_USER_ID"), tk = env("FB_PAGE_TOKEN");
  if (!id || !tk) throw new Error("não configurado");
  const j = await gget(`${id}/media?fields=id,caption,permalink,timestamp,comments.limit(50){id,text,username,timestamp}&limit=25`, tk);
  const out: Item[] = [];
  for (const p of j.data || []) for (const c of p.comments?.data || [])
    out.push({ network: "instagram", id: c.id, text: c.text || "", author: c.username ? "@" + c.username : "", created: iso(c.timestamp), url: p.permalink, postText: (p.caption || "").slice(0, 160), postUrl: p.permalink });
  return out;
}
async function linkedin(): Promise<Item[]> {
  const urn = env("LI_ORG_URN"), tk = env("LI_TOKEN");
  if (!urn || !tk) throw new Error("não configurado");
  const base = env("LI_BASE", "https://api.linkedin.com");
  const h = { Authorization: `Bearer ${tk}`, "LinkedIn-Version": env("LI_VERSION", "202509"), "X-Restli-Protocol-Version": "2.0.0" };
  const pr = await fetch(`${base}/rest/posts?author=${encodeURIComponent(urn)}&q=author&count=15&sortBy=LAST_MODIFIED`, { headers: h });
  const pj = await pr.json().catch(() => ({}));
  if (!pr.ok) throw new Error(pj.message || `HTTP ${pr.status}`);
  const out: Item[] = [];
  for (const p of (pj.elements || []).slice(0, 15)) {
    const post = `https://www.linkedin.com/feed/update/${p.id}`;
    const cr = await fetch(`${base}/rest/socialActions/${encodeURIComponent(p.id)}/comments?count=50`, { headers: h });
    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok) continue;
    for (const c of cj.elements || [])
      out.push({ network: "linkedin", id: c.id || c.$URN || String(c.created?.time), text: c.message?.text || "", author: "", created: c.created?.time ? new Date(c.created.time).toISOString() : "", url: post, postText: (p.commentary || "").slice(0, 160), postUrl: post });
  }
  return out;
}

const VERSION = "2.29.1";
Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { console.error("cdm-feeds", e); return json({ error: "Erro na função. Veja os registos (Logs) da função no Supabase." }, 500); }
});
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // abrir o endereço no navegador confirma que a função está publicada e acessível
  if (req.method === "GET") return json({ ok: true, function: "cdm-feeds", version: VERSION, message: "A função está publicada. O CMS usa-a com a sessão de um editor." });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!(await isMember(req.headers.get("Authorization"), req.headers.get("apikey")))) return json({ error: "Sem acesso: apenas utilizadores do CMS." }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }

  if (body.kind === "news") {
    const topics = (Array.isArray(body.topics) ? body.topics : []).filter((t: any) => t && typeof t.query === "string" && t.query.trim())
      .slice(0, 15).map((t: any) => ({ label: String(t.label || t.query).slice(0, 60), query: String(t.query).slice(0, 200), lang: ["pt", "en"].includes(t.lang) ? t.lang : "both" }));
    const sources = (Array.isArray(body.sources) ? body.sources : []).filter((x: any) => x && typeof x.url === "string" && x.url.trim()).slice(0, 10).map((x: any) => ({ label: String(x.label || "").slice(0, 60), url: String(x.url).slice(0, 300) }));
    const useGoogle = body.google !== false;
    const res: PromiseSettledResult<Item[]>[] = useGoogle ? await Promise.allSettled(topics.map(newsFor)) : [];
    const sres = await Promise.allSettled(sources.map((s: any) => cached("site:" + s.url + JSON.stringify(topics), 10 * 60e3, () => siteNews(s, topics))));
    const status: { name: string; ok: boolean; count?: number; via?: string; error?: string }[] = [];
    if (useGoogle) { const n = res.reduce((k, r) => k + (r.status === "fulfilled" ? r.value.length : 0), 0); const bad = res.filter((r) => r.status === "rejected").length; status.push({ name: "Google Notícias", ok: n > 0 || !bad, count: n, error: bad ? `${bad} temas com erro` : (n ? undefined : "0 resultados (o Google pode estar a limitar os pedidos do servidor)") }); }
    sres.forEach((r, i) => { if (r.status === "fulfilled") { res.push({ status: "fulfilled", value: r.value.items }); status.push({ name: sources[i].label || sources[i].url, ok: true, count: r.value.items.length, via: r.value.via }); } else { console.error("cdm-feeds fonte", sources[i].url, r.reason); status.push({ name: sources[i].label || sources[i].url, ok: false, error: publicError(r.reason) }); } });
    const seen = new Map<string, Item>();
    res.forEach((r) => { if (r.status === "fulfilled") for (const it of r.value) { const k = it.text.toLowerCase().replace(/\W+/g, " ").trim(); const prev = seen.get(k); if (!prev) seen.set(k, { ...it }); else prev.topic = [...new Set([...(prev.topic || "").split(" · "), ...(it.topic || "").split(" · ")].filter(Boolean))].join(" · "); } });
    const items = [...seen.values()].sort((a, b) => (b.created || "").localeCompare(a.created || "")).slice(0, 200);
    return json({ items, status, at: new Date().toISOString() });
  }

  if (body.kind === "social") {
    const nets: [string, () => Promise<Item[]>][] = [["facebook", facebook], ["instagram", instagram], ["linkedin", linkedin]];
    const res = await Promise.allSettled(nets.map(([n, f]) => cached("social:" + n, 5 * 60e3, f)));
    const items: Item[] = [], status: Record<string, string> = {};
    res.forEach((r, i) => { const n = nets[i][0]; if (r.status === "fulfilled") { items.push(...r.value); status[n] = "ok"; } else { console.error("cdm-feeds", n, r.reason); const m = String(r.reason?.message || r.reason); status[n] = /configurad/i.test(m) ? m : "Erro ao ler esta rede. Veja os registos da função."; } });
    items.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    return json({ items: items.slice(0, 300), status, at: new Date().toISOString() });
  }
  return json({ error: "kind" }, 400);
}
