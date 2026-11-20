import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// 검증용 도구입니다. 기존 lockfile로 설치된 Ajv를 사용하며 앱 런타임에는 연결하지 않습니다.
const require = createRequire(new URL('../frontend-react/package.json', import.meta.url))
const Ajv = require('ajv')
const schema = JSON.parse(readFileSync(new URL('./storage-v1.schema.json', import.meta.url), 'utf8'))
const ajv = new Ajv({ allErrors: true, jsonPointers: true, strictKeywords: true })
assert.equal(ajv.validateSchema(schema), true, '유효한 Draft-07 스키마여야 함')
ajv.addSchema(schema)
const validators = Object.fromEntries(['workspace', 'api', 'environment'].map((kind) => [kind, ajv.getSchema(`${schema.$id}#/definitions/${kind}`)]))
const uuid = schema.definitions.uuid.pattern.slice(1, -1)
const apiPath = new RegExp(`^apis/(${uuid})\\.json$`)
const environmentPath = new RegExp(`^environments/(${uuid})\\.json$`)
const containers = new Set(['object', 'array', 'object array'])
const normalizedName = (name) => name.trim().toLowerCase()

/** files는 상대 파일명을 키로, 파싱된 JSON을 값으로 갖는 검증용 묶음입니다. 파일을 쓰거나 수정하지 않습니다. */
export function validateBundle(files) {
  const errors = []
  const issue = (code, path, message) => errors.push({ code, path, message })
  const apis = new Map()
  const environments = new Map()
  for (const [path, data] of Object.entries(files)) {
    const api = path.match(apiPath)
    const environment = path.match(environmentPath)
    const kind = path === 'workspace.json' ? 'workspace' : api ? 'api' : environment ? 'environment' : null
    if (!kind) { issue('file-path', path, '지원하지 않는 상대 JSON 파일명'); continue }
    if (!validators[kind](data)) {
      for (const error of validators[kind].errors) { issue('schema', path + error.dataPath, error.message) }
      continue
    }
    if (kind !== 'workspace') {
      if (data.id !== (api ?? environment)[1]) { issue('file-id', path, '파일명과 문서 ID 불일치') }
      const documents = kind === 'api' ? apis : environments
      documents.set(data.id, data)
    }
  }
  if (!Object.hasOwn(files, 'workspace.json')) { issue('reference', 'workspace.json', '작업 공간 파일 누락') }
  // 구조가 유효하지 않은 문서를 관계 검증에서 읽지 않습니다.
  if (errors.length) { return errors }
  const workspace = files['workspace.json']
  const entityIds = new Set()
  const register = (id, path) => {
    if (entityIds.has(id)) { issue('duplicate-id', path, '작업 공간 내 ID 중복') }
    entityIds.add(id)
  }
  register(workspace.id, 'workspace.json/id')
  const checkNames = (items, path) => {
    const names = new Set()
    for (const item of items) {
      const name = normalizedName(item.name)
      if (names.has(name)) { issue('duplicate-name', path, `표시 이름 중복: ${item.name}`) }
      names.add(name)
    }
  }
  const referencedApis = new Set()
  const checkApiLocation = (ids, path) => {
    const entries = []
    for (const id of ids) {
      if (referencedApis.has(id)) { issue('reference', path, '같은 API를 여러 위치에 배치할 수 없음') }
      referencedApis.add(id)
      if (!apis.has(id)) { issue('reference', path, `API 파일 누락: ${id}`) }
      else { entries.push(apis.get(id)) }
    }
    checkNames(entries, path)
  }
  checkNames(workspace.collections, 'workspace.json/collections')
  for (const collection of workspace.collections) {
    register(collection.id, 'workspace.json/collections')
    checkApiLocation(collection.apiIds, `collection:${collection.id}`)
    checkNames(collection.folders, `collection:${collection.id}/folders`)
    for (const folder of collection.folders) {
      register(folder.id, `collection:${collection.id}/folders`)
      checkApiLocation(folder.apiIds, `folder:${folder.id}`)
    }
  }
  for (const [id, api] of apis) {
    register(id, `api:${id}`)
    if (!referencedApis.has(id)) { issue('unreferenced', `api:${id}`, 'manifest에 배치되지 않은 API 파일') }
    checkApi(api, issue)
  }
  const referencedEnvironments = new Set(workspace.environmentIds)
  for (const id of referencedEnvironments) {
    if (!environments.has(id)) { issue('reference', 'workspace.json/environmentIds', `환경 파일 누락: ${id}`) }
  }
  checkNames([...environments.values()], 'environments')
  for (const [id, environment] of environments) {
    register(id, `environment:${id}`)
    if (!referencedEnvironments.has(id)) { issue('unreferenced', `environment:${id}`, 'manifest에 없는 환경 파일') }
    const variableIds = new Set()
    const keys = new Set()
    for (const variable of environment.variables) {
      if (variableIds.has(variable.id)) { issue('duplicate-id', `environment:${id}`, '변수 ID 중복') }
      variableIds.add(variable.id)
      if (keys.has(variable.name)) { issue('duplicate-key', `environment:${id}`, '변수 키 중복') }
      keys.add(variable.name)
    }
  }
  return errors
}

function checkApi(api, issue) {
  const path = `api:${api.id}`
  let structureValid = true
  const structuralIssue = (code, at, message) => { structureValid = false; issue(code, at, message) }
  const ids = new Set([api.id])
  const allFields = [...api.request.path, ...api.request.query, ...api.request.headers,
    ...api.request.body.json, ...api.request.body.multipart, ...api.response.success,
    ...api.response.errors, ...api.response.errors.flatMap((example) => example.fields), ...api.presets]
  for (const field of allFields) {
    if (ids.has(field.id)) { structuralIssue('duplicate-id', path, `API 내 ID 중복: ${field.id}`) }
    ids.add(field.id)
  }
  const presetNames = new Set()
  for (const preset of api.presets) {
    const name = normalizedName(preset.name)
    if (presetNames.has(name)) { structuralIssue('duplicate-name', path, `입력 세트 이름 중복: ${preset.name}`) }
    presetNames.add(name)
  }
  if (!api.presets.some((preset) => preset.id === api.defaultPresetId)) { structuralIssue('reference', path, '기본 입력 세트가 존재하지 않음') }
  checkTree(api.request.body.json, path + '/request/body/json', structuralIssue)
  checkTree(api.response.success, path + '/response/success', structuralIssue)
  if (!structureValid) { return }

  for (const preset of api.presets) {
    const at = `${path}/preset:${preset.name}`
    const values = preset.values
    for (const scope of ['path', 'query', 'headers', 'multipart']) {
      const fields = scope === 'multipart' ? api.request.body.multipart : api.request[scope]
      checkMapKeys(values[scope], fields, at + '/' + scope, issue)
      for (const field of fields) {
        const cell = values[scope][field.id]
        if (scope === 'path' && cell?.enabled === false) { issue('path-enabled', at, 'Path 필드는 사용 해제할 수 없음') }
        if (scope === 'multipart' && field.type === 'file') {
          if (cell && Object.keys(cell).some((key) => key !== 'enabled')) { issue('file-value', at, '파일 행에는 사용 여부만 저장 가능') }
          continue
        }
        if (cell && !Object.hasOwn(cell, 'value') && !Object.hasOwn(cell, 'secretRef')) { issue('value', at, '텍스트 행에 value 또는 secretRef 필요'); continue }
        if (cell?.enabled === false || (scope === 'multipart' && api.request.body.format !== 'multipart')) { continue }
        checkLiteral(cell?.secretRef ? { secretRef: cell.secretRef } : cell?.value ?? '', field, at, scope === 'query', issue)
      }
    }
    const body = api.request.body.json
    checkMapKeys(values.body.fields, body.filter((field) => !containers.has(field.type)), at + '/body/fields', issue)
    checkMapKeys(values.body.enabled, body, at + '/body/enabled', issue)
    if (api.request.body.format !== 'json') { continue }
    const byId = new Map(body.map((field) => [field.id, field]))
    for (const field of body) {
      // 비활성 부모 아래의 필드는 편집값은 유지하지만 값 검증과 출력에서 제외합니다.
      let current = field
      let disabled = false
      while (current) {
        if (values.body.enabled[current.id] === false) { disabled = true; break }
        current = byId.get(current.parentId)
      }
      if (disabled || containers.has(field.type)) { continue }
      checkLiteral(values.body.fields[field.id] ?? '', field, at + '/body', false, issue)
    }
  }
}

function checkTree(fields, path, issue) {
  if (!fields.length) { return }
  const roots = fields.filter((field) => field.parentId === null)
  if (roots.length !== 1 || fields[0].parentId !== null || roots[0]?.name !== '$') { issue('tree', path, '첫 필드가 이름 $인 유일한 루트여야 함') }
  const byId = new Map(fields.map((field) => [field.id, field]))
  const objectKeys = new Map()
  for (const field of fields) {
    if (field.parentId === null) { continue }
    const parent = byId.get(field.parentId)
    if (!parent) { issue('tree', path, '부모 필드 누락'); continue }
    if (!containers.has(parent.type)) { issue('tree', path, '스칼라·단일 타입 배열에 하위 필드가 존재함') }
    if (parent.type === 'object array' && field.type !== 'object') { issue('tree', path, '객체 배열의 자식은 object만 허용') }
    if (parent.type === 'object') {
      const keys = objectKeys.get(parent.id) ?? new Set()
      if (keys.has(field.name)) { issue('duplicate-key', path, `같은 객체의 키 중복: ${field.name}`) }
      keys.add(field.name)
      objectKeys.set(parent.id, keys)
    }
    const visited = new Set([field.id])
    let current = parent
    while (current) {
      if (visited.has(current.id)) { issue('tree', path, '부모 관계 순환'); break }
      visited.add(current.id)
      current = byId.get(current.parentId)
    }
  }
}

function checkMapKeys(values, fields, path, issue) {
  const ids = new Set(fields.map((field) => field.id))
  for (const id of Object.keys(values)) {
    if (!ids.has(id)) { issue('reference', path, `명세에 없는 필드 값: ${id}`) }
  }
}

// 실행 시 주입할 비밀 참조·변수식은 보존하며, 해석 전 실제 값 검증은 04~05 단계에서 수행합니다.
function checkLiteral(value, field, path, query, issue) {
  if (typeof value !== 'string' || /\{\{[^{}]+\}\}/.test(value)) { return }
  const at = `${path}/${field.name}`
  if (field.type === 'null') { return }
  if (field.required && !value.trim()) { issue('value', at, '필수값 누락'); return }
  if (field.type === 'string') { return }
  if (!value.trim() && !field.required) { return }
  let parsed
  try { parsed = JSON.parse(value) } catch { issue('value', at, '값의 JSON 표현 오류'); return }
  const elementType = field.type.split(' ')[0]
  if (field.type.endsWith(' array')) {
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === elementType && (elementType !== 'number' || Number.isFinite(item)))) { issue('value', at, '배열 원소 타입 오류') }
    else if (query && field.required && !parsed.length) { issue('value', at, '필수 Query 배열이 비어 있음') }
  } else if (typeof parsed !== field.type || (field.type === 'number' && !Number.isFinite(parsed))) {
    issue('value', at, '입력 타입 오류')
  }
}

// 오류 샘플은 정상 파일 묶음에 명시된 편집을 적용해 구성합니다. 원본 샘플은 변경하지 않습니다.
function applyEdits(files, edits) {
  const result = structuredClone(files)
  for (const edit of edits) {
    if (edit.op === 'deleteFile') { delete result[edit.file]; continue }
    if (edit.op === 'putFile') { result[edit.file] = structuredClone(edit.value); continue }
    const parent = edit.path.slice(0, -1).reduce((value, key) => value[key], result[edit.file])
    const key = edit.path.at(-1)
    if (edit.op === 'remove') { delete parent[key] }
    else if (edit.op === 'append') { parent[key].push(structuredClone(edit.value)) }
    else { parent[key] = structuredClone(edit.value) }
  }
  return result
}

function runSamples() {
  const samples = JSON.parse(readFileSync(new URL('./storage-v1.samples.json', import.meta.url), 'utf8'))
  const bundles = new Map()
  let count = 0
  for (const sample of samples.valid) {
    if (sample.base) { assert.ok(bundles.has(sample.base), `알 수 없는 정상 샘플: ${sample.base}`) }
    const files = sample.base ? applyEdits(bundles.get(sample.base), sample.edits) : sample.files
    const original = structuredClone(files)
    assert.deepEqual(validateBundle(files), [], sample.name)
    assert.deepEqual(files, original, sample.name + ': 검증 중 원본 보존')
    assert.deepEqual(JSON.parse(JSON.stringify(files)), files, sample.name + ': JSON 왕복')
    bundles.set(sample.name, files)
    count += 1
  }
  for (const sample of samples.invalid) {
    assert.ok(bundles.has(sample.base), `알 수 없는 정상 샘플: ${sample.base}`)
    const errors = validateBundle(applyEdits(bundles.get(sample.base), sample.edits))
    assert.ok(errors.some((error) => error.code === sample.expectedCode), `${sample.name}: ${JSON.stringify(errors)}`)
    count += 1
  }
  console.log(`Storage v1: ${count} samples passed (${samples.valid.length} valid, ${samples.invalid.length} invalid)`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) { runSamples() }
