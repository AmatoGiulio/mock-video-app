import { sanitizeDocument, serializeDocument, type EditorDocument } from "@/lib/editorDocument";

const DOCUMENT_KEY = "mockup-video-app:document";
const DB_NAME = "mockup-video-app";
const DB_VERSION = 1;
const MEDIA_STORE = "media";
const MEDIA_KEY = "clips";

export function isStorageAvailable(): boolean {
  try {
    const testKey = "__mockup_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export function hasSavedDocument(): boolean {
  try {
    return window.localStorage.getItem(DOCUMENT_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveDocument(doc: EditorDocument): boolean {
  try {
    window.localStorage.setItem(DOCUMENT_KEY, serializeDocument(doc));
    return true;
  } catch {
    return false;
  }
}

export function loadDocument(): EditorDocument | null {
  try {
    const raw = window.localStorage.getItem(DOCUMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { document?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    return sanitizeDocument(parsed.document);
  } catch {
    return null;
  }
}

export function clearDocument(): void {
  try {
    window.localStorage.removeItem(DOCUMENT_KEY);
  } catch {
    /* ignore */
  }
}

type StoredClip = { name: string; type: string; blob: Blob } | null;

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the media store."));
  });
}

export async function saveMedia(files: (File | null)[]): Promise<boolean> {
  try {
    const records: StoredClip[] = files.map((file) => (file ? { name: file.name, type: file.type, blob: file } : null));
    const db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, "readwrite");
      tx.objectStore(MEDIA_STORE).put(records, MEDIA_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save media."));
      tx.onabort = () => reject(tx.error ?? new Error("Media save was aborted."));
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadMedia(): Promise<(File | null)[] | null> {
  try {
    const db = await openMediaDb();
    const records = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, "readonly");
      const request = tx.objectStore(MEDIA_STORE).get(MEDIA_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read media."));
    });
    db.close();
    if (!Array.isArray(records)) return null;
    return records.map((record) => {
      if (!record || typeof record !== "object") return null;
      const { name, type, blob } = record as { name?: unknown; type?: unknown; blob?: unknown };
      if (!(blob instanceof Blob)) return null;
      return new File([blob], typeof name === "string" ? name : "clip", {
        type: typeof type === "string" ? type : blob.type,
      });
    });
  } catch {
    return null;
  }
}

export async function clearMedia(): Promise<void> {
  try {
    const db = await openMediaDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(MEDIA_STORE, "readwrite");
      tx.objectStore(MEDIA_STORE).delete(MEDIA_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
}
