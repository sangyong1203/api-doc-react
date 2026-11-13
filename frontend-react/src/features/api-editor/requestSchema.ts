import type { BodyField, FieldSpec, FieldType, RequestField, SampleRequest } from '@/features/workspace/types'

export const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'object', 'string array', 'number array', 'boolean array', 'object array', 'null']
export function hasChildFields(type: FieldType): boolean {
  return type === 'object' || type === 'array' || type === 'object array'
}

export function arrayPlaceholder(type: FieldType): string | undefined {
  if (type === 'string array') { return '예: ["A", "B"]' }
  if (type === 'number array') { return '예: [1, 2, 3]' }
  if (type === 'boolean array') { return '예: [true, false]' }
  return undefined
}

export const DEFAULT_SPEC: FieldSpec = { required: false, type: 'string', description: '' }

// 빈 문자열과 0·false를 구분하고 JSON 값의 타입을 명시적으로 검증합니다.
export function parseFieldValue(value: string, type: FieldType): unknown {
  if (type === 'file') { throw new Error('file은 Multipart Form에서만 사용할 수 있습니다.') }
  if (type === 'string') { return value }
  if (type === 'null') { return null }
  if (!value.trim() && type.endsWith(' array')) { return [] }
  if (!value.trim()) { throw new Error('값을 입력하세요.') }
  const parsed: unknown = JSON.parse(value)
  if (type === 'number' && (typeof parsed !== 'number' || !Number.isFinite(parsed))) { throw new Error('유효한 숫자를 입력하세요.') }
  if (type === 'boolean' && typeof parsed !== 'boolean') { throw new Error('true 또는 false를 입력하세요.') }
  if (type.endsWith(' array')) {
    const elementType = type.split(' ')[0]
    if (!Array.isArray(parsed) || !parsed.every((item: unknown) => elementType === 'object'
      ? item !== null && typeof item === 'object' && !Array.isArray(item)
      : typeof item === elementType)) { throw new Error(`${type} 형식의 배열을 입력하세요.`) }
  }
  return parsed
}

export function fieldValueError(value: string, spec: FieldSpec): string | null {
  if (spec.required && !value.trim()) { return '필수값을 입력하세요.' }
  if (!value.trim() && !spec.required) { return null }
  try { parseFieldValue(value, spec.type); return null } catch { return spec.type === 'boolean' ? 'true 또는 false를 입력하세요.' : spec.type === 'number' ? '유효한 숫자를 입력하세요.' : '값 형식을 확인하세요.' }
}

export const QUERY_FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'string array', 'number array', 'boolean array']

export function isQueryArray(type: FieldType): boolean {
  return type === 'string array' || type === 'number array' || type === 'boolean array'
}

export function queryFieldError(value: string, spec: FieldSpec): string | null {
  const error = fieldValueError(value, spec)
  if (error) { return error }
  if (spec.required && isQueryArray(spec.type)) {
    const items = parseFieldValue(value, spec.type) as unknown[]
    if (!items.length) { return '필수 배열에는 값을 하나 이상 입력하세요.' }
  }
  return null
}

// Query는 활성 행의 순서와 중복 키를 보존합니다. 빈 선택 배열은 생략하고 인코딩은 정확히 한 번 적용합니다.
export function serializeQuery(fields: RequestField[], specs: Record<string, FieldSpec> = {}) {
  const result: Array<Pick<RequestField, 'name' | 'value'>> = []
  const parts: string[] = []
  for (const field of fields) {
    if (!field.enabled) { continue }
    if (!field.name.trim()) { throw new Error('사용 중인 Query 행의 키를 입력하세요.') }
    const spec = specs[field.id] ?? DEFAULT_SPEC
    const error = queryFieldError(field.value, spec)
    if (error) { throw new Error(`${field.name}: ${error}`) }
    const key = encodeURIComponent(field.name)
    if (isQueryArray(spec.type)) {
      const items = (parseFieldValue(field.value, spec.type) as (string | number | boolean)[]).map(String)
      if (!items.length) { continue }
      if (spec.queryArrayFormat === 'comma') {
        result.push({ name: field.name, value: items.join(',') })
        parts.push(`${key}=${items.map(encodeURIComponent).join(',')}`)
      } else {
        for (const value of items) { result.push({ name: field.name, value }); parts.push(`${key}=${encodeURIComponent(value)}`) }
      }
    } else {
      result.push({ name: field.name, value: field.value })
      parts.push(`${key}=${encodeURIComponent(field.value)}`)
    }
  }
  return { fields: result, queryString: parts.join('&') }
}

// JSON 원문을 구조 편집용으로 변환합니다. 같은 경로의 명세 ID·설명·필수 설정은 유지합니다.
export function importBody(body: string, previous: BodyField[], rootType?: FieldType) {
  const parsed: unknown = JSON.parse(body.trim() || '{}')
  const fields: BodyField[] = []
  const values: Record<string, string> = {}
  function visit(value: unknown, parentId: string | null, name: string): void {
    const old = previous.find((item) => item.parentId === parentId && item.name === name)
    let type: FieldType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'
    if (Array.isArray(value)) {
      for (const candidate of ['string array', 'number array', 'boolean array', 'object array'] as const) {
        if (!value.length && old?.type !== candidate) { continue }
        try { parseFieldValue(JSON.stringify(value), candidate); type = candidate; break } catch { /* 다른 원소 타입을 확인합니다. */ }
      }
    }
    if (parentId === null && rootType) { type = rootType }
    const field: BodyField = { id: old?.id ?? crypto.randomUUID(), parentId, name, required: old?.required ?? false, description: old?.description ?? '', type }
    fields.push(field)
    if (type === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) { visit(child, field.id, key) }
    } else if (Array.isArray(value) && hasChildFields(type)) {
      value.forEach((child, index) => visit(child, field.id, String(index)))
    } else { values[field.id] = type === 'string' ? String(value) : JSON.stringify(value) }
  }
  visit(parsed, null, '$')
  return { fields, values }
}

// 배열은 자식 순서로, 객체는 같은 부모 안의 고유 키로 조립합니다. 잘못된 입력은 원문을 덮어쓰지 않습니다.
export function serializeBody(fields: BodyField[], values: Record<string, string>): string {
  if (!fields.length) { return '' }
  // 선택 숫자·불리언의 빈 입력은 값 미설정으로 취급합니다. 0·false는 실제 값으로 보존합니다.
  function omitted(field: BodyField): boolean {
    return !field.required && (field.type === 'number' || field.type === 'boolean') && !(values[field.id] ?? '').trim()
  }
  function build(field: BodyField): unknown {
    const children = fields.filter((item) => item.parentId === field.id)
    if (field.type === 'object') {
      const keys = new Set<string>()
      const entries: [string, unknown][] = []
      for (const child of children) {
        if (!child.name.trim() || keys.has(child.name)) { throw new Error('같은 객체 안의 키는 비어 있거나 중복될 수 없습니다.') }
        keys.add(child.name)
        if (!omitted(child)) { entries.push([child.name, build(child)]) }
      }
      return Object.fromEntries(entries)
    }
    if (field.type === 'array' || field.type === 'object array') {
      if (field.type === 'object array' && children.some((child) => child.type !== 'object')) { throw new Error(`${field.name}: 객체 항목만 추가할 수 있습니다.`) }
      return children.filter((child) => !omitted(child)).map(build)
    }
    const value = values[field.id] ?? ''
    if (field.required && !value.trim() && field.type !== 'null') { throw new Error(`${field.name}: 필수값을 입력하세요.`) }
    try { return parseFieldValue(value, field.type) } catch { throw new Error(`${field.name}: ${field.type} 형식의 값을 입력하세요.`) }
  }
  return omitted(fields[0]) ? '' : JSON.stringify(build(fields[0]), null, 2)
}

// 객체 배열은 항목 객체의 필드를 추가합니다. 내부 객체 노드는 JSON 보존용이며 UI에는 노출하지 않습니다.
export function addBodyField(fields: BodyField[], values: Record<string, string>, parent: BodyField) {
  if (!hasChildFields(parent.type)) { return { fields, values } }
  const next = [...fields]
  const nextValues = { ...values }
  let targets = [parent]
  if (parent.type === 'object array') {
    targets = fields.filter((field) => field.parentId === parent.id && field.type === 'object')
    if (!targets.length) {
      const item: BodyField = { id: crypto.randomUUID(), parentId: parent.id, name: '0', type: 'object', required: false, description: '' }
      next.push(item)
      targets = [item]
    }
  }
  const siblings = fields.filter((field) => targets.some((target) => target.id === field.parentId))
  let suffix = 1
  while (siblings.some((field) => field.name === `field${suffix}`)) { suffix += 1 }
  for (const target of targets) {
    const id = crypto.randomUUID()
    next.push({ id, parentId: target.id, name: `field${suffix}`, type: 'string', required: false, description: '' })
    nextValues[id] = ''
  }
  return { fields: next, values: nextValues }
}

// 타입 변경 시 기존 구조를 값으로 옮기거나 값에서 구조를 복원합니다. 변환 불가는 원본을 유지합니다.
export function changeBodyFieldType(fields: BodyField[], values: Record<string, string>, field: BodyField, type: FieldType) {
  const ids = [field.id]
  for (let index = 0; index < ids.length; index += 1) { ids.push(...fields.filter((item) => item.parentId === ids[index]).map((item) => item.id)) }
  const subtree = [field, ...fields.filter((item) => item.id !== field.id && ids.includes(item.id))]
  const text = hasChildFields(field.type) ? serializeBody(subtree, values) : values[field.id] ?? ''
  if (hasChildFields(type)) {
    let data: unknown
    try { data = JSON.parse(text || (type === 'object' ? '{}' : '[]')) } catch { throw new Error('현재 값을 JSON 객체 또는 배열로 수정한 뒤 타입을 변경하세요.') }
    if (type === 'object' ? data === null || typeof data !== 'object' || Array.isArray(data) : !Array.isArray(data)) { throw new Error('현재 값과 변경할 구조 타입이 다릅니다. 값을 먼저 수정하세요.') }
    if (type === 'object array') { parseFieldValue(JSON.stringify(data), type) }
    const previous = [{ ...field, parentId: null, name: '$' }, ...subtree.slice(1)]
    const imported = importBody(JSON.stringify(data), previous, type)
    imported.fields[0] = { ...field, type }
    const remainingValues = Object.fromEntries(Object.entries(values).filter(([id]) => !ids.includes(id)))
    return { fields: fields.flatMap((item) => item.id === field.id ? imported.fields : ids.includes(item.id) ? [] : [item]), values: { ...remainingValues, ...imported.values } }
  }
  return { fields: fields.filter((item) => item.id === field.id || !ids.includes(item.id)).map((item) => item.id === field.id ? { ...item, type } : item), values: { ...values, [field.id]: text } }
}

export function validateMultipart(request: SampleRequest): string | null {
  for (const field of request.multipartFields ?? []) {
    if (!field.enabled) { continue }
    const spec = request.schema?.fields[field.id] ?? DEFAULT_SPEC
    if (!field.name.trim()) { return 'Multipart Form의 사용 중인 행에 키를 입력하세요.' }
    if (spec.type === 'file') {
      if (spec.required && !request.multipartFiles?.[field.id]) { return `${field.name}: 파일을 선택하세요.` }
    } else {
      const error = fieldValueError(field.value, spec)
      if (error) { return `${field.name}: ${error}` }
    }
  }
  return null
}

// 실제 전송 연결 전에도 FormData 구성 규칙을 검증할 수 있도록 구성과 호출을 분리합니다.
// 같은 이름의 여러 행은 append로 보존하며 Content-Type·boundary는 여기서 지정하지 않습니다.
export function createMultipartForm(request: SampleRequest): FormData {
  const error = validateMultipart(request)
  if (error) { throw new Error(error) }
  const form = new FormData()
  for (const field of request.multipartFields ?? []) {
    if (!field.enabled) { continue }
    const spec = request.schema?.fields[field.id] ?? DEFAULT_SPEC
    if (spec.type === 'file') {
      const selected = request.multipartFiles?.[field.id]
      if (selected) { form.append(field.name, selected.file) }
    } else { form.append(field.name, field.value) }
  }
  return form
}

// 샘플 실행에는 파일 본문 대신 메타데이터 복사본만 표시합니다.
export function describeMultipart(request: SampleRequest): string {
  return JSON.stringify((request.multipartFields ?? []).filter((field) => field.enabled).map((field) => {
    const type = request.schema?.fields[field.id]?.type ?? 'string'
    const selected = request.multipartFiles?.[field.id]?.file
    return type === 'file' ? { key: field.name, type, file: selected ? { name: selected.name, size: selected.size, contentType: selected.type } : null }
      : { key: field.name, type, value: field.value }
  }), null, 2)
}

// 초기 편집 보기만 설정합니다. JSON 오류가 있으면 원문 보기와 입력을 보존합니다.
export function withDefaultBodyView(request: SampleRequest): SampleRequest {
  if (request.bodyView) { return request }
  try {
    const imported = importBody(request.body, request.schema?.body ?? [])
    return { ...request, bodyView: 'fields', bodyValues: imported.values, schema: { fields: request.schema?.fields ?? {}, body: imported.fields } }
  } catch { return { ...request, bodyView: 'json' } }
}

export function getRequestBody(request: SampleRequest): string {
  if (request.bodyFormat === 'multipart') { return describeMultipart(request) }
  return request.bodyView === 'fields' ? serializeBody(request.schema?.body ?? [], request.bodyValues ?? {}) : request.body
}

// 객체의 키는 부모별로 검증합니다. 배열 항목의 이름은 직렬화 시 인덱스로 처리합니다.
export function validateStructure(fields: BodyField[]): string | null {
  const keys = new Map<string, Set<string>>()
  for (const field of fields) {
    if (field.parentId === null) { continue }
    const parent = fields.find((item) => item.id === field.parentId)
    if (parent?.type !== 'object') { continue }
    const siblings = keys.get(field.parentId) ?? new Set<string>()
    if (!field.name.trim() || siblings.has(field.name)) { return '같은 객체 안의 키는 비어 있거나 중복될 수 없습니다.' }
    siblings.add(field.name)
    keys.set(field.parentId, siblings)
  }
  return null
}

export function validateRequest(request: SampleRequest): string | null {
  const responseError = validateStructure(request.responseFields ?? [])
  if (responseError) { return `응답 명세: ${responseError}` }
  for (const key of ['pathParams', 'queryParams', 'headers'] as const) {
    for (const field of request[key]) {
      const spec = request.schema?.fields[field.id] ?? DEFAULT_SPEC
      if (key === 'pathParams' && (!field.enabled || !field.value.trim())) { return 'Path params의 이름과 필수값을 확인하세요.' }
      if (!field.enabled) { continue }
      if (!field.name.trim()) { return '사용 중인 행의 키를 입력하세요.' }
      const error = key === 'queryParams' ? queryFieldError(field.value, spec) : fieldValueError(field.value, spec)
      if (error) { return `${field.name}: ${error}` }
    }
  }
  if (request.bodyFormat === 'multipart') { return validateMultipart(request) }
  try {
    const body = getRequestBody(request)
    if (body.trim()) { JSON.parse(body) }
  } catch (error) { return error instanceof Error ? error.message : 'JSON 본문을 확인하세요.' }
  return null
}
