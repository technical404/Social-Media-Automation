export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;
export type Stmt = { sql: string; params?: SqlValue[] };

export type StorageMode = "python" | "browser";

/** One interface, two engines: the Python backend (real SQLite file) or SQLite running inside the browser. */
export interface Driver {
  mode: StorageMode;
  /** Human description of where data lives. */
  location: string;
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** All statements succeed or none do. */
  tx(stmts: Stmt[]): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  restoreBytes(bytes: Uint8Array): Promise<void>;
  integrity(): Promise<string>;
}
