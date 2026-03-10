import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import initSqlJs, { Database } from 'sql.js'
import { CREATE_TABLES_SQL, MIGRATIONS, NodeRow, TunnelRow } from './schema'

let db: Database | null = null
let dbPath: string

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  dbPath = path.join(userDataPath, 'frp-studio.db')

  const SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(CREATE_TABLES_SQL)

  // 迁移：逐条执行，已存在则忽略
  for (const sql of MIGRATIONS) {
    try {
      db.run(sql)
    } catch {
      // 列已存在则忽略
    }
  }

  saveDatabase()
}

function saveDatabase(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

function getDb(): Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

// ─── Node operations ─────────────────────────────────────────────────────────

export function listNodes(): NodeRow[] {
  const stmt = getDb().prepare('SELECT * FROM nodes ORDER BY created_at DESC')
  const rows: NodeRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as NodeRow)
  }
  stmt.free()
  return rows
}

export function addNode(data: Omit<NodeRow, 'id' | 'created_at'>): NodeRow {
  const db = getDb()
  db.run('INSERT INTO nodes (name, host, port, token) VALUES (?, ?, ?, ?)', [
    data.name,
    data.host,
    data.port,
    data.token ?? null
  ])
  saveDatabase()
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number
  return getNodeById(id)!
}

export function updateNode(id: number, data: Partial<Omit<NodeRow, 'id' | 'created_at'>>): NodeRow {
  const fields = Object.keys(data)
    .map((k) => `${k} = ?`)
    .join(', ')
  const values = [...Object.values(data), id]
  getDb().run(`UPDATE nodes SET ${fields} WHERE id = ?`, values)
  saveDatabase()
  return getNodeById(id)!
}

export function deleteNode(id: number): void {
  getDb().run('DELETE FROM nodes WHERE id = ?', [id])
  saveDatabase()
}

export function getNodeById(id: number): NodeRow | null {
  const stmt = getDb().prepare('SELECT * FROM nodes WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as NodeRow
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

// ─── Tunnel operations ────────────────────────────────────────────────────────

export function listTunnels(nodeId?: number): TunnelRow[] {
  const db = getDb()
  const stmt = nodeId
    ? db.prepare('SELECT * FROM tunnels WHERE node_id = ? ORDER BY group_name, created_at DESC')
    : db.prepare('SELECT * FROM tunnels ORDER BY group_name, created_at DESC')
  if (nodeId) stmt.bind([nodeId])
  const rows: TunnelRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as TunnelRow)
  }
  stmt.free()
  return rows
}

export function listGroups(): string[] {
  const stmt = getDb().prepare(
    "SELECT DISTINCT group_name FROM tunnels WHERE group_name IS NOT NULL ORDER BY group_name"
  )
  const groups: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { group_name: string }
    groups.push(row.group_name)
  }
  stmt.free()
  if (!groups.includes('默认分组')) groups.unshift('默认分组')
  return groups
}

export function addTunnel(data: Omit<TunnelRow, 'id' | 'created_at'>): TunnelRow {
  const db = getDb()
  db.run(
    'INSERT INTO tunnels (node_id, name, type, local_ip, local_port, remote_port, custom_domain, enabled, group_name, extra_attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      data.node_id,
      data.name,
      data.type,
      data.local_ip || '127.0.0.1',
      data.local_port,
      data.remote_port ?? null,
      data.custom_domain ?? null,
      data.enabled ?? 1,
      data.group_name || '默认分组',
      data.extra_attrs || '{}'
    ]
  )
  saveDatabase()
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number
  return getTunnelById(id)!
}

export function updateTunnel(
  id: number,
  data: Partial<Omit<TunnelRow, 'id' | 'created_at'>>
): TunnelRow {
  const fields = Object.keys(data)
    .map((k) => `${k} = ?`)
    .join(', ')
  const values = [...Object.values(data), id]
  getDb().run(`UPDATE tunnels SET ${fields} WHERE id = ?`, values)
  saveDatabase()
  return getTunnelById(id)!
}

export function deleteTunnel(id: number): void {
  getDb().run('DELETE FROM tunnels WHERE id = ?', [id])
  saveDatabase()
}

export function getTunnelById(id: number): TunnelRow | null {
  const stmt = getDb().prepare('SELECT * FROM tunnels WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as TunnelRow
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

export function bulkSetEnabled(ids: number[], enabled: number): void {
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  db.run(`UPDATE tunnels SET enabled = ? WHERE id IN (${placeholders})`, [enabled, ...ids])
  saveDatabase()
}

export function bulkDeleteTunnels(ids: number[]): void {
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  db.run(`DELETE FROM tunnels WHERE id IN (${placeholders})`, ids)
  saveDatabase()
}
