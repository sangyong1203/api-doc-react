import type { DraftSummary, DraftTarget, PersonalRecord, SaveHistorySummary } from '../src/types/desktopData.js'

/** Main이 유효한 작업 공간 핸들에서 얻는 내부 식별자. Renderer가 전달한 값을 그대로 사용하지 않습니다. */
export type LocalWorkspace = { localFolderId: string; workspaceId: string }
export type PreferenceScope = { kind: 'app' } | ({ kind: 'workspace' } & LocalWorkspace)
export type LocalDraftKey = { scope: LocalWorkspace; target: DraftTarget; editSessionId: string }
export type DraftRecord = PersonalRecord & { baseRevision: `sha256:${string}` }
export type HistoryEntry = { summary: SaveHistorySummary; json: string }

export type PersonalOperations = {
  /** 경로 정규화·권한·manifest 검증은 후속 Main 파일 계층에서 먼저 수행해야 합니다. */
  rememberWorkspace: {
    input: { canonicalPath: string; pathKey: string; workspaceId: string; displayName: string }
    output: LocalWorkspace
  }
  preferences: { input: { scope: PreferenceScope }; output: PersonalRecord | null }
  savePreferences: { input: { scope: PreferenceScope; expectedRevision: number | null; json: string }; output: PersonalRecord }
  drafts: { input: { scope: LocalWorkspace; apiId: string }; output: DraftSummary[] }
  draft: { input: LocalDraftKey; output: DraftRecord | null }
  saveDraft: {
    // preset 초안은 필드·파일 행 관계를 검사할 현재 API common을 별도로 받습니다. 이 원문은 DB에 저장하지 않습니다.
    input: LocalDraftKey & { expectedRevision: number | null; baseRevision: string; json: string; commonJson?: string }
    output: PersonalRecord
  }
  removeDraft: { input: LocalDraftKey & { expectedRevision: number }; output: null }
  /** 파일 저장 성공을 확인한 Main 내부 저장 서비스 전용. Renderer/IPC에 임의 이력 추가로 노출하지 않습니다. */
  recordHistory: { input: { scope: LocalWorkspace; apiId: string; operationId: string; json: string }; output: SaveHistorySummary }
  history: {
    input: { scope: LocalWorkspace; apiId: string; beforeId?: string | null; limit?: number }
    output: { items: SaveHistorySummary[]; nextBeforeId: string | null }
  }
  historyEntry: { input: { scope: LocalWorkspace; apiId: string; historyId: string }; output: HistoryEntry }
}
export type PersonalOperation = keyof PersonalOperations
/**
 * Main 내부 전용입니다. 구조 검증은 비밀값 제거를 보장하지 않습니다.
 * 실제 연결 시 Main이 현재 snapshot·소유 관계를 확인하고 비밀값/선택 파일을 제외한 DTO를 새로 구성해야 합니다.
 * 해당 계약을 연결하기 전에는 앱 편집값의 자동 저장이나 Renderer의 직접 호출에 사용하지 않습니다.
 */
export type PersonalDataClient = { [K in PersonalOperation]: (input: PersonalOperations[K]['input']) => Promise<PersonalOperations[K]['output']> }
export const PERSONAL_OPERATIONS: PersonalOperation[] = [
  'rememberWorkspace', 'preferences', 'savePreferences', 'drafts', 'draft', 'saveDraft', 'removeDraft', 'recordHistory', 'history', 'historyEntry',
]
