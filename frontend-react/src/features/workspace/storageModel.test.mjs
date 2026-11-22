import test from 'node:test'
import { URL } from 'node:url'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { createRequire } from 'node:module'
const { validateApiEdit } = createRequire(import.meta.url)('../../../dist-electron/electron/workspace-format.cjs')

const source = readFileSync(new URL('./storageModel.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { decodeFolderWorkspace, encodeApiEdit } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const sample = JSON.parse(readFileSync(new URL('../../../../doc/storage-v1.samples.json', import.meta.url), 'utf8')).valid.find(value => value.name === 'main').files
function fixture() {
  const docs = Object.entries(sample).map(([file, value]) => ({ kind: file === 'workspace.json' ? 'workspace' : file.startsWith('apis/') ? 'api' : 'environment', id: value.id, json: JSON.stringify(value), hash: `sha256:${'a'.repeat(64)}` }))
  const snapshot = { revision: `sha256:${'b'.repeat(64)}`, workspace: docs.find(doc => doc.kind === 'workspace'), apis: docs.filter(doc => doc.kind === 'api'), environments: docs.filter(doc => doc.kind === 'environment') }
  const connection = { handle: randomUUID(), localFolderId: randomUUID(), workspaceId: snapshot.workspace.id, name: sample['workspace.json'].name }
  return { snapshot, connection }
}

test('파일 화면 변환은 컬렉션·API 순서·기본 세트·환경을 보존하고 원본 snapshot을 변경하지 않는다', () => {
  const { snapshot, connection } = fixture()
  const before = JSON.stringify(snapshot)
  const loaded = decodeFolderWorkspace(connection, snapshot)
  assert.equal(loaded.requests.length, snapshot.apis.length)
  assert.deepEqual(loaded.collections.map(value => value.id), sample['workspace.json'].collections.map(value => value.id))
  for (const request of loaded.requests) {
    const original = JSON.parse(snapshot.apis.find(doc => doc.id === request.id).json)
    assert.equal(loaded.defaultPresets[request.id], original.defaultPresetId)
    assert.deepEqual(loaded.presetsByApi[request.id].map(value => value.id), original.presets.map(value => value.id))
  }
  assert.equal(loaded.environments.length, sample['workspace.json'].environmentIds.length)
  assert.equal(JSON.stringify(snapshot), before)
})

test('복제 폴더는 같은 workspace ID라도 화면 세션 키가 다르고 비밀 참조는 미입력으로 알린다', () => {
  const { snapshot, connection } = fixture()
  const first = decodeFolderWorkspace(connection, snapshot)
  const clone = decodeFolderWorkspace({ ...connection, localFolderId: randomUUID() }, snapshot)
  assert.notEqual(first.workspace.id, clone.workspace.id)
  assert.equal(first.hasSecretRefs, true)
  assert.equal(JSON.stringify(first.requests).includes('***'), false)
})


test('화면 저장 DTO는 선택 세트·공통 명세만 수정하고 비밀 참조·다른 세트·파일 실체를 보존/제외', () => {
  const { snapshot, connection } = fixture()
  const loaded = decodeFolderWorkspace(connection, snapshot)
  for (const request of loaded.requests) {
    const old = JSON.parse(snapshot.apis.find(document => document.id === request.id).json)
    const selected = loaded.defaultPresets[request.id]
    const edited = { ...request, url: '{{baseUrl}}/edited', queryParams: request.queryParams.map(row => request.schema.fields[row.id]?.type === 'boolean' ? { ...row, value: 'true' } : row), multipartFiles: { test: { selectionId: '/private/selection', file: { contents: 'private-file-content' } } } }
    const encoded = encodeApiEdit(snapshot, edited, selected)
    assert.equal(encoded.url, edited.url)
    assert.ok(validateApiEdit(snapshot, JSON.stringify(encoded), encoded.id, selected))
    for (const row of edited.queryParams) { assert.equal(encoded.presets.find(preset => preset.id === selected).values.query[row.id].value, row.value) }
    assert.deepEqual(encoded.presets.filter(preset => preset.id !== selected), old.presets.filter(preset => preset.id !== selected))
    assert.deepEqual(encoded.request.body, old.request.body)
    assert.equal(JSON.stringify(encoded).includes('private-file-content'), false)
    assert.equal(JSON.stringify(encoded).includes('/private/selection'), false)
    for (const channel of ['path', 'query', 'headers', 'multipart']) {
      const original = old.presets.find(preset => preset.id === selected).values[channel]
      for (const [id, cell] of Object.entries(original)) {
        if (cell.secretRef) { assert.equal(encoded.presets.find(preset => preset.id === selected).values[channel][id].secretRef, cell.secretRef) }
      }
    }
  }
})

test('비밀 참조 입력에 실제값을 넣으면 공유 DTO를 만들지 않고 원본을 유지', () => {
  const { snapshot, connection } = fixture(), loaded = decodeFolderWorkspace(connection, snapshot)
  let checked = false
  for (const request of loaded.requests) {
    const original = JSON.parse(snapshot.apis.find(document => document.id === request.id).json)
    const selected = loaded.defaultPresets[request.id]
    const preset = original.presets.find(preset => preset.id === selected)
    for (const [channel, key] of [['path', 'pathParams'], ['query', 'queryParams'], ['headers', 'headers'], ['multipart', 'multipartFields']]) {
      const entry = Object.entries(preset.values[channel]).find(([, cell]) => cell.secretRef)
      if (!entry) { continue }
      const edited = { ...request, [key]: request[key].map(row => row.id === entry[0] ? { ...row, value: 'private-token' } : row) }
      assert.throws(() => encodeApiEdit(snapshot, edited, selected), /비밀 참조/)
      checked = true
    }
  }
  assert.equal(checked, true)
})
