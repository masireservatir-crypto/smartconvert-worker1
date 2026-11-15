// A minimal D1-compatible wrapper around node:sqlite, so tests run real SQL (D1 is SQLite).
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  db: DatabaseSync;
  sql: string;
  params: unknown[];
  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params);
  }
  async first(col?: string) {
    const row = this.db.prepare(this.sql).get(...(this.params as any[])) as any;
    if (row === undefined) return null;
    return col ? row[col] : { ...row };
  }
  async all() {
    const rows = this.db.prepare(this.sql).all(...(this.params as any[])) as any[];
    return { success: true, results: rows.map((r) => ({ ...r })), meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.params as any[]));
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createD1(db: DatabaseSync): any {
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
    batch: async (stmts: Stmt[]) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}
