# SQLite 개인 저장소 설계안

작성일: 2026-11-20

관련 기능: 01.08, 02.07~02.08. [개발 기획](plan.md) · [저장 설계](storage-design.md) · [IPC 계약](ipc-contract.md)

이 문서는 사용자 확인을 거친 v1 구현 기준이다. 구현·연결·검증 상태는 [개인 저장소 진행 현황](progress/02-desktop-workspace.md#0207-sqlite-개인-설정초안저장-이력)에서 관리한다.

## 1. 저장 범위와 위치

- 공유 원본은 작업 폴더의 JSON이다. 개인 DB에는 앱 설정·최근 폴더·공간별 UI 상태·미저장 API 초안·저장 이력만 보관한다.
- 위치는 `app.getPath('userData')/personal.sqlite`, 자동 백업은 같은 userData의 `backups/`다. 개발 앱과 패키징 앱의 userData 분리를 유지한다. 아래 경로는 사용자 데이터 위치이며 소스 폴더 추가가 아니다.
- 실제 토큰·비밀번호·선택 파일 내용/경로·File 객체·선택 ID·실행 응답을 저장하지 않는다. 실제 실행 이력은 08.03에서 별도 설계한다.
- 복구 저널과 저장 operationId 상태의 보존은 02.05의 파일 저장 설계에서 정의한다. 개인 이력 테이블로 파일 복구를 대신하지 않는다.
- 개인 설정 UI는 후속 작업이다. 이번 저장소 설계가 UI 구현이나 기존 편집 동작 변경을 뜻하지 않는다.

## 2. DB 소유권과 기본 설정

Main이 한 DB Worker를 소유하며 Worker만 연결·SQL·트랜잭션을 처리한다. Main은 검증한 작업 DTO를 전달하고 Renderer에 SQL·DB 경로·임의 키 접근을 노출하지 않는다.

- 연결은 `DatabaseSync`, 외래 키 활성화, 확장 로드 비활성화. `STRICT` 테이블과 매개변수 바인딩 사용.
- 정상 쓰기 모드에서 `journal_mode=WAL`, `synchronous=FULL`, 잠금 대기 상한 1,000ms를 적용하고 설정 결과를 확인한다. WAL 활성화 전에 기존 DB의 식별·버전을 검사한다.
- Worker 큐는 백업·마이그레이션을 포함해 직렬 처리한다. 비동기 백업 중에도 다음 DB 작업을 시작하지 않는다. 정상 종료는 새 작업 접수 중단→진행 작업 완료→연결 종료 순서다.
- 잠금 실패·쓰기 실패·Worker 종료를 성공으로 대체하지 않는다. UI 메모리 편집을 유지하며 영구 저장 불가 상태를 알린다. Worker에 요청을 보냈다는 이유로 저장 완료 표시를 하지 않는다.
- 외부 프로세스의 DB 직접 수정은 지원하지 않는다. 앱 단일 인스턴스는 DB 트랜잭션과 CAS 검증을 대신하지 않는다.

`DatabaseSync`는 동기 API이므로 창 응답성을 위해 Worker를 사용한다. 잠금 대기 단위와 옵션은 [Node 24 SQLite 문서](https://github.com/nodejs/node/blob/v24.x/doc/api/sqlite.md)를 따른다.

## 3. 식별과 폴더 격리

| 식별자 | 수명·역할 |
| --- | --- |
| `localFolderId` | 이 PC의 검증된 로컬 폴더 연결 UUID. Git 복제본마다 별도 발급 |
| `workspaceId` | 공유 manifest의 UUID. 복제본 사이에 같을 수 있음 |
| `apiId`, `presetId` | 공유 JSON의 안정적인 UUID |
| `editSessionId` | 편집 탭 세션 UUID. 재실행 시 새로 발급하고 이전 세션은 복구 후보로 조회 |
| `handle` | 창·문서 수명 범위의 접근 권한. DB에 영구 저장하지 않음 |

- 공간별 모든 조회·변경은 `(localFolderId, workspaceId)`를 조건으로 한다. Main이 유효한 handle에서 두 값을 얻으며 Renderer가 조립한 DB 키는 받지 않는다.
- 네이티브 선택 경로를 realpath와 OS별 경로 동일성 규칙으로 확인한다. 경로 문자열을 무조건 소문자로 바꿔 동일 폴더로 판단하지 않는다. 구체적인 경로·junction 검증은 02.04에서 구현한다.
- 같은 경로의 manifest ID가 바뀌면 기존 공간의 초안·설정을 새 공간에 적용하지 않는다. 동일 로컬 폴더 아래 별도 workspace 연결로 취급한다.
- 폴더 이동·복제·삭제를 발견해도 자동 재연결하거나 경로를 추측하지 않는다. 다시 선택한 폴더는 원칙적으로 새 연결이며 기존 데이터 재연결은 별도 명시적 기능이 필요하다.
- 최근 목록에서 제거하는 동작과 개인 데이터 삭제를 구분한다. 목록 숨김이나 handle 해제로 초안·이력을 삭제하지 않는다.

## 4. 테이블 구조

아래는 논리 스키마다. v1 DDL은 [개인 DB 스키마](../frontend-react/electron/personal-database-schema.cts), JSON 구조·참조 검증은 [개인 DTO 검증기](../frontend-react/electron/personal-data-validation.cts), DB 저장·조회·보관 처리는 [개인 데이터 저장소](../frontend-react/electron/personal-data-store.cts)에서 관리한다. 날짜는 고정 UTC ISO 8601(밀리초 포함), UUID는 공유 포맷과 같은 소문자 형식이다.

| 테이블 | 키·주요 컬럼 | 관계·제약 |
| --- | --- | --- |
| `schema_migrations` | `version` PK, `applied_at`, `app_version`, `migration_checksum` | 성공한 마이그레이션만 기록 |
| `local_folders` | `local_folder_id` PK, `canonical_path`, `path_key` UNIQUE, `created_at`, `last_opened_at`, `hidden` | 경로는 Main 내부 전용. `hidden`은 0/1 |
| `workspace_links` | `(local_folder_id, workspace_id)` PK, `display_name`, `last_opened_at` | local_folders FK. 공간 이름은 최근 목록용 캐시이며 공유 원본이 아님 |
| `app_preferences` | `singleton_id=1` PK, `revision`, `payload_version`, `json`, `updated_at` | 공간 키 없는 단일 앱 설정 |
| `workspace_preferences` | `(local_folder_id, workspace_id)` PK, `revision`, `payload_version`, `json`, `updated_at` | workspace_links 복합 FK |
| `drafts` | `(local_folder_id, workspace_id, api_id, target_kind, target_id, edit_session_id)` PK, `revision`, `base_revision`, `payload_version`, `json`, `byte_size`, `updated_at` | workspace_links 복합 FK. api 대상의 target_id는 api_id, preset 대상은 preset_id |
| `api_save_history` | `id` PK, 폴더/공간/API ID, `operation_id`, `saved_at`, `preset_id`, `preset_name`, `method`, `url`, `payload_version`, `json`, `byte_size` | workspace_links 복합 FK. `(local_folder_id, workspace_id, operation_id, api_id)` UNIQUE |

- 개인 JSON 컬럼은 JSON 유효성 제약과 허용된 payload version을 확인한다. JSON 내부 스키마와 UUID·해시·문서 관계는 Main/Worker의 작업별 검증으로 추가 확인한다.
- `revision`은 0 이상 JS 안전 정수다. 신규 생성 0, 갱신마다 +1. 상한에 도달하면 쓰기를 거부하며 0으로 되돌리지 않는다.
- 생성은 expectedRevision null과 부재를, 수정·삭제는 revision 일치를 같은 트랜잭션에서 요구한다. 갱신 행 수가 기대와 다르면 `RECORD_CONFLICT`로 반환한다.
- UUID와 시간은 Main/Worker에서 생성한다. 바이트 수는 실제 저장 JSON의 UTF-8 길이로 계산하며 Renderer 값을 신뢰하지 않는다.
- API·세트는 파일 원본이므로 DB의 별도 원본 테이블/FK로 복제하지 않는다. 조회 시 현재 snapshot과 대조해 존재·소유 관계를 검증한다.
- 초안 목록 인덱스는 폴더/공간/API/갱신 시각, 이력 인덱스는 폴더/공간/API/`saved_at DESC, id DESC`를 기준으로 한다. 페이지 커서는 같은 범위의 이력 ID에서 시각·ID를 함께 얻어 비교한다.
- `schema_migrations`와 `PRAGMA user_version`은 일치해야 한다. 앱 버전·공유 formatVersion·개인 payloadVersion은 별도 버전이다.

## 5. 개인 JSON 계약

모든 payload는 `payloadVersion: 1`을 포함하며 알 수 없는 필드와 버전을 거부한다. 테이블의 payload_version과 본문 값이 같아야 한다. 공통 명세·값은 [공유 포맷 v1](storage-design.md)의 정의를 재사용하되 초안에만 필요한 미완성 상태를 별도 검증한다.

### 설정

| scope | v1 허용 필드 | 의미 |
| --- | --- | --- |
| app | `theme: 'system' 또는 'light' 또는 'dark'`, `lastWorkspace: null 또는 {localFolderId, workspaceId}` | 앱 표시 설정·마지막 선택. UI가 임의 경로를 쓰지 못함 |
| workspace | `selectedEnvironmentId: UUID 또는 null`, `openTabs: {apiId, selectedPresetId: UUID 또는 null}[]`, `activeApiId: UUID 또는 null`, `editorViews: {apiId, bodyView: 'fields' 또는 'json'}[]` | 개인 선택·탭 순서·편집 보기. 공유 defaultPresetId와 구분 |

설정은 선택 필드를 생략하면 기존 UI의 기본값으로 읽는다. 전체 설정 record를 CAS로 교체하며 알 수 없는 키를 저장소처럼 사용하지 않는다. 재열기 시 사라진 API·환경·세트 참조는 화면에서 제외하거나 공유 기본값으로 안내하며 공유 파일을 수정하지 않는다.

### 초안

| target | v1 본문 |
| --- | --- |
| api | `common: {method, url, request, response, documentation}`. request는 공통 필드 명세·Body 형식/구조, response·documentation은 공유 API의 같은 구조 |
| preset | `values`는 해당 세트의 Path·Query·Headers·Body·Multipart 편집값/사용 여부, `rawBodyText: 문자열 또는 null`, `bodyView: 'fields' 또는 'json'` |

- 초안은 빈 키·잘못된 숫자·미완성 JSON 등 편집 중 상태를 허용하되 자료형·필드 ID·부모 관계·크기와 안전한 직렬화 경계를 검사한다. 초안 저장이 공유 문서 검증 통과를 뜻하지 않는다.
- API/세트 이름·컬렉션 위치 변경 대화상자와 환경 편집 폼의 초안은 이 v1 target에 포함하지 않는다. 해당 기능 영구 초안이 필요하면 별도 DTO·IPC·복원 흐름을 정의한다. 현재 메모리 편집과 종료 보호는 유지한다.
- `baseRevision`은 편집 기준의 공간 snapshot revision이다. 기준이 달라지면 복구 후보를 자동 적용하지 않고 원본 확인·수동 조정을 제공한다.
- api와 preset 초안은 세션별 독립 record다. 자동 저장은 짧은 지연 후 각 record의 확인된 복사본을 저장하며 세션 간 병합하지 않는다. 두 record를 동시에 조회했다고 일괄 원자적 저장이 된 것으로 취급하지 않는다.
- 파일 저장 성공 후에도 저장한 복사본과 같은 revision의 초안만 제거한다. 저장 중 추가 편집이나 다른 세션 초안은 남긴다. DB 후처리 실패 시 공유 파일 저장을 반복하지 않는다.

### 저장 이력

v1 본문은 `{payloadVersion, common, selectedPreset: {id, name, values}}`다. common은 API 초안과 같은 명세·문서 구조지만 성공한 공유 파일 검증을 통과한 저장 복사본을 사용한다. 요약과 JSON의 메서드·URL·세트 식별이 일치해야 한다.

- API 전체 파일이나 SampleRequest를 그대로 저장하지 않는다. 다른 세트의 값·API 이름·위치·실행 결과·선택 파일은 복원 데이터에 포함하지 않는다.
- 파일 저장 작업이 성공한 뒤 Main이 실제 저장 복사본과 선택 세트로 추가한다. 신규 저장 흐름에는 선택 세트를 내부 저장 문맥으로 전달하는 계약이 필요하며, 현재 WorkspaceCommit에는 해당 정보가 없으므로 02.05 연동 전에 구체화한다. 임의 이력 추가 API를 열지 않는다.
- 같은 operationId/API 재처리는 UNIQUE 키로 중복을 막고 기존 payload와 일치하는지 확인한다. 다른 내용이면 충돌로 처리한다. 파일 작업 상태는 별도 저널을 기준으로 한다.
- 복원 시 common과 values를 현재 폼·현재 선택 세트에 적용한다. 저장 당시 preset ID로 현재 선택을 바꾸지 않으며 API ID·이름·위치·다른 세트·실행 결과는 유지한다.
- 동일한 시각의 이력은 UUID 내림차순으로 안정 정렬한다. 시스템 시계 역행까지 실제 생성 순서로 보장한다고 표시하지 않는다.

### 비밀값과 파일 제외

- 비밀값 실제값은 메모리 저장소에 두며 영구 DTO에는 `secretRef` 또는 명시적 미입력 상태만 사용한다. `***`를 실제 복원값으로 사용하지 않는다.
- Main은 허용 필드로 영구 DTO를 새로 구성하고 검증한다. 문자열 검색만으로 비밀값 제거를 보장하지 않는다. 입력값의 비밀 구분·주입 계약(04.04)이 연결되기 전에는 안전성이 확인되지 않은 값 영구 저장을 활성화하지 않는다.
- [개인 데이터 내부 계약](../frontend-react/electron/personal-data-contract.cts)은 Main 서비스 전용이다. `rememberWorkspace` 호출 전에는 경로·manifest를 확인하고, 저장 호출 전에는 현재 snapshot의 API·세트 소유 관계와 안전한 DTO 구성을 확인한다. preset 초안의 `commonJson`은 현재 API의 필드·파일 행 참조 검사용이며 DB에 함께 저장하지 않는다. 복구 후보 조회는 이전 명세의 편집값을 보존하므로 현재 화면에 적용하기 전에 다시 대조한다.
- 특히 rawBodyText·문서 예시·URL은 실제 비밀값이 섞일 수 있다. 비밀 필드가 포함되거나 분리 여부를 확인할 수 없는 JSON 원문은 저장하지 않고 재입력 필요 상태로 안내한다. 안전한 구조화 값만 저장하며 원문을 몰래 마스킹해 복구했다고 표시하지 않는다.
- Multipart 파일 행은 활성 상태와 명세만 보관하고 복원 후 재선택을 요구한다. 오류·로그·백업·내보내기에도 같은 제외 규칙을 적용한다.

## 6. 보관·크기 정책

아래 값은 v1 기본값이다. 크기는 UTF-8 기준이며 1 MiB = 1,048,576바이트다.

| 대상 | 기본 기준 | 초과·정리 동작 |
| --- | --- | --- |
| 앱/공간 설정 | record당 256 KiB, 열린 탭 최대 200개 | 초과 저장 거부, 기존 record 유지 |
| 초안 | record당 8 MiB, 전체 초안 JSON 합계 128 MiB | 기간 만료로 자동 삭제하지 않음. 상한 초과 시 새 쓰기 거부·정리 안내, 메모리 편집 유지 |
| 저장 이력 | 건당 8 MiB, API당 최신 100건·최대 90일, 전체 이력 JSON 512 MiB | 기간/개수 초과와 전역 용량 초과 시 가장 오래된 이력부터 정리. 초안은 정리 대상 아님 |
| 목록 조회 | 이력 기본 20건·최대 100건 | 복원 JSON은 상세 조회에서만 반환 |
| 최근 폴더 표시 | 최근 20개 | 초과 연결은 목록에서 숨기며 개인 데이터는 삭제하지 않음 |
| 마이그레이션 자동 백업 | 검증 완료된 최근 3개 | 새 마이그레이션 성공·검증 후 오래된 자동 백업만 정리. 실패·수동 백업은 자동 삭제하지 않음 |

- 이력 추가와 해당 보관 정리는 하나의 DB 트랜잭션으로 처리한다. 새 이력이 상한을 충족하지 못하면 전체 롤백하고 파일 성공/이력 실패를 구분한다.
- 주기 정리는 시작 시와 이력 추가 시 직렬 실행한다. 최근 시계 기준이 역행했다면 기간 정리를 보류하고 개수·용량 기준만 적용한다.
- 논리 JSON 합계 상한은 실제 SQLite 파일 크기 상한이 아니다. 인덱스·여유 페이지·WAL·백업은 별도 공간을 사용한다. 삭제 직후 파일 크기가 줄어든다고 표시하지 않으며 매 저장마다 VACUUM하지 않는다.
- 앱에서 API 삭제가 파일에 성공한 경우 해당 개인 이력·초안을 정리한다. DB 정리 실패는 별도 안내한다. 외부 Git 삭제·폴더 접근 실패만으로 개인 복구 데이터를 자동 삭제하지 않는다.
- 초안 폐기는 대상·편집 세션·기대 revision을 확인한다. 폴더 전체 개인 데이터 삭제·전체 초기화·내보내기는 개인 설정 UI 및 명시적 확인 흐름 연결 후 제공하며 이번 설계로 임의 삭제 API를 추가하지 않는다.

## 7. DB 생성·버전 변경

버전은 `PRAGMA user_version=1`, 앱 식별은 `application_id=0x41504443`(APDC)를 사용한다. 외부 등록 고유 번호라는 의미는 아니다. SQLite의 user_version은 앱 관리용 값이며 schema_version을 직접 변경하지 않는다. [SQLite PRAGMA 문서](https://sqlite.org/pragma.html#pragma_user_version) 참조.

### 초기 생성과 열기

1. 파일이 없을 때만 새 DB를 생성한다. 테이블·인덱스·초기 migration 기록·user_version·application_id를 한 트랜잭션으로 구성한다.
2. 기존 파일은 먼저 읽기 전용으로 열어 앱 식별·버전·migration 기록과 기본 무결성을 확인한다. 식별 불일치·알 수 없는 비어 있지 않은 version 0 DB·불일치 기록을 신규 DB로 초기화하지 않는다.
3. 지원 버전이면 정상 연결로 전환하고 같은 식별·버전인지 재확인한 뒤 외래 키·WAL 설정을 확인한다. 상위 DB/payload 버전은 `DATABASE_VERSION_UNSUPPORTED`로 개인 데이터 쓰기를 차단한다. 이전 앱이 모르는 테이블/값을 덮어쓰지 않는다.

### 업그레이드

1. 개인 데이터 API 접수를 막고 큐·트랜잭션 종료를 기다린다. 미완료 파일 복구 저널이 있다면 먼저 복구 판단을 마치며 DB 변경과 혼합하지 않는다.
2. 업그레이드 전 원본의 독립 백업을 만들고 검증한다. 백업 실패·공간 부족이면 업그레이드를 시작하지 않는다.
3. 지원하는 순차 migration을 하나의 트랜잭션에서 실행한다. 변경 SQL·데이터 변환·payload version·migration 기록·user_version을 함께 갱신한다. 트랜잭션 안에서 실행할 수 없는 작업은 migration에 섞지 않는다.
4. COMMIT 전에 `integrity_check`, `foreign_key_check`, 필수 테이블/인덱스·JSON 버전·대표 관계를 확인한다. 실패하면 ROLLBACK 후 접수를 재개하지 않고 복구를 안내한다.
5. COMMIT 후 같은 검사를 다시 확인하고 정상 API를 연다. 이후 검증 실패나 크래시 시 DB/백업을 보존한다. 백업으로 자동 교체해 최신 데이터를 조용히 잃지 않는다.

프로세스 중단 후에는 SQLite의 저널 복구 결과와 버전을 재검사한다. 버전 숫자만 올리거나 일부 migration을 성공 처리하지 않는다. 자동 버전 낮추기·빈 DB로 재생성은 금지한다.

## 8. 백업·내보내기·복구

- 백업은 Worker 큐를 정지한 상태에서 내장 `sqlite.backup()`으로 새 임시 목적지에 생성한다. 성공 후 읽기 전용 연결에서 무결성·외래 키·앱 식별·버전을 검증하고 최종 백업 이름으로 확정한다. 기존 백업을 덮어쓰지 않는다.
- WAL 사용 중인 DB의 `personal.sqlite` 하나만 파일 복사하지 않는다. Node backup API와 SQLite Online Backup을 사용하며, 실제 Electron에서의 백업·실패 동작은 구현 시 별도 검증한다. [Node backup API](https://github.com/nodejs/node/blob/v24.x/doc/api/sqlite.md#sqlitebackupsourceDb-path-options), [SQLite 백업](https://sqlite.org/backup.html) 참조.
- 이름은 Main이 UTC 시각·DB 버전·UUID로 생성하고 별도 메타데이터에 앱 버전·SHA-256·생성 목적을 기록한다. 백업 파일도 개인 데이터이며 암호화 저장소로 취급하지 않는다.
- 자동 백업은 마이그레이션 전 실행한다. 정기 주기 백업은 이번 v1 범위에서 약속하지 않는다. 수동 내보내기는 검증된 독립 SQLite 백업과 메타데이터를 사용자 선택 위치에 생성한다.
- 복구는 사용자 선택·현재 편집 처리 확인 후 앱의 개인 저장소 접수를 중지하고 후보를 읽기 전용으로 검사한다. 상위 버전·손상·변조/해시 불일치는 거부한다. 검증한 임시 사본과 현재 DB를 보존하고 모든 연결을 닫은 상태에서 교체한다.
- 기존 DB와 WAL/SHM은 한 묶음으로 보존한다. 열린 연결이나 남은 sidecar에 새 DB만 덮어쓰지 않는다. Windows 파일 점유와 교체 중단 시 원본/후보를 남기는 단계별 복구 절차는 구현 전 테스트로 구체화한다.
- 복구한 recent 경로와 ID는 접근 권한이 아니다. 다른 PC에서 가져온 폴더 연결은 자동 사용하지 않고 네이티브 재선택·manifest 확인 후 재연결한다. 외부 백업이 임의 경로 접근의 근거가 되어서는 안 된다.
- 전체 초기화 전에는 사용자 확인과 사전 백업을 요구한다. 작업 폴더의 공유 JSON은 삭제하지 않는다. 소프트웨어 삭제는 이전 백업과 디스크의 물리적 안전 삭제를 보장하지 않는다.

## 9. 오류와 구현 검증 기준

IPC 오류 코드는 기존 계약을 유지한다. 큰 JSON은 `PAYLOAD_TOO_LARGE`, CAS 불일치는 `RECORD_CONFLICT`, 미지원 버전은 `DATABASE_VERSION_UNSUPPORTED`, DB 열기/읽기 실패는 `DATABASE_UNAVAILABLE`, 쓰기/정리 실패는 `DATABASE_WRITE_FAILED`로 구분한다. SQL·경로·본문 값을 오류에 넣지 않는다.

구현 후 다음을 실제 개발/Windows 패키징 앱에서 검증한다.

- 신규 생성·재실행·FK/CAS·동일 workspace ID의 복제본·같은 경로의 다른 manifest·다른 세션의 초안 격리.
- 미완성 편집·JSON 원문·0/false/빈 값, 비밀 참조·파일 재선택, 누락/삭제된 API와 세트의 복구 후보 처리.
- 저장 중 후속 편집 보존, 파일 성공/이력 실패, operationId 중복 방지와 이력 페이지 경계.
- 보관 정책의 기간·개수·바이트 경계, 시계 역행·용량 부족에서 초안 보존.
- migration 성공·단계별 실패/강제 종료·상위 버전 거부, WAL 상태의 백업·검증·사용자 복구와 Windows 파일 점유.

UI 연동 전에 개인 DTO의 런타임 스키마·입력 크기 한도·비밀값 분리 계약을 구현한다. 설계안 작성이나 기존 임시 SQLite 호환성 검증만으로 02.07을 완료로 표시하지 않는다.
