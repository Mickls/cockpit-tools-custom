import assert from 'node:assert/strict';
import test from 'node:test';
import { syncAccountDisplayName } from './codexCredentialSyncService';

test('workspace names distinguish the same mailbox without changing account IDs', () => {
  const account = { id: 'team-one', email: 'same@example.test' };
  assert.equal(syncAccountDisplayName({ ...account, accountName: 'Constructs' }), 'Constructs (same@example.test)');
  assert.equal(syncAccountDisplayName({ ...account, id: 'team-two', accountName: 'CharJC' }), 'CharJC (same@example.test)');
  assert.equal(syncAccountDisplayName(account), account.email);
  assert.equal(syncAccountDisplayName({ ...account, accountName: account.email }), account.email);
});
