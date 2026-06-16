/**
 * Leitor EPUB Estático - Google Play Livros style
 * Versão revisada com logs e tratamento defensivo
 */

// Verifica se EPUB.js foi carregado
const epubJsAvailable = (typeof ePub !== 'undefined');
if (!epubJsAvailable) {
  console.error('EPUB.js não carregado! O leitor não funcionará.');
  // Mostra mensagem na tela de upload
  document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('lib-status');
    if (statusDiv) {
      statusDiv.textContent = 'Erro: biblioteca EPUB.js não carregada. Verifique sua conexão com a internet.';
    }
  });
}

// Constantes
const DB_NAME = 'EpubReaderDB';
const DB_STORE = 'books';
const LAST_BOOK_KEY = 'lastEpub';
const SETTINGS_PREFIX = 'reader-';

// Elementos DOM
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
const tocList = document.getElementById('toc-list');
const bookmarkList = document.getElementById('bookmark-list');
const addManualBookmarkBtn = document.getElementById('add-manual-bookmark');

// Estado
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

// ==================== IndexedDB ====================
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB não suportado'));
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
    tx.objectStore(DB_STORE).put({ id: LAST_BOOK_KEY, data: arrayBuffer, fileName });
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function loadEpubFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(LAST_BOOK_KEY);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch { return null; }
}

async function deleteEpubFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(LAST_BOOK_KEY);
      tx.oncomplete = resolve;
    });
  } catch {}
}

// ==================== LocalStorage ====================
function loadSettings() {
  const keys = ['theme','font','fontSize','lineHeight','wordSpacing','margin','justify','topPadding','bottomPadding'];
  keys.forEach(k => {
    const val = localStorage.getItem(SETTINGS_PREFIX + k);
    if (val !== null) settings[k] = isNaN(val) ? val : parseFloat(val);
  });
}

function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_PREFIX + key, value);
}

function loadBookmarks() {
  const stored = localStorage.getItem(SETTINGS_PREFIX + 'bookmarks');
  bookmarks = stored ? JSON.parse(stored) : [];
}

function saveBookmarks() {
  localStorage.setItem(SETTINGS_PREFIX + 'bookmarks', JSON.stringify(bookmarks));
}

function loadProgress() {
  return localStorage.getItem(SETTINGS_PREFIX + 'progress');
}

function saveProgress(cfi) {
  if (cfi) localStorage.setItem(SETTINGS_PREFIX + 'progress', cfi);
}

// ==================== Temas ====================
function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = settings.theme === 'dark' ? '#121212' : settings.theme === 'sepia' ? '#f4ecd8' : '#ffffff';
  }
}

function applyBodyTheme() {
  document.body.className = '';
  if (settings.theme === 'dark') document.body.classList.add('theme-dark');
  else if (settings.theme === 'sepia') document.body.classList.add('theme-sepia');
}

function applyEpubTheme() {
  if (!rendition) return;
  rendition.themes.register('clear', { body: { background: '#fff', color: '#000' } });
  rendition.themes.register('dark', { body: { background: '#121212', color: '#e0e0e0' } });
  rendition.themes.register('sepia', { body: { background: '#f4ecd8', color: '#3e3a37' } });
  rendition.themes.select(settings.theme);
  applyTextSettings();
}

function applyTextSettings() {
  if (!rendition) return;
  rendition.themes.override('*', {
    body: {
      'font-family': `${settings.font}, serif`,
      'font-size': `${settings.fontSize}%`,
      'line-height': settings.lineHeight,
      'word-spacing': `${settings.wordSpacing}px`,
      'text-align': settings.justify === 'justify' ? 'justify' : 'left',
      'padding-left': `${settings.margin}%`,
      'padding-right': `${settings.margin}%`
    }
  });
}

function updateViewerPadding() {
  if (!viewer) return;
  const style = getComputedStyle(document.documentElement);
  const safeTop = parseFloat(style.getPropertyValue('--safe-inset-top')) || 0;
  const safeBottom = parseFloat(style.getPropertyValue('--safe-inset-bottom')) || 0;
  viewer.style.paddingTop = (safeTop + settings.topPadding) + 'px';
  viewer.style.paddingBottom = (safeBottom + settings.bottomPadding) + 'px';
}

// ==================== Configuração de Eventos ====================
function setupEventListeners() {
  console.log('Configurando event listeners...');

  // Botão de upload
  if (fileSelectBtn && fileInput) {
    fileSelectBtn.addEventListener('click', () => {
      console.log('Botão "Escolher arquivo" clicado.');
      fileInput.click();
    });
  } else {
    console.error('Elementos do upload não encontrados!');
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      console.log('Arquivo selecionado:', e.target.files[0]?.name);
      handleFileSelect(e);
    });
  }

  // Drag and drop
  if (uploadScreen) {
    uploadScreen.addEventListener('dragover', (e) => e.preventDefault());
    uploadScreen.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.epub')) {
        processEpubFile(file);
      }
    });
  }

  // Controles do leitor
  if (closeBtn) closeBtn.addEventListener('click', closeBook);
  if (menuBtn) menuBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);
  if (viewer) viewer.addEventListener('click', toggleBars);
  if (progressSlider) progressSlider.addEventListener('input', onProgressSliderInput);
  if (bookmarkToggleBtn) bookmarkToggleBtn.addEventListener('click', toggleBookmark);

  // Abas
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
  });

  // Temas
  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', (e) => changeTheme(e.currentTarget.dataset.theme));
  });

  // Configurações de texto
  document.getElementById('font-family-select')?.addEventListener('change', (e) => { saveSetting('font', e.target.value); applyTextSettings(); });
  document.getElementById('font-size-slider')?.addEventListener('input', (e) => {
    document.getElementById('font-size-value').textContent = e.target.value + '%';
    saveSetting('fontSize', parseInt(e.target.value));
    applyTextSettings();
  });
  document.getElementById('line-height-slider')?.addEventListener('input', (e) => {
    document.getElementById('line-height-value').textContent = parseFloat(e.target.value).toFixed(2);
    saveSetting('lineHeight', parseFloat(e.target.value));
    applyTextSettings();
  });
  document.getElementById('word-spacing-slider')?.addEventListener('input', (e) => {
    document.getElementById('word-spacing-value').textContent = e.target.value + 'px';
    saveSetting('wordSpacing', parseFloat(e.target.value));
    applyTextSettings();
  });
  document.getElementById('margin-slider')?.addEventListener('input', (e) => {
    document.getElementById('margin-value').textContent = e.target.value + '%';
    saveSetting('margin', parseInt(e.target.value));
    applyTextSettings();
  });
  document.getElementById('justify-select')?.addEventListener('change', (e) => { saveSetting('justify', e.target.value); applyTextSettings(); });
  document.getElementById('top-padding-slider')?.addEventListener('input', (e) => {
    document.getElementById('top-padding-value').textContent = e.target.value + 'px';
    saveSetting('topPadding', parseInt(e.target.value));
    updateViewerPadding();
  });
  document.getElementById('bottom-padding-slider')?.addEventListener('input', (e) => {
    document.getElementById('bottom-padding-value').textContent = e.target.value + 'px';
    saveSetting('bottomPadding', parseInt(e.target.value));
    updateViewerPadding();
  });

  if (addManualBookmarkBtn) addManualBookmarkBtn.addEventListener('click', addManualBookmark);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPanel && !settingsPanel.classList.contains('hidden')) closeSettings();
  });

  console.log('Listeners configurados com sucesso.');
}

// ==================== Manipulação de EPUB ====================
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    console.log('handleFileSelect:', file.name);
    processEpubFile(file);
  }
}

async function processEpubFile(file) {
  if (!epubJsAvailable) {
    alert('EPUB.js não está disponível. Verifique sua conexão.');
    return;
  }
  console.log('Processando arquivo...');
  try {
    const arrayBuffer = await file.arrayBuffer();
    await saveEpubToDB(arrayBuffer, file.name);
    console.log('Salvo no IndexedDB.');
    await openEpub(arrayBuffer, file.name);
  } catch (err) {
    console.error('Erro ao processar:', err);
    alert('Erro ao processar arquivo: ' + err.message);
  }
}

async function openEpub(arrayBuffer, fileName) {
  try {
    const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);
    book = ePub(url);
    rendition = book.renderTo(viewer, { flow: 'scrolled', width: '100%', height: '100%' });
    bookTitleElem.textContent = fileName.replace(/\.epub$/i, '') || 'Livro';

    book.loaded.metadata.then(m => { if (m.title) bookTitleElem.textContent = m.title; }).catch(() => {});
    await book.ready;
    console.log('Livro pronto.');
    await book.locations.generate(1600);
    console.log('Locations geradas.');

    applyEpubTheme();
    updateViewerPadding();
    updateThemeColor();
    applyBodyTheme();

    rendition.on('relocated', onRelocated);

    const savedCFI = loadProgress();
    if (savedCFI) {
      await rendition.display(savedCFI).catch(() => rendition.display());
    } else {
      await rendition.display();
    }

    loadTOC();
    uploadScreen.classList.add('hidden');
    readerContainer.classList.remove('hidden');
    topBar.classList.remove('hidden-bar');
    bottomBar.classList.remove('hidden-bar');
    syncSettingsUI();
  } catch (err) {
    console.error('Erro ao abrir EPUB:', err);
    alert('Erro ao abrir o EPUB: ' + err.message);
    if (rendition) { rendition.destroy(); rendition = null; }
    book = null;
    readerContainer.classList.add('hidden');
    uploadScreen.classList.remove('hidden');
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
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === settings.theme));
}

// ==================== Leitura ====================
function onRelocated(location) {
  if (!location?.start) return;
  currentLocationCFI = location.start.cfi;
  currentHref = location.start.href;

  const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
  const rounded = Math.round(percent * 10) / 10;
  progressSlider.value = rounded;
  progressLabel.textContent = rounded + '%';
  const page = Math.max(1, Math.round((rounded / 100) * 100));
  pageInfo.textContent = `Pág. ${page}/100`;

  clearTimeout(window._autoSave);
  window._autoSave = setTimeout(() => saveProgress(currentLocationCFI), 500);
  updateBookmarkBtn();
  highlightChapter();
}

// ==================== TOC ====================
function loadTOC() {
  if (!book?.navigation) return;
  const toc = book.navigation.toc;
  tocList.innerHTML = '';
  toc.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.label;
    li.dataset.href = item.href;
    li.addEventListener('click', () => { rendition.display(item.href); closeSettings(); });
    tocList.appendChild(li);
  });
}

function highlightChapter() {
  if (!currentHref) return;
  tocList.querySelectorAll('li').forEach(li => li.classList.toggle('active', li.dataset.href === currentHref));
}

// ==================== Barras ====================
function toggleBars(e) {
  if (e.target.closest('button') || e.target.closest('input')) return;
  const hidden = topBar.classList.contains('hidden-bar');
  topBar.classList.toggle('hidden-bar', !hidden);
  bottomBar.classList.toggle('hidden-bar', !hidden);
}

// ==================== Configurações ====================
function openSettings() {
  settingsPanel.classList.remove('hidden');
  switchTab('themes');
}
function closeSettings() {
  settingsPanel.classList.add('hidden');
}
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));
  if (tabId === 'bookmarks') renderBookmarks();
  if (tabId === 'chapters') loadTOC();
}

function changeTheme(theme) {
  saveSetting('theme', theme);
  if (rendition) rendition.themes.select(theme);
  updateThemeColor();
  applyBodyTheme();
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
}

// ==================== Marcadores ====================
function toggleBookmark() {
  if (!currentLocationCFI) return;
  const idx = bookmarks.findIndex(b => b.cfi === currentLocationCFI);
  if (idx > -1) bookmarks.splice(idx, 1);
  else {
    const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
    const chapter = getChapterTitle();
    bookmarks.push({ cfi: currentLocationCFI, percent: Math.round(percent*10)/10, chapter, time: new Date().toISOString() });
  }
  saveBookmarks();
  updateBookmarkBtn();
  if (document.getElementById('tab-bookmarks').classList.contains('active')) renderBookmarks();
}

function addManualBookmark() {
  if (!currentLocationCFI) return;
  const idx = bookmarks.findIndex(b => b.cfi === currentLocationCFI);
  if (idx > -1) bookmarks[idx].time = new Date().toISOString();
  else {
    const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
    bookmarks.push({ cfi: currentLocationCFI, percent: Math.round(percent*10)/10, chapter: getChapterTitle(), time: new Date().toISOString() });
  }
  saveBookmarks();
  updateBookmarkBtn();
  renderBookmarks();
}

function updateBookmarkBtn() {
  bookmarkToggleBtn.classList.toggle('active', bookmarks.some(b => b.cfi === currentLocationCFI));
}

function renderBookmarks() {
  bookmarkList.innerHTML = '';
  [...bookmarks].reverse().forEach((b, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${b.chapter ? b.chapter + ' - ' : ''}${b.percent}%</span>
    <button data-index="${bookmarks.length-1-i}">&times;</button>`;
    li.querySelector('span').addEventListener('click', () => { rendition.display(b.cfi); closeSettings(); });
    li.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      bookmarks.splice(parseInt(e.target.dataset.index), 1);
      saveBookmarks();
      renderBookmarks();
      updateBookmarkBtn();
    });
    bookmarkList.appendChild(li);
  });
}

function getChapterTitle() {
  if (!book?.navigation || !currentHref) return '';
  const item = book.navigation.toc.find(i => i.href === currentHref);
  return item?.label || '';
}

function onProgressSliderInput(e) {
  const percent = parseFloat(e.target.value);
  if (!isNaN(percent) && book?.locations) {
    const cfi = book.locations.cfiFromPercentage(percent/100);
    if (cfi) rendition.display(cfi);
  }
}

async function closeBook() {
  if (rendition) { rendition.destroy(); rendition = null; }
  book = null;
  viewer.innerHTML = '';
  readerContainer.classList.add('hidden');
  uploadScreen.classList.remove('hidden');
}

// ==================== Inicialização ====================
(async function init() {
  loadSettings();
  loadBookmarks();
  setupEventListeners();

  if (epubJsAvailable) {
    try {
      const record = await loadEpubFromDB();
      if (record?.data) {
        console.log('Abrindo último livro...');
        await openEpub(record.data, record.fileName || 'Livro');
      }
    } catch (e) {
      console.warn('Não foi possível restaurar último livro:', e);
      await deleteEpubFromDB();
    }
  }
})();
