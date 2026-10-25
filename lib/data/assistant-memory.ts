import type { LedgerKind } from "../domain/types.ts";
import { validateQueryPlan, type QueryPlan } from "../domain/ledger-query.ts";
import { MAX_PREFERENCES, preferenceKeyword, validatePreferenceRule, type PreferenceRule } from "../domain/assistant-preferences.ts";

export type { PreferenceRule } from "../domain/assistant-preferences.ts";
export type ConversationMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string; query?: QueryPlan; clarification?: ClarificationMemory };
export type ClarificationMemory = { originalText: string; question: string };
export type MemoryState = { version: 1; ownerId: string; ledgerKind: LedgerKind; revision: number;
  conversation: ConversationMessage[]; preferences: PreferenceRule[]; clarification: ClarificationMemory | null };
export type OwnerMemory = Record<LedgerKind, MemoryState>;
export type MemoryRevisions = Record<LedgerKind, number>;
export type MemoryContents = Pick<MemoryState, "conversation" | "preferences" | "clarification">;
/** Portable content only. Local identifiers are not authentication and never become an imported identity. */
export type OwnerMemoryBackup = { app: "xiaoman-assistant-memory"; version: 1; exportedAt: string; ledgers: Record<LedgerKind, MemoryContents> };
export const MAX_CONVERSATION_MESSAGES = 40;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_MEMORY_BACKUP_BYTES = 2_000_000;
const KINDS: readonly LedgerKind[] = ["personal", "family", "travel"];
const DB_NAME = "xiaoman-assistant-memory-db", STORE = "memory", OWNER_KEY = "localOwnerId";
const conflict = () => new Error("助手记忆已在其他页面更新，请重新载入后重试");
const invalid = () => new Error("助手记忆数据无效，原有内容已保留");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const ownerId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/.test(value);
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function scope(owner: string, kind: LedgerKind) {
  if (!ownerId(owner) || !KINDS.includes(kind)) throw invalid();
  return JSON.stringify([owner, kind]);
}
function empty(owner: string, kind: LedgerKind): MemoryState {
  scope(owner, kind);
  return { version: 1, ownerId: owner, ledgerKind: kind, revision: 0, conversation: [], preferences: [], clarification: null };
}
function validateClarification(value: unknown): value is ClarificationMemory | null {
  return value === null || (record(value) && keys(value, ["originalText", "question"]) && text(value.originalText, 2000) && text(value.question, 300));
}
export function validateConversationMessage(value: unknown): value is ConversationMessage {
  return record(value) && keys(value, ["id", "role", "content", "createdAt"], ["query", "clarification"])
    && id(value.id) && (value.role === "user" || value.role === "assistant") && text(value.content, MAX_MESSAGE_LENGTH) && timestamp(value.createdAt)
    && (value.query === undefined || (value.role === "assistant" && validateQueryPlan(value.query)))
    && (value.clarification === undefined || (value.role === "assistant" && value.clarification !== null && validateClarification(value.clarification)));
}
function contents(value: unknown): MemoryContents {
  if (!record(value) || !keys(value, ["conversation", "preferences", "clarification"])) throw invalid();
  if (!Array.isArray(value.conversation) || value.conversation.length > MAX_CONVERSATION_MESSAGES || !value.conversation.every(validateConversationMessage)
    || new Set(value.conversation.map(message => message.id)).size !== value.conversation.length
    || !Array.isArray(value.preferences) || value.preferences.length > MAX_PREFERENCES || !value.preferences.every(validatePreferenceRule)
    || new Set(value.preferences.map(rule => rule.id)).size !== value.preferences.length
    || new Set(value.preferences.map(rule => preferenceKeyword(rule.keyword))).size !== value.preferences.length
    || !validateClarification(value.clarification)) throw invalid();
  return structuredClone(value) as MemoryContents;
}
/** Shared validation for cloud payloads; identity and revisions are not portable content. */
export function normalizeMemoryContents(value: unknown): MemoryContents { return contents(value); }
function decode(value: unknown, owner: string, kind: LedgerKind): MemoryState {
  if (value === undefined) return empty(owner, kind);
  if (!record(value) || !keys(value, ["version", "ownerId", "ledgerKind", "revision", "conversation", "preferences", "clarification"])
    || value.version !== 1 || value.ownerId !== owner || value.ledgerKind !== kind || !revision(value.revision)) throw invalid();
  return { ...empty(owner, kind), revision: value.revision, ...contents({ conversation: value.conversation, preferences: value.preferences, clarification: value.clarification }) };
}
export function validateOwnerMemoryBackup(value: unknown): value is OwnerMemoryBackup {
  try {
    if (!record(value) || !keys(value, ["app", "version", "exportedAt", "ledgers"]) || value.app !== "xiaoman-assistant-memory" || value.version !== 1
      || !timestamp(value.exportedAt) || !record(value.ledgers) || !keys(value.ledgers, KINDS)) return false;
    for (const kind of KINDS) contents(value.ledgers[kind]);
    return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_MEMORY_BACKUP_BYTES;
  } catch { return false; }
}

export interface AssistantMemoryRepository {
  getLocalOwnerId(): Promise<string>;
  read(owner: string, kind: LedgerKind): Promise<MemoryState>;
  getConversation(owner: string, kind: LedgerKind): Promise<MemoryState>;
  getPreferences(owner: string, kind: LedgerKind): Promise<MemoryState>;
  readOwner(owner: string): Promise<OwnerMemory>;
  appendConversation(owner: string, kind: LedgerKind, messages: readonly ConversationMessage[], expectedRevision: number, clarification?: ClarificationMemory | null): Promise<MemoryState>;
  replaceConversation(owner: string, kind: LedgerKind, messages: readonly ConversationMessage[], expectedRevision: number, clarification?: ClarificationMemory | null): Promise<MemoryState>;
  clearConversation(owner: string, kind: LedgerKind, expectedRevision: number): Promise<MemoryState>;
  upsertPreference(owner: string, kind: LedgerKind, rule: PreferenceRule, expectedRevision: number): Promise<MemoryState>;
  deletePreference(owner: string, kind: LedgerKind, preferenceId: string, expectedRevision: number): Promise<MemoryState>;
  /** Keeps preferences; used after replacing ledger records to remove obsolete context. */
  clearOwnerConversations(owner: string): Promise<OwnerMemory>;
  /** Explicitly clears conversations AND preferences in all three books, retaining revision tombstones. */
  clearOwner(owner: string): Promise<OwnerMemory>;
  exportOwner(owner: string): Promise<OwnerMemoryBackup>;
  importOwner(owner: string, backup: unknown, expectedRevisions: MemoryRevisions): Promise<OwnerMemory>;
}

/** Device-local storage only. An owner ID selects a local partition; it grants no server/account access.
 * No ledger state, credentials, or in-memory fallback is written by this repository.
 */
export function createAssistantMemoryRepository(options: { indexedDB?: IDBFactory } = {}): AssistantMemoryRepository {
  async function open(): Promise<IDBDatabase> {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error("本机无法打开助手记忆，尚未保存。请使用支持本地数据库的浏览器");
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      let abandoned = false;
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onsuccess = () => {
        if (abandoned) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(new Error("助手记忆暂时无法读取，原有内容已保留"));
      request.onblocked = () => { abandoned = true; reject(new Error("助手记忆被其他页面占用，请关闭旧页面后重试")); };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode); let value: T, failure: unknown;
        const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { /* Already aborted. */ } };
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("助手记忆保存失败，原有内容已保留"));
        tx.onerror = () => { failure ??= tx.error; };
        try { work(tx.objectStore(STORE), result => { value = result; }, fail); } catch (error) { fail(error); }
      });
    } finally { db.close(); }
  }
  async function read(owner: string, kind: LedgerKind): Promise<MemoryState> {
    const key = scope(owner, kind);
    return transaction("readonly", (store, result, fail) => {
      const request = store.get(key);
      request.onsuccess = () => { try { result(decode(request.result, owner, kind)); } catch (error) { fail(error); } };
    });
  }
  async function update(owner: string, kind: LedgerKind, expectedRevision: number, change: (current: MemoryState) => MemoryState): Promise<MemoryState> {
    const key = scope(owner, kind);
    if (!revision(expectedRevision)) throw invalid();
    return transaction("readwrite", (store, result, fail) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const current = decode(request.result, owner, kind);
          if (current.revision !== expectedRevision) throw conflict();
          const next = decode({ ...change(current), revision: current.revision + 1 }, owner, kind);
          store.put(next, key); result(next);
        } catch (error) { fail(error); }
      };
    });
  }
  async function ownerTransaction(owner: string, mode: IDBTransactionMode, change?: (current: OwnerMemory) => OwnerMemory): Promise<OwnerMemory> {
    for (const kind of KINDS) scope(owner, kind);
    return transaction(mode, (store, result, fail) => {
      const all = {} as OwnerMemory; let count = 0;
      for (const kind of KINDS) {
        const request = store.get(scope(owner, kind));
        request.onsuccess = () => {
          try {
            all[kind] = decode(request.result, owner, kind);
            if (++count !== KINDS.length) return;
            const next = change ? change(all) : all;
            if (change) for (const book of KINDS) store.put(decode(next[book], owner, book), scope(owner, book));
            result(next);
          } catch (error) { fail(error); }
        };
      }
    });
  }
  const clearOwner = (owner: string, preferences: boolean) => ownerTransaction(owner, "readwrite", current => {
    for (const kind of KINDS) current[kind] = { ...current[kind], revision: current[kind].revision + 1, conversation: [], clarification: null,
      preferences: preferences ? [] : current[kind].preferences };
    return current;
  });
  const conversation = (replace: boolean, owner: string, kind: LedgerKind, messages: readonly ConversationMessage[], expectedRevision: number, clarification?: ClarificationMemory | null) => {
    if (!Array.isArray(messages) || messages.length > MAX_CONVERSATION_MESSAGES || !messages.every(validateConversationMessage)
      || (clarification !== undefined && !validateClarification(clarification))) return Promise.reject(invalid());
    const capturedMessages = structuredClone(messages), capturedClarification = structuredClone(clarification);
    return update(owner, kind, expectedRevision, current => {
      const all = replace ? [...capturedMessages] : [...current.conversation, ...capturedMessages];
      if (new Set(all.map(message => message.id)).size !== all.length) throw new Error("这条对话已经保存，请重新载入后重试");
      return { ...current, conversation: all.slice(-MAX_CONVERSATION_MESSAGES), ...(capturedClarification !== undefined ? { clarification: capturedClarification } : {}) };
    });
  };
  return {
    getLocalOwnerId: () => transaction("readwrite", (store, result, fail) => {
      const request = store.get(OWNER_KEY);
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) {
            if (!ownerId(request.result)) throw invalid();
            result(request.result); return;
          }
          const owner = `local-${crypto.randomUUID()}`;
          store.put(owner, OWNER_KEY); result(owner);
        } catch (error) { fail(error); }
      };
    }),
    read, getConversation: read, getPreferences: read,
    readOwner: owner => ownerTransaction(owner, "readonly"),
    appendConversation: (owner, kind, messages, expected, clarification) => conversation(false, owner, kind, messages, expected, clarification),
    replaceConversation: (owner, kind, messages, expected, clarification) => conversation(true, owner, kind, messages, expected, clarification),
    clearConversation: (owner, kind, expected) => update(owner, kind, expected, current => ({ ...current, conversation: [], clarification: null })),
    upsertPreference: (owner, kind, rule, expected) => {
      if (!validatePreferenceRule(rule)) return Promise.reject(invalid());
      const captured = structuredClone(rule);
      return update(owner, kind, expected, current => ({ ...current, preferences: [...current.preferences.filter(item => item.id !== captured.id), captured] }));
    },
    deletePreference: (owner, kind, preferenceId, expected) => update(owner, kind, expected, current => {
      if (!id(preferenceId) || !current.preferences.some(rule => rule.id === preferenceId)) throw new Error("这条偏好已不存在，请重新载入后重试");
      return { ...current, preferences: current.preferences.filter(rule => rule.id !== preferenceId) };
    }),
    clearOwnerConversations: owner => clearOwner(owner, false), clearOwner: owner => clearOwner(owner, true),
    exportOwner: async owner => {
      const all = await ownerTransaction(owner, "readonly");
      const ledgers = Object.fromEntries(KINDS.map(kind => [kind, contents({ conversation: all[kind].conversation, preferences: all[kind].preferences, clarification: all[kind].clarification })])) as OwnerMemoryBackup["ledgers"];
      return { app: "xiaoman-assistant-memory", version: 1, exportedAt: new Date().toISOString(), ledgers };
    },
    importOwner: async (owner, backup, expected) => {
      if (!validateOwnerMemoryBackup(backup) || !record(expected) || !keys(expected, KINDS) || !KINDS.every(kind => revision(expected[kind]))) throw invalid();
      const captured = structuredClone(backup), revisions = structuredClone(expected);
      return ownerTransaction(owner, "readwrite", current => {
        for (const kind of KINDS) {
          if (current[kind].revision !== revisions[kind]) throw conflict();
          current[kind] = { ...empty(owner, kind), revision: current[kind].revision + 1, ...contents(captured.ledgers[kind]) };
        }
        return current;
      });
    },
  };
}
