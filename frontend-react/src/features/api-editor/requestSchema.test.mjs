import test from 'node:test'
import { File } from 'node:buffer'
import assert from 'node:assert/strict'
import { addBodyField, arrayPlaceholder, changeBodyFieldType, hasChildFields, createMultipartForm, describeMultipart, withDefaultBodyView, createRequestUrl, serializeQuery, queryFieldError, validateRequest, validateMultipart, fieldValueError, importBody, parseFieldValue, serializeBody, validateStructure } from './requestSchema.ts'
import { applyPayload, copyPayload } from '../payload-presets/types.ts'

test('JSON 구조와 0·false·null·배열 루트가 왕복 변환된다', () => {
  for (const data of [{ a: 0, b: false, c: null, list: [{ same: 1 }, { same: 2 }], empty: [] }, [1, 'text', false, null], false, 0, null, '']) {
    const imported = importBody(JSON.stringify(data), [])
    assert.deepEqual(JSON.parse(serializeBody(imported.fields, imported.values)), data)
  }
  assert.equal(parseFieldValue('false', 'boolean'), false)
  assert.throws(() => parseFieldValue('"false"', 'boolean'))
  assert.throws(() => parseFieldValue('0', 'boolean'))
  assert.throws(() => parseFieldValue('1', 'boolean'))
  assert.equal(parseFieldValue('true', 'boolean'), true)
})

test('명세 ID와 설명을 유지하고 잘못된 원문은 변환하지 않는다', () => {
  const first = importBody('{"a":{"value":1},"b":{"value":2}}', [])
  const annotated = first.fields.map((field) => ({ ...field, description: '설명', required: true }))
  const next = importBody('{"a":{"value":3},"b":{"value":4}}', annotated)
  assert.deepEqual(next.fields, annotated)
  assert.throws(() => importBody('{broken', annotated))
  const sibling = next.fields.find((field) => field.name === 'a')
  const duplicate = { ...sibling, id: 'duplicate' }
  assert.throws(() => serializeBody([...next.fields, duplicate], next.values), /중복/)
})

test('필수값과 숫자·불리언 입력을 검증한다', () => {
  const spec = { type: 'number', required: true, description: '' }
  assert.equal(fieldValueError('0', spec), null)
  assert.ok(fieldValueError('', spec))
  assert.ok(fieldValueError('"1"', spec))
  assert.equal(fieldValueError('false', { ...spec, type: 'boolean' }), null)
})

test('세트 적용은 API 명세·키·구조를 보존하고 값만 복원한다', () => {
  const request = { id: 'api', pathParams: [], headers: [], queryParams: [{ id: 'q', name: 'old', value: '1', enabled: true }], body: '', schema: { fields: { q: { type: 'number', required: false, description: '공통' } }, body: [] } }
  const preset = copyPayload(request)
  assert.equal('name' in preset.queryParams[0], false)
  request.queryParams[0].name = 'renamed'
  request.queryParams[0].value = '9'
  request.queryParams.push({ id: 'new', name: 'added', value: '7', enabled: true })
  const restored = applyPayload(request, preset)
  assert.equal(restored.queryParams[0].name, 'renamed')
  assert.equal(restored.queryParams[0].value, '1')
  assert.equal(restored.queryParams[1].name, 'added')
  assert.equal(restored.queryParams[1].value, '')
  assert.equal(restored.schema, request.schema)
  restored.queryParams[0].value = '3'
  assert.equal(preset.queryParams[0].value, '1')
})


test('응답 명세의 중복 키는 같은 부모 안에서만 거부한다', () => {
  const { fields } = importBody('{"a":{"id":1},"b":{"id":2}}', [])
  assert.equal(validateStructure(fields), null)
  const a = fields.find((field) => field.name === 'a')
  assert.ok(validateStructure([...fields, { ...a, id: 'duplicate' }]))
})


test('단일 타입 배열은 하위 필드 없이 값으로 저장하고 원소 타입을 검증한다', () => {
  for (const [type, data] of [['string array', ['A', 'B']], ['number array', [0, 2]], ['boolean array', [false, true]]]) {
    const imported = importBody(JSON.stringify(data), [])
    assert.equal(imported.fields[0].type, type)
    assert.equal(imported.fields.length, 1)
    assert.equal(hasChildFields(type), false)
    assert.ok(arrayPlaceholder(type))
    assert.deepEqual(JSON.parse(serializeBody(imported.fields, imported.values)), data)
  }
  assert.throws(() => parseFieldValue('[1,"2"]', 'number array'))
  assert.throws(() => parseFieldValue('[false]', 'string array'))
  assert.throws(() => parseFieldValue('{}', 'number array'))
})

test('객체 배열은 객체 항목을 유지하고 빈 배열의 지정 타입을 보존한다', () => {
  const imported = importBody('[{"id":1},{"id":2}]', [])
  assert.equal(imported.fields[0].type, 'object array')
  assert.equal(hasChildFields('object array'), true)
  assert.deepEqual(JSON.parse(serializeBody(imported.fields, imported.values)), [{ id: 1 }, { id: 2 }])
  const first = importBody('[1,2]', [])
  assert.equal(importBody('[]', first.fields).fields[0].type, 'number array')
  assert.throws(() => changeBodyFieldType(first.fields, first.values, first.fields[0], 'object array'))
  const generic = changeBodyFieldType(first.fields, first.values, first.fields[0], 'array')
  assert.deepEqual(JSON.parse(serializeBody(generic.fields, generic.values)), [1, 2])
})


test('객체 배열의 추가는 항목 객체 안에 문자열 필드를 추가한다', () => {
  const empty = importBody('[]', [], 'object array')
  const added = addBodyField(empty.fields, empty.values, empty.fields[0])
  assert.equal(added.fields.length, 3)
  assert.equal(added.fields[2].type, 'string')
  assert.equal(added.fields[2].parentId, added.fields[1].id)
  assert.deepEqual(JSON.parse(serializeBody(added.fields, added.values)), [{ field1: '' }])
  const second = addBodyField(added.fields, added.values, added.fields[0])
  assert.deepEqual(JSON.parse(serializeBody(second.fields, second.values)), [{ field1: '', field2: '' }])
  const multiple = importBody('[{"id":1},{"id":2}]', [])
  const changed = addBodyField(multiple.fields, multiple.values, multiple.fields[0])
  assert.deepEqual(JSON.parse(serializeBody(changed.fields, changed.values)), [{ id: 1, field1: '' }, { id: 2, field1: '' }])
  const primitive = importBody('[1,2]', [])
  assert.deepEqual(addBodyField(primitive.fields, primitive.values, primitive.fields[0]), primitive)
})


test('선택 boolean·number 빈 값은 생략하고 필수값과 입력된 타입은 검증한다', () => {
  const imported = importBody('{"flag":false,"count":0}', [])
  const flag = imported.fields.find((field) => field.name === 'flag')
  const count = imported.fields.find((field) => field.name === 'count')
  const empty = { ...imported.values, [flag.id]: '', [count.id]: '' }
  assert.deepEqual(JSON.parse(serializeBody(imported.fields, empty)), {})
  assert.deepEqual(JSON.parse(serializeBody(imported.fields, imported.values)), { flag: false, count: 0 })
  assert.throws(() => serializeBody(imported.fields.map((field) => field.id === flag.id ? { ...field, required: true } : field), empty), /필수값/)
  assert.throws(() => serializeBody(imported.fields, { ...empty, [flag.id]: 'wrong' }), /boolean/)
  assert.throws(() => serializeBody(imported.fields, { ...empty, [count.id]: 'wrong' }), /number/)
})


test('Multipart Form은 텍스트·파일·중복 키를 보존하고 비활성 행은 제외한다', async () => {
  const file = new File(['sample'], 'sample.txt', { type: 'text/plain' })
  const request = { bodyFormat: 'multipart', multipartFields: [
    { id: 'text1', name: 'tag', value: 'A', enabled: true },
    { id: 'text2', name: 'tag', value: 'B', enabled: true },
    { id: 'upload', name: 'file', value: '', enabled: true },
    { id: 'off', name: 'ignored', value: 'off', enabled: false },
  ], multipartFiles: { upload: { selectionId: 'selected', file } }, schema: { fields: { upload: { type: 'file', required: true, description: '' } }, body: [] } }
  const form = createMultipartForm(request)
  assert.deepEqual(form.getAll('tag'), ['A', 'B'])
  assert.equal(form.has('ignored'), false)
  assert.equal(form.get('file').name, 'sample.txt')
  assert.equal(await form.get('file').text(), 'sample')
  const preview = JSON.parse(describeMultipart(request))
  assert.deepEqual(preview[2].file, { name: 'sample.txt', size: 6, contentType: 'text/plain' })
  assert.equal(JSON.stringify(preview).includes('sample"'), false)
})

test('필수 파일 누락과 JSON에서의 file 타입을 거부한다', () => {
  const request = { multipartFields: [{ id: 'upload', name: 'file', value: '', enabled: true }], schema: { fields: { upload: { type: 'file', required: true } } } }
  assert.match(validateMultipart(request), /파일을 선택/)
  assert.throws(() => createMultipartForm(request), /파일을 선택/)
  assert.throws(() => parseFieldValue('data', 'file'), /Multipart Form/)
  const fields = importBody('{"file":""}', [])
  assert.ok(validateRequest({ pathParams: [], queryParams: [], headers: [], bodyView: 'fields', schema: { fields: {}, body: fields.fields.map((field) => field.name === 'file' ? { ...field, type: 'file' } : field) }, bodyValues: fields.values }))
})

test('파일 선택은 세트별로 복원하고 파일 내용은 메타데이터 미리보기에 포함하지 않는다', () => {
  const firstFile = new File(['first'], 'same.txt')
  const secondFile = new File(['second'], 'same.txt')
  const request = { pathParams: [], queryParams: [], headers: [], body: '', bodyFormat: 'multipart', multipartFields: [{ id: 'upload', name: 'file', value: '', enabled: true }], multipartFiles: { upload: { selectionId: 'first', file: firstFile } } }
  const first = copyPayload(request)
  const changed = { ...request, multipartFiles: { upload: { selectionId: 'second', file: secondFile } } }
  assert.notEqual(JSON.stringify(first), JSON.stringify(copyPayload(changed)))
  const restored = applyPayload(changed, first)
  assert.equal(restored.multipartFiles.upload.file, firstFile)
  assert.equal(restored.multipartFiles.upload.selectionId, 'first')
  delete restored.multipartFiles.upload
  assert.equal(first.multipartFiles.upload.file, firstFile)
})


test('본문 기본 보기는 필드 편집이며 잘못된 JSON과 명시적 원문 선택은 보존한다', () => {
  const initial = withDefaultBodyView({ body: '{"name":"로봇"}' })
  assert.equal(initial.bodyView, 'fields')
  assert.deepEqual(JSON.parse(serializeBody(initial.schema.body, initial.bodyValues)), { name: '로봇' })
  assert.equal(withDefaultBodyView({ body: '' }).bodyView, 'fields')
  const broken = withDefaultBodyView({ body: '{broken' })
  assert.equal(broken.bodyView, 'json')
  assert.equal(broken.body, '{broken')
  const raw = { body: '{}', bodyView: 'json' }
  assert.equal(withDefaultBodyView(raw), raw)
})


test('Query 배열은 키 반복을 기본으로 순서·중복·0·false를 보존한다', () => {
  const fields = [
    { id: 'ids', name: 'ids', value: '[0,2,2]', enabled: true },
    { id: 'flag', name: 'flag', value: '[false,true]', enabled: true },
    { id: 'again', name: 'ids', value: '9', enabled: true },
    { id: 'off', name: 'off', value: 'broken', enabled: false },
  ]
  const specs = { ids: { type: 'number array', required: false }, flag: { type: 'boolean array', required: false } }
  const result = serializeQuery(fields, specs)
  assert.equal(result.queryString, 'ids=0&ids=2&ids=2&flag=false&flag=true&ids=9')
  assert.equal(result.fields.length, 6)
  assert.equal(fields[0].value, '[0,2,2]')
})

test('Query 쉼표 구분은 원소별 예약문자와 한글을 인코딩한다', () => {
  const fields = [{ id: 'tags', name: '태그', value: '["A&B","x,y","한 글","a+b"]', enabled: true }]
  const specs = { tags: { type: 'string array', queryArrayFormat: 'comma', required: false } }
  const result = serializeQuery(fields, specs)
  assert.equal(result.queryString, `${encodeURIComponent('태그')}=A%26B,x%2Cy,${encodeURIComponent('한 글')},a%2Bb`)
  assert.deepEqual(result.fields, [{ name: '태그', value: 'A&B,x,y,한 글,a+b' }])
})

test('Query 빈 선택 배열은 생략하며 필수 빈 배열과 원소 타입 오류는 거부한다', () => {
  const field = { id: 'ids', name: 'ids', value: '[]', enabled: true }
  const optional = { type: 'number array', required: false }
  assert.equal(serializeQuery([field], { ids: optional }).queryString, '')
  assert.equal(serializeQuery([{ ...field, value: '' }], { ids: optional }).queryString, '')
  assert.ok(queryFieldError('[]', { ...optional, required: true }))
  assert.throws(() => serializeQuery([{ ...field, value: '[1,"bad"]' }], { ids: optional }))
  assert.throws(() => serializeQuery([{ ...field, name: '' }], { ids: optional }))
})


test('Request URL은 기존 Query를 보존하고 fragment를 전송 대상에서 제외한다', () => {
  assert.equal(createRequestUrl('https://api.test/items', 'ids=1&ids=2'), 'https://api.test/items?ids=1&ids=2')
  assert.equal(createRequestUrl('https://api.test/items?limit=10#section', 'ids=1,2'), 'https://api.test/items?limit=10&ids=1,2')
  assert.equal(createRequestUrl('https://api.test/items?', 'page=1'), 'https://api.test/items?page=1')
  assert.equal(createRequestUrl('https://api.test/items?limit=10&', 'page=1'), 'https://api.test/items?limit=10&page=1')
  assert.equal(createRequestUrl('{{baseUrl}}/items#section', ''), '{{baseUrl}}/items')
})
