// ===== Librarium - Interactive Reading App =====

(function () {
  'use strict';

  // ===== State =====
  const state = {
    currentView: 'search',
    library: JSON.parse(localStorage.getItem('librarium-library') || '[]'),
    chatMessages: JSON.parse(localStorage.getItem('librarium-chat') || '[]'),
    apiKey: localStorage.getItem('librarium-api-key') || '',
    model: localStorage.getItem('librarium-model') || 'google/gemini-2.0-flash-001',
    currentBook: null,
    searchQuery: '',
    chatOpen: false,
    settingsOpen: false,
    isSearching: false,
    isChatLoading: false,
    currentViewer: 'pdf', // 'pdf' or 'embed'
    currentPage: 1,
    totalPages: 0,
    numFound: 0,
    rowsPerPage: 30,
  };

  // ===== DOM References =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Navigation
    navSearch: $('#nav-search'),
    navLibrary: $('#nav-library'),
    libraryBadge: $('#library-badge'),
    logoLink: $('#logo-link'),
    // Views
    viewSearch: $('#view-search'),
    viewLibrary: $('#view-library'),
    viewReader: $('#view-reader'),
    // Search
    searchInput: $('#search-input'),
    searchBtn: $('#search-btn'),
    searchResultsSection: $('#search-results-section'),
    searchResults: $('#search-results'),
    searchLoading: $('#search-loading'),
    searchEmpty: $('#search-empty'),
    resultsTitle: $('#results-title'),
    resultsCount: $('#results-count'),
    // Library
    libraryBooks: $('#library-books'),
    libraryEmpty: $('#library-empty'),
    goDiscover: $('#go-discover'),
    // Reader
    readerBack: $('#reader-back'),
    readerTitle: $('#reader-title'),
    readerAuthor: $('#reader-author'),
    readerSave: $('#reader-save'),
    readerExternal: $('#reader-external'),
    pdfViewer: $('#pdf-viewer'),
    // Chat
    chatToggle: $('#chat-toggle'),
    chatPanel: $('#chat-panel'),
    chatSetup: $('#chat-setup'),
    chatMessages: $('#chat-messages'),
    chatInputArea: $('#chat-input-area'),
    chatInput: $('#chat-input'),
    chatSend: $('#chat-send'),
    apiKeyInput: $('#api-key-input'),
    apiKeySave: $('#api-key-save'),
    chatSettingsToggle: $('#chat-settings-toggle'),
    chatSettings: $('#chat-settings'),
    settingsApiKey: $('#settings-api-key'),
    settingsApiSave: $('#settings-api-save'),
    settingsModel: $('#settings-model'),
    chatClear: $('#chat-clear'),
    settingsClose: $('#settings-close'),
    // Toast
    toast: $('#toast'),
  };

  // ===== Navigation =====
  function switchView(viewName) {
    state.currentView = viewName;

    // Hide all views
    $$('.view').forEach((v) => v.classList.remove('active'));
    $$('.nav-btn').forEach((b) => b.classList.remove('active'));

    // Show target view
    if (viewName === 'search') {
      dom.viewSearch.classList.add('active');
      dom.navSearch.classList.add('active');
    } else if (viewName === 'library') {
      dom.viewLibrary.classList.add('active');
      dom.navLibrary.classList.add('active');
      renderLibrary();
    } else if (viewName === 'reader') {
      dom.viewReader.classList.add('active');
    }
  }

  // ===== Toast Notifications =====
  let toastTimeout;
  function showToast(message) {
    clearTimeout(toastTimeout);
    dom.toast.textContent = message;
    dom.toast.classList.add('visible');
    toastTimeout = setTimeout(() => {
      dom.toast.classList.remove('visible');
    }, 2500);
  }

  // ===== Library Management =====
  function saveLibrary() {
    localStorage.setItem('librarium-library', JSON.stringify(state.library));
    updateBadge();
  }

  function updateBadge() {
    const count = state.library.length;
    if (count > 0) {
      dom.libraryBadge.style.display = 'inline-flex';
      dom.libraryBadge.textContent = count;
    } else {
      dom.libraryBadge.style.display = 'none';
    }
  }

  function isBookSaved(identifier) {
    return state.library.some((b) => b.identifier === identifier);
  }

  function toggleSaveBook(book, event) {
    if (event) {
      event.stopPropagation();
    }
    const idx = state.library.findIndex((b) => b.identifier === book.identifier);
    if (idx > -1) {
      state.library.splice(idx, 1);
      showToast('Removed from library');
    } else {
      state.library.push(book);
      showToast('Saved to library');
    }
    saveLibrary();
    // Re-render current view
    if (state.currentView === 'library') {
      renderLibrary();
    }
    // Update search results save buttons
    updateSaveButtons();
    // Update reader save button
    if (state.currentBook) {
      updateReaderSaveBtn();
    }
  }

  function removeFromLibrary(identifier, event) {
    if (event) {
      event.stopPropagation();
    }
    state.library = state.library.filter((b) => b.identifier !== identifier);
    saveLibrary();
    renderLibrary();
    showToast('Removed from library');
  }

  function updateSaveButtons() {
    $$('.book-action-btn[data-action="save"]').forEach((btn) => {
      const id = btn.dataset.identifier;
      if (isBookSaved(id)) {
        btn.classList.add('saved');
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
      } else {
        btn.classList.remove('saved');
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
      }
    });
  }

  function updateReaderSaveBtn() {
    if (!state.currentBook) return;
    if (isBookSaved(state.currentBook.identifier)) {
      dom.readerSave.classList.add('reader-save-active');
      dom.readerSave.innerHTML =
        '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    } else {
      dom.readerSave.classList.remove('reader-save-active');
      dom.readerSave.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    }
  }

  // ===== Internet Archive Search =====
  async function searchBooks(query, page = 1) {
    if (!query.trim() || state.isSearching) return;

    state.isSearching = true;
    state.searchQuery = query.trim();
    state.currentPage = page;

    // Show loading
    dom.searchResultsSection.style.display = 'block';
    dom.searchResults.innerHTML = '';
    dom.searchLoading.style.display = 'block';
    dom.searchEmpty.style.display = 'none';
    dom.resultsTitle.textContent = 'Searching...';
    dom.resultsCount.textContent = '';

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const url = `https://archive.org/advancedsearch.php?q=${encodedQuery}+mediatype:texts&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=description&fl[]=subject&fl[]=language&sort[]=downloads+desc&rows=${state.rowsPerPage}&page=${page}&output=json`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      const docs = data.response.docs || [];
      state.numFound = data.response.numFound || 0;
      state.totalPages = Math.ceil(state.numFound / state.rowsPerPage);

      dom.searchLoading.style.display = 'none';

      if (docs.length === 0) {
        dom.searchEmpty.style.display = 'block';
        dom.resultsTitle.textContent = 'No Results';
        dom.resultsCount.textContent = '';
      } else {
        dom.resultsTitle.textContent = `Results for "${query.trim()}" - Page ${page} of ${state.totalPages}`;
        dom.resultsCount.textContent = `${state.numFound} books found`;
        renderBookGrid(docs, dom.searchResults, false);
      }
    } catch (err) {
      console.error('Search error:', err);
      dom.searchLoading.style.display = 'none';
      dom.searchEmpty.style.display = 'block';
      dom.searchEmpty.querySelector('p').textContent =
        'Something went wrong. Please try again.';
    } finally {
      state.isSearching = false;
    }
  }

  // ===== Render Book Grid =====
  function renderBookGrid(books, container, isLibrary) {
    container.innerHTML = '';

    books.forEach((book) => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Read ${book.title || 'Untitled'}`);

      const coverUrl = `https://archive.org/services/img/${book.identifier}`;
      const title = book.title || 'Untitled';
      const author = book.creator || 'Unknown author';
      const year = book.date
        ? book.date.substring(0, 4)
        : '';

      const saved = isBookSaved(book.identifier);

      card.innerHTML = `
        <img class="book-cover" src="${coverUrl}" alt="Cover of ${escapeHtml(title)}" loading="lazy"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="book-cover-placeholder" style="display:none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        </div>
        <div class="book-info">
          <div class="book-title">${escapeHtml(title)}</div>
          <div class="book-author">${escapeHtml(author)}</div>
          ${year ? `<div class="book-year">${year}</div>` : ''}
        </div>
        <div class="book-card-actions">
          ${isLibrary
          ? `<button class="book-action-btn remove" data-action="remove" data-identifier="${book.identifier}" aria-label="Remove from library">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>`
          : `<button class="book-action-btn ${saved ? 'saved' : ''}" data-action="save" data-identifier="${book.identifier}" aria-label="${saved ? 'Remove from library' : 'Save to library'}">
                  <svg viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>`
        }
        </div>
      `;

      // Click card -> open reader
      card.addEventListener('click', () => openReader(book));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openReader(book);
        }
      });

      // Save/remove button
      const actionBtn = card.querySelector('.book-action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isLibrary) {
            removeFromLibrary(book.identifier, e);
          } else {
            toggleSaveBook(book, e);
          }
        });
      }

      container.appendChild(card);
    });

    // Remove any existing pagination
    const existingPagination = dom.searchResultsSection.querySelector('.pagination');
    if (existingPagination) {
      existingPagination.remove();
    }

    // Add pagination if not library and multiple pages
    if (!isLibrary && state.totalPages > 1) {
      const paginationDiv = document.createElement('div');
      paginationDiv.className = 'pagination';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'btn-primary';
      prevBtn.textContent = 'Previous';
      prevBtn.disabled = state.currentPage <= 1;
      prevBtn.addEventListener('click', () => {
        if (state.currentPage > 1) {
          searchBooks(state.searchQuery, state.currentPage - 1);
        }
      });

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn-primary';
      nextBtn.textContent = 'Next';
      nextBtn.disabled = state.currentPage >= state.totalPages;
      nextBtn.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
          searchBooks(state.searchQuery, state.currentPage + 1);
        }
      });

      paginationDiv.appendChild(prevBtn);
      paginationDiv.appendChild(nextBtn);
      dom.searchResultsSection.appendChild(paginationDiv);
    }
  }

  // ===== Render Library =====
  function renderLibrary() {
    if (state.library.length === 0) {
      dom.libraryBooks.innerHTML = '';
      dom.libraryEmpty.style.display = 'block';
    } else {
      dom.libraryEmpty.style.display = 'none';
      renderBookGrid(state.library, dom.libraryBooks, true);
    }
  }

  // ===== Utilities =====
  function isViewerUrl(url) {
    return url.startsWith('https://archive.org/embed/');
  }

  // ===== Book Reader =====

  async function openReader(book) {
    state.currentBook = book;

    dom.readerTitle.textContent = book.title || 'Untitled';
    dom.readerAuthor.textContent = book.creator || 'Unknown author';
    dom.readerExternal.href = `https://archive.org/details/${book.identifier}`;

    const viewerUrl = `https://archive.org/embed/${book.identifier}`;
    renderViewer(viewerUrl);       // ⚡ key change

    state.currentViewer = 'embed';
    updateReaderSaveBtn();
    switchView('reader');
    window.scrollTo(0, 0);
  }
  function renderViewer(url) {
    const container = document.getElementById('pdf-viewer');
    container.innerHTML = `
    <iframe
      src="${url}"
      style="width:100%; height:100%; border:none;"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    ></iframe>
  `;
  }



  function closeReader() {
    dom.pdfViewer.innerHTML = '';
    state.currentBook = null;

    if (state.searchQuery && dom.searchResults.children.length > 0) {
      switchView('search');
    } else {
      switchView(
        state.library.length > 0 && state.currentView !== 'search'
          ? 'library'
          : 'search'
      );
    }
  }

  // ===== Chat =====
  function toggleChat() {
    state.chatOpen = !state.chatOpen;
    if (state.chatOpen) {
      dom.chatToggle.classList.add('open');
      dom.chatPanel.classList.add('open');
      updateChatUI();
      // Focus input if chat is ready
      if (state.apiKey) {
        setTimeout(() => dom.chatInput.focus(), 300);
      }
    } else {
      dom.chatToggle.classList.remove('open');
      dom.chatPanel.classList.remove('open');
      state.settingsOpen = false;
      dom.chatSettings.style.display = 'none';
    }
  }

  function updateChatUI() {
    if (state.apiKey) {
      dom.chatSetup.style.display = 'none';
      dom.chatMessages.style.display = 'flex';
      dom.chatInputArea.style.display = 'block';
      renderChatMessages();
    } else {
      dom.chatSetup.style.display = 'flex';
      dom.chatMessages.style.display = 'none';
      dom.chatInputArea.style.display = 'none';
    }
  }

  function saveApiKey(key) {
    if (!key.trim()) return;
    state.apiKey = key.trim();
    localStorage.setItem('librarium-api-key', state.apiKey);
    updateChatUI();
    showToast('API key saved');
  }

  function renderChatMessages() {
    // Keep the initial assistant message, then add stored messages
    dom.chatMessages.innerHTML = `
      <div class="message assistant">
        <div class="message-content">
          <p>Hello! I'm your book assistant. Tell me what genres or topics you enjoy, and I'll recommend books you might love. You can also ask me about any book you've found!</p>
        </div>
      </div>
    `;

    state.chatMessages.forEach((msg) => {
      appendMessageToDOM(msg.role, msg.content);
    });

    scrollChatToBottom();
  }

  function appendMessageToDOM(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user' : 'assistant'}`;

    // Format content: convert newlines and basic markdown
    const formatted = formatMessageContent(content);
    div.innerHTML = `<div class="message-content">${formatted}</div>`;

    dom.chatMessages.appendChild(div);
  }

  function formatMessageContent(text) {
    // Split into paragraphs
    const paragraphs = text.split(/\n\n+/);
    return paragraphs
      .map((p) => {
        // Handle bullet points
        const lines = p.split('\n');
        const formattedLines = lines.map((line) => {
          // Bold
          line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          // Italic
          line = line.replace(/\*(.*?)\*/g, '<em>$1</em>');
          // Bullet points
          if (line.match(/^[\-\*]\s/)) {
            return line.replace(/^[\-\*]\s/, '&bull; ');
          }
          // Numbered lists
          if (line.match(/^\d+\.\s/)) {
            return line;
          }
          return line;
        });
        return `<p>${formattedLines.join('<br>')}</p>`;
      })
      .join('');
  }

  function scrollChatToBottom() {
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = 'typing-indicator';
    div.innerHTML = `
      <div class="message-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    dom.chatMessages.appendChild(div);
    scrollChatToBottom();
  }

  function removeTypingIndicator() {
    const indicator = $('#typing-indicator');
    if (indicator) indicator.remove();
  }

  async function sendChatMessage() {
    const text = dom.chatInput.value.trim();
    if (!text || state.isChatLoading) return;

    // Add user message
    state.chatMessages.push({ role: 'user', content: text });
    localStorage.setItem('librarium-chat', JSON.stringify(state.chatMessages));
    appendMessageToDOM('user', text);
    scrollChatToBottom();

    // Clear input
    dom.chatInput.value = '';
    dom.chatInput.style.height = 'auto';
    dom.chatSend.disabled = true;

    // Show typing indicator
    state.isChatLoading = true;
    showTypingIndicator();

    try {
      // Build context about saved books
      const libraryContext =
        state.library.length > 0
          ? `The user has these books saved in their library: ${state.library
            .map((b) => `"${b.title}" by ${b.creator || 'Unknown'}`)
            .join(', ')}.`
          : 'The user has no books saved yet.';

      const systemPrompt = `You are a knowledgeable and friendly book recommendation assistant called Librarium Assistant. Your role is to help users discover books they'll love based on their interests, reading history, and preferences.

${libraryContext}

Guidelines:
- Recommend specific books with title and author
- Explain briefly why each recommendation fits their taste
- Consider both classic and contemporary works
- Be conversational and enthusiastic about books
- If asked about a specific book, provide interesting insights
- You can suggest books available on the Internet Archive (archive.org) when possible
- Keep responses concise but informative (2-4 paragraphs max)`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...state.chatMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${state.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Librarium Reading App',
          },
          body: JSON.stringify({
            model: state.model,
            messages: messages,
            temperature: 0.8,
            max_tokens: 800,
          }),
        }
      );

      removeTypingIndicator();

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || `API error: ${response.status}`
        );
      }

      const data = await response.json();
      const assistantMessage =
        data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

      state.chatMessages.push({
        role: 'assistant',
        content: assistantMessage,
      });
      localStorage.setItem(
        'librarium-chat',
        JSON.stringify(state.chatMessages)
      );
      appendMessageToDOM('assistant', assistantMessage);
      scrollChatToBottom();
    } catch (err) {
      console.error('Chat error:', err);
      removeTypingIndicator();

      const errorMsg = err.message.includes('API')
        ? `There was an issue with the API: ${err.message}. Please check your API key and try again.`
        : 'Something went wrong. Please try again.';

      appendMessageToDOM('assistant', errorMsg);
      scrollChatToBottom();
    } finally {
      state.isChatLoading = false;
    }
  }

  // ===== Utilities =====
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  // ===== Auto-resize textarea =====
  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
  }

  // ===== Event Listeners =====
  function initEventListeners() {
    // Navigation
    dom.navSearch.addEventListener('click', () => switchView('search'));
    dom.navLibrary.addEventListener('click', () => switchView('library'));
    dom.logoLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('search');
    });
    dom.goDiscover.addEventListener('click', () => switchView('search'));

    // Search
    dom.searchBtn.addEventListener('click', () =>
      searchBooks(dom.searchInput.value)
    );
    dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        searchBooks(dom.searchInput.value);
      }
    });

    // Suggestion chips
    $$('.suggestion-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const query = chip.dataset.query;
        dom.searchInput.value = query;
        searchBooks(query);
      });
    });

    // Reader
    dom.readerBack.addEventListener('click', closeReader);
    dom.readerSave.addEventListener('click', () => {
      if (state.currentBook) {
        toggleSaveBook(state.currentBook);
        updateReaderSaveBtn();
      }
    });

    // Chat toggle
    dom.chatToggle.addEventListener('click', toggleChat);

    // API Key setup
    dom.apiKeySave.addEventListener('click', () =>
      saveApiKey(dom.apiKeyInput.value)
    );
    dom.apiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveApiKey(dom.apiKeyInput.value);
    });

    // Chat input
    dom.chatInput.addEventListener('input', () => {
      autoResize(dom.chatInput);
      dom.chatSend.disabled = !dom.chatInput.value.trim();
    });
    dom.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    dom.chatSend.addEventListener('click', sendChatMessage);

    // Chat settings
    dom.chatSettingsToggle.addEventListener('click', () => {
      state.settingsOpen = !state.settingsOpen;
      if (state.settingsOpen) {
        dom.chatSettings.style.display = 'flex';
        dom.chatMessages.style.display = 'none';
        dom.chatInputArea.style.display = 'none';
        dom.settingsApiKey.value = state.apiKey;
        dom.settingsModel.value = state.model;
      } else {
        dom.chatSettings.style.display = 'none';
        if (state.apiKey) {
          dom.chatMessages.style.display = 'flex';
          dom.chatInputArea.style.display = 'block';
        }
      }
    });

    dom.settingsApiSave.addEventListener('click', () => {
      saveApiKey(dom.settingsApiKey.value);
    });

    dom.settingsModel.addEventListener('change', () => {
      state.model = dom.settingsModel.value;
      localStorage.setItem('librarium-model', state.model);
      showToast('Model updated');
    });

    dom.chatClear.addEventListener('click', () => {
      state.chatMessages = [];
      localStorage.removeItem('librarium-chat');
      renderChatMessages();
      showToast('Chat history cleared');
    });

    dom.settingsClose.addEventListener('click', () => {
      state.settingsOpen = false;
      dom.chatSettings.style.display = 'none';
      if (state.apiKey) {
        dom.chatMessages.style.display = 'flex';
        dom.chatInputArea.style.display = 'block';
      }
    });
  }

  // ===== Initialize =====
  function init() {
    initEventListeners();
    updateBadge();

    // Set model select to stored value
    dom.settingsModel.value = state.model;

    // Load initial chat UI state
    if (state.apiKey) {
      dom.apiKeyInput.value = state.apiKey;
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ================= PRELOADER =================

window.addEventListener("load", () => {
  const preloader = document.getElementById("preloader");

  // Small delay for smoother effect
  setTimeout(() => {
    preloader.classList.add("hidden");
  }, 500);
});