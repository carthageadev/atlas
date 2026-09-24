const DATA_URL = "../data/roms.json";
const META_URL = "../data/meta.json";
const PAGE_SIZE = 50;

let worker = null;
let queryId = 0;
let lastTotal = 0;
let currentPage = 0;
let pendingQuery = null;

const els = {
  q: document.getElementById('q'),
  company: document.getElementById('companyFilter'),
  console: document.getElementById('consoleFilter'),
  folder: document.getElementById('folderFilter'),
  sortBy: document.getElementById('sortBy'),
  grid: document.getElementById('grid'),
  stats: document.getElementById('stats'),
  countPill: document.getElementById('countPill'),
  updated: document.getElementById('updated'),
  pageInfo: document.getElementById('pageInfo'),
  prev: document.getElementById('prevBtn'),
  next: document.getElementById('nextBtn'),
  clear: document.getElementById('clearBtn'),
};

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function setLoading(isLoading, text){
  els.q.disabled = isLoading;
  els.company.disabled = isLoading;
  els.console.disabled = isLoading;
  els.folder.disabled = isLoading;
  els.sortBy.disabled = isLoading;
  if(text) els.countPill.textContent = text;
}

function render(docs, total, page){
  lastTotal = total;
  currentPage = page;
  if(document.body.classList.contains('hero')){
    els.grid.innerHTML = '';
    els.pageInfo.textContent = '';
    els.stats.textContent = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(currentPage >= totalPages) currentPage = totalPages-1;
  els.grid.innerHTML = docs.map((d,i)=> `
    <div class="card result-card" style="animation-delay:${Math.min(i*8,120)}ms">
      <div class="left">
        <div class="title" title="${escapeHtml(d.title)}">${escapeHtml(d.title)}</div>
        <div class="meta">
          <span>${escapeHtml(d.company)}</span>
          <span>${escapeHtml(d.console||'-')}</span>
          <span>${escapeHtml(d.folder)}</span>
          <span>${escapeHtml(d.size||'')}</span>
          <span>${escapeHtml(d.date||'')}</span>
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="${d.url}" target="_blank" rel="noopener">raw</a>
        <button class="btn primary" onclick="navigator.clipboard.writeText('${d.url.replace(/'/g,"\\'")}'); this.textContent='ok'; setTimeout(()=> this.textContent='copy', 1200)">copy</button>
      </div>
    </div>
  `).join('') || `<div class="pill">no results. try "zelda", "mario", "sonic".</div>`;

  const start = page * PAGE_SIZE;
  els.stats.textContent = `Showing ${total===0?0:start+1}–${Math.min(start+PAGE_SIZE, total)} of ${total.toLocaleString()} results`;
  els.pageInfo.textContent = `Page ${page+1} / ${totalPages}`;
  els.prev.disabled = page===0;
  els.next.disabled = page >= totalPages-1;
}

function isActive(){
  return els.q.value.trim() !== '' || els.company.value !== '' ||
    els.console.value !== '' || els.folder.value.trim() !== '';
}
function updateMode(){
  const active = isActive();
  document.body.classList.toggle('hero', !active);
  document.body.classList.toggle('results', active);
}

function doSearch(page=0){
  if(!worker) return;
  updateMode();
  const q = els.q.value;
  const company = els.company.value;
  const consoleVal = els.console.value;
  const folderSub = els.folder.value;
  const sortBy = els.sortBy.value;
  queryId++;
  const thisId = queryId;
  // debounce via worker - just send, worker will answer with queryId
  worker.postMessage({type:'search', q, company, consoleVal, folderSub, sortBy, page, pageSize: PAGE_SIZE, queryId: thisId});
}

const debouncedSearch = debounce(()=> doSearch(0), 120);

function initWorker(){
  setLoading(true, 'Starting worker…');
  worker = new Worker('./worker.js');
  worker.onmessage = (e)=>{
    const msg = e.data;
    if(msg.type==='progress'){
      els.countPill.textContent = msg.text;
    }
    if(msg.type==='ready'){
      setLoading(false);
      els.countPill.textContent = msg.indexPending
        ? `${msg.total.toLocaleString()} files ready · full index loading…${msg.meta?` · updated ${msg.meta.generatedAt}`:''}`
        : `${msg.total.toLocaleString()} files indexed${msg.meta?` · updated ${msg.meta.generatedAt}`:''}`;
      if(msg.meta?.generatedAt){
        const date = new Date(msg.meta.generatedAt);
        els.updated.textContent = `Last scrape: ${Number.isNaN(date.getTime()) ? msg.meta.generatedAt : date.toLocaleString()}`;
      }
      // populate filters
      msg.companies.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; els.company.appendChild(o); });
      msg.consoles.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; els.console.appendChild(o); });
      syncFromUrl();
      updateMode();
      updateBtn();
      doSearch(0);
      els.q.focus();
    }
    if(msg.type==='indexReady'){
      els.countPill.textContent = `${msg.total.toLocaleString()} files indexed`;
      doSearch(currentPage);
    }
    if(msg.type==='error'){
      setLoading(false);
      els.countPill.textContent = 'Failed to load index';
      els.stats.textContent = msg.error;
      console.error(msg.error);
    }
    if(msg.type==='searchResult'){
      // ignore stale results
      if(msg.queryId !== queryId) return;
      render(msg.docs, msg.total, msg.page);
      syncToUrl();
    }
  };
  worker.onerror = (e)=>{
    console.error('Worker error', e);
    els.countPill.textContent = 'Worker error — falling back';
  };
  worker.postMessage({type:'load', dataUrl: DATA_URL, metaUrl: META_URL});
}

// controls
els.q.addEventListener('input', debouncedSearch);
els.company.addEventListener('change', ()=> doSearch(0));
els.console.addEventListener('change', ()=> doSearch(0));
els.folder.addEventListener('input', debounce(()=> doSearch(0), 200));
els.sortBy.addEventListener('change', ()=> doSearch(0));
els.prev.addEventListener('click', ()=>{ if(currentPage>0) doSearch(currentPage-1); window.scrollTo({top:0, behavior:'smooth'}); });
els.next.addEventListener('click', ()=>{ const tp=Math.ceil(lastTotal/PAGE_SIZE); if(currentPage < tp-1) doSearch(currentPage+1); window.scrollTo({top:0, behavior:'smooth'}); });
els.clear.addEventListener('click', ()=>{
  if(els.q.value === ''){ doSearch(0); els.q.focus(); return; }
  els.q.value=''; els.company.value=''; els.console.value=''; els.folder.value=''; els.sortBy.value='relevance'; doSearch(0); updateBtn(); els.q.focus();
});
function updateBtn(){ els.clear.textContent = els.q.value === '' ? '[>]' : '[x]'; }
els.q.addEventListener('input', updateBtn);

function syncFromUrl(){
  const p=new URLSearchParams(location.search);
  if(p.get('q')) els.q.value=p.get('q');
  if(p.get('company')) els.company.value=p.get('company');
  if(p.get('console')) els.console.value=p.get('console');
  if(p.get('folder')) els.folder.value=p.get('folder');
  if(p.get('sort')) els.sortBy.value=p.get('sort');
}
function syncToUrl(){
  const p=new URLSearchParams();
  if(els.q.value) p.set('q', els.q.value);
  if(els.company.value) p.set('company', els.company.value);
  if(els.console.value) p.set('console', els.console.value);
  if(els.folder.value) p.set('folder', els.folder.value);
  if(els.sortBy.value && els.sortBy.value!=='relevance') p.set('sort', els.sortBy.value);
  history.replaceState(null,'','?'+p.toString());
}

initWorker();
