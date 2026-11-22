const BACKUP_FORMAT = 'hillion-portable-backup';
const BACKUP_VERSION = 1;
const PREFIX = 'hillion_';

function getCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Secure backup encryption is not available on this device.');
  }
  return globalThis.crypto;
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function makeRecoveryCode() {
    return 'H5LL10N-' + Array.from(getCrypto().getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function deriveKey(secret, salt) {
  const crypto = getCrypto();
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function collectHillionData(storage = globalThis.localStorage) {
  if (!storage) throw new Error('HILLION local storage is unavailable.');
  const records = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    // Verify that each saved record is valid JSON before exporting it.
    JSON.parse(value);
    records[key] = value;
  }
  if (!Object.keys(records).length) throw new Error('No HILLION data was found to back up.');
  return records;
}

/**
 * Creates an encrypted, portable backup. The recovery code identifies this
 * backup. Keep the recovery code and exported encrypted file; both are required.
 */
export async function createRecoveryBackup({ storage = globalThis.localStorage } = {}) {
  const crypto = getCrypto();
  const recoveryCode = makeRecoveryCode();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(recoveryCode, salt);
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    recoveryCode,
    records: collectHillionData(storage)
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    recoveryCode,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext))
    }
  };
}

/**
 * Restores a previously exported encrypted backup. Existing HILLION records
 * are snapshotted first and rolled back if any write fails.
 */
export async function restoreRecoveryBackup({ backup, recoveryCode, storage = globalThis.localStorage }) {
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new Error('This is not a supported HILLION backup.');
  }
  if (typeof recoveryCode !== 'string' || !/^H5LL10N-[A-F0-9]{40}$/.test(recoveryCode)) {
    throw new Error('The HILLION recovery code is missing or invalid.');
  }
  if (!storage) throw new Error('HILLION local storage is unavailable.');

  let payload;
  try {
    const key = await deriveKey(recoveryCode, fromBase64(backup.salt));
    const plaintext = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(backup.iv) },
      key,
      fromBase64(backup.ciphertext)
    );
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Backup could not be decrypted. Check the recovery code and backup file.');
  }

  if (
    payload?.format !== BACKUP_FORMAT ||
    payload.version !== BACKUP_VERSION ||
    !payload.records ||
    typeof payload.records !== 'object' ||
    Array.isArray(payload.records)
  ) {
    throw new Error('The backup contents are invalid or incomplete.');
  }

  const entries = Object.entries(payload.records);
  if (!entries.length || entries.some(([key, value]) =>
    !key.startsWith(PREFIX) || typeof value !== 'string' || !isValidJson(value)
  )) {
    throw new Error('The backup contains invalid HILLION records.');
  }

  const previous = new Map();
  for (const [key] of entries) previous.set(key, storage.getItem(key));
  try {
    for (const [key, value] of entries) storage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch { /* best-effort rollback; original error is more useful */ }
    }
    throw new Error('Restore failed. Existing data was rolled back where possible: ' + (error?.message || 'storage error'));
  }
  return { restoredKeys: entries.map(([key]) => key), createdAt: payload.createdAt || null };
}

function isValidJson(value) {
  try { JSON.parse(value); return true; } catch { return false; }
}

export function downloadRecoveryBackup(backup, filename = 'HILLION-encrypted-backup.json') {
  if (!globalThis.document || !globalThis.URL?.createObjectURL) {
    throw new Error('Backup download is not available in this environment.');
  }
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
