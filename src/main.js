import { calculateProgress, calculateReadingOffset, getReadingBlockOffsets, readTextBook } from './reader.js';
import { deleteBookmark, getBook, getDeviceId, getProgress, getReaderSettings, listBookmarks, listBooks, removeBook, saveBook, saveBookmark, saveProgress, saveReaderSettings } from './storage.js';

/** @param {string} id */
const byId = (id) => document.getElementById(id);
const libraryView = byId('library-view'); const readerView = byId('reader-view'); const input = byId('book-file'); const status = byId('status'); const readerStatus = byId('reader-status'); const bookList = byId('book-list'); const bookText = byId('book-text');
/** @type {any} */ let currentBook = null; let saveTimer = 0;

/** @param {HTMLElement|null} target @param {string} text */
function message(target, text) { if (target) target.textContent = text; }
/** @param {string} text @param {() => void} action */
function button(text, action) { const element = document.createElement('button'); element.type = 'button'; element.textContent = text; element.addEventListener('click', action); return element; }
/** @param {unknown} error @param {string} fallback */
function errorMessage(error, fallback) { return error instanceof Error ? error.message : fallback; }
/** @param {() => Promise<void>} action @param {HTMLElement|null} target @param {string} fallback */
async function runAction(action, target, fallback) {
  try { await action(); } catch (error) { message(target, errorMessage(error, fallback)); }
}

async function renderLibrary() {
  if (!bookList) return; bookList.replaceChildren();
  const books = await listBooks();
  if (!books.length) { const empty = document.createElement('p'); empty.textContent = '书架还是空的，请导入一本 TXT。'; bookList.append(empty); return; }
  for (const book of books) {
    const card = document.createElement('article'); card.className = 'book-card'; const title = document.createElement('h2'); title.textContent = book.title; const detail = document.createElement('p'); detail.textContent = `${book.percent}% · ${new Date(book.updatedAt).toLocaleString()}`; const actions = document.createElement('div'); actions.className = 'book-actions'; actions.append(button('打开', () => { void runAction(() => openBook(book.bookId), status, '无法打开书籍，请重试。'); }), button('移除', () => { void runAction(async () => { if (globalThis.confirm(`确定移除《${book.title}》吗？`)) { await removeBook(book.bookId); await renderLibrary(); } }, status, '移除失败，请检查浏览器本地存储。'); })); card.append(title, detail, actions); bookList.append(card);
  }
}

/** @param {any} book */
function renderText(book) {
  if (!bookText) return;
  bookText.replaceChildren();
  const offsets = getReadingBlockOffsets(book.chapters, book.text.length);
  for (let index = 0; index < offsets.length; index += 1) {
    const block = document.createElement('section');
    block.className = 'text-block';
    block.dataset.offset = String(offsets[index]);
    block.textContent = book.text.slice(offsets[index], offsets[index + 1] ?? book.text.length);
    bookText.append(block);
  }
}

/** @param {number} offset */
function jumpTo(offset) {
  if (!bookText || !currentBook) return;
  const safeOffset = Math.max(0, Math.min(currentBook.text.length, offset));
  const blocks = Array.from(bookText.querySelectorAll('[data-offset]'));
  const target = /** @type {HTMLElement|undefined} */ (blocks.filter((node) => Number(/** @type {HTMLElement} */ (node).dataset.offset) <= safeOffset).at(-1));
  if (!target) return;
  const blockOffset = Number(target.dataset.offset ?? 0);
  const blockLength = target.textContent?.length ?? 0;
  const ratio = blockLength ? (safeOffset - blockOffset) / blockLength : 0;
  bookText.scrollTop = Math.max(0, target.offsetTop - bookText.offsetTop + target.scrollHeight * ratio);
  scheduleSave();
}
function currentOffset() {
  if (!bookText || !currentBook) return 0;
  const blocks = Array.from(bookText.querySelectorAll('[data-offset]'));
  const readerTop = bookText.getBoundingClientRect().top;
  const block = /** @type {HTMLElement|undefined} */ (blocks.find((node) => node.getBoundingClientRect().bottom >= readerTop) ?? blocks.at(-1));
  if (!block) return 0;
  const blockTop = block.getBoundingClientRect().top;
  const offset = calculateReadingOffset(Number(block.dataset.offset ?? 0), block.textContent?.length ?? 0, readerTop - blockTop, block.scrollHeight);
  return Math.max(0, Math.min(currentBook.text.length, offset));
}

async function persistProgress() { if (!currentBook) return; const offset = currentOffset(); const chapter = [...currentBook.chapters].reverse().find((item) => item.offset <= offset); try { await saveProgress({ bookId:currentBook.bookId, position:{ offset, chapterId:chapter?.id ?? null }, percent:calculateProgress(offset, currentBook.text.length), updatedAt:new Date().toISOString(), deviceId:await getDeviceId() }); } catch { message(readerStatus, '阅读进度保存失败，请检查浏览器本地存储。'); } }
function scheduleSave(immediate = false) { globalThis.clearTimeout(saveTimer); if (immediate) { void persistProgress(); } else { saveTimer = globalThis.setTimeout(() => { void persistProgress(); }, 300); } }

async function renderBookmarks() { const root = byId('bookmarks'); if (!root || !currentBook) return; root.replaceChildren(); const records = await listBookmarks(currentBook.bookId); if (!records.length) { const empty = document.createElement('p'); empty.textContent = '暂无书签'; root.append(empty); } for (const record of records) root.append(button(record.label, () => jumpTo(record.position.offset))); }
async function toggleBookmark() { if (!currentBook) return; const offset = currentOffset(); const records = await listBookmarks(currentBook.bookId); const existing = records.find((item) => Math.abs(item.position.offset - offset) <= 20); if (existing) await deleteBookmark(existing.bookmarkId); else { const chapter = [...currentBook.chapters].reverse().find((item) => item.offset <= offset); await saveBookmark({ bookmarkId:globalThis.crypto.randomUUID(), bookId:currentBook.bookId, position:{ offset, chapterId:chapter?.id ?? null }, label:currentBook.text.slice(offset, offset + 40).replace(/\s+/g, ' ').trim() || currentBook.title, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deviceId:await getDeviceId() }); } await renderBookmarks(); }

/** @param {string} bookId */
async function openBook(bookId) {
  currentBook = await getBook(bookId); if (!currentBook) return; libraryView?.setAttribute('hidden', ''); readerView?.removeAttribute('hidden'); message(byId('book-title'), currentBook.title); renderText(currentBook);
  const toc = byId('toc'); toc?.replaceChildren(); for (const chapter of currentBook.chapters) toc?.append(button(chapter.title, () => jumpTo(chapter.offset))); await renderBookmarks(); const progress = await getProgress(bookId); if (progress) jumpTo(Math.max(0, Math.min(currentBook.text.length, progress.position.offset)));
}

/** @param {{fontSize:number,lineHeight:number,theme:string}} settings */
function applySettings(settings) { document.documentElement.dataset.theme = settings.theme; document.documentElement.style.setProperty('--reader-font', `${settings.fontSize}px`); document.documentElement.style.setProperty('--reader-line', String(settings.lineHeight)); const font = byId('font-size'); const line = byId('line-height'); const theme = byId('theme'); if (font instanceof HTMLInputElement) font.value = String(settings.fontSize); if (line instanceof HTMLInputElement) line.value = String(settings.lineHeight); if (theme instanceof globalThis.HTMLSelectElement) theme.value = settings.theme; }
async function updateSettings() { const font = byId('font-size'); const line = byId('line-height'); const theme = byId('theme'); if (!(font instanceof HTMLInputElement) || !(line instanceof HTMLInputElement) || !(theme instanceof globalThis.HTMLSelectElement)) return; const settings = { fontSize:Number(font.value), lineHeight:Number(line.value), theme:theme.value }; applySettings(settings); await saveReaderSettings(settings); }
/** @param {number} direction */
function page(direction) { if (bookText) bookText.scrollBy({ top:direction * bookText.clientHeight * .9, behavior:'smooth' }); scheduleSave(); }

input?.addEventListener('change', async () => { if (!(input instanceof HTMLInputElement)) return; const file = input.files?.[0]; if (!file) return; input.disabled = true; message(status, '正在导入…'); try { const book = await readTextBook(file); await saveBook(book); message(status, `已导入《${book.title}》。`); await renderLibrary(); } catch (error) { message(status, errorMessage(error, '本地保存失败，请重试。')); } finally { input.value = ''; input.disabled = false; } });
byId('back-library')?.addEventListener('click', () => { void runAction(async () => { await persistProgress(); currentBook = null; readerView?.setAttribute('hidden', ''); libraryView?.removeAttribute('hidden'); await renderLibrary(); }, readerStatus, '返回书架失败，请重试。'); }); byId('toggle-bookmark')?.addEventListener('click', () => { void runAction(toggleBookmark, readerStatus, '书签保存失败，请检查浏览器本地存储。'); }); byId('previous-page')?.addEventListener('click', () => page(-1)); byId('next-page')?.addEventListener('click', () => page(1)); bookText?.addEventListener('scroll', () => scheduleSave());
for (const id of ['font-size','line-height','theme']) byId(id)?.addEventListener('input', () => { void runAction(updateSettings, readerStatus, '排版设置保存失败，请检查浏览器本地存储。'); });
document.addEventListener('keydown', (event) => { const target = event.target; if (target instanceof HTMLInputElement || target instanceof globalThis.HTMLSelectElement || target instanceof globalThis.HTMLTextAreaElement || !currentBook) return; if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) { event.preventDefault(); page(1); } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) { event.preventDefault(); page(-1); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') scheduleSave(true); });
globalThis.addEventListener('pagehide', () => scheduleSave(true));

try { applySettings(await getReaderSettings()); await renderLibrary(); } catch { message(status, '无法打开本地书库，数据将无法保存。'); }
