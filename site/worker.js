/* atlas Worker - MiniSearch off main thread + cached index */
importScripts('./minisearch.js');

let allDocs = [];
let byId = new Map();
let miniSearch = null;
let ready = false;
let indexReady = false;

function send(type, payload){ self.postMessage({type, ...payload}); }

// --- IndexedDB cache for decompressed docs ---
const DB_NAME = 'atlas-cache';
const STORE = 'indexes';
const CACHE_KEY = 'current';

function openDB(){
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { try{ r.result.createObjectStore(STORE); }catch{} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function getCached(){
  try{
    const db = await openDB();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(CACHE_KEY);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  }catch{ return null; }
}
async function setCached(version, docs){
  try{
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ version, docs, savedAt: Date.now() }, CACHE_KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    // also clean old Cache API entries if any
    try{ if(self.caches){ const keys = await caches.keys(); for(const k of keys) if(k.startsWith('atlas-gz-') && k !== 'atlas-gz-' + version) await caches.delete(k); } }catch{}
  }catch(e){ /* quota or private mode */ }
}
async function clearCached(){
  try{
    const db = await openDB();
    await new Promise(res => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(CACHE_KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  }catch{}
}
async function fetchMeta(url){
  if(!url) return null;
  try{ const r = await fetch(url, { cache: 'no-store' }); if(r.ok) return await r.json(); }catch{}
  return null;
}

function newIndex(){
  return new MiniSearch({
    fields: ['title','company','console','folder','searchText'],
    storeFields: ['title','href','url','company','console','folder','size','sizeBytes','date'],
    searchOptions: { prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    idField: 'id'
  });
}

function sendReady(meta, indexPending){
  ready = true;
  const companies = [...new Set(allDocs.map(d=>d.company))].sort();
  const consoles = [...new Set(allDocs.map(d=>d.console))].sort();
  send('ready', {total: allDocs.length, companies, consoles, meta, indexPending});
}

// Build full-text index without blocking searches. Substring search
// serves queries until this finishes, then MiniSearch takes over.
async function buildFullIndex(){
  indexReady = false;
  miniSearch = newIndex();
  const CHUNK = 5000;
  for(let i=0;i<allDocs.length;i+=CHUNK){
    miniSearch.addAll(allDocs.slice(i, i+CHUNK));
    await new Promise(r=> setTimeout(r, 0));
  }
  indexReady = true;
  send('indexReady', {total: allDocs.length});
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      // 1) fetch meta first to get version for cache key
      let meta = await fetchMeta(msg.metaUrl);
      let version = meta && meta.generatedAt ? meta.generatedAt : null;

      // 2) try IndexedDB cache
      let cached = await getCached();
      const emptyMeta = meta && typeof meta.totalFiles === 'number' && meta.totalFiles === 0;
      if(emptyMeta && cached && Array.isArray(cached.docs) && cached.docs.length){
        // upstream published an empty index, keep last good cache
        send('progress', {text: `Upstream index empty, using cached…`});
        version = cached.version;
        meta = { ...meta, generatedAt: cached.version, totalFiles: cached.docs.length, stale: true };
      }
      if(cached && cached.version && cached.version === version && Array.isArray(cached.docs) && cached.docs.length){
        allDocs = cached.docs;
        byId = new Map(allDocs.map(d=>[d.id,d]));
        sendReady(meta, true);
        await buildFullIndex();
        return;
      }

      // 3) fetch gzip (prefer .gz) with Cache API to avoid redownload
      const tryUrls = [msg.dataUrl + '.gz', msg.dataUrl];
      let buffer = null;
      for(const u of tryUrls){
        try{
          send('progress', {text: `Fetching ${u.split('/').pop()}…`});
          let res = null;
          // try Cache API first
          try{ if(self.caches){ const cache = await caches.open('atlas-gz-' + (version||'nogz')); const hit = await cache.match(u); if(hit) res = hit; } }catch{}
          if(!res){
            res = await fetch(u);
            if(!res.ok) continue;
            // store gzip in Cache API for next load
            try{ if(self.caches && u.endsWith('.gz')){ const cache = await caches.open('atlas-gz-' + (version||'nogz')); await cache.put(u, res.clone()); } }catch{}
          }
          if(u.endsWith('.gz')){
            send('progress', {text: 'Decompressing gzip…'});
            if(typeof DecompressionStream !== 'undefined'){
              const ds = new DecompressionStream('gzip');
              const decompressed = res.body.pipeThrough(ds);
              const text = await new Response(decompressed).text();
              buffer = JSON.parse(text);
            } else { continue; }
          } else {
            const total = parseInt(res.headers.get('Content-Length')||'0',10);
            if(res.body && total){
              const reader = res.body.getReader();
              let received = 0;
              const chunks = [];
              while(true){
                const {done, value} = await reader.read();
                if(done) break;
                chunks.push(value);
                received += value.length;
                if(received % (2*1024*1024) < 65536){
                  send('progress', {text: `Downloading ${(received/1024/1024).toFixed(1)} / ${(total/1024/1024).toFixed(1)} MB…`});
                }
              }
              const blob = new Blob(chunks);
              const text = await blob.text();
              buffer = JSON.parse(text);
            } else {
              send('progress', {text: 'Parsing JSON…'});
              buffer = await res.json();
            }
          }
          if(buffer) break;
        }catch(err){ continue; }
      }
      if(!buffer || !buffer.length){
        if(cached && Array.isArray(cached.docs) && cached.docs.length){
          allDocs = cached.docs;
          byId = new Map(allDocs.map(d=>[d.id,d]));
          sendReady(meta, true);
          await buildFullIndex();
          return;
        }
        throw new Error('Failed to fetch any index variant');
      }
      allDocs = buffer;
      byId = new Map(allDocs.map(d=>[d.id,d]));
      sendReady(meta, true);
      if(version && allDocs.length) await setCached(version, allDocs);
      await buildFullIndex();
      return;
    } catch(err){
      send('error', {error: String(err.stack||err)});
    }
  }

  if(msg.type === 'search'){
    if(!ready){ send('searchResult', {total:0, docs:[], queryId: msg.queryId}); return; }
    const {q, company, consoleVal, folderSub, sortBy, page, pageSize, queryId} = msg;
    let docs;
    let scores = new Map();
    const trimmed = (q||'').trim();
    if(trimmed && indexReady && miniSearch){
      try{
        const results = miniSearch.search(trimmed);
        scores = new Map(results.map(r=>[r.id, r.score]));
        // O(1) via byId instead of O(n) find
        docs = results.map(r=> byId.get(r.id)).filter(Boolean);
        if(docs.length===0){
          // fallback substring scan (still fast, single pass)
          const low = trimmed.toLowerCase();
          docs = allDocs.filter(d=> d.searchText.includes(low));
        }
        docs.forEach(d=> d._score = scores.get(d.id)||0);
      }catch{
        const low = trimmed.toLowerCase();
        docs = allDocs.filter(d=> d.searchText.includes(low));
      }
    } else if(trimmed){
      // fast mode: full-text index still building, substring over all docs
      const low = trimmed.toLowerCase();
      docs = allDocs.filter(d=> d.searchText.includes(low));
      docs.forEach(d=> d._score = 0);
    } else {
      docs = allDocs.slice();
      docs.forEach(d=> d._score = 0);
    }

    if(company) docs = docs.filter(d=> d.company===company);
    if(consoleVal) docs = docs.filter(d=> d.console===consoleVal);
    if(folderSub){
      const low = folderSub.toLowerCase();
      docs = docs.filter(d=> d.folder.toLowerCase().includes(low));
    }

    // sorting - keep in worker to avoid shipping 67k docs to main thread
    if(sortBy==='relevance' && trimmed){
      docs.sort((a,b)=>(b._score||0)-(a._score||0));
    } else if(sortBy==='title-asc'){
      docs.sort((a,b)=> a.title.localeCompare(b.title));
    } else if(sortBy==='title-desc'){
      docs.sort((a,b)=> b.title.localeCompare(a.title));
    } else if(sortBy==='console-asc'){
      docs.sort((a,b)=> (a.console||'').localeCompare(b.console||'') || a.title.localeCompare(b.title));
    } else if(sortBy==='company-asc'){
      docs.sort((a,b)=> a.company.localeCompare(b.company) || (a.console||'').localeCompare(b.console||'') || a.title.localeCompare(b.title));
    } else if(sortBy==='size-desc'){
      docs.sort((a,b)=> (b.sizeBytes||0)-(a.sizeBytes||0));
    } else if(sortBy==='size-asc'){
      docs.sort((a,b)=> (a.sizeBytes||0)-(b.sizeBytes||0));
    } else if(sortBy==='date-desc'){
      docs.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    } else if(!trimmed){
      docs.sort((a,b)=> a.title.localeCompare(b.title));
    }

    const total = docs.length;
    const start = page * pageSize;
    const slice = docs.slice(start, start + pageSize);
    send('searchResult', {total, docs: slice, page, queryId, trimmed});
  }
};
