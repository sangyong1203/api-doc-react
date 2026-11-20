// 개발용 Electron 실행 파일의 SQLite 검사 전용 진입점. 일반 앱에서는 사용하지 않습니다.
import { app } from 'electron'
import path from 'node:path'
import { runSqliteProbe } from './sqlite-probe.cjs'

const [profile, stage, token] = process.argv.slice(2)
if (!profile || !path.isAbsolute(profile) || (stage !== 'write' && stage !== 'verify') || !token) {
  throw new Error('SQLite 검증에는 임시 프로필·검증 단계·실행 식별자가 필요합니다.')
}
app.setPath('userData', profile)
void app.whenReady().then(async () => {
  try {
    const result = await runSqliteProbe({ directory: path.join(app.getPath('userData'), 'sqlite-compatibility'), stage, token })
    console.log(`APIDOC_SQLITE_RESULT:${JSON.stringify(result)}`)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
