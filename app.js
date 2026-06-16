const dbName = 'EpubNativeDB';
const storeName = 'library';
let db;

// Subi a versão para 4 para garantir que o navegador limpe qualquer cache antigo dos seus testes
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 4); 
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(storeName)) {
                database.createObjectStore(storeName, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
        request.onerror = (e) => reject(e.target.error);
    });
}

function saveBookToDB(bookData) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(bookData).onsuccess = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
    });
}

function getBooksFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function getBookById(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function deleteBookFromDB(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

let currentEpub = null;
let rendition = null;
let activeBookId = null;
let isUiVisible = false;
let locationsGenerated = false;

const state = {
    font: localStorage.getItem('epub_font') || 'Original',
    size: parseInt(localStorage.getItem('epub_size')) || 100,
    lineHeight: parseInt(localStorage.getItem('epub_line')) || 120,
    margin: parseInt(localStorage.getItem('epub_margin')) || 5, // em porcentagem
    wordSpacing: parseInt(localStorage.getItem('epub_word_spacing')) || 0, // em px
    theme: localStorage.getItem('epub_theme') || 'sepia'
};

const dom = {
    libraryView: document.getElementById('library-view'),
    readerView: document.getElementById('reader-view'),
    bookGrid: document.getElementById('book-grid'),
    emptyState: document.getElementById('empty-state'),
    fileInput: document.getElementById('epub-input'),
    btnAddBook: document.getElementById('btn-add-book'),
    loadingOverlay: document.getElementById('loading-overlay'),
    uiLayer: document.getElementById('ui-layer'),
    btnCloseReader: document.getElementById('btn-close-reader'),
    configModal: document.getElementById('config-modal'),
    btnConfig: document.getElementById('btn-config'),
    progressSlider: document.getElementById('progress-slider'),
    pageCount: document.getElementById('page-count'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    fontItems: document.querySelectorAll('.font-item'),
    themeBoxes: document.querySelectorAll('.theme-box'),
    btnSizeUp: document.getElementById('btn-size-up'),
    btnSizeDown: document.getElementById('btn-size-down'),
    sizeDisplay: document.getElementById('size-display'),
    btnLineUp: document.getElementById('btn-line-up'),
    btnLineDown: document.getElementById('btn-line-down'),
    lineDisplay: document.getElementById('line-display'),
    btnMarginUp: document.getElementById('btn-margin-up'),
    btnMarginDown: document.getElementById('btn-margin-down'),
    marginDisplay: document.getElementById('margin-display'),
    btnWordUp: document.getElementById('btn-word-up'),
    btnWordDown: document.getElementById('btn-word-down'),
    wordDisplay: document.getElementById('word-display')
};

document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    renderLibrary();
});

dom.btnAddBook.addEventListener('click', () => dom.fileInput.click());

dom.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    dom.loadingOverlay.classList.remove('hidden');

    try {
        const arrayBuffer = await file.arrayBuffer();
        const tempBook = ePub(arrayBuffer);
        await tempBook.ready;
        
        const metadata = await tempBook.loaded.metadata;
        const title = metadata.title || file.name.replace('.epub', '');
        let coverUrl = '';
        try { coverUrl = await tempBook.coverUrl(); } catch(err) { console.log("Capa não encontrada"); }

        const bookRecord = {
            id: Date.now().toString(),
            title: title,
            cover: coverUrl, 
            blob: arrayBuffer,
            lastCfi: null
        };

        await saveBookToDB(bookRecord);
        await renderLibrary();

    } catch (error) {
        alert("Erro ao importar o livro. Verifique se é um EPUB válido.");
        console.error(error);
    } finally {
        dom.loadingOverlay.classList.add('hidden');
        dom.fileInput.value = ''; 
    }
});

async function renderLibrary() {
    const books = await getBooksFromDB();
    dom.bookGrid.innerHTML = '';
    
    if (books.length === 0) {
        dom.bookGrid.appendChild(dom.emptyState);
        dom.emptyState.classList.remove('hidden');
        return;
    }

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        const coverObj = book.cover ? `<img src="${book.cover}" class="book-cover">` : `<div class="book-cover">${book.title}</div>`;
        
        card.innerHTML = `
            <button class="delete-book-btn" title="Excluir livro">✕</button>
            <div class="card-content">
                ${coverObj}
                <span class="book-title">${book.title}</span>
            </div>
        `;
        
        const deleteBtn = card.querySelector('.delete-book-btn');
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); 
            if (confirm(`Tem certeza que deseja excluir "${book.title}" da sua estante?`)) {
                await deleteBookFromDB(book.id);
                await renderLibrary(); 
            }
        });

        const content = card.querySelector('.card-content');
        content.addEventListener('click', () => openReader(book.id));
        
        dom.bookGrid.appendChild(card);
    });
}

async function openReader(bookId) {
    dom.loadingOverlay.classList.remove('hidden');
    const bookData = await getBookById(bookId);
    if (!bookData) return;

    activeBookId = bookId;
    dom.libraryView.classList.add('hidden');
    dom.readerView.classList.remove('hidden');
    
    if (currentEpub) { currentEpub.destroy(); }
    
    currentEpub = ePub(bookData.blob);
    rendition = currentEpub.renderTo("viewer", {
        width: "100%", height: "100%",
        spread: "none", manager: "continuous", flow: "paginated"
    });

    // Registra os Temas com prioridade máxima (!important)
    rendition.themes.register("light", { "body": { "background": "#ffffff !important", "color": "#000000 !important" }});
    rendition.themes.register("sepia", { "body": { "background": "#fbf6e8 !important", "color": "#2c2b29 !important" }});
    rendition.themes.register("dark", { "body": { "background": "#000000 !important", "color": "#e0e0e0 !important" }});

    // Injeta o CSS do Google Fonts diretamente no iframe do Epub.js
    rendition.hooks.content.register(function(contents) {
        contents.addStylesheet("https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&display=swap");
    });

    applyPreferences();

    const displayOptions = bookData.lastCfi ? { cfi: bookData.lastCfi } : undefined;

    rendition.display(displayOptions).then(() => {
        return currentEpub.locations.generate(1600);
    }).then(locations => {
        locationsGenerated = true;
        dom.progressSlider.max = currentEpub.locations.total;
        updateProgress();
        dom.loadingOverlay.classList.add('hidden');
    });

    rendition.on("relocated", location => {
        getBookById(activeBookId).then(book => {
            book.lastCfi = location.start.cfi;
            saveBookToDB(book);
        });
        if (locationsGenerated) updateProgress();
    });

    // ==========================================
    // NOVA LÓGICA DE NAVEGAÇÃO E CLIQUES
    // ==========================================
    function handleScreenInteraction(e) {
        // Se a interface estiver aberta, um clique na tela APENAS fecha a interface.
        if (isUiVisible) {
            isUiVisible = false;
            dom.uiLayer.classList.add('hidden');
            dom.configModal.classList.add('hidden');
            return;
        }

        const screenWidth = window.innerWidth;
        // Pega a coordenada X do clique (suporta mouse e touch do celular)
        const clientX = e.type.includes('touch') ? e.changedTouches[0].clientX : e.clientX;

        if (clientX === undefined) return;

        // 30% da esquerda (Volta), 30% da direita (Avança), Centro (Menu)
        if (clientX < screenWidth * 0.3) {
            rendition.prev();
        } else if (clientX > screenWidth * 0.7) {
            rendition.next();
        } else {
            isUiVisible = true;
            dom.uiLayer.classList.remove('hidden');
        }
    }

    // Usamos apenas o evento 'click' nativo para evitar disparo duplo em celulares
    rendition.on("click", (e) => {
        handleScreenInteraction(e);
    });

    // Adiciona suporte às setas do teclado dentro do iframe (para testes no PC)
    rendition.on("keyup", (e) => {
        if (e.key === "ArrowLeft") rendition.prev();
        if (e.key === "ArrowRight") rendition.next();
    });
}

// Adiciona suporte às setas do teclado na tela principal
document.addEventListener("keyup", (e) => {
    if (!dom.readerView.classList.contains('hidden') && rendition) {
        if (e.key === "ArrowLeft") rendition.prev();
        if (e.key === "ArrowRight") rendition.next();
    }
});

dom.btnCloseReader.addEventListener('click', () => {
    dom.readerView.classList.add('hidden');
    dom.libraryView.classList.remove('hidden');
    dom.uiLayer.classList.add('hidden');
    dom.configModal.classList.add('hidden');
    isUiVisible = false;
    renderLibrary();
});

function updateProgress() {
    if (!locationsGenerated) return;
    const currentLocation = rendition.currentLocation();
    if (currentLocation && currentLocation.start) {
        const percentage = currentEpub.locations.percentageFromCfi(currentLocation.start.cfi);
        const currentPage = Math.round(percentage * currentEpub.locations.total) || 1;
        dom.progressSlider.value = currentPage;
        dom.pageCount.textContent = `${currentPage} / ${currentEpub.locations.total}`;
    }
}

dom.progressSlider.addEventListener('change', e => {
    if (!locationsGenerated) return;
    const cfi = currentEpub.locations.cfiFromPercentage(e.target.value / currentEpub.locations.total);
    rendition.display(cfi);
});

dom.btnConfig.addEventListener('click', () => dom.configModal.classList.toggle('hidden'));

dom.tabBtns.forEach(btn => {
    btn.addEventListener('click', e => {
        dom.tabBtns.forEach(b => b.classList.remove('active'));
        dom.tabPanes.forEach(p => p.classList.add('hidden', 'active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.remove('hidden');
    });
});

dom.fontItems.forEach(item => {
    item.addEventListener('click', e => {
        dom.fontItems.forEach(f => f.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.font = e.currentTarget.dataset.font;
        saveAndApply();
    });
});

dom.themeBoxes.forEach(box => {
    box.addEventListener('click', e => {
        dom.themeBoxes.forEach(b => { b.textContent = ''; b.classList.remove('active-theme'); });
        e.currentTarget.textContent = '✓';
        e.currentTarget.classList.add('active-theme');
        state.theme = e.currentTarget.dataset.theme;
        saveAndApply();
    });
});

// Controles da UI (Tamanho, Linhas, Margens e Palavras)
dom.btnSizeUp.addEventListener('click', () => { state.size = Math.min(300, state.size + 10); saveAndApply(); });
dom.btnSizeDown.addEventListener('click', () => { state.size = Math.max(50, state.size - 10); saveAndApply(); });

dom.btnLineUp.addEventListener('click', () => { state.lineHeight = Math.min(200, state.lineHeight + 10); saveAndApply(); });
dom.btnLineDown.addEventListener('click', () => { state.lineHeight = Math.max(100, state.lineHeight - 10); saveAndApply(); });

dom.btnMarginUp.addEventListener('click', () => { state.margin = Math.min(25, state.margin + 2); saveAndApply(); });
dom.btnMarginDown.addEventListener('click', () => { state.margin = Math.max(0, state.margin - 2); saveAndApply(); });

dom.btnWordUp.addEventListener('click', () => { state.wordSpacing = Math.min(10, state.wordSpacing + 1); saveAndApply(); });
dom.btnWordDown.addEventListener('click', () => { state.wordSpacing = Math.max(0, state.wordSpacing - 1); saveAndApply(); });

function saveAndApply() {
    localStorage.setItem('epub_font', state.font);
    localStorage.setItem('epub_size', state.size);
    localStorage.setItem('epub_line', state.lineHeight);
    localStorage.setItem('epub_margin', state.margin);
    localStorage.setItem('epub_word_spacing', state.wordSpacing);
    localStorage.setItem('epub_theme', state.theme);
    applyPreferences();
}

function applyPreferences() {
    if (!rendition) return;

    dom.sizeDisplay.textContent = `${state.size}%`;
    dom.lineDisplay.textContent = `${state.lineHeight}%`;
    dom.marginDisplay.textContent = `${state.margin}%`;
    dom.wordDisplay.textContent = `${state.wordSpacing}px`;

    dom.fontItems.forEach(f => f.classList.toggle('active', f.dataset.font === state.font));
    dom.themeBoxes.forEach(t => {
        if(t.dataset.theme === state.theme) { t.textContent = '✓'; t.classList.add('active-theme'); }
        else { t.textContent = ''; t.classList.remove('active-theme'); }
    });

    rendition.themes.select(state.theme);
    
    if (state.theme === 'dark') updateThemeVars('#000000', '#e0e0e0', '#1c1c1e', '#ffffff', '#333333', '#2c2c2e');
    else if (state.theme === 'sepia') updateThemeVars('#fbf6e8', '#2c2b29', '#ffffff', '#333333', '#e0e0e0', '#f5f5f5');
    else updateThemeVars('#ffffff', '#000000', '#f5f5f5', '#000000', '#cccccc', '#e9e9e9');

    rendition.themes.fontSize(`${state.size}%`);
    rendition.themes.override('line-height', `${state.lineHeight}%`);
    rendition.themes.override('padding-left', `${state.margin}%`);
    rendition.themes.override('padding-right', `${state.margin}%`);
    rendition.themes.override('word-spacing', `${state.wordSpacing}px`);
    
    if (state.font === 'Original') {
        rendition.themes.font(''); 
    } else if (state.font === 'Literata' || state.font === 'Georgia') {
        rendition.themes.font(`'${state.font}', serif`); 
    } else {
        rendition.themes.font(`'${state.font}', sans-serif`); 
    }
    
    if (locationsGenerated) {
        currentEpub.locations.generate(1600).then(() => {
            dom.progressSlider.max = currentEpub.locations.total;
            updateProgress();
        });
    }
}

function updateThemeVars(bg, text, uiBg, uiText, border, actionsBg) {
    const root = document.documentElement;
    root.style.setProperty('--bg-color', bg);
    root.style.setProperty('--text-color', text);
    root.style.setProperty('--ui-bg', uiBg);
    root.style.setProperty('--ui-text', uiText);
    root.style.setProperty('--ui-border', border);
    root.style.setProperty('--ui-actions-bg', actionsBg);
}
