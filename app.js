// --- DATA STRUCTURE & STATE ---
let state = {
    almacen: [],
    huerto: {
        parcelas: {
            "huerto-general": "Huerto Principal"
        },
        plantaciones: {},
        tareas: {},
        tratamientos: {},
        cosechas: []
    },
    olivar: {
        parcelas: {
            "olivar-general": "Olivar Principal"
        },
        tareas: {},
        tratamientos: {},
        cosechas: []
    },
    croquis: {},
    diario: [],
    currentView: 'almacen',
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

// Weather state simulated
let weatherState = {
    temp: 24,
    status: "Soleado y despejado",
    wind: 6,
    humidity: 42,
    safeToSpray: true
};

// Seed initial data if localStorage is empty
function seedInitialData() {
    state.almacen = [];
    state.huerto = {
        parcelas: {
            "huerto-general": "Huerto Principal"
        },
        plantaciones: {},
        tareas: {},
        tratamientos: {},
        cosechas: []
    };
    state.olivar = {
        parcelas: {
            "olivar-general": "Olivar Principal"
        },
        tareas: {},
        tratamientos: {},
        cosechas: []
    };
    state.diario = [];
    state.croquis = {};

    // Seed croquis grid for default parcels
    const defaultParcels = ["huerto-general", "olivar-general"];
    defaultParcels.forEach(p => {
        state.croquis[p] = [];
        const isOlivar = p.startsWith("olivar");
        for (let i = 1; i <= 16; i++) {
            state.croquis[p].push({
                id: i,
                label: isOlivar ? `Olivo ${i}` : `Zona ${i}`,
                state: "normal"
            });
        }
    });
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
            
            if (!state.croquis) state.croquis = {};
            if (!state.diario) state.diario = [];
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
    if (viewName === 'almacen') renderAlmacen();
    else if (viewName === 'campo') renderCampo();
    else if (viewName === 'croquis') renderCroquis();
    else if (viewName === 'diario') renderDiario();
    else if (viewName === 'economia') renderEconomia();
}

// --- WEATHER SIMULATOR ---
function renderWeather() {
    document.getElementById('weather-temp').innerText = `${weatherState.temp}°C`;
    document.getElementById('weather-status').innerText = weatherState.status;
    document.getElementById('weather-wind').innerText = `Viento: ${weatherState.wind} km/h`;
    document.getElementById('weather-humidity').innerText = `Humedad: ${weatherState.humidity}%`;
    
    const adviceEl = document.getElementById('weather-advice');
    const iconEl = document.getElementById('weather-icon');

    if (weatherState.safeToSpray) {
        adviceEl.innerHTML = `<i class="ph-fill ph-check-circle"></i> Condiciones óptimas para sulfatar`;
        adviceEl.className = "weather-advice"; // standard green-ish
        adviceEl.style.color = "var(--success)";
        iconEl.className = "ph-fill ph-sun weather-icon-lg";
        iconEl.style.color = "var(--secondary)";
    } else {
        adviceEl.innerHTML = `<i class="ph-fill ph-warning-circle"></i> Evitar sulfatar: ${weatherState.status.toLowerCase()}`;
        adviceEl.className = "weather-advice";
        adviceEl.style.color = "var(--danger)";
        iconEl.className = "ph-fill ph-cloud-rain weather-icon-lg";
        iconEl.style.color = "var(--text-muted)";
    }
}

function syncData() {
    showToast("Sincronizando previsión del tiempo...", "info");
    
    setTimeout(() => {
        // Randomize weather parameters
        const tempChance = Math.random();
        if (tempChance < 0.3) {
            weatherState.temp = Math.floor(Math.random() * 10) + 12; // 12-21
            weatherState.status = "Lluvia débil y viento racheado";
            weatherState.wind = Math.floor(Math.random() * 15) + 20; // 20-35
            weatherState.humidity = Math.floor(Math.random() * 20) + 75; // 75-95
            weatherState.safeToSpray = false;
        } else if (tempChance < 0.6) {
            weatherState.temp = Math.floor(Math.random() * 8) + 22; // 22-29
            weatherState.status = "Viento fuerte del este";
            weatherState.wind = Math.floor(Math.random() * 10) + 18; // 18-27
            weatherState.humidity = Math.floor(Math.random() * 15) + 30; // 30-45
            weatherState.safeToSpray = false;
        } else {
            weatherState.temp = Math.floor(Math.random() * 10) + 20; // 20-30
            weatherState.status = "Despejado y calmado";
            weatherState.wind = Math.floor(Math.random() * 6) + 3; // 3-8
            weatherState.humidity = Math.floor(Math.random() * 20) + 40; // 40-60
            weatherState.safeToSpray = true;
        }
        renderWeather();
        showToast("Tiempo local actualizado con éxito", "success");
    }, 800);
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

    const newProd = {
        id: Date.now(),
        name,
        type,
        stock,
        price,
        dose,
        function: func
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
    const hView = document.getElementById('subview-huerto');
    const oView = document.getElementById('subview-olivar');

    if (tab === 'huerto') {
        hBtn.classList.add('active');
        oBtn.classList.remove('active');
        hView.classList.remove('hidden');
        oView.classList.add('hidden');
    } else {
        hBtn.classList.remove('active');
        oBtn.classList.add('active');
        hView.classList.add('hidden');
        oView.classList.remove('hidden');
    }
    renderCampo();
}

function renderCampo() {
    populateParcelDropdowns();
    if (state.currentCultivoTab === 'huerto') {
        renderHuerto();
    } else {
        renderOlivar();
    }
}

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

    renderTasks('huerto', pId);
    renderPlantings(pId);
    renderTreatments('huerto', pId);
    checkSafetyPeriod('huerto', pId);
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

    renderTasks('olivar', pId);
    renderTreatments('olivar', pId);
    checkSafetyPeriod('olivar', pId);
    renderOlivarHarvestHistory();
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

    document.getElementById('treatment-type').value = type;
    document.getElementById('treatment-date').value = getTodayString();
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
let tempHarvestCount = 0;
function adjustHarvestCounter(val) {
    tempHarvestCount = Math.max(0, tempHarvestCount + val);
    document.getElementById('huerto-harvest-val').innerText = tempHarvestCount;
}

function saveHuertoHarvest() {
    if (tempHarvestCount === 0) {
        showToast("Introduce un número mayor que 0", "error");
        return;
    }
    const product = document.getElementById('huerto-harvest-product').value;
    const parcelId = state.currentHuertoParcela;
    const dateStr = getTodayString();

    const newHarvest = {
        id: Date.now(),
        product: product,
        count: tempHarvestCount,
        date: dateStr,
        parcela: parcelId
    };

    state.huerto.cosechas.push(newHarvest);

    // Auto log to journal
    state.diario.push({
        id: Date.now() + 1,
        text: `Cosechado en ${state.huerto.parcelas[parcelId]}: ${tempHarvestCount} uds de ${product}.`,
        date: `${dateStr} ${getNowTimeString()}`,
        photo: MOCK_PHOTOS.cosecha.url
    });

    tempHarvestCount = 0;
    document.getElementById('huerto-harvest-val').innerText = 0;
    
    saveState();
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
function renderCroquis() {
    // Populate select
    const select = document.getElementById('croquis-parcela-select');
    select.innerHTML = '';

    // Join parcels from Huerto and Olivar
    const huertoKeys = Object.keys(state.huerto.parcelas);
    const olivarKeys = Object.keys(state.olivar.parcelas);

    huertoKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `Huerto: ${state.huerto.parcelas[k]}`;
        opt.selected = (state.currentCroquisParcela === k);
        select.appendChild(opt);
    });

    olivarKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `Olivar: ${state.olivar.parcelas[k]}`;
        opt.selected = (state.currentCroquisParcela === k);
        select.appendChild(opt);
    });

    // Draw Grid
    const parcelId = select.value;
    state.currentCroquisParcela = parcelId;
    
    // Ensure grid exists
    if (!state.croquis[parcelId]) {
        state.croquis[parcelId] = [];
        const isOlivar = parcelId.startsWith("olivar");
        for (let i = 1; i <= 16; i++) {
            state.croquis[parcelId].push({
                id: i,
                label: isOlivar ? `Olivo ${i}` : `Zona ${i}`,
                state: "normal"
            });
        }
    }

    const gridEl = document.getElementById('croquis-grid');
    gridEl.innerHTML = '';

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

function toggleCellState(parcelId, cellId) {
    const cell = state.croquis[parcelId].find(c => c.id === cellId);
    if (cell) {
        // Toggle sequence: normal -> treated -> pending -> plaga -> normal
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

// --- ECONOMÍA LOGIC ---
function renderEconomia() {
    let totalExpenses = 0;
    
    // Calculate treatments costs
    // Deducted amount of product * product price
    const huertoKeys = Object.keys(state.huerto.tratamientos);
    const olivarKeys = Object.keys(state.olivar.tratamientos);

    const calculateCost = (list) => {
        list.forEach(t => {
            // Find product matching by name in Almacén (historical match)
            // If deleted, we guess a standard 10€ price
            const p = state.almacen.find(prod => prod.name === t.productName);
            const unitPrice = p ? p.price : 10.0;
            totalExpenses += t.amount * unitPrice;
        });
    };

    huertoKeys.forEach(k => calculateCost(state.huerto.tratamientos[k]));
    olivarKeys.forEach(k => calculateCost(state.olivar.tratamientos[k]));

    // Calculate plantings costs (Huerto)
    if (state.huerto.plantaciones) {
        const plantingKeys = Object.keys(state.huerto.plantaciones);
        plantingKeys.forEach(k => {
            const plantings = state.huerto.plantaciones[k] || [];
            plantings.forEach(p => {
                totalExpenses += p.qty * p.cost;
            });
        });
    }

    // Calculate revenue from harvests
    // Tomates/Pimientos: 0.35€ per unit estimated
    // Olive oil: 6.50€ per kg of oil estimated
    let totalIncome = 0;

    state.huerto.cosechas.forEach(h => {
        const itemVal = 0.40; // 0.40€ por hortaliza
        totalIncome += h.count * itemVal;
    });

    state.olivar.cosechas.forEach(h => {
        const oilPrice = 6.80; // 6.80€ por Kg de aceite
        totalIncome += h.oil * oilPrice;
    });

    const balance = totalIncome - totalExpenses;

    document.getElementById('fin-expenses').innerText = `${totalExpenses.toFixed(2)} €`;
    document.getElementById('fin-income').innerText = `${totalIncome.toFixed(2)} €`;
    
    const balEl = document.getElementById('fin-balance');
    balEl.innerText = `${balance.toFixed(2)} €`;
    if (balance >= 0) {
        balEl.className = "finance-value balance income";
    } else {
        balEl.className = "finance-value balance expense";
    }
}

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
    // Renders active views reactively
    if (state.currentView === 'almacen') renderAlmacen();
    else if (state.currentView === 'campo') renderCampo();
    else if (state.currentView === 'croquis') renderCroquis();
    else if (state.currentView === 'diario') renderDiario();
    else if (state.currentView === 'economia') renderEconomia();
}

// --- INITIALIZE ON LOAD ---
window.addEventListener('DOMContentLoaded', () => {
    loadState();
    renderWeather();
    switchView(state.currentView);
    toggleCultivoTab(state.currentCultivoTab);
    
    // Background sync and IndexedDB backup
    initSyncAndIndexedDB();
});
