import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock('../db', () => ({ createPool: () => ({ connect: mock.connect }) }));
import { reserveQuota } from './quota-reservation';

beforeEach(() => {
  vi.clearAllMocks();
  mock.connect.mockResolvedValue({ query: mock.query, release: mock.release });
  mock.query.mockImplementation(async (sql: string) => sql.includes('key_units')
    ? { rows: [{ key_units: 2, user_units: 7 }] } : { rows: [] });
});
it('reads and commits usage on the same transaction client under the account lock', async () => {
  const reservation = await reserveQuota(123, 'key-one');
  expect(reservation.used).toEqual({ key: 2, user: 7 });
  expect(mock.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
  expect(mock.query.mock.calls[2]).toEqual(['SELECT pg_advisory_xact_lock(8160, $1)', [123]]);
  expect(mock.release).not.toHaveBeenCalled();
  await reservation.commit(3);
  expect(mock.query.mock.calls[4][1]).toEqual(['key-one', 123, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 3]);
  expect(mock.query.mock.calls[5][0]).toBe('COMMIT');
  await reservation.rollback();
  expect(mock.release).toHaveBeenCalledOnce();
  await expect(reservation.commit(1)).rejects.toThrow('already settled');
});
it('rolls back and releases when the account lock cannot be acquired', async () => {
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.includes('advisory')) throw new Error('lock timeout');
    return { rows: [] };
  });
  await expect(reserveQuota(123, 'key')).rejects.toThrow('lock timeout');
  expect(mock.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(mock.release).toHaveBeenCalledOnce();
});
it('does not commit after a failed ledger write and destroys a connection if rollback fails', async () => {
  const reservation = await reserveQuota(123, 'key');
  mock.query.mockRejectedValue(new Error('connection lost'));
  await expect(reservation.commit(3)).rejects.toThrow('connection lost');
  expect(mock.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(mock.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  await reservation.rollback();
  expect(mock.release).toHaveBeenCalledOnce();
});
