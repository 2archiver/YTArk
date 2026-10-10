import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value, priority = '') {
    this.values.set(name, { value: String(value), priority: String(priority) });
  }
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  removeProperty(name) { this.values.delete(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toLowerCase();
    this.nodeType = 1;
    this.style = new FakeStyle();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.isConnected = true;
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  matches(selector) { return selector === 'ytlr-logo' && this.tagName === 'ytlr-logo'; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  querySelector(selector) {
    if (selector === 'img, svg, yt-icon') {
      return this.children.find(child => ['img', 'svg', 'yt-icon'].includes(child.tagName)) || null;
    }
    const attrMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (attrMatch) {
      return this.children.find(child => child.getAttribute(attrMatch[1]) === attrMatch[2]) || null;
    }
    if (selector === 'title') return this.children.find(child => child.tagName === 'title') || null;
    if (selector === 'ytlr-logo') {
      return this.children.find(child => child.matches(selector)) || null;
    }
    return null;
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
    return this.children.some(child => child === node || child.contains?.(node));
  }
}

const eventListeners = new Map();
const windowListeners = new Map();
const localStorage = {};
const host = new FakeElement('ytlr-logo');
const artwork = new FakeElement('svg');
artwork.style.setProperty('display', 'inline-block');
host.appendChild(artwork);
const body = new FakeElement('body');
body.appendChild(host);

const documentStub = {
  body,
  readyState: 'complete',
  querySelector(selector) { return selector === 'ytlr-logo' ? host : null; },
  addEventListener(type, listener) {
    if (!eventListeners.has(type)) eventListeners.set(type, []);
    eventListeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    eventListeners.set(type, (eventListeners.get(type) || []).filter(item => item !== listener));
  },
  createElement(tagName) { return new FakeElement(tagName); },
  createElementNS(_namespace, tagName) { return new FakeElement(tagName); },
};

Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true });
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage,
    h5vcc: null,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter(item => item !== listener));
    },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) listener(event);
    },
  }, configurable: true,
});

class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.active = false;
    this.disconnectCount = 0;
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
}
Object.defineProperty(globalThis, 'MutationObserver', {
  value: FakeMutationObserver, configurable: true,
});

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
}

const { configChangeEmitter, configWrite } = await import('../config.js');
const { cleanup } = await import('../features/premiumBranding.js');
const waitForReconcile = () => new Promise(resolve => setTimeout(resolve, 100));

describe('cosmetic logo page lifecycle', () => {
  it('restores on pagehide and starts a fresh bounded observer on pageshow/config changes', async () => {
    await waitForReconcile();
    assert.equal(FakeMutationObserver.instances.length, 1);
    assert.equal(FakeMutationObserver.instances[0].root, body);
    assert.equal(FakeMutationObserver.instances[0].options.subtree, true);
    assert.equal(host.children.length, 2);

    assert.equal(eventListeners.has('pagehide'), false);
    assert.equal(eventListeners.has('pageshow'), false);
    assert.equal((windowListeners.get('pagehide') || []).length, 1);
    assert.equal((windowListeners.get('pageshow') || []).length, 1);

    const listenerCount = configChangeEmitter.listeners.configChange.length;
    const firstObserver = FakeMutationObserver.instances[0];
    window.dispatchEvent({ type: 'pagehide' });
    assert.equal(firstObserver.active, false);
    assert.equal(host.children.length, 1);
    assert.equal(artwork.style.getPropertyValue('display'), 'inline-block');

    configWrite('enablePremiumLogo', false);
    assert.equal(FakeMutationObserver.instances.length, 1);
    configWrite('enablePremiumLogo', true);
    assert.equal(FakeMutationObserver.instances.length, 2);
    window.dispatchEvent({ type: 'pageshow' });
    assert.equal(firstObserver.active, false);
    assert.equal(FakeMutationObserver.instances.length, 3);
    await waitForReconcile();
    assert.equal(host.children.length, 2);

    cleanup();
    assert.equal(FakeMutationObserver.instances[2].active, false);
    assert.equal(host.children.length, 1);
    assert.equal(configChangeEmitter.listeners.configChange.length, listenerCount);
    assert.equal((windowListeners.get('pageshow') || []).length, 1);
  });
});
