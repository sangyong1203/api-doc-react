/** 소문자 UUID. 실제 형식·소유권은 Main에서 검증하며 문자열 타입 자체가 권한을 의미하지 않습니다. */
export type EntityId = string
/** Main이 발급한 창·문서 수명 범위의 난수 핸들. 재실행·화면 재로드 후 재사용하지 않습니다. */
export type WorkspaceHandle = string
/** 공유 파일의 실제 UTF-8 바이트 또는 정렬된 파일 목록의 SHA-256: sha256:<64자리 소문자 hex>. */
export type ContentHash = `sha256:${string}`

export type DesktopErrorCode =
  | 'INVALID_REQUEST' | 'IPC_UNAVAILABLE' | 'IPC_TIMEOUT' | 'ACCESS_DENIED' | 'BUSY'
  | 'WORKSPACE_NOT_OPEN' | 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_ALREADY_EXISTS'
  | 'DOCUMENT_INVALID' | 'FORMAT_UNSUPPORTED' | 'FILE_CONFLICT' | 'PATH_NOT_ALLOWED'
  | 'FILE_READ_FAILED' | 'FILE_WRITE_FAILED' | 'PAYLOAD_TOO_LARGE'
  | 'OPERATION_ID_REUSED' | 'WORKSPACE_RECOVERY_REQUIRED'
  | 'DATABASE_UNAVAILABLE' | 'DATABASE_VERSION_UNSUPPORTED' | 'DATABASE_WRITE_FAILED' | 'RECORD_CONFLICT'
  | 'NOT_FOUND' | 'INTERNAL_ERROR'

export type DesktopError = {
  code: DesktopErrorCode
  message: string
  // 원본 값·SQL·절대 경로·stack 대신 사용자가 수정할 항목의 식별 정보만 전달합니다.
  details?: Array<{ kind?: 'workspace' | 'api' | 'environment' | 'preset'; id?: EntityId; fieldId?: EntityId; reason: string }>
}

export type DesktopRequest<T> = { requestId: EntityId; payload: T }
export type DesktopResult<T> =
  | { requestId: EntityId; ok: true; data: T }
  | { requestId: EntityId; ok: false; error: DesktopError }

export type DocumentKind = 'workspace' | 'api' | 'environment'
export type StoredDocument<K extends DocumentKind = DocumentKind> = {
  kind: K
  id: EntityId
  /** 저장 포맷 v1의 JSON 원문. Main에서 스키마·파일명/ID·문서 간 관계를 검증합니다. */
  json: string
  hash: ContentHash
}

export type WorkspaceSnapshot = {
  revision: ContentHash
  workspace: StoredDocument<'workspace'>
  apis: StoredDocument<'api'>[]
  environments: StoredDocument<'environment'>[]
}

export type WorkspaceConnection = {
  handle: WorkspaceHandle
  /** 앱 사용자 데이터에 보관하는 로컬 폴더 식별자. Git 복제본별로 다르며 접근 권한으로 사용하지 않습니다. */
  localFolderId: EntityId
  workspaceId: EntityId
  name: string
}

export type WorkspaceSelection =
  | { status: 'cancelled' }
  | { status: 'opened'; connection: WorkspaceConnection; snapshot: WorkspaceSnapshot }

export type OpenWorkspace = { source: 'dialog' } | { source: 'recent'; localFolderId: EntityId }
export type PutDocument = {
  action: 'put'
  kind: DocumentKind
  id: EntityId
  /** 생성은 null로 파일 부재를 요구하며, 수정은 마지막으로 읽은 파일 해시를 요구합니다. */
  expectedHash: ContentHash | null
  json: string
}
export type DeleteDocument = {
  action: 'delete'
  kind: Exclude<DocumentKind, 'workspace'>
  id: EntityId
  expectedHash: ContentHash
}
export type SharedCell = { enabled: boolean; value?: string; secretRef?: string }
export type SharedValues = {
  path: Record<string, SharedCell>; query: Record<string, SharedCell>; headers: Record<string, SharedCell>
  body: { fields: Record<string, string | { secretRef: string }>; enabled: Record<string, boolean> }
  multipart: Record<string, SharedCell>
}
export type SharedField = { id: string; name: string; type: import('../features/workspace/types.js').FieldType; required: boolean; description: string; arrayFormat?: 'repeat' | 'comma' }
export type SharedApi = {
  formatVersion: 1; id: string; name: string; method: import('../features/workspace/types.js').HttpMethod; url: string
  request: { path: SharedField[]; query: SharedField[]; headers: SharedField[]; body: { format: 'json' | 'multipart'; json: import('../features/workspace/types.js').BodyField[]; multipart: SharedField[] } }
  response: { success: import('../features/workspace/types.js').BodyField[]; errors: import('../features/workspace/types.js').ErrorResponseExample[] }
  documentation: { description: string; requestExample: string; responseExample: string }
  defaultPresetId: string
  presets: Array<{ id: string; name: string; description: string; values: SharedValues }>
}
export type WorkspaceCommit = {
  handle: WorkspaceHandle
  /** 응답 유실 후에도 유지하는 저장 작업 UUID. requestId와 별개입니다. */
  operationId: EntityId
  expectedRevision: ContentHash
  /** 현재 노출된 저장은 기존 API 한 개이며 선택 세트를 필수로 전달합니다. */
  selectedPresetId?: EntityId
  changes: Array<PutDocument | DeleteDocument>
}
export type CommittedWorkspace = {
  operationId: EntityId
  revision: ContentHash
  documents: Array<{ kind: DocumentKind; id: EntityId; hash: ContentHash | null }>
  /** 파일 저장과 개인 DB는 별도 결과입니다. 이력 실패를 파일 저장 실패로 바꾸지 않습니다. */
  history: 'recorded' | 'not-required' | 'failed' | 'unknown'
}
export type CommitStatus =
  | { status: 'pending' }
  | { status: 'committed'; result: CommittedWorkspace }
  | { status: 'failed'; error: DesktopError }
  | { status: 'unknown' }

/** 개인 설정·초안은 열린 폴더/공간에 연결합니다. UI가 DB 경로나 저장 키를 조립하지 않습니다. */
export type PersonalScope = { kind: 'app' } | { kind: 'workspace'; handle: WorkspaceHandle }
export type DraftTarget = { kind: 'api'; apiId: EntityId } | { kind: 'preset'; apiId: EntityId; presetId: EntityId }
export type DraftKey = { handle: WorkspaceHandle; target: DraftTarget; editSessionId: EntityId }
export type DraftSummary = { target: DraftTarget; editSessionId: EntityId; revision: number; baseRevision: ContentHash; updatedAt: string }
export type PersonalRecord = {
  revision: number
  /** 실제 설정·초안 스키마와 비밀값 제거 규칙은 02.07에서 정의하고 저장 전에 검증합니다. */
  json: string
  updatedAt: string
}
export type SaveHistorySummary = { id: EntityId; apiId: EntityId; savedAt: string; presetName: string; method: string; url: string }

/** 후속 기능의 명세용 타입입니다. 구현·검증된 메서드만 DesktopBridge에 연결합니다. */
export type DesktopDataApi = {
  workspace: {
    open: (request: DesktopRequest<OpenWorkspace>) => Promise<DesktopResult<WorkspaceSelection>>
    create: (request: DesktopRequest<{ name: string }>) => Promise<DesktopResult<WorkspaceSelection>>
    snapshot: (request: DesktopRequest<{ handle: WorkspaceHandle }>) => Promise<DesktopResult<WorkspaceSnapshot>>
    commit: (request: DesktopRequest<WorkspaceCommit>) => Promise<DesktopResult<CommittedWorkspace>>
    commitStatus: (request: DesktopRequest<{ handle: WorkspaceHandle; operationId: EntityId }>) => Promise<DesktopResult<CommitStatus>>
    changes: (request: DesktopRequest<{ handle: WorkspaceHandle; afterRevision: ContentHash }>) => Promise<DesktopResult<{ changed: boolean; revision: ContentHash }>>
    release: (request: DesktopRequest<{ handle: WorkspaceHandle }>) => Promise<DesktopResult<null>>
  }
  personal: {
    preferences: (request: DesktopRequest<{ scope: PersonalScope }>) => Promise<DesktopResult<PersonalRecord | null>>
    savePreferences: (request: DesktopRequest<{ scope: PersonalScope; expectedRevision: number | null; json: string }>) => Promise<DesktopResult<PersonalRecord>>
    drafts: (request: DesktopRequest<{ handle: WorkspaceHandle; apiId: EntityId }>) => Promise<DesktopResult<DraftSummary[]>>
    draft: (request: DesktopRequest<DraftKey>) => Promise<DesktopResult<(PersonalRecord & { baseRevision: ContentHash }) | null>>
    saveDraft: (request: DesktopRequest<DraftKey & { expectedRevision: number | null; baseRevision: ContentHash; json: string }>) => Promise<DesktopResult<PersonalRecord>>
    removeDraft: (request: DesktopRequest<DraftKey & { expectedRevision: number }>) => Promise<DesktopResult<null>>
    history: (request: DesktopRequest<{ handle: WorkspaceHandle; apiId: EntityId; beforeId: EntityId | null; limit: number }>) => Promise<DesktopResult<{ items: SaveHistorySummary[]; nextBeforeId: EntityId | null }>>
    historyEntry: (request: DesktopRequest<{ handle: WorkspaceHandle; apiId: EntityId; historyId: EntityId }>) => Promise<DesktopResult<{ summary: SaveHistorySummary; json: string }>>
  }
}
