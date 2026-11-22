import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { DraftSummary, PersonalRecord, SaveHistorySummary } from '../src/types/desktopData.js'
import type { LocalWorkspace, PersonalOperation } from './personal-data-contract.cjs'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import { contentHash, object, PERSONAL_LIMITS, requireData, revision, text, uuid, validateDraft, validateHistory, validatePreferences } from './personal-data-validation.cjs'

type Row = Record<string, string | number | bigint | Uint8Array | null>
export type RetainedHistory = { id: string; local_folder_id: string; workspace_id: string; api_id: string; saved_at: string; byte_size: number }

/** rows는 saved_at·id 오름차순입니다. 기간·API별 건수·전역 바이트 기준을 함께 적용합니다. */
export function historyIdsToPrune(rows: RetainedHistory[], now: number, lastObserved: number): string[] {
  const key = (row: RetainedHistory) => `${row.local_folder_id}/${row.workspace_id}/${row.api_id}`
  const counts = new Map<string, number>()
  let bytes = 0
  for (const row of rows) { counts.set(key(row), (counts.get(key(row)) ?? 0) + 1); bytes += row.byte_size }
  const deleted = new Set<string>()
  for (const row of rows) {
    const group = key(row)
    const expired = now >= lastObserved && Date.parse(row.saved_at) < now - 90 * 24 * 60 * 60 * 1000
    if (expired || counts.get(group)! > 100) {
      deleted.add(row.id); counts.set(group, counts.get(group)! - 1); bytes -= row.byte_size
    }
  }
  for (const row of rows) {
    if (bytes <= PERSONAL_LIMITS.history) { break }
    if (!deleted.has(row.id)) { deleted.add(row.id); bytes -= row.byte_size }
  }
  return [...deleted]
}

/** Worker 전용 저장 처리. clock은 UTC 시각을 만드는 함수이며 테스트에서만 고정 시각을 주입합니다. */
export class PersonalDataStore {
  private lastObserved: number
  constructor(private readonly database: DatabaseSync, private readonly clock: () => Date = () => new Date()) {
    const row = database.prepare(`SELECT max(value) AS latest FROM (
      SELECT applied_at AS value FROM schema_migrations UNION ALL SELECT saved_at FROM api_save_history
      UNION ALL SELECT updated_at FROM drafts UNION ALL SELECT updated_at FROM app_preferences
      UNION ALL SELECT updated_at FROM workspace_preferences UNION ALL SELECT last_opened_at FROM local_folders
    )`).get()
    this.lastObserved = Date.parse(String(row?.latest))
    if (!Number.isFinite(this.lastObserved)) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
    try { this.transaction(() => this.pruneHistory(this.now())) } catch (error) {
      if (error instanceof PersonalDatabaseError) { throw error }
      throw new PersonalDatabaseError('DATABASE_WRITE_FAILED')
    }
  }

  /** 알 수 없는 작업·필드는 거부합니다. SQL·DB 경로·범용 키 접근을 작업 DTO로 받지 않습니다. */
  execute(operation: PersonalOperation, input: unknown): unknown {
    const writes = new Set<PersonalOperation>(['rememberWorkspace', 'savePreferences', 'saveDraft', 'removeDraft', 'recordHistory'])
    try {
      switch (operation) {
        case 'rememberWorkspace': return this.rememberWorkspace(input)
        case 'preferences': return this.preferences(input)
        case 'savePreferences': return this.savePreferences(input)
        case 'drafts': return this.drafts(input)
        case 'draft': return this.draft(input)
        case 'saveDraft': return this.saveDraft(input)
        case 'removeDraft': return this.removeDraft(input)
        case 'recordHistory': return this.recordHistory(input)
        case 'history': return this.history(input)
        case 'historyEntry': return this.historyEntry(input)
        default: throw new PersonalDatabaseError('INVALID_REQUEST')
      }
    } catch (error) {
      if (error instanceof PersonalDatabaseError) { throw error }
      throw new PersonalDatabaseError(writes.has(operation) ? 'DATABASE_WRITE_FAILED' : 'DATABASE_UNAVAILABLE')
    }
  }

  private now(): string {
    const date = this.clock()
    requireData(Number.isFinite(date.getTime()))
    this.lastObserved = Math.max(this.lastObserved, date.getTime())
    return date.toISOString()
  }
  private transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
      throw error
    }
  }
  /** 폴더 ID와 workspace ID를 함께 확인합니다. handle의 권한 확인은 Main의 책임입니다. */
  private workspace(value: unknown): LocalWorkspace {
    const scope = object(value, ['localFolderId', 'workspaceId'])
    uuid(scope.localFolderId); uuid(scope.workspaceId)
    if (!this.database.prepare('SELECT 1 FROM workspace_links WHERE local_folder_id = ? AND workspace_id = ?').get(scope.localFolderId, scope.workspaceId)) {
      throw new PersonalDatabaseError('NOT_FOUND')
    }
    return { localFolderId: scope.localFolderId, workspaceId: scope.workspaceId }
  }
  private record(row: Row | undefined, validate: (json: unknown) => string): PersonalRecord | null {
    if (!row) { return null }
    try {
      const json = validate(row.json)
      revision(row.revision); text(row.updated_at)
      return { revision: row.revision!, json, updatedAt: row.updated_at }
    } catch (error) {
      if (error instanceof PersonalDatabaseError && error.code === 'DATABASE_VERSION_UNSUPPORTED') { throw error }
      throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
    }
  }
  private compareRevision(current: Row | undefined, expected: unknown): number {
    revision(expected, true)
    if ((!current && expected !== null) || (current && (current.revision !== expected || expected === Number.MAX_SAFE_INTEGER))) {
      throw new PersonalDatabaseError('RECORD_CONFLICT')
    }
    return current ? Number(current.revision) + 1 : 0
  }
  private rememberWorkspace(input: unknown): LocalWorkspace {
    const data = object(input, ['canonicalPath', 'pathKey', 'workspaceId', 'displayName'])
    text(data.canonicalPath); text(data.pathKey); uuid(data.workspaceId); text(data.displayName)
    requireData(path.isAbsolute(data.canonicalPath) && data.pathKey.length > 0 && data.displayName.trim().length > 0)
    return this.transaction(() => {
      const now = this.now()
      const existing = this.database.prepare('SELECT local_folder_id, canonical_path FROM local_folders WHERE path_key = ?').get(data.pathKey as string)
      if (existing && existing.canonical_path !== data.canonicalPath) { throw new PersonalDatabaseError('RECORD_CONFLICT') }
      const folderId = existing ? String(existing.local_folder_id) : randomUUID()
      if (!existing) {
        this.database.prepare('INSERT INTO local_folders VALUES (?, ?, ?, ?, ?, 0)').run(folderId, data.canonicalPath as string, data.pathKey as string, now, now)
      } else { this.database.prepare('UPDATE local_folders SET last_opened_at = ? WHERE local_folder_id = ?').run(now, folderId) }
      this.database.prepare(`INSERT INTO workspace_links VALUES (?, ?, ?, ?)
        ON CONFLICT (local_folder_id, workspace_id) DO UPDATE SET display_name = excluded.display_name, last_opened_at = excluded.last_opened_at`)
        .run(folderId, data.workspaceId as string, data.displayName as string, now)
      // 최근 목록 숨김만 갱신하며 연결·초안·이력을 삭제하지 않습니다.
      this.database.exec(`UPDATE local_folders SET hidden = 1;
        UPDATE local_folders SET hidden = 0 WHERE local_folder_id IN (
          SELECT local_folder_id FROM local_folders ORDER BY last_opened_at DESC, local_folder_id DESC LIMIT 20
        )`)
      return { localFolderId: folderId, workspaceId: data.workspaceId as string }
    })
  }
  private preferenceLocation(value: unknown): { kind: 'app' | 'workspace'; table: string; where: string; keys: SQLInputValue[] } {
    const scope = object(value, ['kind', 'localFolderId', 'workspaceId'], ['kind'])
    if (scope.kind === 'app') {
      object(scope, ['kind'])
      return { kind: 'app', table: 'app_preferences', where: 'singleton_id = ?', keys: [1] }
    }
    requireData(scope.kind === 'workspace')
    const pair = this.workspace({ localFolderId: scope.localFolderId, workspaceId: scope.workspaceId })
    return { kind: 'workspace', table: 'workspace_preferences', where: 'local_folder_id = ? AND workspace_id = ?', keys: [pair.localFolderId, pair.workspaceId] }
  }
  private preferences(input: unknown): PersonalRecord | null {
    const data = object(input, ['scope'])
    const location = this.preferenceLocation(data.scope)
    return this.record(this.database.prepare(`SELECT * FROM ${location.table} WHERE ${location.where}`).get(...location.keys), json => validatePreferences(json, location.kind))
  }
  private savePreferences(input: unknown): PersonalRecord {
    const data = object(input, ['scope', 'expectedRevision', 'json'])
    const location = this.preferenceLocation(data.scope)
    revision(data.expectedRevision, true)
    const json = validatePreferences(data.json, location.kind)
    const last = (JSON.parse(json) as { lastWorkspace?: unknown }).lastWorkspace
    if (last !== undefined && last !== null) { this.workspace(last) }
    return this.transaction(() => {
      const current = this.database.prepare(`SELECT revision FROM ${location.table} WHERE ${location.where}`).get(...location.keys)
      const next = this.compareRevision(current, data.expectedRevision)
      const now = this.now()
      if (!current) {
        const placeholders = location.kind === 'app' ? '?, ?, 1, ?, ?' : '?, ?, ?, 1, ?, ?'
        this.database.prepare(`INSERT INTO ${location.table} VALUES (${placeholders})`).run(...location.keys, next, json, now)
      } else {
        const result = this.database.prepare(`UPDATE ${location.table} SET revision = ?, json = ?, updated_at = ? WHERE ${location.where} AND revision = ?`)
          .run(next, json, now, ...location.keys, data.expectedRevision as number)
        if (result.changes !== 1) { throw new PersonalDatabaseError('RECORD_CONFLICT') }
      }
      return { revision: next, json, updatedAt: now }
    })
  }
  private draftKey(data: Record<string, unknown>): { keys: SQLInputValue[]; kind: 'api' | 'preset' } {
    const scope = this.workspace(data.scope)
    const target = object(data.target, ['kind', 'apiId', 'presetId'], ['kind', 'apiId'])
    uuid(target.apiId); uuid(data.editSessionId)
    requireData(target.kind === 'api' || target.kind === 'preset')
    if (target.kind === 'api') { object(target, ['kind', 'apiId']) } else { uuid(target.presetId); requireData(target.apiId !== target.presetId) }
    return { keys: [scope.localFolderId, scope.workspaceId, target.apiId, target.kind, target.kind === 'api' ? target.apiId : target.presetId as string, data.editSessionId], kind: target.kind }
  }
  private readonly draftWhere = 'local_folder_id = ? AND workspace_id = ? AND api_id = ? AND target_kind = ? AND target_id = ? AND edit_session_id = ?'
  private drafts(input: unknown): DraftSummary[] {
    const data = object(input, ['scope', 'apiId'])
    const scope = this.workspace(data.scope); uuid(data.apiId)
    return this.database.prepare(`SELECT api_id, target_kind, target_id, edit_session_id, revision, base_revision, updated_at FROM drafts
      WHERE local_folder_id = ? AND workspace_id = ? AND api_id = ? ORDER BY updated_at DESC, edit_session_id DESC, target_kind, target_id`)
      .all(scope.localFolderId, scope.workspaceId, data.apiId).map(row => ({
        target: row.target_kind === 'api' ? { kind: 'api', apiId: String(row.api_id) } : { kind: 'preset', apiId: String(row.api_id), presetId: String(row.target_id) },
        editSessionId: String(row.edit_session_id), revision: Number(row.revision), baseRevision: String(row.base_revision) as `sha256:${string}`, updatedAt: String(row.updated_at),
      }))
  }
  private draft(input: unknown) {
    const data = object(input, ['scope', 'target', 'editSessionId'])
    const { keys, kind } = this.draftKey(data)
    const row = this.database.prepare(`SELECT * FROM drafts WHERE ${this.draftWhere}`).get(...keys)
    const record = this.record(row, json => validateDraft(json, kind, undefined, [String(keys[2]), String(keys[4])]))
    return record && row ? { ...record, baseRevision: row.base_revision } : null
  }
  private saveDraft(input: unknown): PersonalRecord {
    const data = object(input, ['scope', 'target', 'editSessionId', 'expectedRevision', 'baseRevision', 'json', 'commonJson'], ['scope', 'target', 'editSessionId', 'expectedRevision', 'baseRevision', 'json'])
    const { keys, kind } = this.draftKey(data)
    contentHash(data.baseRevision); revision(data.expectedRevision, true)
    requireData(kind === 'preset' ? typeof data.commonJson === 'string' : !Object.hasOwn(data, 'commonJson'))
    const json = validateDraft(data.json, kind, data.commonJson, [String(keys[2]), String(keys[4])])
    const bytes = Buffer.byteLength(json, 'utf8')
    if (bytes > PERSONAL_LIMITS.record) { throw new PersonalDatabaseError('PAYLOAD_TOO_LARGE') }
    return this.transaction(() => {
      const current = this.database.prepare(`SELECT revision, byte_size FROM drafts WHERE ${this.draftWhere}`).get(...keys)
      const next = this.compareRevision(current, data.expectedRevision)
      const total = Number(this.database.prepare('SELECT coalesce(sum(byte_size), 0) AS bytes FROM drafts').get()?.bytes)
      if (total - Number(current?.byte_size ?? 0) + bytes > PERSONAL_LIMITS.drafts) { throw new PersonalDatabaseError('PAYLOAD_TOO_LARGE') }
      const now = this.now()
      if (!current) {
        this.database.prepare('INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)').run(...keys, next, data.baseRevision as string, json, bytes, now)
      } else {
        const result = this.database.prepare(`UPDATE drafts SET revision = ?, base_revision = ?, json = ?, byte_size = ?, updated_at = ? WHERE ${this.draftWhere} AND revision = ?`)
          .run(next, data.baseRevision as string, json, bytes, now, ...keys, data.expectedRevision as number)
        if (result.changes !== 1) { throw new PersonalDatabaseError('RECORD_CONFLICT') }
      }
      return { revision: next, json, updatedAt: now }
    })
  }
  private removeDraft(input: unknown): null {
    const data = object(input, ['scope', 'target', 'editSessionId', 'expectedRevision'])
    const { keys } = this.draftKey(data); revision(data.expectedRevision)
    return this.transaction(() => {
      const result = this.database.prepare(`DELETE FROM drafts WHERE ${this.draftWhere} AND revision = ?`).run(...keys, data.expectedRevision as number)
      if (result.changes !== 1) { throw new PersonalDatabaseError('RECORD_CONFLICT') }
      return null
    })
  }
  private summary(row: Row): SaveHistorySummary {
    return { id: String(row.id), apiId: String(row.api_id), savedAt: String(row.saved_at), presetName: String(row.preset_name), method: String(row.method), url: String(row.url) }
  }
  private pruneHistory(now: string): void {
    const rows = this.database.prepare('SELECT id, local_folder_id, workspace_id, api_id, saved_at, byte_size FROM api_save_history ORDER BY saved_at, id').all() as RetainedHistory[]
    const remove = this.database.prepare('DELETE FROM api_save_history WHERE id = ?')
    for (const id of historyIdsToPrune(rows, Date.parse(now), this.lastObserved)) { remove.run(id) }
    this.lastObserved = Math.max(this.lastObserved, Date.parse(now))
  }
  private recordHistory(input: unknown): SaveHistorySummary {
    const data = object(input, ['scope', 'apiId', 'operationId', 'json'])
    const scope = this.workspace(data.scope); uuid(data.apiId); uuid(data.operationId)
    const validated = validateHistory(data.json, data.apiId)
    const bytes = Buffer.byteLength(validated.json, 'utf8')
    if (bytes > PERSONAL_LIMITS.record) { throw new PersonalDatabaseError('PAYLOAD_TOO_LARGE') }
    return this.transaction(() => {
      const keys = [scope.localFolderId, scope.workspaceId, data.operationId as string, data.apiId as string]
      const existing = this.database.prepare('SELECT * FROM api_save_history WHERE local_folder_id = ? AND workspace_id = ? AND operation_id = ? AND api_id = ?').get(...keys)
      if (existing) {
        if (existing.json !== validated.json) { throw new PersonalDatabaseError('RECORD_CONFLICT') }
        return this.summary(existing)
      }
      const id = randomUUID()
      const now = this.now()
      this.database.prepare('INSERT INTO api_save_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
        .run(id, scope.localFolderId, scope.workspaceId, data.apiId as string, data.operationId as string, now, validated.presetId, validated.presetName, validated.method, validated.url, validated.json, bytes)
      this.pruneHistory(now)
      const row = this.database.prepare('SELECT * FROM api_save_history WHERE id = ?').get(id)
      if (!row) { throw new PersonalDatabaseError('DATABASE_WRITE_FAILED') }
      return this.summary(row)
    })
  }
  private history(input: unknown) {
    const data = object(input, ['scope', 'apiId', 'beforeId', 'limit'], ['scope', 'apiId'])
    const scope = this.workspace(data.scope); uuid(data.apiId)
    const limit = data.limit === undefined ? 20 : data.limit
    requireData(typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 100)
    const keys: SQLInputValue[] = [scope.localFolderId, scope.workspaceId, data.apiId]
    let cursor = ''
    if (data.beforeId !== undefined && data.beforeId !== null) {
      uuid(data.beforeId)
      const row = this.database.prepare('SELECT saved_at, id FROM api_save_history WHERE local_folder_id = ? AND workspace_id = ? AND api_id = ? AND id = ?').get(...keys, data.beforeId)
      if (!row) { throw new PersonalDatabaseError('NOT_FOUND') }
      cursor = ' AND (saved_at < ? OR (saved_at = ? AND id < ?))'
      keys.push(row.saved_at, row.saved_at, row.id)
    }
    const rows = this.database.prepare(`SELECT id, api_id, saved_at, preset_name, method, url FROM api_save_history
      WHERE local_folder_id = ? AND workspace_id = ? AND api_id = ?${cursor} ORDER BY saved_at DESC, id DESC LIMIT ?`).all(...keys, limit + 1)
    const items = rows.slice(0, limit).map(row => this.summary(row))
    return { items, nextBeforeId: rows.length > limit ? items.at(-1)!.id : null }
  }
  private historyEntry(input: unknown) {
    const data = object(input, ['scope', 'apiId', 'historyId'])
    const scope = this.workspace(data.scope); uuid(data.apiId); uuid(data.historyId)
    const row = this.database.prepare('SELECT * FROM api_save_history WHERE local_folder_id = ? AND workspace_id = ? AND api_id = ? AND id = ?')
      .get(scope.localFolderId, scope.workspaceId, data.apiId, data.historyId)
    if (!row) { throw new PersonalDatabaseError('NOT_FOUND') }
    try {
      const validated = validateHistory(row.json, data.apiId)
      requireData(validated.method === row.method && validated.url === row.url && validated.presetId === row.preset_id && validated.presetName === row.preset_name)
      return { summary: this.summary(row), json: validated.json }
    } catch (error) {
      if (error instanceof PersonalDatabaseError && error.code === 'DATABASE_VERSION_UNSUPPORTED') { throw error }
      throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
    }
  }
}
