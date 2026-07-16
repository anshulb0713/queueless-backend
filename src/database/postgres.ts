import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config/env.js';

export const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.nodeEnv === 'development' ? undefined : { rejectUnauthorized: false } });
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) { return pool.query<T>(text, params); }
export async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
