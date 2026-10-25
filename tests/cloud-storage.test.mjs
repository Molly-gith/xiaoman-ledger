import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRepository, createCloudStore } from '../lib/data/cloud-adapter.ts';
import { createCloudMemoryRepository } from '../lib/data/cloud-memory.ts';
import { createCloudTransport } from '../lib/data/cloud-transport.ts';
import { defaultState } from '../lib/data/schema.ts';

const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const kinds = ['personal', 'family', 'travel'];
const message = (id, extra = {}) => ({ id, role: 'user', content: `对话${id}`, createdAt: '2026-10-25T02:00:00.000Z', ...extra });
const rule = (extra = {}) => ({ id: 'fitness', keyword: '健身课', category: null, nature: '投资', ...extra });
const tx = (id, extra = {}) => ({ id, type: 'expense', amount: 35, date: '2026-10-25', category: '餐饮', note: '午饭', icon: '🍜', source: 'text', cycleId: null, nature: '消费', spendKind: 'variable', ...extra });
const revisions = all => Object.fromEntries(kinds.map(kind => [kind, all[kind].revision]));
const emptyMemory = () => ({ conversation: [], preferences: [], clarification: null });
const error = code => ({ data: null, error: { code, message: 'PRIVATE DATABASE DETAIL', details: 'sensitive' } });

// A credential-free in-memory RPC double: atomic batches and auth identity checks,
// never a replacement for the database RLS tests or a live Supabase connection.
function fixture() {
  const records = new Map(), calls = [];
  let authenticated = alice, current = true, hook = null;
  const key = (owner, resource) => `${owner}:${resource}`;
  const client = { async rpc(name, args) {
    calls.push(structuredClone({ name, args }));
    if (hook) { const result = await hook(name, args); if (result !== undefined) return result; }
    if (authenticated !== args.expected_user_id) return error('42501');
    if (name === 'xiaoman_read_resources') return { data: [...records.entries()].filter(([key, row]) => key.startsWith(`${authenticated}:`) && args.resources.includes(row.resource)).map(([, row]) => structuredClone(row)), error: null };
    assert.equal(name, 'xiaoman_write_resources');
    const updates = [];
    for (const change of args.changes) {
      const existing = records.get(key(authenticated, change.resource));
      if ((existing?.revision ?? 0) !== change.expected_revision) return error('40001');
      updates.push({ resource: change.resource, revision: change.expected_revision + 1, payload: structuredClone(change.payload) });
    }
    for (const row of updates) records.set(key(authenticated, row.resource), row);
    return { data: structuredClone(updates), error: null };
  } };
  return { client, calls, records, key, repo: createCloudRepository(client, alice, () => current), memory: createCloudMemoryRepository(client, alice, () => current),
    setCurrent(value) { current = value; }, setAuth(value) { authenticated = value; }, setHook(value) { hook = value; } };
}

test('empty cloud account reads defaults without opening or populating guest storage', async () => {
  const f = fixture();
  assert.deepEqual(await f.repo.read(), defaultState());
  assert.equal(await f.memory.getLocalOwnerId(), alice);
  const all = await f.memory.readOwner(alice);
  for (const kind of kinds) { assert.equal(all[kind].ownerId, alice); assert.equal(all[kind].revision, 0); assert.deepEqual(all[kind].conversation, []); }
  assert.equal(f.records.size, 0); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].args, { expected_user_id: alice, resources: ['ledger'] });
  assert.deepEqual(f.calls[1].args, { expected_user_id: alice, resources: ['memory_personal', 'memory_family', 'memory_travel'] });
  assert.equal(globalThis.indexedDB, undefined, 'test has no local database to fall back to');
});

test('cloud ledger preserves three books and survives a new repository instance', async () => {
  const f = fixture(); let state = await f.repo.saveTransaction(tx('personal'), 0);
  state = await f.repo.switchLedger('family', state.revision);
  state = await f.repo.saveTransaction(tx('family', { type: 'income', amount: 8000, category: '收入', nature: null, spendKind: null }), state.revision);
  const reload = createCloudRepository(f.client, alice, () => true);
  assert.deepEqual(await reload.read(), state);
  assert.equal(state.transactions[0].id, 'family'); assert.equal(state.otherLedgers.personal.transactions[0].id, 'personal');
  assert.deepEqual(state.otherLedgers.travel.transactions, []);
  const saved = f.records.get(f.key(alice, 'ledger')); assert.equal(saved.revision, 3); assert.equal(saved.payload.revision, 3);
  const returned = await reload.read(); returned.transactions[0].amount = 1;
  assert.equal((await reload.read()).transactions[0].amount, 8000);
});

test('simultaneous devices conflict at durable CAS and duplicate submission does not duplicate a record', async () => {
  const f = fixture(), other = createCloudRepository(f.client, alice, () => true);
  const results = await Promise.allSettled([f.repo.saveTransaction(tx('a'), 0), other.saveTransaction(tx('b'), 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /更新/);
  const saved = await f.repo.read(); assert.equal(saved.transactions.length, 1); assert.equal(saved.revision, 1);
  await assert.rejects(f.repo.saveTransaction(saved.transactions[0], 0), /更新/);
  await assert.rejects(f.repo.saveTransactions(saved.transactions, 1), /重复|存在|保存/);
  assert.deepEqual(await f.repo.read(), saved);
});

test('cloud repositories keep strict ledger validation and reject revision-envelope mismatch', async () => {
  const f = fixture();
  await assert.rejects(f.repo.saveTransaction(tx('bad', { amount: -2 }), 0)); assert.equal(f.records.size, 0);
  const store = createCloudStore(f.client, alice, () => true);
  await assert.rejects(store.commit({ ...defaultState(), revision: 4 }, 0), /格式/);
  f.records.set(f.key(alice, 'ledger'), { resource: 'ledger', revision: 2, payload: { ...defaultState(), revision: 1 } });
  await assert.rejects(f.repo.read(), /格式/);
  f.records.set(f.key(alice, 'ledger'), { resource: 'ledger', revision: 2, payload: { ...defaultState(), revision: 2, transactions: [tx('bad', { date: '2026-02-30' })] } });
  await assert.rejects(f.repo.read());
});

test('RPC failure never becomes an empty account or successful local save, and errors do not echo provider details', async () => {
  const f = fixture();
  f.setHook(() => { throw new Error('PRIVATE transport detail'); });
  await assert.rejects(f.repo.read(), err => /无法读取/.test(err.message) && !/PRIVATE/.test(err.message));
  assert.equal(f.calls.length, 1, 'no automatic retry');
  f.setHook((name) => name === 'xiaoman_write_resources' ? error('08006') : undefined);
  await assert.rejects(f.repo.saveTransaction(tx('lost'), 0), err => /保存未能确认/.test(err.message) && !/PRIVATE|sensitive/.test(err.message));
  assert.equal(f.records.size, 0);
  f.setHook(null); assert.deepEqual((await f.repo.read()).transactions, []);
});

test('lost response after a committed write is reported as uncertain and is never automatically retried', async () => {
  const f = fixture();
  f.setHook((name, args) => {
    if (name !== 'xiaoman_write_resources') return;
    for (const change of args.changes) f.records.set(f.key(alice, change.resource), { resource: change.resource, revision: change.expected_revision + 1, payload: structuredClone(change.payload) });
    throw new Error('connection lost after commit');
  });
  await assert.rejects(f.repo.saveTransaction(tx('durable'), 0), /核对.*勿重复/);
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1);
  f.setHook(null); assert.equal((await f.repo.read()).transactions[0].id, 'durable');
});

test('logout before or during a read rejects old-session results, and read-to-write session change cannot send a write', async () => {
  const f = fixture(); f.setCurrent(false);
  await assert.rejects(f.repo.read(), /账号/); assert.equal(f.calls.length, 0);
  f.setCurrent(true); f.setHook(() => { f.setCurrent(false); });
  await assert.rejects(f.repo.saveTransaction(tx('stale'), 0), /账号/);
  assert.equal(f.calls.length, 1); assert.equal(f.records.size, 0);
  f.setCurrent(true);
  f.setHook(name => { if (name === 'xiaoman_write_resources') f.setCurrent(false); });
  await assert.rejects(f.repo.saveTransaction(tx('old-account'), 0), /账号/);
  assert.equal(f.records.get(f.key(alice, 'ledger')).payload.transactions[0].id, 'old-account', 'an already-started write may finish only in its original account');
});

test('expected_user_id rejects an auth-token swap even when the UI session guard is late', async () => {
  const f = fixture(); f.setAuth(bob);
  await assert.rejects(f.repo.read(), /登录/);
  f.setAuth(alice);
  f.setHook(name => { if (name === 'xiaoman_write_resources') f.setAuth(bob); });
  await assert.rejects(f.repo.saveTransaction(tx('wrong-owner'), 0), /登录/);
  assert.equal(f.records.size, 0); assert.equal(f.calls.at(-1).args.expected_user_id, alice);
});

test('resource response validation rejects duplicates, unknown resources, malformed rows and partial writes', async () => {
  for (const data of [null, {}, [{ resource: 'other', revision: 1, payload: {} }], [{ resource: 'ledger', revision: 1.5, payload: {} }],
    [{ resource: 'ledger', revision: 1, payload: null }], [{ resource: 'ledger', revision: 1, payload: {}, owner: bob }],
    [{ resource: 'ledger', revision: 1, payload: {} }, { resource: 'ledger', revision: 1, payload: {} }]]) {
    const f = fixture(); f.setHook(() => ({ data, error: null })); await assert.rejects(f.repo.read(), /格式/);
  }
  const f = fixture(); f.setHook(name => name === 'xiaoman_write_resources' ? { data: [], error: null } : undefined);
  await assert.rejects(f.repo.saveTransaction(tx('missing'), 0), /保存结果未能确认/);
});

test('all memory reads use one RPC, contents are cloud-only and identity/revision stay outside payload', async () => {
  const f = fixture(); let state = await f.memory.appendConversation(alice, 'personal', [message('user'), message('reply', { role: 'assistant', content: '请确认', query: { range: { startDate: '2026-10-01', endDate: '2026-10-31' }, type: 'expense', metric: 'total' } })], 0, { originalText: '午饭', question: '金额？' });
  state = await f.memory.upsertPreference(alice, 'personal', rule(), state.revision);
  const count = f.calls.length, all = await f.memory.readOwner(alice);
  assert.equal(f.calls.length - count, 1); assert.deepEqual(all.personal, state); assert.equal(all.family.revision, 0);
  assert.deepEqual(f.calls.at(-1).args.resources, ['memory_personal', 'memory_family', 'memory_travel']);
  const stored = f.records.get(f.key(alice, 'memory_personal'));
  assert.deepEqual(Object.keys(stored.payload).sort(), ['clarification', 'conversation', 'preferences']);
  assert.doesNotMatch(JSON.stringify(stored.payload), /ownerId|revision|aaaaaaaa/);
  const reload = createCloudMemoryRepository(f.client, alice, () => true);
  assert.deepEqual(await reload.read(alice, 'personal'), state);
  assert.deepEqual(f.calls.at(-1).args.resources, ['memory_personal'], 'a chat read must not fetch ledger records or other books');
  const copy = await reload.read(alice, 'personal'); copy.conversation[0].content = 'changed';
  assert.equal((await reload.read(alice, 'personal')).conversation[0].content, '对话user');
});

test('memory owner and malformed cloud contents fail closed instead of changing identity or resetting contents', async () => {
  const f = fixture();
  await assert.rejects(f.memory.read(bob, 'personal'), /账号/); assert.equal(f.calls.length, 0);
  for (const payload of [{ ...emptyMemory(), ownerId: bob }, { ...emptyMemory(), conversation: [message('x', { role: 'system' })] },
    { ...emptyMemory(), preferences: [rule({ keyword: 'x' })] }, { ...emptyMemory(), clarification: { originalText: '午饭' } }]) {
    f.records.set(f.key(alice, 'memory_family'), { resource: 'memory_family', revision: 1, payload });
    await assert.rejects(f.memory.readOwner(alice), /无效/);
  }
  assert.equal(f.records.size, 1);
});

test('memory preserves retention and validation, clones caller input before awaits and rejects duplicates', async () => {
  const f = fixture(); let state = await f.memory.appendConversation(alice, 'personal', Array.from({ length: 40 }, (_, i) => message(`m${i}`)), 0);
  const messages = [message('m40')]; const promise = f.memory.appendConversation(alice, 'personal', messages, state.revision); messages[0].content = 'late mutation';
  state = await promise;
  assert.equal(state.conversation.length, 40); assert.equal(state.conversation[0].id, 'm1'); assert.equal(state.conversation.at(-1).content, '对话m40');
  await assert.rejects(f.memory.appendConversation(alice, 'personal', [message('m40')], state.revision), /已经保存/);
  const before = f.calls.length;
  await assert.rejects(f.memory.appendConversation(alice, 'personal', [message('bad', { role: 'system' })], state.revision));
  await assert.rejects(f.memory.appendConversation(alice, 'personal', [message('bad')], state.revision, { originalText: 'missing question' }));
  assert.equal(f.calls.length, before);
  assert.deepEqual(await f.memory.read(alice, 'personal'), state);
});

test('memory preference CRUD and conversation clearing preserve the same limits as guest mode', async () => {
  const f = fixture(); let state = await f.memory.upsertPreference(alice, 'personal', rule(), 0);
  state = await f.memory.appendConversation(alice, 'personal', [message('old')], state.revision, { originalText: '午饭', question: '金额？' });
  state = await f.memory.replaceConversation(alice, 'personal', [message('new')], state.revision, null);
  assert.equal(state.clarification, null); assert.deepEqual(state.conversation.map(item => item.id), ['new']);
  await assert.rejects(f.memory.upsertPreference(alice, 'personal', rule({ id: 'duplicate' }), state.revision), /无效/);
  await assert.rejects(f.memory.upsertPreference(alice, 'personal', rule({ nature: null }), state.revision), /格式/);
  state = await f.memory.clearConversation(alice, 'personal', state.revision); assert.deepEqual(state.preferences, [rule()]);
  state = await f.memory.deletePreference(alice, 'personal', 'fitness', state.revision); assert.deepEqual(state.preferences, []);
  await assert.rejects(f.memory.deletePreference(alice, 'personal', 'missing', state.revision), /不存在/);
});

test('concurrent memory writers conflict without losing the winner', async () => {
  const f = fixture(), other = createCloudMemoryRepository(f.client, alice, () => true);
  const results = await Promise.allSettled([f.memory.appendConversation(alice, 'personal', [message('a')], 0), other.upsertPreference(alice, 'personal', rule(), 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /更新/);
  assert.equal((await f.memory.read(alice, 'personal')).revision, 1);
});

test('memory import is one atomic three-book write and portable backups contain no account identity', async () => {
  const f = fixture(); for (const kind of kinds) await f.memory.appendConversation(alice, kind, [message(kind)], 0);
  const backup = await f.memory.exportOwner(alice); assert.doesNotMatch(JSON.stringify(backup), /ownerId|revision|aaaaaaaa/);
  const all = await f.memory.readOwner(alice); const before = f.calls.length;
  const imported = await f.memory.importOwner(alice, backup, revisions(all));
  assert.equal(f.calls.length - before, 2); assert.equal(f.calls.at(-1).args.changes.length, 3);
  for (const kind of kinds) { assert.equal(imported[kind].revision, 2); assert.equal(imported[kind].conversation[0].id, kind); }
  const oldBackup = structuredClone(backup); oldBackup.ledgers.travel.ownerId = bob;
  await assert.rejects(f.memory.importOwner(alice, oldBackup, revisions(imported))); assert.deepEqual(await f.memory.readOwner(alice), imported);
});

test('a conflicting inactive memory book rolls back the complete import, with no partial writes or retry', async () => {
  const f = fixture(); const initial = await f.memory.readOwner(alice), backup = await f.memory.exportOwner(alice);
  backup.ledgers.personal.conversation = [message('imported')];
  f.setHook(name => {
    if (name === 'xiaoman_write_resources') f.records.set(f.key(alice, 'memory_travel'), { resource: 'memory_travel', revision: 1, payload: { ...emptyMemory(), conversation: [message('winner')] } });
  });
  await assert.rejects(f.memory.importOwner(alice, backup, revisions(initial)), /更新/);
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').length, 1);
  assert.equal(f.records.has(f.key(alice, 'memory_personal')), false); assert.equal(f.records.has(f.key(alice, 'memory_family')), false);
  f.setHook(null); assert.equal((await f.memory.read(alice, 'travel')).conversation[0].id, 'winner');
});

test('clearing account conversations preserves preferences, full clear retains revision tombstones', async () => {
  const f = fixture();
  for (const kind of kinds) { await f.memory.appendConversation(alice, kind, [message(kind)], 0); await f.memory.upsertPreference(alice, kind, rule(), 1); }
  let all = await f.memory.clearOwnerConversations(alice);
  for (const kind of kinds) { assert.equal(all[kind].revision, 3); assert.deepEqual(all[kind].conversation, []); assert.deepEqual(all[kind].preferences, [rule()]); }
  all = await f.memory.clearOwner(alice);
  for (const kind of kinds) { assert.equal(all[kind].revision, 4); assert.deepEqual(all[kind].preferences, []); }
  await assert.rejects(f.memory.appendConversation(alice, 'family', [message('stale')], 2), /更新/);
  assert.equal(f.calls.filter(call => call.name === 'xiaoman_write_resources').at(-1).args.changes.length, 3);
});

test('cloud transport accepts only unique resources and bounded integer revisions', async () => {
  const f = fixture(), transport = createCloudTransport(f.client, alice, () => true);
  for (const changes of [[], [{ resource: 'bad', expected_revision: 0, payload: {} }], [{ resource: 'ledger', expected_revision: -1, payload: {} }],
    [{ resource: 'ledger', expected_revision: Number.MAX_SAFE_INTEGER - 1, payload: {} }], [{ resource: 'ledger', expected_revision: 0, payload: null }],
    [{ resource: 'ledger', expected_revision: 0, payload: {} }, { resource: 'ledger', expected_revision: 0, payload: {} }]]) await assert.rejects(transport.write(changes), /格式/);
  for (const resources of [[], ['unknown'], ['ledger', 'ledger']]) await assert.rejects(transport.read(resources), /格式/);
  assert.equal(f.calls.length, 0);
  f.setHook(() => ({ data: [{ resource: 'ledger', revision: 1, payload: { ...defaultState(), revision: 1 } }], error: null }));
  await assert.rejects(transport.read(['memory_personal']), /格式/, 'unrequested data cannot be silently consumed');
});
