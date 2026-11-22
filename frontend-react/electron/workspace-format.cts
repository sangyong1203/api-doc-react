import type { DesktopErrorCode, SharedApi, SharedValues, WorkspaceSnapshot } from '../src/types/desktopData.js'
import { object, requireData, text, uuid, validateHistory } from './personal-data-validation.cjs'

export const WORKSPACE_LIMITS = { fileBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, files: 1000 }
export const WORKSPACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function isWorkspaceTemporary(name: string): boolean {
  const match = /^\.apidoc-write-([0-9a-f-]+)-(workspace|api|environment)-([0-9a-f-]+)\.tmp$/.exec(name)
  return Boolean(match && WORKSPACE_UUID.test(match[1]) && WORKSPACE_UUID.test(match[3]))
}
const messages: Partial<Record<DesktopErrorCode, string>> = {
  INVALID_REQUEST: '작업 폴더 요청을 확인해 주세요.', ACCESS_DENIED: '이 화면에서는 작업 폴더에 접근할 수 없습니다.',
  WORKSPACE_NOT_OPEN: '작업 폴더를 다시 열어 주세요.', WORKSPACE_NOT_FOUND: '작업 폴더를 찾을 수 없습니다.',
  WORKSPACE_ALREADY_EXISTS: '작업 공간 파일 또는 관리 폴더가 이미 있습니다. 기존 폴더 열기를 사용해 주세요.',
  DOCUMENT_INVALID: '작업 공간 파일의 형식·ID·참조 관계를 확인해 주세요.', FORMAT_UNSUPPORTED: '지원하지 않는 작업 공간 포맷입니다.',
  PATH_NOT_ALLOWED: '작업 폴더 내부의 링크 또는 경로 변경으로 접근할 수 없습니다.', FILE_CONFLICT: '작업 폴더가 기준 내용과 다릅니다. 편집을 유지한 채 파일 상태를 확인해 주세요.',
  FILE_READ_FAILED: '작업 폴더를 읽을 수 없습니다. 권한과 파일 상태를 확인해 주세요.',
  FILE_WRITE_FAILED: '파일 쓰기를 완료하지 못했습니다. 자동 반복하지 말고 작업 상태를 확인해 주세요.',
  WORKSPACE_RECOVERY_REQUIRED: '미완료 파일 작업을 확인해야 합니다. 새 저장 전에 복구 상태를 확인해 주세요.',
  OPERATION_ID_REUSED: '같은 저장 작업 ID에 다른 내용을 사용할 수 없습니다.',
  PAYLOAD_TOO_LARGE: '작업 공간의 파일 크기 또는 개수 한도를 초과했습니다.', BUSY: '폴더 선택을 진행 중입니다.',
  DATABASE_UNAVAILABLE: '개인 저장소를 사용할 수 없어 폴더를 연결하지 못했습니다.', INTERNAL_ERROR: '작업 폴더 처리를 완료하지 못했습니다.',
}
export class WorkspaceError extends Error {
  constructor(public readonly code: DesktopErrorCode) { super(messages[code] ?? messages.INTERNAL_ERROR); this.name = 'WorkspaceError' }
}

function list(value: unknown): unknown[] { requireData(Array.isArray(value)); return value }
function name(value: unknown): asserts value is string { text(value); requireData(value.trim().length > 0) }
function uniqueNames(items: Array<{ name: string }>): void {
  const names = items.map(item => item.name.trim().toLowerCase())
  requireData(new Set(names).size === names.length)
}
function ids(value: unknown): string[] {
  const result = list(value)
  for (const id of result) { uuid(id) }
  requireData(new Set(result).size === result.length)
  return result as string[]
}

/** 공유 JSON Schema v1과 같은 경계 검사. API 명세·트리·모든 세트 값은 기존 공통 검증기를 재사용합니다. */
export function validateWorkspaceBundle(files: Record<string, string>): { id: string; name: string } {
  try {
    requireData(Object.hasOwn(files, 'workspace.json') && Object.keys(files).length <= WORKSPACE_LIMITS.files)
    const documents = new Map<string, Record<string, unknown>>()
    let total = 0
    for (const [relative, json] of Object.entries(files)) {
      text(json)
      const bytes = Buffer.byteLength(json)
      total += bytes
      if (bytes > WORKSPACE_LIMITS.fileBytes || total > WORKSPACE_LIMITS.totalBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
      const parsed: unknown = JSON.parse(json)
      requireData(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      const data = parsed as Record<string, unknown>
      if (data.formatVersion !== 1) { throw new WorkspaceError('FORMAT_UNSUPPORTED') }
      uuid(data.id); name(data.name)
      if (relative !== 'workspace.json') {
        const match = /^(apis|environments)\/([^/]+)\.json$/.exec(relative)
        requireData(match && WORKSPACE_UUID.test(match[2]) && match[2] === data.id)
      }
      documents.set(relative, data)
    }
    const workspace = object(documents.get('workspace.json'), ['formatVersion', 'id', 'name', 'collections', 'environmentIds'])
    const registered = new Set<string>()
    const register = (value: unknown) => { uuid(value); requireData(!registered.has(value)); registered.add(value) }
    register(workspace.id)
    const apis = new Map<string, Record<string, unknown>>()
    const environments = new Map<string, Record<string, unknown>>()
    for (const [file, data] of documents) {
      if (file === 'workspace.json') { continue }
      register(data.id)
      if (file.startsWith('apis/')) {
        object(data, ['formatVersion', 'id', 'name', 'method', 'url', 'request', 'response', 'documentation', 'defaultPresetId', 'presets'])
        uuid(data.defaultPresetId)
        const presets = list(data.presets)
        requireData(presets.length > 0)
        const presetIds = new Set<string>()
        const presetNames: Array<{ name: string }> = []
        for (const value of presets) {
          const preset = object(value, ['id', 'name', 'description', 'values'])
          uuid(preset.id); name(preset.name); text(preset.description)
          requireData(!presetIds.has(preset.id)); presetIds.add(preset.id); presetNames.push({ name: preset.name })
          validateHistory(JSON.stringify({ payloadVersion: 1, common: { method: data.method, url: data.url, request: data.request, response: data.response, documentation: data.documentation }, selectedPreset: { id: preset.id, name: preset.name, values: preset.values } }), String(data.id))
        }
        uniqueNames(presetNames)
        requireData(presetIds.has(data.defaultPresetId))
        apis.set(String(data.id), data)
      } else {
        object(data, ['formatVersion', 'id', 'name', 'variables'])
        const variableIds = new Set<string>(), keys = new Set<string>()
        for (const value of list(data.variables)) {
          const variable = object(value, ['id', 'name', 'enabled', 'value', 'secretRef'], ['id', 'name', 'enabled'])
          uuid(variable.id); name(variable.name)
          requireData(typeof variable.enabled === 'boolean' && !variableIds.has(variable.id) && !keys.has(variable.name))
          variableIds.add(variable.id); keys.add(variable.name)
          requireData(Object.hasOwn(variable, 'value') !== Object.hasOwn(variable, 'secretRef'))
          if (Object.hasOwn(variable, 'value')) { text(variable.value) } else { uuid(variable.secretRef) }
        }
        environments.set(String(data.id), data)
      }
    }
    const located = new Set<string>()
    const location = (value: unknown) => {
      const entries: Array<{ name: string }> = []
      for (const id of ids(value)) {
        requireData(!located.has(id) && apis.has(id)); located.add(id)
        entries.push({ name: String(apis.get(id)!.name) })
      }
      uniqueNames(entries)
    }
    const collections: Array<{ name: string }> = []
    for (const value of list(workspace.collections)) {
      const collection = object(value, ['id', 'name', 'apiIds', 'folders'])
      register(collection.id); name(collection.name); collections.push({ name: collection.name })
      location(collection.apiIds)
      const folders: Array<{ name: string }> = []
      for (const value of list(collection.folders)) {
        const folder = object(value, ['id', 'name', 'apiIds'])
        register(folder.id); name(folder.name); folders.push({ name: folder.name }); location(folder.apiIds)
      }
      uniqueNames(folders)
    }
    uniqueNames(collections)
    requireData(located.size === apis.size)
    const environmentIds = ids(workspace.environmentIds)
    requireData(environmentIds.length === environments.size && environmentIds.every(id => environments.has(id)))
    uniqueNames([...environments.values()].map(value => ({ name: String(value.name) })))
    return { id: String(workspace.id), name: String(workspace.name) }
  } catch (error) {
    if (error instanceof WorkspaceError) { throw error }
    throw new WorkspaceError('DOCUMENT_INVALID')
  }
}

/** UI가 수정할 수 있는 기존 API 한 개만 검증합니다. 다른 세트는 삭제된 필드 정리 외에는 보존합니다. */
export function validateApiEdit(snapshot: WorkspaceSnapshot, json: string, apiId: string, selectedPresetId: string): SharedApi {
  const original = snapshot.apis.find(document => document.id === apiId)
  if (!original) { throw new WorkspaceError('DOCUMENT_INVALID') }
  const before = JSON.parse(original.json) as SharedApi
  let after: SharedApi
  try { after = JSON.parse(json) as SharedApi } catch { throw new WorkspaceError('DOCUMENT_INVALID') }
  const files = Object.fromEntries([snapshot.workspace, ...snapshot.apis, ...snapshot.environments].map(document => [document.kind === 'workspace' ? 'workspace.json' : `${document.kind === 'api' ? 'apis' : 'environments'}/${document.id}.json`, document.id === apiId ? json : document.json]))
  validateWorkspaceBundle(files)
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([key, item]) => [key, normalized(item)])) : value
  const same = (a: unknown, b: unknown) => equal(normalized(a), normalized(b))
  if (after.id !== before.id || after.name !== before.name || after.defaultPresetId !== before.defaultPresetId
    || !same(after.presets.map(({ id, name, description }) => ({ id, name, description })), before.presets.map(({ id, name, description }) => ({ id, name, description })))
    || !before.presets.some(preset => preset.id === selectedPresetId)) { throw new WorkspaceError('INVALID_REQUEST') }
  const pick = <T,>(map: Record<string, T>, ids: string[]) => Object.fromEntries(Object.entries(map).filter(([id]) => ids.includes(id)))
  const prune = (values: SharedValues): SharedValues => ({ path: pick(values.path, after.request.path.map(field => field.id)), query: pick(values.query, after.request.query.map(field => field.id)), headers: pick(values.headers, after.request.headers.map(field => field.id)),
    body: { fields: pick(values.body.fields, after.request.body.json.map(field => field.id)), enabled: pick(values.body.enabled, after.request.body.json.map(field => field.id)) }, multipart: pick(values.multipart, after.request.body.multipart.map(field => field.id)) })
  const cells = (values: SharedValues) => Object.entries({ ...values.path, ...values.query, ...values.headers, ...values.body.fields, ...values.multipart })
  for (const preset of after.presets) {
    const old = before.presets.find(old => old.id === preset.id)!
    if (preset.id !== selectedPresetId && !same(preset.values, prune(old.values))) { throw new WorkspaceError('INVALID_REQUEST') }
    const originals = new Map(cells(old.values))
    for (const [id, value] of cells(preset.values)) {
      const previous = originals.get(id)
      const oldRef = previous && typeof previous === 'object' ? previous.secretRef : undefined
      const newRef = typeof value === 'object' ? value.secretRef : undefined
      if (oldRef !== newRef) { throw new WorkspaceError('INVALID_REQUEST') }
    }
  }
  return after
}
