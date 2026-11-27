import { describe, expect, it } from 'vitest';
import { followRound } from '../../src/lib/data.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('followRound', () => {
  function setup() {
    const pending = { A: deferred(), B: deferred() };
    const seen = { data: [], errors: [] };
    const follow = (id) => followRound(id, (x) => pending[x].promise, (r) => seen.data.push(r), (e) => seen.errors.push(e.message));
    return { pending, seen, follow };
  }

  it('reports the round that is still selected', async () => {
    const { pending, seen, follow } = setup();
    follow('A');
    pending.A.resolve({ id: 'A' });
    await pending.A.promise;
    expect(seen.data).toEqual([{ id: 'A' }]);
  });

  it('ignores a late answer for a round that was switched away from', async () => {
    const { pending, seen, follow } = setup();
    const cancelA = follow('A');
    cancelA();
    follow('B');
    pending.B.resolve({ id: 'B' });
    await pending.B.promise;
    pending.A.resolve({ id: 'A' });
    await pending.A.promise;
    expect(seen.data).toEqual([{ id: 'B' }]);
  });

  it('ignores a late failure for a round that was switched away from', async () => {
    const { pending, seen, follow } = setup();
    const cancelA = follow('A');
    cancelA();
    follow('B');
    pending.B.resolve({ id: 'B' });
    pending.A.reject(new Error('A: HTTP 500'));
    await pending.B.promise;
    await pending.A.promise.catch(() => {});
    expect(seen.errors).toEqual([]);
    expect(seen.data).toEqual([{ id: 'B' }]);
  });

  it('still reports a failure of the selected round', async () => {
    const { pending, seen, follow } = setup();
    follow('A');
    pending.A.reject(new Error('A: HTTP 500'));
    await pending.A.promise.catch(() => {});
    expect(seen.errors).toEqual(['A: HTTP 500']);
  });
});
