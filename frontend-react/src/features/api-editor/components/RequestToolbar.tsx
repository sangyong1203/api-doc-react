import { FileText, History, Play, Save, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import type { HttpMethod, SampleRequest } from '@/features/workspace/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

type RequestToolbarProps = {
  fileWorkspace?: boolean
  saving?: boolean
  savePending?: boolean
  saveBlocked?: boolean
  request: SampleRequest
  collectionName: string
  folderName?: string
  dirty: boolean
  running: boolean
  onChange: (request: SampleRequest) => void
  onSave: () => void
  onDocument: () => void
  onHistory: () => void
  onRun: () => void
  onCancel: () => void
}

export function RequestToolbar({ request, collectionName, folderName, dirty, running, onChange, onSave, onDocument, onHistory, onRun, onCancel, fileWorkspace = false, saving = false, savePending = false, saveBlocked = false }: RequestToolbarProps) {
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
          {dirty && <Badge variant="warning">미저장</Badge>}
          <Button className="request-save text-xs" variant="outline" size="sm" disabled={saving || saveBlocked || (!dirty && !savePending)} onClick={onSave}>
            <Save aria-hidden="true" />{saving ? '저장 중…' : savePending ? '저장 상태 확인' : '저장'}
          </Button>
          <Button className="request-document text-xs" variant="outline" size="sm" onClick={onDocument}>
            <FileText aria-hidden="true" />문서
          </Button>
          <Button className="request-history text-xs" variant="outline" size="sm" disabled={fileWorkspace} onClick={onHistory}>
            <History aria-hidden="true" />이력
          </Button>
        </div>
      </div>
      <div className="request-url-bar">
        <div className="request-url-input-group flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-input transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20 dark:bg-input/30">
          <Select value={request.method} onValueChange={(method) => onChange({ ...request, method: method as HttpMethod })}>
            <SelectTrigger className="method-select h-full rounded-none border-0 border-r focus-visible:ring-0 dark:bg-transparent" aria-label="HTTP 메서드">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((method) => (
                <SelectItem key={method} value={method}><HttpMethodBadge method={method} /></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="url-input h-full rounded-none border-0 focus-visible:ring-0 dark:bg-transparent"
            aria-label="요청 URL"
            placeholder="{{baseUrl}}/robots"
            value={request.url}
            onChange={(event) => onChange({ ...request, url: event.target.value })}
          />
        </div>
        <div className="request-run-controls">
          {running ? (
            <Button className="request-send text-xs" variant="outline" onClick={onCancel}>
              <Square aria-hidden="true" />취소
            </Button>
          ) : (
            <Button className="request-send text-xs" onClick={onRun} disabled={!request.url.trim() || fileWorkspace}>
              <Play aria-hidden="true" />{fileWorkspace ? '실행 준비 중' : '샘플 실행'}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
