/* Camada de dados partilhada entre o site e o CMS — versão 2 (Supabase).
   1) Se config.js tiver o URL e a chave publicável do Supabase → modo "supabase":
      conteúdo na tabela site_content, mensagens na tabela inbox, ficheiros no bucket "media",
      login do CMS com Supabase Auth (email + palavra-passe).
   2) Dentro do Claude → base de dados do artefacto.
   3) Sem configuração → IndexedDB do navegador (modo local, como a versão 1). */
const Store=(function(){
  const KEY="cdm-port-of-beira-content-v3",IKEY="cdm-port-of-beira-inbox-v1",DBN="cdm-port-of-beira",SKEY="cdm-sb-session",CKEY="cdm-sb-cache";
  let mode="local",db=null,assets=null,user=null,downloads=null,idb=null,bc=null;
  /* ---------- Supabase (REST, sem bibliotecas externas) ---------- */
  const CFG=(()=>{const c=window.CDM_SUPABASE||{};const url=String(c.url||"").trim().replace(/\/+$/,"").replace(/\/(rest|auth|storage)\/v1.*$/,"").replace(/\/+$/,""),key=String(c.key||c.anonKey||"").trim();
    return url&&key&&/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(url+"/")&&!/COLE|PASTE|xxxx/i.test(url+key)?{url,key,bucket:c.bucket||"media"}:null})();
  let sess=null,inboxCb=null,contentCb=null,lastStamp=null,timers=[];
  const lsGet=k=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null}catch(e){return null}};
  const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
  function SBErr(msg,status,code){const e=new Error(msg);e.status=status;e.code=code;return e}
  async function sb(path,opt={},auth=true){
    if(auth)await fresh();
    const h=Object.assign({apikey:CFG.key},opt.headers||{});
    if(auth&&sess)h.Authorization="Bearer "+sess.access_token;else if(!/^sb_/.test(CFG.key))h.Authorization="Bearer "+CFG.key;
    if(opt.json!==undefined){h["Content-Type"]="application/json";opt.body=JSON.stringify(opt.json)}
    const r=await fetch(CFG.url+path,{method:opt.method||"GET",headers:h,body:opt.body,cache:"no-store"});
    const txt=await r.text();let j=null;try{j=txt?JSON.parse(txt):null}catch(e){}
    if(!r.ok)throw SBErr((j&&(j.msg||j.message||j.error_description||j.error))||("HTTP "+r.status),r.status,j&&(j.error_code||j.code));
    return j;
  }
  function keep(s){if(!s||!s.access_token){sess=null;lsSet(SKEY,null);return null}
    sess={access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at||Math.floor(Date.now()/1000)+(+s.expires_in||3600),user:s.user||(sess&&sess.user)||null};lsSet(SKEY,sess);return sess}
  let refreshing=null;
  async function fresh(){
    if(!sess||!sess.refresh_token)return;
    if(sess.expires_at-60>Date.now()/1000)return;
    if(!refreshing)refreshing=(async()=>{try{const s=await sb("/auth/v1/token?grant_type=refresh_token",{method:"POST",json:{refresh_token:sess.refresh_token}},false);keep(s)}catch(e){if(e.status>=400&&e.status<500)keep(null)}finally{refreshing=null}})();
    await refreshing;
  }
  const auth={
    get configured(){return!!CFG},
    get session(){return sess},
    get email(){return sess&&sess.user&&sess.user.email||""},
    async signIn(email,password){const s=await sb("/auth/v1/token?grant_type=password",{method:"POST",json:{email,password}},false);keep(s);return s.user},
    async signUp(email,password){const s=await sb("/auth/v1/signup",{method:"POST",json:{email,password}},false);if(s&&s.access_token)keep(s);return s},
    async recover(email,redirectTo){await sb("/auth/v1/recover",{method:"POST",json:{email,redirect_to:redirectTo||location.href.split("#")[0]}},false)},
    async setPassword(password){const u=await sb("/auth/v1/user",{method:"PUT",json:{password}});if(sess)sess.user=u;lsSet(SKEY,sess);return u},
    async signOut(){try{await sb("/auth/v1/logout",{method:"POST"})}catch(e){}keep(null)},
    async isEditor(){if(!sess)return false;try{return(await sb("/rest/v1/rpc/is_editor",{method:"POST",json:{}}))===true}catch(e){return false}},
    /* nível de acesso (05-utilizadores-e-copias.sql): admin | editor | viewer; sem esse ficheiro, editor = admin */
    /* 07-planeamento-atracacao.sql: cms_role inclui "berth" (Planeamento); sem esse ficheiro, usa my_role */
    async role(){if(!sess)return null;try{const r=await sb("/rest/v1/rpc/cms_role",{method:"POST",json:{}});return typeof r==="string"?r:null}catch(e){if(!(e.status===404||/cms_role|PGRST202/i.test(e.message||"")))return null}
      try{const r=await sb("/rest/v1/rpc/my_role",{method:"POST",json:{}});return typeof r==="string"?r:null}
      catch(e){if(e.status===404||/my_role|PGRST202/i.test(e.message||""))return(await this.isEditor())?"admin":null;return null}},
    /* terminais do Planeamento ("tcg", "ct") */
    async terminals(){if(!sess)return[];try{const r=await sb("/rest/v1/rpc/berth_terminals",{method:"POST",json:{}});return Array.isArray(r)?r:[]}catch(e){return[]}},
    /* verificação em dois passos (06-verificacao-dois-passos.sql) */
    get aal(){try{const p=sess.access_token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");return JSON.parse(atob(p+"===".slice((p.length+3)%4))).aal||"aal1"}catch(e){return"aal1"}},
    async mfaState(){if(!sess)return null;try{return await sb("/rest/v1/rpc/mfa_state",{method:"POST",json:{}})}catch(e){if(e.status===404||/mfa_state|PGRST202/i.test(e.message||""))return null;throw e}},
    async mfaFactors(){const u=await sb("/auth/v1/user");if(sess){sess.user=u;lsSet(SKEY,sess)}return(u&&u.factors||[]).filter(f=>f.factor_type==="totp")},
    async mfaEnroll(){const fs=await this.mfaFactors();for(const f of fs)if(f.status!=="verified")try{await sb("/auth/v1/factors/"+f.id,{method:"DELETE"})}catch(e){}
      const r=await sb("/auth/v1/factors",{method:"POST",json:{factor_type:"totp",friendly_name:"CMS "+new Date().toISOString().slice(0,16).replace("T"," "),issuer:"Port of Beira CMS"}});
      /* o Supabase devolve o SVG do QR sem codificar ("#" das cores corta o endereço data:) → recodificar */
      let qr=r.totp&&r.totp.qr_code||"";const m=qr.match(/^data:image\/svg\+xml[^,]*,([\s\S]*)$/);
      if(m){let svg=m[1];if(!/^\s*</.test(svg))try{svg=decodeURIComponent(svg)}catch(e){}qr="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)}
      return{id:r.id,qr,secret:r.totp&&r.totp.secret,uri:r.totp&&r.totp.uri}},
    async mfaVerify(factorId,code){const c=await sb("/auth/v1/factors/"+factorId+"/challenge",{method:"POST",json:{}});
      const s=await sb("/auth/v1/factors/"+factorId+"/verify",{method:"POST",json:{challenge_id:c.id,code:String(code).replace(/\D/g,"")}});keep(s);return s},
    async mfaRemove(factorId){await sb("/auth/v1/factors/"+factorId,{method:"DELETE"})},
    get mustChange(){return!!(sess&&sess.user&&sess.user.user_metadata&&sess.user.user_metadata.must_change)},
    async finishFirst(password){const u=await sb("/auth/v1/user",{method:"PUT",json:{password,data:{must_change:false}}});if(sess)sess.user=u;lsSet(SKEY,sess);return u},
    /* link de email (recuperação/convite/confirmação) devolve #access_token=… no URL */
    async fromLink(){const h=location.hash.replace(/^#/,"");if(!/access_token=/.test(h))return null;const p=new URLSearchParams(h);
      keep({access_token:p.get("access_token"),refresh_token:p.get("refresh_token"),expires_in:p.get("expires_in")});
      try{sess.user=await sb("/auth/v1/user");lsSet(SKEY,sess)}catch(e){}
      try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}
      return p.get("type")||"link"},
    async editors(){return await sb("/rest/v1/editors?select=email,created_at&order=created_at.asc")||[]},
    async addEditor(email){await sb("/rest/v1/editors",{method:"POST",json:{email:String(email).trim().toLowerCase()},headers:{Prefer:"return=minimal"}})},
    async removeEditor(email){await sb("/rest/v1/editors?email=eq."+encodeURIComponent(email),{method:"DELETE"})},
    async backups(){return await sb("/rest/v1/site_backups?select=id,created_at,kind,created_by,size_bytes&order=created_at.desc&limit=60")||[]},
    async backup(id){const r=await sb("/rest/v1/site_backups?select=data,created_at&id=eq."+encodeURIComponent(id));return r&&r[0]?r[0]:null},
    async backupNow(){return await sb("/rest/v1/rpc/cdm_backup_now",{method:"POST",json:{}})},
    async backupDel(id){await sb("/rest/v1/site_backups?id=eq."+encodeURIComponent(id),{method:"DELETE"})},
    async history(){return await sb("/rest/v1/site_content_history?select=id,saved_at,saved_by&order=saved_at.desc&limit=30")||[]},
    async version(id){const r=await sb("/rest/v1/site_content_history?select=body&id=eq."+encodeURIComponent(id));return r&&r[0]?r[0].body:null}
  };
  async function sbContent(){const r=await sb("/rest/v1/site_content?id=eq.main&select=body,updated_at",{},!!sess);const row=r&&r[0];
    if(!row)return{body:null,stamp:null};const body=row.body||{};if(!body.updatedAt)body.updatedAt=row.updated_at;return{body,stamp:row.updated_at}}
  async function sbInbox(){const r=await sb("/rest/v1/inbox?select=*&order=created_at.desc&limit=500")||[];
    return r.map(x=>Object.assign({},x.data||{},{id:x.id,createdAt:x.created_at,read:!!x.read,type:(x.data&&x.data.type)||x.kind}))}
  function every(ms,fn){const t=setInterval(()=>{if(document.visibilityState!=="hidden")fn()},ms);timers.push(t);return()=>clearInterval(t)}
  function safeName(n){return String(n||"ficheiro").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9.]+/g,"-").replace(/^-+|-+$/g,"").slice(-60)||"ficheiro"}
  const EXT={"image/webp":"webp","image/jpeg":"jpg","image/png":"png","image/gif":"gif","image/avif":"avif","video/mp4":"mp4","video/webm":"webm","application/pdf":"pdf","font/woff2":"woff2","font/woff":"woff","font/ttf":"ttf","font/otf":"otf"};
  function folder(t){return/^image\//.test(t)?"imagens":/^video\//.test(t)?"videos":t==="application/pdf"?"documentos":/^font\//.test(t)?"fontes":"outros"}
  async function dataToBlob(u){const r=await fetch(u);return await r.blob()}

  /* ---------- Claude / local ---------- */
  async function use(name){try{return await window.claude.use(name)}catch(e){return null}}
  function openIDB(){return new Promise(res=>{try{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null)}catch(e){res(null)}})}
  const tx=(m,f)=>new Promise((res,rej)=>{const t=idb.transaction("kv",m),s=t.objectStore("kv"),r=f(s);t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new DOMException("abort","QuotaExceededError"))});
  const readLS=k=>lsGet(k);
  async function readL(k){if(idb){try{let v=await tx("readonly",s=>s.get(k));if(v==null){v=readLS(k);if(v!=null){await tx("readwrite",s=>s.put(v,k));try{localStorage.removeItem(k)}catch(e){}}}return v??null}catch(e){}}return readLS(k)}
  async function writeL(k,v){if(idb){await tx("readwrite",s=>s.put(v,k));try{localStorage.removeItem(k)}catch(e){}}else localStorage.setItem(k,JSON.stringify(v));try{bc&&bc.postMessage(k)}catch(e){}}
  async function init(){
    if(CFG){mode="supabase";sess=lsGet(SKEY);if(sess&&!sess.refresh_token)sess=null;return mode}
    if(window.claude&&typeof window.claude.use==="function"){
      db=await use("db");
      if(db){mode="cloud";[assets,user,downloads]=await Promise.all([use("assets"),use("user"),use("downloads")]);return mode}
    }
    if(window.indexedDB)idb=await openIDB();
    try{bc=new BroadcastChannel(DBN)}catch(e){}
    return mode;
  }
  function watch(k,fn){const onBC=e=>{if(e.data===k)fn()},onLS=e=>{if(e.key===k)fn()};if(bc)bc.addEventListener("message",onBC);window.addEventListener("storage",onLS);return()=>{if(bc)bc.removeEventListener("message",onBC);window.removeEventListener("storage",onLS)}}
  /* opts.poll: verificar alterações periodicamente (CMS); opts.cache: mostrar a última versão guardada no navegador enquanto carrega (site) */
  function subscribe(cb,opts={}){
    if(mode==="supabase"){contentCb=cb;let alive=true;
      if(opts.cache){const c=lsGet(CKEY);if(c&&c.body)cb(c.body,{cached:true})}
      const load=async(first)=>{try{const{body,stamp}=await sbContent();if(!alive)return;if(!first&&stamp===lastStamp)return;lastStamp=stamp;
          if(opts.cache)lsSet(CKEY,body?{body,stamp}:null);cb(body,{})}
        catch(e){console.warn("supabase",e);if(first&&!(opts.cache&&lsGet(CKEY)))cb(null,{error:e})}};
      load(true);const stop=opts.poll?every(opts.poll,()=>load(false)):()=>{};
      const vis=()=>{if(document.visibilityState==="visible")load(false)};document.addEventListener("visibilitychange",vis);
      return()=>{alive=false;stop();document.removeEventListener("visibilitychange",vis)}}
    if(mode==="cloud")return db.doc("site/content").onSnapshot(s=>cb(s.exists?JSON.parse(JSON.stringify(s.data())):null,s.metadata),e=>console.warn("db",e));
    const load=()=>readL(KEY).then(v=>cb(v,{}));load();return watch(KEY,load);
  }
  async function save(obj){
    const body=JSON.parse(JSON.stringify(obj));body.updatedAt=new Date().toISOString();
    if(mode==="supabase"){const r=await sb("/rest/v1/site_content?on_conflict=id",{method:"POST",json:[{id:"main",body}],headers:{Prefer:"resolution=merge-duplicates,return=representation"}});
      const row=r&&r[0];if(!row)throw SBErr("Sem permissão para publicar",403);lastStamp=row.updated_at;body.updatedAt=row.updated_at;return body}
    if(mode==="cloud"){await db.doc("site/content").set(body);return body}
    await writeL(KEY,body);return body;
  }
  async function upload(blob,dataUrl,type,name){
    if(mode==="supabase"){
      if(!blob&&dataUrl)blob=await dataToBlob(dataUrl);
      const t=type||(blob&&blob.type)||"application/octet-stream",ext=EXT[t]||((blob&&blob.name||"").split(".").pop()||"bin");
      let base=safeName(name||(blob&&blob.name)||"").replace(/\.[a-z0-9]+$/,"");if(!base||base==="ficheiro")base={imagens:"imagem",videos:"video",documentos:"documento",fontes:"fonte"}[folder(t)]||"ficheiro";
      const d=new Date(),path=`${folder(t)}/${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${base}-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}.${ext}`;
      await fresh();
      const r=await fetch(`${CFG.url}/storage/v1/object/${CFG.bucket}/${path}`,{method:"POST",headers:{apikey:CFG.key,Authorization:"Bearer "+(sess?sess.access_token:CFG.key),"Content-Type":t,"cache-control":"31536000","x-upsert":"false"},body:blob});
      if(!r.ok){let m="HTTP "+r.status;try{const j=await r.json();m=j.message||j.error||m}catch(e){}throw SBErr(m,r.status)}
      return `${CFG.url}/storage/v1/object/public/${CFG.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`}
    if(mode==="cloud"&&assets){const r=await assets.upload(blob,type?{type}:undefined);return "/_blob/"+r.id}
    return dataUrl;
  }
  /* mensagens de contacto e denúncias */
  async function submit(msg){
    const m=Object.assign({},msg,{createdAt:new Date().toISOString(),read:false});
    if(mode==="supabase"){const data=Object.assign({},msg);await sb("/rest/v1/inbox",{method:"POST",json:{kind:String(msg.type||"contact").slice(0,40),data},headers:{Prefer:"return=minimal"}},false);return}
    if(mode==="cloud"){await db.collection("inbox").add(m);return}
    const list=(await readL(IKEY))||[];m.id="m"+Date.now().toString(36);list.unshift(m);await writeL(IKEY,list);
  }
  /* tarefas do CMS: tabela privada cms_tasks no Supabase (04-tarefas.sql); noutros modos, neste navegador */
  const TKEY="cdm-cms-tasks-v1";
  const tLocal=()=>{try{return JSON.parse(localStorage.getItem(TKEY)||"[]")}catch(e){return[]}},tSave=l=>{try{localStorage.setItem(TKEY,JSON.stringify(l))}catch(e){}};
  const tasks={
    remote:()=>mode==="supabase",
    async list(){if(mode==="supabase")return await sb("/rest/v1/cms_tasks?select=*&order=done.asc,pos.asc,created_at.asc")||[];return tLocal()},
    async add(t){const row={text:String(t.text||"").trim().slice(0,300),due:t.due||null,pos:+t.pos||0,done:false};
      if(mode==="supabase"){const r=await sb("/rest/v1/cms_tasks",{method:"POST",json:row,headers:{Prefer:"return=representation"}});return r&&r[0]}
      const l=tLocal(),x=Object.assign({id:"t"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),created_at:new Date().toISOString()},row);l.push(x);tSave(l);return x},
    async update(id,patch){const p=Object.assign({},patch);if("done"in p)p.done_at=p.done?new Date().toISOString():null;
      if(mode==="supabase"){await sb("/rest/v1/cms_tasks?id=eq."+encodeURIComponent(id),{method:"PATCH",json:p,headers:{Prefer:"return=minimal"}});return}
      tSave(tLocal().map(x=>x.id===id?Object.assign({},x,p):x))},
    async remove(id){if(mode==="supabase"){await sb("/rest/v1/cms_tasks?id=eq."+encodeURIComponent(id),{method:"DELETE"});return}tSave(tLocal().filter(x=>x.id!==id))}
  };
  /* Edge Functions (só editores): ex. cdm-feeds para alertas e comentários */
  async function fn(name,body){if(mode!=="supabase")throw SBErr("Disponível só com o Supabase ligado.",0,"local");await fresh();
    let r;try{r=await fetch(CFG.url+"/functions/v1/"+name,{method:"POST",headers:{apikey:CFG.key,Authorization:"Bearer "+(sess?sess.access_token:CFG.key),"Content-Type":"application/json"},body:JSON.stringify(body||{})})}catch(e){throw SBErr("Failed to fetch",0,"net")}
    const txt=await r.text();let j=null;try{j=txt?JSON.parse(txt):null}catch(e){}
    if(r.status===404)throw SBErr("A função "+name+" ainda não foi publicada no Supabase.",404,"nofn");
    if(!r.ok)throw SBErr((j&&(j.error||j.message))||("HTTP "+r.status),r.status,"fnerr");return j}
  let inboxLoad=null;
  function inboxRefresh(){if(inboxLoad)return inboxLoad()}
  function inbox(cb,opt){
    if(mode==="supabase"){inboxCb=cb;const load=inboxLoad=()=>sbInbox().then(cb).catch(e=>{console.warn("inbox",e)});load();return every((opt&&opt.poll)||15*60e3,load)}
    if(mode==="cloud")return db.collection("inbox").orderBy("createdAt","desc").limit(500).onSnapshot(s=>cb(s.docs.map(d=>Object.assign({id:d.id},d.data()))),e=>{console.warn("inbox",e);cb([])});
    const load=inboxLoad=()=>readL(IKEY).then(v=>cb(v||[]));load();const st=every((opt&&opt.poll)||15*60e3,load);const w=watch(IKEY,load);return()=>{try{st&&st()}catch(e){}try{w&&w()}catch(e){}}
  }
  async function inboxUpdate(id,patch,cbLocal){
    if(mode==="supabase"){const q="/rest/v1/inbox?id=eq."+encodeURIComponent(id);
      if(patch===null)await sb(q,{method:"DELETE"});else await sb(q,{method:"PATCH",json:{read:!!patch.read},headers:{Prefer:"return=minimal"}});
      const l=await sbInbox();if(cbLocal)cbLocal(l);else if(inboxCb)inboxCb(l);return}
    if(mode==="cloud"){if(patch===null)await db.doc("inbox/"+id).delete();else await db.doc("inbox/"+id).update(patch);return}
    let list=(await readL(IKEY))||[];if(patch===null)list=list.filter(m=>m.id!==id);else list=list.map(m=>m.id===id?Object.assign({},m,patch):m);
    await writeL(IKEY,list);cbLocal&&cbLocal(list);
  }
  async function usage(){let used=0,quota=0;try{const e=await navigator.storage.estimate();used=e.usage||0;quota=e.quota||0}catch(e){}return{used,quota,engine:Store.engine}}
  const fnUrl=name=>CFG&&CFG.url?CFG.url+"/functions/v1/"+name:"";
  async function latest(){if(mode==="supabase"){const{body}=await sbContent();return body}if(mode==="cloud"){const d=await db.doc("site/content").get();return d.exists?JSON.parse(JSON.stringify(d.data())):null}return await readL(KEY)}
  return{init,subscribe,latest,save,upload,submit,inbox,inboxRefresh,tasks,fn,fnUrl,inboxUpdate,usage,auth,
    get mode(){return mode},get remote(){return mode!=="local"},get engine(){return mode==="supabase"?"supabase":mode==="cloud"?"cloud":idb?"idb":"ls"},
    get user(){return user},get downloads(){return downloads},get config(){return CFG?{url:CFG.url,bucket:CFG.bucket}:null}};
})();
