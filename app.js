// --- DATA STRUCTURE & STATE ---
let state = {
    almacen: [],
    huerto: {
        parcelas: { "huerto-general": "Huerto Principal" },
        plantaciones: {},
        tareas: {},
        tratamientos: {},
        cosechas: [],
        riego: {},
        fertilizaciones: {},
        plagaAlertas: {}
    },
    olivar: {
        parcelas: { "olivar-general": "Olivar Principal" },
        tareas: {},
        tratamientos: {},
        cosechas: [],
        riego: {},
        fertilizaciones: {},
        plagaAlertas: {}
    },
    croquis: {},
    diario: [],
    currentView: 'hoy',
    currentCultivoTab: 'huerto',
    currentHuertoParcela: 'huerto-general',
    currentOlivarParcela: 'olivar-general',
    currentCroquisParcela: 'huerto-general',
    selectedMockPhoto: null
};

// Mock Photos for the Journal
const MOCK_PHOTOS = {
    plaga: {
        url: "https://images.unsplash.com/photo-1598902108854-10e335adac99?w=400&auto=format&fit=crop&q=60",
        label: "Plaga detectada (pulgón/insectos)"
    },
    olivar: {
        url: "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?w=400&auto=format&fit=crop&q=60",
        label: "Olivos / Terreno"
    },
    cosecha: {
        url: "https://images.unsplash.com/photo-1592417817098-8f3d6eb19675?w=400&auto=format&fit=crop&q=60",
        label: "Recogida de Cosecha"
    },
    riego: {
        url: "https://images.unsplash.com/photo-1563514223727-6f9e49a2a40f?w=400&auto=format&fit=crop&q=60",
        label: "Riego / Goteo"
    }
};

// --- CALENDAR STATE ---
const now = new Date();
let calendarYear = now.getFullYear();
let calendarMonth = now.getMonth(); // 0-indexed
let selectedCalendarDay = null;
let selectedCalendarDateString = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
})();


// Weather state (integrated with Open-Meteo)
let weatherState = {
    temp: 24,
    status: "Despejado",
    wind: 5,
    humidity: 40,
    safeToSpray: true,
    location: "albacete"
};

const WEATHER_COORDINATES = {
    albacete: { lat: 38.9942, lon: -1.8564, name: "Albacete" },
    fuensanta: { lat: 39.2435, lon: -2.0631, name: "Fuensanta (Albacete)" }
};

// Seed initial data if localStorage is empty
function seedInitialData() {
    state.almacen = [];
    state.huerto = {
        parcelas: { "huerto-general": "Huerto Principal" },
        plantaciones: {},
        tareas: {},
        tratamientos: {},
        cosechas: [],
        riego: {},
        fertilizaciones: {},
        plagaAlertas: {}
    };
    state.olivar = {
        parcelas: { "olivar-general": "Olivar Principal" },
        tareas: {},
        tratamientos: {},
        cosechas: [],
        riego: {},
        fertilizaciones: {},
        plagaAlertas: {}
    };
    state.diario = [];
    state.croquis = {};

    const defaultParcels = ["huerto-general", "olivar-general"];
    defaultParcels.forEach(p => {
        state.croquis[p] = [];
        const isOlivar = p.startsWith("olivar");
        for (let i = 1; i <= 16; i++) {
            state.croquis[p].push({ id: i, label: isOlivar ? `Olivo ${i}` : `Zona ${i}`, state: "normal" });
        }
    });
    state.weatherLocation = 'albacete';
    state.croquisDimensions = {
        "huerto-general": { rows: 4, cols: 4 },
        "olivar-general": { rows: 4, cols: 4 }
    };
}

// --- INDEXEDDB HELPER FOR BACKUP & FILE HANDLE ---
const DB_NAME = 'cuaderno_campo_indexeddb';
const STORE_NAME = 'app_data';

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveToIndexedDB(key, val) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(val, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Error al guardar en IndexedDB:", err);
    }
}

async function getFromIndexedDB(key) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Error al leer de IndexedDB:", err);
        return null;
    }
}

async function deleteFromIndexedDB(key) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Error al eliminar de IndexedDB:", err);
    }
}

// --- FILE SYSTEM ACCESS API SYNC LOGIC ---
let linkedFileHandle = null;
const isFileSystemAccessSupported = typeof window.showOpenFilePicker === 'function';

async function verifyFilePermission(handle, withPrompt = false) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') {
        return true;
    }
    if (withPrompt) {
        try {
            if ((await handle.requestPermission(opts)) === 'granted') {
                return true;
            }
        } catch (e) {
            console.error("Permiso denegado por el navegador/usuario:", e);
        }
    }
    return false;
}

async function readLinkedFile() {
    if (!linkedFileHandle) return null;
    try {
        const file = await linkedFileHandle.getFile();
        const content = await file.text();
        if (!content.trim()) return null;
        return JSON.parse(content);
    } catch (err) {
        console.error("Error al leer el archivo vinculado:", err);
        return null;
    }
}

async function writeLinkedFile() {
    if (!linkedFileHandle) return;
    try {
        const writable = await linkedFileHandle.createWritable();
        await writable.write(JSON.stringify(state, null, 2));
        await writable.close();
        console.log("Datos auto-guardados en el archivo vinculado de Drive.");
    } catch (err) {
        console.error("Error al auto-guardar en el archivo vinculado:", err);
    }
}

async function linkExistingFile() {
    if (!isFileSystemAccessSupported) {
        showToast("Tu navegador no soporta el acceso directo a archivos.", "error");
        return;
    }
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{
                description: 'Archivo de datos JSON',
                accept: {
                    'application/json': ['.json']
                }
            }],
            multiple: false
        });
        
        // Read contents to verify
        const file = await handle.getFile();
        const content = await file.text();
        let parsed = null;
        if (content.trim()) {
            try {
                parsed = JSON.parse(content);
            } catch (e) {
                showToast("El archivo seleccionado no es un JSON válido.", "error");
                return;
            }
        }

        if (parsed && (parsed.almacen || parsed.huerto || parsed.olivar)) {
            linkedFileHandle = handle;
            await saveToIndexedDB('file_handle', handle);
            state = parsed;
            saveState(true);
            showToast("Archivo de Google Drive vinculado correctamente.", "success");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            if (confirm("El archivo está vacío o no es compatible. ¿Quieres guardar tus datos actuales de la app en él para vincularlo?")) {
                linkedFileHandle = handle;
                await saveToIndexedDB('file_handle', handle);
                await writeLinkedFile();
                showToast("Archivo inicializado con tus datos actuales.", "success");
                updateSyncUI();
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            showToast("Error al vincular el archivo", "error");
        }
    }
}

async function createNewSyncFile() {
    if (!isFileSystemAccessSupported) {
        showToast("Tu navegador no soporta el acceso directo a archivos.", "error");
        return;
    }
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: 'cuaderno_data.json',
            types: [{
                description: 'Archivo de datos JSON',
                accept: {
                    'application/json': ['.json']
                }
            }]
        });
        
        linkedFileHandle = handle;
        await saveToIndexedDB('file_handle', handle);
        await writeLinkedFile();
        showToast("Archivo de sincronización creado y vinculado.", "success");
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            showToast("Error al crear el archivo", "error");
        }
    }
}

async function forceSaveToFile() {
    if (!linkedFileHandle) return;
    const hasPermission = await verifyFilePermission(linkedFileHandle, true);
    if (hasPermission) {
        await writeLinkedFile();
        showToast("Datos locales subidos al archivo con éxito", "success");
    } else {
        showToast("Requiere permiso de escritura para guardar.", "error");
    }
}

async function forceLoadFromFile() {
    if (!linkedFileHandle) return;
    const hasPermission = await verifyFilePermission(linkedFileHandle, true);
    if (hasPermission) {
        const fileData = await readLinkedFile();
        if (fileData) {
            state = fileData;
            saveState(false);
            updateUI();
            showToast("Datos bajados del archivo con éxito", "success");
        } else {
            showToast("El archivo está vacío.", "error");
        }
    } else {
        showToast("Requiere permiso de lectura para cargar.", "error");
    }
}

async function unlinkFile() {
    if (confirm("¿Estás seguro de que quieres desvincular el archivo de Google Drive? Los datos seguirán guardados en tu navegador.")) {
        linkedFileHandle = null;
        await deleteFromIndexedDB('file_handle');
        showToast("Archivo desvinculado.", "info");
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    }
}

async function reconnectFile() {
    const savedHandle = await getFromIndexedDB('file_handle');
    if (savedHandle) {
        const granted = await verifyFilePermission(savedHandle, true);
        if (granted) {
            linkedFileHandle = savedHandle;
            const fileData = await readLinkedFile();
            if (fileData) {
                state = fileData;
                saveState(false);
                updateUI();
                showToast("Archivo reconectado y sincronizado", "success");
            } else {
                await writeLinkedFile();
                showToast("Archivo reconectado con éxito", "success");
            }
            updateSyncUI();
        } else {
            showToast("Permiso denegado.", "error");
        }
    }
}

// --- STORAGE PERSISTENCE API ---
async function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        if (granted) {
            showToast("Almacenamiento persistente activado", "success");
        } else {
            showToast("El navegador denegó la persistencia.", "info");
        }
        updateSyncUI();
    }
}

// --- SYNC STATE AND DYNAMIC UI ---
async function initSyncAndIndexedDB() {
    // Restore from IndexedDB backup if localStorage is empty
    const localData = localStorage.getItem('cuaderno_campo_data');
    if (!localData) {
        const backup = await getFromIndexedDB('state_backup');
        if (backup) {
            state = backup;
            localStorage.setItem('cuaderno_campo_data', JSON.stringify(state));
            updateUI();
            showToast("Datos recuperados de la copia interna (IndexedDB)", "info");
        }
    } else {
        saveToIndexedDB('state_backup', state);
    }

    // Verify linked file
    if (isFileSystemAccessSupported) {
        const savedHandle = await getFromIndexedDB('file_handle');
        if (savedHandle) {
            const hasPermission = await verifyFilePermission(savedHandle, false);
            if (hasPermission) {
                linkedFileHandle = savedHandle;
                const fileData = await readLinkedFile();
                if (fileData) {
                    state = fileData;
                    localStorage.setItem('cuaderno_campo_data', JSON.stringify(state));
                    saveToIndexedDB('state_backup', state);
                    updateUI();
                    console.log("Datos sincronizados con archivo de Drive.");
                }
            } else {
                console.log("Archivo vinculado detectado pero requiere autorización.");
            }
        }
    }

    // Cloud Sync Load
    try {
        setCloudStatus('syncing');
        const response = await fetch(CLOUD_SYNC_URL);
        if (response.ok) {
            const cloudData = await response.json();
            if (cloudData && (cloudData.almacen || cloudData.huerto || cloudData.olivar)) {
                const localLastUpdated = state.lastUpdated || 0;
                const cloudLastUpdated = cloudData.lastUpdated || 0;
                
                if (cloudLastUpdated > localLastUpdated) {
                    state = cloudData;
                    localStorage.setItem('cuaderno_campo_data', JSON.stringify(state));
                    saveToIndexedDB('state_backup', state);
                    updateUI();
                    showToast("Datos sincronizados con la nube (KVdb).", "success");
                    setCloudStatus('saved');
                } else if (localLastUpdated > cloudLastUpdated) {
                    // Local is newer, upload it to cloud
                    await uploadToCloud();
                } else {
                    // Equal or no changes
                    setCloudStatus('saved');
                }
            } else {
                // Cloud empty or invalid, upload local
                await uploadToCloud();
            }
        } else {
            console.error("Error al leer de la nube:", response.status);
            setCloudStatus('offline');
        }
    } catch (err) {
        console.error("Error al conectar con la nube para sincronizar:", err);
        setCloudStatus('offline');
    }

    updateSyncUI();
}

async function updateSyncUI() {
    const syncContainer = document.getElementById('sync-container');
    const persistenceContainer = document.getElementById('persistence-container');
    if (!syncContainer) return;

    // 1. Persistence
    if (navigator.storage && navigator.storage.persist) {
        const persisted = await navigator.storage.persisted();
        if (persisted) {
            persistenceContainer.innerHTML = `
                <div class="persistence-status" style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--success); background: rgba(143, 167, 107, 0.05); padding: 8px 12px; border-radius: 8px; border: 1px dashed rgba(143, 167, 107, 0.25);">
                    <i class="ph-fill ph-check-circle" style="font-size: 1.1rem;"></i>
                    <span><strong>Almacenamiento protegido:</strong> El navegador no borrará tus datos para liberar espacio.</span>
                </div>
            `;
        } else {
            persistenceContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="info-box" style="margin: 0; padding: 10px; font-size: 0.75rem; border-color: rgba(230, 194, 98, 0.15); background: rgba(230, 194, 98, 0.04);">
                        <i class="ph ph-warning" style="color: var(--warning);"></i>
                        <span>El navegador podría borrar tus datos locales bajo mucha presión de espacio en disco.</span>
                    </div>
                    <button class="btn btn-secondary" onclick="requestPersistence()" style="padding: 8px; font-size: 0.75rem; border-radius: 8px;">
                        <i class="ph ph-shield-check"></i> Proteger Datos en el Navegador
                    </button>
                </div>
            `;
        }
    } else {
        persistenceContainer.innerHTML = '';
    }

    // 2. Build Cloud + Drive sync HTML
    let html = `
        <!-- Tarjeta de Sincronización en la Nube -->
        <div class="sync-status-card connected" style="display: flex; flex-direction: column; gap: 8px; background: rgba(56, 142, 60, 0.06); border: 1px dashed rgba(56, 142, 60, 0.18); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                    <i class="ph-fill ph-cloud-check" style="font-size: 1.15rem; color: var(--success);"></i>
                    Sincronización en la Nube
                </span>
                <span style="background: rgba(56, 142, 60, 0.12); color: var(--success); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 20px; text-transform: uppercase;">Activa</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.45;">
                ✨ Tus datos se guardan solos en tu base de datos cloud privada. Sincronización instantánea entre tu móvil y tu ordenador.
            </div>
        </div>
    `;

    if (!isFileSystemAccessSupported) {
        // Mobile view: inform that direct Google Drive file link is desktop-only
        html += `
            <div class="info-box" style="margin: 0; background: rgba(255, 255, 255, 0.02); border-color: var(--border-color); color: var(--text-secondary); padding: 10px; font-size: 0.75rem; display: flex; align-items: flex-start; gap: 8px;">
                <i class="ph ph-desktop" style="color: var(--text-muted); font-size: 1.1rem; margin-top: 2px;"></i>
                <div style="line-height: 1.35;">
                    <strong>Google Drive (Escritorio):</strong> La vinculación directa a archivos del disco está limitada a ordenadores. En móvil, la base de datos en la nube de arriba se encarga de todo.
                </div>
            </div>
        `;
    } else {
        // Desktop view: show normal file picker options
        const savedHandle = await getFromIndexedDB('file_handle');
        if (!savedHandle) {
            html += `
                <div style="display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px;">
                    <div class="info-box" style="margin: 0; background: rgba(255, 255, 255, 0.03); border-color: var(--border-color); padding: 10px;">
                        <i class="ph ph-folder" style="color: var(--text-muted); font-size: 1.1rem; margin-top: 1px;"></i>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.35;">
                            <strong>Google Drive local (Ordenador):</strong> Si estás en tu Mac, puedes vincular un archivo local para guardar una copia directa en tu carpeta de Drive.
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" onclick="linkExistingFile()" style="flex: 1; padding: 10px; font-size: 0.8rem; border-radius: 8px;">
                            <i class="ph ph-link"></i> Vincular Archivo
                        </button>
                        <button class="btn" onclick="createNewSyncFile()" style="flex: 1; padding: 10px; font-size: 0.8rem; border-radius: 8px;">
                            <i class="ph ph-file-plus"></i> Crear Nuevo
                        </button>
                    </div>
                </div>
            `;
        } else {
            const fileName = savedHandle.name;
            if (linkedFileHandle) {
                html += `
                    <div style="display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px;">
                        <div class="sync-status-card connected" style="display: flex; flex-direction: column; gap: 8px; background: rgba(143, 167, 107, 0.08); border: 1px solid rgba(143, 167, 107, 0.2); padding: 12px; border-radius: var(--radius-sm);">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                                    <i class="ph-fill ph-check-circle" style="color: var(--success); font-size: 1.1rem;"></i> Google Drive Local
                                </span>
                                <span class="status-badge" style="background: rgba(143,167,107,0.15); color: var(--success); font-size: 0.7rem; font-weight: 700; padding: 4px 8px; border-radius: 20px; text-transform: uppercase;">Conectado</span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); border-top: 1px solid rgba(143,167,107,0.15); padding-top: 6px; margin-top: 2px; line-height: 1.4;">
                                Archivo: <strong>${fileName}</strong>
                            </div>
                        </div>
                        <details class="advanced-sync-details" style="margin-top: 4px;">
                            <summary style="cursor: pointer; font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; display: flex; align-items: center; gap: 4px; outline: none; list-style: none;">
                                <i class="ph ph-gear" style="font-size: 0.85rem;"></i> Acciones avanzadas (manuales)
                            </summary>
                            <div style="display: flex; gap: 8px; margin-top: 8px;">
                                <button class="btn btn-secondary" onclick="forceSaveToFile()" style="flex: 1; padding: 8px; font-size: 0.75rem; border-radius: 8px;" title="Sobrescribir archivo de Drive con los datos locales">
                                    <i class="ph ph-cloud-arrow-up"></i> Forzar Subida
                                </button>
                                <button class="btn btn-secondary" onclick="forceLoadFromFile()" style="flex: 1; padding: 8px; font-size: 0.75rem; border-radius: 8px;" title="Sobrescribir local con los datos del archivo de Drive">
                                    <i class="ph ph-cloud-arrow-down"></i> Forzar Bajada
                                </button>
                                <button class="btn btn-danger" onclick="unlinkFile()" style="width: auto; padding: 8px 12px; border-radius: 8px;" title="Desvincular archivo">
                                    <i class="ph ph-link-break"></i>
                                </button>
                            </div>
                        </details>
                    </div>
                `;
            } else {
                html += `
                    <div style="display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px;">
                        <div class="sync-status-card disconnected" style="display: flex; align-items: center; justify-content: space-between; background: rgba(230, 194, 98, 0.08); border: 1px solid rgba(230, 194, 98, 0.2); padding: 12px; border-radius: var(--radius-sm);">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                                    <i class="ph-fill ph-warning" style="color: var(--warning); font-size: 1.1rem;"></i> Google Drive Local Pausado
                                </span>
                                <span style="font-size: 0.75rem; color: var(--text-muted); padding-left: 24px;">Archivo: <strong>${fileName}</strong></span>
                            </div>
                            <span class="status-badge" style="background: rgba(230,194,98,0.15); color: var(--warning); font-size: 0.7rem; font-weight: 700; padding: 4px 8px; border-radius: 20px; text-transform: uppercase;">Sin Permiso</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <button class="btn" onclick="reconnectFile()" style="padding: 10px; font-size: 0.8rem; border-radius: 8px; width: 100%;">
                                <i class="ph ph-key"></i> Autorizar y Sincronizar
                            </button>
                            <button class="btn btn-danger" onclick="unlinkFile()" style="padding: 8px; font-size: 0.75rem; border-radius: 8px; width: 100%;">
                                <i class="ph ph-link-break"></i> Cancelar Vinculación
                            </button>
                        </div>
                    </div>
                `;
            }
        }
    }
    syncContainer.innerHTML = html;
}

// --- CLOUD DB SYNC LOGIC (KVdb.io) ---
const CLOUD_SYNC_URL = 'https://kvdb.io/6tH9CVtrrWAsdbrcNb4Gd1/cuaderno_campo_data';

function setCloudStatus(status) {
    const el = document.getElementById('cloud-sync-status');
    if (!el) return;
    
    el.className = 'cloud-sync-status ' + status;
    
    let iconHTML = '';
    let titleText = '';
    if (status === 'syncing') {
        iconHTML = '<i class="ph ph-cloud-arrow-up"></i>';
        titleText = 'Sincronizando con la nube...';
    } else if (status === 'saved') {
        iconHTML = '<i class="ph-fill ph-cloud-check"></i>';
        titleText = 'Todos los cambios guardados en la nube';
    } else if (status === 'offline') {
        iconHTML = '<i class="ph ph-cloud-warning"></i>';
        titleText = 'Sin conexión. Se guardará al recuperar red.';
    } else {
        iconHTML = '<i class="ph ph-cloud-slash"></i>';
        titleText = 'Sincronización no configurada';
    }
    
    el.innerHTML = iconHTML;
    el.title = titleText;
}

async function uploadToCloud() {
    try {
        setCloudStatus('syncing');
        const response = await fetch(CLOUD_SYNC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state)
        });
        if (response.ok) {
            setCloudStatus('saved');
            console.log("Datos auto-guardados en la nube.");
        } else {
            console.error("Error al auto-guardar en la nube:", response.status);
            setCloudStatus('offline');
        }
    } catch (err) {
        console.error("Error de red al auto-guardar en la nube:", err);
        setCloudStatus('offline');
    }
}

// Save State
function saveState(writeToDisk = true, writeToCloud = true) {
    // Add update timestamp
    state.lastUpdated = Date.now();

    localStorage.setItem('cuaderno_campo_data', JSON.stringify(state));
    saveToIndexedDB('state_backup', state);
    if (writeToDisk && linkedFileHandle) {
        writeLinkedFile();
    }
    if (writeToCloud) {
        uploadToCloud();
    }
    updateUI();
    updateSyncUI();
}

// ... Load State with migration/backward compatibility ...
function loadState() {
    const data = localStorage.getItem('cuaderno_campo_data');
    if (data) {
        try {
            state = JSON.parse(data);
            
            // Safety checks for new properties or structures
            if (!state.currentView) state.currentView = 'almacen';
            if (!state.currentCultivoTab) state.currentCultivoTab = 'huerto';
            
            if (!state.huerto) state.huerto = {};
            if (!state.huerto.parcelas || Object.keys(state.huerto.parcelas).length === 0) {
                state.huerto.parcelas = { "huerto-general": "Huerto Principal" };
            }
            if (!state.huerto.plantaciones) state.huerto.plantaciones = {};
            if (!state.huerto.tareas) state.huerto.tareas = {};
            if (!state.huerto.tratamientos) state.huerto.tratamientos = {};
            if (!state.huerto.cosechas) state.huerto.cosechas = [];
            
            if (!state.olivar) state.olivar = {};
            if (!state.olivar.parcelas || Object.keys(state.olivar.parcelas).length === 0) {
                state.olivar.parcelas = { "olivar-general": "Olivar Principal" };
            }
            if (!state.olivar.tareas) state.olivar.tareas = {};
            if (!state.olivar.tratamientos) state.olivar.tratamientos = {};
            if (!state.olivar.cosechas) state.olivar.cosechas = [];
            
            if (!state.currentHuertoParcela || !state.huerto.parcelas[state.currentHuertoParcela]) {
                state.currentHuertoParcela = Object.keys(state.huerto.parcelas)[0];
            }
            if (!state.currentOlivarParcela || !state.olivar.parcelas[state.currentOlivarParcela]) {
                state.currentOlivarParcela = Object.keys(state.olivar.parcelas)[0];
            }
            if (!state.currentCroquisParcela) {
                state.currentCroquisParcela = state.currentHuertoParcela;
            }
            
            // --- Migration: new fields for existing data ---
            if (!state.croquis) state.croquis = {};
            if (!state.huerto.riego) state.huerto.riego = {};
            if (!state.huerto.fertilizaciones) state.huerto.fertilizaciones = {};
            if (!state.huerto.plagaAlertas) state.huerto.plagaAlertas = {};
            if (!state.olivar.riego) state.olivar.riego = {};
            if (!state.olivar.fertilizaciones) state.olivar.fertilizaciones = {};
            if (!state.olivar.plagaAlertas) state.olivar.plagaAlertas = {};


            if (!state.diario) state.diario = [];
            if (!state.weatherLocation) state.weatherLocation = 'albacete';
            if (!state.croquisDimensions) state.croquisDimensions = {};
        } catch (e) {
            console.error("Error al parsear datos de localstorage, reseteando...", e);
            seedInitialData();
        }
    } else {
        seedInitialData();
        saveState();
    }
}

// --- VIEW NAVIGATION ---
function switchView(viewName) {
    state.currentView = viewName;
    
    // Si el menú está abierto, cerrarlo
    const overlay = document.getElementById('main-menu-overlay');
    if (overlay && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
    }
    
    // Toggle active classes on bottom navigation
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`nav-${viewName}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Toggle view sections
    document.querySelectorAll('.view-content').forEach(section => {
        section.classList.add('hidden');
    });
    const activeSection = document.getElementById(`view-${viewName}`);
    if (activeSection) activeSection.classList.remove('hidden');

    // Scroll to top of section
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Custom view initializers
    if (viewName === 'hoy') renderHoy();
    else if (viewName === 'almacen') renderAlmacen();
    else if (viewName === 'campo') renderCampo();
    else if (viewName === 'croquis') renderCroquis();
    else if (viewName === 'diario') renderDiario();
    else if (viewName === 'datos') renderDatos();
    else if (viewName === 'calendario') renderCalendar();
}

// --- WEATHER INTEGRATION (Open-Meteo) ---
function renderWeather() {
    const tempEl = document.getElementById('weather-temp');
    if (!tempEl) return;
    
    tempEl.innerText = `${weatherState.temp}°C`;
    document.getElementById('weather-status').innerText = weatherState.status;
    document.getElementById('weather-wind').innerText = `Viento: ${weatherState.wind} km/h`;
    document.getElementById('weather-humidity').innerText = `Humedad: ${weatherState.humidity}%`;
    
    // Sincronizar el selector en la interfaz
    const select = document.getElementById('weather-location-select');
    if (select) {
        select.value = weatherState.location || 'albacete';
    }
    
    const adviceEl = document.getElementById('weather-advice');
    const iconEl = document.getElementById('weather-icon');

    if (weatherState.safeToSpray) {
        adviceEl.innerHTML = `<i class="ph-fill ph-check-circle"></i> Condiciones óptimas para sulfatar`;
        adviceEl.className = "weather-advice";
        adviceEl.style.color = "var(--success)";
        iconEl.className = "ph-fill ph-sun weather-icon-lg";
        iconEl.style.color = "var(--secondary)";
    } else {
        let reason = "clima adverso";
        if (weatherState.temp >= 30) {
            reason = `temp. excesiva (${weatherState.temp}°C)`;
        } else if (weatherState.wind >= 15) {
            reason = `viento fuerte (${weatherState.wind} km/h)`;
        } else {
            reason = weatherState.status.toLowerCase();
        }
        adviceEl.innerHTML = `<i class="ph-fill ph-warning-circle"></i> Evitar sulfatar: ${reason}`;
        adviceEl.className = "weather-advice";
        adviceEl.style.color = "var(--danger)";
        iconEl.className = "ph-fill ph-cloud-rain weather-icon-lg";
        iconEl.style.color = "var(--text-muted)";
    }
}

async function fetchWeather() {
    const loc = weatherState.location || 'albacete';
    const coords = WEATHER_COORDINATES[loc];
    if (!coords) return;
    
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`);
        if (!res.ok) throw new Error("API response error");
        
        const data = await res.json();
        const current = data.current;
        
        const wmoCodes = {
            0: "Despejado",
            1: "Casi despejado",
            2: "Parcialmente nublado",
            3: "Nublado",
            45: "Niebla",
            48: "Niebla de escarcha",
            51: "Llovizna ligera",
            53: "Llovizna moderada",
            55: "Llovizna densa",
            61: "Lluvia débil",
            63: "Lluvia moderada",
            65: "Lluvia fuerte",
            71: "Nevada ligera",
            73: "Nevada moderada",
            75: "Nevada fuerte",
            80: "Chubascos débiles",
            81: "Chubascos moderados",
            82: "Chubascos fuertes",
            95: "Tormenta"
        };
        
        const code = current.weather_code;
        weatherState.temp = Math.round(current.temperature_2m);
        weatherState.status = wmoCodes[code] || "Variable";
        weatherState.wind = Math.round(current.wind_speed_10m);
        weatherState.humidity = current.relative_humidity_2m;
        
        // Recomendación segura: Viento < 15 km/h, sin precipitación activa (WMO < 50) y temp < 30°C
        weatherState.safeToSpray = (code < 50 && weatherState.wind < 15 && weatherState.temp < 30);
        
        renderWeather();
    } catch (err) {
        console.warn("Fallo al conectar con Open-Meteo. Usando estimación simulada.", err);
        // Fallback simulation based on selected location
        const randomTemp = loc === 'albacete' ? 22 : 20;
        weatherState.temp = Math.floor(Math.random() * 8) + randomTemp;
        weatherState.status = Math.random() > 0.5 ? "Despejado y templado" : "Parcialmente nublado";
        weatherState.wind = Math.floor(Math.random() * 12) + 4;
        weatherState.humidity = Math.floor(Math.random() * 20) + 40;
        weatherState.safeToSpray = (weatherState.wind < 15 && weatherState.temp < 30);
        renderWeather();
    }
}

function changeWeatherLocation() {
    const select = document.getElementById('weather-location-select');
    if (!select) return;
    weatherState.location = select.value;
    state.weatherLocation = select.value;
    saveState(true, true);
    fetchWeather();
}

function syncData() {
    showToast("Sincronizando el tiempo real...", "info");
    fetchWeather().then(() => {
        showToast("El tiempo local se ha actualizado con éxito", "success");
    });
}

// --- ALMACÉN LOGIC ---
function renderAlmacen() {
    const listContainer = document.getElementById('almacen-list');
    const searchVal = document.getElementById('almacen-search').value.toLowerCase();
    listContainer.innerHTML = '';

    const filtered = state.almacen.filter(p => p.name.toLowerCase().includes(searchVal) || p.type.toLowerCase().includes(searchVal));

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-package"></i>
                <span>No se encontraron productos en el almacén.</span>
            </div>
        `;
        return;
    }

    filtered.forEach(p => {
        const isLow = p.stock <= 2.0;
        const stockStyle = isLow ? "color: var(--danger); font-weight: 850;" : "";
        const badgeClass = `badge-${p.type}`;
        
        const card = document.createElement('div');
        card.className = "item-card";
        if (isLow) card.style.borderColor = "var(--danger)";
        
        card.innerHTML = `
            <div class="item-header">
                <span class="item-title">${escapeHTML(p.name)}</span>
                <span class="item-badge ${badgeClass}">${p.type}</span>
            </div>
            <div class="item-info-line">Función: <span>${escapeHTML(p.function)}</span></div>
            ${p.composition ? `<div class="item-info-line">Composición: <span style="color: var(--primary); font-size:0.78rem;">${escapeHTML(p.composition)}</span></div>` : ''}
            <div class="item-info-line">Dosis Fab: <span>${escapeHTML(p.dose)}</span></div>
            <div class="item-info-line">Precio: <span>${p.price.toFixed(2)} €/ud</span></div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
                <div class="stock-control">
                    <button class="stock-btn" onclick="adjustStock(${p.id}, -1)">-</button>
                    <span class="stock-value" style="${stockStyle}">${p.stock.toFixed(1)} ud</span>
                    <button class="stock-btn" onclick="adjustStock(${p.id}, 1)">+</button>
                </div>
                <button class="btn btn-danger" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="deleteProduct(${p.id})">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

function adjustStock(productId, amount) {
    const p = state.almacen.find(prod => prod.id === productId);
    if (p) {
        p.stock = Math.max(0, p.stock + amount);
        saveState();
        renderAlmacen();
        showToast(`Stock de ${p.name} modificado`, "success");
    }
}

function addProduct(e) {
    e.preventDefault();
    const name = document.getElementById('prod-name').value;
    const type = document.getElementById('prod-type').value;
    const stock = parseFloat(document.getElementById('prod-stock').value) || 0;
    const price = parseFloat(document.getElementById('prod-price').value) || 0;
    const dose = document.getElementById('prod-dose').value;
    const func = document.getElementById('prod-function').value;
    const composition = document.getElementById('prod-composition').value.trim();

    const newProd = {
        id: Date.now(),
        name,
        type,
        stock,
        price,
        dose,
        function: func,
        composition: composition || ''
    };

    state.almacen.push(newProd);
    saveState();
    closeModal('modal-add-product');
    document.getElementById('modal-add-product').querySelector('form').reset();
    renderAlmacen();
    showToast(`${name} añadido al almacén`, "success");
}

function deleteProduct(productId) {
    const p = state.almacen.find(prod => prod.id === productId);
    if (!p) return;
    if (confirm(`¿Seguro que deseas eliminar ${p.name} del almacén?`)) {
        state.almacen = state.almacen.filter(prod => prod.id !== productId);
        saveState();
        renderAlmacen();
        showToast("Producto eliminado del almacén", "info");
    }
}

// --- CAMPO GENERAL & PARCELAS ---
function toggleCultivoTab(tab) {
    state.currentCultivoTab = tab;
    
    const hBtn = document.getElementById('tab-huerto-btn');
    const oBtn = document.getElementById('tab-olivar-btn');
    const sBtn = document.getElementById('tab-stats-btn');
    
    const hView = document.getElementById('subview-huerto');
    const oView = document.getElementById('subview-olivar');
    const sView = document.getElementById('subview-stats');

    if (hBtn) hBtn.classList.remove('active');
    if (oBtn) oBtn.classList.remove('active');
    if (sBtn) sBtn.classList.remove('active');
    
    if (hView) hView.classList.add('hidden');
    if (oView) oView.classList.add('hidden');
    if (sView) sView.classList.add('hidden');

    if (tab === 'huerto') {
        if (hBtn) hBtn.classList.add('active');
        if (hView) hView.classList.remove('hidden');
    } else if (tab === 'olivar') {
        if (oBtn) oBtn.classList.add('active');
        if (oView) oView.classList.remove('hidden');
    } else if (tab === 'stats') {
        if (sBtn) sBtn.classList.add('active');
        if (sView) sView.classList.remove('hidden');
    }
    
    saveState(false, false);
    renderCampo();
}

function renderCampo() {
    populateParcelDropdowns();
    if (state.currentCultivoTab === 'huerto') {
        renderHuerto();
    } else if (state.currentCultivoTab === 'olivar') {
        renderOlivar();
    } else {
        renderStats();
    }
}

// renderStats is defined below with enhanced year comparison logic
// (see the new implementation near end of file)

function populateParcelDropdowns() {
    // Huerto dropdown
    const hSelect = document.getElementById('huerto-parcela-select');
    hSelect.innerHTML = '';
    Object.keys(state.huerto.parcelas).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = state.huerto.parcelas[k];
        opt.selected = (state.currentHuertoParcela === k);
        hSelect.appendChild(opt);
    });

    // Olivar dropdown
    const oSelect = document.getElementById('olivar-parcela-select');
    oSelect.innerHTML = '';
    Object.keys(state.olivar.parcelas).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = state.olivar.parcelas[k];
        opt.selected = (state.currentOlivarParcela === k);
        oSelect.appendChild(opt);
    });
}

// --- DYNAMIC PARCEL MANAGEMENT ---
function openAddParcelModal(type) {
    document.getElementById('parcel-modal-type').value = type;
    document.getElementById('parcel-modal-title').innerText = type === 'huerto' ? 'Nueva Parcela de Huerto' : 'Nueva Finca de Olivar';
    document.getElementById('parcel-modal-name').value = '';
    openModal('modal-add-parcel');
}

function addParcel(e) {
    e.preventDefault();
    const type = document.getElementById('parcel-modal-type').value;
    const name = document.getElementById('parcel-modal-name').value.trim();
    if (!name) return;

    const id = `${type}-${Date.now()}`;
    state[type].parcelas[id] = name;

    // Initialize lists
    state[type].tareas[id] = [];
    state[type].tratamientos[id] = [];
    if (type === 'huerto') {
        if (!state.huerto.plantaciones) state.huerto.plantaciones = {};
        state.huerto.plantaciones[id] = [];
    }

    // Set as current active
    if (type === 'huerto') {
        state.currentHuertoParcela = id;
    } else {
        state.currentOlivarParcela = id;
    }

    saveState();
    closeModal('modal-add-parcel');
    renderCampo();
    showToast(`Creada: ${name}`, "success");
}

// --- PLANTINGS REGISTRY (Huerto) ---
function openAddPlantingModal() {
    document.getElementById('plant-name').value = '';
    document.getElementById('plant-qty').value = '';
    document.getElementById('plant-cost').value = '';
    document.getElementById('plant-date').value = getTodayString();
    openModal('modal-add-planting');
}

function addPlanting(e) {
    e.preventDefault();
    const pId = state.currentHuertoParcela;
    const name = document.getElementById('plant-name').value.trim();
    const qty = parseInt(document.getElementById('plant-qty').value) || 0;
    const cost = parseFloat(document.getElementById('plant-cost').value) || 0;
    const dateVal = document.getElementById('plant-date').value;

    if (!name || qty <= 0 || cost < 0) return;

    if (!state.huerto.plantaciones) state.huerto.plantaciones = {};
    if (!state.huerto.plantaciones[pId]) state.huerto.plantaciones[pId] = [];

    const newPlanting = {
        id: Date.now(),
        name: name,
        qty: qty,
        cost: cost,
        date: dateVal,
        status: "active"
    };

    state.huerto.plantaciones[pId].push(newPlanting);

    // Auto log to journal
    const totalCost = qty * cost;
    const noteText = `Nueva plantación en ${state.huerto.parcelas[pId]}: ${qty} plantas de ${name} (Coste: ${cost.toFixed(2)}€/ud, Total: ${totalCost.toFixed(2)}€).`;
    state.diario.push({
        id: Date.now() + 1,
        text: noteText,
        date: `${dateVal} ${getNowTimeString()}`,
        photo: MOCK_PHOTOS.riego.url
    });

    saveState();
    closeModal('modal-add-planting');
    renderHuerto();
    showToast("Plantación guardada", "success");
}

function deletePlanting(plantingId, pId) {
    if (confirm("¿Estás seguro de que quieres eliminar esta plantación?")) {
        state.huerto.plantaciones[pId] = state.huerto.plantaciones[pId].filter(p => p.id !== plantingId);
        saveState();
        renderHuerto();
        showToast("Plantación eliminada", "info");
    }
}

function renderPlantings(pId) {
    const listEl = document.getElementById('huerto-plantings-list');
    listEl.innerHTML = '';

    if (!state.huerto.plantaciones) state.huerto.plantaciones = {};
    const plantings = state.huerto.plantaciones[pId] || [];

    if (plantings.length === 0) {
        listEl.innerHTML = `<div class="empty-state" style="padding: 10px;"><span style="font-size:0.8rem;">Ningún cultivo registrado en esta parcela.</span></div>`;
        return;
    }

    plantings.forEach(p => {
        const totalCost = p.qty * p.cost;
        const card = document.createElement('div');
        card.className = "item-card";
        card.innerHTML = `
            <div class="item-header">
                <span class="item-title">${escapeHTML(p.name)}</span>
                <span class="item-info-line" style="font-weight:700;">${p.date}</span>
            </div>
            <div class="item-info-line">Cantidad: <span>${p.qty} plantas</span></div>
            <div class="item-info-line">Precio unitario: <span>${p.cost.toFixed(2)} €</span></div>
            <div class="item-info-line" style="font-weight: 700; color: var(--text-primary); margin-top: 2px;">
                Coste total: <span style="color: var(--primary-light);">${totalCost.toFixed(2)} €</span>
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                <button class="btn btn-danger" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="deletePlanting(${p.id}, '${pId}')">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `;
        listEl.appendChild(card);
    });
}

// --- HUERTO SUB-LOGIC ---
function changeHuertoParcela() {
    state.currentHuertoParcela = document.getElementById('huerto-parcela-select').value;
    saveState();
    renderHuerto();
}

function renderHuerto() {
    const pId = state.currentHuertoParcela;
    
    // Ensure lists exist for this parcel key
    if (!state.huerto.tareas[pId]) state.huerto.tareas[pId] = [];
    if (!state.huerto.tratamientos[pId]) state.huerto.tratamientos[pId] = [];
    if (!state.huerto.plantaciones) state.huerto.plantaciones = {};
    if (!state.huerto.plantaciones[pId]) state.huerto.plantaciones[pId] = [];
    if (!state.huerto.riego) state.huerto.riego = {};
    if (!state.huerto.fertilizaciones) state.huerto.fertilizaciones = {};
    if (!state.huerto.plagaAlertas) state.huerto.plagaAlertas = {};

    renderTasks('huerto', pId);
    renderPlantings(pId);
    renderTreatments('huerto', pId);
    checkSafetyPeriod('huerto', pId);
    renderHarvestCounters();
    renderRiego('huerto', pId);
    renderFertilizaciones('huerto', pId);
    renderPlagaAlertas('huerto', pId);
}

// --- OLIVAR SUB-LOGIC ---
function changeOlivarParcela() {
    state.currentOlivarParcela = document.getElementById('olivar-parcela-select').value;
    saveState();
    renderOlivar();
}

function renderOlivar() {
    const pId = state.currentOlivarParcela;

    // Ensure lists exist for this parcel key
    if (!state.olivar.tareas[pId]) state.olivar.tareas[pId] = [];
    if (!state.olivar.tratamientos[pId]) state.olivar.tratamientos[pId] = [];
    if (!state.olivar.riego) state.olivar.riego = {};
    if (!state.olivar.fertilizaciones) state.olivar.fertilizaciones = {};
    if (!state.olivar.plagaAlertas) state.olivar.plagaAlertas = {};

    renderTasks('olivar', pId);
    renderTreatments('olivar', pId);
    checkSafetyPeriod('olivar', pId);
    renderOlivarHarvestHistory();
    renderRiego('olivar', pId);
    renderFertilizaciones('olivar', pId);
    renderPlagaAlertas('olivar', pId);
}

// --- SHARED TASKS ENGINE ---
function renderTasks(type, parcelId) {
    const listEl = document.getElementById(`${type}-task-list`);
    listEl.innerHTML = '';

    const tasks = state[type].tareas[parcelId] || [];

    if (tasks.length === 0) {
        listEl.innerHTML = `<div class="empty-state" style="padding: 10px;"><span style="font-size:0.8rem;">Sin tareas pendientes.</span></div>`;
        return;
    }

    tasks.forEach(t => {
        const card = document.createElement('div');
        card.className = "item-card";
        card.style.padding = "8px 12px";
        card.style.flexDirection = "row";
        card.style.justifyContent = "space-between";
        card.style.alignItems = "center";
        
        const checkIcon = t.done ? "ph-fill ph-check-square" : "ph ph-square";
        const textStyle = t.done ? "text-decoration: line-through; color: var(--text-muted);" : "font-weight: 500;";
        
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1;" onclick="toggleTask(${t.id}, '${type}', '${parcelId}')">
                <i class="${checkIcon}" style="font-size: 1.3rem; color: ${t.done ? 'var(--primary)' : 'var(--text-secondary)'};"></i>
                <span style="${textStyle}">${escapeHTML(t.text)}</span>
            </div>
            <button class="close-sheet" style="font-size: 1.1rem; color: var(--text-muted); cursor: pointer;" onclick="deleteTask(${t.id}, '${type}', '${parcelId}')">
                <i class="ph ph-trash"></i>
            </button>
        `;
        listEl.appendChild(card);
    });
}

function addTask(e, type) {
    e.preventDefault();
    const inputEl = document.getElementById(`${type}-task-input`);
    const text = inputEl.value.trim();
    if (!text) return;

    const parcelId = (type === 'huerto') ? state.currentHuertoParcela : state.currentOlivarParcela;
    if (!state[type].tareas[parcelId]) state[type].tareas[parcelId] = [];

    const newTask = {
        id: Date.now(),
        text: text,
        done: false
    };

    state[type].tareas[parcelId].push(newTask);
    inputEl.value = '';
    saveState();
    renderTasks(type, parcelId);
    showToast("Tarea añadida", "success");
}

function toggleTask(taskId, type, parcelId) {
    const list = state[type].tareas[parcelId] || [];
    const t = list.find(task => task.id === taskId);
    if (t) {
        t.done = !t.done;
        saveState();
        renderTasks(type, parcelId);
    }
}

function deleteTask(taskId, type, parcelId) {
    const list = state[type].tareas[parcelId] || [];
    state[type].tareas[parcelId] = list.filter(task => task.id !== taskId);
    saveState();
    renderTasks(type, parcelId);
    showToast("Tarea eliminada", "info");
}

// --- SHARED TREATMENTS ENGINE ---
function renderTreatments(type, parcelId) {
    const listEl = document.getElementById(`${type}-treatments-list`);
    listEl.innerHTML = '';

    const list = state[type].tratamientos[parcelId] || [];

    if (list.length === 0) {
        listEl.innerHTML = `<div class="empty-state" style="padding: 10px;"><span style="font-size:0.8rem;">Ningún tratamiento aplicado.</span></div>`;
        return;
    }

    list.slice().reverse().forEach(t => {
        const todayStr = getTodayString();
        const isActive = todayStr <= t.expiresAt && t.safetyDays > 0;
        
        let safetyText = "";
        if (t.safetyDays > 0) {
            if (isActive) {
                const diffDays = getDaysDiff(todayStr, t.expiresAt);
                safetyText = `<span style="color: var(--danger); font-weight: 700;">⚠️ Plazo activo: Quedan ${diffDays} días</span>`;
            } else {
                safetyText = `<span style="color: var(--success); font-weight: 700;">✅ Plazo expirado (Consumo seguro)</span>`;
            }
        } else {
            safetyText = `<span style="color: var(--text-muted);">Sin plazo de seguridad</span>`;
        }

        const card = document.createElement('div');
        card.className = "item-card";
        card.innerHTML = `
            <div class="item-header">
                <span class="item-title">${escapeHTML(t.productName)}</span>
                <span class="item-info-line" style="font-weight:700;">${t.date}</span>
            </div>
            <div class="item-info-line">Dosis real: <span>${escapeHTML(t.dose)}</span></div>
            <div class="item-info-line">Descontado: <span>${t.amount} uds</span></div>
            <div class="item-info-line" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--border-color);">
                ${safetyText}
            </div>
        `;
        listEl.appendChild(card);
    });
}

function openApplyTreatmentModal(type) {
    // Populate products select with options
    const select = document.getElementById('treatment-product');
    select.innerHTML = '';
    
    const availableProducts = state.almacen.filter(p => p.stock > 0);

    if (availableProducts.length === 0) {
        showToast("No hay productos con stock en el almacén para aplicar", "error");
        return;
    }

    availableProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Stock: ${p.stock.toFixed(1)})`;
        select.appendChild(opt);
    });

    // Hide terrain selector since we are in Huerto/Olivar tab
    const typeGroup = document.getElementById('treatment-type-group');
    if (typeGroup) typeGroup.style.display = 'none';

    document.getElementById('treatment-type').value = type;
    document.getElementById('treatment-date').value = getTodayString();
    document.getElementById('treatment-amount').value = 1;
    document.getElementById('treatment-safety-days').value = 0;
    
    openModal('modal-apply-treatment');
}

function openCalendarScheduleModal() {
    const select = document.getElementById('treatment-product');
    if (!select) return;
    select.innerHTML = '';
    
    const availableProducts = state.almacen.filter(p => p.stock > 0);

    if (availableProducts.length === 0) {
        showToast("No hay productos con stock en el almacén para aplicar", "error");
        return;
    }

    availableProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Stock: ${p.stock.toFixed(1)})`;
        select.appendChild(opt);
    });

    // Show terrain selector since we are in Calendar tab
    const typeGroup = document.getElementById('treatment-type-group');
    if (typeGroup) typeGroup.style.display = 'block';

    const typeSelect = document.getElementById('treatment-type-select');
    if (typeSelect) {
        typeSelect.value = 'huerto';
        document.getElementById('treatment-type').value = 'huerto';
    }

    document.getElementById('treatment-date').value = selectedCalendarDateString;
    document.getElementById('treatment-amount').value = 1;
    document.getElementById('treatment-safety-days').value = 0;
    
    openModal('modal-apply-treatment');
}

function applyTreatment(e) {
    e.preventDefault();
    const type = document.getElementById('treatment-type').value;
    const parcelId = (type === 'huerto') ? state.currentHuertoParcela : state.currentOlivarParcela;
    const productId = parseInt(document.getElementById('treatment-product').value);
    const dose = document.getElementById('treatment-dose').value;
    const amount = parseFloat(document.getElementById('treatment-amount').value) || 0;
    const safetyDays = parseInt(document.getElementById('treatment-safety-days').value) || 0;
    const dateVal = document.getElementById('treatment-date').value;

    const prod = state.almacen.find(p => p.id === productId);
    if (!prod) return;

    if (prod.stock < amount) {
        showToast("Error: No hay suficiente stock en almacén", "error");
        return;
    }

    // Deduct stock
    prod.stock -= amount;

    // Calc expiration date of safety period
    const expDate = addDays(dateVal, safetyDays);

    const newTreatment = {
        id: Date.now(),
        productName: prod.name,
        date: dateVal,
        dose: dose,
        amount: amount,
        safetyDays: safetyDays,
        expiresAt: expDate
    };

    if (!state[type].tratamientos[parcelId]) state[type].tratamientos[parcelId] = [];
    state[type].tratamientos[parcelId].push(newTreatment);

    // Also auto-add a diary log note!
    const noteText = `Tratamiento aplicado en ${state[type].parcelas[parcelId]}: ${prod.name} (Dosis: ${dose}, Plazo de seguridad: ${safetyDays} días).`;
    state.diario.push({
        id: Date.now() + 1,
        text: noteText,
        date: `${dateVal} ${getNowTimeString()}`,
        photo: MOCK_PHOTOS.olivar.url
    });

    saveState();
    closeModal('modal-apply-treatment');
    renderCampo();
    if (state.currentView === 'calendario') renderCalendar();
    showToast("Tratamiento registrado y stock descontado", "success");
}

function checkSafetyPeriod(type, parcelId) {
    const list = state[type].tratamientos[parcelId] || [];
    const alertEl = document.getElementById(`${type}-safety-alert`);
    const todayStr = getTodayString();
    
    let maxDaysLeft = -1;
    let worstTreatment = null;

    list.forEach(t => {
        if (t.safetyDays > 0 && todayStr <= t.expiresAt) {
            const daysLeft = getDaysDiff(todayStr, t.expiresAt);
            if (daysLeft > maxDaysLeft) {
                maxDaysLeft = daysLeft;
                worstTreatment = t;
            }
        }
    });

    if (maxDaysLeft >= 0 && worstTreatment) {
        alertEl.className = "safety-alert active";
        alertEl.innerHTML = `
            <i class="ph-fill ph-warning"></i>
            <div>
                <strong>¡EN PLAZO DE SEGURIDAD!</strong><br>
                <span>Producto: ${escapeHTML(worstTreatment.productName)}</span>
            </div>
            <span class="safety-countdown">${maxDaysLeft}d</span>
        `;
    } else {
        alertEl.className = "safety-alert safe";
        alertEl.innerHTML = `
            <i class="ph-fill ph-check-circle"></i>
            <span>Seguro. No hay tratamientos activos que bloqueen la recolección.</span>
        `;
    }
}

// --- HARVEST CONTROLLER FOR HUERTO ---
// --- DYNAMIC HARVEST COUNTERS ---
function renderHarvestCounters() {
    const container = document.getElementById('huerto-harvest-container');
    if (!container) return;

    const pId = state.currentHuertoParcela;
    
    // Inicializar estructuras de datos si no existen
    if (!state.huerto.customCosechas) state.huerto.customCosechas = {};
    if (!state.huerto.customCosechas[pId]) state.huerto.customCosechas[pId] = [];
    if (!state.tempHarvestCounts) state.tempHarvestCounts = {};

    // Obtener nombres de plantaciones activas en esta parcela
    const plantings = (state.huerto.plantaciones[pId] || []).map(p => p.name);
    const customItems = state.huerto.customCosechas[pId];
    
    // Combinar sin duplicados
    const allProducts = Array.from(new Set([...plantings, ...customItems]));

    let html = `
        <span class="card-title"><i class="ph ph-tomato"></i> Contador de Cosecha</span>
        <p class="card-subtitle">Registra la cosecha diaria acumulando unidades de cada cultivo.</p>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 12px;">
    `;

    if (allProducts.length === 0) {
        html += `
            <div style="text-align: center; padding: 15px; color: var(--text-muted); font-size: 0.8rem; background: rgba(255,255,255,0.01); border: 1px dashed var(--border-color); border-radius: 8px;">
                No hay cultivos en esta parcela. Escribe una variedad abajo para añadir su contador.
            </div>
        `;
    } else {
        allProducts.forEach(prod => {
            const currentCount = state.tempHarvestCounts[prod] || 0;
            const isCustom = customItems.includes(prod);
            
            html += `
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">${escapeHTML(prod)}</span>
                        ${isCustom ? `
                            <button class="close-sheet" style="font-size: 0.9rem; color: var(--text-muted); cursor: pointer; background: none; border: none; padding: 0; line-height: 1;" onclick="removeCustomHarvestProduct('${escapeHTML(prod)}')">
                                <i class="ph ph-x-circle" style="font-size: 1.1rem;"></i>
                            </button>
                        ` : ''}
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div style="display: flex; gap: 4px; align-items: center;">
                            <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.75rem; border-radius: 8px; width: auto;" onclick="adjustProductCounter('${escapeHTML(prod)}', -1)">-1</button>
                            <div style="min-width: 32px; text-align: center; font-size: 1.1rem; font-weight: 700; color: var(--primary-light);" id="counter-val-${prod}">${currentCount}</div>
                            <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.75rem; border-radius: 8px; width: auto;" onclick="adjustProductCounter('${escapeHTML(prod)}', 1)">+1</button>
                            <button class="btn btn-secondary" style="padding: 6px 8px; font-size: 0.75rem; border-radius: 8px; width: auto;" onclick="adjustProductCounter('${escapeHTML(prod)}', 5)">+5</button>
                        </div>
                        <button class="btn" style="padding: 6px 10px; font-size: 0.75rem; border-radius: 8px; width: auto; font-weight: 700;" onclick="saveProductHarvest('${escapeHTML(prod)}')">
                            <i class="ph ph-floppy-disk"></i> Registrar
                        </button>
                    </div>
                </div>
            `;
        });
    }

    html += `
        </div>
        
        <!-- Formulario para añadir cultivos/variedades al vuelo -->
        <div style="margin-top: 15px; border-top: 1px dashed var(--border-color); padding-top: 12px;">
            <label class="input-label" style="font-size: 0.7rem; margin-bottom: 4px;">Añadir otra variedad/cosecha (ej: Boniato)</label>
            <div style="display: flex; gap: 8px; align-items: center;">
                <input type="text" id="new-harvest-product-input" class="form-input" style="padding: 8px; font-size: 0.75rem; border-radius: 8px; margin: 0; flex: 1;" placeholder="Nombre de la planta...">
                <button class="btn btn-secondary" style="padding: 8px 12px; font-size: 0.75rem; border-radius: 8px; width: auto; font-weight: 700;" onclick="addCustomHarvestProduct()">
                    <i class="ph ph-plus"></i> Añadir
                </button>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function adjustProductCounter(prod, val) {
    if (!state.tempHarvestCounts) state.tempHarvestCounts = {};
    const current = state.tempHarvestCounts[prod] || 0;
    state.tempHarvestCounts[prod] = Math.max(0, current + val);
    
    // Update local display immediately
    const el = document.getElementById(`counter-val-${prod}`);
    if (el) el.innerText = state.tempHarvestCounts[prod];
    
    // Save state (soft)
    saveState(true, false);
}

function addCustomHarvestProduct() {
    const input = document.getElementById('new-harvest-product-input');
    if (!input) return;
    
    const val = input.value.trim();
    if (!val) return;
    
    const pId = state.currentHuertoParcela;
    if (!state.huerto.customCosechas) state.huerto.customCosechas = {};
    if (!state.huerto.customCosechas[pId]) state.huerto.customCosechas[pId] = [];
    
    if (!state.huerto.customCosechas[pId].includes(val)) {
        state.huerto.customCosechas[pId].push(val);
        if (!state.tempHarvestCounts) state.tempHarvestCounts = {};
        state.tempHarvestCounts[val] = 0;
        
        saveState();
        renderHarvestCounters();
        showToast(`Variedad '${val}' añadida a cosechas`, "success");
    } else {
        showToast("Este cultivo ya está en la lista", "warning");
    }
}

function removeCustomHarvestProduct(prod) {
    const pId = state.currentHuertoParcela;
    if (state.huerto.customCosechas && state.huerto.customCosechas[pId]) {
        state.huerto.customCosechas[pId] = state.huerto.customCosechas[pId].filter(x => x !== prod);
    }
    if (state.tempHarvestCounts) {
        delete state.tempHarvestCounts[prod];
    }
    saveState();
    renderHarvestCounters();
    showToast("Variedad eliminada de la lista", "info");
}

function saveProductHarvest(prod) {
    const count = state.tempHarvestCounts?.[prod] || 0;
    if (count === 0) {
        showToast("Introduce una cantidad mayor que 0", "error");
        return;
    }
    
    const pId = state.currentHuertoParcela;
    const dateStr = getTodayString();
    
    const newHarvest = {
        id: Date.now(),
        product: prod,
        count: count,
        date: dateStr,
        parcela: pId
    };
    
    if (!state.huerto.cosechas) state.huerto.cosechas = [];
    state.huerto.cosechas.push(newHarvest);
    
    // Auto log to journal
    state.diario.push({
        id: Date.now() + 1,
        text: `Cosechado en ${state.huerto.parcelas[pId]}: ${count} uds de ${prod}.`,
        date: `${dateStr} ${getNowTimeString()}`,
        photo: MOCK_PHOTOS.cosecha.url
    });
    
    // Reset counter
    state.tempHarvestCounts[prod] = 0;
    
    saveState();
    renderHarvestCounters();
    showToast("Cosecha registrada en el diario", "success");
}

// --- OLIVE HARVEST (Yield calculator) ---
// Add real-time calculation in UI when typing
document.getElementById('harvest-olive-kg').addEventListener('input', updateOliveOilEstimation);
document.getElementById('harvest-olive-yield').addEventListener('input', updateOliveOilEstimation);

function updateOliveOilEstimation() {
    const kg = parseFloat(document.getElementById('harvest-olive-kg').value) || 0;
    const yieldVal = parseFloat(document.getElementById('harvest-olive-yield').value) || 0;
    const resultBox = document.getElementById('olive-oil-result-box');
    const resultVal = document.getElementById('olive-oil-val');

    if (kg > 0 && yieldVal > 0) {
        const oil = (kg * (yieldVal / 100)).toFixed(1);
        resultVal.innerText = oil;
        resultBox.style.display = "flex";
    } else {
        resultBox.style.display = "none";
    }
}

function saveOliveHarvest(e) {
    e.preventDefault();
    const kg = parseFloat(document.getElementById('harvest-olive-kg').value);
    const yieldVal = parseFloat(document.getElementById('harvest-olive-yield').value);
    const parcelId = state.currentOlivarParcela;
    const dateStr = getTodayString();
    
    const oil = parseFloat((kg * (yieldVal / 100)).toFixed(2));

    const newHarvest = {
        id: Date.now(),
        date: dateStr,
        kg: kg,
        yield: yieldVal,
        oil: oil,
        parcela: parcelId
    };

    state.olivar.cosechas.push(newHarvest);

    // Log to journal
    state.diario.push({
        id: Date.now() + 1,
        text: `Registrada cosecha de aceituna en ${state.olivar.parcelas[parcelId]}: ${kg} Kg con un ${yieldVal}% de rendimiento (${oil} Kg de aceite).`,
        date: `${dateStr} ${getNowTimeString()}`,
        photo: MOCK_PHOTOS.cosecha.url
    });

    // Clean inputs
    document.getElementById('harvest-olive-kg').value = '';
    document.getElementById('harvest-olive-yield').value = '';
    document.getElementById('olive-oil-result-box').style.display = 'none';

    saveState();
    renderOlivar();
    showToast("Cosecha de aceituna registrada", "success");
}

function renderOlivarHarvestHistory() {
    const listEl = document.getElementById('olivar-harvest-list');
    listEl.innerHTML = '';

    const list = state.olivar.cosechas.filter(c => c.parcela === state.currentOlivarParcela);

    if (list.length === 0) {
        listEl.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted); text-align: center; display: block; padding: 10px;">No hay cosechas registradas en esta finca.</span>`;
        return;
    }

    list.slice().reverse().forEach(c => {
        const item = document.createElement('div');
        item.className = "item-card";
        item.style.padding = "8px 12px";
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color: var(--secondary);">${c.kg.toLocaleString()} Kg aceituna</strong>
                <span style="font-size:0.75rem; color:var(--text-muted);">${c.date}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color: var(--text-secondary); margin-top:2px;">
                <span>Rendimiento: <strong>${c.yield}%</strong></span>
                <span>Aceite: <strong style="color:var(--text-primary);">${c.oil.toLocaleString()} Kg</strong></span>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// --- CROQUIS INTERACTIVO ---
// --- CROQUIS INTERACTIVO ---
function renderCroquis() {
    // Populate select
    const select = document.getElementById('croquis-parcela-select');
    if (!select) return;

    // --- FIX: Read the CURRENT select value BEFORE rebuilding the options ---
    // If the select already has a value (user just changed it), preserve it.
    // Otherwise fall back to the saved state.
    const userSelectedValue = select.value || state.currentCroquisParcela;

    select.innerHTML = '';

    // Join parcels from Huerto and Olivar
    const huertoKeys = Object.keys(state.huerto.parcelas);
    const olivarKeys = Object.keys(state.olivar.parcelas);

    // Collect all valid keys to validate the selection
    const allKeys = [...huertoKeys, ...olivarKeys];

    // Determine which parcel to show: prefer the user's live selection, then saved state
    const targetParcel = allKeys.includes(userSelectedValue)
        ? userSelectedValue
        : (allKeys.includes(state.currentCroquisParcela) ? state.currentCroquisParcela : allKeys[0]);

    huertoKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `Huerto: ${state.huerto.parcelas[k]}`;
        opt.selected = (targetParcel === k);
        select.appendChild(opt);
    });

    olivarKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `Olivar: ${state.olivar.parcelas[k]}`;
        opt.selected = (targetParcel === k);
        select.appendChild(opt);
    });

    // Draw Grid
    const parcelId = targetParcel;
    if (!parcelId) return;
    
    state.currentCroquisParcela = parcelId;
    
    // Load or initialize croquis dimensions
    if (!state.croquisDimensions) state.croquisDimensions = {};
    if (!state.croquisDimensions[parcelId]) {
        state.croquisDimensions[parcelId] = { rows: 4, cols: 4 };
    }
    const dims = state.croquisDimensions[parcelId];

    // Set values in inputs
    const rowsInput = document.getElementById('croquis-rows-input');
    const colsInput = document.getElementById('croquis-cols-input');
    if (rowsInput) rowsInput.value = dims.rows;
    if (colsInput) colsInput.value = dims.cols;

    // Ensure grid cells match the configuration rows * cols
    const targetCellCount = dims.rows * dims.cols;
    if (!state.croquis[parcelId]) {
        state.croquis[parcelId] = [];
    }
    
    const isOlivar = parcelId.startsWith("olivar");
    const currentCells = state.croquis[parcelId];
    
    // Safe adjustment preserving existing states
    if (currentCells.length !== targetCellCount) {
        const newCells = [];
        for (let i = 1; i <= targetCellCount; i++) {
            const existing = currentCells[i - 1];
            if (existing) {
                newCells.push({
                    id: i,
                    label: isOlivar ? `Olivo ${i}` : `Zona ${i}`,
                    state: existing.state
                });
            } else {
                newCells.push({
                    id: i,
                    label: isOlivar ? `Olivo ${i}` : `Zona ${i}`,
                    state: "normal"
                });
            }
        }
        state.croquis[parcelId] = newCells;
    }

    const gridEl = document.getElementById('croquis-grid');
    if (!gridEl) return;
    gridEl.innerHTML = '';
    
    // Apply dynamic column template
    gridEl.style.gridTemplateColumns = `repeat(${dims.cols}, 1fr)`;

    state.croquis[parcelId].forEach(cell => {
        const cellEl = document.createElement('div');
        cellEl.className = `croquis-cell ${cell.state}`;
        
        let iconClass = "ph-fill ph-plant";
        if (parcelId.startsWith("olivar")) {
            iconClass = "ph-fill ph-tree";
        }
        if (cell.state === "plaga") {
            iconClass = "ph-fill ph-bug";
        } else if (cell.state === "pending") {
            iconClass = "ph-fill ph-warning-octagon";
        } else if (cell.state === "treated") {
            iconClass = "ph-fill ph-drop-half-bottom";
        }

        cellEl.innerHTML = `
            <i class="${iconClass}"></i>
            <span>${cell.label}</span>
        `;
        
        cellEl.onclick = () => toggleCellState(parcelId, cell.id);
        gridEl.appendChild(cellEl);
    });
}

function adjustCroquisGridSize() {
    const parcelId = state.currentCroquisParcela;
    if (!parcelId) return;

    const rowsInput = document.getElementById('croquis-rows-input');
    const colsInput = document.getElementById('croquis-cols-input');
    if (!rowsInput || !colsInput) return;

    const rows = parseInt(rowsInput.value) || 4;
    const cols = parseInt(colsInput.value) || 4;

    if (rows < 1 || cols < 1) {
        showToast("Las filas y columnas deben ser mínimo 1", "error");
        return;
    }

    if (rows > 25 || cols > 25) {
        showToast("Máximo 25 filas o columnas para un correcto rendimiento", "error");
        return;
    }

    if (!state.croquisDimensions) state.croquisDimensions = {};
    state.croquisDimensions[parcelId] = { rows, cols };

    saveState();
    renderCroquis();
    showToast(`Cuadrícula ajustada a ${rows}x${cols}`, "success");
}

function toggleCellState(parcelId, cellId) {
    const cell = state.croquis[parcelId].find(c => c.id === cellId);
    if (cell) {
        const states = ["normal", "treated", "pending", "plaga"];
        const nextIdx = (states.indexOf(cell.state) + 1) % states.length;
        cell.state = states[nextIdx];
        saveState();
        renderCroquis();
    }
}

// --- CALCULADORA DE DOSIS ---
function setCalculatorPreset(liters) {
    document.getElementById('calc-tank-size').value = liters;
    calculateDosage();
}

function calculateDosage() {
    const size = parseFloat(document.getElementById('calc-tank-size').value) || 0;
    const dose = parseFloat(document.getElementById('calc-dose-val').value) || 0;
    const unit = document.getElementById('calc-dose-unit').value;
    const resultEl = document.getElementById('calc-result');

    if (size <= 0 || dose <= 0) {
        resultEl.innerText = "0.00";
        return;
    }

    let result = 0;
    let outputUnit = "ml";

    if (unit.startsWith("g")) {
        outputUnit = "g";
    }

    if (unit.endsWith("100L")) {
        result = (dose / 100) * size;
    } else {
        result = dose * size;
    }

    resultEl.innerHTML = `${result.toFixed(2)} <span style="font-size: 1.2rem; font-weight: 700; color: var(--text-secondary);">${outputUnit}</span>`;
}

// --- DIARIO / OBSERVACIONES LOGIC ---
let photoCycleIndex = 0;
const photosKeys = Object.keys(MOCK_PHOTOS);

function triggerPhotoMock() {
    const photoKey = photosKeys[photoCycleIndex];
    state.selectedMockPhoto = MOCK_PHOTOS[photoKey].url;
    
    // UI update
    const previewContainer = document.getElementById('photo-preview-container');
    const previewImg = document.getElementById('photo-preview-img');
    const textEl = document.getElementById('photo-upload-text');

    previewImg.src = state.selectedMockPhoto;
    previewContainer.classList.remove('hidden');
    textEl.innerHTML = `<i class="ph ph-arrow-counter-clockwise"></i> Foto: ${MOCK_PHOTOS[photoKey].label}`;
    
    // Cycle to next one for subsequent taps
    photoCycleIndex = (photoCycleIndex + 1) % photosKeys.length;
    showToast("Imagen simulada cargada", "info");
}

function renderDiario() {
    const listEl = document.getElementById('journal-list');
    listEl.innerHTML = '';

    if (state.diario.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-book-open"></i>
                <span>No hay anotaciones en el diario todavía.</span>
            </div>
        `;
        return;
    }

    state.diario.slice().reverse().forEach(entry => {
        const card = document.createElement('div');
        card.className = "journal-entry";
        
        let photoMarkup = "";
        if (entry.photo) {
            photoMarkup = `
                <div class="journal-photo-placeholder" style="height: 160px;">
                    <img src="${entry.photo}" alt="Foto de diario">
                </div>
            `;
        }

        card.innerHTML = `
            <div class="journal-header">
                <span>Diario de Campo</span>
                <span>${entry.date}</span>
            </div>
            <p class="journal-text">${escapeHTML(entry.text)}</p>
            ${photoMarkup}
            <button class="delete-entry" onclick="deleteJournalEntry(${entry.id})" title="Eliminar nota">
                <i class="ph ph-trash"></i>
            </button>
        `;
        listEl.appendChild(card);
    });
}

function saveJournalEntry(e) {
    e.preventDefault();
    const textEl = document.getElementById('journal-text-input');
    const text = textEl.value.trim();
    if (!text) return;

    const dateStr = getTodayString() + " " + getNowTimeString();
    
    const newEntry = {
        id: Date.now(),
        text: text,
        date: dateStr,
        photo: state.selectedMockPhoto // Can be null if they didn't tap mock photo
    };

    state.diario.push(newEntry);
    
    // Reset inputs
    textEl.value = '';
    state.selectedMockPhoto = null;
    document.getElementById('photo-preview-container').classList.add('hidden');
    document.getElementById('photo-upload-text').innerText = "Simular foto de observación";

    saveState();
    renderDiario();
    showToast("Observación guardada en el diario", "success");
}

function deleteJournalEntry(id) {
    if (confirm("¿Estás seguro de que quieres eliminar esta anotación del diario?")) {
        state.diario = state.diario.filter(e => e.id !== id);
        saveState();
        renderDiario();
        showToast("Entrada eliminada", "info");
    }
}

// renderEconomia is defined below with fertilization costs and cost-per-unit
// (see the new implementation near end of file)

// --- TOAST NOTIFICATIONS ---
let toastTimeout;
function showToast(text, type = "info") {
    const toast = document.getElementById('toast');
    const toastText = document.getElementById('toast-text');
    
    toastText.innerText = text;
    toast.className = `toast show ${type}`;

    let icon = "ph-fill ph-info";
    if (type === "success") icon = "ph-fill ph-check-circle";
    if (type === "error") icon = "ph-fill ph-warning-octagon";
    toast.querySelector('i').className = icon;

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// --- MODAL UTILS ---
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// --- DATA EXPORT & IMPORT (Backup) ---
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cuaderno_campo_${getTodayString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("Archivo de copia de seguridad descargado", "success");
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const imported = JSON.parse(evt.target.result);
            // Basic structures check
            if (imported.almacen && imported.huerto && imported.olivar) {
                state = imported;
                saveState();
                showToast("Datos restaurados correctamente", "success");
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showToast("Archivo JSON no compatible", "error");
            }
        } catch (err) {
            showToast("Error al leer el archivo JSON", "error");
        }
    };
    reader.readAsText(file);
}

async function resetAppData() {
    if (confirm("🚨 ¿ATENCIÓN! Estás a punto de borrar todos tus datos y reiniciar el cuaderno. ¿Quieres proceder?")) {
        localStorage.removeItem('cuaderno_campo_data');
        await deleteFromIndexedDB('state_backup');
        try {
            await fetch(CLOUD_SYNC_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: '{}'
            });
        } catch (e) {
            console.error("Error al limpiar los datos en la nube:", e);
        }
        showToast("Reiniciando datos...", "info");
        setTimeout(() => {
            window.location.reload();
        }, 800);
    }
}

// --- UTILITY DATE FUNCTIONS ---
function getTodayString() {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getNowTimeString() {
    const t = new Date();
    const h = String(t.getHours()).padStart(2, '0');
    const m = String(t.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getDaysDiff(startStr, endStr) {
    const s = new Date(startStr);
    const e = new Date(endStr);
    const diffTime = e - s;
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function updateUI() {
    if (state.currentView === 'hoy') renderHoy();
    else if (state.currentView === 'almacen') renderAlmacen();
    else if (state.currentView === 'campo') renderCampo();
    else if (state.currentView === 'croquis') renderCroquis();
    else if (state.currentView === 'diario') renderDiario();
    else if (state.currentView === 'datos') renderDatos();
    else if (state.currentView === 'calendario') renderCalendar();
}

// --- CALENDARIO DE TRATAMIENTOS ---
function getAllTreatments() {
    const all = [];
    // Huerto treatments
    Object.entries(state.huerto.tratamientos || {}).forEach(([parcelId, list]) => {
        (list || []).forEach(t => {
            all.push({ ...t, source: 'huerto', parcelName: state.huerto.parcelas[parcelId] || parcelId });
        });
    });
    // Olivar treatments
    Object.entries(state.olivar.tratamientos || {}).forEach(([parcelId, list]) => {
        (list || []).forEach(t => {
            all.push({ ...t, source: 'olivar', parcelName: state.olivar.parcelas[parcelId] || parcelId });
        });
    });
    return all;
}

function renderCalendar() {
    const container = document.getElementById('calendar-container');
    const monthYearEl = document.getElementById('calendar-month-year');
    if (!container || !monthYearEl) return;

    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    monthYearEl.textContent = `${monthNames[calendarMonth]} ${calendarYear}`;

    // Get all treatments indexed by date string
    const allTreatments = getAllTreatments();
    const byDate = {};
    allTreatments.forEach(t => {
        const d = t.date;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(t);
    });

    // Build calendar
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // Monday-first: 0=Mon
    const totalDays = lastDay.getDate();
    const todayStr = getTodayString();

    let html = `<div class="calendar-weekdays">`;
    ['L','M','X','J','V','S','D'].forEach(d => { html += `<div>${d}</div>`; });
    html += `</div><div class="calendar-days-grid">`;

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
        html += `<div class="calendar-day-cell other-month"></div>`;
    }

    for (let day = 1; day <= totalDays; day++) {
        const mm = String(calendarMonth + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const dateStr = `${calendarYear}-${mm}-${dd}`;
        const treatments = byDate[dateStr] || [];
        const isToday = (dateStr === todayStr);
        const isSelected = (dateStr === selectedCalendarDateString);

        const hasHuerto = treatments.some(t => t.source === 'huerto');
        const hasOlivar = treatments.some(t => t.source === 'olivar');

        let classes = 'calendar-day-cell';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        let dots = '';
        if (hasHuerto || hasOlivar) {
            dots = `<div class="calendar-dots-container">`;
            if (hasHuerto) dots += `<div class="calendar-dot huerto"></div>`;
            if (hasOlivar) dots += `<div class="calendar-dot olivar"></div>`;
            dots += `</div>`;
        }

        html += `<div class="${classes}" onclick="selectCalendarDay('${dateStr}')">${day}${dots}</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Update day detail panel
    renderCalendarDayDetail(selectedCalendarDateString);
}

function selectCalendarDay(dateStr) {
    selectedCalendarDateString = dateStr;
    selectedCalendarDay = dateStr;
    renderCalendar();
}

function renderCalendarDayDetail(dateStr) {
    const listEl = document.getElementById('calendar-day-treatments-list');
    const titleEl = document.getElementById('calendar-selected-day-title');
    if (!listEl || !titleEl) return;

    const allTreatments = getAllTreatments();
    const dayTreatments = allTreatments.filter(t => t.date === dateStr);
    const todayStr = getTodayString();

    // Format date for display
    if (dateStr) {
        const [y, m, d] = dateStr.split('-');
        const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        titleEl.innerHTML = `<i class="ph ph-list-bullets"></i> ${parseInt(d)} de ${monthNames[parseInt(m)-1]} de ${y}`;
    }

    if (dayTreatments.length === 0) {
        const isPast = dateStr < todayStr;
        const msg = isPast
            ? 'Sin tratamientos registrados este día.'
            : 'Sin tratamientos programados para este día. Pulsa <strong>+ Programar</strong> para añadir uno.';
        listEl.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); padding: 8px 0;">${msg}</p>`;
        return;
    }

    let html = '';
    dayTreatments.forEach(t => {
        const isHuerto = t.source === 'huerto';
        const dotColor = isHuerto ? '#eab308' : '#22c55e';
        const label = isHuerto ? 'Huerto' : 'Olivar';
        const isFuture = dateStr > todayStr;
        const statusBadge = isFuture
            ? `<span style="font-size: 0.65rem; font-weight: 700; background: rgba(76,201,240,0.15); color: var(--primary-light); border-radius: 4px; padding: 2px 6px;">PROGRAMADO</span>`
            : `<span style="font-size: 0.65rem; font-weight: 700; background: rgba(34,197,94,0.15); color: #22c55e; border-radius: 4px; padding: 2px 6px;">APLICADO</span>`;

        html += `
            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 8px;">
                <div style="width: 10px; height: 10px; border-radius: 50%; background: ${dotColor}; margin-top: 4px; flex-shrink: 0;"></div>
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">${escapeHTML(t.productName)}</span>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.6;">
                        <span>${label} &mdash; ${escapeHTML(t.parcelName)}</span><br>
                        <span>Dosis: ${escapeHTML(t.dose || '-')}</span>
                        ${t.safetyDays > 0 ? `<br><span>Plazo de seguridad: ${t.safetyDays} días (hasta ${t.expiresAt})</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    listEl.innerHTML = html;
}

function prevMonth() {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
}

function nextMonth() {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar();
}

// ============================================================
// --- FASE LUNAR (cálculo matemático puro) ---
// ============================================================
function getLunarPhase(date = new Date()) {
    // Referencia: 6 Ene 2000 fue luna nueva (JD 2451549.5)
    const lnRef = new Date('2000-01-06T18:14:00Z');
    const cycle = 29.53058867;
    const diffMs = date - lnRef;
    const diffDays = diffMs / 86400000;
    const phase = ((diffDays % cycle) + cycle) % cycle;
    const illumination = Math.round(50 * (1 - Math.cos((2 * Math.PI * phase) / cycle)));

    let emoji, name, tip;
    if (phase < 1.85) { emoji = '🌑'; name = 'Luna Nueva'; tip = 'Poda y siembra de raíz.'; }
    else if (phase < 7.38) { emoji = '🌒'; name = 'Cuarto Creciente'; tip = 'Buena para sembrar plantas de fruto.'; }
    else if (phase < 14.77) { emoji = '🌓'; name = 'Luna Creciente'; tip = 'Ideal para injertar y trasplantar.'; }
    else if (phase < 16.61) { emoji = '🌕'; name = 'Luna Llena'; tip = 'Cosecha frutas, máxima concentración de savia.'; }
    else if (phase < 22.15) { emoji = '🌖'; name = 'Luna Menguante'; tip = 'Podar, cortar leña, tratamientos fungicidas.'; }
    else if (phase < 25.38) { emoji = '🌗'; name = 'Cuarto Menguante'; tip = 'Abonado de fondo, laboreo del suelo.'; }
    else { emoji = '🌘'; name = 'Luna Nueva Próxima'; tip = 'Preparar terreno y planificar siembras.'; }

    return { emoji, name, illumination, tip, phase: Math.round(phase * 10) / 10 };
}

function renderLunarWidget() {
    const el = document.getElementById('lunar-widget');
    if (!el) return;
    const moon = getLunarPhase();
    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:2.4rem; line-height:1;">${moon.emoji}</span>
            <div>
                <div style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">${moon.name}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary);">Iluminación: ${moon.illumination}%</div>
                <div style="font-size:0.72rem; color:var(--primary); font-style:italic; margin-top:2px;">${moon.tip}</div>
            </div>
        </div>
    `;
}

// ============================================================
// --- RIEGO (Registro de riego por parcela) ---
// ============================================================
function renderRiego(type, parcelId) {
    const containerId = `${type}-riego-container`;
    const el = document.getElementById(containerId);
    if (!el) return;

    const list = (state[type].riego && state[type].riego[parcelId]) || [];
    const lastThree = list.slice(-3).reverse();

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span class="card-title" style="margin:0; font-size:0.95rem;"><i class="ph ph-drop"></i> Riego</span>
            <button class="btn" style="width:auto; padding:5px 10px; font-size:0.75rem; border-radius:8px;" onclick="openAddRiegoModal('${type}','${parcelId}')">
                <i class="ph ph-plus"></i> Registrar
            </button>
        </div>
    `;

    if (lastThree.length === 0) {
        html += `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding:8px;">Sin registros de riego.</div>`;
    } else {
        lastThree.forEach(r => {
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(76,201,240,0.05); border:1px solid rgba(76,201,240,0.15); border-radius:10px; padding:8px 12px; margin-bottom:6px;">
                    <div>
                        <span style="font-size:0.8rem; font-weight:700; color:var(--text-primary);">${r.method}</span>
                        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">${r.date}</span>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.8rem; font-weight:700; color:#3b82f6;">${r.liters} L</span>
                        <span style="font-size:0.72rem; color:var(--text-muted); display:block;">${r.minutes} min</span>
                    </div>
                </div>
            `;
        });
    }
    el.innerHTML = html;
}

function openAddRiegoModal(type, parcelId) {
    document.getElementById('riego-type').value = type;
    document.getElementById('riego-parcela').value = parcelId;
    document.getElementById('riego-date').value = getTodayString();
    document.getElementById('riego-minutes').value = '';
    document.getElementById('riego-liters').value = '';
    document.getElementById('riego-method').value = 'Goteo';
    openModal('modal-add-riego');
}

function saveRiego(e) {
    e.preventDefault();
    const type = document.getElementById('riego-type').value;
    const parcelId = document.getElementById('riego-parcela').value;
    const date = document.getElementById('riego-date').value;
    const minutes = parseFloat(document.getElementById('riego-minutes').value) || 0;
    const liters = parseFloat(document.getElementById('riego-liters').value) || 0;
    const method = document.getElementById('riego-method').value;

    if (!state[type].riego) state[type].riego = {};
    if (!state[type].riego[parcelId]) state[type].riego[parcelId] = [];

    state[type].riego[parcelId].push({ id: Date.now(), date, minutes, liters, method });
    state.diario.push({
        id: Date.now() + 1,
        text: `Riego en ${state[type].parcelas[parcelId]}: ${liters}L por ${method.toLowerCase()} durante ${minutes} minutos.`,
        date: `${date} ${getNowTimeString()}`,
        photo: null
    });

    saveState();
    closeModal('modal-add-riego');
    renderRiego(type, parcelId);
    showToast('Riego registrado', 'success');
}

// ============================================================
// --- FERTILIZACIÓN PROGRAMADA ---
// ============================================================
function renderFertilizaciones(type, parcelId) {
    const containerId = `${type}-fertilizacion-container`;
    const el = document.getElementById(containerId);
    if (!el) return;

    const list = (state[type].fertilizaciones && state[type].fertilizaciones[parcelId]) || [];
    const lastThree = list.slice(-3).reverse();

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span class="card-title" style="margin:0; font-size:0.95rem;"><i class="ph ph-leaf"></i> Fertilización</span>
            <button class="btn" style="width:auto; padding:5px 10px; font-size:0.75rem; border-radius:8px;" onclick="openAddFertilizacionModal('${type}','${parcelId}')">
                <i class="ph ph-plus"></i> Registrar
            </button>
        </div>
    `;

    if (lastThree.length === 0) {
        html += `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding:8px;">Sin abonados registrados.</div>`;
    } else {
        lastThree.forEach(f => {
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(143,167,107,0.06); border:1px solid rgba(143,167,107,0.18); border-radius:10px; padding:8px 12px; margin-bottom:6px;">
                    <div>
                        <span style="font-size:0.8rem; font-weight:700; color:var(--text-primary);">${escapeHTML(f.productName)}</span>
                        <span style="font-size:0.72rem; color:var(--primary); display:block;">${f.tipoAbonado}</span>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.8rem; font-weight:700; color:var(--primary-light);">${f.amount} uds</span>
                        <span style="font-size:0.72rem; color:var(--text-muted); display:block;">${f.date}</span>
                    </div>
                </div>
            `;
        });
    }
    el.innerHTML = html;
}

function openAddFertilizacionModal(type, parcelId) {
    const select = document.getElementById('fertilizacion-product');
    select.innerHTML = '';
    const abonos = state.almacen.filter(p => p.stock > 0);
    if (abonos.length === 0) {
        showToast('No hay productos con stock en el almacén', 'error');
        return;
    }
    abonos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Stock: ${p.stock.toFixed(1)})`;
        select.appendChild(opt);
    });
    document.getElementById('fertilizacion-type').value = type;
    document.getElementById('fertilizacion-parcela').value = parcelId;
    document.getElementById('fertilizacion-date').value = getTodayString();
    document.getElementById('fertilizacion-amount').value = 1;
    document.getElementById('fertilizacion-tipo').value = 'Radicular';
    openModal('modal-add-fertilizacion');
}

function saveFertilizacion(e) {
    e.preventDefault();
    const type = document.getElementById('fertilizacion-type').value;
    const parcelId = document.getElementById('fertilizacion-parcela').value;
    const productId = parseInt(document.getElementById('fertilizacion-product').value);
    const amount = parseFloat(document.getElementById('fertilizacion-amount').value) || 0;
    const tipoAbonado = document.getElementById('fertilizacion-tipo').value;
    const date = document.getElementById('fertilizacion-date').value;

    const prod = state.almacen.find(p => p.id === productId);
    if (!prod) return;
    if (prod.stock < amount) {
        showToast('Stock insuficiente en almacén', 'error');
        return;
    }
    prod.stock -= amount;

    if (!state[type].fertilizaciones) state[type].fertilizaciones = {};
    if (!state[type].fertilizaciones[parcelId]) state[type].fertilizaciones[parcelId] = [];

    state[type].fertilizaciones[parcelId].push({
        id: Date.now(),
        productName: prod.name,
        amount,
        tipoAbonado,
        date
    });

    state.diario.push({
        id: Date.now() + 1,
        text: `Abonado en ${state[type].parcelas[parcelId]}: ${amount} uds de ${prod.name} (${tipoAbonado}).`,
        date: `${date} ${getNowTimeString()}`,
        photo: null
    });

    saveState();
    closeModal('modal-add-fertilizacion');
    renderFertilizaciones(type, parcelId);
    showToast('Abonado registrado y stock descontado', 'success');
}

// ============================================================
// --- ALERTAS DE PLAGAS ---
// ============================================================
function renderPlagaAlertas(type, parcelId) {
    const containerId = `${type}-plagas-container`;
    const el = document.getElementById(containerId);
    if (!el) return;

    const alertas = (state[type].plagaAlertas && state[type].plagaAlertas[parcelId]) || [];
    const today = getTodayString();

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span class="card-title" style="margin:0; font-size:0.95rem;"><i class="ph ph-bug"></i> Alertas de Plagas</span>
            <button class="btn" style="width:auto; padding:5px 10px; font-size:0.75rem; border-radius:8px;" onclick="openAddPlagaAlertModal('${type}','${parcelId}')">
                <i class="ph ph-plus"></i> Nueva Alerta
            </button>
        </div>
    `;

    if (alertas.length === 0) {
        html += `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding:8px;">Sin alertas de plagas configuradas.</div>`;
    } else {
        alertas.forEach(a => {
            const nextReview = a.lastChecked ? addDays(a.lastChecked, a.intervalDays) : today;
            const isDue = today >= nextReview;
            const daysLeft = getDaysDiff(today, nextReview);
            const statusColor = isDue ? 'var(--danger)' : 'var(--success)';
            const statusText = isDue ? '⚠️ REVISAR AHORA' : `✅ En ${daysLeft}d`;
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:${isDue ? 'rgba(201,76,76,0.06)' : 'rgba(56,142,60,0.04)'}; border:1px solid ${isDue ? 'rgba(201,76,76,0.25)' : 'rgba(56,142,60,0.15)'}; border-radius:10px; padding:8px 12px; margin-bottom:6px;">
                    <div>
                        <span style="font-size:0.82rem; font-weight:700; color:var(--text-primary);">${escapeHTML(a.name)}</span>
                        <span style="font-size:0.72rem; color:var(--text-muted); display:block;">Cada ${a.intervalDays} días</span>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                        <span style="font-size:0.72rem; font-weight:700; color:${statusColor};">${statusText}</span>
                        ${isDue ? `<button style="font-size:0.7rem; padding:3px 8px; border-radius:6px; border:none; background:var(--success); color:white; cursor:pointer; font-weight:700;" onclick="markPlagaReviewed(${a.id},'${type}','${parcelId}')">Revisado ✓</button>` : ''}
                        <button style="font-size:0.7rem; padding:2px 6px; border-radius:6px; border:1px solid var(--border-color); background:none; color:var(--text-muted); cursor:pointer;" onclick="deletePlagaAlert(${a.id},'${type}','${parcelId}')">✕</button>
                    </div>
                </div>
            `;
        });
    }
    el.innerHTML = html;
}

function openAddPlagaAlertModal(type, parcelId) {
    document.getElementById('plaga-type').value = type;
    document.getElementById('plaga-parcela').value = parcelId;
    document.getElementById('plaga-name').value = '';
    document.getElementById('plaga-interval').value = 14;
    openModal('modal-add-plaga');
}

function savePlagaAlert(e) {
    e.preventDefault();
    const type = document.getElementById('plaga-type').value;
    const parcelId = document.getElementById('plaga-parcela').value;
    const name = document.getElementById('plaga-name').value.trim();
    const intervalDays = parseInt(document.getElementById('plaga-interval').value) || 14;

    if (!name) return;
    if (!state[type].plagaAlertas) state[type].plagaAlertas = {};
    if (!state[type].plagaAlertas[parcelId]) state[type].plagaAlertas[parcelId] = [];

    state[type].plagaAlertas[parcelId].push({
        id: Date.now(),
        name,
        intervalDays,
        lastChecked: null
    });

    saveState();
    closeModal('modal-add-plaga');
    renderPlagaAlertas(type, parcelId);
    showToast(`Alerta "${name}" activada`, 'success');
}

function markPlagaReviewed(alertId, type, parcelId) {
    const alertas = state[type].plagaAlertas[parcelId] || [];
    const a = alertas.find(x => x.id === alertId);
    if (a) {
        a.lastChecked = getTodayString();
        saveState();
        renderPlagaAlertas(type, parcelId);
        showToast('Revisión registrada', 'success');
    }
}

function deletePlagaAlert(alertId, type, parcelId) {
    if (!state[type].plagaAlertas || !state[type].plagaAlertas[parcelId]) return;
    state[type].plagaAlertas[parcelId] = state[type].plagaAlertas[parcelId].filter(a => a.id !== alertId);
    saveState();
    renderPlagaAlertas(type, parcelId);
    showToast('Alerta eliminada', 'info');
}

// ============================================================
// --- GRÁFICA DE PRECIPITACIÓN (Open-Meteo Archive) ---
// ============================================================
let rainfallChartYear = new Date().getFullYear();
let rainfallChartMonth = new Date().getMonth(); // 0-indexed

async function fetchAndRenderRainfall() {
    const loc = state.weatherLocation || 'albacete';
    const coords = WEATHER_COORDINATES[loc];
    if (!coords) return;

    const year = rainfallChartYear;
    const month = rainfallChartMonth;
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const today = new Date();
    let lastDay = new Date(year, month + 1, 0); // last day of month
    if (lastDay > today) lastDay = new Date(today.getTime() - 86400000); // cap to yesterday
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    if (lastDay < new Date(year, month, 1)) {
        // Month hasn't started yet
        renderRainfallChart([], year, month);
        return;
    }

    const chartEl = document.getElementById('rainfall-chart');
    if (chartEl) chartEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;"><i class="ph ph-cloud-rain" style="font-size:1.5rem; display:block; margin-bottom:6px;"></i>Cargando datos...</div>';

    try {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${coords.lat}&longitude=${coords.lon}&start_date=${firstDay}&end_date=${lastDayStr}&daily=precipitation_sum&timezone=Europe%2FMadrid`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const precipData = (data.daily && data.daily.precipitation_sum) || [];
        renderRainfallChart(precipData, year, month);
    } catch (err) {
        console.warn('Error cargando datos de lluvia:', err);
        if (chartEl) chartEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">No se pudieron cargar los datos meteorológicos.</div>';
    }
}

function renderRainfallChart(data, year, month) {
    const chartEl = document.getElementById('rainfall-chart');
    const totalEl = document.getElementById('rainfall-total');
    const monthEl = document.getElementById('rainfall-month-label');
    if (!chartEl) return;

    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    if (monthEl) monthEl.textContent = `${monthNames[month]} ${year}`;

    const total = data.reduce((s, v) => s + (v || 0), 0);
    if (totalEl) totalEl.textContent = `${total.toFixed(1)} L/m²`;

    if (!data || data.length === 0) {
        chartEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">Sin datos disponibles para este período.</div>';
        return;
    }

    const maxVal = Math.max(...data.map(v => v || 0), 1);
    const barWidth = Math.max(8, Math.floor(100 / data.length));
    const chartWidth = data.length * (barWidth + 3);
    const chartHeight = 100;

    let svgBars = '';
    let svgLabels = '';
    let todayData = null;
    let todayIndex = -1;

    const currentServerDate = new Date();
    const isCurrentMonth = (currentServerDate.getFullYear() === year && currentServerDate.getMonth() === month);
    if (isCurrentMonth) {
        todayIndex = currentServerDate.getDate() - 1;
    }

    data.forEach((val, i) => {
        const v = val || 0;
        const barH = Math.max(v > 0 ? 4 : 0, Math.round((v / maxVal) * (chartHeight - 20)));
        const x = i * (barWidth + 3);
        const y = chartHeight - 16 - barH;
        const color = v > 10 ? '#3b82f6' : v > 3 ? '#60a5fa' : '#bfdbfe';
        
        // Add onclick event and styling for interactivity
        svgBars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="2" fill="${color}" opacity="0.85" cursor="pointer" onclick="showRainfallDetail(${i + 1}, ${v.toFixed(1)}, '${monthNames[month]}', ${year})"/>`;
        
        if ((i + 1) % 5 === 0 || i === 0 || i === data.length - 1) {
            svgLabels += `<text x="${x + barWidth / 2}" y="${chartHeight - 2}" text-anchor="middle" font-size="8" fill="#88997f">${i + 1}</text>`;
        }
        if (v > 0) {
            svgBars += `<title>Día ${i + 1}: ${v.toFixed(1)} L/m²</title>`;
        }
        
        if (i === todayIndex) {
            todayData = v;
        }
    });

    chartEl.innerHTML = `
        <svg viewBox="0 0 ${Math.max(chartWidth, 300)} ${chartHeight}" style="width:100%; height:120px;" xmlns="http://www.w3.org/2000/svg">
            <line x1="0" y1="${chartHeight - 16}" x2="${Math.max(chartWidth, 300)}" y2="${chartHeight - 16}" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>
            ${svgBars}
            ${svgLabels}
        </svg>
    `;

    // Initialize the selection label
    const selectedDayEl = document.getElementById('rainfall-selected-day');
    if (selectedDayEl) {
        if (isCurrentMonth && todayData !== null) {
            showRainfallDetail(todayIndex + 1, todayData.toFixed(1), monthNames[month], year);
        } else {
            selectedDayEl.innerHTML = 'Toca una barra para ver detalles';
        }
    }
}

function showRainfallDetail(day, amount, monthName, year) {
    const selectedDayEl = document.getElementById('rainfall-selected-day');
    if (selectedDayEl) {
        selectedDayEl.innerHTML = `Día ${day} de ${monthName}: <span style="font-size:1.1rem; color:#3b82f6; margin-left:4px;">${amount} L/m²</span>`;
    }
}

function prevRainfallMonth() {
    rainfallChartMonth--;
    if (rainfallChartMonth < 0) { rainfallChartMonth = 11; rainfallChartYear--; }
    fetchAndRenderRainfall();
}

function nextRainfallMonth() {
    rainfallChartMonth++;
    if (rainfallChartMonth > 11) { rainfallChartMonth = 0; rainfallChartYear++; }
    fetchAndRenderRainfall();
}

// ============================================================
// --- WIDGET DE "HOY" (Pantalla de inicio) ---
// ============================================================
function renderHoy() {
    renderLunarWidget();
    renderHoyTareas();
    renderHoyAlertas();
    renderHoyCalendario();
    fetchAndRenderRainfall();
}

function renderHoyTareas() {
    const el = document.getElementById('hoy-tareas-list');
    if (!el) return;
    let pendingTasks = [];

    ['huerto', 'olivar'].forEach(type => {
        Object.entries(state[type].tareas || {}).forEach(([parcelId, tasks]) => {
            const parcelName = state[type].parcelas[parcelId] || parcelId;
            (tasks || []).filter(t => !t.done).forEach(t => {
                pendingTasks.push({ text: t.text, parcel: parcelName, type });
            });
        });
    });

    if (pendingTasks.length === 0) {
        el.innerHTML = `<div style="font-size:0.8rem; color:var(--success); display:flex; align-items:center; gap:6px;"><i class="ph-fill ph-check-circle"></i> ¡Todo al día! Sin tareas pendientes.</div>`;
        return;
    }

    let html = '';
    pendingTasks.slice(0, 5).forEach(t => {
        html += `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color);">
                <i class="ph ph-square" style="color:var(--text-muted); font-size:1rem;"></i>
                <div>
                    <div style="font-size:0.82rem; font-weight:600; color:var(--text-primary);">${escapeHTML(t.text)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${escapeHTML(t.parcel)}</div>
                </div>
            </div>
        `;
    });
    if (pendingTasks.length > 5) {
        html += `<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding-top:6px;">+${pendingTasks.length - 5} tareas más...</div>`;
    }
    el.innerHTML = html;
}

function renderHoyAlertas() {
    const el = document.getElementById('hoy-alertas-list');
    if (!el) return;
    const today = getTodayString();
    let dueAlertas = [];

    ['huerto', 'olivar'].forEach(type => {
        Object.entries(state[type].plagaAlertas || {}).forEach(([parcelId, alertas]) => {
            const parcelName = state[type].parcelas[parcelId] || parcelId;
            (alertas || []).forEach(a => {
                const nextReview = a.lastChecked ? addDays(a.lastChecked, a.intervalDays) : today;
                if (today >= nextReview) {
                    dueAlertas.push({ ...a, parcel: parcelName });
                }
            });
        });
    });

    if (dueAlertas.length === 0) {
        el.innerHTML = `<div style="font-size:0.8rem; color:var(--success); display:flex; align-items:center; gap:6px;"><i class="ph-fill ph-check-circle"></i> Sin alertas de plagas pendientes.</div>`;
        return;
    }

    let html = '';
    dueAlertas.forEach(a => {
        html += `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:rgba(201,76,76,0.06); border:1px solid rgba(201,76,76,0.2); border-radius:8px; margin-bottom:6px;">
                <i class="ph ph-bug" style="color:var(--danger); font-size:1.1rem;"></i>
                <div>
                    <div style="font-size:0.82rem; font-weight:700; color:var(--danger);">${escapeHTML(a.name)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${escapeHTML(a.parcel)} — Revisar ahora</div>
                </div>
            </div>
        `;
    });
    el.innerHTML = html;
}

function renderHoyCalendario() {
    const el = document.getElementById('hoy-calendario-list');
    if (!el) return;
    const today = getTodayString();
    const allT = getAllTreatments();
    const todayT = allT.filter(t => t.date === today);

    if (todayT.length === 0) {
        el.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted);">Sin tratamientos programados para hoy.</div>`;
        return;
    }

    let html = '';
    todayT.forEach(t => {
        const label = t.source === 'huerto' ? '🌱 Huerto' : '🫒 Olivar';
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:rgba(75,96,67,0.06); border:1px solid rgba(75,96,67,0.15); border-radius:8px; margin-bottom:6px;">
                <div>
                    <div style="font-size:0.82rem; font-weight:700; color:var(--text-primary);">${escapeHTML(t.productName)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${label} — ${escapeHTML(t.parcelName)}</div>
                </div>
                <span style="font-size:0.7rem; padding:2px 6px; background:rgba(75,96,67,0.1); border-radius:6px; color:var(--primary); font-weight:700;">HOY</span>
            </div>
        `;
    });
    el.innerHTML = html;
}

// ============================================================
// --- VISTA DATOS (Economía + Estadísticas unificadas) ---
// ============================================================
let datosTab = 'economia';

function switchDatosTab(tab) {
    datosTab = tab;
    ['economia', 'estadisticas', 'lluvia'].forEach(t => {
        const btn = document.getElementById(`datos-tab-${t}`);
        const view = document.getElementById(`datos-view-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
        if (view) view.classList.toggle('hidden', t !== tab);
    });
    if (tab === 'estadisticas') renderStats();
    if (tab === 'lluvia') fetchAndRenderRainfall();
}

function renderDatos() {
    renderEconomia();
    if (datosTab === 'estadisticas') renderStats();
}

// ============================================================
// --- MAIN MENU OVERLAY (Option 1) ---
// ============================================================
function toggleMainMenu() {
    const overlay = document.getElementById('main-menu-overlay');
    if (!overlay) return;
    
    // Si ya está abierto, lo cerramos
    if (overlay.classList.contains('active')) {
        overlay.classList.remove('active');
    } else {
        overlay.classList.add('active');
        
        // Remove active state from all bottom nav except menu
        document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('nav-menu').classList.add('active');
    }
}

// ============================================================
// --- ECONOMÍA (now contains cost-per-kg) ---
// ============================================================
function renderEconomia() {
    let totalExpenses = 0;

    const huertoKeys = Object.keys(state.huerto.tratamientos);
    const olivarKeys = Object.keys(state.olivar.tratamientos);

    const calculateCost = (list) => {
        list.forEach(t => {
            const p = state.almacen.find(prod => prod.name === t.productName);
            const unitPrice = p ? p.price : 10.0;
            totalExpenses += t.amount * unitPrice;
        });
    };

    huertoKeys.forEach(k => calculateCost(state.huerto.tratamientos[k]));
    olivarKeys.forEach(k => calculateCost(state.olivar.tratamientos[k]));

    // Fertilización costs
    ['huerto', 'olivar'].forEach(type => {
        Object.values(state[type].fertilizaciones || {}).forEach(list => {
            (list || []).forEach(f => {
                const p = state.almacen.find(prod => prod.name === f.productName);
                const unitPrice = p ? p.price : 10.0;
                totalExpenses += f.amount * unitPrice;
            });
        });
    });

    if (state.huerto.plantaciones) {
        Object.values(state.huerto.plantaciones).forEach(plantings => {
            (plantings || []).forEach(p => { totalExpenses += p.qty * p.cost; });
        });
    }

    let totalIncome = 0;
    state.huerto.cosechas.forEach(h => { totalIncome += h.count * 0.40; });
    state.olivar.cosechas.forEach(h => { totalIncome += h.oil * 6.80; });

    const balance = totalIncome - totalExpenses;

    const finExp = document.getElementById('fin-expenses');
    const finInc = document.getElementById('fin-income');
    const finBal = document.getElementById('fin-balance');

    if (finExp) finExp.innerText = `${totalExpenses.toFixed(2)} €`;
    if (finInc) finInc.innerText = `${totalIncome.toFixed(2)} €`;
    if (finBal) {
        finBal.innerText = `${balance.toFixed(2)} €`;
        finBal.className = `finance-value balance ${balance >= 0 ? 'income' : 'expense'}`;
    }

    // Coste por kg/unidad
    renderCostPerUnit();
}

function renderCostPerUnit() {
    const el = document.getElementById('cost-per-unit-list');
    if (!el) return;

    const products = {};

    state.huerto.cosechas.forEach(h => {
        if (!products[h.product]) products[h.product] = { units: 0, type: 'huerto' };
        products[h.product].units += h.count;
    });

    state.olivar.cosechas.forEach(h => {
        if (!products['Aceite Oliva']) products['Aceite Oliva'] = { units: 0, type: 'olivar' };
        products['Aceite Oliva'].units += h.oil;
    });

    let totalTreatmentCost = 0;
    ['huerto', 'olivar'].forEach(type => {
        Object.values(state[type].tratamientos || {}).forEach(list => {
            (list || []).forEach(t => {
                const p = state.almacen.find(prod => prod.name === t.productName);
                totalTreatmentCost += t.amount * (p ? p.price : 10);
            });
        });
    });

    const entries = Object.entries(products);
    if (entries.length === 0) {
        el.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:10px;">Sin cosechas registradas todavía.</div>`;
        return;
    }

    let html = '';
    entries.forEach(([name, data]) => {
        const isOlivar = data.type === 'olivar';
        const costPer = data.units > 0 ? (totalTreatmentCost / entries.length / data.units) : 0;
        const unit = isOlivar ? 'Kg aceite' : 'uds';
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
                <div>
                    <div style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">${escapeHTML(name)}</div>
                    <div style="font-size:0.72rem; color:var(--text-muted);">Total: ${data.units.toLocaleString()} ${unit}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.85rem; font-weight:700; color:var(--secondary);">${costPer.toFixed(2)} €/${unit}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">coste estimado</div>
                </div>
            </div>
        `;
    });
    el.innerHTML = html;
}

// ============================================================
// --- ESTADÍSTICAS AMPLIADAS (comparativa + harvest by year) ---
// ============================================================
function renderStats() {
    const listEl = document.getElementById('stats-ranking-list');
    if (!listEl) return;

    const totals = {};
    const byYear = {};

    const huertoCosechas = state.huerto.cosechas || [];
    huertoCosechas.forEach(c => {
        const prod = c.product || 'Cultivo Desconocido';
        if (!totals[prod]) totals[prod] = { value: 0, unit: 'uds' };
        totals[prod].value += parseFloat(c.count) || 0;
        const yr = c.date ? c.date.substring(0, 4) : 'Sin fecha';
        if (!byYear[prod]) byYear[prod] = {};
        if (!byYear[prod][yr]) byYear[prod][yr] = 0;
        byYear[prod][yr] += parseFloat(c.count) || 0;
    });

    const olivarCosechas = state.olivar.cosechas || [];
    olivarCosechas.forEach(c => {
        const prod = 'Aceitunas';
        if (!totals[prod]) totals[prod] = { value: 0, unit: 'Kg' };
        totals[prod].value += parseFloat(c.kg) || 0;
        const yr = c.date ? c.date.substring(0, 4) : 'Sin fecha';
        if (!byYear[prod]) byYear[prod] = {};
        if (!byYear[prod][yr]) byYear[prod][yr] = 0;
        byYear[prod][yr] += parseFloat(c.kg) || 0;
    });

    const sorted = Object.entries(totals)
        .map(([name, data]) => ({ name, value: data.value, unit: data.unit }))
        .sort((a, b) => b.value - a.value);

    if (sorted.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:25px 10px; color:var(--text-muted); font-size:0.85rem;"><i class="ph ph-trend-up" style="font-size:2.2rem; display:block; margin-bottom:8px; opacity:0.5;"></i>Sin cosechas registradas. Los cultivos aparecerán aquí.</div>`;
        return;
    }

    const maxVal = Math.max(...sorted.map(item => item.value), 1);
    let html = '';

    sorted.forEach((item, index) => {
        const pct = Math.round((item.value / maxVal) * 100);
        let badge = `<span style="font-size:0.75rem; font-weight:700; width:22px; height:22px; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.05); border-radius:50%; color:var(--text-muted);">${index + 1}</span>`;
        if (index === 0) badge = `<span style="font-size:1.1rem; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">🏆</span>`;
        else if (index === 1) badge = `<span style="font-size:1.1rem; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">🥈</span>`;
        else if (index === 2) badge = `<span style="font-size:1.1rem; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">🥉</span>`;

        // Year comparison
        const years = Object.keys(byYear[item.name] || {}).sort();
        let compareHtml = '';
        if (years.length >= 2) {
            const lastYr = years[years.length - 1];
            const prevYr = years[years.length - 2];
            const lastVal = byYear[item.name][lastYr];
            const prevVal = byYear[item.name][prevYr];
            const pctChange = prevVal > 0 ? Math.round(((lastVal - prevVal) / prevVal) * 100) : null;
            if (pctChange !== null) {
                const arrow = pctChange >= 0 ? '↑' : '↓';
                const color = pctChange >= 0 ? 'var(--success)' : 'var(--danger)';
                compareHtml = `<span style="font-size:0.7rem; font-weight:700; color:${color};">${arrow} ${Math.abs(pctChange)}% vs ${prevYr}</span>`;
            }
        }

        html += `
            <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${badge}
                        <span style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">${escapeHTML(item.name)}</span>
                        ${compareHtml}
                    </div>
                    <span style="font-size:0.85rem; font-weight:700; color:var(--primary-light);">${item.value.toLocaleString()} ${item.unit}</span>
                </div>
                <div style="width:100%; height:8px; background:rgba(0,0,0,0.05); border-radius:4px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:linear-gradient(90deg, var(--primary-light), var(--primary)); border-radius:4px;"></div>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// ============================================================
// --- EXPORTAR PDF ---
// ============================================================
function exportToPDF() {
    const today = getTodayString();
    const moon = getLunarPhase();

    let totalExpenses = 0;
    let totalIncome = 0;
    ['huerto', 'olivar'].forEach(type => {
        Object.values(state[type].tratamientos || {}).forEach(list => {
            (list || []).forEach(t => {
                const p = state.almacen.find(prod => prod.name === t.productName);
                totalExpenses += t.amount * (p ? p.price : 10);
            });
        });
    });
    state.huerto.cosechas.forEach(h => { totalIncome += h.count * 0.40; });
    state.olivar.cosechas.forEach(h => { totalIncome += h.oil * 6.80; });

    const balance = totalIncome - totalExpenses;

    let almacenRows = state.almacen.map(p => `
        <tr>
            <td>${escapeHTML(p.name)}</td>
            <td>${p.type}</td>
            <td>${p.stock.toFixed(1)}</td>
            <td>${p.price.toFixed(2)} €</td>
            <td>${p.composition || '-'}</td>
        </tr>
    `).join('');

    let diarioRows = state.diario.slice(-20).reverse().map(e => `
        <tr><td>${e.date}</td><td>${escapeHTML(e.text)}</td></tr>
    `).join('');

    const printContent = `
        <html><head>
        <title>Cuaderno de Campo — Informe ${today}</title>
        <style>
            body { font-family: Arial, sans-serif; font-size: 12px; color: #283321; padding: 20px; }
            h1 { color: #4b6043; border-bottom: 2px solid #4b6043; padding-bottom: 8px; }
            h2 { color: #4b6043; margin-top: 24px; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th { background: #4b6043; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
            td { padding: 5px 8px; border-bottom: 1px solid #ddd; font-size: 11px; }
            .kpi { display: inline-block; padding: 10px 20px; border: 1px solid #4b6043; border-radius: 8px; margin: 5px; text-align: center; }
            .kpi-val { font-size: 18px; font-weight: bold; color: #4b6043; }
            .positive { color: #388e3c; }
            .negative { color: #c94c4c; }
        </style>
        </head><body>
        <h1>🌿 Cuaderno de Campo — Informe</h1>
        <p>Generado el: <strong>${today}</strong> &nbsp;|&nbsp; Luna: ${moon.emoji} ${moon.name} (${moon.illumination}%)</p>

        <h2>💰 Resumen Económico</h2>
        <div>
            <div class="kpi"><div>Gastos</div><div class="kpi-val negative">${totalExpenses.toFixed(2)} €</div></div>
            <div class="kpi"><div>Ingresos</div><div class="kpi-val positive">${totalIncome.toFixed(2)} €</div></div>
            <div class="kpi"><div>Balance</div><div class="kpi-val ${balance >= 0 ? 'positive' : 'negative'}">${balance.toFixed(2)} €</div></div>
        </div>

        <h2>📦 Almacén</h2>
        <table>
            <tr><th>Producto</th><th>Tipo</th><th>Stock</th><th>Precio</th><th>Composición</th></tr>
            ${almacenRows || '<tr><td colspan="5">Sin productos</td></tr>'}
        </table>

        <h2>📓 Últimas 20 anotaciones del Diario</h2>
        <table>
            <tr><th>Fecha</th><th>Anotación</th></tr>
            ${diarioRows || '<tr><td colspan="2">Sin anotaciones</td></tr>'}
        </table>
        </body></html>
    `;

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (printWin) {
        printWin.document.write(printContent);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => { printWin.print(); }, 500);
    } else {
        showToast('Activa las ventanas emergentes para exportar el PDF', 'error');
    }
}

// --- INITIALIZE ON LOAD ---

window.addEventListener('DOMContentLoaded', () => {
    loadState();
    if (state.weatherLocation) {
        weatherState.location = state.weatherLocation;
    }
    fetchWeather();
    switchView(state.currentView);
    toggleCultivoTab(state.currentCultivoTab);
    initSyncAndIndexedDB();
});

// ============================================================
// --- RECARGAR APP (FORZAR CACHÉ) ---
// ============================================================
async function forceReloadApp() {
    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let reg of registrations) {
                await reg.unregister();
            }
        } catch (e) {
            console.error('Error unregistering sw:', e);
        }
    }
    // Añadimos un timestamp aleatorio para evitar caché de navegador
    window.location.href = window.location.href.split('?')[0] + '?reload=' + new Date().getTime();
}
