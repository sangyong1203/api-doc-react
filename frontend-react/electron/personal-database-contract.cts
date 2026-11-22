export type PersonalDatabaseErrorCode = 'DATABASE_UNAVAILABLE' | 'DATABASE_VERSION_UNSUPPORTED' | 'DATABASE_WRITE_FAILED'
  | 'INVALID_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'RECORD_CONFLICT' | 'NOT_FOUND'

/** SQL·원본 값·절대 경로를 Main 또는 향후 IPC 오류에 포함하지 않습니다. */
export class PersonalDatabaseError extends Error {
  constructor(public readonly code: PersonalDatabaseErrorCode) {
    const messages = {
      DATABASE_UNAVAILABLE: '개인 저장소를 열거나 확인할 수 없습니다. 원본을 보존한 상태에서 복구가 필요합니다.',
      DATABASE_VERSION_UNSUPPORTED: '현재 앱에서 지원하지 않는 개인 저장소 버전입니다.',
      DATABASE_WRITE_FAILED: '개인 저장소 쓰기를 완료하지 못했습니다.',
      INVALID_REQUEST: '개인 데이터 요청의 형식이나 참조를 확인해 주세요.',
      PAYLOAD_TOO_LARGE: '개인 데이터의 저장 크기 한도를 초과했습니다.',
      RECORD_CONFLICT: '개인 데이터가 변경되었습니다. 다시 조회한 뒤 저장해 주세요.',
      NOT_FOUND: '해당 개인 데이터 또는 작업 공간 연결을 찾을 수 없습니다.',
    }
    super(messages[code])
    this.name = 'PersonalDatabaseError'
  }
}

export type PersonalDatabaseStatus = {
  schemaVersion: number
  sqliteVersion: string
  journalMode: string
  foreignKeys: boolean
  synchronous: number
  busyTimeoutMs: number
}


export const PERSONAL_RECOVERY_MARKER = 'personal-recovery.json'
/** Main이 소유하는 백업 파일 참조입니다. Renderer에 경로 입력/출력 API로 노출하지 않습니다. */
export type PersonalBackupReference = { databasePath: string; metadataPath: string }
export type PersonalBackup = PersonalBackupReference & { id: string; schemaVersion: number }
export type PersonalRecoveryResult = { operationId: string; preservedDirectory: string }
