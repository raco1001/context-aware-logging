# Phase 1 Retrospective: Context-Aware Logging with Wide Events

## 1. 개요 (Overview)

Phase 1의 핵심 목표는 전통적인 라인 단위 로깅(Line-based Logging)에서 벗어나, 요청 단위의 컨텍스트를 담은 **"Wide Event"** 시스템의 기초를 닦는 것이었습니다.
단순히 "어떤 코드가 실행되었나"가 아니라 "어떤 비즈니스 요청이 어떤 맥락에서 처리되었나"를 하나의 완결된 데이터 구조로 남기는 것에 집중했습니다.

## 2. 주요 주제 및 해결 과제 (Key Themes & Challenges)

- **컨텍스트 유지 (Context Preservation)**: 비동기 작업이 많은 Node.js 환경에서 요청 고유의 ID와 상태를 잃지 않고 전파하기 위해 `AsyncLocalStorage`를 활용한 `ContextService` 구축.
- **단일 진실 공급원 (Single Unit of Truth)**: 하나의 요청당 정확히 하나의 로그(Wide Event)만 남기도록 `LoggingInterceptor`와 `LoggingService`의 `finalize` 로직 설계.
- **풍부한 의미적 데이터 (Semantic Enrichment)**: 미래의 RAG(Retrieval-Augmented Generation) 활용을 고려하여, 단순 에러 코드를 넘어선 서술형 에러 메시지와 `metadata` 필드 도입.
- **의존성 주입 및 안정성**: NestJS 환경에서의 `FileLogger` DI(Dependency Injection) 문제 해결 및 파일 시스템 I/O의 신뢰성 확보.

## 3. 주요 결정 및 근거 (Key Decisions & Rationale)

- **LoggingContext vs WideEvent 분리**:
  - `LoggingContext`: 가변적(Mutable)이며 내부 처리용 필드(예: RAG 요약문)를 포함할 수 있는 어플리케이션 계층의 객체.
  - `WideEvent`: 불변(Immutable)하며 외부 저장소에 기록되는 도메인 규약.
  - 이 분리를 통해 비즈니스 로그의 핵심 스키마를 건드리지 않으면서도 로깅 시스템을 유연하게 확장할 수 있는 구조를 마련했습니다.
- **Hexagonal Architecture 적용**: 로깅의 인터페이스(`Logger`)와 구현체(`FileLogger`)를 철저히 분리하여, 향후 비즈니스 로직 수정 없이 MongoDB 등으로 저장소를 교체할 수 있도록 설계했습니다.
- **PaymentErrorVO 도입**: 에러를 단순히 문자열이 아닌 값 객체(Value Object)로 관리하여, RAG 검색 시 AI가 더 명확한 문맥을 파악할 수 있도록 다양한 실패 시나리오와 서술형 메시지를 구성했습니다.

## 4. 회고 (Retrospective: KPT)

### Keep (좋았던 점, 유지할 점)

- **원칙 중심의 설계**: "One Request -> One Wide Event" 원칙을 준수하기 위해 `finalizedRequestIds` (Set)를 도입하여 중복 로그 발생을 방지한 점.
- **시뮬레이션 중심의 검증**: 실제 DB 없이도 `Payments` 모듈을 통해 다양한 실패 케이스(잔액 부족, 게이트웨이 타임아웃 등)를 시뮬레이션하고, 이를 로그로 완벽히 포착한 점.
- **부하 테스트를 통한 실무 검증**: 2,000건의 요청을 동시에 보내 로그 파일의 무결성과 시스템 안정성을 확인한 프로세스.

### Problem (어려웠던 점, 개선이 필요한 점)

- **DI 런타임 오류**: `FileLogger` 생성자에 주입되는 환경 변수 설정 문제로 인해 NestJS 어플리케이션 시작 시 오류가 발생했습니다. 생성자 파라미터를 정리하고 기본값을 제공하는 방식으로 해결했습니다.
- **파일 I/O 비동기 이슈**: 초기 `FileHandle.write` 사용 시 데이터 유실 가능성이 발견되어, 더 안전하고 직관적인 `fs.appendFile` 방식으로 선회했습니다.
- **E2E 테스트의 민감도**: 비동기 로깅 특성상 파일이 쓰여지는 시점과 테스트가 확인하는 시점 간의 미세한 차이로 인해 테스트가 간헐적으로 실패하는 현상이 있었습니다. 적절한 딜레이와 재시도 로직으로 보강했습니다.

### Try (다음 단계 시도할 점)

- **Phase 2 전환**: 파일 시스템의 한계를 넘어 MongoDB Time-series 컬렉션을 활용한 본격적인 데이터 자산화 진행.
- **데이터 프라이버시 고려**: 로그 내의 민감 정보(개인정보 등)를 마스킹 처리하는 레이어 검토.
- **의미적 요약(Semantic Summary)**: 로그 데이터를 RAG가 더 잘 이해할 수 있도록 `summary` 필드를 자동 생성하는 로직 시도.

## 5. 추가 인사이트 (Additional Insights)

- **로깅은 '운영'의 언어다**: 개발 단계에서는 `console.log`가 편할 수 있지만, 운영 단계에서는 구조화된 `Wide Event`만이 시스템의 문제를 가장 빠르게 설명해 주는 언어가 됩니다.
- **RAG를 위한 빌드업**: AI는 구조화된 필드(JSON)뿐만 아니라 자연어 설명에도 강합니다. 따라서 로그에 담기는 `errorMessage`나 `metadata`의 서술형 텍스트 자체가 앞으로의 검색 성능을 결정짓는 핵심 자산임을 확인했습니다.

---

**결과**: 2,000건의 부하 테스트 결과, 모든 요청이 누락 없이 고유한 `requestId`를 가진 Wide Event로 기록되었으며, 에러 상황에서도 풍부한 맥락(User context, Performance, Metadata)이 보존됨을 확인하며 Phase 1을 성공적으로 마무리했습니다.

