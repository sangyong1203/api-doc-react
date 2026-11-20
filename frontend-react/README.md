# API Doc — React

REST API를 등록·호출·문서화·테스트하고, API별 여러 payload 세트를 재사용하는 도구입니다. Electron Windows 앱과 브라우저 개발 화면에서 같은 React UI를 사용합니다. 현재 데이터와 요청 실행은 메모리·샘플 기반이며 실제 파일 저장·개인 DB·API 실행은 후속 구현입니다.

개발 범위·순서·완료 기준은 [개발 기획](../doc/plan.md), 구현 상태·상세 진행 내용·검증 결과는 [개발 진행 현황](../doc/progress.md)에서 관리합니다. 작업 시 [프로젝트 규칙](../AGENTS.md)을 함께 확인합니다.

## 설치 및 실행

개발 기준은 Node.js `24.22.3`, npm `11.19.1`입니다. `.nvmrc`는 Node 버전을 고정하며 `engines.node`는 `>=24.22.3 <25`로 24 계열을 사용합니다. 저장된 패키지 버전은 `package.json`과 `package-lock.json`으로 관리합니다.

프로젝트 루트에서 실행합니다.

```powershell
cd frontend-react
npm ci
npm run dev
```

터미널에 표시된 로컬 주소로 접속합니다. 기본 주소는 `http://127.0.0.1:5173`이며 사용 중이면 다음 포트를 사용합니다.

Windows PowerShell에서 실행 정책 때문에 `npm`이 차단되면 `npm.cmd`를 사용합니다. 의존성을 재설치하기 전에는 해당 프로젝트의 개발 서버를 종료해 네이티브 모듈 파일 점유를 해제합니다.

| 명령어 | 동작 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run type-check` | React·Vite 설정·Electron의 TypeScript 검사 |
| `npm run lint` | ESLint 검사 |
| `npm run build` | 타입 검사 후 `dist/`에 배포 파일 생성 |
| `npm run preview` | 빌드 결과를 로컬에서 확인 |
| `npm run desktop:dev` | Electron 코드 컴파일 후 Vite와 PC 앱 함께 실행 |
| `npm run desktop:build` | Main·Preload를 `dist-electron/`에 컴파일 |
| `npm run desktop:package` | 전체 빌드 후 Windows x64 실행 폴더 생성 |

린트는 타사 배포 파일 `src/lib/xlsx/XLSX.min.js` 한 파일을 제외하며, 직접 작성한 Excel 모듈과 나머지 프로젝트 코드는 검사합니다.

경로 별칭 `@/`는 `src/`를 가리킵니다. `components.json`에는 shadcn/ui 경로와 스타일 설정을 관리합니다.

## PC 앱 실행과 패키징

`frontend-react`에서 `npm.cmd run desktop:dev`로 실행합니다. 개발용 Vite는 `127.0.0.1:5176`부터 빈 포트를 사용하고, 앱 종료 시 함께 정리합니다. React 변경은 HMR로 반영하며 Main·Preload를 수정한 경우 개발 명령을 다시 실행합니다.

`npm.cmd run desktop:package` 결과는 `out/APIDOC-win32-x64/APIDOC.exe`입니다. 이 폴더 전체가 있어야 실행할 수 있습니다. 설치 프로그램·서명·자동 업데이트는 후속 범위입니다. 배포본은 내장 화면을 `apidoc://app/`에서 로드하며 Vite 서버나 사용자 Node 설치가 필요하지 않습니다.

개발용 개인 데이터 경로는 `%APPDATA%/APIDOC Development`, 패키징 앱은 Electron의 `userData` 경로를 사용합니다. 현재는 DB·초안 영구 저장을 연결하지 않았습니다. 앱을 다시 실행하면 샘플 상태로 시작합니다.

같은 프로필의 앱을 중복 실행하면 기존 창을 활성화합니다. 종료 시 숨겨진 공간의 API 편집·열린 폼의 미저장 내용·실행 중인 요청을 확인합니다. 취소가 기본 선택이며 취소하면 편집을 유지합니다. 브라우저 개발 화면에서도 새로고침·창 닫기 전에 미저장 상태를 확인합니다.

### PC 앱 자동 검증

전용 테스트 앱을 아래처럼 실행한 뒤 다른 PowerShell에서 검증합니다. 검증은 샘플 값을 수정하고 마지막에 앱을 종료하므로 실제 작업에 사용하는 앱과 함께 실행하지 않습니다.

```powershell
# frontend-react에서 패키징 후 실행
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\out\APIDOC-win32-x64\APIDOC.exe --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1 --inspect=127.0.0.1:9334

# 다른 PowerShell의 frontend-react에서 실행
node electron/smoke.mjs
```

앱 화면·내장 버전·Renderer 권한 격리·CSP·미저장 종료 취소/확인·숨겨진 작업 공간·편집 폼·중복 실행을 확인합니다. 네이티브 확인창의 선택 응답만 테스트에서 대체하며 실제 Windows 확인창의 표시·포커스·Escape 동작은 별도 화면 검증 대상입니다. 테스트용 디버거 옵션은 일상 실행 명령에는 사용하지 않습니다.

## PC 앱과 저장 방향

- 기존 React UI를 Electron 독립 창에 연결하고 파일·네트워크·DB 처리는 제한된 Preload/IPC를 통해 앱 내부에서 수행합니다.
- API 명세·문서·입력 세트·공유 환경은 작업 폴더의 JSON 파일에 저장하여 외부 Git 도구로 공유합니다.
- 개인 설정·최근 작업 공간·초안·저장 이력은 앱 사용자 데이터 폴더의 SQLite에 내장 `node:sqlite`로 보관합니다. 인증 비밀값과 업로드 파일 실체는 기본 메모리로 관리합니다.
- 개발 환경은 위 Node 24 버전을 사용합니다. Electron 내장 Node는 개발 PC의 Node와 별개이며, 앱에서 사용하는 Node API는 선택한 Electron 안정판에서 검증합니다.
- Electron/SQLite 설치본 검증·DB 마이그레이션·백업·이력 보관 정책은 후속 작업입니다. 상세 기준은 [PC 앱 설계](../doc/desktop-design.md)와 [저장 설계](../doc/storage-design.md)를 따릅니다.

## 저장 포맷 검증

`frontend-react`에서 `npm ci`로 기존 개발 의존성을 설치한 뒤, **프로젝트 루트**에서 실행합니다.

```powershell
node doc/validate-storage.mjs
```

현재 위치가 `frontend-react`라면 `node ../doc/validate-storage.mjs`로 실행할 수 있습니다.

[v1 JSON 스키마](../doc/storage-v1.schema.json)와 [샘플](../doc/storage-v1.samples.json)을 사용해 필수 항목·타입, 파일명·ID·참조 관계, 중첩 필드 구조, 모든 입력 세트의 리터럴 값을 확인합니다. 정상 7건과 오류 검출 48건이 기대한 결과를 만족하면 `Storage v1: 55 samples passed (7 valid, 48 invalid)`를 출력하며, 검증 실패 시 종료 코드는 0이 아닙니다.

검증 도구는 입력 데이터를 수정하거나 실제 작업 폴더에 파일을 쓰지 않습니다. 실제 저장·복구·React 모델 변환·변수 주입·HTTP 실행 검증은 별도 단계입니다. 상세 규칙과 검증 범위는 [저장 설계](../doc/storage-design.md)를 확인합니다.

## shadcn 스타일 리셋

`frontend-react` 폴더에서 다음 명령을 실행합니다. 현재 프리셋은 `b1sAmVzcG`이며 Radix 기반의 `radix-nova` 스타일을 사용합니다.

```powershell
npx shadcn@latest init --preset b1sAmVzcG --base radix --template vite --pointer --force --reinstall
```

- `--preset`: 적용할 프리셋 ID. 다른 스타일로 바꾸려면 이 값을 변경합니다.
- `--base radix --template vite`: 현재 프로젝트의 UI 기반과 프레임워크를 지정합니다.
- `--pointer`: 버튼에 포인터 커서를 적용합니다.
- `--force`: 기존 shadcn 설정을 덮어씁니다.
- `--reinstall`: 이미 추가한 공통 UI 컴포넌트를 새 프리셋으로 재생성합니다.

테마와 폰트도 해당 프리셋으로 맞추려면 이어서 실행합니다.

```powershell
npx shadcn@latest apply b1sAmVzcG --only theme,font --yes
```

리셋 후 `npm run lint`와 `npm run build`로 확인합니다. 생성된 컴포넌트의 미사용 variant export가 `react-refresh/only-export-components` 규칙에 걸리면 해당 export만 정리합니다. 작업 화면의 구조 CSS와 기본 다크 모드 설정은 별도로 유지됩니다.

## 폴더 구조

기능 중심 구조를 사용합니다. 아래 트리는 역할과 배치 기준이며, 파일과 폴더는 해당 작업이 필요할 때 생성합니다.

```text
frontend-react/
├── README.md
├── electron/                       # 앱 수명 주기·제한된 연결·실행 검증
│   ├── main.cts                    # 창·종료·메뉴·내장 UI 프로토콜
│   ├── preload.cts                 # 종료 상태 확인용 contextBridge
│   ├── dev.mjs                     # Vite와 개발 앱 실행·정리
│   └── smoke.mjs                   # 패키징 앱 통합 검증
├── forge.config.cjs                # Windows 실행 폴더 패키징
├── tsconfig.electron.json          # Main·Preload 타입 검사·컴파일
├── public/                         # 경로 그대로 제공할 정적 파일
└── src/
    ├── main.tsx                    # React 마운트와 전역 스타일 진입점
    ├── app/
    │   ├── App.tsx                 # 앱 전체 조합
    │   ├── router.tsx              # 라우터 도입 시 경로와 화면 연결
    │   └── providers.tsx           # 앱 공통 Provider 구성
    ├── pages/
    │   └── workspace/
    │       └── WorkspacePage.tsx   # 트리·탭·편집·결과 영역 조합
    ├── features/
    │   ├── workspace/              # 작업 폴더·열린 탭·저장 및 외부 변경
    │   ├── collections/            # 컬렉션·폴더·API 목록 관리
    │   ├── api-editor/             # URL·params·headers·body 편집
    │   ├── request-runner/         # 실행·취소·응답 결과 표시
    │   ├── environments/           # 환경·변수·대상 API 인증 설정
    │   ├── payload-presets/        # API별 입력 세트 관리
    │   ├── documentation/          # 명세·예시·문서 미리보기
    │   ├── api-tests/              # 검증 규칙·컬렉션 및 세트 실행
    │   ├── history/                # 개인 실행 이력
    │   ├── mock-data/              # 데이터 생성·미리보기·대량 등록·초기화
    │   └── settings/               # 개인 UI 설정
    ├── components/
    │   ├── ui/                     # shadcn/ui 기본 컴포넌트
    │   └── layout/                 # 여러 화면에서 재사용하는 레이아웃
    ├── lib/
    │   ├── storage/                # 개인 저장 관련 IPC 호출과 결과 처리
    │   └── utils.ts                # shadcn/ui 클래스 조합 등 공통 기반
    ├── hooks/                      # 여러 기능에서 재사용하는 React 로직
    ├── stores/                     # 여러 기능에서 공유하는 상태
    ├── types/                      # 기능 사이에서 공유하는 도메인 타입
    ├── utils/                      # 특정 기능에 속하지 않는 순수 함수
    └── styles/
        └── globals.css            # 전역 스타일·디자인 토큰·테마
```

### 기능 폴더 내부

예를 들어 API 편집 기능은 다음처럼 구성할 수 있습니다. 모든 기능에 같은 하위 폴더를 일괄 생성하지 않습니다.

```text
features/api-editor/
├── components/
│   ├── RequestEditor.tsx
│   └── ApiEditDialog.tsx
├── services/
│   └── apiDocumentService.ts
├── fixtures/
│   └── sampleRequests.ts
├── types.ts
└── utils.ts
```

- `components/`: 기능의 UI와 필드 상호작용.
- `services/`: 해당 기능의 저장·실행 요청과 결과 처리.
- `fixtures/`: UI 확인용 샘플 데이터.
- `types.ts`, `constants.ts`, `utils.ts`: 기능 내부의 타입·상수·순수 변환.
- `hooks/`, `store/`, `schemas/`: 재사용 로직·공유 상태·검증 정의가 실제로 필요할 때 추가.
- 테스트 파일은 검증 대상 가까이에 `*.test.ts` 또는 `*.test.tsx`로 배치.

## 코드 배치와 의존 관계

| 위치 | 책임 |
| --- | --- |
| `app/` | 앱 초기화·Provider·라우팅 조합 |
| `pages/` | 기능 모듈을 조합하는 화면과 화면 전용 배치 |
| `features/` | 기능별 UI·상태·서비스·변환 로직 |
| `components/` | 여러 기능에서 재사용하는 UI |
| `lib/` | 공통 IPC 호출 등 외부 기능 연결과 라이브러리 설정. 파일·SQL 직접 접근은 앱 내부 계층 담당 |
| `types/`, `utils/` | 여러 기능이 공통으로 쓰는 도메인 정의·순수 함수 |

- 기본 의존 방향은 `app/pages → features → 공통 코드`입니다. 공통 UI와 기반 코드는 특정 기능이나 페이지를 가져오지 않습니다.
- 기능 사이의 조합은 페이지에서 수행하고, 반복되는 도메인 타입과 동작은 실제 재사용 필요를 확인한 뒤 공통 위치로 옮깁니다.
- 외부 기능 내부의 컴포넌트·스토어를 직접 연결하여 순환 의존을 만들지 않습니다. 필요한 입력과 콜백을 명시합니다.
- 같은 경로의 역할을 중복하는 `common`, `helpers`, `modules` 폴더를 추가하기보다 위 책임에 맞춰 배치합니다.
- 파일이 적을 때는 `types.ts`, `utils.ts`처럼 단순하게 시작하고, 책임이 커졌을 때 분리합니다.

## 컴포넌트와 UI 규칙

- API 편집기·응답 뷰어·테이블 등 업무 의미가 있는 UI는 기능별 `components/`에 배치합니다.
- `components/ui/`는 기본 UI를, 기능별 `components/`는 업무 동작을 담당합니다. 한 기능에서만 쓰는 컴포넌트는 그 기능 가까이에 둡니다.
- 페이지는 화면 배치와 기능 조합에 집중하고, 복잡한 폼과 등록·수정·설정 다이얼로그는 의미 있는 컴포넌트로 분리합니다.
- 색상·간격·테마는 `styles/globals.css`의 디자인 토큰과 공통 스타일을 사용합니다.
- 입력·아이콘 버튼에 접근 가능한 이름을 제공하고, 다이얼로그 포커스와 키보드 조작을 확인합니다.
- 로딩·빈 데이터·오류·미저장 상태를 구분합니다.
- 화면의 날짜·시간은 `src/utils/dateTime.ts`의 `formatDateTime`을 사용해 로컬 시간 기준 `YYYY-MM-DD HH:mm:ss`로 표시합니다. 저장·통신에는 ISO 원문을 유지합니다.

### 공통 보기 탭

`src/components/ViewTabs.tsx`는 shadcn/ui Tabs를 조합한 공통 보기 탭입니다. `variant="line"`은 기본 foreground 색상의 밑줄형, `variant="button"`은 primary 배경의 버튼형입니다. 본문 편집 방식은 버튼형, 요청·응답 결과 보기는 밑줄형을 사용합니다.

- `items`: 각 탭의 고유 `value`와 표시할 `label` 목록.
- `label`: 탭 목록의 접근 가능한 이름.
- `value`·`onValueChange`: 변환 검증 등 선택을 직접 제어할 때 사용. 단순 초기 선택은 `defaultValue`로 지정.
- `toolbar`: 탭 오른쪽에 배치할 선택창·작업 버튼.
- `children`: 같은 `value`를 가진 공통 `TabsContent`로 본문 구성.

## 상태와 데이터 처리 규칙

- 컴포넌트 내부 상태는 `useState` 또는 `useReducer`로 관리하고, 여러 컴포넌트가 함께 쓰는 경우 가장 가까운 공통 부모로 올립니다.
- 전역 상태는 여러 기능에서 공유할 필요가 있는 경우에 사용합니다. 계산 가능한 값이나 동일 데이터를 여러 스토어에 중복 보관하지 않습니다.
- 입력 이벤트로 상태를 갱신하고, `useEffect`는 외부 시스템 구독·동기화·해제 등 필요한 동작에 사용합니다. 화면에 표시할 파생값은 가능한 한 렌더링에서 계산합니다.
- 사용자 입력 원본과 실행용으로 변환한 요청을 구분합니다. 환경 치환이나 실행 중 변경이 저장된 API·payload 세트를 의도치 않게 수정하지 않도록 합니다.
- 서비스는 결과를 반환하고, 화면 상태 갱신은 컴포넌트나 상태 관리 코드에서 처리합니다. mutable 서비스 객체의 속성 변경에 화면 갱신을 의존하지 않습니다.
- 타입은 함수·props·서비스 경계에서 명확하게 정의합니다. 외부의 미검증 데이터는 `unknown`으로 받고 확인한 뒤 사용합니다.
- API 실행 상태는 요청별로 관리하고, 타임아웃·취소·통신 오류와 실제 HTTP 응답을 구분합니다.

## 명명 규칙

| 대상 | 규칙 | 예시 |
| --- | --- | --- |
| 폴더 | 소문자 kebab-case | `api-editor`, `payload-presets` |
| 직접 작성한 React 컴포넌트 파일 | PascalCase.tsx | `RequestEditor.tsx` |
| Hook | useCamelCase.ts | `useRequestExecution.ts` |
| 서비스·유틸 파일 | camelCase.ts | `apiDocumentService.ts` |
| 타입 | PascalCase | `ApiDefinition`, `PayloadPreset` |
| 변수·함수·props | camelCase | `selectedApiId`, `runRequest` |
| 상수 | UPPER_SNAKE_CASE | `HTTP_METHODS` |
| shadcn/ui가 추가하는 파일 | 생성 규칙 유지 | `button.tsx`, `dialog.tsx` |

## 공식 참고 문서

- [React 상태 구조](https://react.dev/learn/choosing-the-state-structure): 상태 중복과 파생값 관리 기준.
- [Vite 가이드](https://vite.dev/guide/): 개발 환경과 정적 파일 빌드.
- [shadcn/ui Vite 구성](https://ui.shadcn.com/docs/installation/vite): UI 초기 설정과 경로 구성.
