import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};
const storage = await import('../src/utils/lessonStorage.js?test=' + randomUUID());

test('saves, updates, recovers and clears lessons without losing the backup', () => {
  store.clear();
  const lesson = { id: 'test-lesson', title: 'Photosynthesis', sections: [{ heading: 'Light reactions', content: 'Saved content' }] };
  assert.equal(storage.saveLesson(lesson), true);
  assert.equal(storage.getLesson(lesson.id).sections[0].content, 'Saved content');
  assert.equal(storage.saveLesson({ ...lesson, sections: [{ heading: 'Light reactions', content: 'Updated content' }] }), true);
  store.set('hillion_saved_lessons', '{broken');
  assert.equal(storage.getLesson(lesson.id).sections[0].content, 'Saved content');
  assert.equal(storage.saveActiveLesson({ id: 'active-test', status: 'paused' }), true);
  assert.equal(storage.getActiveLesson().id, 'active-test');
  assert.equal(storage.clearActiveLesson(), true);
  assert.equal(store.get('hillion_active_lesson_cleared_v1'), '1');
  assert.equal(storage.getActiveLesson(), null);
});


test('reports IndexedDB as optional when the browser does not provide it', async () => {
  const result = await storage.restoreStorageFromIndexedDB();
  assert.deepEqual(result, { restored: [], available: false });
});

test('durable mirror preserves save-clear-save ordering during recovery', async () => {
  const records = new Map();
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      let write = null;
      const transaction = {
        objectStore() {
          return {
            put(record) { write = () => records.set(record.key, record); },
            delete(key) { write = () => records.delete(key); },
            get(key) {
              const request = {};
              queueMicrotask(() => {
                request.result = records.get(key) || null;
                request.onsuccess?.();
              });
              return request;
            }
          };
        }
      };
      queueMicrotask(() => {
        write?.();
        transaction.oncomplete?.();
      });
      return transaction;
    }
  };
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    }
  };

  try {
    store.clear();
    assert.equal(storage.saveActiveLesson({ id: 'old-active' }), true);
    assert.equal(storage.clearActiveLesson(), true);
    assert.equal(storage.saveActiveLesson({ id: 'new-active' }), true);

    await storage.restoreStorageFromIndexedDB();
    store.delete('hillion_active_lesson');
    store.delete('hillion_active_lesson__backup_v1');
    store.delete('hillion_active_lesson_cleared_v1');

    const recovered = await storage.restoreStorageFromIndexedDB();
    assert.deepEqual(recovered.restored, ['hillion_active_lesson']);
    assert.equal(storage.getActiveLesson().id, 'new-active');
  } finally {
    delete globalThis.indexedDB;
  }
});
