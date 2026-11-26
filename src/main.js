import { readTextBook } from './reader.js';

const input = document.querySelector('#book-file');
const title = document.querySelector('#book-title');
const content = document.querySelector('#book-text');
const status = document.querySelector('#status');

if (input instanceof HTMLInputElement && title && content && status) {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    input.disabled = true;
    status.textContent = '正在读取…';
    try {
      const book = await readTextBook(file);
      title.textContent = book.title;
      content.textContent = book.text;
      status.textContent = '';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '无法读取文件，请重新选择。';
    } finally {
      input.value = '';
      input.disabled = false;
    }
  });
}
