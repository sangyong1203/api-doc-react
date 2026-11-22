# PC 앱 IPC 계약과 접근 경계

작성일: 2026-11-20

관련 기능: 02.02~02.08, 04.04, 08.03. 기능 범위는 [개발 기획](plan.md), 구현·검증 상태는 [개발 진행 현황](progress.md)에서 관리한다.

## 1. 계약과 실제 노출의 구분

- 현재 `window.apidocDesktop`에는 내장 버전·종료 상태 조회/응답과 `workspace.open/create/snapshot/release/commit/commitStatus`를 제공한다. 기존 종료 확인 동작은 유지한다.
- 파일·개인 저장소의 전체 명세는 `frontend-react/src/types/desktopData.ts`의 `DesktopDataApi`로 정의한다. `DesktopBridge`에는 구현한 작업 폴더 메서드 여섯 개를 연결한다. 저장은 기존 API 한 개의 편집에 한정하며 외부 변경 감지·개인 데이터 직접 호출 API는 노출하지 않는다.
- 아래 메서드는 각 기능의 Main 처리·입력/결과 검증·실패 경로를 구현한 뒤에만 Preload에 추가한다. 미구현 기능이 성공한 것처럼 반환하는 임시 API는 제공하지 않는다.
- Preload는 고정 채널에 연결한 작업별 함수만 노출한다. Renderer에는 `invoke(channel, ...)`, `ipcRenderer`, 이벤트 객체, SQL·DB 경로·임의 파일 읽기/쓰기 기능을 제공하지 않는다.
- 실제 API 요청 실행의 주소·파일 업로드·취소·응답 전송 계약은 05 단계에서 별도 정의한다. 작업 폴더 핸들은 임의 네트워크/업로드 파일 접근 권한으로 사용하지 않는다.

## 2. 공통 요청·응답

```ts
type DesktopRequest<T> = { requestId: EntityId; payload: T }
type DesktopResult<T> =
  | { requestId: EntityId; ok: true; data: T }
  | { requestId: EntityId; ok: false; error: DesktopError }
```

- `EntityId`는 저장 포맷 v1과 같은 소문자 UUID다. `requestId`는 개별 호출 추적용이며 접근 권한이 아니다. 잘못된 요청 ID는 원문을 반사하지 않고 Main이 안전한 추적 ID를 생성해 오류를 반환한다.
- 오류에는 고정 코드·사용자 안내·필요한 항목 ID/필드 ID/원인 코드만 포함한다. 원본 값·비밀값·절대 경로·SQL·stack·네이티브 Error 객체를 보내지 않는다.
- Main 처리 결과는 항상 판별 가능한 성공/실패 객체로 반환한다. Preload에서도 응답 형식·요청 ID 일치를 확인한다. 유효한 결과를 받지 못하면 `IPC_UNAVAILABLE` 또는 `IPC_TIMEOUT`으로 구분한다.
- 사용자 폴더 선택 취소는 `ok: true, data: { status: 'cancelled' }`다. 오류나 빈 작업 공간으로 바꾸지 않는다.
- 시각은 ISO 8601 UTC 문자열로 전달한다. UI 표시는 공통 날짜 util을 사용한다.
- 타입 별칭은 런타임 검증을 대신하지 않는다. UUID·해시·길이·개수·문서 관계는 Main에서 별도로 검증한다.
- `File`·DOM 객체·함수·Promise·순환 객체·사용자 클래스는 데이터 요청에 사용하지 않는다. 공유 JSON은 포맷 v1의 원문 문자열로 전달하고 Main에서 파싱·검증한다.

## 3. 작업 폴더 메서드

모든 메서드는 `DesktopRequest<...>`를 받고 `Promise<DesktopResult<...>>`를 반환한다. 아래 표는 payload와 성공 data의 의미다. 고정 채널명은 해당 메서드 구현 시 Preload 내부에서만 사용한다.

| 메서드 / 채널 | 요청 payload | 성공 data |
| --- | --- | --- |
| `workspace.open` / `workspace:open` | `{source:'dialog'}` 또는 `{source:'recent', localFolderId}` | 취소 또는 connection·snapshot |
| `workspace.create` / `workspace:create` | `{name}`. 실제 경로는 네이티브 폴더 선택창으로 선택 | 취소 또는 connection·snapshot |
| `workspace.snapshot` / `workspace:snapshot` | `{handle}` | 검증된 manifest·API·환경 원문과 파일별 hash·전체 revision |
| `workspace.commit` / `workspace:commit` | `{handle, operationId, expectedRevision, selectedPresetId, changes}` | 작업 ID·새 revision·변경 파일 hash·개인 이력 기록 결과 |
| `workspace.commitStatus` / `workspace:commit-status` | `{handle, operationId}` | pending / committed / failed / unknown |
| `workspace.changes` / `workspace:changes` | `{handle, afterRevision}` | `{changed, revision}`. 변경 시 snapshot 재조회 |
| `workspace.release` / `workspace:release` | `{handle}` | null. 핸들만 해제하며 파일·초안·이력은 삭제하지 않음 |

### 폴더 연결과 식별자

- `workspaceId`: 공유 manifest의 UUID. Git 복제본 간에 같을 수 있다.
- `localFolderId`: 앱 사용자 데이터에 기록하는 로컬 폴더 연결 UUID. 같은 공유 공간을 다른 폴더에 복제하면 별도 ID를 사용한다. 최근 폴더 열기는 Main이 보유한 이 ID→경로 매핑만 사용한다.
- `handle`: 현재 창·주 프레임 문서에 귀속된 난수 핸들. 실제 경로는 Main만 보관한다. 해제·창 종료·화면 재로드 시 폐기한다. 새 문서는 폴더를 다시 열어 새 핸들을 받는다.
- 최근 폴더는 매번 경로·접근 권한·manifest ID·파일 관계를 확인한다. 폴더가 사라졌거나 다른 데이터로 바뀌면 오류를 안내하고 명시적인 폴더 선택으로 조정한다.
- 폴더 선택은 창마다 한 번에 하나만 진행하고 중복 요청은 `BUSY`로 구분한다. 다이얼로그 대기를 일반 읽기 타임아웃으로 강제 취소하지 않는다. 취소·실패하면 현재 작업 공간을 바꾸지 않는다.
- 생성은 기존 manifest·관리 폴더·파일을 덮어쓰지 않는다. 생성 결과가 불명확하면 자동 반복하지 않고 해당 폴더 열기로 기존 생성 결과를 확인한다.
- 생성 이름은 앞뒤 공백을 제거한 1~200 UTF-16 코드 단위다. 파일당 8 MiB·전체 64 MiB·manifest 포함 최대 1,000개로 제한하며 초과는 `PAYLOAD_TOO_LARGE`로 반환한다. 작업 루트의 일반 파일·`.git`은 수정하지 않는다.

### snapshot과 파일 버전

- 원문 문자열은 Main이 실제 파일 바이트를 UTF-8로 읽고 [포맷 v1](storage-design.md)의 구조·파일명/ID·참조·모든 세트 값을 검증한 결과다. JSON 파싱 성공만으로 유효한 snapshot으로 취급하지 않는다.
- `hash`는 실제 파일 바이트의 SHA-256이며 형식은 `sha256:<64자리 소문자 hex>`다.
- 전체 `revision`은 `[[상대 경로, hash], ...]` 배열을 경로의 코드 포인트순으로 정렬하고 `JSON.stringify`한 UTF-8 바이트의 SHA-256이다. 상대 경로의 구분자는 `/`이며 이 해시 입력에는 공백·개행을 추가하지 않는다. 파일 생성·삭제·manifest 변경도 revision을 바꾼다.
- 읽기 도중 파일 목록·hash가 바뀌면 일관된 기준을 다시 수집하거나 충돌을 반환한다. 디스크 오류·누락 참조를 빈 목록으로 대체하지 않는다.
- 현재 파일 서비스는 목록·바이트 해시를 두 번 수집해 관측한 변경을 `FILE_CONFLICT`로 반환한다. 잘못된 UTF-8·BOM·관리 폴더의 알 수 없는 항목(엄격한 내부 쓰기 임시 이름의 일반 파일 제외)·심볼릭 링크·관리 파일의 추가 하드 링크를 거부한다. 비어 있는 공간은 관리 디렉터리가 없어도 열 수 있지만 manifest가 참조한 파일의 누락은 오류다.

### 저장과 응답 유실

- 현재 앱의 `commit`은 기존 API 한 개의 put만 허용한다. `selectedPresetId`가 해당 API에 속하는지 검사하고, 원본 snapshot의 이름·위치·기본 세트·세트 목록을 유지한다. 다른 세트의 값은 삭제된 필드 ID 정리 외에는 수정하지 못한다. 신규 API·manifest·환경 변경·delete는 내부 파일 계층만 구현돼 있으며 IPC에서는 거부한다.
- Renderer는 공통 명세·선택 세트 값을 허용 필드로 새로 구성한다. Main이 최종 공유 문서 묶음·모든 세트 값·원본 비밀 참조를 재검증한다. 일반 입력은 공유 값이며 기존 `secretRef` 필드의 실제값 입력을 저장하지 않는다. File·selectionId·로컬 경로·JSON 원문 보기 상태는 저장 DTO에 포함하지 않는다. 비밀 참조 생성/실제값 관리 UI는 후속 범위다.
- 저장 버튼은 요청 중 중복 저장을 막고, 성공 시 실제 제출한 복사본까지만 저장 기준을 갱신한다. 추가 편집·실패·충돌은 현재 입력을 유지한다. 저장 timeout은 30초이며 결과 불명확 시 같은 버튼은 `commitStatus`만 조회한다. 쓰기를 자동 재전송하지 않는다.

- `put`에는 문서 kind·UUID·원문 JSON·기대 hash를 포함한다. 신규 생성만 `expectedHash: null`로 파일 부재를 요구한다. `delete`는 API·환경에만 허용하고 기대 hash를 필수로 받는다. manifest 삭제는 허용하지 않는다.
- Main은 변경을 적용한 최종 문서 묶음을 검증한다. 같은 요청의 중복 대상, manifest/API 불일치, 모든 세트의 타입 오류를 거부한다. Renderer가 JSON 원문으로 준 필드가 파일 경로에 영향을 주지 않게 한다.
- 저장 시작 전 전체 revision과 변경 파일 hash를 재검사한다. 같은 폴더의 쓰기는 직렬화한다. 충돌은 강제 덮어쓰기·자동 병합 없이 `FILE_CONFLICT`로 반환한다.
- `operationId`는 저장 작업 UUID이며 요청 유실 후 조회에도 유지한다. 동일 작업 ID·동일 의미의 내용은 기존 상태/결과를 반환하고 다른 내용이면 `OPERATION_ID_REUSED`로 거부한다. 요청 추적 ID·일시 핸들은 내용 비교에서 제외한다.
- 다중 파일 변경은 앱 사용자 데이터의 복구 저널·기존 바이트·기대 hash로 조정한다. 미완료 저널이 있으면 해당 공간의 새 쓰기를 막고 `WORKSPACE_RECOVERY_REQUIRED`로 구분한다.
- 결과를 받지 못한 쓰기는 실패로 단정하거나 자동 재전송하지 않는다. 새 핸들로 같은 로컬 폴더를 연 뒤 작업 상태를 조회한다. unknown이면 snapshot·파일 기준을 비교하고 사용자 조정 후 새 저장을 시작한다.
- 파일 저장과 개인 DB는 하나의 트랜잭션이 아니다. `history: 'failed'`라도 공유 파일은 committed일 수 있다. UI는 파일 성공·개인 이력 실패를 따로 안내하며 파일 저장을 반복하지 않는다.
- 핸들 해제는 이미 시작한 디스크 작업을 중간에 강제 중단하지 않는다. 복구 저널과 작업 상태는 보존한다. 영구적인 exactly-once 처리를 보장하지 않는다. 내부 파일 계층의 저널·복구 방향·보관/용량 기준은 [파일 저장 설계](storage-design.md#51-파일-저장-계층과-복구-기록)를 따른다. 현재 `WorkspaceWriter`는 Main 전용 내부 계층이고 `WorkspaceService`가 파일 결과와 선택 세트의 개인 이력 결과를 조립한다. 파일 성공 뒤 이력 실패는 `history: failed`, 재실행/캐시 만료 등으로 이력 결과를 확정하지 못하면 `history: unknown`으로 구분한다. 복구 API는 Preload에 노출하지 않는다. 기존 종료 확인을 거친 뒤 파일 작업·개인 이력이 끝날 때까지 기다리고 DB를 닫는다.

## 4. 개인 저장소 메서드

SQLite 연결·경로·SQL은 Main/DB Worker 내부에 둔다. Renderer는 작업별 데이터만 전달한다.

| 메서드 / 채널 | 요청 payload | 성공 data |
| --- | --- | --- |
| `personal.preferences` / `personal:preferences` | 앱 또는 열린 작업 공간 scope | 개인 설정 record 또는 null |
| `personal.savePreferences` / `personal:save-preferences` | scope·기대 revision·JSON | 새 revision·JSON·갱신 시각 |
| `personal.drafts` / `personal:drafts` | handle·API ID | 복구 가능한 명세/세트 초안의 대상·편집 세션·revision·갱신 시각 목록 |
| `personal.draft` / `personal:draft` | handle·초안 대상·편집 세션 ID | 개인 record와 기준 파일 revision 또는 null |
| `personal.saveDraft` / `personal:save-draft` | 초안 키·기대 revision·기준 파일 revision·JSON | 새 개인 record |
| `personal.removeDraft` / `personal:remove-draft` | 초안 키·기대 revision | null |
| `personal.history` / `personal:history` | handle·API ID·이전 페이지 마지막 ID 또는 null·개수 | 저장 이력 요약 목록과 다음 조회 ID |
| `personal.historyEntry` / `personal:history-entry` | handle·API ID·이력 ID | 이력 요약과 복원용 JSON |

- 개인 설정은 앱 전역과 작업 공간별 scope를 구분한다. Main이 핸들로 localFolderId·workspaceId를 결정하며 Renderer가 임의 DB 키를 지정하지 않는다.
- API 명세·문서 초안과 세트 값 초안은 `DraftTarget`으로 구분한다. 편집 세션별로 격리하고 서로의 초안을 자동으로 덮어쓰지 않는다. 재실행 시 drafts로 이전 편집 세션의 복구 후보를 조회한 뒤 필요한 초안을 읽는다. 요약 목록에는 실제 입력값을 포함하지 않는다.
- 개인 record revision은 0 이상의 안전한 정수다. 생성은 기대 revision null로 부재를 요구하며 갱신·삭제는 기존 revision 일치를 요구한다. 불일치는 `RECORD_CONFLICT`다.
- 저장 이력 추가는 성공한 파일 저장 처리 내부에서 수행한다. UI가 임의 이력을 추가하거나 JSON 원본에 자동 적용하는 메서드를 제공하지 않는다. 이력 선택은 현재 폼에만 적용하고 원본 변경에는 별도 저장이 필요하다.
- 이력은 저장 시각·ID의 고정 최신순으로 조회하며 요약에 당시 메서드·URL·세트명을 포함한다. 커서는 해당 폴더·API의 기존 이력 ID에만 허용하며 다른 API/공간의 이력을 가져오지 않는다.
- 개인 JSON·비밀값 분리·보관·백업/마이그레이션은 [개인 저장소 설계안](personal-storage-design.md)에 따라 런타임 검증·서비스 구현 후 해당 API를 활성화한다. 실행 이력은 08.03에서 별도 정의한다. JSON 문자열이라는 이유로 임의 구조를 저장하지 않는다.
- 응답·백업·초안에 비밀번호·토큰·업로드 파일 내용/참조 경로를 기록하지 않는다. secretRef와 미입력 상태를 마스킹 문자열과 구분한다.

## 5. Main의 검증 순서와 경로 경계

1. 호출한 WebContents가 이 창의 소유 객체이고 senderFrame이 현재 주 프레임인지 확인한다. 없거나 분리된 프레임·다른 창·동일 URL의 iframe도 거부한다.
2. 주 프레임 URL을 파싱해 배포의 고정 protocol/host 또는 현재 개발 Vite origin만 허용한다. 문자열 prefix 비교·외부 origin·사용자명/비밀번호가 있는 URL은 허용하지 않는다.
3. 고정 채널·요청 envelope·UUID·필수/추가 필드·문자열/배열/안전한 정수·JSON/문서 크기를 검증한다. 크기는 UTF-8 바이트, 개수는 명세 단위로 제한하며 실제 상한은 해당 서비스 구현 전 정한다.
4. 핸들의 발급 창·문서 수명·열린 폴더·workspace ID를 검사한다. API·세트·이력 ID가 그 공간과 API에 속하는지 재확인한다.
5. Main이 검증된 문서 kind와 UUID만으로 `workspace.json`, `apis/<uuid>.json`, `environments/<uuid>.json` 경로를 조립한다. 임의 절대/상대 경로·UNC·장치 경로·구분자·NTFS stream 이름을 요청 필드로 받지 않는다.
6. 네이티브 선택 루트의 정규화/realpath와 OS별 경로 경계를 기준으로 실제 관리 파일을 확인한다. `root-other` 같은 형제 경로를 root로 오인하는 prefix 비교를 하지 않는다. 관리 트리 내부의 symlink·junction·reparse point를 통해 다른 위치로 접근하지 않게 한다.
7. 읽기/쓰기 직전 부모·대상·교체 대상을 다시 확인하고 Windows 경로 경합·링크 교체·권한·파일 점유를 검증한다. 안전성을 확인하지 못하면 쓰기를 거부한다. realpath 한 번만으로 경합을 해결했다고 간주하지 않는다.
8. 공유 파일은 포맷 v1의 전체 관계를, 개인 데이터는 별도 스키마와 revision을 검증한 뒤 처리한다. 결과는 안전한 오류/성공 객체로 변환한다.

문자열 URL·주 프레임 검증은 종료·작업 폴더 IPC에 적용한다. 작업 폴더는 루트·관리 부모·파일의 realpath와 장치/파일 식별을 반복 확인하고 열린 파일 핸들의 전후 상태를 검사한다. 창 종료·Renderer 종료·주 문서 재로드 시 핸들을 폐기한다. OS가 제공하는 원자적 경로 접근까지 보장한 것으로 간주하지 않으며 Windows junction/reparse·경로 경합의 실제 검증과 쓰기 경계는 후속 검증/02.05에 포함한다.

## 6. 오류와 UI 동작

| 오류 코드 | 화면 처리 |
| --- | --- |
| INVALID_REQUEST / ACCESS_DENIED / PATH_NOT_ALLOWED | 잘못된 요청·접근 안내, 자동 반복 없음 |
| WORKSPACE_NOT_OPEN / WORKSPACE_NOT_FOUND | 현재 초안 유지, 폴더 다시 열기 |
| WORKSPACE_ALREADY_EXISTS | 덮어쓰지 않고 기존 폴더 열기 안내 |
| DOCUMENT_INVALID / FORMAT_UNSUPPORTED | 문서/필드 위치 안내, 원본 보호 |
| FILE_CONFLICT / RECORD_CONFLICT | 파일 원본 또는 개인 초안 충돌 표시, 수동 조정 |
| IPC_UNAVAILABLE / IPC_TIMEOUT | 전송 실패와 저장 결과 불명확 상태를 구분. 읽기는 명시 재조회, 쓰기는 작업 상태 확인 |
| BUSY / PAYLOAD_TOO_LARGE | 작업 중 또는 제한 초과 안내, 새 요청 자동 생성 없음 |
| OPERATION_ID_REUSED / WORKSPACE_RECOVERY_REQUIRED | 쓰기 중단, 작업 상태·복구 결과 확인 |
| DATABASE_UNAVAILABLE / DATABASE_VERSION_UNSUPPORTED / DATABASE_WRITE_FAILED | 개인 저장 실패 안내, DB 자동 초기화·버전 낮추기 금지 |
| FILE_READ_FAILED / FILE_WRITE_FAILED | 원본·초안 유지, 사용자 확인 후 재시도 |
| NOT_FOUND / INTERNAL_ERROR | 누락 항목 또는 처리 실패 안내, 비밀값 없는 추적 ID 제공 |

참고: [Electron IPC](https://www.electronjs.org/docs/latest/api/ipc-renderer), [IPC 호출자 검증](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages).
