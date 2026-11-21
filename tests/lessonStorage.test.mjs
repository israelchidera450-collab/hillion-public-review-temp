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
