import type { ExcelCell, ExcelSheet } from '@/lib/xlsx/Excel.module.js'
import { DEFAULT_SPEC } from '@/features/api-editor/requestSchema'
import type { BodyField, SampleRequest } from '@/features/workspace/types'

const cellStyle = { border: '1px solid #000000', fontSize: 10, width: 160, height: 28, verticalAlign: 'middle' }
const headingStyle = { ...cellStyle, backgroundColor: '#F2F2F2', fontWeight: 'bold' }
const sectionStyle = { ...headingStyle, backgroundColor: '#DCE6F1' }

// 미저장 상태를 포함한 현재 API 명세만 사용하며 실행 결과나 파일 내용은 포함하지 않습니다.
export function createApiDocumentSheet(request: SampleRequest): ExcelSheet {
  const data: ExcelCell[][] = []
  const cell = (text: unknown, heading = false): ExcelCell => ({ text, style: heading ? headingStyle : cellStyle })
  function section(title: string) { data.push([{ text: title, style: sectionStyle, colspan: 4 }]) }
  function info(label: string, value: string) { data.push([cell(label, true), { ...cell(value), colspan: 3 }]) }
  function parameterTable(title: string, key: 'pathParams' | 'queryParams' | 'headers' | 'multipartFields') {
    section(title)
    data.push(['Parameter', 'Required', 'Type', 'Description'].map((text) => cell(text, true)))
    for (const field of request[key] ?? []) {
      const spec = request.schema?.fields[field.id] ?? DEFAULT_SPEC
      data.push([field.name, key === 'pathParams' || spec.required ? 'Y' : 'N', spec.type, spec.description].map((text) => cell(text)))
    }
  }
  function bodyTable(title: string, fields: BodyField[]) {
    section(title)
    data.push(['Parameter', 'Required', 'Type', 'Description'].map((text) => cell(text, true)))
    const visited = new Set<string>()
    function visit(parentId: string | null, depth: number) {
      for (const field of fields.filter((item) => item.parentId === parentId)) {
        if (visited.has(field.id)) { continue }
        visited.add(field.id)
        const root = field.parentId === null && field.name === '$'
        if (!root) { data.push([`${'    '.repeat(depth)}${field.name}`, field.required ? 'Y' : 'N', field.type, field.description].map((text) => cell(text))) }
        visit(field.id, root ? depth : depth + 1)
      }
    }
    visit(null, 0)
  }
  data.push([{ text: request.name, style: { ...sectionStyle, fontSize: 16, height: 36 }, colspan: 4 }])
  info('인터페이스명', request.name)
  info('설명', request.documentation?.description ?? '')
  info('Request URL', request.url)
  info('HTTP Method', request.method)
  parameterTable('Headers', 'headers')
  parameterTable('Request · Path params', 'pathParams')
  parameterTable('Request · Query params', 'queryParams')
  if (request.bodyFormat === 'multipart') { parameterTable('Request · Multipart Form', 'multipartFields') }
  else { bodyTable('Request · Body', request.schema?.body ?? []) }
  bodyTable('Response · Success', request.responseFields ?? [])
  for (const [title, example] of [['Request Example', request.documentation?.requestExample], ['Response Example · Success', request.documentation?.responseExample]]) {
    section(title ?? '')
    const text = example ?? ''
    // 예시 전체를 한 행의 병합 셀에 담고, Excel의 행 높이 상한 안에서 줄 수에 맞춥니다.
    data.push([{
      ...cell(text), colspan: 4,
      style: { ...cellStyle, verticalAlign: 'top', height: Math.min(546, Math.max(80, text.split('\n').length * 16 + 12)) },
    }])
  }
  if (request.errorResponses.length > 0) { section('Response · Error') }
  for (const example of request.errorResponses) {
    section(`${example.status} · ${example.name || '오류 응답'}`)
    info('설명', example.description)
    for (const field of example.fields) { data.push([cell(field.name), { ...cell(field.value), colspan: 3 }]) }
  }
  return { name: 'API 문서', data }
}

export async function downloadApiDocument(request: SampleRequest) {
  const { default: Excel } = await import('@/lib/xlsx/Excel.module.js')
  const fileName = Array.from(request.name, (char) => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('').trim().slice(0, 100) || 'API 문서'
  await Excel.make([createApiDocumentSheet(request)], fileName)
}
