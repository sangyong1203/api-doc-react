import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import type { SampleRequest } from '@/features/workspace/types'

type CollectionSidebarProps = {
  requests: SampleRequest[]
  selectedId?: string
  onSelect: (request: SampleRequest) => void
}

export function CollectionSidebar({ requests, selectedId, onSelect }: CollectionSidebarProps) {
  const [search, setSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([])
  const term = search.trim().toLowerCase()
  const filtered = requests.filter((request) =>
    `${request.name} ${request.method} ${request.url}`.toLowerCase().includes(term),
  )
  const folders = [...new Set(filtered.map((request) => request.folder))]

  function toggleFolder(folder: string) {
    setCollapsedFolders((current) => current.includes(folder)
      ? current.filter((name) => name !== folder)
      : [...current, folder])
  }

  return (
    <aside className="collection-sidebar" aria-label="컬렉션 탐색">
      <div className="sidebar-heading">
        <span>컬렉션</span>
        <Badge variant="secondary">{requests.length} APIs</Badge>
      </div>
      <div className="collection-search-field relative">
        <Search className="collection-search-icon pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          className="collection-search pl-9"
          aria-label="API 이름, 메서드, 주소 검색"
          placeholder="API 검색…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="collection-title text-xs">
        <Folder aria-hidden="true" />
        <span>Robot API</span>
      </div>
      <nav className="collection-tree" aria-label="API 목록">
        {folders.map((folder) => {
          const expanded = term !== '' || !collapsedFolders.includes(folder)
          return (
            <div className="collection-folder" key={folder}>
              <Button
                className="folder-toggle text-xs aria-expanded:bg-transparent"
                variant="ghost"
                aria-expanded={expanded}
                onClick={() => toggleFolder(folder)}
              >
                {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                <Folder aria-hidden="true" />
                {folder}
              </Button>
              {expanded && filtered.filter((request) => request.folder === folder).map((request) => (
                <Button
                  className={`collection-request text-xs ${selectedId === request.id ? 'bg-primary/20 hover:bg-primary/25' : ''}`}
                  variant={selectedId === request.id ? 'secondary' : 'ghost'}
                  key={request.id}
                  aria-current={selectedId === request.id ? 'page' : undefined}
                  onClick={() => onSelect(request)}
                >
                  <HttpMethodBadge method={request.method} />
                  <span className="collection-request-name">{request.name}</span>
                </Button>
              ))}
            </div>
          )
        })}
        {filtered.length === 0 && <p className="sidebar-empty" role="status">검색 결과가 없습니다.</p>}
      </nav>
    </aside>
  )
}
