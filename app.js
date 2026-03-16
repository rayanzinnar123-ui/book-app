// simple librarium
(function () {
   'use strict';
   const state = {
      library: JSON.parse(localStorage.getItem('library') || '[]'),
      currentPage: 1,
      totalPages: 0,
      numFound: 0,
      rowsPerPage: 30,
      searchQuery: '',
      viewed: JSON.parse(localStorage.getItem('librarium-viewed') || '[]'), // full book objects
      recommendations: [],      // current suggestion list
      chatMessages: JSON.parse(localStorage.getItem('librarium-chat') || '[]'),
      apiKey: localStorage.getItem('librarium-api-key') || '',
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

   function showToast(msg) {
      clearTimeout(window._toastT);
      dom.toast.textContent = msg;
      dom.toast.classList.add('visible');
      window._toastT = setTimeout(() => dom.toast.classList.remove('visible'), 2000);
   }
   function updateBadge() {
      const n = state.library.length;
      dom.badge.style.display = n ? 'inline-flex' : 'none';
      dom.badge.textContent = n;
   }

   // ---- chat helpers ----
   function updateChatUI() {
      if (state.apiKey) {
         if (dom.chatSetup) dom.chatSetup.style.display = 'none';
         if (dom.chatMessages) dom.chatMessages.style.display = 'flex';
         if (dom.chatInputArea) dom.chatInputArea.style.display = 'block';
         renderChatMessages();
      } else {
         if (dom.chatSetup) dom.chatSetup.style.display = 'flex';
         if (dom.chatMessages) dom.chatMessages.style.display = 'none';
         if (dom.chatInputArea) dom.chatInputArea.style.display = 'none';
      }
   }

   function renderChatMessages() {
      if (!dom.chatMessages) return;
      dom.chatMessages.innerHTML = '';
      state.chatMessages.forEach(m => {
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

   function appendChatMessage(role, text) {
      state.chatMessages.push({ role, content: text });
      localStorage.setItem('librarium-chat', JSON.stringify(state.chatMessages));
      renderChatMessages();
   }

   async function sendChatMessage() {
      const text = dom.chatInput.value.trim();
      if (!text || state.isChatLoading) return;
      appendChatMessage('user', text);
      dom.chatInput.value = '';
      state.isChatLoading = true;
      try {
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
      } catch (err) {
         appendChatMessage('assistant', `Error: ${err.message}`);
      } finally { state.isChatLoading = false; }
   }
   function toggleSave(book) {
      const i = state.library.findIndex(b => b.identifier === book.identifier);
      if (i > -1) { state.library.splice(i, 1); showToast('removed'); }
      else { state.library.push(book); showToast('saved'); }
      localStorage.setItem('library', JSON.stringify(state.library));
      updateBadge();
      if (currentView === 'library') {
         renderLibrary();
      } else {
         renderResults(currentDocs);
      }
   }
   let currentDocs = [];

   // simple search routine; no content filtering is performed
   async function searchBooks(q, page = 1) {
      if (!q) return;
      // sanitise the query in case someone bypasses the input listener
      q = q.replace(/[^a-z0-9 ]/gi, '').trim();
      if (!q) return;
      state.searchQuery = q;
      state.currentPage = page;
      // make sure we're in the search view and show results container
      switchView('search');
      if (dom.resultsSection) dom.resultsSection.style.display = 'block';
      dom.results.innerHTML = 'Searching…';
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}+mediatype:texts&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=subject&sort[]=downloads+desc&rows=${state.rowsPerPage}&page=${page}&output=json`;
      try {
         const r = await fetch(url);
         const d = await r.json();
         currentDocs = d.response.docs || [];
         // numFound is the total returned by the API; after filtering the
         // actual shown count may be smaller but we don't adjust the totalPages
         // calculation since it's based on server-side results.
         state.numFound = d.response.numFound || 0;
         // clamp large totals just in case
         const displayTotal = state.numFound > 1000000 ? '>1,000,000' : state.numFound;
         const pagesBase = state.numFound > 1000000 ? 1000000 : state.numFound;
         state.totalPages = Math.ceil(pagesBase / state.rowsPerPage);
         if (dom.resultsTitle) dom.resultsTitle.textContent = `Results for "${state.searchQuery}" - Page ${page} of ${state.totalPages}`;
         if (dom.resultsCount) dom.resultsCount.textContent = `${displayTotal} books found (${currentDocs.length} shown)`;
         renderResults(currentDocs);
         renderPagination();
      } catch (e) {
         dom.results.textContent = 'Error fetching';
      }
   }
   // Content filtering removed; all books and queries are allowed.
   // previous safety checks have been stripped from the project.
   function renderResults(docs, container = dom.results) {
      container.innerHTML = '';
      docs.forEach(b => {
         console.log('render book', b);
         const card = document.createElement('div');
         card.className = 'book-card';
         // cover image
         const cover = document.createElement('img');
         cover.className = 'book-cover';
         cover.src = `https://archive.org/services/img/${b.identifier}`;
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
         btn.innerHTML = state.library.some(x => x.identifier === b.identifier)
            ? '★' : '☆';
         btn.style.position = 'absolute';
         btn.style.top = '8px';
         btn.style.right = '8px';
         btn.addEventListener('click', e => {
            e.stopPropagation();
            toggleSave(b);
            btn.innerHTML = state.library.some(x => x.identifier === b.identifier) ? '★' : '☆';
         });
         card.appendChild(btn);
         // click opens reader
         card.addEventListener('click', () => openReader(b));
         container.appendChild(card);
      });
   }
   // navigation
   let currentView = 'search';

   function renderPagination() {
      const sec = dom.resultsSection;
      if (!sec) return;
      let pag = sec.querySelector('.pagination');
      if (pag) pag.remove();
      if (state.totalPages > 1) {
         pag = document.createElement('div');
         pag.className = 'pagination';
         const prev = document.createElement('button');
         prev.textContent = 'Previous';
         prev.disabled = state.currentPage <= 1;
         prev.addEventListener('click', () => {
            if (state.currentPage > 1) searchBooks(state.searchQuery, state.currentPage - 1);
         });
         const next = document.createElement('button');
         next.textContent = 'Next';
         next.disabled = state.currentPage >= state.totalPages;
         next.addEventListener('click', () => {
            if (state.currentPage < state.totalPages) searchBooks(state.searchQuery, state.currentPage + 1);
         });
         pag.appendChild(prev);
         pag.appendChild(next);
         sec.appendChild(pag);
      }
   }
   function switchView(view) {
      currentView = view;
      dom.viewSearch.style.display = view === 'search' ? 'block' : 'none';
      dom.viewLibrary.style.display = view === 'library' ? 'block' : 'none';
      dom.viewReader && (dom.viewReader.style.display = view === 'reader' ? 'block' : 'none');
      if (view !== 'search' && dom.resultsSection) dom.resultsSection.style.display = 'none';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
      if (view === 'library') renderLibrary();
   }

   async function renderLibrary() {
      // show entire library without any filtering
      if (state.library.length === 0) {
         dom.libraryBooks.innerHTML = '';
         if (dom.libraryEmpty) dom.libraryEmpty.style.display = 'block';
      } else {
         if (dom.libraryEmpty) dom.libraryEmpty.style.display = 'none';
         renderResults(state.library, dom.libraryBooks);
      }
   }

   // recommendations algorithm
   async function fetchRecommendations(book) {
      console.log('fetchRecommendations for', book);
      // prefer subject tags when available
      let url;
      let subjects = [];
      if (book.subject) {
         if (Array.isArray(book.subject)) subjects = book.subject;
         else if (typeof book.subject === 'string') {
            subjects = book.subject.split(/[;,]+/).map(s => s.trim()).filter(Boolean);
         }
      }
      if (subjects.length) {
         console.log('using subjects', subjects);
         const terms = subjects.slice(0, 5)
            .map(t => `subject:${encodeURIComponent(t)}`)
            .join('%20OR%20');
         url = `https://archive.org/advancedsearch.php?q=${terms}+mediatype:texts&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=subject&sort[]=downloads+desc&rows=10&page=1&output=json`;
      } else {
         const q = book.title || '';
         if (!q) return;
         console.log('no subjects; using title', q);
         url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}+mediatype:texts&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=subject&sort[]=downloads+desc&rows=10&page=1&output=json`;
      }
      console.log('recommendation URL', url);
      try {
         const r = await fetch(url);
         const d = await r.json();
         const docs = d.response.docs || [];
         let recs = docs.filter(b => b.identifier !== book.identifier);
         state.recommendations = recs.slice(0, 5);
         const recContainer = document.getElementById('recommendations');
         if (recContainer) renderResults(state.recommendations, recContainer);
      } catch (err) {
         console.error('rec error', err);
      }
   }

   // reader
   function openReader(book) {
      if (!book) return;
      // track viewed books (store entire object)
      if (!state.viewed.find(b => b.identifier === book.identifier)) {
         state.viewed.push(book);
         localStorage.setItem('librarium-viewed', JSON.stringify(state.viewed));
      }
      dom.readerTitle && (dom.readerTitle.textContent = book.title || 'Untitled');
      dom.readerAuthor && (dom.readerAuthor.textContent = book.creator || 'Unknown');
      const iframe = document.createElement('iframe');
      iframe.src = `https://archive.org/embed/${book.identifier}`;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      const container = document.getElementById('pdf-viewer');
      if (container) { container.innerHTML = ''; container.appendChild(iframe); }
      switchView('reader');
      // fetch recommendations
      fetchRecommendations(book);
   }
   function closeReader() {
      const container = document.getElementById('pdf-viewer');
      if (container) container.innerHTML = '';
      switchView(state.library.length ? 'library' : 'search');
   }


   dom.searchBtn.addEventListener('click', () => searchBooks(dom.searchInput.value));
   dom.searchInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
         e.preventDefault();
         searchBooks(dom.searchInput.value);
      }
   });
   // live sanitization: only allow letters, numbers and spaces in search
   dom.searchInput.addEventListener('input', e => {
      const cleaned = dom.searchInput.value.replace(/[^a-z0-9 ]/gi, '');
      if (cleaned !== dom.searchInput.value) {
         dom.searchInput.value = cleaned;
         showToast('Only letters and numbers allowed');
      }
});
if (dom.readerBack) dom.readerBack.addEventListener('click', closeReader);

// suggestion chips
document.querySelectorAll('.suggestion-chip').forEach(chip => {
   chip.addEventListener('click', () => searchBooks(chip.dataset.query));
});

dom.navSearch.addEventListener('click', () => switchView('search'));
dom.navLibrary.addEventListener('click', () => switchView('library'));

// simple chat toggle/send (no AI)
dom.chatToggle.addEventListener('click', () => {
   const opening = !dom.chatPanel.classList.contains('open');
   dom.chatPanel.classList.toggle('open');
   if (opening) {
      // make sure the message area/input are visible
      if (dom.chatMessages) dom.chatMessages.style.display = 'block';
      if (dom.chatInputArea) dom.chatInputArea.style.display = 'block';
      if (dom.chatMessages && dom.chatMessages.children.length === 0) {
         const m = document.createElement('div');
         m.className = 'message assistant';
         const inner = document.createElement('div');
         inner.className = 'message-content';
         inner.textContent = 'Hello! I can recommend books for you.';
         m.appendChild(inner);
         dom.chatMessages.appendChild(m);
      }
   }
});
// chat settings toggle/clear
const settingsToggle = document.getElementById('chat-settings-toggle');
const settingsPanel = document.getElementById('chat-settings');
if (settingsToggle && settingsPanel) {
   settingsToggle.addEventListener('click', () => {
      const visible = settingsPanel.style.display === 'block';
      settingsPanel.style.display = visible ? 'none' : 'block';
   });
}
// clear history button inside settings
const clearBtn = document.getElementById('settings-chat-clear');
if (clearBtn) {
   clearBtn.addEventListener('click', () => {
      state.chatMessages = [];
      localStorage.setItem('librarium-chat', JSON.stringify(state.chatMessages));
      renderChatMessages();
      showToast('Chat history cleared');
   });
}
dom.chatSend.addEventListener('click', sendChatMessage);
dom.chatInput.addEventListener('keydown', e => {
   if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
   }
});

// api key setup
if (dom.apiKeySave) {
   dom.apiKeySave.addEventListener('click', () => {
      const val = dom.apiKeyInput.value.trim();
      if (!val) return;
      state.apiKey = val;
      localStorage.setItem('librarium-api-key', state.apiKey);
      updateChatUI();
      showToast('API key saved');
   });
}
if (dom.apiKeyInput) {
   dom.apiKeyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
         e.preventDefault();
         dom.apiKeySave && dom.apiKeySave.click();
      }
   });
}
// no key setup needed for Imagga (hard-coded)
updateBadge();
if (state.apiKey && dom.apiKeyInput) dom.apiKeyInput.value = state.apiKey;
// no deep api key to initialize
updateChatUI();
// show recommendations for most recently viewed book on load
console.log('initial viewed', state.viewed);
if (state.viewed.length > 0) {
   const last = state.viewed[state.viewed.length - 1];
   console.log('initial recommending for', last);
   fetchRecommendations(last);
}
})();

// hide preloader when page finishes loading
function hidePreloader() {
   const pre = document.getElementById('preloader');
   if (pre) pre.classList.add('hidden');
}
window.addEventListener('load', hidePreloader);
// if script runs after load, ensure preloader is hidden immediately
if (document.readyState === 'complete') {
   hidePreloader();
}
