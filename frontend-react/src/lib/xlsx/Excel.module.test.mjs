import test from 'node:test'
import assert from 'node:assert/strict'
import Excel from './Excel.module.js'

// 다운로드 API 대신 생성된 워크북을 받아 실제 xlsx 바이트의 재읽기 결과를 검사합니다.
const testWindow = {}
globalThis.window = testWindow
await import('./XLSX.min.js')
const XLSX = testWindow.XLSX

async function generate(data) {
  const original = XLSX.writeFile
  let workbook
  XLSX.writeFile = (value) => { workbook = value }
  try {
    await Excel.make([{ name: 'API 문서', data }], 'test')
  } finally {
    XLSX.writeFile = original
  }
  for (const [address, cell] of Object.entries(workbook.Sheets['API 문서'])) {
    assert.ok(!address.includes('undefined'), address)
    if (!address.startsWith('!')) { assert.notEqual(cell.v, 'undefined', address) }
  }
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true })
  const result = XLSX.read(bytes, { type: 'buffer', cellStyles: true, bookFiles: true })
  const xml = result.files['xl/worksheets/sheet1.xml'].asText()
  assert.doesNotMatch(xml, /<hyperlinks\b[^>]*>\s*<\/hyperlinks>|<hyperlinks\s*\/>/)
  return result.Sheets['API 문서']
}

test('병합 셀의 테두리용 빈 셀에 undefined 문자열을 넣지 않는다', async () => {
  const sheet = await generate([
    [{ text: 'API 제목', colspan: 4, rowspan: 2, style: { border: '1px solid #000000' } }],
    [],
    [{ text: '기본 정보', colspan: 4, style: { borderTop: '1px solid #000000' } }],
    [{ text: '명세', rowspan: 2, style: { borderLeft: '1px solid #000000' } }],
    [],
  ])
  assert.equal(sheet.A1.v, 'API 제목')
  assert.equal(sheet.A3.v, '기본 정보')
  for (const [address, cell] of Object.entries(sheet)) {
    if (!address.startsWith('!')) { assert.notEqual(cell.v, 'undefined', address) }
  }
  assert.equal(sheet['!merges'].length, 3)
})

test('누락값은 빈 셀로 출력하고 0과 false는 보존한다', async () => {
  const sheet = await generate([[undefined, null, 0, false, ''].map((text) => ({ text, style: {} }))])
  assert.equal(sheet.A1?.v ?? '', '')
  assert.equal(sheet.B1?.v ?? '', '')
  assert.equal(sheet.C1.v, '0')
  assert.equal(sheet.D1.v, 'false')
})

test('AZ 이후 열 주소와 테두리 없는 병합 범위를 보존한다', async () => {
  const sheet = await generate([
    Array.from({ length: 60 }, (_, index) => ({ text: `열 ${index}`, style: {} })),
    [{ text: '넓은 제목', colspan: 60, rowspan: 3, style: {} }],
  ])
  assert.equal(sheet.BH1.v, '열 59')
  assert.equal(sheet['!ref'], 'A1:BH4')
  assert.deepEqual(sheet['!merges'][0], { s: { c: 0, r: 1 }, e: { c: 59, r: 3 } })
})

test('병합 영역 전체의 배경색·글꼴·테두리·정렬을 실제 XLSX에 저장한다', async () => {
  const sheet = await generate([
    [{ text: 'API 제목', colspan: 4, rowspan: 2, style: {
      backgroundColor: '#d1d1d1', fontWeight: 'bold', fontSize: 18,
      fontFamily: '맑은 고딕', color: '#123456', textAlign: 'center',
      verticalAlign: 'middle', border: '1px solid #000000', width: 160, height: 30,
    } }],
    [],
  ])
  for (const address of ['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2']) {
    const style = sheet[address].s
    assert.equal(style.patternType, 'solid', address)
    assert.equal(style.fgColor.rgb, 'D1D1D1', address)
    assert.equal(style.bold, 1, address)
    assert.equal(style.sz, 18, address)
    assert.equal(style.name, '맑은 고딕', address)
    assert.equal(style.color.rgb, '123456', address)
    assert.equal(style.alignment.horizontal, 'center', address)
    assert.equal(style.alignment.vertical, 'center', address)
    assert.equal(style.alignment.wrapText, true, address)
    for (const side of ['top', 'bottom', 'left', 'right']) { assert.equal(style[side].style, 'thin', address) }
  }
  assert.equal(sheet['!rows'][0].hpx, 30)
})

test('링크 없는 셀은 하이퍼링크를 생성하지 않고 실제 링크는 보존한다', async () => {
  const sheet = await generate([[
    { text: '링크 없음', style: {} },
    { text: '빈 링크', link: '', style: {} },
    { text: '공백 링크', link: '  ', style: {} },
    { text: '실제 링크', link: 'https://example.com/api', style: {} },
  ]])
  for (const address of ['A1', 'B1', 'C1']) { assert.equal(sheet[address].l, undefined) }
  assert.equal(sheet.D1.l.Target, 'https://example.com/api')
})
