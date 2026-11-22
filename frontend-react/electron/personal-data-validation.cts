import { PersonalDatabaseError } from './personal-database-contract.cjs'

export type JsonObject = Record<string, unknown>
export type Field = { id: string; name: string; type: string; required: boolean; description: string; parentId?: string | null; arrayFormat?: string }
export type RequestSpec = { path: Field[]; query: Field[]; headers: Field[]; body: { format: string; json: Field[]; multipart: Field[] } }
export type CommonSpec = { method: string; url: string; request: RequestSpec; response: JsonObject; documentation: JsonObject }
export const PERSONAL_LIMITS = { preferences: 256 * 1024, record: 8 * 1024 * 1024, drafts: 128 * 1024 * 1024, history: 512 * 1024 * 1024 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SCALARS = ['string', 'number', 'boolean']
const BODY_TYPES = [...SCALARS, 'object', 'array', 'string array', 'number array', 'boolean array', 'object array', 'null']
const CONTAINERS = new Set(['object', 'array', 'object array'])

export function requireData(condition: unknown): asserts condition {
  if (!condition) { throw new PersonalDatabaseError('INVALID_REQUEST') }
}
/** 허용 키와 필수 키를 모두 검사하며 값의 자동 추가·삭제·형 변환을 하지 않습니다. */
export function object(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): JsonObject {
  requireData(value !== null && typeof value === 'object' && !Array.isArray(value))
  requireData(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  const record = value as JsonObject
  requireData(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)))
  return record
}
function map(value: unknown): JsonObject {
  requireData(value !== null && typeof value === 'object' && !Array.isArray(value))
  return object(value, Object.keys(value))
}
export function text(value: unknown): asserts value is string { requireData(typeof value === 'string') }
export function uuid(value: unknown): asserts value is string { requireData(typeof value === 'string' && UUID.test(value)) }
export function revision(value: unknown, nullable = false): asserts value is number | null {
  requireData((nullable && value === null) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))
}
export function contentHash(value: unknown): asserts value is string { requireData(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)) }
function choice(value: unknown, choices: string[]): asserts value is string { requireData(typeof value === 'string' && choices.includes(value)) }
function array(value: unknown): unknown[] { requireData(Array.isArray(value)); return value }

/** UTF-8 바이트 상한을 파싱 전에 확인합니다. 오류에 원문이나 파서 메시지를 전달하지 않습니다. */
export function parsePayload(json: unknown, maxBytes: number): JsonObject {
  text(json)
  if (Buffer.byteLength(json, 'utf8') > maxBytes) { throw new PersonalDatabaseError('PAYLOAD_TOO_LARGE') }
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { throw new PersonalDatabaseError('INVALID_REQUEST') }
  const result = map(parsed)
  if (typeof result.payloadVersion === 'number' && result.payloadVersion > 1) { throw new PersonalDatabaseError('DATABASE_VERSION_UNSUPPORTED') }
  requireData(result.payloadVersion === 1)
  return result
}
/** 검증한 JSON 객체만 정렬해 저장합니다. 키 순서만 다른 operation 재전송도 같은 내용으로 비교합니다. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    }
    return item
  })
}

function boundedJson(value: unknown, maxBytes: number): string {
  const json = canonicalJson(value)
  if (Buffer.byteLength(json, 'utf8') > maxBytes) { throw new PersonalDatabaseError('PAYLOAD_TOO_LARGE') }
  return json
}

export function validatePreferences(json: unknown, kind: 'app' | 'workspace'): string {
  const data = parsePayload(json, PERSONAL_LIMITS.preferences)
  if (kind === 'app') {
    object(data, ['payloadVersion', 'theme', 'lastWorkspace'], ['payloadVersion'])
    if (Object.hasOwn(data, 'theme')) { choice(data.theme, ['system', 'light', 'dark']) }
    if (Object.hasOwn(data, 'lastWorkspace') && data.lastWorkspace !== null) {
      const scope = object(data.lastWorkspace, ['localFolderId', 'workspaceId'])
      uuid(scope.localFolderId); uuid(scope.workspaceId)
    }
  } else {
    object(data, ['payloadVersion', 'selectedEnvironmentId', 'openTabs', 'activeApiId', 'editorViews'], ['payloadVersion'])
    for (const key of ['selectedEnvironmentId', 'activeApiId']) {
      if (Object.hasOwn(data, key) && data[key] !== null) { uuid(data[key]) }
    }
    for (const key of ['openTabs', 'editorViews']) {
      if (!Object.hasOwn(data, key)) { continue }
      const items = array(data[key])
      requireData(items.length <= 200)
      const ids = new Set()
      for (const item of items) {
        const entry = object(item, key === 'openTabs' ? ['apiId', 'selectedPresetId'] : ['apiId', 'bodyView'])
        uuid(entry.apiId)
        requireData(!ids.has(entry.apiId)); ids.add(entry.apiId)
        if (key === 'openTabs') { if (entry.selectedPresetId !== null) { uuid(entry.selectedPresetId) } }
        else { choice(entry.bodyView, ['fields', 'json']) }
      }
    }
  }
  return boundedJson(data, PERSONAL_LIMITS.preferences)
}

/**
 * ids는 같은 API의 요청·응답 전체에서 공유하는 ID 집합입니다.
 * strict=true인 저장 이력은 확정 명세를 요구하며, 초안은 빈 이름·중복 편집 키를 보존합니다.
 * 두 경우 모두 ID 중복·부모 누락·순환·스칼라 자식은 거부합니다.
 */
function fields(value: unknown, kind: 'path' | 'query' | 'headers' | 'body' | 'multipart', ids: Set<string>, strict: boolean): Field[] {
  const result = array(value).map(item => {
    const keys = kind === 'body' ? ['id', 'name', 'type', 'required', 'description', 'parentId']
      : kind === 'query' ? ['id', 'name', 'type', 'required', 'description', 'arrayFormat']
        : ['id', 'name', 'type', 'required', 'description']
    const field = object(item, keys)
    uuid(field.id); text(field.name); text(field.description)
    requireData(!ids.has(field.id)); ids.add(field.id)
    if (strict) { requireData(field.name.trim().length > 0) }
    requireData(typeof field.required === 'boolean' && (kind !== 'path' || field.required === true))
    choice(field.type, kind === 'body' ? BODY_TYPES : kind === 'query' ? [...SCALARS, 'string array', 'number array', 'boolean array'] : kind === 'multipart' ? [...SCALARS, 'file'] : SCALARS)
    if (kind === 'query') { choice(field.arrayFormat, ['repeat', 'comma']) }
    if (kind === 'body' && field.parentId !== null) { uuid(field.parentId) }
    return field as unknown as Field
  })
  if (kind !== 'body' || result.length === 0) { return result }
  const byId = new Map(result.map(field => [field.id, field]))
  const roots = result.filter(field => field.parentId === null)
  requireData(roots.length === 1 && result[0].parentId === null)
  if (strict) { requireData(roots[0].name === '$') }
  const siblings = new Map<string, Set<string>>()
  const resolved = new Set(roots.map(field => field.id))
  for (const field of result) {
    if (field.parentId === null) { continue }
    const parent = byId.get(field.parentId!)
    requireData(parent && CONTAINERS.has(parent.type) && (parent.type !== 'object array' || field.type === 'object'))
    if (strict && parent.type === 'object') {
      const names = siblings.get(parent.id) ?? new Set<string>()
      requireData(!names.has(field.name)); names.add(field.name); siblings.set(parent.id, names)
    }
    const visited = new Set<string>()
    let current: Field | undefined = field
    while (current && !resolved.has(current.id)) {
      requireData(!visited.has(current.id)); visited.add(current.id)
      current = current.parentId === null ? undefined : byId.get(current.parentId!)
    }
    for (const id of visited) { resolved.add(id) }
  }
  return result
}

function common(value: unknown, strict: boolean, ids = new Set<string>()): CommonSpec {
  const data = object(value, ['method', 'url', 'request', 'response', 'documentation'])
  choice(data.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']); text(data.url)
  if (strict) { requireData(data.url.trim().length > 0) }
  const request = object(data.request, ['path', 'query', 'headers', 'body'])
  const body = object(request.body, ['format', 'json', 'multipart'])
  choice(body.format, ['json', 'multipart'])
  const requestSpec: RequestSpec = {
    path: fields(request.path, 'path', ids, strict), query: fields(request.query, 'query', ids, strict), headers: fields(request.headers, 'headers', ids, strict),
    body: { format: body.format, json: fields(body.json, 'body', ids, strict), multipart: fields(body.multipart, 'multipart', ids, strict) },
  }
  const response = object(data.response, ['success', 'errors'])
  fields(response.success, 'body', ids, strict)
  for (const item of array(response.errors)) {
    const example = object(item, ['id', 'name', 'status', 'description', 'fields'])
    uuid(example.id); requireData(!ids.has(example.id)); ids.add(example.id)
    text(example.name); text(example.status); text(example.description); requireData(example.status.length <= 3)
    for (const row of array(example.fields)) {
      const field = object(row, ['id', 'name', 'enabled', 'value'])
      uuid(field.id); text(field.name); text(field.value); requireData(typeof field.enabled === 'boolean' && !ids.has(field.id)); ids.add(field.id)
      if (strict) { requireData(field.name.trim().length > 0) }
    }
  }
  const documentation = object(data.documentation, ['description', 'requestExample', 'responseExample'])
  for (const value of Object.values(documentation)) { text(value) }
  return { method: data.method, url: data.url, request: requestSpec, response, documentation }
}

function literal(value: unknown, field: Field, strict: boolean, query: boolean): void {
  if (typeof value !== 'string') { const reference = object(value, ['secretRef']); uuid(reference.secretRef); return }
  if (!strict || /\{\{[^{}]+\}\}/.test(value) || field.type === 'null') { return }
  if (field.required) { requireData(value.trim().length > 0) }
  if (field.type === 'string' || (!field.required && !value.trim())) { return }
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new PersonalDatabaseError('INVALID_REQUEST') }
  if (field.type.endsWith(' array')) {
    const type = field.type.split(' ')[0]
    requireData(Array.isArray(parsed) && parsed.every(item => typeof item === type && (type !== 'number' || Number.isFinite(item))))
    if (query && field.required) { requireData(parsed.length > 0) }
  } else { requireData(typeof parsed === field.type && (field.type !== 'number' || Number.isFinite(parsed))) }
}

/** 값 맵은 이전 snapshot에서도 단독 조회할 수 있습니다. 저장 시 현재 request로 참조와 파일 행을 검사합니다. */
function values(value: unknown, request: RequestSpec | undefined, strict: boolean): void {
  const data = object(value, ['path', 'query', 'headers', 'body', 'multipart'])
  for (const key of ['path', 'query', 'headers', 'multipart'] as const) {
    const cells = map(data[key])
    const specs = request ? new Map((key === 'multipart' ? request.body.multipart : request[key]).map(field => [field.id, field])) : undefined
    for (const [id, value] of Object.entries(cells)) {
      uuid(id)
      const field = specs?.get(id)
      if (specs) { requireData(field) }
      const cell = map(value)
      object(cell, ['enabled', 'value', 'secretRef'], ['enabled'])
      requireData(typeof cell.enabled === 'boolean')
      if (key === 'multipart' && (field?.type === 'file' || (!field && Object.keys(cell).length === 1))) { requireData(Object.keys(cell).length === 1); continue }
      requireData(Object.hasOwn(cell, 'value') !== Object.hasOwn(cell, 'secretRef'))
      if (Object.hasOwn(cell, 'value')) { text(cell.value) } else { uuid(cell.secretRef) }
      if (strict && key === 'path') { requireData(cell.enabled) }
      if (field) { literal(Object.hasOwn(cell, 'secretRef') ? { secretRef: cell.secretRef } : cell.value, field, strict && cell.enabled && (key !== 'multipart' || request?.body.format === 'multipart'), key === 'query') }
    }
    if (specs && strict) {
      for (const field of specs.values()) {
        if (Object.hasOwn(cells, field.id) || field.type === 'file') { continue }
        literal('', field, (key !== 'multipart' || request?.body.format === 'multipart'), key === 'query')
      }
    }
  }
  const body = object(data.body, ['fields', 'enabled'])
  const enabled = map(body.enabled)
  const bodyFields = request ? new Map(request.body.json.map(field => [field.id, field])) : undefined
  for (const [id, value] of Object.entries(enabled)) { uuid(id); requireData(typeof value === 'boolean' && (!bodyFields || bodyFields.has(id))) }
  const literals = map(body.fields)
  for (const [id, value] of Object.entries(literals)) {
    uuid(id)
    const field = bodyFields?.get(id)
    if (bodyFields) { requireData(field && !CONTAINERS.has(field.type)) }
    if (typeof value !== 'string') { const ref = object(value, ['secretRef']); uuid(ref.secretRef) }
  }
  if (bodyFields) {
    const activeFields = new Map<string, boolean>()
    for (const field of bodyFields.values()) {
      if (CONTAINERS.has(field.type)) { continue }
      let current: Field | undefined = field
      let active = true
      const visited: string[] = []
      while (current) {
        if (activeFields.has(current.id)) { active = activeFields.get(current.id)!; break }
        visited.push(current.id)
        if (enabled[current.id] === false) { active = false; break }
        current = current.parentId === null ? undefined : bodyFields.get(current.parentId!)
      }
      for (const id of visited) { activeFields.set(id, active) }
      literal(literals[field.id] ?? '', field, strict && active && request?.body.format === 'json', false)
    }
  }
}

export function validateDraft(json: unknown, kind: 'api' | 'preset', commonJson?: unknown, reservedIds: string[] = []): string {
  const data = parsePayload(json, PERSONAL_LIMITS.record)
  if (kind === 'api') {
    object(data, ['payloadVersion', 'common'])
    common(data.common, false, new Set(reservedIds))
  } else {
    object(data, ['payloadVersion', 'values', 'rawBodyText', 'bodyView'])
    requireData(data.rawBodyText === null || typeof data.rawBodyText === 'string')
    choice(data.bodyView, ['fields', 'json'])
    const source = commonJson === undefined ? undefined : parsePayload(commonJson, PERSONAL_LIMITS.record)
    if (source) { object(source, ['payloadVersion', 'common']) }
    values(data.values, source ? common(source.common, false, new Set(reservedIds)).request : undefined, false)
  }
  return boundedJson(data, PERSONAL_LIMITS.record)
}

export function validateHistory(json: unknown, apiId: string): { json: string; method: string; url: string; presetId: string; presetName: string } {
  const data = parsePayload(json, PERSONAL_LIMITS.record)
  object(data, ['payloadVersion', 'common', 'selectedPreset'])
  const selected = object(data.selectedPreset, ['id', 'name', 'values'])
  uuid(selected.id); text(selected.name); requireData(selected.name.trim().length > 0 && selected.id !== apiId)
  const spec = common(data.common, true, new Set([apiId, selected.id]))
  values(selected.values, spec.request, true)
  return { json: boundedJson(data, PERSONAL_LIMITS.record), method: spec.method, url: spec.url, presetId: selected.id, presetName: selected.name }
}
