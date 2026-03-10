// simple librarium
(function(){
  'use strict';
  const state = {
     library: JSON.parse(localStorage.getItem('library')||'[]'),
     currentPage: 1,
     totalPages: 0,
     numFound: 0,
     rowsPerPage: 30,
     searchQuery: '',
     viewed: JSON.parse(localStorage.getItem('librarium-viewed')||'[]'), // full book objects
     recommendations: [],      // current suggestion list
     chatMessages: JSON.parse(localStorage.getItem('librarium-chat')||'[]'),
     apiKey: localStorage.getItem('librarium-api-key')||'',
     isChatLoading: false,
     model: 'google/gemini-2.0-flash-001'
  };
  const dom = {
    // top‑level views
    viewSearch: document.getElementById('view-search'),
    viewLibrary: document.getElementById('view-library'),
    viewReader: document.getElementById('view-reader'),
    // navigation buttons
    navSearch: document.getElementById('nav-search'),
    navLibrary: document.getElementById('nav-library'),
    // chat setup panel
    chatSetup: document.getElementById('chat-setup'),
    // search
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    resultsSection: document.getElementById('search-results-section'),
    resultsTitle: document.getElementById('results-title'),
    resultsCount: document.getElementById('results-count'),
    results: document.getElementById('search-results'),
    // library
    libraryBooks: document.getElementById('library-books'),
    libraryEmpty: document.getElementById('library-empty'),
    badge: document.getElementById('library-badge'),
    // chat (very basic)
    chatToggle: document.getElementById('chat-toggle'),
    chatPanel: document.getElementById('chat-panel'),
    chatMessages: document.getElementById('chat-messages'),
    chatInputArea: document.getElementById('chat-input-area'),
    chatInput: document.getElementById('chat-input'),
    chatSend: document.getElementById('chat-send'),
    // toast
    toast: document.getElementById('toast'),
    // reader
    readerBack: document.getElementById('reader-back'),
    readerTitle: document.getElementById('reader-title'),
    readerAuthor: document.getElementById('reader-author'),
    // api key
    apiKeyInput: document.getElementById('api-key-input'),
    apiKeySave: document.getElementById('api-key-save'),
    // no dynamic key: using Imagga API key fixed below
  };

  function showToast(msg){
     clearTimeout(window._toastT);
     dom.toast.textContent=msg;
     dom.toast.classList.add('visible');
     window._toastT=setTimeout(()=>dom.toast.classList.remove('visible'),2000);
  }
  function updateBadge(){
     const n=state.library.length;
     dom.badge.style.display = n?'inline-flex':'none';
     dom.badge.textContent=n;
  }

  // ---- chat helpers ----
  function updateChatUI(){
     if(state.apiKey){
        if(dom.chatSetup) dom.chatSetup.style.display = 'none';
        if(dom.chatMessages) dom.chatMessages.style.display = 'flex';
        if(dom.chatInputArea) dom.chatInputArea.style.display = 'block';
        renderChatMessages();
     } else {
        if(dom.chatSetup) dom.chatSetup.style.display = 'flex';
        if(dom.chatMessages) dom.chatMessages.style.display = 'none';
        if(dom.chatInputArea) dom.chatInputArea.style.display = 'none';
     }
  }

  function renderChatMessages(){
     if(!dom.chatMessages) return;
     dom.chatMessages.innerHTML = '';
     state.chatMessages.forEach(m=>{
        const d = document.createElement('div');
        d.className = m.role === 'user' ? 'message user' : 'message assistant';
        const inner = document.createElement('div');
        inner.className = 'message-content';
        inner.textContent = m.content;
        d.appendChild(inner);
        dom.chatMessages.appendChild(d);
     });
     dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function appendChatMessage(role, text){
     state.chatMessages.push({role,content:text});
     localStorage.setItem('librarium-chat', JSON.stringify(state.chatMessages));
     renderChatMessages();
  }

  async function sendChatMessage(){
     const text = dom.chatInput.value.trim();
     if(!text || state.isChatLoading) return;
     appendChatMessage('user', text);
     dom.chatInput.value = '';
     state.isChatLoading = true;
     try{
        const messages = [
          { role: 'system', content: 'You are a friendly book recommendation assistant.' },
          ...state.chatMessages
        ];
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
           method: 'POST',
           headers: {
              Authorization: `Bearer ${state.apiKey}`,
              'Content-Type': 'application/json'
           },
           body: JSON.stringify({
              model: state.model || 'google/gemini-2.0-flash-001',
              messages,
              temperature: 0.8,
              max_tokens: 500
           })
        });
        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content || 'No response';
        appendChatMessage('assistant', reply);
     }catch(err){
        appendChatMessage('assistant', `Error: ${err.message}`);
     }finally{ state.isChatLoading = false; }
  }
  function toggleSave(book){
     // disallow adding NSFW content
     if(!isSafeBook(book)){
        showToast('cannot save inappropriate book');
        return;
     }
     const i=state.library.findIndex(b=>b.identifier===book.identifier);
     if(i>-1){ state.library.splice(i,1); showToast('removed'); }
     else{ state.library.push(book); showToast('saved'); }
     localStorage.setItem('library',JSON.stringify(state.library));
     updateBadge();
     if (currentView === 'library') {
       renderLibrary();
     } else {
       renderResults(currentDocs);
     }
  }
  let currentDocs=[];
  async function searchBooks(q, page = 1){
     if(!q.trim())return;
     state.searchQuery = q.trim();
     state.currentPage = page;
     switchView('search');
     if (dom.resultsSection) dom.resultsSection.style.display = 'block';
     dom.results.innerHTML='Searching…';
     // Google Books API uses startIndex for pagination
     const start = (page - 1) * state.rowsPerPage;
     const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&startIndex=${start}&maxResults=${state.rowsPerPage}`;
     try{
        const r = await fetch(url);
        const d = await r.json();
        const totalItems = d.totalItems || 0;
        // normalize items into our book format
        const docs = (d.items || []).map(item=>{
           const info = item.volumeInfo || {};
           return {
              identifier: item.id,
              title: info.title || 'Untitled',
              creator: (info.authors && info.authors[0]) || 'Unknown',
              subject: info.categories || [],
              coverImage: info.imageLinks?.thumbnail || '',
              previewLink: info.previewLink || info.infoLink || ''
           };
        });
        currentDocs = docs.filter(isSafeBook);
        currentDocs = await filterDocsByCover(currentDocs);
        // clamp large totals to avoid billions-of-results weirdness
        state.numFound = totalItems;
        const displayTotal = state.numFound > 1000000 ? '>1,000,000' : state.numFound;
        const pagesBase = state.numFound > 1000000 ? 1000000 : state.numFound;
        state.totalPages = Math.ceil(pagesBase / state.rowsPerPage);
        if(dom.resultsTitle) dom.resultsTitle.textContent = `Results for "${state.searchQuery}" - Page ${page} of ${state.totalPages}`;
        if(dom.resultsCount) dom.resultsCount.textContent = `${displayTotal} books found (${currentDocs.length} shown)`;
        renderResults(currentDocs);
        renderPagination();
     }catch(e){
        dom.results.textContent='Error fetching';
     }
  }
  // simple NSFW filter – any book whose title or subject contains one of these
  // terms will be hidden from the UI.  This is deliberately lightweight; more
  // advanced checks could be added later.
  const NSFW_TERMS = [
  // sexual content
  'porn', 'pornography', 'xxx', 'erotic', 'adult', 'nudity', 'sex', 'nsfw', 
  'hentai', 'bdsm', 'fetish', 'hardcore', 'softcore', 'explicit', 'uncensored',
  'anal', 'oral', 'incest', 'bestiality', 'sexual', 'sexuality', 'masturbation', 
  'cum', 'orgy', 'sexually explicit', 'rapey', 'prostitute', 'prostitution', 
  'stripper', 'striptease', 'escort', 'erotica', 'pornographic', 'kink', 
  'voyeur', 'adult content', 'adult material', 'sex scenes', 'adult novel', 
  'nude photos', 'porn star', 'fetishism', 'sex toys', 'erotic fiction', 'soft porn', 
  'porn star', 'seduction', 'sexual act', 'adult film', 'porn film', 'porno', 
  'sexual abuse', 'sexual assault', 'sexploitation', 'naked', 'sexually explicit material'
];

  function isSafeBook(book) {
    if(!book) return false;
    let text = '';
    if(book.title) text += book.title + ' ';
    if(book.subject) {
      if(Array.isArray(book.subject)) text += book.subject.join(' ');
      else text += book.subject;
    }
    text = text.toLowerCase();
    return !NSFW_TERMS.some(term => text.includes(term));
  }

  // cover-based check using an external NSFW detection service.  it takes the
  // URL of the image and returns true if it's considered safe.  this API is
  // fictitious; replace with a real service (Sightengine, Google Vision, etc.)
  // cover-based sanity check using Imagga's Content Moderation API.  a
  // hard-coded API key is used; no user input is required as per the request.
  async function isCoverSafe(imageUrl) {
    try {
      const resp = await fetch('https://api.imagga.com/v2/contentmoderation?image_url=' + encodeURIComponent(imageUrl), {
        headers: {
          Authorization: 'Basic ' + btoa('acc_bbe8bdcfd915db6:'),
        }
      });
      const data = await resp.json();
      // Imagga returns moderation categories; consider pornographic/explicit
      // if any confidence above threshold.
      const result = data.result || {};
      const categories = result.categories || {};
      // categories.pornography might exist with confidence value
      if(categories.pornography && categories.pornography.confidence > 0.5) {
        return false;
      }
      return true;
    } catch (err) {
      console.warn('cover check failed', err);
      return true;
    }
  }

  // filter a list of docs by running their covers through the NSFW check.
  // returns a new array containing only the safe ones.
  async function filterDocsByCover(docs) {
    const results = [];
    await Promise.all(docs.map(async b => {
      const url = b.coverImage || '';
      if (await isCoverSafe(url)) {
        results.push(b);
      }
    }));
    return results;
  }

  function renderResults(docs, container = dom.results){
     container.innerHTML='';
     docs.filter(isSafeBook).forEach(b=>{
        console.log('render book', b);
        const card = document.createElement('div');
        card.className = 'book-card';
        // cover image
        const cover = document.createElement('img');
        cover.className = 'book-cover';
        cover.src = b.coverImage || '';
        cover.alt = b.title || 'Cover';
        cover.onerror = () => cover.style.display = 'none';
        card.appendChild(cover);
        // title
        const info = document.createElement('div');
        info.className = 'book-info';
        info.textContent = b.title || 'Untitled';
        card.appendChild(info);
        // save button
        const btn = document.createElement('button');
        btn.className = 'book-action-btn';
        btn.innerHTML = state.library.some(x=>x.identifier===b.identifier)
          ? '★' : '☆';
        btn.style.position = 'absolute';
        btn.style.top = '8px';
        btn.style.right = '8px';
        btn.addEventListener('click', e=>{
           e.stopPropagation();
           toggleSave(b);
           btn.innerHTML = state.library.some(x=>x.identifier===b.identifier) ? '★' : '☆';
        });
        card.appendChild(btn);
        // click opens reader
        card.addEventListener('click',()=>openReader(b));
        container.appendChild(card);
     });
  }
  // navigation
  let currentView = 'search';

  function renderPagination(){
     const sec = dom.resultsSection;
     if(!sec) return;
     let pag = sec.querySelector('.pagination');
     if(pag) pag.remove();
     if(state.totalPages > 1){
        pag = document.createElement('div');
        pag.className = 'pagination';
        const prev = document.createElement('button');
        prev.textContent = 'Previous';
        prev.disabled = state.currentPage <= 1;
        prev.addEventListener('click', ()=>{
           if(state.currentPage > 1) searchBooks(state.searchQuery, state.currentPage -1);
        });
        const next = document.createElement('button');
        next.textContent = 'Next';
        next.disabled = state.currentPage >= state.totalPages;
        next.addEventListener('click', ()=>{
           if(state.currentPage < state.totalPages) searchBooks(state.searchQuery, state.currentPage +1);
        });
        pag.appendChild(prev);
        pag.appendChild(next);
        sec.appendChild(pag);
     }
  }
  function switchView(view){
     currentView = view;
     dom.viewSearch.style.display = view === 'search' ? 'block' : 'none';
     dom.viewLibrary.style.display = view === 'library' ? 'block' : 'none';
     dom.viewReader && (dom.viewReader.style.display = view === 'reader' ? 'block' : 'none');
     if(view !== 'search' && dom.resultsSection) dom.resultsSection.style.display = 'none';
     document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
     if(view === 'library') renderLibrary();
  }

  async function renderLibrary(){
     // filter out any NSFW items that might have been added before the
     // filter was in place.
     let safeLib = state.library.filter(isSafeBook);
     // also check the covers
     safeLib = await filterDocsByCover(safeLib);
     if (safeLib.length === 0) {
        dom.libraryBooks.innerHTML = '';
        if(dom.libraryEmpty) dom.libraryEmpty.style.display = 'block';
     } else {
        if(dom.libraryEmpty) dom.libraryEmpty.style.display = 'none';
        renderResults(safeLib, dom.libraryBooks);
     }
  }

  // recommendations algorithm
  async function fetchRecommendations(book){
     console.log('fetchRecommendations for', book);
     let query = '';
     if(book.subject){
        if(Array.isArray(book.subject) && book.subject.length) query = 'subject:' + book.subject[0];
        else if(typeof book.subject === 'string') query = 'subject:' + book.subject;
     }
     if(!query){
        if(book.title) query = 'intitle:' + book.title;
        else return;
     }
     const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`;
     try{
        const r = await fetch(url);
        const d = await r.json();
        const docs = (d.items || []).map(item=>{
           const info = item.volumeInfo || {};
           return {
              identifier: item.id,
              title: info.title || 'Untitled',
              creator: (info.authors && info.authors[0]) || 'Unknown',
              subject: info.categories || [],
              coverImage: info.imageLinks?.thumbnail || '',
              previewLink: info.previewLink || info.infoLink || ''
           };
        });
        let recs = docs
           .filter(b=>b.identifier !== book.identifier)
           .filter(isSafeBook);
        recs = await filterDocsByCover(recs);
        state.recommendations = recs.slice(0,5);
        const recContainer = document.getElementById('recommendations');
        if(recContainer) renderResults(state.recommendations, recContainer);
     }catch(err){
        console.error('rec error', err);
     }
  }

  // reader
  function openReader(book){
     if(!book) return;
     if(!state.viewed.find(b=>b.identifier===book.identifier)){
        state.viewed.push(book);
        localStorage.setItem('librarium-viewed', JSON.stringify(state.viewed));
     }
     dom.readerTitle && (dom.readerTitle.textContent = book.title||'Untitled');
     dom.readerAuthor && (dom.readerAuthor.textContent = book.creator||'Unknown');
     const iframe = document.createElement('iframe');
     iframe.src = book.previewLink || book.infoLink || '';
     iframe.style.width='100%';
     iframe.style.height='100%';
     iframe.style.border='none';
     const container = document.getElementById('pdf-viewer');
     if(container){ container.innerHTML = ''; container.appendChild(iframe); }
     const external = document.getElementById('reader-external');
     if(external) external.href = book.previewLink || book.infoLink || '#';
     switchView('reader');
     // fetch recommendations
     fetchRecommendations(book);
  }
  function closeReader(){
     const container = document.getElementById('pdf-viewer');
     if(container) container.innerHTML = '';
     switchView(state.library.length?'library':'search');
  }


  dom.searchBtn.addEventListener('click',()=>searchBooks(dom.searchInput.value));
  dom.searchInput.addEventListener('keypress',e=>{if(e.key==='Enter')searchBooks(dom.searchInput.value)});
  if(dom.readerBack) dom.readerBack.addEventListener('click', closeReader);

  // suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip=>{
    chip.addEventListener('click',()=>searchBooks(chip.dataset.query));
  });

  dom.navSearch.addEventListener('click',()=>switchView('search'));
  dom.navLibrary.addEventListener('click',()=>switchView('library'));

  // simple chat toggle/send (no AI)
  dom.chatToggle.addEventListener('click',()=>{
    const opening = !dom.chatPanel.classList.contains('open');
    dom.chatPanel.classList.toggle('open');
    if(opening){
      // make sure the message area/input are visible
      if(dom.chatMessages) dom.chatMessages.style.display='block';
      if(dom.chatInputArea) dom.chatInputArea.style.display='block';
      if(dom.chatMessages && dom.chatMessages.children.length===0){
        const m=document.createElement('div');
        m.className='message assistant';
        const inner = document.createElement('div');
        inner.className = 'message-content';
        inner.textContent='Hello! I can recommend books for you.';
        m.appendChild(inner);
        dom.chatMessages.appendChild(m);
      }
    }
  });
  // chat settings toggle/clear
  const settingsToggle = document.getElementById('chat-settings-toggle');
  const settingsPanel = document.getElementById('chat-settings');
  if(settingsToggle && settingsPanel){
    settingsToggle.addEventListener('click',()=>{
      const visible = settingsPanel.style.display === 'block';
      settingsPanel.style.display = visible ? 'none' : 'block';
    });
  }
  // clear history button inside settings
  const clearBtn = document.getElementById('settings-chat-clear');
  if(clearBtn){
    clearBtn.addEventListener('click',()=>{
      state.chatMessages = [];
      localStorage.setItem('librarium-chat', JSON.stringify(state.chatMessages));
      renderChatMessages();
      showToast('Chat history cleared');
    });
  }
  dom.chatSend.addEventListener('click', sendChatMessage);
  dom.chatInput.addEventListener('keydown', e=>{
     if(e.key==='Enter' && !e.shiftKey){
        e.preventDefault();
        sendChatMessage();
     }
  });

  // api key setup
  if(dom.apiKeySave){
     dom.apiKeySave.addEventListener('click', ()=>{
        const val = dom.apiKeyInput.value.trim();
        if(!val) return;
        state.apiKey = val;
        localStorage.setItem('librarium-api-key', state.apiKey);
        updateChatUI();
        showToast('API key saved');
     });
  }
  if(dom.apiKeyInput){
     dom.apiKeyInput.addEventListener('keydown', e=>{
        if(e.key==='Enter'){
           e.preventDefault();
           dom.apiKeySave && dom.apiKeySave.click();
        }
     });
  }
  // no key setup needed for Imagga (hard-coded)
  updateBadge();
  if(state.apiKey && dom.apiKeyInput) dom.apiKeyInput.value = state.apiKey;
  // no deep api key to initialize
  updateChatUI();
  // show recommendations for most recently viewed book on load
  console.log('initial viewed', state.viewed);
  if(state.viewed.length > 0){
     const last = state.viewed[state.viewed.length-1];
     console.log('initial recommending for', last);
     fetchRecommendations(last);
  }
})();

// hide preloader when page finishes loading
window.addEventListener('load', () => {
  const pre = document.getElementById('preloader');
  if (pre) pre.classList.add('hidden');
});
