import { MAX_CONVERSATION_MESSAGES, normalizeMemoryContents, validateConversationMessage, validateOwnerMemoryBackup,
  type AssistantMemoryRepository, type ClarificationMemory, type ConversationMessage, type MemoryContents, type MemoryRevisions,
  type MemoryState, type OwnerMemory, type OwnerMemoryBackup, type PreferenceRule } from "./assistant-memory.ts";
import { validatePreferenceRule } from "../domain/assistant-preferences.ts";
import { LEDGER_KINDS } from "./schema.ts";
import type { LedgerKind } from "../domain/types.ts";
import { cloudConflict, cloudInvalid, createCloudTransport, validCloudRevision, type CloudClient, type CloudRow, type CloudResource } from "./cloud-transport.ts";

const resource = (kind: LedgerKind): CloudResource => `memory_${kind}`;
const empty = (): MemoryContents => ({ conversation: [], preferences: [], clarification: null });
const contentOf = (state: MemoryState): MemoryContents => normalizeMemoryContents({ conversation: state.conversation, preferences: state.preferences, clarification: state.clarification });

/** The owner argument is only a compatibility guard; SQL independently enforces auth.uid(). */
export function createCloudMemoryRepository(client: CloudClient, accountId: string, isCurrent: () => boolean): AssistantMemoryRepository {
  const transport = createCloudTransport(client, accountId, isCurrent);
  function assertOwner(owner: string, kind?: LedgerKind) {
    transport.assertCurrent();
    if (owner !== accountId || (kind !== undefined && !LEDGER_KINDS.includes(kind))) throw new Error("账号或账本已变化，请重新载入后操作");
  }
  function decode(rows: CloudRow[], kind: LedgerKind): MemoryState {
    const row = rows.find(row => row.resource === resource(kind));
    return { version: 1, ownerId: accountId, ledgerKind: kind, revision: row?.revision ?? 0,
      ...normalizeMemoryContents(row ? row.payload : empty()) };
  }
  async function readOwner(owner: string): Promise<OwnerMemory> {
    assertOwner(owner);
    const rows = await transport.read(LEDGER_KINDS.map(resource));
    assertOwner(owner);
    return Object.fromEntries(LEDGER_KINDS.map(kind => [kind, decode(rows, kind)])) as OwnerMemory;
  }
  async function read(owner: string, kind: LedgerKind): Promise<MemoryState> {
    assertOwner(owner, kind);
    const rows = await transport.read([resource(kind)]);
    assertOwner(owner, kind);
    return decode(rows, kind);
  }
  async function update(owner: string, kind: LedgerKind, expected: number, change: (current: MemoryState) => MemoryContents): Promise<MemoryState> {
    assertOwner(owner, kind);
    if (!validCloudRevision(expected)) throw cloudInvalid();
    const current = await read(owner, kind);
    assertOwner(owner, kind);
    if (current.revision !== expected) throw cloudConflict();
    const payload = normalizeMemoryContents(change(current));
    const rows = await transport.write([{ resource: resource(kind), expected_revision: expected, payload }]);
    assertOwner(owner, kind);
    return decode(rows, kind);
  }
  async function replaceOwner(owner: string, all: OwnerMemory, replacements: Record<LedgerKind, MemoryContents>): Promise<OwnerMemory> {
    assertOwner(owner);
    const changes = LEDGER_KINDS.map(kind => ({ resource: resource(kind), expected_revision: all[kind].revision, payload: normalizeMemoryContents(replacements[kind]) }));
    const rows = await transport.write(changes);
    assertOwner(owner);
    return Object.fromEntries(LEDGER_KINDS.map(kind => [kind, decode(rows, kind)])) as OwnerMemory;
  }
  async function conversation(replace: boolean, owner: string, kind: LedgerKind, messages: readonly ConversationMessage[], expected: number, clarification?: ClarificationMemory | null) {
    assertOwner(owner, kind);
    if (!Array.isArray(messages) || messages.length > MAX_CONVERSATION_MESSAGES || !messages.every(validateConversationMessage)) throw cloudInvalid();
    const captured = structuredClone(messages), capturedClarification = structuredClone(clarification);
    // Validate clarification before the first network request as well as the complete saved payload.
    if (capturedClarification !== undefined) normalizeMemoryContents({ ...empty(), clarification: capturedClarification });
    return update(owner, kind, expected, current => {
      const all = replace ? [...captured] : [...current.conversation, ...captured];
      if (new Set(all.map(message => message.id)).size !== all.length) throw new Error("这条对话已经保存，请重新载入后重试");
      return { ...contentOf(current), conversation: all.slice(-MAX_CONVERSATION_MESSAGES), ...(capturedClarification !== undefined ? { clarification: capturedClarification } : {}) };
    });
  }
  async function clearOwner(owner: string, preferences: boolean): Promise<OwnerMemory> {
    const all = await readOwner(owner);
    assertOwner(owner);
    const cleared = Object.fromEntries(LEDGER_KINDS.map(kind => [kind, { ...empty(), preferences: preferences ? [] : all[kind].preferences }])) as Record<LedgerKind, MemoryContents>;
    return replaceOwner(owner, all, cleared);
  }
  return {
    async getLocalOwnerId() { assertOwner(accountId); return accountId; },
    read, getConversation: read, getPreferences: read, readOwner,
    appendConversation: (owner, kind, messages, expected, clarification) => conversation(false, owner, kind, messages, expected, clarification),
    replaceConversation: (owner, kind, messages, expected, clarification) => conversation(true, owner, kind, messages, expected, clarification),
    clearConversation: (owner, kind, expected) => update(owner, kind, expected, current => ({ ...contentOf(current), conversation: [], clarification: null })),
    upsertPreference: (owner, kind, rule: PreferenceRule, expected) => {
      if (!validatePreferenceRule(rule)) return Promise.reject(cloudInvalid());
      const captured = structuredClone(rule);
      return update(owner, kind, expected, current => ({ ...contentOf(current), preferences: [...current.preferences.filter(item => item.id !== captured.id), captured] }));
    },
    deletePreference: (owner, kind, id, expected) => update(owner, kind, expected, current => {
      if (!current.preferences.some(rule => rule.id === id)) throw new Error("这条偏好已不存在，请重新载入后重试");
      return { ...contentOf(current), preferences: current.preferences.filter(rule => rule.id !== id) };
    }),
    clearOwnerConversations: owner => clearOwner(owner, false), clearOwner: owner => clearOwner(owner, true),
    exportOwner: async owner => {
      const all = await readOwner(owner);
      assertOwner(owner);
      return { app: "xiaoman-assistant-memory", version: 1, exportedAt: new Date().toISOString(),
        ledgers: Object.fromEntries(LEDGER_KINDS.map(kind => [kind, contentOf(all[kind])])) as OwnerMemoryBackup["ledgers"] };
    },
    importOwner: async (owner, backup: unknown, expected: MemoryRevisions) => {
      assertOwner(owner);
      if (!validateOwnerMemoryBackup(backup) || !expected || typeof expected !== "object" || Object.keys(expected).length !== LEDGER_KINDS.length
        || !LEDGER_KINDS.every(kind => validCloudRevision(expected[kind]))) throw cloudInvalid();
      const captured = structuredClone(backup), revisions = structuredClone(expected);
      const all = await readOwner(owner);
      assertOwner(owner);
      if (LEDGER_KINDS.some(kind => all[kind].revision !== revisions[kind])) throw cloudConflict();
      return replaceOwner(owner, all, captured.ledgers);
    },
  };
}
