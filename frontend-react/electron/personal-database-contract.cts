export type PersonalDatabaseErrorCode = 'DATABASE_UNAVAILABLE' | 'DATABASE_VERSION_UNSUPPORTED' | 'DATABASE_WRITE_FAILED'

/** SQL·원본 값·절대 경로를 Main 또는 향후 IPC 오류에 포함하지 않습니다. */
export class PersonalDatabaseError extends Error {
  constructor(public readonly code: PersonalDatabaseErrorCode) {
    const messages = {
      DATABASE_UNAVAILABLE: '개인 저장소를 열거나 확인할 수 없습니다. 원본을 보존한 상태에서 복구가 필요합니다.',
      DATABASE_VERSION_UNSUPPORTED: '현재 앱에서 지원하지 않는 개인 저장소 버전입니다.',
      DATABASE_WRITE_FAILED: '개인 저장소 쓰기를 완료하지 못했습니다.',
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
