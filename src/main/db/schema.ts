export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  host      TEXT NOT NULL,
  port      INTEGER NOT NULL DEFAULT 7000,
  token     TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS tunnels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  local_ip    TEXT DEFAULT '127.0.0.1',
  local_port  INTEGER NOT NULL,
  remote_port INTEGER,
  custom_domain TEXT,
  enabled     INTEGER DEFAULT 1,
  group_name  TEXT DEFAULT '默认分组',
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);
`

export const MIGRATE_SQL = `
ALTER TABLE tunnels ADD COLUMN group_name TEXT DEFAULT '默认分组';
`

export interface NodeRow {
  id: number
  name: string
  host: string
  port: number
  token: string | null
  created_at: number
}

export interface TunnelRow {
  id: number
  node_id: number
  name: string
  type: string
  local_ip: string
  local_port: number
  remote_port: number | null
  custom_domain: string | null
  enabled: number
  group_name: string
  created_at: number
}
