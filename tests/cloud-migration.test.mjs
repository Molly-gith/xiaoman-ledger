import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalToCloudMigration } from '../lib/data/cloud-migration.ts';
import { defaultState } from '../lib/data/schema.ts';

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner = 'local-device-owner', kinds = ['personal', 'family', 'travel'];
const tx = (id, amount) => ({ id, type: 'expense', amount, date: '2026-10-25', category: '餐饮', note: '合成午饭', icon: '🍜', source: 'text', cycleId: null, nature: '消费', spendKind: 'variable' });
const message = (id) => ({ id, role: 'user', content: '合成对话', createdAt: '2026-10-25T02:00:00.000Z' });
const emptyContents = () => ({ conversation: [], preferences: [], clarification: null });
function fixture() {
  let current = true, auth = account, hook = null;
  const rows = new Map(), calls = [], localCalls = [];
  const ledger = { ...defaultState(), revision: 12 };
  ledger.transactions = [tx('personal-1', 35), tx('personal-2', 20)]; ledger.otherLedgers.family.transactions = [tx('family', 80)];
  ledger.otherLedgers.travel.investmentAccounts = [{ id: 'asset', name: '合成资产', openingNetContribution: null, currentMarketValue: 1000, marketValueUpdatedAt: '2026-10-25', createdAt: '2026-10-25' }];
  const memories = Object.fromEntries(kinds.map(kind => [kind, { version: 1, ownerId: owner, ledgerKind: kind, revision: 6, ...emptyContents() }]));
  memories.personal.conversation = [message('u1'), message('u2')]; memories.family.conversation = [message('family')];
  memories.travel.preferences = [{ id: 'gym', keyword: '健身课', category: '健康', nature: '投资' }];
  const localRepository = { async read() { localCalls.push('ledger'); return ledger; } };
  const localMemoryRepository = { async getLocalOwnerId() { localCalls.push('owner'); return owner; }, async readOwner(value) { assert.equal(value, owner); localCalls.push('memory'); return memories; } };
  const client = { async rpc(name, args) {
    calls.push(structuredClone({ name, args }));
    if (hook) { const result = await hook(name, args); if (result !== undefined) return result; }
    if (auth !== args.expected_user_id) return { data: null, error: { code: '42501' } };
    if (name === 'xiaoman_read_resources') return { data: structuredClone([...rows.values()].filter(row => args.resources.includes(row.resource))), error: null };
    assert.equal(name, 'xiaoman_write_resources');
    for (const change of args.changes) if ((rows.get(change.resource)?.revision ?? 0) !== change.expected_revision) return { data: null, error: { code: '40001' } };
    const saved = args.changes.map(change => ({ resource: change.resource, revision: change.expected_revision + 1, payload: structuredClone(change.payload) }));
    for (const row of saved) rows.set(row.resource, row);
    return { data: structuredClone(saved), error: null };
  } };
  return { rows, calls, localCalls, ledger, memories, client, localRepository, localMemoryRepository,
    prepare: () => prepareLocalToCloudMigration(client, account, () => current, localRepository, localMemoryRepository),
    setCurrent(value) { current = value; }, setAuth(value) { auth = value; }, setHook(value) { hook = value; } };
}

test('nothing reads local data before preview; preview counts every book without writing either destination', async () => {
  const f = fixture(); assert.deepEqual(f.localCalls, []); assert.deepEqual(f.calls, []);
  const prepared = await f.prepare();
  assert.deepEqual(f.localCalls, ['ledger', 'owner', 'memory']); assert.equal(f.rows.size, 0);
  assert.deepEqual(prepared.counts, { transactions: 3, conversations: 3, preferences: 1 });
  assert.deepEqual(prepared.perLedger.personal, { transactions: 2, conversations: 2, preferences: 0 });
  assert.deepEqual(prepared.perLedger.family, { transactions: 1, conversations: 1, preferences: 0 });
  assert.deepEqual(prepared.perLedger.travel, { transactions: 0, conversations: 0, preferences: 1 });
  assert.deepEqual(Object.keys(prepared).sort(), ['counts', 'execute', 'perLedger']);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.resources.length, 4);
});

test('one confirmation copies all four captured resources atomically and never clears or rewrites local data', async () => {
  const f = fixture(), before = structuredClone({ ledger: f.ledger, memories: f.memories }); const prepared = await f.prepare();
  await prepared.execute();
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1);
  const write = f.calls.at(-1); assert.equal(write.args.expected_user_id, account); assert.equal(write.args.changes.length, 4);
  for (const change of write.args.changes) assert.equal(change.expected_revision, 0);
  assert.deepEqual(f.rows.get('ledger').payload, { ...before.ledger, revision: 1 });
  assert.equal(f.rows.get('ledger').payload.otherLedgers.travel.investmentAccounts[0].currentMarketValue, 1000);
  for (const kind of kinds) {
    const row = f.rows.get(`memory_${kind}`); assert.equal(row.revision, 1);
    assert.deepEqual(row.payload, { version: 2, companion: {tone:'playful',remindersEnabled:true,dailyExpenseTarget:null,lunchReference:null,mutedUntil:null}, conversation: before.memories[kind].conversation, preferences: before.memories[kind].preferences, clarification: null });
    assert.doesNotMatch(JSON.stringify(row.payload), /ownerId|revision|local-device/);
  }
  assert.deepEqual({ ledger: f.ledger, memories: f.memories }, before);
  assert.deepEqual(f.localCalls, ['ledger', 'owner', 'memory'], 'confirmation does not re-read changed local data or call a local writer');
});

test('preview is a captured snapshot, not a mutable pointer to later local edits', async () => {
  const f = fixture(), prepared = await f.prepare();
  f.ledger.transactions[0].amount = 999; f.memories.personal.conversation[0].content = 'later edit';
  f.memories.travel.preferences.length = 0;
  await prepared.execute();
  assert.equal(f.rows.get('ledger').payload.transactions[0].amount, 35);
  assert.equal(f.rows.get('memory_personal').payload.conversation[0].content, '合成对话');
  assert.equal(f.rows.get('memory_travel').payload.preferences.length, 1);
  assert.throws(() => { prepared.counts.transactions = 99; }, TypeError);
});

test('any existing cloud resource including an empty tombstone rejects preview before reading guest data', async () => {
  for (const resource of ['ledger', 'memory_personal', 'memory_family', 'memory_travel']) {
    const f = fixture(); f.rows.set(resource, { resource, revision: 9, payload: resource === 'ledger' ? { ...defaultState(), revision: 9 } : emptyContents() });
    await assert.rejects(f.prepare(), /已有云端数据.*不能.*覆盖/);
    assert.equal(f.localCalls.length, 0); assert.equal(f.rows.size, 1); assert.equal(f.calls.length, 1);
  }
});

test('cloud changes between preview and confirmation are rejected without sending a write', async () => {
  const f = fixture(), prepared = await f.prepare();
  f.rows.set('memory_family', { resource: 'memory_family', revision: 1, payload: emptyContents() });
  await assert.rejects(prepared.execute(), /已有云端数据/);
  assert.equal(f.rows.size, 1); assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 0);
});

test('a race after the empty check fails the four-resource CAS without partial import or automatic retry', async () => {
  const f = fixture(), prepared = await f.prepare();
  f.setHook(name => { if (name === 'xiaoman_write_resources') f.rows.set('memory_travel', { resource: 'memory_travel', revision: 1, payload: { ...emptyContents(), conversation: [message('winner')] } }); });
  await assert.rejects(prepared.execute(), /更新/);
  assert.equal(f.rows.size, 1); assert.equal(f.rows.get('memory_travel').payload.conversation[0].id, 'winner');
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1);
  await assert.rejects(prepared.execute(), /已经提交过/);
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1);
});

test('double confirmation can issue only one four-resource write', async () => {
  const f = fixture(), prepared = await f.prepare();
  const results = await Promise.allSettled([prepared.execute(), prepared.execute()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /已经提交过/);
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1); assert.equal(f.rows.size, 4);
});

test('account changes stop local reads and reject a captured confirmation before it can write another account', async () => {
  const f = fixture(); f.setCurrent(false);
  await assert.rejects(f.prepare(), /账号/); assert.equal(f.localCalls.length, 0); assert.equal(f.calls.length, 0);
  f.setCurrent(true); const prepared = await f.prepare(); f.setCurrent(false);
  await assert.rejects(prepared.execute(), /账号/); assert.equal(f.calls.length, 1); assert.equal(f.rows.size, 0);
  const g = fixture(), second = await g.prepare();
  g.setHook(name => { if (name === 'xiaoman_write_resources') g.setAuth(other); });
  await assert.rejects(second.execute(), /登录/); assert.equal(g.rows.size, 0);
  assert.equal(g.calls.at(-1).args.expected_user_id, account);
});

test('failed or malformed local reads do not create cloud resources', async () => {
  const f = fixture(); f.localRepository.read = async () => { throw new Error('本机无法读取'); };
  await assert.rejects(f.prepare(), /本机无法读取/); assert.equal(f.rows.size, 0); assert.equal(f.calls.length, 1);
  const g = fixture(); g.memories.family.preferences = [{ id: 'bad', keyword: 'x', nature: '收入', category: null }];
  await assert.rejects(g.prepare(), /无效/); assert.equal(g.rows.size, 0); assert.equal(g.calls.length, 1);
});

test('a lost response is uncertain, never retries the copy, and preserves the original device source', async () => {
  const f = fixture(), before = structuredClone(f.ledger), prepared = await f.prepare();
  f.setHook((name, args) => {
    if (name !== 'xiaoman_write_resources') return;
    for (const change of args.changes) f.rows.set(change.resource, { resource: change.resource, revision: 1, payload: structuredClone(change.payload) });
    throw new Error('lost response');
  });
  await assert.rejects(prepared.execute(), /未能确认.*核对/);
  await assert.rejects(prepared.execute(), /已经提交过/);
  assert.equal(f.rows.size, 4); assert.deepEqual(f.ledger, before);
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1);
});

test('v2 device-to-account copy retains more than forty messages and every companion setting',async()=>{
  const f=fixture();
  for(const kind of kinds){f.memories[kind].version=2;f.memories[kind].companion={tone:'gentle',remindersEnabled:false,dailyExpenseTarget:80,lunchReference:25,mutedUntil:'2026-11-01'};f.memories[kind].conversation=Array.from({length:60},(_,i)=>message(`${kind}-${i}`));}
  const prepared=await f.prepare();assert.equal(prepared.counts.conversations,180);await prepared.execute();
  for(const kind of kinds){const payload=f.rows.get(`memory_${kind}`).payload;assert.equal(payload.version,2);assert.equal(payload.conversation.length,60);assert.equal(payload.conversation[0].id,`${kind}-0`);assert.deepEqual(payload.companion,f.memories[kind].companion);}
});
