import { LoaderCircle, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkspaceTab } from '../types'

type WorkspaceTabsProps = {
  tabs: WorkspaceTab[]
  onClose: (id: string) => void
}

export function WorkspaceTabs({ tabs, onClose }: WorkspaceTabsProps) {
  if (tabs.length === 0) {
    return <span className="tabs-empty">열린 API가 없습니다</span>
  }

  return (
    <div className="workspace-tabs-scroll">
      <TabsList className="workspace-tabs" variant="line" aria-label="열린 API">
        {tabs.map(({ request, saved, execution }) => {
          const dirty = JSON.stringify(request) !== JSON.stringify(saved)
          return (
            <div className="workspace-tab" key={request.id}>
              <TabsTrigger className="workspace-tab-select" value={request.id}>
                {request.name}
                {dirty && <Badge variant="secondary">미저장</Badge>}
                {execution.status === 'running' && (
                  <LoaderCircle className="motion-safe:animate-spin" aria-label="샘플 실행 중" />
                )}
              </TabsTrigger>
              <Button
                className="tab-close"
                variant="ghost"
                size="icon-xs"
                aria-label={`${request.name} 탭 닫기`}
                onClick={() => onClose(request.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          )
        })}
      </TabsList>
    </div>
  )
}
