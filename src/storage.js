const DATABASE_NAME = 'reading-book';
const DATABASE_VERSION = 1;
const DEFAULT_SETTINGS = Object.freeze({ fontSize: 18, lineHeight: 1.8, theme: 'day' });

export function openLibrary() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地书库。'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'bookId' }).createIndex('updatedAt', 'updatedAt');
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bookId' }).createIndex('updatedAt', 'updatedAt');
      if (!db.objectStoreNames.contains('bookmarks')) db.createObjectStore('bookmarks', { keyPath: 'bookmarkId' }).createIndex('bookId', 'bookId');
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

/** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
function requested(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('本地保存失败。')); }); }

/** @param {string[]} stores @param {IDBTransactionMode} mode @param {(transaction: IDBTransaction) => void} action */
async function transact(stores, mode, action) {
  const db = /** @type {IDBDatabase} */ (await openLibrary());
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    transaction.oncomplete = () => { db.close(); resolve(undefined); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('本地保存失败。')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('本地保存失败。')); };
    try { action(transaction); } catch (error) { transaction.abort(); reject(error); }
  });
}

/** @param {any} book */
export async function saveBook(book) { const existing = await getBook(book.bookId); const now = new Date().toISOString(); await transact(['books'], 'readwrite', (tx) => { tx.objectStore('books').put({ ...book, createdAt: existing?.createdAt ?? now, updatedAt: now }); }); }
export async function listBooks() { const db = /** @type {IDBDatabase} */ (await openLibrary()); const books = await requested(db.transaction('books').objectStore('books').getAll()); const progress = await requested(db.transaction('progress').objectStore('progress').getAll()); db.close(); const byBook = new Map(progress.map((item) => [item.bookId, item])); return books.map((book) => ({ bookId: book.bookId, title: book.title, percent: byBook.get(book.bookId)?.percent ?? 0, updatedAt: byBook.get(book.bookId)?.updatedAt ?? book.updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
/** @param {string} bookId */
export async function getBook(bookId) { const db = /** @type {IDBDatabase} */ (await openLibrary()); const result = await requested(db.transaction('books').objectStore('books').get(bookId)); db.close(); return result ?? null; }
/** @param {string} bookId */
export async function removeBook(bookId) {
  await transact(['books', 'progress', 'bookmarks'], 'readwrite', (tx) => {
    tx.objectStore('books').delete(bookId);
    tx.objectStore('progress').delete(bookId);
    const bookRange = globalThis.IDBKeyRange['only'](bookId);
    const request = tx.objectStore('bookmarks').index('bookId').openKeyCursor(bookRange);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        tx.objectStore('bookmarks').delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  });
}
/** @param {any} record */
export async function saveProgress(record) { await transact(['progress'], 'readwrite', (tx) => { tx.objectStore('progress').put(record); }); }
/** @param {string} bookId */
export async function getProgress(bookId) { const db = /** @type {IDBDatabase} */ (await openLibrary()); const value = await requested(db.transaction('progress').objectStore('progress').get(bookId)); db.close(); return value ?? null; }
/** @param {any} record */
export async function saveBookmark(record) { await transact(['bookmarks'], 'readwrite', (tx) => { tx.objectStore('bookmarks').put(record); }); }
/** @param {string} bookId */
export async function listBookmarks(bookId) { const db = /** @type {IDBDatabase} */ (await openLibrary()); const value = await requested(db.transaction('bookmarks').objectStore('bookmarks').index('bookId').getAll(bookId)); db.close(); return value.sort((a, b) => a.position.offset - b.position.offset); }
/** @param {string} bookmarkId */
export async function deleteBookmark(bookmarkId) { await transact(['bookmarks'], 'readwrite', (tx) => { tx.objectStore('bookmarks').delete(bookmarkId); }); }

/** @param {unknown} value */
export function normalizeReaderSettings(value) { const input = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {}; const fontSize = typeof input.fontSize === 'number' && Number.isFinite(input.fontSize) ? Math.min(32, Math.max(14, input.fontSize)) : DEFAULT_SETTINGS.fontSize; const lineHeight = typeof input.lineHeight === 'number' && Number.isFinite(input.lineHeight) ? Math.min(2.4, Math.max(1.4, input.lineHeight)) : DEFAULT_SETTINGS.lineHeight; return { fontSize, lineHeight, theme: input.theme === 'night' ? 'night' : 'day' }; }
export async function getReaderSettings() { const db = /** @type {IDBDatabase} */ (await openLibrary()); const record = await requested(db.transaction('settings').objectStore('settings').get('reader')); db.close(); return normalizeReaderSettings(record?.value); }
/** @param {{fontSize:number,lineHeight:number,theme:string}} settings */
export async function saveReaderSettings(settings) { const deviceId = await getDeviceId(); await transact(['settings'], 'readwrite', (tx) => { tx.objectStore('settings').put({ key: 'reader', value: normalizeReaderSettings(settings), updatedAt: new Date().toISOString(), deviceId }); }); }
export async function getDeviceId() { const db = /** @type {IDBDatabase} */ (await openLibrary()); const record = await requested(db.transaction('settings').objectStore('settings').get('deviceId')); db.close(); if (record?.value) return record.value; const value = globalThis.crypto.randomUUID(); await transact(['settings'], 'readwrite', (tx) => { tx.objectStore('settings').put({ key: 'deviceId', value }); }); return value; }
