/**
 * DOM mínimo para montar React de verdade no node:test — SEM dependências novas.
 *
 * Não é um navegador: é o suficiente para `react-dom/client` montar, commitar e
 * rodar effects (ordem real, cleanup real, microtasks reais). O que o app usa
 * fora do React (localStorage, history, location, BroadcastChannel) também vive
 * aqui, sempre em memória e reinicializável entre cenários.
 */

function makeClassList (node) {
  const set = new Set()
  return {
    add: (...names) => names.forEach((n) => set.add(String(n))),
    remove: (...names) => names.forEach((n) => set.delete(String(n))),
    toggle: (name, force) => {
      const on = force === undefined ? !set.has(String(name)) : !!force
      if (on) set.add(String(name))
      else set.delete(String(name))
      return on
    },
    contains: (name) => set.has(String(name)),
    get length () { return set.size },
  }
}

function makeStyle () {
  const store = {}
  return new Proxy(store, {
    get (target, prop) {
      if (prop === 'setProperty') return (k, v) => { target[String(k)] = v }
      if (prop === 'removeProperty') return (k) => { delete target[String(k)] }
      if (prop === 'getPropertyValue') return (k) => target[String(k)] ?? ''
      return target[prop]
    },
    set (target, prop, value) { target[prop] = value; return true },
  })
}

function makeElement (doc, tagName) {
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: doc,
    parentNode: null,
    childNodes: [],
    attributes: {},
    dataset: {},
    style: makeStyle(),
    classList: makeClassList(),
    className: '',
    textContent: '',
    scrollTop: 0,
    focus () {}, blur () {},
    setAttribute (name, value) { this.attributes[name] = String(value) },
    removeAttribute (name) { delete this.attributes[name] },
    getAttribute (name) { return this.attributes[name] ?? null },
    hasAttribute (name) { return name in this.attributes },
    addEventListener () {}, removeEventListener () {},
    contains () { return false },
    get firstChild () { return this.childNodes[0] || null },
    get lastChild () { return this.childNodes[this.childNodes.length - 1] || null },
    appendChild (child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    },
    insertBefore (child, before) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      const at = before ? this.childNodes.indexOf(before) : -1
      if (at < 0) this.childNodes.push(child)
      else this.childNodes.splice(at, 0, child)
      return child
    },
    removeChild (child) {
      this.childNodes = this.childNodes.filter((c) => c !== child)
      child.parentNode = null
      return child
    },
  }
  return node
}

class ShimElement {}
class ShimIFrame {}

export function installDomShim ({ search = '', href = 'http://localhost/' } = {}) {
  const doc = {
    nodeType: 9,
    activeElement: null,
    addEventListener () {}, removeEventListener () {},
    visibilityState: 'visible',
    createElement: (tag) => makeElement(doc, tag),
    createElementNS: (_ns, tag) => makeElement(doc, tag),
    createTextNode: (text) => ({
      nodeType: 3,
      data: String(text),
      textContent: String(text),
      ownerDocument: doc,
      parentNode: null,
    }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  doc.documentElement = makeElement(doc, 'html')
  doc.body = makeElement(doc, 'body')
  doc.head = makeElement(doc, 'head')
  doc.defaultView = globalThis

  const storage = new Map()
  const localStorageShim = {
    getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
    setItem: (k, v) => { storage.set(String(k), String(v)) },
    removeItem: (k) => { storage.delete(String(k)) },
    clear: () => storage.clear(),
    key: (i) => Array.from(storage.keys())[i] ?? null,
    get length () { return storage.size },
  }

  const url = new URL(href)
  if (search) url.search = search
  const location = {
    get href () { return url.toString() },
    set href (value) { url.href = value },
    get search () { return url.search },
    get origin () { return url.origin },
    get pathname () { return url.pathname },
    toString () { return url.toString() },
  }

  const history = {
    replaceState (_state, _title, next) { if (next) url.href = new URL(next, url).toString() },
    pushState (_state, _title, next) { if (next) url.href = new URL(next, url).toString() },
  }

  class BroadcastChannelShim {
    constructor (name) { this.name = name; this.onmessage = null }
    postMessage () {}
    close () {}
    addEventListener () {}
    removeEventListener () {}
  }

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
  }

  globalThis.document = doc
  globalThis.window = globalThis
  globalThis.HTMLIFrameElement = ShimIFrame
  globalThis.HTMLElement = ShimElement
  globalThis.Element = ShimElement
  globalThis.Node = ShimElement
  globalThis.localStorage = localStorageShim
  globalThis.sessionStorage = { getItem: () => null, setItem () {}, removeItem () {}, clear () {} }
  globalThis.location = location
  globalThis.history = history
  globalThis.BroadcastChannel = BroadcastChannelShim
  globalThis.innerWidth = 1280
  globalThis.innerHeight = 800
  globalThis.addEventListener = () => {}
  globalThis.removeEventListener = () => {}
  globalThis.matchMedia = (query) => ({
    media: String(query),
    matches: false,
    addEventListener () {}, removeEventListener () {},
    addListener () {}, removeListener () {},
    onchange: null,
    dispatchEvent: () => false,
  })
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  return {
    document: doc,
    localStorage: localStorageShim,
    location,
    createContainer: () => makeElement(doc, 'div'),
    restore () {
      globalThis.document = previous.document
      globalThis.window = previous.window
    },
  }
}
