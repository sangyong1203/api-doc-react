import { useState } from 'react'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog'
import type { Environment } from '../types'

const INITIAL_ENVIRONMENTS: Environment[] = [
  { id: 'local', name: 'Local', variables: [{ id: 'local-base-url', enabled: true, name: 'baseUrl', value: 'http://localhost:8080' }] },
  { id: 'dev', name: 'Development', variables: [] },
]

export function EnvironmentPicker() {
  const [environments, setEnvironments] = useState(INITIAL_ENVIRONMENTS)
  const [selectedId, setSelectedId] = useState<string | null>('local')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const selected = environments.find((environment) => environment.id === selectedId)

  return (
    <div className="environment-picker">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button className="environment-trigger max-w-56 text-xs" variant="outline" size="sm" id="workspace-environment" aria-label="환경 선택">
            <span className="environment-selected-name truncate">{selected?.name ?? '환경 없음'}</span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="environment-menu z-50 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md" align="end" sideOffset={4}>
            <DropdownMenu.RadioGroup value={selectedId ?? ''} onValueChange={setSelectedId} className="environment-options max-h-64 overflow-y-auto">
              {environments.map((environment) => (
                <DropdownMenu.RadioItem className="environment-option relative flex cursor-pointer items-center rounded-md py-1.5 pr-3 pl-7 text-sm outline-none focus:bg-accent focus:text-accent-foreground" key={environment.id} value={environment.id}>
                  <DropdownMenu.ItemIndicator className="environment-option-check absolute left-2"><Check className="size-3.5" aria-hidden="true" /></DropdownMenu.ItemIndicator>
                  <span className="max-w-64 truncate">{environment.name}</span>
                </DropdownMenu.RadioItem>
              ))}
              {environments.length === 0 && <p className="environment-menu-empty px-2 py-2 text-xs text-muted-foreground">등록된 환경이 없습니다.</p>}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="environment-menu-divider my-1 h-px bg-border" />
            <DropdownMenu.Item className="environment-settings-action flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground" onSelect={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" aria-hidden="true" />환경 설정
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {settingsOpen && (
        <EnvironmentSettingsDialog environments={environments} selectedId={selectedId} onClose={() => setSettingsOpen(false)} onSave={(next) => {
          setEnvironments(next)
          // 현재 사용 환경이 삭제되면 남은 첫 환경으로 전환하고, 목록이 비면 선택을 해제합니다.
          setSelectedId((current) => next.some((environment) => environment.id === current) ? current : next[0]?.id ?? null)
          setSettingsOpen(false)
        }} />
      )}
    </div>
  )
}
