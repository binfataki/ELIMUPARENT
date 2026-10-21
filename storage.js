// storage.js — Gestionnaire
// Couche IndexedDB. Aucune dependance externe (API IndexedDB brute enveloppee en Promises).
// Stores: classes, eleves, inscriptions, tarifs, paiements, frais_connexes, communiques, meta, queue

const ELIMU_DB_NAME = "elimu_db";
const ELIMU_DB_VERSION = 1;
const ELIMU_STORES = ["classes", "eleves", "inscriptions", "tarifs", "paiements", "frais_connexes", "communiques", "meta", "queue"];

let _dbPromise = null;

function ELIMU_openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(ELIMU_DB_NAME, ELIMU_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      ELIMU_STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          if (name === "queue") {
            db.createObjectStore(name, { keyPath: "local_id" });
          } else if (name === "meta") {
            db.createObjectStore(name, { keyPath: "key" });
          } else {
            db.createObjectStore(name, { keyPath: "id" });
          }
        }
      });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

async function ELIMU_tx(storeName, mode, fn) {
  const db = await ELIMU_openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function ELIMU_reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const ELIMU_Storage = {
  async getParentSession() {
    const persistent = await this.getMeta("parent_session");
    if (persistent && persistent.token) return Object.assign({}, persistent, { persistent: true });
    try {
      const session = JSON.parse(sessionStorage.getItem(window.ELIMU_PARENT_SESSION_KEY || "elimu_parent_session") || "null");
      return session && session.token ? Object.assign({}, session, { persistent: false }) : null;
    } catch (_) { return null; }
  },

  async setParentSession(session, remember) {
    if (remember) {
      await this.setMeta("parent_session", { token: session.token, expiresAt: session.expiresAt });
      try { sessionStorage.removeItem(window.ELIMU_PARENT_SESSION_KEY || "elimu_parent_session"); } catch (_) {}
    } else {
      try { sessionStorage.setItem(window.ELIMU_PARENT_SESSION_KEY || "elimu_parent_session", JSON.stringify(session)); } catch (_) {}
      await this.delete("meta", "parent_session");
    }
  },

  async clearParentSession() {
    await this.delete("meta", "parent_session");
    try { sessionStorage.removeItem(window.ELIMU_PARENT_SESSION_KEY || "elimu_parent_session"); } catch (_) {}
  },

  async getAll(storeName) {
    const db = await ELIMU_openDb();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return ELIMU_reqToPromise(store.getAll());
  },

  async get(storeName, id) {
    const db = await ELIMU_openDb();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return ELIMU_reqToPromise(store.get(id));
  },

  async put(storeName, value) {
    return ELIMU_tx(storeName, "readwrite", (store) => store.put(value));
  },

  async bulkPut(storeName, values) {
    const db = await ELIMU_openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      values.forEach((v) => store.put(v));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async replaceAll(storeName, values) {
    const db = await ELIMU_openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      store.clear();
      values.forEach((v) => store.put(v));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async delete(storeName, id) {
    return ELIMU_tx(storeName, "readwrite", (store) => store.delete(id));
  },

  async setMeta(key, value) {
    return this.put("meta", { key, value });
  },

  async getMeta(key) {
    const row = await this.get("meta", key);
    return row ? row.value : null;
  },

  // File d'attente des operations hors-connexion
  async enqueue(operation, payload) {
    const local_id = "op_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    const idempotency_key = local_id;
    const item = {
      local_id,
      operation,
      payload,
      created_at: new Date().toISOString(),
      status: "PENDING",
      idempotency_key,
      error_message: null
    };
    await this.put("queue", item);
    return item;
  },

  async getQueue() {
    return this.getAll("queue");
  },

  async getPendingCount() {
    const all = await this.getQueue();
    return all.filter((q) => q.status === "PENDING" || q.status === "FAILED").length;
  },

  async updateQueueItem(local_id, patch) {
    const item = await this.get("queue", local_id);
    if (!item) return;
    Object.assign(item, patch);
    await this.put("queue", item);
  },

  async clearSyncedQueue() {
    const all = await this.getQueue();
    const db = await ELIMU_openDb();
    const tx = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    all.filter((i) => i.status === "SYNCED").forEach((i) => store.delete(i.local_id));
    return new Promise((resolve) => { tx.oncomplete = () => resolve(true); });
  }
};

window.ELIMU_Storage = ELIMU_Storage;
