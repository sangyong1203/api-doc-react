import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_SPEC } from '@/features/api-editor/requestSchema'
import type { BodyField, FieldSpec, SampleRequest } from '@/features/workspace/types'

type DocumentationRow = FieldSpec & { id: string; name: string; depth: number }

// 부모 ID로 표시 순서와 깊이를 구하고 내부 루트는 문서에서 숨깁니다.
function bodyRows(fields: BodyField[]): DocumentationRow[] {
  const rows: DocumentationRow[] = []
  const visited = new Set<string>()
  function visit(parentId: string | null, depth: number) {
    for (const field of fields.filter((item) => item.parentId === parentId)) {
      if (visited.has(field.id)) { continue }
      visited.add(field.id)
      const root = field.parentId === null && field.name === '$'
      if (!root) { rows.push({ ...field, depth }) }
      visit(field.id, root ? depth : depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

function Specification({ title, rows }: { title: string; rows: DocumentationRow[] }) {
  return <section className="document-specification space-y-2">
    <h3 className="font-medium">{title}</h3>
    {rows.length ? <Table aria-label={`${title} 문서`} className="min-w-[520px]">
      <TableHeader><TableRow><TableHead className="w-2/5">필드</TableHead><TableHead>필수</TableHead><TableHead>타입</TableHead><TableHead>설명</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.id}>
        <TableCell className="break-all font-mono" style={{ paddingLeft: 8 + row.depth * 16 }}>{row.name || '(이름 없음)'}</TableCell>
        <TableCell>{row.required ? 'Y' : 'N'}</TableCell><TableCell>{row.type}</TableCell><TableCell className="whitespace-pre-wrap">{row.description || '—'}</TableCell>
      </TableRow>)}</TableBody>
    </Table> : <p className="text-sm text-muted-foreground">등록된 명세가 없습니다. 요청 보기에서 편집할 수 있습니다.</p>}
  </section>
}

export function ApiDocumentation({ request }: { request: SampleRequest }) {
  const document = request.documentation ?? { description: '', requestExample: '', responseExample: '' }
  function parameterRows(key: 'pathParams' | 'queryParams' | 'headers' | 'multipartFields'): DocumentationRow[] {
    return (request[key] ?? []).map((field) => ({ ...DEFAULT_SPEC, ...request.schema?.fields[field.id], id: field.id, name: field.name, depth: 0, ...(key === 'pathParams' ? { required: true } : {}) }))
  }
  return <Card className="api-documentation min-h-0 flex-1 overflow-hidden">
    <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-muted-foreground">API 문서 · 현재 메모리의 편집 내용을 표시합니다.</p>
      <div className="document-preview-scroll min-h-0 overflow-auto">
        <article className="api-document-preview mx-auto w-full max-w-5xl space-y-7 py-3 text-sm">
          <header className="space-y-3"><h2 className="text-xl font-semibold">{request.name}</h2><div className="flex flex-wrap items-center gap-2"><HttpMethodBadge method={request.method} /><code className="break-all">{request.url}</code></div><p className="text-xs text-muted-foreground">작성 중인 API 문서 미리보기 · 변수 치환 전 주소 · 필수 Y / 선택 N</p></header>
          <section className="space-y-2"><h3 className="font-semibold">설명</h3>{document.description.trim() ? <p className="document-description whitespace-pre-wrap break-words">{document.description}</p> : <p className="text-muted-foreground">요청 편집기의 문서 탭에서 API 설명을 입력하세요.</p>}</section>
          <Specification title="Headers" rows={parameterRows('headers')} />
          <section className="space-y-4"><h2 className="border-b pb-2 text-lg font-semibold">Request · 요청 명세</h2><Specification title="Path params" rows={parameterRows('pathParams')} /><Specification title="Query params" rows={parameterRows('queryParams')} /><Specification title={`Body · ${request.bodyFormat === 'multipart' ? 'Multipart Form' : 'JSON'}`} rows={request.bodyFormat === 'multipart' ? parameterRows('multipartFields') : bodyRows(request.schema?.body ?? [])} /></section>
          <section className="space-y-4"><h2 className="border-b pb-2 text-lg font-semibold">Response · 응답 명세</h2><Specification title="Success · 성공 응답 명세" rows={bodyRows(request.responseFields ?? [])} />
            {request.errorResponses.length > 0 && <section className="space-y-3"><h3 className="font-medium">Error · 오류 응답 예시</h3>{request.errorResponses.map((example) => <section key={example.id} className="space-y-2 rounded-md border p-3"><h3 className="font-medium">{example.status} · {example.name || '오류 응답'}</h3><p className="whitespace-pre-wrap">{example.description}</p><pre className="overflow-auto text-xs">{example.fields.map((field) => `${field.name}: ${field.value}`).join('\n')}</pre></section>)}</section>}
          </section>
          {(['requestExample', 'responseExample'] as const).map((key) => <section key={key} className="space-y-2"><h2 className="border-b pb-2 text-lg font-semibold">{key === 'requestExample' ? 'Request Example · 요청 예시' : 'Response Example · 성공 응답 예시'}</h2>{document[key].trim() ? <pre className="overflow-auto rounded-md bg-muted p-4 text-xs"><code>{document[key]}</code></pre> : <p className="text-muted-foreground">요청 편집기의 문서 탭에서 예시를 입력하세요.</p>}</section>)}
        </article>
      </div>
    </CardContent>
  </Card>
}
