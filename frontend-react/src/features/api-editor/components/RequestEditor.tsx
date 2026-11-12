import { lazy, Suspense, useState } from 'react'
import { Play, Plus, Save, Square, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import type { HttpMethod, RequestField, SampleOutcome, SampleRequest } from '@/features/workspace/types'

const JsonEditor = lazy(() => import('./JsonEditor').then((module) => ({ default: module.JsonEditor })))
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

type RequestEditorProps = {
  request: SampleRequest
  dirty: boolean
  running: boolean
  onChange: (request: SampleRequest) => void
  onSave: () => void
  onRun: (outcome: SampleOutcome) => void
  onCancel: () => void
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

  function addField() {
    onChange([...fields, { id: crypto.randomUUID(), enabled: true, name: '', value: '' }])
  }

  return (
    <div className="request-fields">
      <div className="fields-heading">
        <span>{label}</span>
        <Button variant="ghost" size="sm" onClick={addField}>
          <Plus aria-hidden="true" />행 추가
        </Button>
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

export function RequestEditor({ request, dirty, running, onChange, onSave, onRun, onCancel }: RequestEditorProps) {
  const [section, setSection] = useState('params')
  const [outcome, setOutcome] = useState<SampleOutcome>('success')
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
      <div className="request-heading">
        <div className="request-identity">
          <Breadcrumb className="request-breadcrumb" aria-label="API 위치">
            <BreadcrumbList>
              <BreadcrumbItem>Robot API</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>{request.folder}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <h1 className="request-title">
                  <BreadcrumbPage className="text-base font-semibold">{request.name}</BreadcrumbPage>
                </h1>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="request-save-controls">
          {dirty && <Badge variant="secondary">미저장</Badge>}
          <Button className="request-save text-xs" variant="outline" size="sm" disabled={!dirty} onClick={onSave}>
            <Save aria-hidden="true" />샘플 저장
          </Button>
        </div>
      </div>
      <div className="request-url-bar">
        <Select value={request.method} onValueChange={(method) => onChange({ ...request, method: method as HttpMethod })}>
          <SelectTrigger className="method-select" aria-label="HTTP 메서드">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((method) => (
              <SelectItem key={method} value={method}><HttpMethodBadge method={method} /></SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="url-input"
          aria-label="요청 URL"
          placeholder="{{baseUrl}}/robots"
          value={request.url}
          onChange={(event) => onChange({ ...request, url: event.target.value })}
        />
        <div className="request-run-controls">
          <Select value={outcome} disabled={running} onValueChange={(value) => setOutcome(value as SampleOutcome)}>
            <SelectTrigger className="text-xs" id="sample-outcome" aria-label="샘플 실행 결과"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="success">성공 응답</SelectItem>
              <SelectItem value="http-error">HTTP 오류 · 422</SelectItem>
              <SelectItem value="network-error">통신 오류</SelectItem>
            </SelectContent>
          </Select>
          {running ? (
            <Button className="request-send text-xs" variant="outline" onClick={onCancel}>
              <Square aria-hidden="true" />취소
            </Button>
          ) : (
            <Button className="request-send text-xs" onClick={() => onRun(outcome)} disabled={!request.url.trim()}>
              <Play aria-hidden="true" />샘플 실행
            </Button>
          )}
        </div>
      </div>
      <Card className="request-sections-board" size="sm">
        <CardContent>
          <Tabs className="request-sections" value={section} onValueChange={setSection}>
            <TabsList aria-label="요청 입력 항목">
              <TabsTrigger value="params">
                Params<Badge variant="secondary">{request.params.filter((field) => field.enabled && field.name.trim()).length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="body">Body</TabsTrigger>
              <TabsTrigger value="headers">
                Headers<Badge variant="secondary">{request.headers.filter((field) => field.enabled && field.name.trim()).length}</Badge>
              </TabsTrigger>
            </TabsList>
            <Separator className="request-section-divider" />
            <TabsContent className="request-section-content" value="params">
              <RequestFields fields={request.params} label="Query parameters" onChange={(params) => onChange({ ...request, params })} />
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
