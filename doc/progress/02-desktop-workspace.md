# 02. PC 앱 기반 및 작업 공간

[전체 진행 현황](../progress.md) · [개발 기획](../plan.md)

## 02.01 PC 앱 실행·종료·창 관리

상태: **완료**

- 현재: Electron 개발 실행·Windows 패키징, 중복 실행 제어와 전체 작업 공간의 미저장·실행 중 요청 종료 보호 구현.
- 검증: 개발/패키징 앱 자동 검증에서 화면 로드·격리·중복 실행·종료 취소 및 입력 보존·종료 확인 통과. 네이티브 확인창 선택은 자동 검증에서 대체했으며, 2026-11-20 사용자 직접 정상 동작 확인. 타입 검사·린트·빌드·패키징 통과.
- 검증: 2026-11-22 macOS arm64에서 `desktop:dev` 창 표시·React 화면 로드·Preload 버전 조회·Renderer 격리 확인. macOS 종료 보호·패키징·설치 검증은 포함하지 않음.
- 남은 작업: 재실행 후 초안 복원은 02.07, 설치 프로그램은 11.03에서 진행.

## 02.02 Renderer·Preload·내부 기능 IPC 계약

상태: **진행 중**

- 현재: [IPC 계약](../ipc-contract.md)과 데이터 API 타입 정의. 실제 Preload는 종료 확인·버전 조회만 제공.
- 검증: IPC 보안 테스트 5건과 패키징 앱의 종료·격리·중복 실행 회귀 검증 통과.
- 남은 작업: 파일·개인 데이터 런타임 검증과 서비스 연결·실제 IPC 왕복. HTTP·업로드 계약은 05에서 정의.

## 02.03 IPC 보안과 파일 접근 범위

상태: **진행 중**

- 현재: 호출 창·주 프레임·URL·종료 상태 검증 적용. 파일 접근 경계는 IPC 계약에 정의.
- 검증: 다른 창·iframe·분리된 프레임·유사 URL·잘못된 종료 데이터 거부 테스트 5건 통과.
- 남은 작업: 실제 핸들 관리·파일 접근·junction·경합 검증을 02.04~02.05와 함께 진행.

## 02.04 작업 폴더 생성·열기·전환

상태: **미착수**

## 02.05 파일 저장·오류 복구

상태: **미착수**

## 02.06 외부 파일 변경 감지

상태: **미착수**

## 02.07 SQLite 개인 설정·초안·저장 이력

상태: **진행 중**

- 현재: [개인 저장소 설계안](../personal-storage-design.md)에 따른 DB Worker·v1 스키마·DTO/참조 검증·설정/초안 CAS·이력 조회/보관 구현. WAL 백업·해시/무결성 검증, 사전 백업을 거치는 순차 migration 기반, 원본·후보 보존 복구와 별도 복구 Worker 제공. 미완료 복구 표식은 정상 열기를 차단하고 명시적 원본 복귀만 허용. 배포 스키마는 v1이며 실제 앱 수명 주기·자동 저장·화면 복원·IPC·UI는 미연결.
- 검증: 2026-11-20 개발/Windows ASAR 앱에서 Electron 45.4.1·Node 24.22.3·SQLite 3.54.1 로드, 저장·조회·커밋·롤백·무결성·별도 앱 재실행 후 보존·읽기 전용 쓰기 거부 통과. 타입 검사·린트·빌드·패키징 통과. 명령은 [README](../../frontend-react/README.md#내장-sqlite-호환성-검증) 참조.
- 검증: 2026-11-22 macOS arm64 개발 Electron에서도 같은 런타임 버전으로 `desktop:sqlite-test` 통과. 임시 프로필의 실제 Worker·SQLite에서 저장·조회·WAL·커밋·롤백·무결성·별도 앱 재실행 후 보존·읽기 전용 쓰기 거부 확인. 프로젝트 타입 검사 통과. macOS 패키징·설치본은 미검증.
- 검증: [개인 DB 기반 테스트](../../frontend-react/electron/personal-database.test.mjs)·[개인 데이터 테스트](../../frontend-react/electron/personal-data.test.mjs)·[백업/복구 테스트](../../frontend-react/electron/personal-database-maintenance.test.mjs)·IPC 보안 테스트 통과. DTO/CAS·초안 128 MiB 경계·이력 중복/보관·백업 변조/공간 부족·순차 migration 롤백·복구 네 단계 및 COMMIT 전/후 강제 종료·원본 복귀 확인. 이력 512 MiB 정리는 메타데이터 계산 검사, Windows 파일 점유는 모의 오류 검사이며 migration 상위 버전은 테스트 fixture임. `frontend-react`에서 `npm run desktop:build` 후 `node --test electron/personal-database-maintenance.test.mjs electron/personal-data.test.mjs electron/personal-database.test.mjs electron/ipc-security.test.mjs`로 실행. macOS 실제 Main·Worker에서 저장/재열기·WAL 백업·원본 보존 복구·손상 DB 전용 Worker 복구 확인. 타입 검사·린트 통과. 현재 저장 서비스의 Windows 실행·ASAR 검증은 남아 있음.
- 남은 작업: 앱 수명 주기/IPC/UI·미완료 파일 복구 저널 연결, 현재 공유 snapshot의 API/세트 소유 관계·복구 후보 대조·실제 폴더 접근 격리·파일 저장/삭제 후 개인 데이터 처리·Windows 파일 점유/설치/업데이트 검증. 선택 세트의 파일 저장 문맥과 비밀값 분리/안전한 DTO 생성 계약 연결 전에는 앱 편집값 영구 저장을 활성화하지 않음.

## 02.08 내부 처리 중단·데이터 버전 오류 처리

상태: **미착수**
