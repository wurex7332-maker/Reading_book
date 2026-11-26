const MAX_BOOK_BYTES = 5 * 1024 * 1024;

/** @param {File} file */
export async function readTextBook(file) {
  if (!/\.txt$/i.test(file.name)) {
    throw new Error('请选择 TXT 文件。');
  }
  if (file.size > MAX_BOOK_BYTES) {
    throw new Error('请选择不超过 5 MB 的 TXT 文件。');
  }

  const bytes = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('无法读取文本，请将文件另存为 UTF-8 编码后重试。');
  }

  if (!text.trim()) {
    throw new Error('文件没有可阅读的内容。');
  }

  return { title: file.name.slice(0, -4).trim() || '未命名书籍', text };
}
