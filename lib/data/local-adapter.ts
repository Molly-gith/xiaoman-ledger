import { createRepository, type LedgerStore } from "./repository.ts";
import { defaultState, normalizeBackup } from "./schema.ts";
import type { LedgerState } from "../domain/types.ts";

const DB_NAME = "xiaoman-ledger-db", STORE_NAME = "ledger", STATE_KEY = "current";
const FALLBACK_KEY = "xiaoman-ledger-local-v1";
function isAdoptedFallback(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return parsed.version === 2 || parsed.version === 3;
  } catch { return false; }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("账本被其他页面占用，请关闭其他页面后重试"));
  });
}
function legacyState(): LedgerState {
  const raw = localStorage.getItem("xiaoman-ledger");
  if (!raw) return defaultState();
  const old = JSON.parse(raw);
  // Preserve every legacy record; do not silently delete presumed demonstration data.
  return normalizeBackup({ app: "xiaoman-ledger", version: 1, ledgerKind: "personal", transactions: old.transactions ?? [],
    settings: { monthlyBudget: old.budget ?? 15000, savingsCurrent: old.saved ?? 0, savingsGoal: old.goal ?? 100000 } });
}
export function createLocalStore(): LedgerStore {
  // v2/v3 fallback denotes an adopted fallback ledger. v1 used IDB-first reads and
  // could leave a stale fallback behind after IDB recovered; preserve that priority.
  let mode: "idb" | "fallback" | null = null;
  return {
    async read() {
      const fallback = localStorage.getItem(FALLBACK_KEY);
      if (isAdoptedFallback(fallback)) { mode = "fallback"; return normalizeBackup(JSON.parse(fallback!)); }
      let db: IDBDatabase;
      try { db = await openDatabase(); }
      catch { throw new Error("本机数据库暂时无法打开，原有账本已保留。请重新载入，勿清理浏览器数据。"); }
      mode = "idb";
      try {
        const stored = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly"), request = tx.objectStore(STORE_NAME).get(STATE_KEY);
          tx.oncomplete = () => resolve(request.result);
          tx.onabort = () => reject(tx.error ?? new Error("本机账本读取失败"));
          tx.onerror = () => reject(tx.error);
        });
        if (stored !== undefined) return normalizeBackup(stored);
        if (fallback !== null) { mode = "fallback"; return normalizeBackup(JSON.parse(fallback)); }
        return legacyState();
      } finally { db.close(); }
    },
    async commit(state, expectedRevision) {
      if (!mode) throw new Error("请先载入账本");
      if (mode === "fallback") {
        if (!navigator.locks) throw new Error("当前浏览器无法安全保存备用账本，请使用支持本地数据库的浏览器");
        await navigator.locks.request("xiaoman-ledger-write", async () => {
          const raw = localStorage.getItem(FALLBACK_KEY);
          const current = raw === null ? legacyState() : normalizeBackup(JSON.parse(raw));
          if (current.revision !== expectedRevision) throw new Error("账本已在其他页面更新，请重新载入");
          localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
        });
        return;
      }
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite"), store = tx.objectStore(STORE_NAME), request = store.get(STATE_KEY);
          let failure: unknown;
          request.onsuccess = () => {
            try {
              const current = request.result === undefined ? legacyState() : normalizeBackup(request.result);
              const fallback = localStorage.getItem(FALLBACK_KEY);
              if (isAdoptedFallback(fallback) || current.revision !== expectedRevision) throw new Error("账本已在其他页面更新，请重新载入");
              store.put(state, STATE_KEY);
            } catch (error) { failure = error; tx.abort(); }
          };
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(failure ?? tx.error ?? new Error("本机保存失败，原数据已保留"));
          tx.onerror = () => { failure ??= tx.error; };
        });
      } finally { db.close(); }
    },
  };
}
export function createLocalRepository() { return createRepository(createLocalStore()); }
