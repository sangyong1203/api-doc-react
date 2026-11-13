import { Play, Save, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import type { HttpMethod, SampleRequest } from '@/features/workspace/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

type RequestToolbarProps = {
  request: SampleRequest
  collectionName: string
  folderName?: string
  dirty: boolean
  running: boolean
  onChange: (request: SampleRequest) => void
  onSave: () => void
  onRun: () => void
  onCancel: () => void
}

export function RequestToolbar({ request, collectionName, folderName, dirty, running, onChange, onSave, onRun, onCancel }: RequestToolbarProps) {
  return (
    <section className="request-toolbar" aria-label="요청 정보 및 실행">
      <div className="request-heading">
        <div className="request-identity">
          <Breadcrumb className="request-breadcrumb" aria-label="API 위치">
            <BreadcrumbList>
              <BreadcrumbItem>{collectionName}</BreadcrumbItem>
              {folderName && <><BreadcrumbSeparator /><BreadcrumbItem>{folderName}</BreadcrumbItem></>}
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
            <Save aria-hidden="true" />저장
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
          {running ? (
            <Button className="request-send text-xs" variant="outline" onClick={onCancel}>
              <Square aria-hidden="true" />취소
            </Button>
          ) : (
            <Button className="request-send text-xs" onClick={onRun} disabled={!request.url.trim()}>
              <Play aria-hidden="true" />실행
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
