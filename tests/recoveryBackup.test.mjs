import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRecoveryBackup, restoreRecoveryBackup } from '../src/utils/recoveryBackup.js';

class MemoryStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.crypto ||= webcrypto;
globalThis.btoa ||= value => Buffer.from(value, 'binary').toString('base64');
globalThis.atob ||= value => Buffer.from(value, 'base64').toString('binary');

test('encrypted recovery backup restores HILLION records on a fresh device', async () => {
  const source = new MemoryStorage({
    hillion_saved_lessons: JSON.stringify([{ id: 'lesson-1', title: 'Photosynthesis' }]),
    hillion_chat_history: JSON.stringify([{ role: 'user', content: 'Explain this' }]),
    unrelated_preference: 'leave out'
  });
  const created = await createRecoveryBackup({ storage: source });
  assert.match(created.recoveryCode, /^H5LL10N-/);
  const target = new MemoryStorage({ hillion_saved_lessons: '[]' });
  const restored = await restoreRecoveryBackup({
    backup: created.backup, recoveryCode: created.recoveryCode, storage: target
  });
  assert.deepEqual(restored.restoredKeys.sort(), ['hillion_chat_history', 'hillion_saved_lessons']);
  assert.equal(target.getItem('hillion_saved_lessons'), source.getItem('hillion_saved_lessons'));
  assert.equal(target.getItem('hillion_chat_history'), source.getItem('hillion_chat_history'));
  assert.equal(target.getItem('unrelated_preference'), null);
});

test('wrong recovery secret is rejected without changing existing data', async () => {
  const source = new MemoryStorage({ hillion_saved_lessons: '[{"id":"x"}]' });
  const created = await createRecoveryBackup({ storage: source });
  const target = new MemoryStorage({ hillion_saved_lessons: '[{"id":"keep"}]' });
  await assert.rejects(
    restoreRecoveryBackup({ backup: created.backup, recoveryCode: 'H5LL10N-' + 'A'.repeat(40), storage: target }),
    /could not be decrypted/
  );
  assert.equal(target.getItem('hillion_saved_lessons'), '[{"id":"keep"}]');
});

test('invalid or tampered backup is rejected', async () => {
  const source = new MemoryStorage({ hillion_saved_lessons: '[]' });
  const created = await createRecoveryBackup({ storage: source });
  const tampered = { ...created.backup, ciphertext: created.backup.ciphertext.slice(0, -4) + 'AAAA' };
  await assert.rejects(
    restoreRecoveryBackup({ backup: tampered, recoverySecret: created.recoverySecret, storage: new MemoryStorage() }),
    /could not be decrypted/
  );
});
