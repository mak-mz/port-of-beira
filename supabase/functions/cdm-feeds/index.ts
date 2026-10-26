// ============================================================
// Port of Beira · Edge Function "cdm-feeds"
// Usada pelo CMS (só editores):
//   POST { kind: "news", topics: [{label, query, lang}] }  → alertas de notícias (Google Notícias RSS)
//   POST { kind: "social" }                                 → comentários no Facebook, Instagram e LinkedIn
// Segredos (Supabase → Edge Functions → Secrets), todos opcionais:
//   FB_PAGE_ID, FB_PAGE_TOKEN          página de Facebook + token de página (pages_read_engagement, pages_read_user_content)
//   IG_USER_ID                          conta Instagram profissional ligada à página (usa FB_PAGE_TOKEN; instagram_basic, instagram_manage_comments)
//   LI_ORG_URN, LI_TOKEN, LI_VERSION    LinkedIn: urn:li:organization:123, token com r_organization_social (Community Management API), versão AAAAMM
//   GRAPH_VERSION                       por defeito v23.0
// SUPABASE_URL e SUPABASE_ANON_KEY são fornecidos automaticamente pelo Supabase.
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

// ---------- só editores (usa a função is_editor() criada em 01-estrutura.sql) ----------
async function isEditor(auth: string | null): Promise<boolean> {
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return false;
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/is_editor`, {
    method: "POST",
    headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: auth, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

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
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").trim();
const tag = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ""; };

async function newsFor(topic: { label: string; query: string; lang?: string }): Promise<Item[]> {
  const langs = topic.lang === "pt" ? [["pt-PT", "MZ", "MZ:pt-150"]] : topic.lang === "en" ? [["en", "ZA", "ZA:en"]] : [["pt-PT", "MZ", "MZ:pt-150"], ["en", "ZA", "ZA:en"]];
  const out: Item[] = [];
  for (const [hl, gl, ceid] of langs) {
    const url = `${GN}/rss/search?q=${encodeURIComponent(topic.query + " when:30d")}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
    const xml = await cached("gn:" + url, 10 * 60e3, async () => { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (CdM CMS alerts)" } }); return r.ok ? await r.text() : ""; });
    for (const m of (xml as string).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const x = m[1], title = tag(x, "title"), link = tag(x, "link"), source = tag(x, "source");
      const d = new Date(tag(x, "pubDate"));
      if (!title || !link) continue;
      out.push({ network: "news", id: link, text: title.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), ""), author: source, source, created: isNaN(+d) ? "" : d.toISOString(), url: link, topic: topic.label });
    }
  }
  return out;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!(await isEditor(req.headers.get("Authorization")))) return json({ error: "Sem acesso: apenas editores." }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }

  if (body.kind === "news") {
    const topics = (Array.isArray(body.topics) ? body.topics : []).filter((t: any) => t && typeof t.query === "string" && t.query.trim())
      .slice(0, 15).map((t: any) => ({ label: String(t.label || t.query).slice(0, 60), query: String(t.query).slice(0, 200), lang: ["pt", "en"].includes(t.lang) ? t.lang : "both" }));
    const res = await Promise.allSettled(topics.map(newsFor));
    const seen = new Map<string, Item>();
    res.forEach((r) => { if (r.status === "fulfilled") for (const it of r.value) { const k = it.text.toLowerCase().replace(/\W+/g, " ").trim(); const prev = seen.get(k); if (!prev) seen.set(k, it); else if (prev.topic && it.topic && !prev.topic.split(" · ").includes(it.topic)) prev.topic += " · " + it.topic; } });
    const items = [...seen.values()].sort((a, b) => (b.created || "").localeCompare(a.created || "")).slice(0, 200);
    return json({ items, errors: res.map((r, i) => r.status === "rejected" ? { topic: topics[i].label, error: String(r.reason?.message || r.reason) } : null).filter(Boolean), at: new Date().toISOString() });
  }

  if (body.kind === "social") {
    const nets: [string, () => Promise<Item[]>][] = [["facebook", facebook], ["instagram", instagram], ["linkedin", linkedin]];
    const res = await Promise.allSettled(nets.map(([n, f]) => cached("social:" + n, 5 * 60e3, f)));
    const items: Item[] = [], status: Record<string, string> = {};
    res.forEach((r, i) => { const n = nets[i][0]; if (r.status === "fulfilled") { items.push(...r.value); status[n] = "ok"; } else status[n] = String(r.reason?.message || r.reason); });
    items.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    return json({ items: items.slice(0, 300), status, at: new Date().toISOString() });
  }
  return json({ error: "kind" }, 400);
});
