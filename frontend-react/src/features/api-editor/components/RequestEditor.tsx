import { lazy, Suspense, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { RequestField, SampleRequest } from '@/features/workspace/types'

const JsonEditor = lazy(() => import('./JsonEditor').then((module) => ({ default: module.JsonEditor })))

type RequestEditorProps = {
  request: SampleRequest
  onChange: (request: SampleRequest) => void
}

type RequestFieldsProps = {
  fields: RequestField[]
  label: string
  onChange: (fields: RequestField[]) => void
}

function RequestFields({ fields, label, onChange }: RequestFieldsProps) {
  function updateField(fieldId: string, patch: Partial<RequestField>) {
    onChange(fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field))
  }

  return (
    <div className="request-fields">
      <div className="fields-heading">
        <span>{label}</span>
      </div>
      <Table className="fields-table">
        <TableHeader>
          <TableRow>
            <TableHead className="field-action-cell"><span className="sr-only">사용</span></TableHead>
            <TableHead>키</TableHead>
            <TableHead>값</TableHead>
            <TableHead className="field-action-cell"><span className="sr-only">삭제</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, index) => (
            <TableRow key={field.id}>
              <TableCell>
                <Checkbox
                  checked={field.enabled}
                  aria-label={`${label} ${index + 1}행 사용`}
                  onCheckedChange={(checked) => updateField(field.id, { enabled: checked === true })}
                />
              </TableCell>
              <TableCell>
                <Input
                  className="field-input"
                  aria-label={`${label} ${index + 1}행 키`}
                  placeholder="Key"
                  value={field.name}
                  onChange={(event) => updateField(field.id, { name: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  className="field-input"
                  aria-label={`${label} ${index + 1}행 값`}
                  placeholder="Value"
                  value={field.value}
                  onChange={(event) => updateField(field.id, { value: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${label} ${index + 1}행 삭제`}
                  onClick={() => onChange(fields.filter((item) => item.id !== field.id))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {fields.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>등록된 항목이 없습니다. 행을 추가해 입력하세요.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function RequestEditor({ request, onChange }: RequestEditorProps) {
  const [section, setSection] = useState('query')

  function addField() {
    if (section === 'body') {
      return
    }
    const fieldKey = section === 'path' ? 'pathParams' : section === 'query' ? 'queryParams' : 'headers'
    onChange({
      ...request,
      [fieldKey]: [...request[fieldKey], { id: crypto.randomUUID(), enabled: true, name: '', value: '' }],
    })
  }
  let jsonError = false
  if (request.body.trim()) {
    try {
      JSON.parse(request.body)
    } catch {
      jsonError = true
    }
  }

  return (
    <section className="request-editor" aria-label="요청 편집기">
      <Card className="request-sections-board" size="sm">
        <CardContent className="request-board-content">
          <Tabs className="request-sections" value={section} onValueChange={setSection}>
            <div className="request-sections-toolbar">
              <div className="request-tab-list-scroll">
                <TabsList aria-label="요청 입력 항목">
                  <TabsTrigger value="path">
                    Path params<Badge variant="secondary">{request.pathParams.filter((field) => field.enabled && field.name.trim()).length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="query">
                    Query params<Badge variant="secondary">{request.queryParams.filter((field) => field.enabled && field.name.trim()).length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="body">Body params</TabsTrigger>
                  <TabsTrigger value="headers">
                    Headers<Badge variant="secondary">{request.headers.filter((field) => field.enabled && field.name.trim()).length}</Badge>
                  </TabsTrigger>
                </TabsList>
              </div>
              {section !== 'body' && (
                <Button className="request-add-field" variant="ghost" size="sm" onClick={addField}>
                  <Plus aria-hidden="true" />행 추가
                </Button>
              )}
            </div>
            <Separator className="request-section-divider" />
            <TabsContent className="request-section-content" value="path">
              <RequestFields fields={request.pathParams} label="Path params" onChange={(pathParams) => onChange({ ...request, pathParams })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="query">
              <RequestFields fields={request.queryParams} label="Query params" onChange={(queryParams) => onChange({ ...request, queryParams })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="headers">
              <RequestFields fields={request.headers} label="Request headers" onChange={(headers) => onChange({ ...request, headers })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="body">
              <div className="body-heading"><Badge variant="outline">JSON</Badge></div>
              <Suspense fallback={<p className="editor-loading" role="status">편집기 준비 중…</p>}>
                <JsonEditor initialValue={request.body} label="요청 JSON 본문" onChange={(body) => onChange({ ...request, body })} />
              </Suspense>
              {jsonError && (
                <Alert className="body-warning" variant="destructive" role="status">
                  <AlertDescription>올바른 JSON 형식이 아닙니다.</AlertDescription>
                </Alert>
              )}
              {(request.method === 'GET' || request.method === 'HEAD') && (
                <p className="body-hint">GET·HEAD 본문의 실제 전송 정책은 API 호출 구현 단계에서 확정합니다.</p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </section>
  )
}
