// --- DATA STRUCTURE & STATE ---
let state = {
    almacen: [],
    maquinaria: [],
    globalSettings: { laborCostPerHour: 10 },
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
            if (!state.maquinaria) state.maquinaria = [];
            if (!state.globalSettings) state.globalSettings = { laborCostPerHour: 10 };
            
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

    // Calcular Índice de Propagación de Incendios
    const fireIndexText = document.getElementById('fire-index-text');
    const fireIcon = document.getElementById('fire-icon');
    let fireRisk = "Bajo";
    let fireColor = "#22c55e"; // Green

    if (weatherState.temp >= 30 && weatherState.humidity <= 30 && weatherState.wind >= 25) {
        fireRisk = "EXTREMO";
        fireColor = "#dc2626"; // Red
    } else if (weatherState.temp >= 25 && weatherState.humidity <= 40 && weatherState.wind >= 15) {
        fireRisk = "ALTO";
        fireColor = "#f97316"; // Orange
    } else if (weatherState.temp >= 20 && weatherState.humidity <= 50) {
        fireRisk = "MODERADO";
        fireColor = "#eab308"; // Yellow
    }

    if (fireIndexText && fireIcon) {
        fireIndexText.innerText = fireRisk;
        fireIndexText.style.color = fireColor;
        fireIcon.style.color = fireColor;
    }

    // Configurar Alertas Extremas (Temperatura o Precipitación)
    const alertContainer = document.getElementById('weather-extreme-alerts');
    const alertText = document.getElementById('weather-extreme-text');
    let alertMsg = "";

    if (weatherState.temp >= 35) {
        alertMsg = "ALERTA: Temperatura Extrema";
    } else if (weatherState.temp <= 0) {
        alertMsg = "ALERTA: Riesgo de Helada";
    } else if (weatherState.status.toLowerCase().includes("lluvia") || weatherState.status.toLowerCase().includes("tormenta") || weatherState.status.toLowerCase().includes("chubasco")) {
        alertMsg = "ALERTA: Precipitación / Tormenta";
    }

    if (alertContainer && alertText) {
        if (alertMsg) {
            alertText.innerText = alertMsg;
            alertContainer.style.display = "flex";
        } else {
            alertContainer.style.display = "none";
        }
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
        checkPredictiveAlerts(weatherState.temp, weatherState.humidity, weatherState.wind);
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
        checkPredictiveAlerts(weatherState.temp, weatherState.humidity, weatherState.wind);
    }
}

function checkPredictiveAlerts(temp, humidity, wind) {
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }

    let alertTitle = null;
    let alertBody = null;

    if (temp <= 2) {
        alertTitle = "❄️ Alerta de Helada";
        alertBody = `La temperatura ha bajado a ${temp}°C. Riesgo grave para los cultivos.`;
    } else if (temp >= 35) {
        alertTitle = "🔥 Alerta de Calor Extremo";
        alertBody = `Temperatura de ${temp}°C. Asegúrate de que el riego esté activo.`;
    } else if (temp > 22 && humidity > 80) {
        alertTitle = "🐛 Riesgo de Plagas (Hongos)";
        alertBody = `Alta humedad (${humidity}%) y temperatura cálida (${temp}°C). Condiciones ideales para hongos.`;
    } else if (wind > 30) {
        alertTitle = "💨 Alerta de Viento Fuerte";
        alertBody = `Viento a ${wind} km/h. Suspende los tratamientos fitosanitarios.`;
    }

    if (alertTitle && "Notification" in window && Notification.permission === "granted") {
        new Notification(alertTitle, {
            body: alertBody,
            icon: '/icon.png' // Replace with proper icon if available
        });
    } else if (alertTitle) {
        // Fallback to internal toast if no permission
        showToast(`${alertTitle}: ${alertBody}`, "error");
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
                    <span class="stock-value" style="${stockStyle}">${p.stock.toFixed(1)} ${p.unit || 'ud'}</span>
                    <button class="stock-btn" onclick="adjustStock(${p.id}, 1)">+</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-warning" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="openEditProductModal(${p.id})">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="btn btn-danger" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="deleteProduct(${p.id})">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
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
    const idField = document.getElementById('prod-id').value;
    const name = document.getElementById('prod-name').value;
    const type = document.getElementById('prod-type').value;
    const stock = parseFloat(document.getElementById('prod-stock').value) || 0;
    const unit = document.getElementById('prod-unit').value || 'ud';
    const price = parseFloat(document.getElementById('prod-price').value) || 0;
    const dose = document.getElementById('prod-dose').value;
    const func = document.getElementById('prod-function').value;
    const composition = document.getElementById('prod-composition').value.trim();

    if (idField) {
        // Edit mode
        const p = state.almacen.find(prod => prod.id === parseInt(idField));
        if (p) {
            p.name = name;
            p.type = type;
            p.stock = stock;
            p.unit = unit;
            p.price = price;
            p.dose = dose;
            p.function = func;
            p.composition = composition;
            showToast(`${name} actualizado`, "success");
        }
    } else {
        // Add mode
        const newProd = {
            id: Date.now(),
            name,
            type,
            stock,
            unit,
            price,
            dose,
            function: func,
            composition: composition || ''
        };
        state.almacen.push(newProd);
        showToast(`${name} añadido al almacén`, "success");
    }

    saveState();
    closeModal('modal-add-product');
    document.getElementById('modal-add-product').querySelector('form').reset();
    document.getElementById('prod-id').value = '';
    renderAlmacen();
}

function openAddProductModal() {
    document.getElementById('modal-add-product').querySelector('.sheet-title').innerText = 'Agregar Producto';
    document.getElementById('modal-add-product').querySelector('form').reset();
    document.getElementById('prod-id').value = '';
    openModal('modal-add-product');
}

function openEditProductModal(productId) {
    const p = state.almacen.find(prod => prod.id === productId);
    if (!p) return;
    
    document.getElementById('modal-add-product').querySelector('.sheet-title').innerText = 'Editar Producto';
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-type').value = p.type;
    document.getElementById('prod-stock').value = p.stock;
    if (p.unit) {
        document.getElementById('prod-unit').value = p.unit;
    } else {
        document.getElementById('prod-unit').value = 'ud';
    }
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-dose').value = p.dose;
    document.getElementById('prod-function').value = p.function;
    document.getElementById('prod-composition').value = p.composition || '';
    
    openModal('modal-add-product');
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

// --- MAQUINARIA LOGIC ---
function toggleAlmacenTab(tab) {
    const pBtn = document.getElementById('tab-productos-btn');
    const mBtn = document.getElementById('tab-maquinaria-btn');
    const pView = document.getElementById('subview-productos');
    const mView = document.getElementById('subview-maquinaria');

    if (pBtn) pBtn.classList.remove('active');
    if (mBtn) mBtn.classList.remove('active');
    if (pView) pView.classList.add('hidden');
    if (mView) mView.classList.add('hidden');

    if (tab === 'productos') {
        if (pBtn) pBtn.classList.add('active');
        if (pView) pView.classList.remove('hidden');
        renderAlmacen();
    } else {
        if (mBtn) mBtn.classList.add('active');
        if (mView) mView.classList.remove('hidden');
        renderMaquinaria();
    }
}

function renderMaquinaria() {
    const listContainer = document.getElementById('maquinaria-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!state.maquinaria) state.maquinaria = [];

    if (state.maquinaria.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-tractor"></i>
                <span>No hay maquinaria registrada.</span>
            </div>
        `;
        return;
    }

    state.maquinaria.forEach(m => {
        const isMaintenanceDue = m.hours >= m.maintHours;
        const maintAlert = isMaintenanceDue ? `<div style="color: var(--danger); font-size: 0.75rem; font-weight: 700; margin-top: 4px;"><i class="ph-fill ph-warning-circle"></i> ¡Revisión / Mantenimiento necesario!</div>` : '';

        const card = document.createElement('div');
        card.className = "item-card";
        if (isMaintenanceDue) card.style.borderColor = "var(--danger)";
        
        card.innerHTML = `
            <div class="item-header">
                <span class="item-title">${escapeHTML(m.name)}</span>
            </div>
            <div class="item-info-line">Horas de uso: <span style="font-weight: 700;">${m.hours} h</span></div>
            <div class="item-info-line">Próx. Mantenimiento: <span>${m.maintHours} h</span></div>
            ${maintAlert}
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 8px;">
                <div style="display: flex; gap: 4px; align-items: center;">
                    <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; border-radius: 6px; width: auto;" onclick="addMaquinariaHours(${m.id}, 1)">+1h</button>
                    <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; border-radius: 6px; width: auto;" onclick="addMaquinariaHours(${m.id}, 5)">+5h</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-warning" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="openEditMaquinariaModal(${m.id})">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="btn btn-danger" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="deleteMaquinaria(${m.id})">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

function openAddMaquinariaModal() {
    document.getElementById('modal-add-maquinaria').querySelector('.sheet-title').innerText = 'Registrar Maquinaria';
    document.getElementById('modal-add-maquinaria').querySelector('form').reset();
    document.getElementById('maq-id').value = '';
    openModal('modal-add-maquinaria');
}

function openEditMaquinariaModal(id) {
    const m = state.maquinaria.find(x => x.id === id);
    if (!m) return;
    document.getElementById('modal-add-maquinaria').querySelector('.sheet-title').innerText = 'Editar Maquinaria';
    document.getElementById('maq-id').value = m.id;
    document.getElementById('maq-name').value = m.name;
    document.getElementById('maq-hours').value = m.hours;
    document.getElementById('maq-maint').value = m.maintHours;
    openModal('modal-add-maquinaria');
}

function saveMaquinaria(e) {
    e.preventDefault();
    const idField = document.getElementById('maq-id').value;
    const name = document.getElementById('maq-name').value.trim();
    const hours = parseFloat(document.getElementById('maq-hours').value) || 0;
    const maintHours = parseFloat(document.getElementById('maq-maint').value) || 0;

    if (!name) return;

    if (idField) {
        const m = state.maquinaria.find(x => x.id === parseInt(idField));
        if (m) {
            m.name = name;
            m.hours = hours;
            m.maintHours = maintHours;
            showToast("Maquinaria actualizada", "success");
        }
    } else {
        state.maquinaria.push({
            id: Date.now(),
            name: name,
            hours: hours,
            maintHours: maintHours
        });
        showToast("Maquinaria registrada", "success");
    }

    saveState();
    closeModal('modal-add-maquinaria');
    renderMaquinaria();
}

function deleteMaquinaria(id) {
    if (confirm("¿Seguro que deseas eliminar esta maquinaria?")) {
        state.maquinaria = state.maquinaria.filter(m => m.id !== id);
        saveState();
        renderMaquinaria();
        showToast("Maquinaria eliminada", "info");
    }
}

function addMaquinariaHours(id, amount) {
    const m = state.maquinaria.find(x => x.id === id);
    if (m) {
        m.hours += amount;
        saveState(true, false);
        renderMaquinaria();
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
    document.getElementById('modal-add-planting').querySelector('.sheet-title').innerText = 'Registrar Cultivo';
    document.getElementById('modal-add-planting').querySelector('form').reset();
    document.getElementById('plant-id').value = '';
    document.getElementById('plant-date').value = getTodayString();
    openModal('modal-add-planting');
}

function openEditPlantingModal(plantingId, pId) {
    const plantings = state.huerto.plantaciones[pId] || [];
    const p = plantings.find(pl => pl.id === plantingId);
    if (!p) return;

    document.getElementById('modal-add-planting').querySelector('.sheet-title').innerText = 'Editar Cultivo';
    document.getElementById('plant-id').value = p.id;
    document.getElementById('plant-name').value = p.name;
    document.getElementById('plant-qty').value = p.qty;
    document.getElementById('plant-cost').value = p.cost;
    document.getElementById('plant-date').value = p.date;
    
    openModal('modal-add-planting');
}

function addPlanting(e) {
    e.preventDefault();
    const pId = state.currentHuertoParcela;
    const name = document.getElementById('plant-name').value.trim();
    const qty = parseInt(document.getElementById('plant-qty').value) || 0;
    const cost = parseFloat(document.getElementById('plant-cost').value) || 0;
    const dateVal = document.getElementById('plant-date').value;

    const idField = document.getElementById('plant-id').value;

    if (!name || qty <= 0 || cost < 0) return;

    if (!state.huerto.plantaciones) state.huerto.plantaciones = {};
    if (!state.huerto.plantaciones[pId]) state.huerto.plantaciones[pId] = [];

    if (idField) {
        // Edit mode
        const p = state.huerto.plantaciones[pId].find(pl => pl.id === parseInt(idField));
        if (p) {
            p.name = name;
            p.qty = qty;
            p.cost = cost;
            p.date = dateVal;
            showToast("Plantación actualizada", "success");
        }
    } else {
        // Add mode
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
        showToast("Plantación guardada", "success");
    }

    saveState();
    closeModal('modal-add-planting');
    document.getElementById('modal-add-planting').querySelector('form').reset();
    document.getElementById('plant-id').value = '';
    renderHuerto();
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
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
                <button class="btn btn-warning" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="openEditPlantingModal(${p.id}, '${pId}')">
                    <i class="ph ph-pencil-simple"></i>
                </button>
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
    if (typeof renderHuertoHarvestHistory === 'function') renderHuertoHarvestHistory();
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
        
        const hoursBadge = t.hours ? `<span style="margin-left: 8px; font-size: 0.7rem; background: var(--surface-variant); padding: 2px 6px; border-radius: 4px; color: var(--text-secondary);"><i class="ph ph-clock"></i> ${t.hours}h</span>` : '';
        
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1;" onclick="toggleTask(${t.id}, '${type}', '${parcelId}')">
                <i class="${checkIcon}" style="font-size: 1.3rem; color: ${t.done ? 'var(--primary)' : 'var(--text-secondary)'};"></i>
                <div style="display: flex; flex-direction: column;">
                    <span style="${textStyle}">${escapeHTML(t.text)}</span>
                    ${hoursBadge ? `<div>${hoursBadge}</div>` : ''}
                </div>
            </div>
            <div style="display: flex; gap: 4px;">
                <button class="close-sheet" style="font-size: 1.1rem; color: var(--warning); cursor: pointer;" onclick="editTask(${t.id}, '${type}', '${parcelId}')">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="close-sheet" style="font-size: 1.1rem; color: var(--danger); cursor: pointer;" onclick="deleteTask(${t.id}, '${type}', '${parcelId}')">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `;
        listEl.appendChild(card);
    });
}

function addTask(e, type) {
    e.preventDefault();
    const inputEl = document.getElementById(`${type}-task-input`);
    const hoursEl = document.getElementById(`${type}-task-hours`);
    const text = inputEl.value.trim();
    const hours = parseFloat(hoursEl.value) || 0;
    if (!text) return;

    const parcelId = (type === 'huerto') ? state.currentHuertoParcela : state.currentOlivarParcela;
    if (!state[type].tareas[parcelId]) state[type].tareas[parcelId] = [];

    const newTask = {
        id: Date.now(),
        text: text,
        hours: hours,
        done: false
    };

    state[type].tareas[parcelId].push(newTask);
    inputEl.value = '';
    hoursEl.value = '';
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

function editTask(taskId, type, parcelId) {
    const list = state[type].tareas[parcelId] || [];
    const t = list.find(task => task.id === taskId);
    if (t) {
        const newText = prompt("Editar tarea:", t.text);
        if (newText !== null && newText.trim() !== '') {
            t.text = newText.trim();
            const newHours = prompt("Horas empleadas (opcional):", t.hours || 0);
            if (newHours !== null) {
                t.hours = parseFloat(newHours) || 0;
            }
            saveState();
            renderTasks(type, parcelId);
            showToast("Tarea actualizada", "success");
        }
    }
}

function updateGlobalSettings() {
    const val = parseFloat(document.getElementById('global-labor-cost').value);
    if (!isNaN(val) && val >= 0) {
        state.globalSettings.laborCostPerHour = val;
        saveState();
        showToast("Ajustes de empresa actualizados", "success");
    }
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
            <div class="item-info-line">Descontado: <span>${t.amount} ${t.unit || 'ud'}</span></div>
            <div class="item-info-line" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--border-color);">
                ${safetyText}
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                <button class="btn btn-warning" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="openEditTreatmentModal(${t.id}, '${type}', '${parcelId}')">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="btn btn-danger" style="width: auto; padding: 6px 10px; font-size: 0.75rem; border-radius: 8px;" onclick="deleteTreatment(${t.id}, '${type}', '${parcelId}')">
                    <i class="ph ph-trash"></i>
                </button>
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

    document.getElementById('modal-apply-treatment').querySelector('.sheet-title').innerText = 'Registrar Tratamiento';
    document.getElementById('treatment-id').value = '';
    document.getElementById('treatment-type').value = type;
    document.getElementById('treatment-date').value = getTodayString();
    document.getElementById('treatment-amount').value = 1;
    document.getElementById('treatment-safety-days').value = 0;
    document.getElementById('treatment-dose').value = '';
    
    openModal('modal-apply-treatment');
}

function openEditTreatmentModal(treatmentId, type, parcelId) {
    const list = state[type].tratamientos[parcelId] || [];
    const t = list.find(tr => tr.id === treatmentId);
    if (!t) return;

    // Populate products select with options
    const select = document.getElementById('treatment-product');
    select.innerHTML = '';
    
    const availableProducts = state.almacen.filter(p => p.stock > 0 || p.id === t.productId || p.name === t.productName);

    availableProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Stock: ${p.stock.toFixed(1)} ${p.unit || 'ud'})`;
        select.appendChild(opt);
    });

    const typeGroup = document.getElementById('treatment-type-group');
    if (typeGroup) typeGroup.style.display = 'none';

    document.getElementById('modal-apply-treatment').querySelector('.sheet-title').innerText = 'Editar Tratamiento';
    document.getElementById('treatment-id').value = t.id;
    document.getElementById('treatment-type').value = type;
    document.getElementById('treatment-date').value = t.date;
    document.getElementById('treatment-amount').value = t.amount;
    document.getElementById('treatment-safety-days').value = t.safetyDays;
    document.getElementById('treatment-dose').value = t.dose;
    
    // Select the correct product
    if (t.productId) {
        select.value = t.productId;
    } else {
        const matchingProd = availableProducts.find(p => p.name === t.productName);
        if (matchingProd) select.value = matchingProd.id;
    }
    
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
    const idField = document.getElementById('treatment-id').value;
    const type = document.getElementById('treatment-type').value;
    const parcelId = (type === 'huerto') ? state.currentHuertoParcela : state.currentOlivarParcela;
    const productId = parseInt(document.getElementById('treatment-product').value);
    const dose = document.getElementById('treatment-dose').value;
    const amount = parseFloat(document.getElementById('treatment-amount').value) || 0;
    const safetyDays = parseInt(document.getElementById('treatment-safety-days').value) || 0;
    const dateVal = document.getElementById('treatment-date').value;

    const prod = state.almacen.find(p => p.id === productId);
    if (!prod) return;

    if (!state[type].tratamientos[parcelId]) state[type].tratamientos[parcelId] = [];
    const list = state[type].tratamientos[parcelId];

    if (idField) {
        // Edit mode
        const t = list.find(tr => tr.id === parseInt(idField));
        if (t) {
            // Adjust stock difference
            const amountDiff = amount - t.amount;
            if (prod.stock < amountDiff) {
                showToast("Error: No hay suficiente stock en almacén para este incremento", "error");
                return;
            }
            prod.stock -= amountDiff;

            t.productId = productId;
            t.productName = prod.name;
            t.unit = prod.unit || 'ud';
            t.date = dateVal;
            t.dose = dose;
            t.amount = amount;
            t.safetyDays = safetyDays;
            t.expiresAt = addDays(dateVal, safetyDays);
            showToast("Tratamiento actualizado", "success");
        }
    } else {
        // Add mode
        if (prod.stock < amount) {
            showToast("Error: No hay suficiente stock en almacén", "error");
            return;
        }
        prod.stock -= amount;
        const expDate = addDays(dateVal, safetyDays);

        const newTreatment = {
            id: Date.now(),
            productId: productId,
            productName: prod.name,
            unit: prod.unit || 'ud',
            date: dateVal,
            dose: dose,
            amount: amount,
            safetyDays: safetyDays,
            expiresAt: expDate
        };
        list.push(newTreatment);

        const noteText = `Tratamiento aplicado en ${state[type].parcelas[parcelId]}: ${prod.name} (Dosis: ${dose}, Plazo de seguridad: ${safetyDays} días).`;
        state.diario.push({
            id: Date.now() + 1,
            text: noteText,
            date: `${dateVal} ${getNowTimeString()}`,
            photo: MOCK_PHOTOS.olivar.url
        });
        showToast("Tratamiento registrado y stock descontado", "success");
    }

    saveState();
    closeModal('modal-apply-treatment');
    document.getElementById('modal-apply-treatment').querySelector('form').reset();
    document.getElementById('treatment-id').value = '';
    renderCampo();
    if (state.currentView === 'calendario') renderCalendar();
}

function deleteTreatment(treatmentId, type, parcelId) {
    if (confirm("¿Estás seguro de que quieres eliminar este tratamiento?")) {
        const list = state[type].tratamientos[parcelId] || [];
        const t = list.find(tr => tr.id === treatmentId);
        if (t) {
            if (!confirm(`¿Se llegó a gastar el producto realmente?\n\nAceptar: SÍ se gastó (No recuperar stock)\nCancelar: NO se gastó / Error (Devolver ${t.amount} ${t.unit || 'ud'} al almacén)`)) {
                const prod = state.almacen.find(p => p.id === t.productId || p.name === t.productName);
                if (prod) {
                    prod.stock += t.amount;
                    showToast("Stock devuelto al almacén", "info");
                }
            }
            state[type].tratamientos[parcelId] = list.filter(tr => tr.id !== treatmentId);
            saveState();
            renderCampo();
            showToast("Tratamiento eliminado", "info");
        }
    }
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
    if (typeof renderHuertoHarvestHistory === 'function') renderHuertoHarvestHistory();
    showToast("Cosecha registrada en el diario", "success");
}

function renderHuertoHarvestHistory() {
    const listEl = document.getElementById('huerto-harvest-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!state.huerto.cosechas) state.huerto.cosechas = [];
    const list = state.huerto.cosechas.filter(c => c.parcela === state.currentHuertoParcela);

    if (list.length === 0) {
        listEl.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted); text-align: center; display: block; padding: 10px;">No hay cosechas registradas en esta parcela.</span>`;
        return;
    }

    list.slice().reverse().forEach(c => {
        const item = document.createElement('div');
        item.className = "item-card";
        item.style.padding = "8px 12px";
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color: var(--primary);">${escapeHTML(c.product)}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted);">${c.date}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                <span style="font-size:0.85rem; color:var(--text-secondary);">Cantidad: <strong style="color:var(--text-primary);">${c.count} uds</strong></span>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary" style="width: auto; padding: 4px 8px; font-size: 0.7rem; border-radius: 6px;" onclick="showTraceabilityQR(${c.id}, 'huerto')">
                        <i class="ph ph-qr-code"></i> Ver QR
                    </button>
                    <button class="btn btn-danger" style="width: auto; padding: 4px 8px; font-size: 0.7rem; border-radius: 6px;" onclick="deleteHuertoHarvest(${c.id})">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
        listEl.appendChild(item);
    });
}

function deleteHuertoHarvest(harvestId) {
    if (confirm("¿Estás seguro de que quieres eliminar este registro de cosecha?")) {
        state.huerto.cosechas = state.huerto.cosechas.filter(c => c.id !== harvestId);
        saveState();
        renderHuertoHarvestHistory();
        showToast("Registro de cosecha eliminado", "info");
    }
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
        text: `Registrada cosecha de aceituna en ${state.olivar.parcelas[parcelId]}: ${kg} Kg con un ${yieldVal}% de rendimiento (${oil} L de aceite).`,
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
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color: var(--text-secondary); gap: 10px;">
                    <span>Rendimiento: <strong>${c.yield}%</strong></span>
                    <span>Aceite: <strong style="color:var(--text-primary);">${c.oil.toLocaleString()} L</strong></span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary" style="width: auto; padding: 4px 8px; font-size: 0.7rem; border-radius: 6px;" onclick="showTraceabilityQR(${c.id}, 'olivar')">
                        <i class="ph ph-qr-code"></i> Ver QR
                    </button>
                    <button class="btn btn-danger" style="width: auto; padding: 4px 8px; font-size: 0.7rem; border-radius: 6px;" onclick="deleteOlivarHarvest(${c.id})">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// --- TRAZABILIDAD (QR) ---
function showTraceabilityQR(harvestId, type) {
    try {
        const container = document.getElementById('qr-code-container');
        const infoText = document.getElementById('qr-info-text');
        if (!container || !infoText) {
            showToast("Error: Contenedores de QR no encontrados", "error");
            return;
        }
        container.innerHTML = '';
        
        let c = null;
        let parcelaName = '';
        let details = '';

        if (type === 'huerto') {
            if (state.huerto && state.huerto.cosechas) {
                c = state.huerto.cosechas.find(x => String(x.id) === String(harvestId));
            }
            if (c) {
                parcelaName = state.huerto.parcelas[c.parcela] || 'Parcela Desconocida';
                details = `Producto: ${c.product}\nCantidad: ${c.count} uds`;
            }
        } else {
            if (state.olivar && state.olivar.cosechas) {
                c = state.olivar.cosechas.find(x => String(x.id) === String(harvestId));
            }
            if (c) {
                parcelaName = state.olivar.parcelas[c.parcela] || 'Finca Desconocida';
                details = `Aceite: ${c.oil} L\nAceituna: ${c.kg} Kg\nRendimiento: ${c.yield}%`;
            }
        }

        if (!c) {
            showToast("No se encontró el registro de cosecha correspondiente", "error");
            return;
        }

        // Build a clean string to be encoded in the QR code (no emojis, for maximum compatibility with all scanner apps)
        const qrData = `Cuaderno de Campo\nOrigen: ${parcelaName}\nFecha: ${c.date}\n${details}\nTrazabilidad: Cultivo 100% Trazable`;

        // Build a visual string with emojis to show below the QR in the UI
        const displayData = `🚜 Cuaderno de Campo\n📍 Origen: ${parcelaName}\n📅 Fecha: ${c.date}\n📦 ${details}\n✅ Cultivo 100% Trazable`;

        if (typeof QRious === 'undefined') {
            throw new ReferenceError("La librería QRious no está cargada. Por favor, forzar la recarga de la app.");
        }

        // Generate the QR code using the QRious instance locally
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);
        new QRious({
            element: canvas,
            value: qrData,
            size: 220,
            padding: 12,
            background: '#ffffff',
            foreground: '#1a1a1a',
            level: 'L'
        });

        // Also show it as text below the QR for the user
        infoText.innerText = displayData;

        openModal('modal-qr-view');
    } catch (err) {
        console.error("Error al generar el QR:", err);
        showToast("Error al generar QR: " + err.message, "error");
    }
}

function printQRLabel() {
    try {
        const canvas = document.querySelector('#qr-code-container canvas');
        const infoText = document.getElementById('qr-info-text');
        
        if (!canvas) {
            showToast("No hay ningún código QR para imprimir", "error");
            return;
        }

        const qrImageUrl = canvas.toDataURL("image/png");
        const textContent = infoText ? infoText.innerText : '';
        
        // Clean formatting of the lines for the label (with proper escaping)
        const lines = textContent.split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => `<div class="label-line">${escapeHTML(line)}</div>`)
            .join('');

        const labelHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Etiqueta de Trazabilidad</title>
                <style>
                    @page {
                        size: auto;
                        margin: 0;
                    }
                    body {
                        font-family: 'Montserrat', Arial, sans-serif;
                        margin: 0;
                        padding: 15px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background-color: #ffffff;
                    }
                    .label-card {
                        border: 2px solid #1a1a1a;
                        border-radius: 8px;
                        padding: 15px;
                        width: 280px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        background-color: #ffffff;
                        box-sizing: border-box;
                    }
                    .info-title {
                        font-size: 13px;
                        font-weight: 800;
                        text-transform: uppercase;
                        margin-bottom: 12px;
                        border-bottom: 2px solid #1a1a1a;
                        padding-bottom: 4px;
                        width: 100%;
                        text-align: center;
                        letter-spacing: 0.5px;
                    }
                    .qr-img {
                        width: 180px;
                        height: 180px;
                        margin-bottom: 12px;
                    }
                    .info-details {
                        font-size: 10px;
                        color: #1a1a1a;
                        text-align: left;
                        width: 100%;
                        line-height: 1.5;
                        font-weight: 600;
                        border-top: 1px dashed #ccc;
                        padding-top: 8px;
                    }
                    .label-line {
                        margin-bottom: 3px;
                    }
                </style>
            </head>
            <body>
                <div class="label-card">
                    <div class="info-title">🚜 Trazabilidad de Cultivo</div>
                    <img class="qr-img" src="${qrImageUrl}" alt="Código QR de Trazabilidad">
                    <div class="info-details">
                        ${lines}
                    </div>
                </div>
                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    }
                <\/script>
            </body>
            </html>
        `;

        const printWin = window.open('', '_blank', 'width=450,height=550');
        if (printWin) {
            printWin.document.write(labelHTML);
            printWin.document.close();
            printWin.focus();
        } else {
            showToast('Activa las ventanas emergentes para poder imprimir la etiqueta', 'error');
        }
    } catch (err) {
        console.error("Error al imprimir la etiqueta:", err);
        showToast("Error al imprimir: " + err.message, "error");
    }
}

// ==========================================
// IMPRESIÓN BLUETOOTH (IMPRESORAS TÉRMICAS BLE - PROTOCOLO 0x5178)
// ==========================================

const BLE_CHECKSUM_TABLE = new Uint8Array([
    0, 7, 14, 9, 28, 27, 18, 21, 56, 63, 54, 49, 36, 35, 42, 45, 112, 119, 126, 121,
    108, 107, 98, 101, 72, 79, 70, 65, 84, 83, 90, 93, 224, 231, 238, 233, 252, 251,
    242, 245, 216, 223, 214, 209, 196, 195, 202, 205, 144, 151, 158, 153, 140, 139,
    130, 133, 168, 175, 166, 161, 180, 179, 186, 189, 199, 192, 201, 206, 219, 220,
    213, 210, 255, 248, 241, 246, 227, 228, 237, 234, 183, 180, 185, 190, 171, 172,
    165, 166, 143, 136, 129, 134, 147, 148, 157, 154, 39, 32, 41, 46, 59, 60, 53, 50,
    31, 24, 17, 22, 3, 4, 13, 10, 87, 80, 89, 94, 75, 76, 69, 66, 111, 104, 97, 102,
    115, 116, 125, 122, 137, 142, 135, 128, 149, 146, 155, 156, 177, 182, 191, 184,
    173, 170, 163, 164, 249, 254, 247, 240, 229, 226, 235, 236, 193, 198, 207, 200,
    221, 218, 211, 212, 105, 110, 103, 96, 117, 114, 123, 124, 81, 86, 95, 88, 77,
    74, 67, 68, 25, 30, 23, 16, 5, 2, 11, 12, 33, 38, 47, 40, 61, 58, 51, 52, 78, 73,
    64, 71, 82, 85, 92, 91, 118, 113, 120, 127, 106, 109, 100, 99, 62, 57, 48, 55,
    34, 37, 44, 43, 6, 1, 8, 15, 26, 29, 20, 19, 174, 169, 160, 167, 178, 181, 188,
    189, 150, 145, 152, 159, 138, 141, 132, 133, 222, 217, 208, 215, 194, 197, 204,
    205, 230, 225, 232, 239, 250, 253, 244, 245
]);

function bleChkSum(arr, start, len) {
    let crc = 0;
    for (let i = start; i < start + len; i++) {
        crc = BLE_CHECKSUM_TABLE[(crc ^ arr[i]) & 0xff];
    }
    return crc;
}

function bleEncodeRunLengthRepetition(n, val) {
    const res = [];
    while (n > 0x7f) {
        res.push(0x7f | (val << 7));
        n -= 0x7f;
    }
    if (n > 0) {
        res.push((val << 7) | n);
    }
    return res;
}

function bleRunLengthEncode(imgRow) {
    const res = [];
    let count = 0;
    let lastVal = -1;
    for (let i = 0; i < imgRow.length; i++) {
        const val = imgRow[i];
        if (val === lastVal) {
            count++;
        } else {
            if (count > 0) {
                res.push(...bleEncodeRunLengthRepetition(count, lastVal));
            }
            count = 1;
        }
        lastVal = val;
    }
    if (count > 0) {
        res.push(...bleEncodeRunLengthRepetition(count, lastVal));
    }
    return res;
}

function bleByteEncode(imgRow) {
    const res = [];
    for (let chunkStart = 0; chunkStart < imgRow.length; chunkStart += 8) {
        let byteVal = 0;
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
            if (imgRow[chunkStart + bitIdx]) {
                byteVal |= (1 << bitIdx);
            }
        }
        res.push(byteVal);
    }
    return res;
}

function bleCmdPrintRow(imgRow) {
    const encodedImg = bleRunLengthEncode(imgRow);
    
    if (encodedImg.length > 48) { // 384 / 8 = 48
        const byteEncoded = bleByteEncode(imgRow);
        const arr = new Uint8Array(8 + byteEncoded.length);
        arr[0] = 0x51;
        arr[1] = 0x78;
        arr[2] = 0xa2; // Command.Bitmap
        arr[3] = 0x00; // Type
        arr[4] = byteEncoded.length & 0xff;
        arr[5] = (byteEncoded.length >> 8) & 0xff;
        arr.set(byteEncoded, 6);
        arr[6 + byteEncoded.length] = bleChkSum(arr, 6, byteEncoded.length);
        arr[7 + byteEncoded.length] = 0xff;
        return arr;
    } else {
        const arr = new Uint8Array(8 + encodedImg.length);
        arr[0] = 0x51;
        arr[1] = 0x78;
        arr[2] = 0xbf; // Command.BitmapRLE
        arr[3] = 0x00; // Type
        arr[4] = encodedImg.length & 0xff;
        arr[5] = (encodedImg.length >> 8) & 0xff;
        arr.set(encodedImg, 6);
        arr[6 + encodedImg.length] = bleChkSum(arr, 6, encodedImg.length);
        arr[7 + encodedImg.length] = 0xff;
        return arr;
    }
}

function bleCmdFeedPaper(howMuch) {
    const arr = new Uint8Array([0x51, 0x78, 0xbd, 0x00, 0x01, 0x00, howMuch & 0xff, 0x00, 0xff]);
    arr[7] = bleChkSum(arr, 6, 1);
    return arr;
}

function bleCmdSetEnergy(val) {
    const arr = new Uint8Array([0x51, 0x78, 0xaf, 0x00, 0x02, 0x00, (val >> 8) & 0xff, val & 0xff, 0x00, 0xff]);
    arr[8] = bleChkSum(arr, 6, 2);
    return arr;
}

function bleCmdApplyEnergy() {
    const arr = new Uint8Array([0x51, 0x78, 0xbe, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff]);
    arr[7] = bleChkSum(arr, 6, 1);
    return arr;
}

function bleGetCanvasRowPixels(ctx, y, width) {
    const imgData = ctx.getImageData(0, y, width, 1).data;
    const row = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
        const r = imgData[x * 4];
        const g = imgData[x * 4 + 1];
        const b = imgData[x * 4 + 2];
        const a = imgData[x * 4 + 3];
        const isBlack = (a > 50) && ((r + g + b) / 3 < 128);
        row[x] = isBlack ? 1 : 0;
    }
    return row;
}

function bleRenderStickerToCanvas(qrCanvas, textContent) {
    const width = 384;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = 1000;
    const ctx = tempCanvas.getContext('2d');
    
    // Fill background white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, tempCanvas.height);
    
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    
    let y = 30;
    
    // Title
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText('CUADERNO DE CAMPO', width / 2, y);
    y += 22;
    
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText('Trazabilidad de Cosecha', width / 2, y);
    y += 18;
    
    // Divider
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(25, y);
    ctx.lineTo(width - 25, y);
    ctx.stroke();
    y += 25;
    
    // Draw QR Code
    const qrSize = 220;
    const qrX = (width - qrSize) / 2;
    ctx.drawImage(qrCanvas, qrX, y, qrSize, qrSize);
    y += qrSize + 25;
    
    // Divider (Dashed)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(25, y);
    ctx.lineTo(width - 25, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 20;
    
    // Details
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px Arial, sans-serif';
    
    const lines = textContent.split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.replace(/🚜|📍|📅|📦|✅/g, '').trim()); // Clean emojis
        
    for (const line of lines) {
        const words = line.split(' ');
        let currentLine = '';
        const maxWidth = width - 50;
        const marginLeft = 25;
        
        for (let n = 0; n < words.length; n++) {
            const testLine = currentLine + words[n] + ' ';
            const testWidth = ctx.measureText(testLine).width;
            if (testWidth > maxWidth && n > 0) {
                ctx.fillText(currentLine, marginLeft, y);
                currentLine = words[n] + ' ';
                y += 18;
            } else {
                currentLine = testLine;
            }
        }
        ctx.fillText(currentLine, marginLeft, y);
        y += 20;
    }
    
    y += 30; // bottom spacing
    
    // Crop to final height y
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = width;
    finalCanvas.height = y;
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.drawImage(tempCanvas, 0, 0, width, y, 0, 0, width, y);
    
    // Draw thick outer border
    finalCtx.strokeStyle = '#000000';
    finalCtx.lineWidth = 4;
    finalCtx.strokeRect(6, 6, width - 12, y - 12);
    
    return finalCanvas;
}

function updateBlePrintStatus(text, type) {
    const statusDiv = document.getElementById('ble-print-status');
    if (!statusDiv) return;
    
    statusDiv.style.display = 'block';
    statusDiv.innerText = text;
    
    if (type === 'error') {
        statusDiv.style.backgroundColor = '#fee2e2';
        statusDiv.style.color = '#991b1b';
        statusDiv.style.border = '1px solid #fca5a5';
    } else if (type === 'success') {
        statusDiv.style.backgroundColor = '#d1fae5';
        statusDiv.style.color = '#065f46';
        statusDiv.style.border = '1px solid #6ee7b7';
    } else { // info
        statusDiv.style.backgroundColor = '#eff6ff';
        statusDiv.style.color = '#1e40af';
        statusDiv.style.border = '1px solid #93c5fd';
    }
}

async function printQRLabelBluetooth() {
    const statusDiv = document.getElementById('ble-print-status');
    if (statusDiv) statusDiv.style.display = 'none';

    if (!navigator.bluetooth) {
        updateBlePrintStatus("Web Bluetooth no está soportado en este navegador. Utiliza Google Chrome en Android/PC/Mac, o navegadores Web Bluetooth dedicados en iOS (como Bluefy).", "error");
        return;
    }

    const qrCanvas = document.querySelector('#qr-code-container canvas');
    const infoText = document.getElementById('qr-info-text');
    
    if (!qrCanvas) {
        showToast("No hay ningún código QR para imprimir", "error");
        return;
    }

    const textContent = infoText ? infoText.innerText : '';
    let gattServer = null;

    try {
        updateBlePrintStatus("Buscando impresora Bluetooth...", "info");
        
        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: 'MX' },
                { namePrefix: 'GB' },
                { namePrefix: 'BP' },
                { namePrefix: 'GT' },
                { namePrefix: 'TP' },
                { namePrefix: 'FP' },
                { namePrefix: 'Fun' },
                { services: ['0000ae30-0000-1000-8000-00805f9b34fb'] }
            ],
            optionalServices: [
                '0000ae30-0000-1000-8000-00805f9b34fb',
                '0000fee7-0000-1000-8000-00805f9b34fb'
            ]
        });

        updateBlePrintStatus(`Conectando a ${device.name || 'Impresora'}...`, "info");
        
        gattServer = await device.gatt.connect();
        
        updateBlePrintStatus("Buscando canal de impresión...", "info");
        
        let service;
        let characteristic;
        try {
            service = await gattServer.getPrimaryService('0000ae30-0000-1000-8000-00805f9b34fb');
            characteristic = await service.getCharacteristic('0000ae01-0000-1000-8000-00805f9b34fb');
        } catch (e) {
            console.log("Servicio ae30 no encontrado, probando alternativo fee7...");
            service = await gattServer.getPrimaryService('0000fee7-0000-1000-8000-00805f9b34fb');
            characteristic = await service.getCharacteristic('0000fee9-0000-1000-8000-00805f9b34fb');
        }

        updateBlePrintStatus("Preparando diseño de pegatina...", "info");

        const stickerCanvas = bleRenderStickerToCanvas(qrCanvas, textContent);
        const ctx = stickerCanvas.getContext('2d');
        const height = stickerCanvas.height;

        updateBlePrintStatus("Generando comandos de impresión...", "info");

        // Fixed/constant control arrays
        const CMD_GET_DEV_STATE = new Uint8Array([0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff]);
        CMD_GET_DEV_STATE[7] = bleChkSum(CMD_GET_DEV_STATE, 6, 1);

        const CMD_SET_QUALITY_200_DPI = new Uint8Array([0x51, 0x78, 0xa4, 0x00, 0x01, 0x00, 0x32, 0x9e, 0xff]);
        const CMD_LATTICE_START = new Uint8Array([0x51, 0x78, 0xa6, 0x00, 0x0b, 0x00, 0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c, 0xa1, 0xff]);
        const CMD_LATTICE_END = new Uint8Array([0x51, 0x78, 0xa6, 0x00, 0x0b, 0x00, 0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x11, 0xff]);
        const CMD_SET_PAPER = new Uint8Array([0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x30, 0x00, 0xf9, 0xff]);

        const cmdList = [];
        cmdList.push(...CMD_GET_DEV_STATE);
        cmdList.push(...CMD_SET_QUALITY_200_DPI);
        cmdList.push(...bleCmdSetEnergy(0xffff)); // Maximum heat/contrast
        cmdList.push(...bleCmdApplyEnergy());
        cmdList.push(...CMD_LATTICE_START);

        // Render rows and generate commands
        for (let y = 0; y < height; y++) {
            const rowPixels = bleGetCanvasRowPixels(ctx, y, 384);
            const rowCmd = bleCmdPrintRow(rowPixels);
            cmdList.push(...rowCmd);
        }

        // Finishing and feed
        cmdList.push(...bleCmdFeedPaper(60));
        cmdList.push(...CMD_SET_PAPER);
        cmdList.push(...CMD_SET_PAPER);
        cmdList.push(...CMD_SET_PAPER);
        cmdList.push(...CMD_LATTICE_END);
        cmdList.push(...CMD_GET_DEV_STATE);

        const printBuffer = new Uint8Array(cmdList);
        const totalSize = printBuffer.length;
        
        updateBlePrintStatus("Enviando datos (0%)...", "info");

        const chunkSize = 100;
        const delayMs = 15;
        for (let offset = 0; offset < totalSize; offset += chunkSize) {
            const chunk = printBuffer.slice(offset, offset + chunkSize);
            if (characteristic.writeValueWithoutResponse) {
                await characteristic.writeValueWithoutResponse(chunk);
            } else {
                await characteristic.writeValue(chunk);
            }
            const progress = Math.min(100, Math.round(((offset + chunk.length) / totalSize) * 100));
            updateBlePrintStatus(`Enviando datos (${progress}%)...`, "info");
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        updateBlePrintStatus("¡Impresión completada!", "success");
        showToast("¡Etiqueta impresa con éxito!", "success");
    } catch (err) {
        console.error("Error al imprimir por Bluetooth:", err);
        updateBlePrintStatus("Error: " + err.message, "error");
        showToast("Error Bluetooth: " + err.message, "error");
    } finally {
        if (gattServer && gattServer.connected) {
            gattServer.disconnect();
        }
    }
}

function deleteOlivarHarvest(harvestId) {
    if (confirm("¿Estás seguro de que quieres eliminar este registro de cosecha de aceituna?")) {
        state.olivar.cosechas = state.olivar.cosechas.filter(c => c.id !== harvestId);
        saveState();
        renderOlivarHarvestHistory();
        showToast("Registro de cosecha eliminado", "info");
    }
}

// --- MAPA INTERACTIVO (LEAFLET) ---
let leafletMap = null;
let currentPolygon = null;
let drawnPolygons = {}; // parcelId -> polygon layer
let isDrawingMode = false;
let currentDrawingPoints = [];

function renderCroquis() {
    // We repurpose this function name for the init logic since it's called by navigation
    initLeafletMap();
}

function initLeafletMap() {
    const select = document.getElementById('map-parcela-select');
    if (!select) return;

    // Populate select
    select.innerHTML = '';
    const huertoKeys = Object.keys(state.huerto.parcelas);
    const olivarKeys = Object.keys(state.olivar.parcelas);
    
    huertoKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `Huerto: ${state.huerto.parcelas[k]}`;
        select.appendChild(opt);
    });

    olivarKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `Olivar: ${state.olivar.parcelas[k]}`;
        select.appendChild(opt);
    });

    // Init Map only once
    if (!leafletMap) {
        // Default center (Spain)
        leafletMap = L.map('map-container').setView([39.0, -2.0], 6);
        
        // Use Esri World Imagery (Satellite)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }).addTo(leafletMap);
        
        // Load saved polygons from state
        if (!state.mapPolygons) state.mapPolygons = {};
        
        // Click to draw logic
        leafletMap.on('click', function(e) {
            if (!isDrawingMode) return;
            currentDrawingPoints.push([e.latlng.lat, e.latlng.lng]);
            
            if (currentPolygon) {
                leafletMap.removeLayer(currentPolygon);
            }
            
            currentPolygon = L.polygon(currentDrawingPoints, {color: '#4caf50', weight: 3}).addTo(leafletMap);
        });

        // Delay invalidation size to ensure DOM is ready
        setTimeout(() => {
            leafletMap.invalidateSize();
            drawSavedPolygons();
            centerMapOnParcel();
        }, 300);
    } else {
        leafletMap.invalidateSize();
        centerMapOnParcel();
    }
}

function startDrawingPolygon() {
    isDrawingMode = true;
    currentDrawingPoints = [];
    if (currentPolygon) {
        leafletMap.removeLayer(currentPolygon);
        currentPolygon = null;
    }
    showToast("Toca el mapa para dibujar los vértices", "info");
    document.getElementById('map-container').style.cursor = 'crosshair';
}

function clearCurrentPolygon() {
    isDrawingMode = false;
    currentDrawingPoints = [];
    if (currentPolygon) {
        leafletMap.removeLayer(currentPolygon);
        currentPolygon = null;
    }
    document.getElementById('map-container').style.cursor = '';
    showToast("Dibujo borrado", "info");
}

function saveMapPolygon() {
    const parcelId = document.getElementById('map-parcela-select').value;
    if (!parcelId) return;

    if (!isDrawingMode || currentDrawingPoints.length < 3) {
        showToast("Debes dibujar al menos 3 puntos", "error");
        return;
    }

    if (!state.mapPolygons) state.mapPolygons = {};
    state.mapPolygons[parcelId] = currentDrawingPoints;
    saveState();

    isDrawingMode = false;
    document.getElementById('map-container').style.cursor = '';
    showToast("Polígono guardado", "success");
    drawSavedPolygons();
}

function drawSavedPolygons() {
    if (!state.mapPolygons) return;
    
    // Clear old layers
    Object.values(drawnPolygons).forEach(layer => leafletMap.removeLayer(layer));
    drawnPolygons = {};

    Object.keys(state.mapPolygons).forEach(parcelId => {
        const points = state.mapPolygons[parcelId];
        if (points && points.length >= 3) {
            const polygon = L.polygon(points, {color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.3}).addTo(leafletMap);
            polygon.bindTooltip(parcelId.startsWith('huerto') ? state.huerto.parcelas[parcelId] : state.olivar.parcelas[parcelId]);
            drawnPolygons[parcelId] = polygon;
        }
    });
}

function centerMapOnParcel() {
    const parcelId = document.getElementById('map-parcela-select').value;
    if (!state.mapPolygons || !state.mapPolygons[parcelId]) {
        showToast("No hay polígono guardado para esta parcela", "info");
        return;
    }
    const polygon = drawnPolygons[parcelId];
    if (polygon) {
        leafletMap.fitBounds(polygon.getBounds());
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

// --- AI DIAGNOSIS ---
function analyzeImageWithAI(event) {
    const file = event.target.files[0];
    if (!file) return;

    // UI Updates
    document.getElementById('ai-upload-section').classList.add('hidden');
    document.getElementById('ai-loading-section').classList.remove('hidden');
    document.getElementById('ai-result-section').classList.add('hidden');

    // Simulate AI processing time (e.g. 2.5 seconds)
    setTimeout(() => {
        document.getElementById('ai-loading-section').classList.add('hidden');
        document.getElementById('ai-result-section').classList.remove('hidden');

        // Mock AI Result based on random probability for demo purposes
        const rand = Math.random();
        const titleEl = document.getElementById('ai-result-title');
        const descEl = document.getElementById('ai-result-desc');

        if (rand > 0.6) {
            titleEl.innerText = "Planta Sana (92% Confianza)";
            titleEl.style.color = "var(--primary)";
            descEl.innerText = "No se han detectado signos visibles de plagas o enfermedades en la imagen proporcionada. Se recomienda continuar con el cuidado habitual.";
        } else if (rand > 0.3) {
            titleEl.innerText = "Posible Oídio (78% Confianza)";
            titleEl.style.color = "var(--warning)";
            descEl.innerText = "Se aprecian manchas polvorientas blancas. Recomendamos aplicar un tratamiento fungicida a base de azufre preventivo.";
        } else {
            titleEl.innerText = "Ataque de Pulgón (85% Confianza)";
            titleEl.style.color = "var(--danger)";
            descEl.innerText = "Detectada presencia de pulgones en las hojas. Recomendamos tratar con jabón potásico o insecticida específico urgentemente.";
        }
    }, 2500);
}
let photoCycleIndex = 0;
const photosKeys = Object.keys(MOCK_PHOTOS);

function handleRealPhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Compress the image using canvas
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const MAX_HEIGHT = 800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Get base64 string
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            state.selectedRealPhoto = dataUrl;

            // UI update
            const previewContainer = document.getElementById('photo-preview-container');
            const previewImg = document.getElementById('photo-preview-img');
            const textEl = document.getElementById('photo-upload-text');

            previewImg.src = dataUrl;
            previewContainer.classList.remove('hidden');
            textEl.innerHTML = `<i class="ph ph-check-circle"></i> Foto adjuntada`;
            showToast("Foto cargada correctamente", "success");
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
        photo: state.selectedRealPhoto || null
    };

    state.diario.push(newEntry);
    
    saveState();
    
    // UI feedback
    textEl.value = '';
    state.selectedRealPhoto = null;
    document.getElementById('photo-preview-container').classList.add('hidden');
    document.getElementById('photo-preview-img').src = '';
    document.getElementById('photo-upload-text').innerText = 'Tomar o subir foto';
    document.getElementById('real-photo-input').value = '';

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
    
    // Reset specific modals
    if (modalId === 'modal-ai-diagnosis') {
        const uploadSec = document.getElementById('ai-upload-section');
        const loadSec = document.getElementById('ai-loading-section');
        const resSec = document.getElementById('ai-result-section');
        const input = document.getElementById('ai-photo-input');
        
        if (uploadSec) uploadSec.classList.remove('hidden');
        if (loadSec) loadSec.classList.add('hidden');
        if (resSec) resSec.classList.add('hidden');
        if (input) input.value = '';
    }
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

    const phases = [
        { limit: 1.85, emoji: '🌑', name: 'Luna Nueva', tip: 'Poda y siembra de raíz.' },
        { limit: 7.38, emoji: '🌒', name: 'Cuarto Creciente', tip: 'Buena para sembrar plantas de fruto.' },
        { limit: 14.77, emoji: '🌓', name: 'Luna Creciente', tip: 'Ideal para injertar y trasplantar.' },
        { limit: 16.61, emoji: '🌕', name: 'Luna Llena', tip: 'Cosecha frutas, máxima concentración.' },
        { limit: 22.15, emoji: '🌖', name: 'Luna Menguante', tip: 'Podar, cortar leña, tratamientos fungicidas.' },
        { limit: 25.38, emoji: '🌗', name: 'Cuarto Menguante', tip: 'Abonado de fondo, laboreo del suelo.' },
        { limit: cycle, emoji: '🌘', name: 'Luna Menguante Final', tip: 'Preparar terreno y planificar siembras.' }
    ];

    let currentIdx = phases.findIndex(p => phase < p.limit);
    if (currentIdx === -1) currentIdx = phases.length - 1;

    const currentPhase = phases[currentIdx];
    const nextIdx = (currentIdx + 1) % phases.length;
    const nextPhase = phases[nextIdx];

    const daysLeft = Math.max(1, Math.ceil(currentPhase.limit - phase));
    let nextPhaseDuration = 0;
    if (nextIdx === 0) {
        nextPhaseDuration = Math.ceil(phases[0].limit);
    } else {
        nextPhaseDuration = Math.ceil(phases[nextIdx].limit - phases[nextIdx - 1].limit);
    }

    return { 
        emoji: currentPhase.emoji, 
        name: currentPhase.name, 
        illumination, 
        tip: currentPhase.tip, 
        phase: Math.round(phase * 10) / 10,
        daysLeft,
        nextPhaseName: nextPhase.name,
        nextPhaseDuration
    };
}

function renderLunarWidget() {
    const el = document.getElementById('lunar-widget');
    if (!el) return;
    const moon = getLunarPhase();
    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom: 8px;">
            <span style="font-size:2.8rem; line-height:1; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">${moon.emoji}</span>
            <div style="flex: 1;">
                <div style="font-size:1rem; font-weight:800; color:var(--text-primary);">${moon.name}</div>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom: 2px;">Iluminación: <strong>${moon.illumination}%</strong></div>
                <div style="font-size:0.75rem; color:var(--primary); font-style:italic; background: rgba(75, 96, 67, 0.05); padding: 4px 6px; border-radius: 4px;">💡 ${moon.tip}</div>
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 0.75rem; color:var(--text-muted); background: rgba(0,0,0,0.02); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color);">
            <span>Quedan <strong>${moon.daysLeft} ${moon.daysLeft === 1 ? 'día' : 'días'}</strong> para ${moon.nextPhaseName}</span>
            <span>(Durará ~${moon.nextPhaseDuration} días)</span>
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
                <div style="display:flex; flex-direction:column; background:rgba(76,201,240,0.05); border:1px solid rgba(76,201,240,0.15); border-radius:10px; padding:8px 12px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="font-size:0.8rem; font-weight:700; color:var(--text-primary);">${r.method}</span>
                            <span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">${r.date}</span>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:0.85rem; font-weight:800; color:#3b82f6;">${r.liters} L</span>
                            <span style="font-size:0.75rem; color:var(--text-muted); display:block;">⏱ ${r.minutes}</span>
                        </div>
                    </div>
                    ${r.notes ? `<div style="font-size:0.75rem; color:var(--text-primary); margin-top:6px; background:rgba(255,255,255,0.5); padding:4px 8px; border-radius:4px; font-style:italic;">💬 ${r.notes}</div>` : ''}
                    <div style="display: flex; gap: 4px; margin-top: 6px; justify-content: flex-end;">
                        <button class="btn btn-warning" style="width: auto; padding: 4px 6px; font-size: 0.7rem; border-radius: 6px;" onclick="openEditRiegoModal(${r.id}, '${type}', '${parcelId}')">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn btn-danger" style="width: auto; padding: 4px 6px; font-size: 0.7rem; border-radius: 6px;" onclick="deleteRiego(${r.id}, '${type}', '${parcelId}')">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
    }
    el.innerHTML = html;
}

function openAddRiegoModal(type, parcelId) {
    document.getElementById('modal-add-riego').querySelector('.sheet-title').innerText = 'Registrar Riego';
    document.getElementById('riego-id').value = '';
    document.getElementById('riego-type').value = type;
    document.getElementById('riego-parcela').value = parcelId;
    document.getElementById('riego-date').value = getTodayString();
    document.getElementById('riego-minutes').value = '';
    document.getElementById('riego-liters').value = '';
    document.getElementById('riego-method').value = 'Goteo';
    document.getElementById('riego-notes').value = '';
    openModal('modal-add-riego');
}

function openEditRiegoModal(riegoId, type, parcelId) {
    const list = state[type].riego[parcelId] || [];
    const r = list.find(ri => ri.id === riegoId);
    if (!r) return;

    document.getElementById('modal-add-riego').querySelector('.sheet-title').innerText = 'Editar Riego';
    document.getElementById('riego-id').value = r.id;
    document.getElementById('riego-type').value = type;
    document.getElementById('riego-parcela').value = parcelId;
    document.getElementById('riego-date').value = r.date;
    document.getElementById('riego-minutes').value = r.minutes.replace(' min', ''); // Handle possible " min" suffix
    document.getElementById('riego-liters').value = r.liters;
    document.getElementById('riego-method').value = r.method;
    document.getElementById('riego-notes').value = r.notes || '';
    
    openModal('modal-add-riego');
}

function saveRiego(e) {
    e.preventDefault();
    const idField = document.getElementById('riego-id').value;
    const type = document.getElementById('riego-type').value;
    const parcelId = document.getElementById('riego-parcela').value;
    const date = document.getElementById('riego-date').value;
    const minutes = document.getElementById('riego-minutes').value || '0 min';
    const liters = parseFloat(document.getElementById('riego-liters').value) || 0;
    const method = document.getElementById('riego-method').value;
    const notes = document.getElementById('riego-notes').value.trim();

    if (!state[type].riego) state[type].riego = {};
    if (!state[type].riego[parcelId]) state[type].riego[parcelId] = [];
    const list = state[type].riego[parcelId];

    if (idField) {
        const r = list.find(ri => ri.id === parseInt(idField));
        if (r) {
            r.date = date;
            r.minutes = minutes;
            r.liters = liters;
            r.method = method;
            r.notes = notes;
            showToast('Riego actualizado', 'success');
        }
    } else {
        list.push({ id: Date.now(), date, minutes, liters, method, notes });
        
        let diarioText = `Riego en ${state[type].parcelas[parcelId]}: ${liters}L por ${method.toLowerCase()} (Tiempo: ${minutes}).`;
        if (notes) diarioText += ` Observaciones: ${notes}`;

        state.diario.push({
            id: Date.now() + 1,
            text: diarioText,
            date: `${date} ${getNowTimeString()}`,
            photo: null
        });
        showToast('Riego registrado', 'success');
    }

    saveState();
    closeModal('modal-add-riego');
    document.getElementById('modal-add-riego').querySelector('form').reset();
    document.getElementById('riego-id').value = '';
    renderRiego(type, parcelId);
}

function deleteRiego(riegoId, type, parcelId) {
    if (confirm("¿Estás seguro de que quieres eliminar este riego?")) {
        const list = state[type].riego[parcelId] || [];
        state[type].riego[parcelId] = list.filter(ri => ri.id !== riegoId);
        saveState();
        renderRiego(type, parcelId);
        showToast("Riego eliminado", "info");
    }
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
                        <span style="font-size:0.8rem; font-weight:700; color:var(--primary-light);">${f.amount} ${f.unit || 'ud'}</span>
                        <span style="font-size:0.72rem; color:var(--text-muted); display:block;">${f.date}</span>
                        <div style="display: flex; gap: 4px; margin-top: 4px; justify-content: flex-end;">
                            <button class="btn btn-warning" style="width: auto; padding: 4px 6px; font-size: 0.7rem; border-radius: 6px;" onclick="openEditFertilizacionModal(${f.id}, '${type}', '${parcelId}')">
                                <i class="ph ph-pencil-simple"></i>
                            </button>
                            <button class="btn btn-danger" style="width: auto; padding: 4px 6px; font-size: 0.7rem; border-radius: 6px;" onclick="deleteFertilizacion(${f.id}, '${type}', '${parcelId}')">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
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
    document.getElementById('modal-add-fertilizacion').querySelector('.sheet-title').innerText = 'Registrar Fertilización';
    document.getElementById('fertilizacion-id').value = '';
    document.getElementById('fertilizacion-type').value = type;
    document.getElementById('fertilizacion-parcela').value = parcelId;
    document.getElementById('fertilizacion-date').value = getTodayString();
    document.getElementById('fertilizacion-amount').value = 1;
    document.getElementById('fertilizacion-tipo').value = 'Radicular';
    openModal('modal-add-fertilizacion');
}

function openEditFertilizacionModal(fertilizacionId, type, parcelId) {
    const list = state[type].fertilizaciones[parcelId] || [];
    const f = list.find(fe => fe.id === fertilizacionId);
    if (!f) return;

    const select = document.getElementById('fertilizacion-product');
    select.innerHTML = '';
    const abonos = state.almacen.filter(p => p.stock > 0 || p.id === f.productId || p.name === f.productName);
    
    abonos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Stock: ${p.stock.toFixed(1)} ${p.unit || 'ud'})`;
        select.appendChild(opt);
    });

    document.getElementById('modal-add-fertilizacion').querySelector('.sheet-title').innerText = 'Editar Fertilización';
    document.getElementById('fertilizacion-id').value = f.id;
    document.getElementById('fertilizacion-type').value = type;
    document.getElementById('fertilizacion-parcela').value = parcelId;
    document.getElementById('fertilizacion-date').value = f.date;
    document.getElementById('fertilizacion-amount').value = f.amount;
    document.getElementById('fertilizacion-tipo').value = f.tipoAbonado;
    
    if (f.productId) {
        select.value = f.productId;
    } else {
        const matchingProd = abonos.find(p => p.name === f.productName);
        if (matchingProd) select.value = matchingProd.id;
    }

    openModal('modal-add-fertilizacion');
}

function saveFertilizacion(e) {
    e.preventDefault();
    const idField = document.getElementById('fertilizacion-id').value;
    const type = document.getElementById('fertilizacion-type').value;
    const parcelId = document.getElementById('fertilizacion-parcela').value;
    const productId = parseInt(document.getElementById('fertilizacion-product').value);
    const amount = parseFloat(document.getElementById('fertilizacion-amount').value) || 0;
    const tipoAbonado = document.getElementById('fertilizacion-tipo').value;
    const date = document.getElementById('fertilizacion-date').value;

    const prod = state.almacen.find(p => p.id === productId);
    if (!prod) return;

    if (!state[type].fertilizaciones) state[type].fertilizaciones = {};
    if (!state[type].fertilizaciones[parcelId]) state[type].fertilizaciones[parcelId] = [];
    const list = state[type].fertilizaciones[parcelId];

    if (idField) {
        const f = list.find(fe => fe.id === parseInt(idField));
        if (f) {
            const amountDiff = amount - f.amount;
            if (prod.stock < amountDiff) {
                showToast('Stock insuficiente en almacén', 'error');
                return;
            }
            prod.stock -= amountDiff;

            f.productId = productId;
            f.productName = prod.name;
            f.unit = prod.unit || 'ud';
            f.amount = amount;
            f.tipoAbonado = tipoAbonado;
            f.date = date;
            showToast('Fertilización actualizada', 'success');
        }
    } else {
        if (prod.stock < amount) {
            showToast('Stock insuficiente en almacén', 'error');
            return;
        }
        prod.stock -= amount;

        list.push({
            id: Date.now(),
            productId: productId,
            productName: prod.name,
            unit: prod.unit || 'ud',
            amount,
            tipoAbonado,
            date
        });

        state.diario.push({
            id: Date.now() + 1,
            text: `Abonado en ${state[type].parcelas[parcelId]}: ${amount} ${prod.unit || 'uds'} de ${prod.name} (${tipoAbonado}).`,
            date: `${date} ${getNowTimeString()}`,
            photo: null
        });
        showToast('Abonado registrado y stock descontado', 'success');
    }

    saveState();
    closeModal('modal-add-fertilizacion');
    document.getElementById('modal-add-fertilizacion').querySelector('form').reset();
    document.getElementById('fertilizacion-id').value = '';
    renderFertilizaciones(type, parcelId);
}

function deleteFertilizacion(fertilizacionId, type, parcelId) {
    if (confirm("¿Estás seguro de que quieres eliminar esta fertilización?")) {
        const list = state[type].fertilizaciones[parcelId] || [];
        const f = list.find(fe => fe.id === fertilizacionId);
        if (f) {
            if (!confirm(`¿Se llegó a gastar el abono realmente?\n\nAceptar: SÍ se gastó (No recuperar stock)\nCancelar: NO se gastó / Error (Devolver ${f.amount} ${f.unit || 'ud'} al almacén)`)) {
                const prod = state.almacen.find(p => p.id === f.productId || p.name === f.productName);
                if (prod) {
                    prod.stock += f.amount;
                    showToast("Stock devuelto al almacén", "info");
                }
            }
            state[type].fertilizaciones[parcelId] = list.filter(fe => fe.id !== fertilizacionId);
            saveState();
            renderFertilizaciones(type, parcelId);
            showToast("Fertilización eliminada", "info");
        }
    }
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
                        <div style="display: flex; gap: 4px; margin-top: 4px;">
                            ${isDue ? `<button style="font-size:0.7rem; padding:3px 8px; border-radius:6px; border:none; background:var(--success); color:white; cursor:pointer; font-weight:700;" onclick="markPlagaReviewed(${a.id},'${type}','${parcelId}')">Revisado ✓</button>` : ''}
                            <button style="font-size:0.7rem; padding:2px 6px; border-radius:6px; border:1px solid var(--warning); background:var(--warning-bg); color:var(--warning); cursor:pointer;" onclick="openEditPlagaAlertModal(${a.id},'${type}','${parcelId}')"><i class="ph ph-pencil-simple"></i></button>
                            <button style="font-size:0.7rem; padding:2px 6px; border-radius:6px; border:1px solid var(--danger); background:var(--danger-bg); color:var(--danger); cursor:pointer;" onclick="deletePlagaAlert(${a.id},'${type}','${parcelId}')"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    el.innerHTML = html;
}

function openAddPlagaAlertModal(type, parcelId) {
    document.getElementById('modal-add-plaga').querySelector('.sheet-title').innerText = 'Alerta de Plaga';
    document.getElementById('plaga-id').value = '';
    document.getElementById('plaga-type').value = type;
    document.getElementById('plaga-parcela').value = parcelId;
    document.getElementById('plaga-name').value = '';
    document.getElementById('plaga-interval').value = 14;
    openModal('modal-add-plaga');
}

function openEditPlagaAlertModal(alertId, type, parcelId) {
    const alertas = state[type].plagaAlertas[parcelId] || [];
    const a = alertas.find(x => x.id === alertId);
    if (!a) return;

    document.getElementById('modal-add-plaga').querySelector('.sheet-title').innerText = 'Editar Alerta';
    document.getElementById('plaga-id').value = a.id;
    document.getElementById('plaga-type').value = type;
    document.getElementById('plaga-parcela').value = parcelId;
    document.getElementById('plaga-name').value = a.name;
    document.getElementById('plaga-interval').value = a.intervalDays;
    
    openModal('modal-add-plaga');
}

function savePlagaAlert(e) {
    e.preventDefault();
    const idField = document.getElementById('plaga-id').value;
    const type = document.getElementById('plaga-type').value;
    const parcelId = document.getElementById('plaga-parcela').value;
    const name = document.getElementById('plaga-name').value.trim();
    const intervalDays = parseInt(document.getElementById('plaga-interval').value) || 14;

    if (!name) return;
    if (!state[type].plagaAlertas) state[type].plagaAlertas = {};
    if (!state[type].plagaAlertas[parcelId]) state[type].plagaAlertas[parcelId] = [];

    const alertas = state[type].plagaAlertas[parcelId];

    if (idField) {
        const a = alertas.find(x => x.id === parseInt(idField));
        if (a) {
            a.name = name;
            a.intervalDays = intervalDays;
            showToast(`Alerta "${name}" actualizada`, 'success');
        }
    } else {
        alertas.push({
            id: Date.now(),
            name,
            intervalDays,
            lastChecked: null
        });
        showToast(`Alerta "${name}" activada`, 'success');
    }

    saveState();
    closeModal('modal-add-plaga');
    document.getElementById('modal-add-plaga').querySelector('form').reset();
    document.getElementById('plaga-id').value = '';
    renderPlagaAlertas(type, parcelId);
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

    // Coste Mano de Obra (Labor Costs)
    const laborCostRate = state.globalSettings ? state.globalSettings.laborCostPerHour : 10;
    ['huerto', 'olivar'].forEach(type => {
        Object.values(state[type].tareas || {}).forEach(tasks => {
            (tasks || []).forEach(t => {
                if (t.hours) {
                    totalExpenses += t.hours * laborCostRate;
                }
            });
        });
    });

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
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; color: #283321; padding: 20px; }
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

// ============================================================
// --- GENERACIÓN DE INFORME PDF ---
// ============================================================
async function generateReportPDF() {
    const rangeMonths = parseInt(document.getElementById('report-range').value) || 3;
    const includeLluvias = document.getElementById('report-chk-lluvias').checked;
    const includeRiego = document.getElementById('report-chk-riego').checked;
    const includeCosechas = document.getElementById('report-chk-cosechas').checked;
    const includeTratamientos = document.getElementById('report-chk-tratamientos').checked;
    const reportTarget = document.getElementById('report-target') ? document.getElementById('report-target').value : 'all';

    closeModal('modal-report-config');
    showToast('Generando informe, espera un momento...', 'info');

    // Fechas
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - rangeMonths);
    
    // Función auxiliar para filtrar por fecha (Y-m-d)
    const isWithinRange = (dateString) => {
        const d = new Date(dateString);
        return d >= startDate && d <= endDate;
    };

    let totalKg = 0;
    let tratamientosRows = '';
    let riegoRows = '';
    let cosechasRows = '';

    // -- COSECHAS --
    if (includeCosechas) {
        let cosechasMap = {};
        let typesToInclude = reportTarget === 'all' ? ['huerto', 'olivar'] : [reportTarget];
        
        typesToInclude.forEach(type => {
            if (state[type].cosechas && Array.isArray(state[type].cosechas)) {
                state[type].cosechas.forEach(c => {
                    if (isWithinRange(c.date)) {
                        const name = state[type].parcelas[c.parcela] || 'General';
                        let key = '';
                        let val = 0;
                        if (type === 'huerto') {
                            key = `${name} - ${c.product || c.variety}`;
                            val = parseFloat(c.count) || 0;
                        } else {
                            key = `${name} - Aceituna`;
                            val = parseFloat(c.kg) || 0;
                            const oilKey = `${name} - Aceite estimado`;
                            if (!cosechasMap[oilKey]) cosechasMap[oilKey] = 0;
                            cosechasMap[oilKey] += parseFloat(c.oil) || 0;
                        }
                        if (!cosechasMap[key]) cosechasMap[key] = 0;
                        cosechasMap[key] += val;
                        totalKg += val;
                    }
                });
            }
        });

        if (Object.keys(cosechasMap).length > 0) {
            cosechasRows = Object.keys(cosechasMap).map(key => {
                const isOil = key.includes('Aceite');
                const unit = isOil ? 'L' : (key.includes('Aceituna') ? 'Kg' : 'uds/Kg');
                return `
                <tr>
                    <td>${key.split(' - ')[0]}</td>
                    <td>${key.split(' - ')[1]}</td>
                    <td style="text-align:right; font-weight:bold;">${cosechasMap[key].toFixed(1)} ${unit}</td>
                </tr>
                `;
            }).join('');
        } else {
            cosechasRows = `<tr><td colspan="3" style="text-align:center;">No hay cosechas registradas en este periodo.</td></tr>`;
        }
    }

    // -- TRATAMIENTOS --
    if (includeTratamientos) {
        let allTratamientos = [];
        let typesToInclude = reportTarget === 'all' ? ['huerto', 'olivar'] : [reportTarget];
        typesToInclude.forEach(type => {
            if (state[type].tratamientos) {
                Object.keys(state[type].tratamientos).forEach(parcelId => {
                    state[type].tratamientos[parcelId].forEach(t => {
                        if (isWithinRange(t.date)) {
                            allTratamientos.push({
                                type, parcelId, name: state[type].parcelas[parcelId], ...t
                            });
                        }
                    });
                });
            }
        });
        allTratamientos.sort((a,b) => new Date(a.date) - new Date(b.date));

        if (allTratamientos.length > 0) {
            tratamientosRows = allTratamientos.map(t => `
                <tr>
                    <td>${t.date}</td>
                    <td>${t.name}</td>
                    <td>${t.product}</td>
                    <td>${t.dose}</td>
                    <td>${t.plague || 'Prevención / Abono'}</td>
                </tr>
            `).join('');
        } else {
            tratamientosRows = `<tr><td colspan="5" style="text-align:center;">No hay tratamientos registrados en este periodo.</td></tr>`;
        }
    }

    // -- RIEGO --
    if (includeRiego) {
        let allRiegos = [];
        let typesToInclude = reportTarget === 'all' ? ['huerto', 'olivar'] : [reportTarget];
        typesToInclude.forEach(type => {
            if (state[type].riego) {
                Object.keys(state[type].riego).forEach(parcelId => {
                    state[type].riego[parcelId].forEach(r => {
                        if (isWithinRange(r.date)) {
                            allRiegos.push({
                                type, parcelId, name: state[type].parcelas[parcelId], ...r
                            });
                        }
                    });
                });
            }
        });
        allRiegos.sort((a,b) => new Date(a.date) - new Date(b.date));

        if (allRiegos.length > 0) {
            riegoRows = allRiegos.map(r => `
                <tr>
                    <td>${r.date}</td>
                    <td>${r.name}</td>
                    <td>${r.method}</td>
                    <td>${r.minutes}</td>
                    <td>${r.liters} L</td>
                    <td>${r.notes || '-'}</td>
                </tr>
            `).join('');
        } else {
            riegoRows = `<tr><td colspan="6" style="text-align:center;">No hay riegos registrados en este periodo.</td></tr>`;
        }
    }

    // -- RESOLVE LOCATION --
    let lat = 38.9942; let lon = -1.8564;
    let locName = 'Albacete';
    
    if (reportTarget === 'olivar') {
        lat = WEATHER_COORDINATES.fuensanta.lat;
        lon = WEATHER_COORDINATES.fuensanta.lon;
        locName = WEATHER_COORDINATES.fuensanta.name;
    } else if (reportTarget === 'huerto') {
        lat = WEATHER_COORDINATES.albacete.lat;
        lon = WEATHER_COORDINATES.albacete.lon;
        locName = WEATHER_COORDINATES.albacete.name;
    } else {
        const loc = localStorage.getItem('weatherLocation') || 'albacete';
        lat = WEATHER_COORDINATES[loc].lat;
        lon = WEATHER_COORDINATES[loc].lon;
        locName = WEATHER_COORDINATES[loc].name;
    }

    // -- LLUVIAS (OPEN-METEO) --
    let lluviaHtml = '';
    let totalLluvia = 0;
    if (includeLluvias) {
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        try {
            const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=Europe%2FMadrid`);
            if (res.ok) {
                const data = await res.json();
                const daily = data.daily;
                
                if (daily && daily.time) {
                    // Agrupar por mes
                    let monthGroups = {};
                    daily.time.forEach((dateStr, idx) => {
                        const precip = daily.precipitation_sum[idx] || 0;
                        const tmax = daily.temperature_2m_max[idx];
                        const tmin = daily.temperature_2m_min[idx];
                        
                        totalLluvia += precip;
                        const d = new Date(dateStr);
                        const monthKey = `${d.toLocaleString('es-ES', {month:'long'})} ${d.getFullYear()}`;
                        if (!monthGroups[monthKey]) monthGroups[monthKey] = [];
                        monthGroups[monthKey].push({ date: dateStr, precip, tmax, tmin });
                    });

                    // Generar tablas por mes
                    Object.keys(monthGroups).forEach(mKey => {
                        const days = monthGroups[mKey];
                        const monthTotal = days.reduce((acc, d) => acc + d.precip, 0);
                        
                        // Encontrar mes y año
                        const sampleDate = new Date(days[0].date);
                        const year = sampleDate.getFullYear();
                        const month = sampleDate.getMonth();
                        
                        // Días en el mes y día de inicio (Lunes = 1, Domingo = 7 adaptado)
                        const daysInMonth = new Date(year, month + 1, 0).getDate();
                        const firstDay = new Date(year, month, 1).getDay();
                        const emptyCellsCount = firstDay === 0 ? 6 : firstDay - 1;
                        
                        // Cabecera de días de la semana
                        let calendarHtml = `
                            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; font-weight: bold; font-size: 0.75rem; margin-bottom: 4px; color: #666;">
                                <div>L</div><div>M</div><div>X</div><div>J</div><div>V</div><div>S</div><div>D</div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
                        `;
                        
                        // Celdas vacías iniciales
                        for (let i = 0; i < emptyCellsCount; i++) {
                            calendarHtml += `<div style="padding: 4px; background: transparent; border: 1px solid transparent;"></div>`;
                        }
                        
                        // Días del mes
                        for (let i = 1; i <= daysInMonth; i++) {
                            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                            const d = days.find(day => day.date === dateStr);
                            
                            if (d) {
                                calendarHtml += `
                                    <div style="padding: 4px; border: 1px solid #ddd; background: ${d.precip > 0 ? '#f0f9ff' : '#fff'}; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 4px;">
                                        <div style="font-weight: bold; font-size: 0.8rem; margin-bottom: 2px; color: #333;">${i}</div>
                                        <div style="font-size: 0.65rem; color: #f97316;">↑${d.tmax !== null && d.tmax !== undefined ? d.tmax.toFixed(1) : '-'}°</div>
                                        <div style="font-size: 0.65rem; color: #3b82f6;">↓${d.tmin !== null && d.tmin !== undefined ? d.tmin.toFixed(1) : '-'}°</div>
                                        <div style="font-size: 0.65rem; font-weight: bold; color: ${d.precip > 0 ? '#0ea5e9' : '#aaa'}; margin-top: 2px;">${d.precip > 0 ? d.precip.toFixed(1) + ' L' : '0 L'}</div>
                                    </div>
                                `;
                            } else {
                                calendarHtml += `
                                    <div style="padding: 4px; border: 1px solid #eee; background: #fafafa; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 4px; opacity: 0.5;">
                                        <div style="font-weight: bold; font-size: 0.8rem; margin-bottom: 2px; color: #999;">${i}</div>
                                        <div style="font-size: 0.65rem; color: transparent;">-</div>
                                    </div>
                                `;
                            }
                        }
                        
                        calendarHtml += `</div>`; // Cerrar grid
                        
                        lluviaHtml += `
                            <div class="rain-month-block" style="margin-bottom: 24px; break-inside: avoid; page-break-inside: avoid;">
                                <div class="rain-month-title" style="background: #f4f6f3; padding: 8px 12px; font-weight: bold; display: flex; justify-content: space-between; border-radius: 6px; margin-bottom: 12px; border: 1px solid #e2e8f0;">
                                    <span>🌡️🌧️ ${mKey} - ${locName}</span>
                                    <span>Lluvia Total: ${monthTotal.toFixed(1)} L/m²</span>
                                </div>
                                ${calendarHtml}
                            </div>
                        `;
                    });

                    if (!lluviaHtml) {
                        lluviaHtml = `<p>No se han registrado datos meteorológicos en el periodo seleccionado.</p>`;
                    }
                }
            }
        } catch(e) {
            console.error("Error fetching weather for report:", e);
            lluviaHtml = `<p style="color:red;">Error al descargar datos meteorológicos de Open-Meteo.</p>`;
        }
    }

    // CONSTRUIR HTML DEL INFORME
    const dateRangeStr = `${startDate.toLocaleDateString('es-ES')} - ${endDate.toLocaleDateString('es-ES')}`;
    const locationStr = reportTarget === 'all' ? 'General (Varias ubicaciones)' : locName;
    
    let reportHtml = `
        <div class="report-header">
            <div class="report-title-container">
                <h1>Cuaderno de Explotación</h1>
                <p>Registro Integrado de Actividades Agrícolas</p>
            </div>
            <div class="report-meta">
                <div>Ubicación: <strong>${locationStr}</strong></div>
                <div>Período: <strong>${dateRangeStr}</strong></div>
            </div>
        </div>

        <div class="report-kpi-grid">
            ${includeLluvias ? `
            <div class="report-kpi-box">
                <div class="report-kpi-value">${totalLluvia.toFixed(1)} L/m²</div>
                <div class="report-kpi-label">Precipitación Total</div>
            </div>` : ''}
            ${includeCosechas ? `
            <div class="report-kpi-box">
                <div class="report-kpi-value">${totalKg.toFixed(1)} Kg/L</div>
                <div class="report-kpi-label">Producción Total</div>
            </div>` : ''}
            <div class="report-kpi-box">
                <div class="report-kpi-value">${endDate.toLocaleDateString('es-ES')}</div>
                <div class="report-kpi-label">Fecha de Emisión</div>
            </div>
        </div>
    `;

    if (includeTratamientos) {
        reportHtml += `
            <div class="report-section">
                <div class="report-section-title">Registro Fitosanitario y Fertilización</div>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Parcela</th>
                            <th>Producto</th>
                            <th>Dosis</th>
                            <th>Motivo / Plaga</th>
                        </tr>
                    </thead>
                    <tbody>${tratamientosRows}</tbody>
                </table>
            </div>
        `;
    }

    if (includeRiego) {
        reportHtml += `
            <div class="report-section">
                <div class="report-section-title">Control y Novedades de Riego</div>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Parcela</th>
                            <th>Método</th>
                            <th>Tiempo</th>
                            <th>Cantidad</th>
                            <th>Observaciones / Cambios</th>
                        </tr>
                    </thead>
                    <tbody>${riegoRows}</tbody>
                </table>
            </div>
        `;
    }

    if (includeCosechas) {
        reportHtml += `
            <div class="report-section">
                <div class="report-section-title">Resumen de Producción y Cosecha</div>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Parcela</th>
                            <th>Variedad</th>
                            <th style="text-align:right;">Cantidad Recogida</th>
                        </tr>
                    </thead>
                    <tbody>${cosechasRows}</tbody>
                </table>
            </div>
        `;
    }

    if (includeLluvias) {
        reportHtml += `
            <div class="report-section">
                <div class="report-section-title">Parte Meteorológico (Detalle Diario)</div>
                ${lluviaHtml}
            </div>
        `;
    }

    const printContainer = document.getElementById('print-report');
    printContainer.innerHTML = reportHtml;

    // Retrasar la impresión un momento para que el navegador renderice el HTML
    setTimeout(() => {
        window.print();
    }, 600);
}
