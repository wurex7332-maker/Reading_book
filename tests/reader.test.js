import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { calculateProgress, calculateReadingOffset, getReadingBlockOffsets, parseChapters, readTextBook, ReaderError } from '../src/reader.js';
import * as storage from '../src/storage.js';
import { normalizeReaderSettings } from '../src/storage.js';

const VIEWPORT_HEIGHT = 600;
const CHAR_PIXELS = 6;
const CHARACTERS_PER_SCREEN = Math.ceil(VIEWPORT_HEIGHT / CHAR_PIXELS);

/* ------------------------------------------------------------------------- *
 * 内存 IndexedDB 适配层：真实执行 schema、事务、索引游标与提交/回滚语义，
 * 使 storage.js 的持久化行为可以在离线沙箱内被真实断言，并可注入失败。
 * ------------------------------------------------------------------------- */
function createFakeIndexedDb() {
  const state = { version: 0, stores: new Map() };
  const control = { failNextOpen: null, blockOpen: null, failOn: null, writeLog: [] };
  const clone = (value) => (value === undefined ? undefined : globalThis.structuredClone(value));
  const keyFor = (storeName, value) => state.stores.get(storeName)?.keyPath
    ? value[state.stores.get(storeName).keyPath]
    : undefined;

  class FakeRequest {
    constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; }
  }

  class FakeTransaction {
    constructor(storeNames, mode) {
      this.storeNames = storeNames;
      this.mode = mode;
      this.error = null;
      this.aborted = false;
      this.done = false;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this.views = new Map();
      this.pending = 0;
    }

    view(name) {
      if (!this.views.has(name)) {
        const store = state.stores.get(name);
        if (!store) throw new Error(`不存在对象仓库：${name}`);
        this.views.set(name, new Map(store.records));
      }
      return this.views.get(name);
    }

    objectStore(name) { return new FakeStoreHandle(this, name); }

    abort() { this.fail(new Error('事务已中止。')); }

    fail(error) {
      if (this.done || this.aborted) return;
      this.aborted = true;
      this.error = error;
      globalThis.queueMicrotask(() => {
        if (this.done) return;
        this.done = true;
        this.onerror?.(error);
        this.onabort?.(error);
      });
    }

    complete() {
      if (this.done || this.aborted || this.pending > 0) return;
      this.done = true;
      if (this.mode === 'readwrite') {
        for (const [name, records] of this.views) state.stores.get(name).records = records;
      }
      this.oncomplete?.();
    }

    schedule() { globalThis.queueMicrotask(() => this.complete()); }

    consumeFailure(name, op) {
      const rule = control.failOn;
      if (!rule || rule.store !== name || rule.op !== op) return null;
      control.failOn = null;
      return rule.error;
    }

    request(name, produce) {
      const request = new FakeRequest();
      this.pending += 1;
      globalThis.queueMicrotask(() => {
        let produced;
        let failure = null;
        try { produced = produce(); } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
        this.pending -= 1;
        if (failure) {
          request.error = failure;
          request.onerror?.(failure);
          this.fail(failure);
          return;
        }
        request.result = produced;
        request.onsuccess?.();
        this.schedule();
      });
      return request;
    }

    openCursor(name, indexKeyPath, range) {
      const request = new FakeRequest();
      const matches = [...this.view(name).values()]
        .filter((record) => (range && range.only !== undefined ? record[indexKeyPath] === range.only : true))
        .sort((left, right) => String(left[indexKeyPath]).localeCompare(String(right[indexKeyPath])));
      let index = 0;
      const step = () => {
        if (index >= matches.length) {
          request.result = null;
          this.pending -= 1;
          request.onsuccess?.();
          this.schedule();
          return;
        }
        const record = matches[index];
        index += 1;
        request.result = {
          primaryKey: keyFor(name, record),
          key: record[indexKeyPath],
          continue: () => globalThis.queueMicrotask(step),
        };
        request.onsuccess?.();
      };
      this.pending += 1;
      globalThis.queueMicrotask(step);
      return request;
    }
  }

  class FakeStoreHandle {
    constructor(transaction, name) { this.transaction = transaction; this.name = name; }

    put(value) {
      return this.transaction.request(this.name, () => {
        const injected = this.transaction.consumeFailure(this.name, 'put');
        if (injected) throw injected;
        const key = keyFor(this.name, value);
        this.transaction.view(this.name).set(key, clone(value));
        control.writeLog.push(`${this.name}:put`);
        return key;
      });
    }

    get(key) { return this.transaction.request(this.name, () => clone(this.transaction.view(this.name).get(key))); }

    getAll() { return this.transaction.request(this.name, () => [...this.transaction.view(this.name).values()].map(clone)); }

    delete(key) {
      return this.transaction.request(this.name, () => {
        const injected = this.transaction.consumeFailure(this.name, 'delete');
        if (injected) throw injected;
        this.transaction.view(this.name).delete(key);
        control.writeLog.push(`${this.name}:delete`);
        return undefined;
      });
    }

    index(indexName) {
      const store = state.stores.get(this.name);
      const index = store?.indexes.get(indexName);
      if (!index) throw new Error(`不存在索引：${indexName}`);
      return {
        getAll: (key) => this.transaction.request(this.name, () => [...this.transaction.view(this.name).values()]
          .filter((record) => record[index.keyPath] === key)
          .map(clone)),
        openKeyCursor: (range) => this.transaction.openCursor(this.name, index.keyPath, range),
      };
    }
  }

  class FakeDatabase {
    constructor() {
      this.name = 'reading-book';
      this.closed = false;
      this.objectStoreNames = { contains: (name) => state.stores.has(name) };
    }

    createObjectStore(name, options = {}) {
      const store = { keyPath: options.keyPath, records: new Map(), indexes: new Map() };
      state.stores.set(name, store);
      return {
        createIndex: (indexName, keyPath) => {
          store.indexes.set(indexName, { keyPath });
          return { name: indexName, keyPath };
        },
      };
    }

    transaction(names, mode = 'readonly') {
      const list = Array.isArray(names) ? names : [names];
      for (const name of list) if (!state.stores.has(name)) throw new Error(`不存在对象仓库：${name}`);
      return new FakeTransaction(list, mode);
    }

    close() { this.closed = true; }
  }

  const indexedDB = {
    open(_name, version) {
      const request = new FakeRequest();
      const target = version ?? 1;
      globalThis.queueMicrotask(() => {
        if (control.blockOpen) {
          request.error = control.blockOpen;
          request.onerror?.(control.blockOpen);
          return;
        }
        if (control.failNextOpen) {
          const error = control.failNextOpen;
          control.failNextOpen = null;
          request.error = error;
          request.onerror?.(error);
          return;
        }
        const database = new FakeDatabase();
        const previous = state.version;
        request.result = database;
        if (target > previous) {
          state.version = target;
          request.onupgradeneeded?.({ oldVersion: previous, newVersion: target, target: { result: database } });
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    indexedDB,
    keyRange: { only: (value) => ({ only: value }) },
    get version() { return state.version; },
    storeNames: () => [...state.stores.keys()],
    failNextOpen(error = new Error('IndexedDB 打开失败。')) { control.failNextOpen = error; },
    blockOpen(error = new Error('无法打开本地书库。')) { control.blockOpen = error; },
    failOn(store, op, error = new Error('注入的事务失败。')) { control.failOn = { store, op, error }; },
    writes(storeName, op) { return control.writeLog.filter((entry) => entry === `${storeName}:${op}`).length; },
  };
}

/* ------------------------------------------------------------------------- *
 * 最小真实 DOM 适配层：按 index.html 结构实例化元素，并按字符换算块高度，
 * 让跳转、翻屏、续读、设置、书架与书签交互都能被真实断言。
 * ------------------------------------------------------------------------- */
class FakeStyle {
  constructor() { this.properties = new Map(); }
  setProperty(name, value) { this.properties.set(name, String(value)); }
  getPropertyValue(name) { return this.properties.get(name) ?? ''; }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = new FakeStyle();
    this.className = '';
    this.value = '';
    this.type = '';
    this.disabled = false;
    this.clientHeight = 0;
    this.isScroller = false;
    this.text = '';
    this.offset = 0;
  }

  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }

  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }

  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }

  removeAttribute(name) { this.attributes.delete(name); }

  hasAttribute(name) { return this.attributes.has(name); }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  async dispatch(type, init = {}) {
    const event = {
      type,
      target: this,
      shiftKey: false,
      key: '',
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    const results = (this.listeners.get(type) ?? []).map((listener) => listener(event));
    await Promise.all(results);
    return event;
  }

  querySelectorAll(selector) {
    assert.equal(selector, '[data-offset]', '适配层仅支持 [data-offset] 选择器');
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.dataset.offset !== undefined) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  scroller() {
    let node = this;
    while (node) {
      if (node.isScroller) return node;
      node = node.parentElement;
    }
    return null;
  }

  get offsetTop() {
    const parent = this.parentElement;
    if (!parent || !parent.isScroller) return 0;
    let top = 0;
    for (const sibling of parent.children) {
      if (sibling === this) return top;
      top += sibling.scrollHeight;
    }
    return top;
  }

  get scrollHeight() {
    if (this.isScroller) return this.children.reduce((total, child) => total + child.scrollHeight, 0);
    return Math.max(1, Math.round(this.textContent.length * CHAR_PIXELS));
  }

  get scrollTop() { return this.offset; }

  set scrollTop(value) {
    const maximum = Math.max(0, this.scrollHeight - this.clientHeight);
    this.offset = Math.min(maximum, Math.max(0, Number(value) || 0));
  }

  scrollBy(options = {}) { this.scrollTop = this.offset + (options.top ?? 0); }

  getBoundingClientRect() {
    const scroller = this.scroller();
    if (!scroller || scroller === this) return { top: 0, bottom: this.clientHeight, height: this.clientHeight, left: 0, right: 0, width: 0 };
    const top = this.offsetTop - scroller.scrollTop;
    return { top, bottom: top + this.scrollHeight, height: this.scrollHeight, left: 0, right: 0, width: 0 };
  }
}

class FakeInputElement extends FakeElement {
  constructor() { super('input'); this.files = null; }
}

class FakeSelectElement extends FakeElement {
  constructor() { super('select'); }
}

class FakeTextAreaElement extends FakeElement {
  constructor() { super('textarea'); }
}

const ELEMENT_DEFINITIONS = {
  'library-view': 'section',
  'reader-view': 'section',
  'book-file': 'input',
  status: 'p',
  'book-list': 'div',
  'back-library': 'button',
  'book-title': 'h1',
  'toggle-bookmark': 'button',
  toc: 'nav',
  bookmarks: 'div',
  'font-size': 'input',
  'line-height': 'input',
  theme: 'select',
  'reader-status': 'div',
  'book-text': 'article',
  'previous-page': 'button',
  'next-page': 'button',
};

function createFakeDom() {
  const registry = new Map();
  const documentElement = new FakeElement('html');
  const create = (tagName) => {
    if (tagName === 'input') return new FakeInputElement();
    if (tagName === 'select') return new FakeSelectElement();
    if (tagName === 'textarea') return new FakeTextAreaElement();
    return new FakeElement(tagName);
  };

  for (const [id, tagName] of Object.entries(ELEMENT_DEFINITIONS)) {
    const element = create(tagName);
    element.setAttribute('id', id);
    registry.set(id, element);
  }

  const bookText = registry.get('book-text');
  bookText.isScroller = true;
  bookText.clientHeight = VIEWPORT_HEIGHT;
  registry.get('reader-view').setAttribute('hidden', '');
  registry.get('status').setAttribute('role', 'status');

  const document = {
    documentElement,
    visibilityState: 'visible',
    listeners: new Map(),
    getElementById: (id) => registry.get(id) ?? null,
    createElement: (tagName) => create(tagName),
    addEventListener(type, listener) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    },
    async dispatch(type, init = {}) {
      const event = {
        type,
        target: this,
        key: '',
        shiftKey: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...init,
      };
      const results = (this.listeners.get(type) ?? []).map((listener) => listener(event));
      await Promise.all(results);
      return event;
    },
  };

  return { document, registry, bookText };
}

function createClock() {
  let now = 0;
  let sequence = 0;
  const pending = new Map();
  return {
    setTimeout(callback, milliseconds = 0) {
      sequence += 1;
      pending.set(sequence, { at: now + milliseconds, callback });
      return sequence;
    },
    clearTimeout(id) { pending.delete(id); },
    get size() { return pending.size; },
    advance(milliseconds) {
      now += milliseconds;
      for (let guard = 0; guard < 100; guard += 1) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= now);
        if (!due.length) return;
        for (const [id, timer] of due) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function installEnvironment() {
  const indexedDb = createFakeIndexedDb();
  const dom = createFakeDom();
  const clock = createClock();
  const pageListeners = new Map();
  let confirmImplementation = () => false;
  const saved = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    document: globalThis.document,
    addEventListener: globalThis.addEventListener,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    confirm: globalThis.confirm,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  };

  globalThis.indexedDB = indexedDb.indexedDB;
  globalThis.IDBKeyRange = indexedDb.keyRange;
  globalThis.document = dom.document;
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  globalThis.confirm = (message) => confirmImplementation(message);
  globalThis.addEventListener = (type, listener) => {
    const list = pageListeners.get(type) ?? [];
    list.push(listener);
    pageListeners.set(type, list);
  };
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.HTMLSelectElement = FakeSelectElement;
  globalThis.HTMLTextAreaElement = FakeTextAreaElement;

  return {
    indexedDb,
    dom,
    clock,
    setConfirm(implementation) { confirmImplementation = implementation; },
    async firePageEvent(type) {
      const results = (pageListeners.get(type) ?? []).map((listener) => listener({ type }));
      await Promise.all(results);
    },
    restore() {
      globalThis.indexedDB = saved.indexedDB;
      globalThis.IDBKeyRange = saved.IDBKeyRange;
      globalThis.document = saved.document;
      globalThis.setTimeout = saved.setTimeout;
      globalThis.clearTimeout = saved.clearTimeout;
      globalThis.confirm = saved.confirm;
      globalThis.HTMLInputElement = saved.HTMLInputElement;
      globalThis.HTMLSelectElement = saved.HTMLSelectElement;
      globalThis.HTMLTextAreaElement = saved.HTMLTextAreaElement;
      if (saved.addEventListener === undefined) delete globalThis.addEventListener;
      else globalThis.addEventListener = saved.addEventListener;
    },
  };
}

let appCounter = 0;

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await delay(0);
}

async function loadApp() {
  appCounter += 1;
  await import(new URL(`../src/main.js?case=${appCounter}`, import.meta.url).href);
  await settle();
}

function chapterSample(count = 5, seed = '') {
  const numbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return Array.from({ length: count }, (_, index) => `第${numbers[index]}章 标题${index + 1}\n${'正文内容'.repeat(50)}${seed}\n`).join('\n');
}

function collectTags(element, tags = []) {
  for (const child of element.children) {
    tags.push(child.tagName);
    collectTags(child, tags);
  }
  return tags;
}

function shelfCards(env) {
  return env.dom.registry.get('book-list').children;
}

function shelfTitles(env) {
  return shelfCards(env).map((card) => (card.children[0] ? card.children[0].textContent : card.textContent));
}

function actionButton(card, label) {
  const button = card.children[2].children.find((child) => child.textContent === label);
  assert.ok(button, `书架上未找到「${label}」按钮`);
  return button;
}

function scrollToOffset(env, offset) {
  const bookText = env.dom.bookText;
  const blocks = bookText.querySelectorAll('[data-offset]');
  const block = blocks.filter((node) => Number(node.dataset.offset) <= offset).at(-1);
  assert.ok(block, '未找到目标正文块');
  const blockOffset = Number(block.dataset.offset);
  const ratio = block.textContent.length ? (offset - blockOffset) / block.textContent.length : 0;
  bookText.scrollTop = block.offsetTop + block.scrollHeight * ratio;
  return block;
}

function currentOffset(env) {
  const bookText = env.dom.bookText;
  const readerTop = bookText.getBoundingClientRect().top;
  const blocks = bookText.querySelectorAll('[data-offset]');
  const block = blocks.find((node) => node.getBoundingClientRect().bottom >= readerTop) ?? blocks.at(-1);
  const blockTop = block.getBoundingClientRect().top;
  return calculateReadingOffset(
    Number(block.dataset.offset),
    block.textContent.length,
    readerTop - blockTop,
    block.scrollHeight,
  );
}

async function openFirstBook(env) {
  const card = shelfCards(env)[0];
  assert.ok(card, '书架为空，无法打开书籍');
  await actionButton(card, '打开').dispatch('click');
  await settle();
}

/* ------------------------------------------------------------------------- *
 * 纯逻辑与 reader 契约
 * ------------------------------------------------------------------------- */
test('[AC-1] 导入 UTF-8、BOM UTF-8 与 GBK 并生成稳定书籍标识', async () => {
  const utf8 = await readTextBook(new File(['第一章\n正文'], '故事.TXT'));
  const bom = await readTextBook(new File([new Uint8Array([0xef, 0xbb, 0xbf]), '正文'], '书.txt'));
  const gbk = await readTextBook(new File([new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])], '问候.txt'));
  assert.equal(utf8.title, '故事'); assert.equal(utf8.encoding, 'utf-8'); assert.equal(utf8.bookId, `book:${utf8.contentHash}`); assert.equal(utf8.contentHash.length, 64);
  assert.equal(bom.text, '正文'); assert.equal(gbk.text, '你好'); assert.equal(gbk.encoding, 'gbk');
  assert.equal((await readTextBook(new File(['第一章\n正文'], '另一个名字.txt'))).bookId, utf8.bookId);
});

test('[AC-1] 非 TXT、超限、空白、损坏读取返回稳定错误码', async () => {
  const cases = [
    [new File(['x'], 'book.pdf'), 'UNSUPPORTED_FILE_TYPE', '请选择 TXT 文件。'],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'book.txt'), 'FILE_TOO_LARGE', '请选择不超过 5 MB 的 TXT 文件。'],
    [new File([' \n'], 'book.txt'), 'EMPTY_BOOK', '文件没有可阅读的内容。'],
    [new File([new Uint8Array([0x81])], 'book.txt'), 'UNSUPPORTED_ENCODING', '无法识别文本编码，仅支持 UTF-8 或 GBK。'],
    [{ name:'book.txt', size:1, arrayBuffer:async () => { throw new Error('broken'); } }, 'FILE_READ_FAILED', '无法读取文件，请重新选择。'],
  ];
  for (const [file, code, message] of cases) {
    await assert.rejects(
      readTextBook(file),
      (error) => error instanceof ReaderError && error.code === code && error.message === message,
    );
  }
});

test('[AC-2] 章节标题和空行分段生成精确且有上限的目录', () => {
  const text = '序言\n\n第一章 开始\n正文\n第12回\n内容\n第二卷 标题\n尾声';
  const chapters = parseChapters(text);
  assert.deepEqual(chapters.map(({ title, offset }) => ({ title, offset })), [
    { title:'第一章 开始', offset:text.indexOf('第一章') }, { title:'第12回', offset:text.indexOf('第12回') }, { title:'第二卷 标题', offset:text.indexOf('第二卷') },
  ]);
  const sections = parseChapters(`  ${'首段标题'.repeat(12)}\r\n正文\r\n\r\n\r\n第二段`);
  assert.equal([...sections[0].title].length, 30); assert.equal(sections.length, 2); assert.ok(parseChapters(Array.from({ length:600 }, (_, index) => `段落${index}`).join('\n\n')).length <= 500);
});

test('[AC-2] 阅读分块保留第一章之前的序言和全部正文', () => {
  const text = '序言内容\n\n第一章 开始\n正文\n第二章 继续\n尾声';
  const chapters = parseChapters(text);
  const offsets = getReadingBlockOffsets(chapters, text.length);
  const rendered = offsets
    .map((offset, index) => text.slice(offset, offsets[index + 1] ?? text.length))
    .join('');

  assert.equal(offsets[0], 0);
  assert.equal(rendered, text);
});

test('[AC-5] 损坏或越界排版设置会被钳制并回退主题', () => {
  assert.deepEqual(normalizeReaderSettings({ fontSize:99, lineHeight:0, theme:'unknown' }), { fontSize:32, lineHeight:1.4, theme:'day' });
  assert.deepEqual(normalizeReaderSettings(null), { fontSize:18, lineHeight:1.8, theme:'day' });
});

test('[AC-6] 阅读进度四舍五入并限制在有效范围', () => {
  assert.equal(calculateProgress(49, 100), 49); assert.equal(calculateProgress(999, 100), 100); assert.equal(calculateProgress(-1, 100), 0); assert.equal(calculateProgress(3, 0), 0);
  assert.equal(calculateReadingOffset(1000, 2000, 250, 1000), 1500);
  assert.equal(calculateReadingOffset(1000, 2000, -100, 1000), 1000);
  assert.equal(calculateReadingOffset(1000, 2000, 5000, 1000), 3000);
});

test('[AC-9] 接近 5 MB 的确定性文本线性解析且正文保持完整', async () => {
  const paragraph = '这是用于性能验证的固定段落。'.repeat(20); const text = Array.from({ length:5000 }, (_, index) => `${paragraph}${index}`).join('\n\n');
  const book = await readTextBook(new File([text], '大部头.txt'));
  assert.equal(book.text.length, text.length); assert.equal(book.chapters.length, 500);
});

/* ------------------------------------------------------------------------- *
 * 存储层真实行为
 * ------------------------------------------------------------------------- */
test('[AC-1] [AC-8] 书籍写入后可读、重复导入保留 createdAt 与既有进度书签', async () => {
  const env = installEnvironment();
  try {
    const book = await readTextBook(new File([chapterSample(2)], '重复导入.txt'));
    await storage.saveBook(book);
    const saved = await storage.getBook(book.bookId);
    assert.equal(saved.title, '重复导入');
    assert.equal(saved.text, book.text);
    assert.equal(saved.chapters.length, 2);
    const createdAt = saved.createdAt;

    await storage.saveProgress({ bookId: book.bookId, position: { offset: 40, chapterId: 'chapter-1' }, percent: 10, updatedAt: new Date().toISOString(), deviceId: 'device-a' });
    await storage.saveBookmark({ bookmarkId: 'bookmark-a', bookId: book.bookId, position: { offset: 40, chapterId: 'chapter-1' }, label: '标记', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-a' });

    await storage.saveBook({ ...book, title: '重复导入（改名）' });
    const updated = await storage.getBook(book.bookId);
    assert.equal(updated.title, '重复导入（改名）');
    assert.equal(updated.createdAt, createdAt, '重复导入必须保留 createdAt');
    assert.equal((await storage.getProgress(book.bookId)).position.offset, 40, '重复导入不得清除进度');
    assert.equal((await storage.listBookmarks(book.bookId)).length, 1, '重复导入不得清除书签');
  } finally {
    env.restore();
  }
});

test('[AC-3] 移除书籍在单个事务内级联删除书与书签且不触碰其他书籍与设置', async () => {
  const env = installEnvironment();
  try {
    const first = await readTextBook(new File([chapterSample(2, '甲')], '第一本.txt'));
    const second = await readTextBook(new File([chapterSample(2, '乙')], '第二本.txt'));
    await storage.saveBook(first);
    await storage.saveBook(second);
    await storage.saveProgress({ bookId: first.bookId, position: { offset: 10, chapterId: null }, percent: 5, updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveBookmark({ bookmarkId: 'first-mark', bookId: first.bookId, position: { offset: 10, chapterId: null }, label: '甲', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveBookmark({ bookmarkId: 'second-mark', bookId: second.bookId, position: { offset: 10, chapterId: null }, label: '乙', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveReaderSettings({ fontSize: 22, lineHeight: 2, theme: 'night' });

    await storage.removeBook(first.bookId);

    assert.equal(await storage.getBook(first.bookId), null);
    assert.equal(await storage.getProgress(first.bookId), null);
    assert.deepEqual(await storage.listBookmarks(first.bookId), []);
    assert.ok(await storage.getBook(second.bookId), '其他书籍不得被删除');
    assert.equal((await storage.listBookmarks(second.bookId)).length, 1, '其他书籍的书签不得被删除');
    assert.deepEqual(await storage.getReaderSettings(), { fontSize: 22, lineHeight: 2, theme: 'night' }, '全局设置不得被删除');
  } finally {
    env.restore();
  }
});

test('[AC-3] 级联删除遇到事务失败时 reject 且不留下部分删除状态', async () => {
  const env = installEnvironment();
  try {
    const book = await readTextBook(new File([chapterSample(2)], '回滚.txt'));
    await storage.saveBook(book);
    await storage.saveProgress({ bookId: book.bookId, position: { offset: 30, chapterId: null }, percent: 8, updatedAt: '2026-01-03T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveBookmark({ bookmarkId: 'rollback-mark', bookId: book.bookId, position: { offset: 30, chapterId: null }, label: '回滚', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', deviceId: 'device-a' });

    env.indexedDb.failOn('progress', 'delete');
    await assert.rejects(storage.removeBook(book.bookId), /注入的事务失败|本地保存失败|事务/);

    assert.ok(await storage.getBook(book.bookId), '失败后书籍必须仍存在');
    assert.ok(await storage.getProgress(book.bookId), '失败后进度必须仍存在');
    assert.equal((await storage.listBookmarks(book.bookId)).length, 1, '失败后书签必须仍存在');
  } finally {
    env.restore();
  }
});

test('[AC-8] 关闭并重新打开数据库后数据一致且重复 v1 初始化不清空', async () => {
  const env = installEnvironment();
  try {
    const book = await readTextBook(new File([chapterSample(3)], '重启.txt'));
    await storage.saveBook(book);
    await storage.saveProgress({ bookId: book.bookId, position: { offset: 60, chapterId: 'chapter-1' }, percent: 12, updatedAt: '2026-01-04T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveBookmark({ bookmarkId: 'restart-mark', bookId: book.bookId, position: { offset: 60, chapterId: 'chapter-1' }, label: '重启', createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveReaderSettings({ fontSize: 20, lineHeight: 1.9, theme: 'night' });
    const deviceId = await storage.getDeviceId();

    assert.equal(env.indexedDb.version, 1);
    assert.deepEqual(env.indexedDb.storeNames().sort(), ['bookmarks', 'books', 'progress', 'settings']);

    assert.equal((await storage.getBook(book.bookId)).text, book.text);
    assert.equal((await storage.getProgress(book.bookId)).position.offset, 60);
    assert.equal((await storage.listBookmarks(book.bookId)).length, 1);
    assert.deepEqual(await storage.getReaderSettings(), { fontSize: 20, lineHeight: 1.9, theme: 'night' });
    assert.equal(await storage.getDeviceId(), deviceId, 'deviceId 必须复用已生成值');
    assert.equal((await storage.listBooks()).length, 1, '重复初始化不得清空书架');
  } finally {
    env.restore();
  }
});

/* ------------------------------------------------------------------------- *
 * 界面与交互真实行为
 * ------------------------------------------------------------------------- */
test('[AC-1] 导入成功后写入存储并出现在书架，失败导入不留下任何记录', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');

    input.files = [new File([chapterSample(2)], '界面导入.txt')];
    await input.dispatch('change');
    await settle();

    assert.equal(env.dom.registry.get('status').textContent, '已导入《界面导入》。');
    assert.deepEqual(shelfTitles(env), ['界面导入']);
    const [record] = await storage.listBooks();
    assert.equal(record.title, '界面导入');
    assert.equal(record.percent, 0);
    assert.equal(input.disabled, false, '导入结束后必须恢复文件输入');
    assert.equal(input.value, '', '导入结束后必须清空文件输入');

    input.files = [new File(['x'], '不是书.pdf')];
    await input.dispatch('change');
    await settle();
    assert.equal(env.dom.registry.get('status').textContent, '请选择 TXT 文件。');
    assert.equal((await storage.listBooks()).length, 1, '失败导入不得写入存储');
    assert.deepEqual(shelfTitles(env), ['界面导入']);
  } finally {
    env.restore();
  }
});

test('[AC-1] [AC-7] 恶意书名、正文与书签摘要只以纯文本渲染', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const hostileName = '<img src=x onerror=alert(1)>.txt';
    input.files = [new File([`<script>alert(1)</script>\n\n第一章 开始\n${'正文'.repeat(30)}`], hostileName)];
    await input.dispatch('change');
    await settle();

    assert.deepEqual(shelfTitles(env), ['<img src=x onerror=alert(1)>']);
    assert.equal(collectTags(env.dom.registry.get('book-list')).includes('IMG'), false, '书名不得生成 HTML 元素');

    await openFirstBook(env);
    const bookText = env.dom.bookText;
    assert.ok(bookText.children[0].textContent.startsWith('<script>alert(1)</script>'), '正文必须以原始文本渲染');
    assert.equal(collectTags(bookText).includes('SCRIPT'), false, '正文不得生成脚本元素');
    assert.equal(env.dom.registry.get('book-title').textContent, '<img src=x onerror=alert(1)>');

    await env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();
    const [bookmark] = await storage.listBookmarks((await storage.listBooks())[0].bookId);
    assert.ok(bookmark.label.startsWith('<script>alert(1)</script>'));
    assert.equal(bookmark.label.includes('<'), true, '摘要按原样保留纯文本');
    assert.equal(collectTags(env.dom.registry.get('bookmarks')).includes('SCRIPT'), false, '摘要不得生成脚本元素');
  } finally {
    env.restore();
  }
});

test('[AC-2] 目录点击跳转到目标块并把目标位置写入进度', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const book = await readTextBook(new File([chapterSample(5)], '跳转.txt'));
    input.files = [new File([book.text], '跳转.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    const tocButtons = env.dom.registry.get('toc').children;
    assert.equal(tocButtons.length, 5);
    assert.equal(tocButtons[0].textContent, '第一章 标题1');

    const target = book.chapters[3];
    await tocButtons[3].dispatch('click');
    await settle();
    env.clock.advance(300);
    await settle();

    const blocks = env.dom.bookText.querySelectorAll('[data-offset]');
    const targetBlock = blocks.filter((node) => Number(node.dataset.offset) <= target.offset).at(-1);
    const blockTop = targetBlock.offsetTop;
    const scrollTop = env.dom.bookText.scrollTop;
    assert.ok(blockTop >= scrollTop - 1, '目标块顶部不能被滚出视口');
    assert.ok(blockTop <= scrollTop + env.dom.bookText.clientHeight, '目标块必须落在可视区域内');

    const progress = await storage.getProgress(book.bookId);
    assert.ok(progress, '跳转后必须保存进度');
    assert.ok(Math.abs(progress.position.offset - target.offset) <= CHARACTERS_PER_SCREEN, `进度误差 ${progress.position.offset - target.offset} 超过一屏`);
    assert.equal(progress.position.chapterId, target.id);
  } finally {
    env.restore();
  }
});

test('[AC-3] 书架按最近更新排序，打开条目进入阅读视图，取消移除零副作用', async () => {
  const env = installEnvironment();
  try {
    const older = await readTextBook(new File([chapterSample(2, '旧')], '旧书.txt'));
    const newer = await readTextBook(new File([chapterSample(2, '新')], '新书.txt'));
    await storage.saveBook(older);
    await storage.saveBook(newer);
    await storage.saveProgress({ bookId: older.bookId, position: { offset: 100, chapterId: null }, percent: 33, updatedAt: '2026-02-01T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveProgress({ bookId: newer.bookId, position: { offset: 200, chapterId: null }, percent: 66, updatedAt: '2026-03-01T00:00:00.000Z', deviceId: 'device-a' });

    await loadApp();
    assert.deepEqual(shelfTitles(env), ['新书', '旧书'], '书架必须按更新时间降序');
    assert.match(shelfCards(env)[0].children[1].textContent, /^66% · /);

    env.setConfirm(() => false);
    await actionButton(shelfCards(env)[0], '移除').dispatch('click');
    await settle();
    assert.deepEqual(shelfTitles(env), ['新书', '旧书'], '取消移除不得改变书架');
    assert.equal((await storage.listBooks()).length, 2);

    await openFirstBook(env);
    assert.equal(env.dom.registry.get('reader-view').hasAttribute('hidden'), false);
    assert.equal(env.dom.registry.get('library-view').hasAttribute('hidden'), true);
    assert.equal(env.dom.registry.get('book-title').textContent, '新书');
    assert.equal(env.dom.bookText.children.length >= 2, true, '正文必须分块渲染');
  } finally {
    env.restore();
  }
});

test('[AC-3] 确认移除后书籍、进度与书签全部消失且设置保留', async () => {
  const env = installEnvironment();
  try {
    const book = await readTextBook(new File([chapterSample(2)], '待移除.txt'));
    await storage.saveBook(book);
    await storage.saveProgress({ bookId: book.bookId, position: { offset: 80, chapterId: null }, percent: 20, updatedAt: '2026-04-01T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveBookmark({ bookmarkId: 'remove-mark', bookId: book.bookId, position: { offset: 80, chapterId: null }, label: '待移除', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', deviceId: 'device-a' });
    await storage.saveReaderSettings({ fontSize: 26, lineHeight: 2.2, theme: 'day' });

    await loadApp();
    let prompt = '';
    env.setConfirm((message) => { prompt = message; return true; });
    await actionButton(shelfCards(env)[0], '移除').dispatch('click');
    await settle();

    assert.match(prompt, /待移除/, '确认对话必须包含书名');
    assert.deepEqual(shelfTitles(env), ['书架还是空的，请导入一本 TXT。']);
    assert.equal((await storage.listBooks()).length, 0);
    assert.equal(await storage.getProgress(book.bookId), null);
    assert.equal((await storage.listBookmarks(book.bookId)).length, 0);
    assert.deepEqual(await storage.getReaderSettings(), { fontSize: 26, lineHeight: 2.2, theme: 'day' }, '移除书籍后设置必须保留');
  } finally {
    env.restore();
  }
});

test('[AC-4] 翻屏按钮移动约 90% 视口高度并在首尾钳制', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    input.files = [new File([chapterSample(8)], '翻屏.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    const bookText = env.dom.bookText;
    const step = Math.round(bookText.clientHeight * 0.9);
    assert.ok(bookText.scrollHeight > bookText.clientHeight * 3, '样本必须足以翻屏');

    await env.dom.registry.get('next-page').dispatch('click');
    assert.equal(bookText.scrollTop, step, '下一屏必须移动约 90% 视口高度');

    for (let index = 0; index < 20; index += 1) await env.dom.registry.get('next-page').dispatch('click');
    assert.equal(bookText.scrollTop, bookText.scrollHeight - bookText.clientHeight, '到达结尾必须钳制在最大滚动位置');
    assert.ok(bookText.scrollTop <= bookText.scrollHeight - bookText.clientHeight);

    for (let index = 0; index < 40; index += 1) await env.dom.registry.get('previous-page').dispatch('click');
    assert.equal(bookText.scrollTop, 0, '到达开头必须钳制在 0，不得出现负偏移');
  } finally {
    env.restore();
  }
});

test('[AC-4] 键盘翻屏生效且输入控件聚焦时不劫持按键', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    input.files = [new File([chapterSample(8)], '键盘.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    const bookText = env.dom.bookText;
    const step = Math.round(bookText.clientHeight * 0.9);

    const pageDown = await env.dom.document.dispatch('keydown', { key: 'PageDown', target: bookText });
    assert.equal(pageDown.defaultPrevented, true, '阅读区 PageDown 必须被处理');
    assert.equal(bookText.scrollTop, step);

    const shiftSpace = await env.dom.document.dispatch('keydown', { key: ' ', shiftKey: true, target: bookText });
    assert.equal(shiftSpace.defaultPrevented, true);
    assert.equal(bookText.scrollTop, 0);

    const before = bookText.scrollTop;
    const inInput = await env.dom.document.dispatch('keydown', { key: 'PageDown', target: env.dom.registry.get('font-size') });
    assert.equal(inInput.defaultPrevented, false, '输入控件聚焦时不得拦截按键');
    assert.equal(bookText.scrollTop, before, '输入控件聚焦时阅读区不得滚动');
  } finally {
    env.restore();
  }
});

test('[AC-5] 排版设置即时生效、被持久化并在重新初始化后恢复', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const font = env.dom.registry.get('font-size');
    const line = env.dom.registry.get('line-height');
    const theme = env.dom.registry.get('theme');
    assert.equal(env.dom.document.documentElement.style.getPropertyValue('--reader-font'), '18px', '默认字号必须生效');

    font.value = '24';
    await font.dispatch('input');
    await settle();
    assert.equal(env.dom.document.documentElement.style.getPropertyValue('--reader-font'), '24px', '字号必须即时生效');

    line.value = '2.1';
    await line.dispatch('input');
    await settle();
    assert.equal(env.dom.document.documentElement.style.getPropertyValue('--reader-line'), '2.1');

    theme.value = 'night';
    await theme.dispatch('input');
    await settle();
    assert.equal(env.dom.document.documentElement.dataset.theme, 'night', '主题必须即时生效');
    assert.deepEqual(await storage.getReaderSettings(), { fontSize: 24, lineHeight: 2.1, theme: 'night' }, '设置必须持久化');

    const restoredElement = new FakeElement('html');
    env.dom.document.documentElement = restoredElement;
    await loadApp();
    assert.equal(restoredElement.style.getPropertyValue('--reader-font'), '24px', '重新初始化必须恢复字号');
    assert.equal(restoredElement.style.getPropertyValue('--reader-line'), '2.1');
    assert.equal(restoredElement.dataset.theme, 'night');
    assert.equal(env.dom.registry.get('font-size').value, '24');
    assert.equal(env.dom.registry.get('line-height').value, '2.1');
    assert.equal(env.dom.registry.get('theme').value, 'night');
  } finally {
    env.restore();
  }
});

test('[AC-6] 滚动保存按 200–500ms 节流且进度字段完整', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const book = await readTextBook(new File([chapterSample(5)], '节流.txt'));
    input.files = [new File([book.text], '节流.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    const bookText = env.dom.bookText;
    for (let index = 1; index <= 8; index += 1) {
      bookText.scrollTop = index * 120;
      await bookText.dispatch('scroll');
    }
    assert.equal(env.indexedDb.writes('progress', 'put'), 0, '滚动事件不得立即写库');

    env.clock.advance(299);
    await settle();
    assert.equal(env.indexedDb.writes('progress', 'put'), 0, '300ms 节流窗口内不得写库');

    env.clock.advance(1);
    await settle();
    assert.equal(env.indexedDb.writes('progress', 'put'), 1, '8 次滚动只允许一次写入');

    const progress = await storage.getProgress(book.bookId);
    assert.equal(progress.bookId, book.bookId);
    assert.equal(typeof progress.position.offset, 'number');
    assert.ok(progress.position.offset > 0);
    assert.equal(progress.percent, calculateProgress(progress.position.offset, book.text.length));
    assert.equal(typeof progress.updatedAt, 'string');
    assert.match(progress.deviceId, /^[0-9a-f-]{36}$/, 'deviceId 必须是生成的 UUID');
  } finally {
    env.restore();
  }
});

test('[AC-6] 页面进入 hidden 或 pagehide 时立即保存最新位置', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    input.files = [new File([chapterSample(5)], '隐藏.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    env.dom.bookText.scrollTop = 900;
    await env.dom.bookText.dispatch('scroll');
    env.clock.advance(300);
    await settle();
    const afterThrottle = env.indexedDb.writes('progress', 'put');
    assert.equal(afterThrottle, 1);

    env.dom.bookText.scrollTop = 1500;
    env.dom.document.visibilityState = 'hidden';
    await env.dom.document.dispatch('visibilitychange');
    await settle();
    assert.equal(env.indexedDb.writes('progress', 'put'), afterThrottle + 1, 'hidden 必须立即落盘');
    const [record] = await storage.listBooks();
    const hiddenOffset = (await storage.getProgress(record.bookId)).position.offset;

    env.dom.document.visibilityState = 'visible';
    env.dom.bookText.scrollTop = 600;
    await env.dom.bookText.dispatch('scroll');
    await env.firePageEvent('pagehide');
    await settle();
    assert.equal(env.indexedDb.writes('progress', 'put'), afterThrottle + 2, 'pagehide 必须立即落盘');
    assert.notEqual((await storage.getProgress(record.bookId)).position.offset, hiddenOffset, 'pagehide 必须提交最新位置');
  } finally {
    env.restore();
  }
});

test('[AC-6] 重新打开后恢复到上次位置（误差不超过一屏）且书架百分比同步', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const book = await readTextBook(new File([chapterSample(6)], '续读.txt'));
    input.files = [new File([book.text], '续读.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    const targetOffset = book.chapters[3].offset + 40;
    scrollToOffset(env, targetOffset);
    await env.dom.bookText.dispatch('scroll');
    env.clock.advance(300);
    await settle();
    const saved = await storage.getProgress(book.bookId);
    assert.ok(Math.abs(saved.position.offset - targetOffset) <= 1, `保存位置 ${saved.position.offset} 应等于目标 ${targetOffset}`);

    await loadApp();
    env.dom.bookText.scrollTop = 0;
    await openFirstBook(env);
    const restored = currentOffset(env);
    assert.ok(Math.abs(restored - saved.position.offset) <= CHARACTERS_PER_SCREEN, `续读误差 ${Math.abs(restored - saved.position.offset)} 超过一屏`);

    await env.dom.registry.get('back-library').dispatch('click');
    await settle();
    assert.equal(env.dom.registry.get('library-view').hasAttribute('hidden'), false);
    assert.equal(env.dom.registry.get('reader-view').hasAttribute('hidden'), true);
    const card = shelfCards(env)[0];
    const persisted = await storage.getProgress(book.bookId);
    assert.equal(persisted.percent, calculateProgress(persisted.position.offset, book.text.length));
    assert.ok(persisted.percent > 0, '返回书架前必须已保存有效进度');
    assert.match(card.children[1].textContent, new RegExp(`^${persisted.percent}%`), '书架百分比必须与已保存进度一致');
  } finally {
    env.restore();
  }
});

test('[AC-6] [AC-8] 进度保存失败时给出明确提示且不宣称成功', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const book = await readTextBook(new File([chapterSample(4)], '保存失败.txt'));
    input.files = [new File([book.text], '保存失败.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    env.indexedDb.failOn('progress', 'put');
    env.dom.bookText.scrollTop = 500;
    await env.dom.bookText.dispatch('scroll');
    env.clock.advance(300);
    await settle();

    assert.equal(env.dom.registry.get('reader-status').textContent, '阅读进度保存失败，请检查浏览器本地存储。');
    assert.equal(await storage.getProgress(book.bookId), null, '失败时不得留下虚假成功记录');
  } finally {
    env.restore();
  }
});

test('[AC-7] 书签添加、按书隔离、点击回跳与删除持久化', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const book = await readTextBook(new File([chapterSample(5)], '书签.txt'));
    input.files = [new File([book.text], '书签.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    const bookmarks = env.dom.registry.get('bookmarks');
    assert.equal(bookmarks.children[0].textContent, '暂无书签', '空列表必须显示空状态');

    scrollToOffset(env, book.chapters[2].offset + 10);
    env.clock.advance(300);
    await settle();
    await env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();

    const afterAdd = await storage.listBookmarks(book.bookId);
    assert.equal(afterAdd.length, 1);
    assert.equal(afterAdd[0].bookId, book.bookId);
    assert.equal(afterAdd[0].position.chapterId, book.chapters[2].id);
    assert.equal(typeof afterAdd[0].position.offset, 'number');
    assert.equal(afterAdd[0].label.length > 0, true);
    assert.equal(bookmarks.children.length, 1, '书签列表必须只渲染当前书籍记录');
    assert.equal(bookmarks.children[0].textContent, afterAdd[0].label);

    const savedOffset = afterAdd[0].position.offset;
    env.dom.bookText.scrollTop = 0;
    await bookmarks.children[0].dispatch('click');
    await settle();
    assert.ok(Math.abs(currentOffset(env) - savedOffset) <= CHARACTERS_PER_SCREEN, '点击书签必须回到原位置');

    env.dom.bookText.scrollTop = env.dom.bookText.scrollHeight;
    await env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();
    assert.equal((await storage.listBookmarks(book.bookId)).length, 2, '在远处新增书签不得删除原书签');

    const second = await readTextBook(new File([chapterSample(3)], '另一本.txt'));
    await storage.saveBookmark({ bookmarkId: 'other-book-mark', bookId: second.bookId, position: { offset: savedOffset, chapterId: null }, label: '他书', createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z', deviceId: 'device-a' });
    assert.equal((await storage.listBookmarks(book.bookId)).length, 2, '他书书签不得影响当前书籍');
  } finally {
    env.restore();
  }
});

test('[AC-7] 同书 20 字符内的再次操作切换为删除书签', async () => {
  const env = installEnvironment();
  try {
    await loadApp();
    const input = env.dom.registry.get('book-file');
    const book = await readTextBook(new File([chapterSample(5)], '切换.txt'));
    input.files = [new File([book.text], '切换.txt')];
    await input.dispatch('change');
    await settle();
    await openFirstBook(env);

    scrollToOffset(env, 300);
    env.clock.advance(300);
    await settle();
    await env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();
    const [created] = await storage.listBookmarks(book.bookId);
    assert.ok(created);

    scrollToOffset(env, created.position.offset + 12);
    env.clock.advance(300);
    await settle();
    await env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();
    assert.equal((await storage.listBookmarks(book.bookId)).length, 0, '20 字符内必须切换为删除');

    scrollToOffset(env, created.position.offset + 60);
    env.clock.advance(300);
    await settle();
    await env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();
    assert.equal((await storage.listBookmarks(book.bookId)).length, 1, '距离超过 20 字符必须新增书签');

    const remaining = await storage.listBookmarks(book.bookId);
    env.dom.registry.get('bookmarks').children[0].dispatch('click');
    await settle();
    env.dom.registry.get('toggle-bookmark').dispatch('click');
    await settle();
    assert.equal((await storage.listBookmarks(book.bookId)).length, 0, '删除后必须不再存在');
    assert.ok(remaining.length === 1);
  } finally {
    env.restore();
  }
});

test('[AC-8] 本地数据库打开失败时提示且不崩溃、不产生半成功写入', async () => {
  const env = installEnvironment();
  try {
    env.indexedDb.blockOpen();
    await loadApp();

    assert.equal(env.dom.registry.get('status').textContent, '无法打开本地书库，数据将无法保存。');
    assert.deepEqual(shelfTitles(env), [], '打开失败时书架必须是空列表');
    assert.equal(env.indexedDb.writes('books', 'put'), 0, '打开失败不得产生写入');

    const input = env.dom.registry.get('book-file');
    input.files = [new File([chapterSample(2)], '失败后导入.txt')];
    await input.dispatch('change');
    await settle();
    assert.equal(env.dom.registry.get('status').textContent, '无法打开本地书库。', '导入失败必须暴露存储错误');
    assert.equal(env.indexedDb.writes('books', 'put'), 0, '存储不可用时不得出现半成功状态');
  } finally {
    env.restore();
  }
});
