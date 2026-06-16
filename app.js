/**
 * Leitor EPUB Estático - Estilo Google Play Livros
 * 
 * Funcionalidades:
 * - Abertura de arquivos EPUB locais
 * - Persistência via IndexedDB (arquivo) e LocalStorage (configurações)
 * - Temas: Claro, Escuro, Sépia
 * - Personalização completa de texto
 * - Experiência mobile otimizada (safe area, theme-color)
 * - Salvamento automático de progresso
 * - Marcadores (bookmarks)
 * - Navegação por capítulos (TOC)
 * - Interface responsiva com animações suaves
 * 
 * Dependência: EPUB.js (carregada via CDN no HTML)
 */

// ==============================
// VERIFICAÇÃO DE DEPENDÊNCIA
// ==============================
if (typeof ePub === 'undefined') {
    alert('Erro: A biblioteca EPUB.js não foi carregada. Verifique sua conexão com a internet e recarregue a página.');
    throw new Error('EPUB.js não está disponível');
}

// ==============================
// CONFIGURAÇÕES E CONSTANTES
// ==============================
const DB_NAME = 'EpubReaderDB';
const DB_STORE = 'books';
const LAST_BOOK_KEY = 'lastEpub';
const SETTINGS_PREFIX = 'reader-';
const LOCATIONS_GENERATE_INTERVAL = 1600; // Intervalo para geração de locations (equilíbrio performance/precisão)
const AUTO_SAVE_DEBOUNCE = 500; // Debounce para salvamento automático de progresso (ms)

// ==============================
// ELEMENTOS DOM PRINCIPAIS
// ==============================
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

// Abas do painel de configurações
const tabButtons = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// ==============================
// VARIÁVEIS DE ESTADO
// ==============================
let book = null;                    // Instância do livro EPUB.js
let rendition = null;              // Instância da renderização
let currentLocationCFI = null;     // CFI da posição atual
let currentHref = null;            // Href do capítulo/seção atual
let bookmarks = [];                // Array de marcadores
let settings = {                   // Configurações do usuário
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

// ==============================
// GERENCIAMENTO DO INDEXEDDB
// ==============================

/**
 * Abre ou cria o banco de dados IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE, { keyPath: 'id' });
                console.log('Object store criada:', DB_STORE);
            }
        };
        
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        
        request.onerror = (event) => {
            console.error('Erro ao abrir IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Salva o arquivo EPUB no IndexedDB
 * @param {ArrayBuffer} arrayBuffer - Conteúdo do arquivo EPUB
 * @param {string} fileName - Nome do arquivo
 */
async function saveEpubToDB(arrayBuffer, fileName) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite');
            const store = transaction.objectStore(DB_STORE);
            const record = { 
                id: LAST_BOOK_KEY, 
                data: arrayBuffer, 
                fileName: fileName 
            };
            
            store.put(record);
            
            transaction.oncomplete = () => {
                console.log('EPUB salvo no IndexedDB:', fileName);
                resolve();
            };
            
            transaction.onerror = (event) => {
                console.error('Erro ao salvar no IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error('Falha ao salvar EPUB no IndexedDB:', error);
        throw error;
    }
}

/**
 * Carrega o último livro salvo do IndexedDB
 * @returns {Promise<Object|null>} Registro do livro ou null
 */
async function loadEpubFromDB() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readonly');
            const store = transaction.objectStore(DB_STORE);
            const request = store.get(LAST_BOOK_KEY);
            
            request.onsuccess = (event) => {
                const result = event.target.result;
                console.log('Livro carregado do IndexedDB:', result ? result.fileName : 'nenhum');
                resolve(result || null);
            };
            
            request.onerror = (event) => {
                console.error('Erro ao carregar do IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error('Falha ao carregar EPUB do IndexedDB:', error);
        return null;
    }
}

/**
 * Remove o livro salvo do IndexedDB
 */
async function deleteEpubFromDB() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite');
            const store = transaction.objectStore(DB_STORE);
            store.delete(LAST_BOOK_KEY);
            
            transaction.oncomplete = () => {
                console.log('Livro removido do IndexedDB');
                resolve();
            };
            
            transaction.onerror = (event) => {
                console.error('Erro ao remover do IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error('Falha ao remover EPUB do IndexedDB:', error);
    }
}

// ==============================
// GERENCIAMENTO DO LOCALSTORAGE
// ==============================

/**
 * Carrega todas as configurações do localStorage
 */
function loadSettings() {
    const keys = [
        'theme', 'font', 'fontSize', 'lineHeight', 
        'wordSpacing', 'margin', 'justify', 'topPadding', 'bottomPadding'
    ];
    
    keys.forEach(key => {
        const stored = localStorage.getItem(SETTINGS_PREFIX + key);
        if (stored !== null) {
            // Converter para número quando necessário
            if (['fontSize', 'lineHeight', 'wordSpacing', 'margin', 'topPadding', 'bottomPadding'].includes(key)) {
                settings[key] = parseFloat(stored);
            } else {
                settings[key] = stored;
            }
        }
    });
    
    console.log('Configurações carregadas:', settings);
}

/**
 * Salva uma configuração específica no localStorage
 * @param {string} key - Chave da configuração
 * @param {*} value - Valor a ser salvo
 */
function saveSetting(key, value) {
    settings[key] = value;
    localStorage.setItem(SETTINGS_PREFIX + key, value);
}

/**
 * Carrega os marcadores do localStorage
 */
function loadBookmarks() {
    const stored = localStorage.getItem(SETTINGS_PREFIX + 'bookmarks');
    if (stored) {
        try {
            bookmarks = JSON.parse(stored);
            console.log('Marcadores carregados:', bookmarks.length);
        } catch (error) {
            console.error('Erro ao carregar marcadores:', error);
            bookmarks = [];
        }
    }
}

/**
 * Salva os marcadores no localStorage
 */
function saveBookmarks() {
    localStorage.setItem(SETTINGS_PREFIX + 'bookmarks', JSON.stringify(bookmarks));
}

/**
 * Carrega o progresso salvo (CFI)
 * @returns {string|null} CFI da última posição ou null
 */
function loadProgress() {
    return localStorage.getItem(SETTINGS_PREFIX + 'progress');
}

/**
 * Salva o progresso atual (CFI)
 * @param {string} cfi - CFI da posição atual
 */
function saveProgress(cfi) {
    if (cfi) {
        localStorage.setItem(SETTINGS_PREFIX + 'progress', cfi);
    }
}

// ==============================
// GERENCIAMENTO DE TEMAS E APARÊNCIA
// ==============================

/**
 * Atualiza a meta tag theme-color conforme o tema ativo
 * Essencial para a experiência mobile (barra de status colorida)
 */
function updateThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    
    switch (settings.theme) {
        case 'dark':
            meta.content = '#121212';
            break;
        case 'sepia':
            meta.content = '#f4ecd8';
            break;
        default: // clear
            meta.content = '#ffffff';
    }
}

/**
 * Aplica classe de tema ao body para estilização CSS
 */
function applyBodyTheme() {
    document.body.className = '';
    if (settings.theme === 'dark') {
        document.body.classList.add('theme-dark');
    } else if (settings.theme === 'sepia') {
        document.body.classList.add('theme-sepia');
    }
}

/**
 * Registra e aplica temas no EPUB.js
 */
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
    
    // Selecionar tema atual
    themes.select(settings.theme);
    
    // Aplicar personalizações de texto
    applyTextSettings();
}

/**
 * Aplica configurações de texto personalizadas
 */
function applyTextSettings() {
    if (!rendition) return;
    
    const textAlign = settings.justify === 'justify' ? 'justify' : 'left';
    const marginPercent = settings.margin + '%';
    
    rendition.themes.override('*', {
        body: {
            'font-family': `${settings.font}, serif`,
            'font-size': `${settings.fontSize}%`,
            'line-height': settings.lineHeight,
            'word-spacing': `${settings.wordSpacing}px`,
            'text-align': textAlign,
            'padding-left': marginPercent,
            'padding-right': marginPercent
        }
    });
}

/**
 * Atualiza o padding do viewer considerando safe area e respiros configurados
 */
function updateViewerPadding() {
    const style = getComputedStyle(document.documentElement);
    const safeTop = parseFloat(style.getPropertyValue('--safe-inset-top')) || 0;
    const safeBottom = parseFloat(style.getPropertyValue('--safe-inset-bottom')) || 0;
    
    const topPad = safeTop + settings.topPadding;
    const bottomPad = safeBottom + settings.bottomPadding;
    
    viewer.style.paddingTop = topPad + 'px';
    viewer.style.paddingBottom = bottomPad + 'px';
}

// ==============================
// CONFIGURAÇÃO DE EVENT LISTENERS
// ==============================

function setupEventListeners() {
    // Upload de arquivo
    fileSelectBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    
    // Drag and drop na tela de upload
    uploadScreen.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    
    uploadScreen.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        const file = event.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith('.epub')) {
            await processEpubFile(file);
        } else {
            alert('Por favor, selecione um arquivo EPUB válido.');
        }
    });
    
    // Navegação e controles
    closeBtn.addEventListener('click', closeBook);
    menuBtn.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);
    settingsBackdrop.addEventListener('click', closeSettings);
    
    // Toque na área de leitura para alternar visibilidade das barras
    viewer.addEventListener('click', toggleBars);
    
    // Slider de progresso
    progressSlider.addEventListener('input', onProgressSliderInput);
    
    // Botão de marcador
    bookmarkToggleBtn.addEventListener('click', toggleBookmark);
    
    // Abas do painel de configurações
    tabButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const tabId = event.target.dataset.tab;
            switchTab(tabId);
        });
    });
    
    // Seleção de tema
    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', (event) => {
            const theme = event.currentTarget.dataset.theme;
            changeTheme(theme);
        });
    });
    
    // Configurações de texto
    document.getElementById('font-family-select').addEventListener('change', (event) => {
        saveSetting('font', event.target.value);
        applyTextSettings();
    });
    
    document.getElementById('font-size-slider').addEventListener('input', (event) => {
        const value = event.target.value;
        document.getElementById('font-size-value').textContent = value + '%';
        saveSetting('fontSize', parseInt(value));
        applyTextSettings();
    });
    
    document.getElementById('line-height-slider').addEventListener('input', (event) => {
        const value = parseFloat(event.target.value).toFixed(2);
        document.getElementById('line-height-value').textContent = value;
        saveSetting('lineHeight', parseFloat(value));
        applyTextSettings();
    });
    
    document.getElementById('word-spacing-slider').addEventListener('input', (event) => {
        const value = event.target.value;
        document.getElementById('word-spacing-value').textContent = value + 'px';
        saveSetting('wordSpacing', parseFloat(value));
        applyTextSettings();
    });
    
    document.getElementById('margin-slider').addEventListener('input', (event) => {
        const value = event.target.value;
        document.getElementById('margin-value').textContent = value + '%';
        saveSetting('margin', parseInt(value));
        applyTextSettings();
    });
    
    document.getElementById('justify-select').addEventListener('change', (event) => {
        saveSetting('justify', event.target.value);
        applyTextSettings();
    });
    
    document.getElementById('top-padding-slider').addEventListener('input', (event) => {
        const value = event.target.value;
        document.getElementById('top-padding-value').textContent = value + 'px';
        saveSetting('topPadding', parseInt(value));
        updateViewerPadding();
    });
    
    document.getElementById('bottom-padding-slider').addEventListener('input', (event) => {
        const value = event.target.value;
        document.getElementById('bottom-padding-value').textContent = value + 'px';
        saveSetting('bottomPadding', parseInt(value));
        updateViewerPadding();
    });
    
    // Marcador manual
    addManualBookmarkBtn.addEventListener('click', addManualBookmark);
    
    // Fechar painel com tecla ESC
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !settingsPanel.classList.contains('hidden')) {
            closeSettings();
        }
    });
}

// ==============================
// MANIPULAÇÃO DE ARQUIVOS EPUB
// ==============================

/**
 * Manipula a seleção de arquivo via input
 * @param {Event} event - Evento de mudança do input
 */
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        await processEpubFile(file);
    }
}

/**
 * Processa o arquivo EPUB selecionado
 * @param {File} file - Arquivo EPUB
 */
async function processEpubFile(file) {
    // Verificar suporte a ArrayBuffer
    if (!file.arrayBuffer) {
        alert('Seu navegador não suporta a leitura de arquivos necessária. Use Chrome, Edge ou Safari atualizado.');
        return;
    }
    
    try {
        console.log('Processando arquivo:', file.name);
        const arrayBuffer = await file.arrayBuffer();
        await saveEpubToDB(arrayBuffer, file.name);
        await openEpub(arrayBuffer, file.name);
    } catch (error) {
        console.error('Erro ao processar arquivo:', error);
        alert('Falha ao processar o arquivo: ' + error.message);
    }
}

/**
 * Abre e renderiza um arquivo EPUB
 * @param {ArrayBuffer} arrayBuffer - Conteúdo do EPUB
 * @param {string} fileName - Nome do arquivo
 */
async function openEpub(arrayBuffer, fileName) {
    console.log('Iniciando abertura do EPUB:', fileName);
    
    try {
        // Criar blob URL para o EPUB.js
        const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
        const url = URL.createObjectURL(blob);
        
        // Criar instância do livro
        book = ePub(url);
        
        // Renderizar no viewer
        rendition = book.renderTo(viewer, {
            flow: 'scrolled',      // Rolagem contínua (como Google Play Livros)
            width: '100%',
            height: '100%'
        });
        
        // Atualizar título
        bookTitleElem.textContent = fileName.replace(/\.epub$/i, '') || 'Livro';
        
        // Tentar obter metadados (título real)
        book.loaded.metadata.then(metadata => {
            if (metadata.title) {
                bookTitleElem.textContent = metadata.title;
            }
        }).catch(() => {
            // Manter o título baseado no nome do arquivo
        });
        
        // Aguardar o livro estar pronto
        await book.ready;
        console.log('Livro carregado e pronto.');
        
        // Gerar locations para cálculo de progresso
        console.log('Gerando locations...');
        await book.locations.generate(LOCATIONS_GENERATE_INTERVAL);
        console.log('Locations geradas:', book.locations.total);
        
        // Aplicar tema e configurações
        applyEpubTheme();
        updateViewerPadding();
        updateThemeColor();
        applyBodyTheme();
        
        // Configurar evento de mudança de localização
        rendition.on('relocated', onRelocated);
        
        // Recuperar e exibir último progresso salvo
        const savedCFI = loadProgress();
        if (savedCFI) {
            try {
                await rendition.display(savedCFI);
                console.log('Restaurado para CFI:', savedCFI);
            } catch (error) {
                console.warn('Falha ao restaurar CFI, iniciando do começo:', error);
                await rendition.display();
            }
        } else {
            await rendition.display();
        }
        
        // Carregar índice de capítulos
        loadTOC();
        
        // Mostrar leitor e esconder tela de upload
        uploadScreen.classList.add('hidden');
        readerContainer.classList.remove('hidden');
        topBar.classList.remove('hidden-bar');
        bottomBar.classList.remove('hidden-bar');
        
        // Sincronizar interface de configurações
        syncSettingsUI();
        
        console.log('Leitor exibido com sucesso.');
        
    } catch (error) {
        console.error('Erro ao abrir EPUB:', error);
        alert('Erro ao abrir o arquivo. Verifique se é um EPUB válido.\nErro: ' + error.message);
        
        // Limpar estado e voltar à tela de upload
        if (rendition) {
            rendition.destroy();
            rendition = null;
        }
        book = null;
        readerContainer.classList.add('hidden');
        uploadScreen.classList.remove('hidden');
    }
}

/**
 * Sincroniza a interface com as configurações atuais
 */
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

// ==============================
// EVENTOS DE LEITURA
// ==============================

/**
 * Chamado quando a localização da leitura muda
 * @param {Object} location - Objeto de localização do EPUB.js
 */
function onRelocated(location) {
    if (!location || !location.start) return;
    
    currentLocationCFI = location.start.cfi;
    currentHref = location.start.href;
    
    // Calcular e exibir progresso percentual
    const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
    const percentRounded = Math.round(percent * 10) / 10;
    
    progressSlider.value = percentRounded;
    progressLabel.textContent = percentRounded + '%';
    
    // Estimativa de página (baseada em 100 páginas por livro)
    const totalPages = 100;
    const currentPage = Math.max(1, Math.round((percentRounded / 100) * totalPages));
    pageInfo.textContent = `Pág. ${currentPage}/${totalPages}`;
    
    // Salvar progresso automaticamente (com debounce)
    clearTimeout(window._saveProgressTimeout);
    window._saveProgressTimeout = setTimeout(() => {
        saveProgress(currentLocationCFI);
    }, AUTO_SAVE_DEBOUNCE);
    
    // Atualizar estado do botão de marcador
    updateBookmarkButtonState();
    
    // Destacar capítulo atual no índice
    highlightCurrentChapter();
}

// ==============================
// ÍNDICE DE CAPÍTULOS (TOC)
// ==============================

/**
 * Carrega e exibe o índice de capítulos
 */
function loadTOC() {
    if (!book || !book.navigation) return;
    
    const toc = book.navigation.toc;
    tocList.innerHTML = '';
    
    if (toc.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Nenhum capítulo encontrado';
        li.style.cursor = 'default';
        li.style.color = '#999';
        tocList.appendChild(li);
        return;
    }
    
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

/**
 * Destaca o capítulo atual na lista de capítulos
 */
function highlightCurrentChapter() {
    if (!currentHref) return;
    
    const items = tocList.querySelectorAll('li');
    items.forEach(li => {
        li.classList.toggle('active', li.dataset.href === currentHref);
    });
}

// ==============================
// CONTROLE DE BARRAS
// ==============================

/**
 * Alterna a visibilidade das barras superior e inferior
 * @param {Event} event - Evento de clique
 */
function toggleBars(event) {
    // Ignorar cliques em elementos interativos
    if (event.target.closest('button') || event.target.closest('input')) return;
    
    const topHidden = topBar.classList.contains('hidden-bar');
    
    if (topHidden) {
        topBar.classList.remove('hidden-bar');
        bottomBar.classList.remove('hidden-bar');
    } else {
        topBar.classList.add('hidden-bar');
        bottomBar.classList.add('hidden-bar');
    }
}

// ==============================
// PAINEL DE CONFIGURAÇÕES
// ==============================

/**
 * Abre o painel de configurações
 */
function openSettings() {
    settingsPanel.classList.remove('hidden');
    switchTab('themes');
}

/**
 * Fecha o painel de configurações
 */
function closeSettings() {
    settingsPanel.classList.add('hidden');
}

/**
 * Alterna entre as abas do painel
 * @param {string} tabId - ID da aba a ser exibida
 */
function switchTab(tabId) {
    // Atualizar botões das abas
    tabButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabId);
    });
    
    // Atualizar conteúdo das abas
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });
    
    // Atualizar listas conforme aba selecionada
    if (tabId === 'bookmarks') renderBookmarks();
    if (tabId === 'chapters') loadTOC();
}

// ==============================
// GERENCIAMENTO DE TEMAS
// ==============================

/**
 * Altera o tema de leitura
 * @param {string} theme - Nome do tema ('clear', 'dark', 'sepia')
 */
function changeTheme(theme) {
    saveSetting('theme', theme);
    
    if (rendition) {
        rendition.themes.select(theme);
    }
    
    updateThemeColor();
    applyBodyTheme();
    
    // Atualizar seleção visual
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === theme);
    });
}

// ==============================
// GERENCIAMENTO DE MARCADORES
// ==============================

/**
 * Alterna a adição/remoção de marcador na posição atual
 */
function toggleBookmark() {
    if (!currentLocationCFI) return;
    
    const existingIndex = bookmarks.findIndex(bm => bm.cfi === currentLocationCFI);
    
    if (existingIndex > -1) {
        // Remover marcador existente
        bookmarks.splice(existingIndex, 1);
        console.log('Marcador removido:', currentLocationCFI);
    } else {
        // Adicionar novo marcador
        const chapterTitle = getCurrentChapterTitle();
        const percent = book.locations.percentageFromCfi(currentLocationCFI) || 0;
        
        bookmarks.push({
            cfi: currentLocationCFI,
            percent: Math.round(percent * 10) / 10,
            chapter: chapterTitle,
            time: new Date().toISOString()
        });
        console.log('Marcador adicionado:', currentLocationCFI);
    }
    
    saveBookmarks();
    updateBookmarkButtonState();
    
    // Atualizar lista de marcadores se visível
    if (document.getElementById('tab-bookmarks').classList.contains('active')) {
        renderBookmarks();
    }
}

/**
 * Adiciona marcador manualmente na posição atual
 */
function addManualBookmark() {
    if (!currentLocationCFI) return;
    
    const existingIndex = bookmarks.findIndex(bm => bm.cfi === currentLocationCFI);
    
    if (existingIndex > -1) {
        // Atualizar timestamp do marcador existente
        bookmarks[existingIndex].time = new Date().toISOString();
    } else {
        // Criar novo marcador
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

/**
 * Atualiza o estado visual do botão de marcador
 */
function updateBookmarkButtonState() {
    if (!currentLocationCFI) return;
    
    const isBookmarked = bookmarks.some(bm => bm.cfi === currentLocationCFI);
    bookmarkToggleBtn.classList.toggle('active', isBookmarked);
}

/**
 * Renderiza a lista de marcadores no painel
 */
function renderBookmarks() {
    bookmarkList.innerHTML = '';
    
    if (bookmarks.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Nenhum marcador salvo';
        li.style.cursor = 'default';
        li.style.color = '#999';
        bookmarkList.appendChild(li);
        return;
    }
    
    // Exibir marcadores em ordem reversa (mais recentes primeiro)
    const reversedBookmarks = [...bookmarks].reverse();
    
    reversedBookmarks.forEach((bookmark, reversedIndex) => {
        const originalIndex = bookmarks.length - 1 - reversedIndex;
        const li = document.createElement('li');
        
        // Informações do marcador
        const info = document.createElement('span');
        const chapterInfo = bookmark.chapter ? `${bookmark.chapter} - ` : '';
        const dateInfo = new Date(bookmark.time).toLocaleDateString('pt-BR');
        info.textContent = `${chapterInfo}${bookmark.percent}% (${dateInfo})`;
        
        info.addEventListener('click', () => {
            rendition.display(bookmark.cfi);
            closeSettings();
        });
        
        // Botão de remover
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Remover marcador';
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            bookmarks.splice(originalIndex, 1);
            saveBookmarks();
            updateBookmarkButtonState();
            renderBookmarks();
        });
        
        li.appendChild(info);
        li.appendChild(deleteBtn);
        bookmarkList.appendChild(li);
    });
}

/**
 * Obtém o título do capítulo atual
 * @returns {string} Título do capítulo
 */
function getCurrentChapterTitle() {
    if (!book || !book.navigation || !currentHref) return '';
    
    const toc = book.navigation.toc;
    const item = toc.find(entry => entry.href === currentHref);
    return item ? item.label : '';
}

// ==============================
// CONTROLE DE PROGRESSO
// ==============================

/**
 * Manipula a interação com o slider de progresso
 * @param {Event} event - Evento de input do slider
 */
function onProgressSliderInput(event) {
    const percent = parseFloat(event.target.value);
    if (!isNaN(percent) && book && book.locations) {
        const cfi = book.locations.cfiFromPercentage(percent / 100);
        if (cfi) {
            rendition.display(cfi);
        }
    }
}

// ==============================
// FECHAR LIVRO
// ==============================

/**
 * Fecha o livro atual e retorna à tela de upload
 */
async function closeBook() {
    console.log('Fechando livro...');
    
    if (rendition) {
        rendition.destroy();
        rendition = null;
    }
    
    book = null;
    viewer.innerHTML = '';
    readerContainer.classList.add('hidden');
    uploadScreen.classList.remove('hidden');
    
    // Limpar referências
    currentLocationCFI = null;
    currentHref = null;
}

// ==============================
// INICIALIZAÇÃO AUTOMÁTICA
// ==============================

/**
 * Tenta carregar o último livro aberto automaticamente
 */
async function autoLoadLastBook() {
    loadSettings();
    loadBookmarks();
    
    try {
        const record = await loadEpubFromDB();
        if (record && record.data) {
            console.log('Restaurando último livro:', record.fileName);
            await openEpub(record.data, record.fileName || 'Livro');
        }
    } catch (error) {
        console.error('Falha ao restaurar último livro:', error);
        // Remover registro possivelmente corrompido
        await deleteEpubFromDB().catch(() => {});
    }
}

// ==============================
// INICIALIZAÇÃO
// ==============================
console.log('Inicializando Leitor EPUB...');
setupEventListeners();
autoLoadLastBook();
