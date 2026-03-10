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
      // disallow adding NSFW content
      if (!isSafeBook(book)) {
         showToast('cannot save inappropriate book');
         return;
      }
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
   // query safety for search box: disallow inappropriate words. the input
   // listener also strips out any non-alphanumeric characters up front so
   // users can't stuff symbols into a banned term ("$ex" -> "sex").
   // normalization below still removes any stray punctuation for matching.

   function normalizeText(text) {
      return text
         .toLowerCase()
         .replace(/3/g, 'e')
         .replace(/1/g, 'i')
         .replace(/0/g, 'o')
         .replace(/5/g, 's')
         .replace(/4/g, 'a')
         .replace(/7/g, 't');
   }

   // escape string for use in a regular expression
   function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   }

   function isQuerySafe(q) {
      if (!q) return true;

      // normalize leetspeak, convert separators to spaces, and strip any
      // remaining characters that aren't alphanumeric or whitespace.  dots,
      // dashes and underscores are treated as word boundaries so "bra." will
      // still match but "brave" will not.
      const norm = normalizeText(q)
         .replace(/[\-_.]/g, ' ')
         .replace(/[^a-z0-9 ]/g, '');

      const banned = [...NSFW_TERMS, ...HENTAI_TITLES];

      // check each banned term with word boundaries so substrings don't trigger.
      return !banned.some(term => {
         const re = new RegExp('\\b' + escapeRegex(term) + '\\b', 'i');
         return re.test(norm);
      });
   }
   async function searchBooks(q, page = 1) {
      if (!q) return;
      // sanitise the query in case someone bypasses the input listener
      q = q.replace(/[^a-z0-9 ]/gi, '').trim();
      if (!q) return;
      if (!isQuerySafe(q)) {
         showToast('Search contains inappropriate words');
         return;
      }
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
         currentDocs = (d.response.docs || []).filter(isSafeBook);
         // run cover safety checks in parallel
         currentDocs = await filterDocsByCover(currentDocs);
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
   // Extended NSFW/inappropriate filter – this implements multiple layers of
   // checks beyond just the subject field.  Books are rejected if any of the
   // following conditions are met:
   //   * they belong to a known blocked collection
   //   * they lack sufficient metadata (title + at least one other field)
   //   * their title matches suspicious patterns (lust, seduction, forbidden, etc.)
   //   * any metadata field contains a prohibited term from NSFW_TERMS
   // Trusted collections bypass the filters entirely, since they're known to
   // be safe (educational/historical/library materials).
   // Constants controlling behaviour follow.
   const NSFW_TERMS = [
      'porn', 'pornography', 'porno', 'xxx', 'adult', 'nsfw', 'x-rated', '18+', 'mature', 'explicit',
      'uncensored', 'adult content', 'adult material', 'adult fiction', 'adult novel',

      'erotic', 'erotica', 'erotic fiction', 'erotic novel', 'erotic romance', 'erotic story',
      'erotic tales', 'sexual', 'sexuality', 'sexual content', 'sexual themes', 'sexual fantasy',
      'sexual encounter', 'sexual desire', 'sexual tension', 'sexual relationship', 'sex scenes',
      'steamy', 'sensual', 'lust', 'passion', 'forbidden desire', 'taboo', 'temptation',

      'sex', 'anal', 'oral', 'blowjob', 'handjob', 'deepthroat', 'threesome', 'foursome',
      'orgy', 'gangbang', 'cum', 'creampie', 'facial', 'penetration', 'intercourse',

      'nude', 'nudity', 'naked', 'topless', 'bottomless', 'undressed', 'bare', 'skin',
      'lingerie', 'panties', 'bra', 'stockings', 'garter', 'strip', 'striptease',

      'pussy', 'cock', 'dick', 'vagina', 'penis', 'boobs', 'breasts', 'tits', 'ass', 'butt',
      'booty', 'milf', 'cougar', 'stud', 'slut', 'whore', 'bitch', 'horny',

      'bdsm', 'bondage', 'dominance', 'domination', 'submission', 'submissive', 'dominatrix',
      'kink', 'kinky', 'fetish', 'fetishism', 'sadism', 'masochism', 'voyeur', 'voyeurism',
      'exhibitionism', 'roleplay', 'spanking', 'whipping', 'choking', 'leather', 'latex',

      'escort', 'escorts', 'prostitute', 'prostitution', 'brothel', 'call girl',
      'stripper', 'strip club', 'sex worker', 'adult film', 'porn film', 'porn star',

      'hentai', 'ecchi', 'yaoi', 'yuri', 'doujin', 'doujinshi', 'rule34', 'fanservice',
      'lewd', 'pervy', 'perverted', 'nigga',

      'incest', 'stepmom', 'stepmother', 'stepdad', 'stepfather', 'stepbrother', 'stepsister',
      'forbidden family', 'taboo family',

      'rape', 'rapey', 'sexual abuse', 'sexual assault', 'molestation', 'sexploitation',

      'temptress', 'seductress', 'seduction', 'pleasure', 'carnal', 'intimate', 'bedroom',
      'lovers', 'lover', 'mistress', 'affair', 'cheating', 'adultery',

      'fantasy lover', 'alpha male', 'reverse harem', 'harem', 'dark romance', 'bad boy',
      'billionaire romance', 'possessive hero', 'dominant male', 'submissive girl',

      'pleasure house', 'pleasure club', 'love slave', 'sex slave', 'obedience training',
      'sub training', 'dominant training', 'dildo', 'vibrator',

      'fetish club', 'swingers', 'swinging', 'wife sharing', 'hotwife',

      'erotic photography', 'nude photography', 'adult photography', 'sex pictures',

      'uncut', 'raw', 'hardcore', 'softcore', 'dirty', 'filthy', 'naughty', 'sinful',
      'wicked', 'depraved', 'perversion', 'indecent', 'obscene'
   ];

   // specific hentai manga titles (or common patterns) to block explicitly
   const HENTAI_TITLES = [
      'naruto hentai',
      'one piece hentai',
      'attack on titan hentai',
      'dragon ball hentai',
      'bleach hentai',
      'my hero academia hentai',
      'dragonball hentai',
      'fairy tail hentai',
      'hentai', // catch general word as well
   ];

   const BLOCKED_COLLECTIONS = [
      'pornographic', 'adult', 'xxx', 'sex', 'erotic', 'hentai'
   ];

   const TRUSTED_COLLECTIONS = [
      'university-presses', 'literature-classics', 'americanlibraries', 'opensourcebooks'
   ];

   const SUSPICIOUS_TITLE_REGEX = /\b(lust|seduction|forbidden|erotic romance|naughty|sensual|sexual|passion(?:ate)? diary|secret lover)\b/i;

   function hasMinimalMetadata(book) {
      let count = 0;
      if (book.title) count++;
      if (book.subject && (Array.isArray(book.subject) ? book.subject.length : book.subject)) count++;
      if (book.description) count++;
      if (book.creator) count++;
      if (book.collection) count++;
      return count >= 2;
   }

   function isSafeBook(book) {
      if (!book) return false;
      // trusted collections are always allowed
      if (book.collection) {
         const col = (Array.isArray(book.collection) ? book.collection[0] : book.collection).toLowerCase();
         if (TRUSTED_COLLECTIONS.includes(col)) return true;
      }
      // block known bad collections
      if (book.collection) {
         const col = (Array.isArray(book.collection) ? book.collection[0] : book.collection).toLowerCase();
         if (BLOCKED_COLLECTIONS.includes(col)) return false;
      }
      // require more than just a title
      if (!hasMinimalMetadata(book)) return false;
      // suspicious title patterns
      if (book.title) {
         const t = book.title.toLowerCase();
         if (SUSPICIOUS_TITLE_REGEX.test(book.title)) return false;
         // explicit hentai series names
         if (HENTAI_TITLES.some(ht => t.includes(ht))) return false;
      }
      // aggregate searchable text from metadata fields
      let text = '';
      ['title', 'description', 'subject', 'creator', 'collection'].forEach(f => {
         const v = book[f];
         if (v) {
            if (Array.isArray(v)) text += v.join(' ') + ' ';
            else text += v + ' ';
         }
      });
      text = text.toLowerCase();
      if (NSFW_TERMS.some(term => text.includes(term))) return false;
      return true;
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
               Authorization: 'Basic ' + btoa('acc_e40fa00929f364c'),
            }
         });
         const data = await resp.json();
         // Imagga returns moderation categories; consider pornographic/explicit
         // if any confidence above threshold.
         const result = data.result || {};
         const categories = result.categories || {};
         // categories.pornography might exist with confidence value
         if (categories.pornography && categories.pornography.confidence > 0.5) {
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
         const url = `https://archive.org/services/img/${b.identifier}`;
         if (await isCoverSafe(url)) {
            results.push(b);
         }
      }));
      return results;
   }

   function renderResults(docs, container = dom.results) {
      container.innerHTML = '';
      docs.filter(isSafeBook).forEach(b => {
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
      // filter out any NSFW items that might have been added before the
      // filter was in place.
      let safeLib = state.library.filter(isSafeBook);
      // also check the covers
      safeLib = await filterDocsByCover(safeLib);
      if (safeLib.length === 0) {
         dom.libraryBooks.innerHTML = '';
         if (dom.libraryEmpty) dom.libraryEmpty.style.display = 'block';
      } else {
         if (dom.libraryEmpty) dom.libraryEmpty.style.display = 'none';
         renderResults(safeLib, dom.libraryBooks);
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
         let recs = docs
            .filter(b => b.identifier !== book.identifier)
            .filter(isSafeBook);
         recs = await filterDocsByCover(recs);
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
   // prevent typing banned terms live
   dom.searchInput.addEventListener('input', e => {
      let val = dom.searchInput.value;
      // allow letters, numbers, spaces and common word separators (.-_). the
      // normalization step in isQuerySafe treats those separators as boundaries
      // when checking against banned terms.
      const cleaned = val.replace(/[^a-z0-9 .\-_]/gi, '');
      if (cleaned !== val) {
         dom.searchInput.value = cleaned;
         val = cleaned;
         showToast('Only letters, numbers and .-_ are allowed');
      }
      // only validate words that have been terminated by a separator
      let toTest = val;
      if (!/[\s._-]$/.test(val)) {
         // drop the current trailing partial word
         toTest = val.replace(/\b[^\s._-]+$/, '');
      }
   if (toTest && !isQuerySafe(toTest)) {
      // remove the offending completed word but leave the rest of the input
      // intact. the regex below strips the last word and any trailing
      // separator that triggered the check.
      dom.searchInput.value = val.replace(/[^\s._-]*[\s._-]?$/, '');
      showToast('That word isn\'t allowed');
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
