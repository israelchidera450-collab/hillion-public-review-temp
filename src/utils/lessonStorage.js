const LESSONS_KEY = 'hillion_saved_lessons';
const ACTIVE_LESSON_KEY = 'hillion_active_lesson';
const BACKUP_SUFFIX = '__backup_v1';
const META_KEY = 'hillion_storage_meta_v1';
const DURABLE_DB_NAME = 'hillion_lesson_backup_v1';
const DURABLE_STORE_NAME = 'records';
const ACTIVE_CLEARED_KEY = 'hillion_active_lesson_cleared_v1';
let durableDbPromise = null;
let durableWriteQueue = Promise.resolve();

// IndexedDB mirrors must commit in the same order as synchronous local writes.
// Otherwise a delayed delete can race a newer save and leave a stale recovery copy.
function enqueueDurableOperation(operation) {
  const result = durableWriteQueue.then(operation, operation);
  durableWriteQueue = result.catch(() => false);
  return result;
}

function parseRecord(raw) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid stored record');
  return parsed;
}

function openDurableDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (durableDbPromise) return durableDbPromise;

  durableDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DURABLE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DURABLE_STORE_NAME)) {
        db.createObjectStore(DURABLE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB could not be opened'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'));
  }).catch(error => {
    durableDbPromise = null;
    console.warn('[HILLION STORAGE] Durable backup is unavailable; local backup remains active.', error);
    return null;
  });

  return durableDbPromise;
}

function removeDurableValue(key) {
  return enqueueDurableOperation(async () => {
    try {
      const db = await openDurableDatabase();
      if (!db) return false;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DURABLE_STORE_NAME, 'readwrite');
        transaction.objectStore(DURABLE_STORE_NAME).delete(key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB backup delete failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB backup delete aborted'));
      });
      return true;
    } catch (error) {
      console.warn('[HILLION STORAGE] IndexedDB backup cleanup failed.', error);
      return false;
    }
  });
}

function mirrorStorageValue(key, serialized) {
  return enqueueDurableOperation(async () => {
    try {
      const db = await openDurableDatabase();
      if (!db) return false;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DURABLE_STORE_NAME, 'readwrite');
        transaction.objectStore(DURABLE_STORE_NAME).put({
          key,
          value: serialized,
          savedAt: new Date().toISOString()
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB backup write failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB backup write aborted'));
      });
      return true;
    } catch (error) {
      console.warn('[HILLION STORAGE] IndexedDB backup write failed; localStorage copy remains available.', error);
      return false;
    }
  });
}

export async function restoreStorageFromIndexedDB() {
  // Wait for this session's queued mirror writes/deletes before reading recovery data.
  await durableWriteQueue.catch(() => false);
  const db = await openDurableDatabase();
  if (!db) return { restored: [], available: false };
  const keys = [LESSONS_KEY, ACTIVE_LESSON_KEY];
  const restored = [];

  for (const key of keys) {
    if (key === ACTIVE_LESSON_KEY && localStorage.getItem(ACTIVE_CLEARED_KEY) === '1') continue;
    // Prefer either valid local copy. IndexedDB is a recovery source, not a
    // competing source of truth when the existing local data is readable.
    const localValue = readStorage(key, undefined);
    if (localValue !== undefined && localValue !== null) continue;

    try {
      const record = await new Promise((resolve, reject) => {
        const transaction = db.transaction(DURABLE_STORE_NAME, 'readonly');
        const request = transaction.objectStore(DURABLE_STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('IndexedDB backup read failed'));
      });
      if (!record || typeof record.value !== 'string') continue;
      const parsed = parseRecord(record.value);
      if (key === LESSONS_KEY && !Array.isArray(parsed)) continue;
      localStorage.setItem(key, record.value);
      restored.push(key);
    } catch (error) {
      console.warn(`[HILLION STORAGE] Could not restore ${key} from durable backup.`, error);
    }
  }
  return { restored, available: true };
}

function readStorage(key, fallback) {
  try {
    const primary = parseRecord(localStorage.getItem(key));
    if (primary !== null) return primary;
  } catch (error) {
    console.warn('[HILLION STORAGE] Primary record is damaged; checking backup.', error);
  }
  try {
    const backup = parseRecord(localStorage.getItem(key + BACKUP_SUFFIX));
    if (backup !== null) {
      localStorage.setItem(key, JSON.stringify(backup));
      return backup;
    }
  } catch (error) {
    console.error('[HILLION STORAGE] Backup recovery failed:', error);
  }
  return fallback;
}

function writeStorage(key, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
    // Verify serialization before touching the existing record.
    const verified = JSON.parse(serialized);
    if (JSON.stringify(verified) !== serialized) return false;

    const previous = localStorage.getItem(key);
    if (previous) {
      try {
        JSON.parse(previous);
        localStorage.setItem(key + BACKUP_SUFFIX, previous);
      } catch {
        // Keep the last known-good backup; never copy a corrupt primary over it.
      }
    }

    localStorage.setItem(key, serialized);
    const readBack = localStorage.getItem(key);
    if (readBack !== serialized) throw new Error('Storage read-back verification failed');

    // Keep localStorage synchronous for existing app callers, while an
    // IndexedDB mirror provides an additional recovery copy in the background.
    void mirrorStorageValue(key, serialized);

    try {
      const meta = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      meta[key] = { savedAt: new Date().toISOString(), bytes: serialized.length };
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (metaError) {
      console.warn('[HILLION STORAGE] Metadata update skipped:', metaError);
    }
    return true;
  } catch (error) {
    console.error('[HILLION STORAGE] Could not save:', error);
    return false;
  }
}

export function getLessons() {
  const value = readStorage(LESSONS_KEY, []);
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && item.id) : [];
}

export function getLesson(id) {
  return getLessons().find(lesson => lesson.id === id) || null;
}

export function saveLesson(lesson) {
  if (!lesson || !lesson.id) return false;
  const lessons = getLessons();
  const index = lessons.findIndex(item => item.id === lesson.id);
  const updated = { ...lesson, updatedAt: new Date().toISOString() };
  if (index >= 0) lessons[index] = { ...lessons[index], ...updated };
  else lessons.unshift(updated);
  return writeStorage(LESSONS_KEY, lessons);
}

export function deleteLesson(id) {
  return writeStorage(LESSONS_KEY, getLessons().filter(lesson => lesson.id !== id));
}

export function updateLesson(id, changes) {
  const lessons = getLessons();
  const index = lessons.findIndex(lesson => lesson.id === id);
  if (index < 0) return false;
  lessons[index] = { ...lessons[index], ...changes, updatedAt: new Date().toISOString() };
  return writeStorage(LESSONS_KEY, lessons);
}

export function saveActiveLesson(lesson) {
  if (lesson == null) return false;
  const saved = writeStorage(ACTIVE_LESSON_KEY, lesson);
  if (saved) {
    try { localStorage.removeItem(ACTIVE_CLEARED_KEY); } catch { /* primary save remains valid */ }
  }
  return saved;
}

export function getActiveLesson() {
  return readStorage(ACTIVE_LESSON_KEY, null);
}

export function clearActiveLesson() {
  try {
    // The tombstone prevents a stale IndexedDB mirror from resurrecting a
    // lesson if the app is closed before the asynchronous delete completes.
    localStorage.setItem(ACTIVE_CLEARED_KEY, '1');
    localStorage.removeItem(ACTIVE_LESSON_KEY);
    localStorage.removeItem(ACTIVE_LESSON_KEY + BACKUP_SUFFIX);
    void removeDurableValue(ACTIVE_LESSON_KEY);
    return true;
  } catch (error) {
    console.error('[HILLION STORAGE] Could not clear active lesson:', error);
    return false;
  }
}

export function getStorageDiagnostics() {
  const keys = [LESSONS_KEY, ACTIVE_LESSON_KEY];
  return keys.map(key => {
    try {
      const primary = localStorage.getItem(key);
      return {
        key,
        primaryPresent: primary !== null,
        backupPresent: localStorage.getItem(key + BACKUP_SUFFIX) !== null,
        primaryBytes: (primary || '').length
      };
    } catch (error) {
      return { key, primaryPresent: false, backupPresent: false, primaryBytes: 0, error: String(error?.message || error) };
    }
  });
}
