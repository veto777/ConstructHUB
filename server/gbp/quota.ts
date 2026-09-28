import { pool } from '../db';
import { Limiter, sleep } from './client';
/** Shared by all application processes using this project's database. */
export class DatabaseLimiter extends Limiter {
  override async take() {
    for (;;) {
      const reserved = await pool.query(`UPDATE gbp_request_budget SET next_at=clock_timestamp()+interval '201 milliseconds'
        WHERE id=1 AND next_at<=clock_timestamp() RETURNING id`);
      if (reserved.rowCount) return;
      const {rows:[row]} = await pool.query('SELECT GREATEST(1,EXTRACT(EPOCH FROM (next_at-clock_timestamp()))*1000) AS delay FROM gbp_request_budget WHERE id=1');
      if (!row) throw new Error('GBP quota schema is not initialized');
      await sleep(Math.ceil(Number(row.delay)));
    }
  }
}
