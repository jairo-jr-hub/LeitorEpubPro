/**
 * Leitor EPUB estático - Google Play Livros style
 * Utiliza EPUB.js, IndexedDB e LocalStorage
 */

// Constantes de banco de dados
const DB_NAME = 'EpubReaderDB';
const DB_STORE = 'books';
const LAST_BOOK_KEY = 'lastEpub';
const SETTINGS_PREFIX = 'reader-';

// Elementos DOM principais
const uploadScreen = document.getElementById('upload-screen');
const readerContainer = document.getElementById('reader-container');
const viewer = document.getElementById('viewer');
const fileInput = document.getElementById('file-input');
const fileSelectBtn = document.getElementById('file-select-btn');
const closeBtn = document.getElementById('close-btn');
const menuBtn = document.getElementById('menu-btn');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
const settingsBackdrop = document.querySelector('.settings-backdrop');
const topBar = document.getElementById('top-bar');
const bottomBar = document.getElementById('bottom-bar');
const bookTitleElem = document.getElementById('book-title');
const progressSlider = document.getElementById('progress-slider');
const progressLabel = document.getElementById('progress-label');
const pageInfo = document.getElementById('page-info');
const bookmarkToggleBtn = document.getElementById('bookmark-toggle-btn');
const bookmarkIcon = document.getElementById('bookmark-icon');
const tocList = document.getElementById('toc-list');
const bookmarkList = document.getElementById('bookmark-list');
const addManualBookmarkBtn = document.getElementById('add-manual-bookmark');

// Abas do painel
const tabButtons = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Variáveis de estado
let book = null;
let rendition = null;
let currentLocationCFI = null;
let currentHref = null;
let bookmarks = [];
let settings = {
  theme: 'clear',
  font: 'Literata',
  fontSize: 100,
  lineHeight: 1.5,
  wordSpacing: 0,
  margin: 5,
  justify: 'justify',
  topPadding: 0,
  bottomPadding: 0
};

// Inicialização do IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveEpubToDB(arrayBuffer, fileName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const record = { id: LAST_BOOK_KEY, data: arrayBuffer, fileName };
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function loadEpubFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(LAST_BOOK_KEY);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function deleteEpubFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.delete(LAST_BOOK_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Carregar/Salvar configurações localStorage
function loadSettings() {
  const keys = ['theme','font','fontSize','lineHeight','wordSpacing','margin','justify','topPadding','bottomPadding'];
  keys.forEach(key => {
    const stored = localStorage.getItem(SETTINGS_PREFIX + key);
    if (stored !== null) {
      if (key === 'fontSize' || key === 'lineHeight' || key === 'wordSpacing' || key === 'margin' || key === 'topPadding' || key === 'bottomPadding') {
        settings[key] = parseFloat(stored);
      } else {
        settings[key] = stored;
      }
    }
  });
}

function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_PREFIX + key, value);
}

function loadBookmarks() {
  const stored = localStorage.getItem(SETTINGS_PREFIX + 'bookmarks');
  if (stored) {
    try {
      bookmarks = JSON.parse(stored);
    } catch (e) {
      bookmarks = [];
    }
  }
}

function saveBookmarks() {
  localStorage.setItem(SETTINGS_PREFIX + 'bookmarks', JSON.stringify(bookmarks));
}

function loadProgress() {
  return localStorage.getItem(SETTINGS_PREFIX + 'progress');
}

function saveProgress(cfi) {
  localStorage.setItem(SETTINGS_PREFIX + 'progress', cfi);
}

// Atualizar meta theme-color
function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const theme = settings.theme;
  if (theme === 'dark') meta.content = '#121212';
  else if (theme === 'sepia') meta.content = '#f4ecd8';
  else meta.content = '#ffffff';
}

// Aplicar classe de tema ao body
function applyBodyTheme() {
  document.body.className = '';
  if (settings.theme === 'dark') document.body.classList.add('theme-dark');
  else if (settings.theme === 'sepia') document.body.classList.add('theme-sepia');
}

// Registrar e aplicar temas do EPUB.js
function applyEpubTheme() {
  if (!rendition) return;
  const themes = rendition.themes;
  // Registrar temas base
  themes.register('clear', {
    body: {
      background: '#ffffff',
      color: '#000000'
    }
  });
  themes.register('dark', {
    body: {
      background: '#121212',
      color: '#e0e0e0'
    }
  });
  themes.register('sepia', {
    body: {
      background: '#f4ecd8',
      color: '#3e3a37'
    }
  });

  // Selecionar tema
  themes.select(settings.theme);

  // Aplicar personalizações de texto
  applyTextSettings();
}

function applyTextSettings() {
  if (!rendition) return;
  const justify = settings.justify === 'justify' ? 'justify' : 'left';
  const marginPercent = settings.margin + '%';
  
  rendition.themes.override('*', {
    body: {
      'font-family': `${settings.font}, serif`,
      'font-size': `${settings.fontSize}%`,
      'line-height': settings.lineHeight,
      'word-spacing': `${settings.wordSpacing}px`,
      'text-align': justify,
      'padding-left': marginPercent,
      'padding-right': marginPercent
    }
  });
}

// Atualizar padding do viewer (safe area + respiros)
function updateViewerPadding() {
  const style = getComputedStyle(document.documentElement);
  const safeTop = parseFloat(style.getPropertyValue('--safe-inset-top')) || 0;
  const safeBottom = parseFloat(style.getPropertyValue('--safe-inset-bottom')) || 0;
  const topPad = safeTop + settings.topPadding;
  const bottomPad = safeBottom + settings.bottomPadding;
  viewer.style.paddingTop = topPad + 'px';
  viewer.style.paddingBottom = bottomPad + 'px';
}

// Configurar listeners de eventos
function setupEventListeners() {
  // Upload
  fileSelectBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  // Drag and drop na tela de upload
  uploadScreen.addEventListener('dragover', (e) => e.preventDefault());
  uploadScreen.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.epub')) {
      processEpubFile(file);
    }
  });

  // Fechar livro
  closeBtn.addEventListener('click', closeBook);

  // Menu de configurações
  menuBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', closeSettings);

  // Toque na área de leitura para alternar barras
  viewer.addEventListener('click', toggleBars);

  // Slider de progresso
  progressSlider.addEventListener('input', onProgressSliderInput);

  // Botão de marcador
  bookmarkToggleBtn.addEventListener('click', toggleBookmark);

  // Abas
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      switchTab(tab);
    });
  });

  // Configurações de tema
  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const theme = e.currentTarget.dataset.theme;
      changeTheme(theme);
    });
  });

  // Configurações de texto
  document.getElementById('font-family-select').addEventListener('change', (e) => {
    saveSetting('font', e.target.value);
    applyTextSettings();
  });
  document.getElementById('font-size-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('font-size-value').textContent = val + '%';
    saveSetting('fontSize', parseInt(val));
    applyTextSettings();
  });
  document.getElementById('line-height-slider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(2);
    document.getElementById('line-height-value').textContent = val;
    saveSetting('lineHeight', parseFloat(val));
    applyTextSettings();
  });
  document.getElementById('word-spacing-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('word-spacing-value').textContent = val + 'px';
    saveSetting('wordSpacing', parseFloat(val));
    applyTextSettings();
  });
  document.getElementById('margin-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('margin-value').textContent = val + '%';
    saveSetting('margin', parseInt(val));
    applyTextSettings();
  });
  document.getElementById('justify-select').addEventListener('change', (e) => {
    saveSetting('justify', e.target.value);
    applyTextSettings();
  });
  document.getElementById('top-padding-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('top-padding-value').textContent = val + 'px';
    saveSetting('topPadding', parseInt(val));
    updateViewerPadding();
  });
  document.getElementById('bottom-padding-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('bottom-padding-value').textContent = val + 'px';
    saveSetting('bottomPadding', parseInt(val));
    updateViewerPadding();
  });

  // Adicionar marcador manual
  addManualBookmarkBtn.addEventListener('click', addManualBookmark);
}

// Manipuladores
async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) await processEpubFile(file);
}

async function processEpubFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  await saveEpubToDB(arrayBuffer, file.name);
  await openEpub(arrayBuffer, file.name);
}

async function openEpub(arrayBuffer, fileName) {
  try {
    // Criar URL blob para o EPUB.js
    const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);
    
    book = ePub(url);
    rendition = book.renderTo(viewer, {
      flow: 'scrolled',
      width: '100%',
      height: '100%'
    });

    // Exibir título
    bookTitleElem.textContent = fileName.replace('.epub', '') || 'Livro';

    // Carregar metadados (opcional)
    book.loaded.metadata.then(meta => {
      if (meta.title) bookTitleElem.textContent = meta.title;
    }).catch(() => {});

    // Gerar locations para progresso
    await book.ready;
    await book.locations.generate(1600);

    // Aplicar tema e configurações
    applyEpubTheme();
    updateViewerPadding();
    updateThemeColor();
    applyBodyTheme();

    // Evento de mudança de localização
    rendition.on('relocated', onRelocated);

    // Recuperar último progresso
    const savedCFI = loadProgress();
    if (savedCFI) {
      rendition.display(savedCFI).catch(() => {
        rendition.display();
      });
    } else {
      rendition.display();
    }

    // Carregar TOC
    loadTOC();

    // Mostrar leitor, esconder upload
    uploadScreen.classList.add('hidden');
    readerContainer.classList.remove('hidden');

    // Iniciar com barras visíveis
    topBar.classList.remove('hidden-bar');
    bottomBar.classList.remove('hidden-bar');

    // Ajustar valores dos sliders de configuração
    syncSettingsUI();
  } catch (err) {
    alert('Erro ao abrir o EPUB: ' + err.message);
    console.error(err);
  }
}

function syncSettingsUI() {
  document.getElementById('font-family-select').value = settings.font;
  document.getElementById('font-size-slider').value = settings.fontSize;
  document.getElementById('font-size-value').textContent = settings.fontSize + '%';
  document.getElementById('line-height-slider').value = settings.lineHeight;
  document.getElementById('line-height-value').textContent = settings.lineHeight;
  document.getElementById('word-spacing-slider').value = settings.wordSpacing;
  document.getElementById('word-spacing-value').textContent = settings.wordSpacing + 'px';
  document.getElementById('margin-slider').value = settings.margin;
  document.getElementById('margin-value').textContent = settings.margin + '%';
  document.getElementById('justify-select').value = settings.justify;
  document.getElementById('top-padding-slider').value = settings.topPadding;
  document.getElementById('top-padding-value').textContent = settings.topPadding + 'px';
  document.getElementById('bottom-padding-slider').value = settings.bottomPadding;
  document.getElementById('bottom-padding-value').textContent = settings.bottomPadding + 'px';

  // Destacar tema ativo
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === settings.theme);
  });
}

function onRelocated(location) {
  currentLocationCFI = location.start.cfi;
  currentHref = location.start.href;

  // Atualizar progresso
  const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
  const percentRounded = Math.round(percent * 10) / 10;
  progressSlider.value = percentRounded;
  progressLabel.textContent = percentRounded + '%';

  // Estimativa de página (100 páginas totais)
  const totalPages = 100;
  const currentPage = Math.max(1, Math.round((percentRounded / 100) * totalPages));
  pageInfo.textContent = `Pág. ${currentPage}/${totalPages}`;

  // Salvar progresso automaticamente (debounce)
  clearTimeout(window._saveProgressTimeout);
  window._saveProgressTimeout = setTimeout(() => {
    saveProgress(currentLocationCFI);
  }, 500);

  // Atualizar estado do botão de marcador
  updateBookmarkButtonState();

  // Destacar capítulo atual no TOC
  highlightCurrentChapter();
}

function loadTOC() {
  if (!book || !book.navigation) return;
  const toc = book.navigation.toc;
  tocList.innerHTML = '';
  toc.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.label;
    li.dataset.href = item.href;
    li.addEventListener('click', () => {
      rendition.display(item.href);
      closeSettings();
    });
    tocList.appendChild(li);
  });
}

function highlightCurrentChapter() {
  if (!currentHref) return;
  const items = tocList.querySelectorAll('li');
  items.forEach(li => {
    li.classList.toggle('active', li.dataset.href === currentHref);
  });
}

// Controle de barras
function toggleBars(e) {
  // Evitar fechar ao clicar em controles
  if (e.target.closest('button') || e.target.closest('input')) return;
  const topHidden = topBar.classList.contains('hidden-bar');
  if (topHidden) {
    topBar.classList.remove('hidden-bar');
    bottomBar.classList.remove('hidden-bar');
  } else {
    topBar.classList.add('hidden-bar');
    bottomBar.classList.add('hidden-bar');
  }
}

// Configurações e temas
function changeTheme(theme) {
  saveSetting('theme', theme);
  rendition.themes.select(theme);
  updateThemeColor();
  applyBodyTheme();
  // Atualizar seleção visual
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
}

function openSettings() {
  settingsPanel.classList.remove('hidden');
  // Exibir abas padrão
  switchTab('themes');
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
}

function switchTab(tabId) {
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  tabContents.forEach(content => content.classList.toggle('active', content.id === `tab-${tabId}`));
  // Atualizar listas se necessário
  if (tabId === 'bookmarks') renderBookmarks();
  if (tabId === 'chapters') loadTOC();
}

// Marcadores
function toggleBookmark() {
  if (!currentLocationCFI) return;
  const existingIndex = bookmarks.findIndex(b => b.cfi === currentLocationCFI);
  if (existingIndex > -1) {
    // Remover
    bookmarks.splice(existingIndex, 1);
  } else {
    // Adicionar
    const chapterTitle = getCurrentChapterTitle();
    const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
    bookmarks.push({
      cfi: currentLocationCFI,
      percent: Math.round(percent * 10) / 10,
      chapter: chapterTitle,
      time: new Date().toISOString()
    });
  }
  saveBookmarks();
  updateBookmarkButtonState();
  // Atualizar lista se visível
  if (document.getElementById('tab-bookmarks').classList.contains('active')) {
    renderBookmarks();
  }
}

function addManualBookmark() {
  if (!currentLocationCFI) return;
  // Mesmo comportamento de adicionar marcador, mas forçando adição mesmo que exista
  const existingIndex = bookmarks.findIndex(b => b.cfi === currentLocationCFI);
  if (existingIndex > -1) {
    // Já existe, mas podemos recriar com timestamp novo (opcional)
    bookmarks[existingIndex].time = new Date().toISOString();
  } else {
    const chapterTitle = getCurrentChapterTitle();
    const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
    bookmarks.push({
      cfi: currentLocationCFI,
      percent: Math.round(percent * 10) / 10,
      chapter: chapterTitle,
      time: new Date().toISOString()
    });
  }
  saveBookmarks();
  updateBookmarkButtonState();
  renderBookmarks();
}

function updateBookmarkButtonState() {
  if (!currentLocationCFI) return;
  const isBookmarked = bookmarks.some(b => b.cfi === currentLocationCFI);
  bookmarkToggleBtn.classList.toggle('active', isBookmarked);
  // O ícone muda fill via CSS
}

function renderBookmarks() {
  bookmarkList.innerHTML = '';
  bookmarks.slice().reverse().forEach((bm, index) => {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.textContent = `${bm.chapter || 'Local'} - ${bm.percent}%`;
    info.addEventListener('click', () => {
      rendition.display(bm.cfi);
      closeSettings();
    });
    const delBtn = document.createElement('button');
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bookmarks.splice(bookmarks.length - 1 - index, 1);
      saveBookmarks();
      updateBookmarkButtonState();
      renderBookmarks();
    });
    li.appendChild(info);
    li.appendChild(delBtn);
    bookmarkList.appendChild(li);
  });
}

function getCurrentChapterTitle() {
  if (!book || !book.navigation || !currentHref) return '';
  const toc = book.navigation.toc;
  const item = toc.find(i => i.href === currentHref);
  return item ? item.label : '';
}

// Slider de progresso
function onProgressSliderInput(e) {
  const percent = parseFloat(e.target.value);
  if (!isNaN(percent) && book && book.locations) {
    const cfi = book.locations.cfiFromPercentage(percent / 100);
    if (cfi) {
      rendition.display(cfi);
    }
  }
}

// Fechar livro e voltar ao upload
async function closeBook() {
  if (rendition) {
    rendition.destroy();
    rendition = null;
  }
  book = null;
  if (viewer) viewer.innerHTML = '';
  readerContainer.classList.add('hidden');
  uploadScreen.classList.remove('hidden');
  // Opcional: não deletar do IndexedDB para reabrir depois
}

// Inicialização automática ao carregar a página
async function autoLoadLastBook() {
  loadSettings();
  loadBookmarks();
  try {
    const record = await loadEpubFromDB();
    if (record && record.data) {
      await openEpub(record.data, record.fileName || 'Livro');
    }
  } catch (e) {
    // Nenhum livro salvo, permanece na tela de upload
  }
}

// Configurar tudo
setupEventListeners();
autoLoadLastBook();
