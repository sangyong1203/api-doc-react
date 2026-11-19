import test from 'node:test'
import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { copyHistoryRequest, restoreHistoryRequest } from './types.ts'

function createRequest() {
  return {
    id: 'api', name: 'API', collectionId: 'collection', folderId: null, method: 'POST', url: '/robots',
    pathParams: [], queryParams: [{ id: 'query', name: 'page', value: '0', enabled: true }], headers: [],
    body: '{"enabled":false}', bodyValues: { enabled: 'false' }, bodyEnabled: { enabled: false }, multipartFiles: {},
    schema: { fields: { query: { required: false, type: 'number', description: '페이지' } }, body: [] },
    errorResponses: [{ id: 'error', status: '400', name: '오류', description: '', fields: [] }],
    documentation: { description: '설명', requestExample: '{}', responseExample: '{}' },
  }
}

test('저장 복사본은 이후 필드·명세·문서 편집과 독립적이다', () => {
  const request = createRequest()
  const saved = copyHistoryRequest(request)
  assert.equal(JSON.stringify(saved), JSON.stringify(request))
  request.queryParams[0].value = '99'
  request.schema.fields.query.description = '변경'
  request.errorResponses[0].status = '500'
  request.documentation.description = '변경'
  request.bodyEnabled.enabled = true
  assert.equal(saved.queryParams[0].value, '0')
  assert.equal(saved.schema.fields.query.description, '페이지')
  assert.equal(saved.errorResponses[0].status, '400')
  assert.equal(saved.documentation.description, '설명')
  assert.equal(saved.bodyEnabled.enabled, false)
})

test('되돌린 폼 편집은 원래 이력을 바꾸지 않으며 현재 API 식별·이름·위치를 유지한다', () => {
  const saved = createRequest()
  const current = { ...createRequest(), name: '이름 변경', collectionId: 'moved', folderId: 'folder', method: 'GET', url: '/new' }
  const restored = restoreHistoryRequest(current, saved)
  assert.equal(restored.name, '이름 변경')
  assert.equal(restored.collectionId, 'moved')
  assert.equal(restored.folderId, 'folder')
  assert.equal(restored.method, 'POST')
  assert.equal(restored.url, '/robots')
  assert.equal(restored.bodyValues.enabled, 'false')
  restored.queryParams[0].value = '10'
  assert.equal(saved.queryParams[0].value, '0')
  assert.equal(current.url, '/new')
})

test('선택 파일은 File과 선택 ID를 유지하며 선택 객체의 후속 변경은 분리된다', () => {
  const file = new File(['content'], 'sample.txt', { type: 'text/plain' })
  const request = { ...createRequest(), multipartFiles: { upload: { selectionId: 'first', file } } }
  const saved = copyHistoryRequest(request)
  request.multipartFiles.upload.selectionId = 'second'
  assert.equal(saved.multipartFiles.upload.selectionId, 'first')
  assert.equal(saved.multipartFiles.upload.file, file)
  assert.equal(restoreHistoryRequest(request, saved).multipartFiles.upload.file, file)
})
