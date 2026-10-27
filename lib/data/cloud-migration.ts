import type { AssistantMemoryRepository, MemoryContents } from "./assistant-memory.ts";
import { assertMemoryWriteCapacity, normalizeMemoryContents } from "./assistant-memory.ts";
import { createCloudTransport, cloudInvalid, type CloudChange, type CloudClient } from "./cloud-transport.ts";
import type { LedgerRepository } from "./repository.ts";
import { LEDGER_KINDS, normalizeBackup } from "./schema.ts";
import type { LedgerKind } from "../domain/types.ts";

export type LocalToCloudCounts = Readonly<{ transactions: number; conversations: number; preferences: number }>;
export type PreparedLocalToCloudMigration = Readonly<{
  counts: LocalToCloudCounts;
  perLedger: Readonly<Record<LedgerKind, LocalToCloudCounts>>;
  /** Exactly one confirmation attempt. The captured data stays private and the device data is never deleted. */
  execute(): Promise<void>;
}>;

const occupied = () => new Error("这个账号已有云端数据，不能直接复制覆盖。请使用备份导入，并先保留现有数据");

/** Invoke only after the user requests a preview. There are no background or automatic local reads. */
export async function prepareLocalToCloudMigration(
  client: CloudClient,
  accountId: string,
  isCurrent: () => boolean,
  localRepository: Pick<LedgerRepository, "read">,
  localMemoryRepository: Pick<AssistantMemoryRepository, "getLocalOwnerId" | "readOwner">,
): Promise<PreparedLocalToCloudMigration> {
  const transport = createCloudTransport(client, accountId, isCurrent);
  transport.assertCurrent();
  const existing = await transport.read();
  transport.assertCurrent();
  // Existence matters: an intentionally cleared resource remains a revision tombstone.
  if (existing.length !== 0) throw occupied();

  const ledger = normalizeBackup(await localRepository.read());
  transport.assertCurrent();
  const localOwner = await localMemoryRepository.getLocalOwnerId();
  transport.assertCurrent();
  const memories = await localMemoryRepository.readOwner(localOwner);
  transport.assertCurrent();
  const contents = Object.fromEntries(LEDGER_KINDS.map(kind => {
    const state = memories[kind];
    if (!state || ![1, 2].includes(state.version) || state.ownerId !== localOwner || state.ledgerKind !== kind) throw cloudInvalid();
    const content = normalizeMemoryContents({ conversation: state.conversation, preferences: state.preferences, clarification: state.clarification,
      ...(state.version === 2 ? { version: 2, companion: state.companion } : {}) });
    assertMemoryWriteCapacity(content);
    return [kind, content];
  })) as Record<LedgerKind, MemoryContents>;

  const perLedger = Object.freeze(Object.fromEntries(LEDGER_KINDS.map(kind => {
    const book = kind === ledger.ledgerKind ? ledger : ledger.otherLedgers[kind]!;
    return [kind, Object.freeze({ transactions: book.transactions.length, conversations: contents[kind].conversation.length, preferences: contents[kind].preferences.length })];
  })) as Record<LedgerKind, LocalToCloudCounts>);
  const counts = Object.freeze(LEDGER_KINDS.reduce((total, kind) => ({
    transactions: total.transactions + perLedger[kind].transactions,
    conversations: total.conversations + perLedger[kind].conversations,
    preferences: total.preferences + perLedger[kind].preferences,
  }), { transactions: 0, conversations: 0, preferences: 0 }));

  // Reset only the cloud revision. Every ledger record, budget and local preference remains intact.
  const payload = normalizeBackup({ ...ledger, revision: 1 });
  const changes: CloudChange[] = [{ resource: "ledger", expected_revision: 0, payload },
    ...LEDGER_KINDS.map(kind => ({ resource: `memory_${kind}` as const, expected_revision: 0, payload: contents[kind] }))];
  let attempted = false;
  return Object.freeze({ counts, perLedger, async execute() {
    transport.assertCurrent();
    if (attempted) throw new Error("这次复制已经提交过，请重新载入核对；如需再次操作，请重新预览");
    attempted = true;
    const latest = await transport.read();
    transport.assertCurrent();
    if (latest.length !== 0) throw occupied();
    // One transaction for all four resources; expected revision 0 rejects a concurrent first writer.
    const saved = await transport.write(changes);
    transport.assertCurrent();
    for (const row of saved) {
      if (row.resource === "ledger") {
        if (normalizeBackup(row.payload).revision !== row.revision) throw cloudInvalid();
      } else normalizeMemoryContents(row.payload);
    }
  } });
}
