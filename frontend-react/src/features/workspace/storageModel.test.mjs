import test from 'node:test'
import { URL } from 'node:url'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'

const source = readFileSync(new URL('./storageModel.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { decodeFolderWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
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
