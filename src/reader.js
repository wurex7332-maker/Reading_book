const MAX_BOOK_BYTES = 5 * 1024 * 1024;
const CHAPTER_LIMIT = 500;

export class ReaderError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.name = 'ReaderError'; this.code = code; }
}

/** @param {ArrayBuffer} bytes */
async function digest(bytes) {
  try {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('');
  } catch { throw new ReaderError('FILE_READ_FAILED', '无法读取文件，请重新选择。'); }
}

/** @param {ArrayBuffer} bytes */
function decode(bytes) {
  for (const encoding of /** @type {const} */ (['utf-8', 'gbk'])) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      if (!text.includes('\uFFFD')) return { text, encoding };
    } catch { /* Try the next MVP encoding. */ }
  }
  throw new ReaderError('UNSUPPORTED_ENCODING', '无法识别文本编码，仅支持 UTF-8 或 GBK。');
}

/** @param {File} file */
export async function readTextBook(file) {
  if (!/\.txt$/i.test(file.name)) throw new ReaderError('UNSUPPORTED_FILE_TYPE', '请选择 TXT 文件。');
  if (file.size > MAX_BOOK_BYTES) throw new ReaderError('FILE_TOO_LARGE', '请选择不超过 5 MB 的 TXT 文件。');
  /** @type {ArrayBuffer} */
  let bytes;
  try { bytes = await file.arrayBuffer(); } catch { throw new ReaderError('FILE_READ_FAILED', '无法读取文件，请重新选择。'); }
  const { text, encoding } = decode(bytes);
  if (!text.trim()) throw new ReaderError('EMPTY_BOOK', '文件没有可阅读的内容。');
  const contentHash = await digest(bytes);
  return { bookId: `book:${contentHash}`, title: file.name.slice(0, -4).trim() || '未命名书籍', text, encoding, chapters: parseChapters(text), contentHash };
}

/** @param {string} text */
export function parseChapters(text) {
  const heading = /^\s*(第[0-9零〇一二两三四五六七八九十百千万]+[章回节卷篇部集](?:[^\r\n]{0,40})?)\s*$/gm;
  const chapters = [];
  for (const match of text.matchAll(heading)) {
    if (chapters.length === CHAPTER_LIMIT) break;
    chapters.push({ id: `chapter-${chapters.length + 1}`, title: match[1].trim(), offset: (match.index ?? 0) + match[0].indexOf(match[1]) });
  }
  if (chapters.length) return chapters;
  const paragraph = /\S(?:[^\r\n]|\r?\n(?!\s*\r?\n))*\S|\S/g;
  for (const match of text.matchAll(paragraph)) {
    if (chapters.length === CHAPTER_LIMIT) break;
    const firstLine = match[0].split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
    if (firstLine) chapters.push({ id: `section-${chapters.length + 1}`, title: [...firstLine].slice(0, 30).join(''), offset: match.index ?? 0 });
  }
  return chapters;
}

/** @param {number} offset @param {number} textLength */
export function calculateProgress(offset, textLength) {
  if (!Number.isFinite(offset) || !Number.isFinite(textLength) || textLength <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((offset / textLength) * 100)));
}

/**
 * Return sorted block starts while preserving text before the first chapter.
 * @param {Array<{ offset: number }>} chapters
 * @param {number} textLength
 */
export function getReadingBlockOffsets(chapters, textLength) {
  const safeLength = Number.isFinite(textLength) ? Math.max(0, textLength) : 0;
  const offsets = chapters
    .map((chapter) => chapter.offset)
    .filter((offset) => Number.isFinite(offset) && offset >= 0 && offset < safeLength);

  return [...new Set([0, ...offsets])].sort((left, right) => left - right);
}

/**
 * Estimate a stable character offset inside a rendered text block.
 * @param {number} blockOffset
 * @param {number} blockLength
 * @param {number} visiblePixels
 * @param {number} blockPixels
 */
export function calculateReadingOffset(blockOffset, blockLength, visiblePixels, blockPixels) {
  if (![blockOffset, blockLength, visiblePixels, blockPixels].every(Number.isFinite)) return Math.max(0, blockOffset || 0);
  if (blockLength <= 0 || blockPixels <= 0) return Math.max(0, blockOffset);
  const ratio = Math.max(0, Math.min(1, visiblePixels / blockPixels));
  return Math.max(0, Math.round(blockOffset + blockLength * ratio));
}
