import type { CreateWorkspaceResult } from '../types'
import { useState } from 'react'
import { Check, ChevronDown, FolderOpen, Plus } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog'
import type { Workspace } from '../types'

type Props = {
  workspace: Workspace
  workspaces: Workspace[]
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<CreateWorkspaceResult>
  onOpen: () => void
  native: boolean
  busy: boolean
}

export function WorkspacePicker({ workspace, workspaces, onSelect, onCreate, onOpen, native, busy }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="workspace-picker min-w-0">
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <Button className="workspace-name max-w-[min(55vw,320px)] text-sm" variant="ghost" size="sm" aria-label="작업 공간 선택" disabled={busy}>
            <FolderOpen className="shrink-0" aria-hidden="true" />
            <span className="workspace-selected-name truncate">{workspace.name}</span>
            <ChevronDown className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="workspace-menu z-50 min-w-56 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md" align="start" sideOffset={4}>
            <DropdownMenu.Label className="workspace-menu-label px-2 py-1.5 text-xs text-muted-foreground">작업 공간</DropdownMenu.Label>
            <DropdownMenu.RadioGroup className="workspace-options max-h-64 overflow-y-auto" value={workspace.id} onValueChange={(id) => {
              setMenuOpen(false)
              onSelect(id)
            }}>
              {workspaces.map((item) => (
                <DropdownMenu.RadioItem className="workspace-option relative flex cursor-pointer items-center rounded-md py-1.5 pr-3 pl-7 text-sm outline-none focus:bg-accent focus:text-accent-foreground" key={item.id} value={item.id}>
                  <DropdownMenu.ItemIndicator className="workspace-option-check absolute left-2"><Check className="size-3.5" aria-hidden="true" /></DropdownMenu.ItemIndicator>
                  <span className="workspace-option-name max-w-64 truncate">{item.name}</span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="workspace-menu-divider my-1 h-px bg-border" />
            {native && <DropdownMenu.Item className="workspace-open-action flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground" onSelect={onOpen}>
              <FolderOpen className="size-4" aria-hidden="true" />폴더 열기
            </DropdownMenu.Item>}
            <DropdownMenu.Item className="workspace-create-action flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground" onSelect={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />새 작업 공간
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {createOpen && <WorkspaceCreateDialog native={native} onClose={() => setCreateOpen(false)} onCreate={async (name) => {
        const result = await onCreate(name)
        if (result.status === 'created') { setCreateOpen(false) }
        return result
      }} />}
    </div>
  )
}
