# Phase 2 Retrospective: Persisting Logs as Data Assets (MongoDB)

## 1. 개요 (Overview)

Phase 2의 핵심 목표는 로그를 단순한 텍스트 파일이 아닌 **"쿼리 가능한 데이터 자산"**으로 전환하는 것이었습니다.
이를 위해 인프라 계층을 파일에서 MongoDB로 교체하고, 대규모 로그 데이터를 효율적으로 관리하기 위한 아키텍처적 초석을 다지는 것을 목표로 했습니다.

## 2. 주요 주제 및 해결 과제 (Key Themes & Challenges)

- **저장소 최적화**: 로그 데이터의 특성(시간 순서, 쓰기 위주)에 최적화된 MongoDB Time-series 컬렉션 도입.
- **아키텍처 무결성**: Hexagonal Architecture를 유지하며 비즈니스 로직 수정 없이 인프라 어댑터만 교체.
- **데이터 신뢰성**: 런타임 타입 체크와 검증(`class-validator`)을 통해 저장되는 로그 데이터의 품질 보장.
- **운영 효율성**: TTL(Time-To-Live) 전략을 통한 자동 데이터 수명 주기 관리.
- **비용 및 성능을 고려한 로그 선별**: 모든 로그를 저장하는 비효율을 줄이고, 비즈니스 가치가 높은 로그(Error, Premium 유저 등)를 선별하여 수집하는 전략의 초석 마련.

## 3. 주요 결정 및 근거 (Key Decisions & Rationale)

- **Time-series vs Normal Collection**: 로그 분석 성능과 저장 공간 압축률을 고려해 Time-series 컬렉션 선택.
- **Interface vs Class (Contract-First)**: 단순히 타입만 정의하는 Interface에서 런타임 검증이 가능한 Class로 `WideEvent`를 승격. 이는 로그를 "데이터"이자 후속 분석 엔진과의 **"데이터 규약(Contract)"**으로 취급하겠다는 관점을 반영했습니다.
- **Connection Lifecycle**: 어플리케이션 초기화 단계에서 연결을 완료하고 어댑터들이 이를 구독하는 싱글톤 방식 채택.

## 4. 회고 (Retrospective: KPT)

### Keep (좋았던 점, 유지할 점)

- **어댑터 패턴의 성공**: `FileLogger`에서 `MongoLogger`로 교체할 때 `LoggingService` 코드를 단 한 줄도 수정할 필요가 없었습니다. 관심사 분리(SoC)를 실현했습니다.
- **인프라 자동화**: `mongodb-init.js`를 통해 인덱스, TTL, 유효성 검사 규칙을 코드화하여 환경 구축을 자동화 했습니다.
- **범용성과 특수성의 균형**: 로깅 라이브러리는 공통 에러 규격을, 비즈니스 도메인은 고유 에러 규격을 가지도록 분리하여 유연성을 확보했습니다.

### Problem (어려웠던 점, 개선이 필요한 점)

- **환경 의존적 이슈**: 로컬 Docker 환경의 Replica Set 구성으로 인한 호스트 이름 해석 문제(`ENOTFOUND atlas_local`) 발생. `directConnection=true` 옵션으로 임시 해결했으나, 향후 클러스터 환경에 대한 고려가 필요합니다.
- **성능 트레이드오프**: 매 로그마다 클래스 인스턴스화와 검증이 수행됨에 따라 초고부하 환경에서의 CPU 오버헤드 가능성이 예상됩니다. 이는 향후 비동기 버퍼링 등으로 해결해야 할 과제입니다.

### Try (다음 단계 시도할 점)

- **Phase 3 준비**: MongoDB에 쌓인 로그를 기반으로 RAG(Retrieval-Augmented Generation)를 위한 벡터화 및 태깅 자동화 전략 수립.
- **지능형 샘플링(Tail-based Sampling)**: 에러 로그는 100%, 정상 로그는 1~5% 등 비즈니스 중요도에 따른 정교한 수집 정책 적용.
- **에러 핸들링 고도화**: MongoDB 연결 실패 시 파일 로깅으로 폴백(Fallback)하거나 인메모리에 임시 보관하는 전략 고려.

## 5. 추가 인사이트 (Additional Insights)

- **관심사 분리(System Health vs Business Event)**: NestJS 내장 `Logger`는 시스템 상태(Health)를, 커스텀 `LoggingModule`은 비즈니스 이벤트(Wide Event)를 담당하도록 분리하여 로그의 목적을 명확히 했습니다.
- **Traceability의 중요성**: `requestId`는 구조화된 통계 분석과 비정형 AI 분석을 연결하는 유일한 고리입니다. 이 ID가 전 생명주기 동안 유실되지 않도록 관리하는 것이 아키텍처의 핵심입니다.

---

**결과**: 부하 테스트(2,000건)를 통해 안정적인 데이터 저장 및 인덱싱 성능을 확인했으며, Phase 3로 나아가기 위한 데이터 기반의 토대를 구축했습니다.
