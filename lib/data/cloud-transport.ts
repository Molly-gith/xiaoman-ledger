import type { SupabaseClient } from "@supabase/supabase-js";

export type CloudClient = Pick<SupabaseClient, "rpc">;
export type CloudResource = "ledger" | "memory_personal" | "memory_family" | "memory_travel";
export type CloudRow = { resource: CloudResource; revision: number; payload: unknown };
export type CloudChange = { resource: CloudResource; expected_revision: number; payload: unknown };
const RESOURCES: readonly string[] = ["ledger", "memory_personal", "memory_family", "memory_travel"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const validCloudRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export const cloudConflict = () => new Error("云端数据已在其他页面或设备更新，请重新载入后重试");
export const cloudInvalid = () => new Error("云端数据格式无效，原有内容已保留");

function rows(value: unknown): CloudRow[] {
  if (!Array.isArray(value) || value.length > RESOURCES.length) throw cloudInvalid();
  const seen = new Set<string>();
  return value.map(item => {
    if (!record(item) || Object.keys(item).length !== 3 || !RESOURCES.includes(String(item.resource))
      || typeof item.resource !== "string" || seen.has(item.resource) || !validCloudRevision(item.revision)
      || !record(item.payload)) throw cloudInvalid();
    seen.add(item.resource);
    return structuredClone(item) as CloudRow;
  });
}

/** No storage, cache, retries, or credential handling. The server authenticates every RPC. */
export function createCloudTransport(client: CloudClient, accountId: string, isCurrent: () => boolean) {
  function assertCurrent() {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId) || !isCurrent()) {
      throw new Error("账号已切换或退出，请重新载入后操作");
    }
  }
  async function request(name: "xiaoman_read_resources" | "xiaoman_write_resources", changes?: readonly CloudChange[], resources?: readonly CloudResource[]): Promise<CloudRow[]> {
    assertCurrent();
    let result: { data: unknown; error: unknown };
    try {
      result = await client.rpc(name, { expected_user_id: accountId, ...(changes ? { changes } : { resources }) });
    } catch {
      assertCurrent();
      throw new Error(changes ? "云端保存未能确认，请联网后重新载入核对；请勿重复保存" : "云端暂时无法读取，请联网后重试");
    }
    assertCurrent();
    if (result.error) {
      const code = record(result.error) ? result.error.code : undefined;
      if (code === "40001" || code === "23505") throw cloudConflict();
      if (code === "42501" || code === "PGRST301" || code === "PGRST302") throw new Error("登录状态已失效，请重新登录后操作");
      if (code === "22023" || code === "23514") throw cloudInvalid();
      throw new Error(changes ? "云端保存未能确认，请重新载入核对后再试" : "云端暂时无法读取，请稍后重试");
    }
    return rows(result.data);
  }
  return {
    assertCurrent,
    async read(resources: readonly CloudResource[] = RESOURCES as readonly CloudResource[]): Promise<CloudRow[]> {
      assertCurrent();
      if (!Array.isArray(resources) || resources.length < 1 || resources.length > RESOURCES.length
        || new Set(resources).size !== resources.length || resources.some(resource => !RESOURCES.includes(resource))) throw cloudInvalid();
      const selected = [...resources];
      const result = await request("xiaoman_read_resources", undefined, selected);
      assertCurrent();
      if (result.some(row => !selected.includes(row.resource))) throw cloudInvalid();
      return result;
    },
    async write(changes: readonly CloudChange[]): Promise<CloudRow[]> {
      assertCurrent();
      if (!Array.isArray(changes) || changes.length < 1 || changes.length > RESOURCES.length
        || new Set(changes.map(change => change.resource)).size !== changes.length
        || changes.some(change => !RESOURCES.includes(change.resource) || !validCloudRevision(change.expected_revision)
          || !validCloudRevision(change.expected_revision + 1) || !record(change.payload))) throw cloudInvalid();
      const captured = structuredClone(changes);
      const saved = await request("xiaoman_write_resources", captured);
      assertCurrent();
      if (saved.length !== captured.length || captured.some(change => !saved.some(row => row.resource === change.resource && row.revision === change.expected_revision + 1))) {
        throw new Error("云端保存结果未能确认，请重新载入核对；请勿重复保存");
      }
      return saved;
    },
  };
}
