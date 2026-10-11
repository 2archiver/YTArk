/**
 * Minimal DOM double used by the YTArk userscript tests.
 *
 * It implements just enough of the platform surface that the mods touch:
 * element/style/attribute access, classList, a tiny selector engine (tag,
 * `.class`, `[attr]`, `[attr="value"]`, comma lists), querySelector(All),
 * closest, MutationObserver, and a settable bounding rect for sizing checks.
 */

export class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value, priority = '') {
    this.values.set(String(name), { value: String(value), priority: String(priority) });
  }
  getPropertyValue(name) { return this.values.get(String(name))?.value || ''; }
  getPropertyPriority(name) { return this.values.get(String(name))?.priority || ''; }
  removeProperty(name) { this.values.delete(String(name)); }
}

function parseSimpleSelectors(part) {
  const simple = [];
  const tokens = String(part).trim().match(/(\[[^\]]+\]|\.[^.\s\[]+|[a-zA-Z0-9_-]+)/g) || [];
  for (const token of tokens) {
    if (token.startsWith('[')) {
      const body = token.slice(1, -1);
      const equals = body.indexOf('=');
      if (equals === -1) simple.push({ type: 'attr', name: body.trim() });
      else {
        const name = body.slice(0, equals).trim();
        let value = body.slice(equals + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        simple.push({ type: 'attrValue', name, value });
      }
    } else if (token.startsWith('.')) {
      simple.push({ type: 'class', value: token.slice(1) });
    } else {
      simple.push({ type: 'tag', value: token.toLowerCase() });
    }
  }
  return simple;
}

export class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = String(tagName).toLowerCase();
    this.nodeType = 1;
    this.style = new FakeStyle();
    this.attributes = new Map();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
    this.isConnected = true;
    this.textContent = '';
    this.__rectHeight = 0;
    this.__rectWidth = 0;
    this.listeners = new Map();
    this.value = '';
    this.classList = {
      add: (name) => this.addClass(name),
      remove: (name) => this.removeClass(name),
      contains: (name) => this.hasClass(name),
    };
  }

  get id() { return this.getAttribute('id') || ''; }

  set id(value) { this.setAttribute('id', value); }

  addClass(name) {
    const current = String(this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    if (!current.includes(name)) current.push(name);
    this.setAttribute('class', current.join(' '));
  }

  removeClass(name) {
    const current = String(this.getAttribute('class') || '')
      .split(/\s+/).filter(Boolean).filter(value => value !== name);
    this.setAttribute('class', current.join(' '));
  }

  hasClass(name) {
    return String(this.getAttribute('class') || '').split(/\s+/).includes(name);
  }

  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  hasAttribute(name) { return this.attributes.has(String(name)); }

  removeAttribute(name) { this.attributes.delete(String(name)); }

  getBoundingClientRect() {
    return { width: this.__rectWidth, height: this.__rectHeight, top: 0, left: 0 };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    child.isConnected = true;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    child.isConnected = false;
    return child;
  }

  walk(visitor) {
    for (const child of this.children) {
      visitor(child);
      child.walk(visitor);
    }
  }

  matches(selector) {
    const parts = String(selector).split(',');
    return parts.some((part) => {
      const simple = parseSimpleSelectors(part);
      if (simple.length === 0) return false;
      return simple.every((entry) => {
        if (entry.type === 'tag') return this.tagName === entry.value;
        if (entry.type === 'class') return this.hasClass(entry.value);
        if (entry.type === 'attr') return this.hasAttribute(entry.name);
        return this.getAttribute(entry.name) === entry.value;
      });
    });
  }

  querySelectorAll(selector) {
    const found = [];
    this.walk((element) => {
      if (element.matches(selector)) found.push(element);
    });
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    let element = this;
    while (element) {
      if (element.matches && element.matches(selector)) return element;
      element = element.parentNode;
    }
    return null;
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child === node || child.contains(node));
  }

  detach() {
    if (this.parentNode) this.parentNode.removeChild(this);
    this.isConnected = false;
    return this;
  }

  remove() {
    this.detach();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    if (!this.listeners.get(type).includes(listener)) this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }

  dispatchEvent(event) {
    const dispatched = event || {};
    if (!dispatched.target) dispatched.target = this;
    for (const listener of [...(this.listeners.get(dispatched.type) || [])]) listener(dispatched);
    return true;
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  focus() {
    const doc = this.ownerDocument || globalThis.document;
    if (doc) doc.activeElement = this;
  }

  blur() {
    const doc = this.ownerDocument || globalThis.document;
    if (doc && doc.activeElement === this) doc.activeElement = doc.body || null;
  }
}

/** A keyboard event double that records propagation/default handling. */
export function keyEvent(type, keyCode, target, extra = {}) {
  return {
    type,
    keyCode,
    which: keyCode,
    key: extra.key,
    target,
    repeat: false,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.propagationStopped = true; },
    ...extra,
  };
}

export class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.active = false;
    this.disconnectCount = 0;
    this.root = null;
    this.options = null;
    FakeMutationObserver.instances.push(this);
  }
  observe(root, options) {
    this.root = root;
    this.options = options;
    this.active = true;
  }
  disconnect() {
    this.active = false;
    this.disconnectCount += 1;
  }
  static reset() { FakeMutationObserver.instances = []; }
  static get activeCount() { return FakeMutationObserver.instances.filter(item => item.active).length; }
}

export function createDocument() {
  const doc = {
    listeners: new Map(),
    head: null,
    body: null,
    createElement(tagName) { return new FakeElement(tagName, doc); },
    createElementNS(_namespace, tagName) { return new FakeElement(tagName, doc); },
    getElementById(id) {
      return doc.documentElement.querySelectorAll(`[id="${id}"]`)[0] || null;
    },
    querySelector(selector) { return doc.documentElement.querySelector(selector); },
    querySelectorAll(selector) { return doc.documentElement.querySelectorAll(selector); },
    addEventListener(type, listener) {
      if (!doc.listeners.has(type)) doc.listeners.set(type, []);
      doc.listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      doc.listeners.set(type, (doc.listeners.get(type) || []).filter(item => item !== listener));
    },
    dispatch(type) {
      for (const listener of doc.listeners.get(type) || []) listener({ type });
    },
  };
  doc.documentElement = new FakeElement('html', doc);
  doc.head = new FakeElement('head', doc);
  doc.body = new FakeElement('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  return doc;
}

export const PLAYER_OVERLAY_SELECTOR = [
  'ytlr-player',
  'ytd-player',
  'html5-video-player',
  'ytlr-watch-default',
  'yt-unified-overlay-stage',
  '[data-player-overlay]',
  '[aria-modal="true"]',
].join(', ');

export function installGlobals({ doc, windowStub, localStorage }) {
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'MutationObserver', {
    value: FakeMutationObserver, configurable: true, writable: true,
  });
  if (windowStub) {
    Object.defineProperty(globalThis, 'window', {
      value: windowStub, configurable: true, writable: true,
    });
  }
  if (localStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorage, configurable: true, writable: true,
    });
  }
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    };
  }
}

export function createWindowStub({ localStorage, doc, colorScheme = 'light' }) {
  const listeners = new Map();
  const timers = new Set();
  const mediaQueries = [];
  const windowStub = {
    localStorage,
    h5vcc: null,
    location: { href: 'https://www.youtube.com/tv', hash: '' },
    listeners,
    timers,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener));
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    dispatch(type) { this.dispatchEvent({ type }); },
    setTimeout(callback, delay, ...args) {
      const id = setTimeout(callback, delay, ...args);
      timers.add(id);
      return id;
    },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
    document: doc,
    /**
     * Minimal style double: the mods only read the computed foreground colour
     * of the header host, which the tests set through the inline style. This is
     * a double for the reduced surface the userscript touches, not a browser.
     */
    getComputedStyle(element) {
      const value = element && element.style
        && typeof element.style.getPropertyValue === 'function'
        ? element.style.getPropertyValue('color') : '';
      return { color: value || '', getPropertyValue: (name) => (name === 'color' ? value || '' : '') };
    },
    matchMedia(query) {
      const media = String(query);
      const mql = {
        media,
        matches: media.includes('dark') && colorScheme === 'dark',
        listeners: [],
        addEventListener(type, listener) {
          if (type === 'change') this.listeners.push(listener);
        },
        removeEventListener(type, listener) {
          this.listeners = this.listeners.filter(item => item !== listener);
        },
        addListener(listener) { this.listeners.push(listener); },
        removeListener(listener) { this.listeners = this.listeners.filter(item => item !== listener); },
        setMatches(value) {
          this.matches = value;
          for (const listener of [...this.listeners]) listener({ matches: value, media });
        },
      };
      mediaQueries.push(mql);
      return mql;
    },
    mediaQueries,
    /** Flip the OS colour preference and notify the registered listeners. */
    setColorScheme(value) {
      colorScheme = value;
      for (const mql of mediaQueries) {
        mql.setMatches(mql.media.includes('dark') && value === 'dark');
      }
    },
  };
  return windowStub;
}

export function createLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { for (const key of Object.keys(store)) delete store[key]; },
    snapshot() { return { ...store }; },
    store,
  };
}

export const waitFor = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
