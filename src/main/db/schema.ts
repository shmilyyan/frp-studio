export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  host      TEXT NOT NULL,
  port      INTEGER NOT NULL DEFAULT 7000,
  token     TEXT,
  auto_start INTEGER DEFAULT 0,
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
  auto_start  INTEGER DEFAULT 1,
  group_name  TEXT DEFAULT '默认分组',
  extra_attrs TEXT DEFAULT '{}',
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);
`

export const MIGRATIONS: string[] = [
  `ALTER TABLE tunnels ADD COLUMN group_name TEXT DEFAULT '默认分组';`,
  `ALTER TABLE tunnels ADD COLUMN extra_attrs TEXT DEFAULT '{}';`,
  `ALTER TABLE nodes ADD COLUMN auto_start INTEGER DEFAULT 0;`,
  `ALTER TABLE tunnels ADD COLUMN auto_start INTEGER DEFAULT 1;`
]

export interface NodeRow {
  id: number
  name: string
  host: string
  port: number
  token: string | null
  auto_start: number
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
  auto_start: number
  group_name: string
  extra_attrs: string  // JSON: { [key: string]: string }
  created_at: number
}
