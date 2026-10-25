import { createRepository, type LedgerStore } from "./repository.ts";
import { defaultState, normalizeBackup } from "./schema.ts";
import { cloudInvalid, createCloudTransport, validCloudRevision, type CloudClient, type CloudRow } from "./cloud-transport.ts";

function decodeLedger(row: CloudRow | undefined) {
  if (!row) return defaultState();
  const state = normalizeBackup(row.payload);
  if (row.resource !== "ledger" || state.revision !== row.revision) throw cloudInvalid();
  return state;
}

/** Logged-in ledgers are read and durably saved in the account, never the guest database. */
export function createCloudStore(client: CloudClient, accountId: string, isCurrent: () => boolean): LedgerStore {
  const transport = createCloudTransport(client, accountId, isCurrent);
  return {
    async read() {
      const rows = await transport.read(["ledger"]);
      transport.assertCurrent();
      return decodeLedger(rows.find(row => row.resource === "ledger"));
    },
    async commit(value, expectedRevision) {
      transport.assertCurrent();
      const state = normalizeBackup(value);
      if (!validCloudRevision(expectedRevision) || state.revision !== expectedRevision + 1) throw cloudInvalid();
      const saved = await transport.write([{ resource: "ledger", expected_revision: expectedRevision, payload: state }]);
      transport.assertCurrent();
      decodeLedger(saved[0]);
    },
  };
}

export function createCloudRepository(client: CloudClient, accountId: string, isCurrent: () => boolean) {
  return createRepository(createCloudStore(client, accountId, isCurrent));
}
