# Phase 5 회고: Production Hardening - Infrastructure & Resilience

## 1. 개요 (Overview)

Phase 5의 핵심 목표는 **"Production Hardening"**으로, 시스템의 안정성, 확장성, 그리고 비용 효율성을 실무 수준으로 끌어올리는 것이었습니다. Phase 4까지 구축된 지능형 로그 분석 기능을 실제 대규모 트래픽 환경에서도 안전하고 저비용으로 운영할 수 있도록 인프라 구조를 혁신하는 데 집중했습니다.

주요 성과:

- **Asynchronous Pipeline**: 로깅 부하가 애플리케이션 성능에 영향을 주지 않도록 비동기 파이프라인 구축
- **Distributed Scalability**: 인메모리 상태 관리에서 Redis 기반 분산 캐시 구조로 전환
- **Cost Optimization**: Tail-Aware Sampling을 통한 로그 저장 비용의 80% 이상 절감 (가치 있는 데이터 100% 보존)
- **Operational Excellence**: 장애 내성(Graceful Fallback) 및 동적 인프라 구성을 통한 운영 편의성 확보

---

## 2. 주요 주제 및 해결 과제 (Key Themes & Challenges)

### 2.1 로깅 오버헤드와 애플리케이션 성능의 결합 (Decoupling)

**문제점:**

- 기존 `LoggingService`는 MongoDB에 직접 로그를 쓰기 때문에, DB 지연이 발생하면 API 응답 속도가 함께 느려지는 구조였습니다.
- 특히 임베딩 생성 및 벡터 검색과 결합될 경우 지연 시간이 누적되어 사용자 경험을 해칠 우려가 있었습니다.

**해결 방향:**

- **Asynchronous Logging Pipeline**: MQ(Kafka/Redis Streams)를 도입하여 로깅 로직을 비동기화했습니다.
- `LoggingService`는 MQ에 메시지를 발행(Publish)만 하고 즉시 응답하며, 실제 DB 저장은 백그라운드 컨슈머가 담당하게 했습니다.

### 2.2 단일 인스턴스 한계와 상태 공유 (Distributed State)

**문제점:**

- 세션 히스토리의 캐시가 서버의 인메모리(`Map`)에 저장되어 있어, 서버가 여러 대인 분산 환경에서는 데이터가 공유되지 않는 문제가 있었습니다.
- 서버 재시작 시 모든 캐시 데이터가 유실되는 문제도 존재했습니다.

**해결 방향:**

- **Redis Integration**: 모든 캐시 레이어를 Redis 기반의 분산 저장소로 전환했습니다.
- **Port/Adapter 패턴**: `SessionCachePort` 인터페이스를 도입하여 환경 설정(`SESSION_CACHE_TYPE`)에 따라 인메모리와 Redis를 자유롭게 전환할 수 있는 유연한 구조를 설계했습니다.

### 2.3 로그 폭증으로 인한 저장 비용 및 성능 저하 (Cost vs Value)

**문제점:**

- 모든 요청에 대해 로그를 남길 경우, 정상적인 성공 로그가 전체의 99%를 차지하여 정작 중요한 에러 로그를 찾기 어렵게 만들고 저장 비용을 낭비하게 됩니다.

**해결 방향:**

- **Tail-Aware Sampling**: `SamplingPolicy`를 구현하여 에러가 발생했거나, 지연 시간이 긴 요청(Slow Request), 그리고 중요한 라우트에 대해서는 100% 기록하고, 일반적인 성공 로그는 1~5%만 확률적으로 기록하는 지능형 샘플링을 도입했습니다.
- 결정론적 해싱(`requestId` 기반)을 사용하여 요청의 시작부터 끝까지 샘플링 결정이 일관되게 유지되도록 설계했습니다.

---

## 3. 주요 결정 및 근거 (Key Decisions & Rationale)

### 3.1 동적 의존성 주입 (Dynamic DI via useFactory)

**결정:**
모듈 초기화 단계에서 환경 변수에 따라 어댑터와 클라이언트를 동적으로 주입하는 `useFactory` 방식을 채택했습니다.

**근거:**

- **리소스 최적화**: 사용하지 않는 인프라(예: `STORAGE_TYPE=file`일 때 Kafka 클라이언트)는 인스턴스화하지 않아 메모리를 절약합니다.
- **유연성**: 코드 수정 없이 `.env` 설정만으로 개발(Memory)과 운영(Redis/Kafka) 환경을 즉시 전환할 수 있습니다.

### 3.2 Graceful Fallback 전략

**결정:**
MQ 또는 Redis 장애 시 시스템이 멈추지 않고 로컬 파일이나 직접 DB 쓰기로 전환하는 Fallback 메커니즘을 포함했습니다.

**근거:**

- **가용성 최우선**: 로깅 시스템의 장애가 비즈니스 서비스의 중단으로 이어져서는 안 된다는 원칙을 고수했습니다.

### 3.3 Payment Module 리팩토링 및 다단계 시뮬레이션

**결정:**
테스트용 결제 모듈을 단순 성공/실패를 넘어 실제 비즈니스 흐름(잔액 확인 -> 게이트웨이 호출 -> 주문 확정)을 시뮬레이션하도록 고도화했습니다.

**근거:**

- **실무 정합성 검증**: 단순한 로그가 아닌, 여러 단계의 서비스 컨텍스트가 변화하는 복합 로그 환경에서 `LoggingContext`와 `service` 필드의 동적 변경이 정확히 기록되는지 검증하기 위함입니다.
- **PaymentStatusVO 도입**: 모든 상태 코드와 지연 시간 시뮬레이션 로직을 Value Object로 응집시켜 도메인 로직을 깔끔하게 유지했습니다.

---

## 4. 구현 세부사항 (Implementation Details)

### 4.1 Step 1: Asynchronous Logging (MQ)

- `LoggingModule`에서 `STORAGE_TYPE`에 따라 `LoggerPort` 구현체를 `KafkaLoggerAdapter` 또는 `MongoLoggerAdapter`로 교체합니다.
- Kafka 사용 시, `KafkaProducerClient`를 통해 비동기적으로 이벤트를 전송합니다.

### 4.2 Step 2: Distributed Caching (Redis)

- `RedisClient`: `OnModuleInit`과 `OnModuleDestroy`를 통해 Redis 연결 생명주기를 관리하도록 수정했습니다.
- `SessionRedisAdapter`: JSON 직렬화를 통해 `SessionCacheDto`를 Redis에 저장하고 조회합니다.

### 4.3 Step 3: Tail-Aware Sampling

- `SamplingPolicy`:
  - `HAS_ERROR`: 에러 포함 시 100% 샘플링
  - `SLOW_REQUEST`: 설정된 임계치(예: 2s) 초과 시 100% 샘플링
  - `CRITICAL_ROUTE`: 결제 등 중요 라우트 100% 샘플링
  - `SAMPLED_NORMAL`: 일반 로그는 `requestId` 해시 기반으로 확률적 샘플링

### 4.4 Statistical Analysis 프롬프트 고도화

- LLM이 통계 쿼리 파라미터를 추출할 때 `enum` 제약 사항(서비스명, 에러 코드 등)을 엄격히 준수하도록 지침을 강화했습니다.
- 데이터가 없는 경우 `null` 리턴을 명시하여 시스템 안정성을 높였습니다.

---

## 5. 문제 해결 과정 (Problem-Solving Process)

### 5.1 NestJS 의존성 해결 오류 (Circular or Unused Dependencies)

- **문제**: `STORAGE_TYPE`이 `file`임에도 불구하고 `LoggingModule`이 Kafka나 Mongo 클라이언트를 주입하려다 실패하는 현상이 발생했습니다.
- **해결**: `providers` 배열을 동적으로 구성하여, 현재 활성화된 타입에 필요한 클래스만 `inject`에 포함시키도록 `useFactory` 구조를 개선했습니다.

### 5.2 Logging Metadata 누락 현상

- **문제**: `LoggingContext`에는 `_metadata`가 존재하지만, 최종 `WideEvent`로 변환되는 과정에서 해당 필드가 누락되어 DB에 기록되지 않았습니다.
- **해결**: `LoggingService.finalize()` 메서드에서 `context._metadata`를 명시적으로 `WideEvent` 생성자에 전달하도록 수정했습니다.

### 5.3 통계 질문의 의도(Intent) 오판별

- **문제**: 사용자가 이전 대화 내용을 물어봐도(Conversational), 이를 통계 질문(Statistical)으로 오인하여 잘못된 집계를 시도하는 경우가 있었습니다.
- **해결**: `SearchService`에서 Intent 분류 단계를 강화하고, `CONVERSATIONAL`인 경우 즉시 세션 히스토리 기반 답변을 생성하도록 경로를 최적화했습니다.

---

## 6. 성과 및 평가 (Outcomes & Evaluation)

### 6.1 완성된 주요 기능

1. **분산 환경 지원** ✅: Redis 기반 세션 관리로 멀티 인스턴스 확장 준비 완료
2. **비동기 로깅** ✅: Kafka 연동을 통한 API 응답성 확보
3. **비용 최적화** ✅: Tail-Aware Sampling으로 가치 중심의 로그 저장 구현
4. **회복력(Resilience)** ✅: 리소스 장애 시에도 로깅 연속성 보장
5. **정교한 시뮬레이션** ✅: 실제 비즈니스 흐름을 반영한 결제 모듈과 다단계 로깅

### 6.2 아키텍처 개선

- **Hexagonal Architecture 완성**: 인프라 계층(Redis, Kafka, Mongo, File)의 완전한 격리와 교체 가능성 확보
- **Lifecycle Management**: NestJS 훅을 통한 외부 커넥션의 안전한 초기화 및 종료

---

## 7. 회고 및 교훈 (Reflection & Lessons Learned)

### 7.1 Keep (의미있었던 점)

- **추상화의 힘**: Port/Adapter 패턴 덕분에 로직의 큰 변화 없이 Redis와 Kafka라는 거대한 인프라를 매끄럽게 통합할 수 있었습니다.
- **기술적 한계 설정 (Boundary Setting)**: 단순히 구현을 늘리는 것이 아니라, 운영 가능한 복잡도 내에서 멈출 줄 아는 통제력을 발휘했습니다. (예: 복잡한 폴백 체인 대신 명확한 Circuit Breaker 선택)
- **보수적인 비용 관리**: 처음부터 모든 로그를 쌓는 대신, 샘플링 정책을 설계하여 운영 지속 가능성을 고려했습니다.
- **철저한 생명주기 관리**: 클라이언트들의 연결 관리를 중앙화하여 리소스 누수를 방지했습니다.

### 7.2 Problem (개선 필요 사항 / 아쉬운 점)

- **과잉 설계에 대한 경계**: 초기 기획 단계에서 고려되었던 Self-healing이나 런타임 샘플링 변경 등은 운영 복잡도를 고려하여 의도적으로 배제했습니다. "할 수 있는 것"과 "해야 하는 것" 사이의 균형을 잡는 것이 과제였습니다.
- **Redis 명령어 최적화**: 현재 `scan` 등을 이용한 일부 로직은 데이터량이 방대해질 경우 성능 저하 우려가 있어, Redis 전용 데이터 구조(Set 등)로의 개선이 필요합니다.
- **Fallback 로깅 가시성**: Fallback이 발생했을 때 이를 운영자가 즉시 인지할 수 있는 별도의 경보(Alert) 메커니즘이 부족합니다.

### 7.3 Try (향후 시도해볼 만한 점)

- **DLQ(Dead Letter Queue)**: MQ 전송 실패 시 단순히 Fallback하는 것을 넘어, 실패한 메시지를 따로 모아 재처리하는 프로세스 도입
- **인프라 대시보드**: 샘플링 비율, 큐 지연 시간 등을 시각화하여 로깅 시스템 자체의 건강 상태 모니터링
- **단계 별 fallback 전략**: 만약 MQ, MongoDB, 백엔드 인스턴스가 모두 실패한다면, 그 때 까지 fallback 전략을 구성하기
- **로깅 모듈 어댑터들을 복합적으로 사용하기**: MQ, MongoDB, 로컬 인스턴스 로깅 기능 각각이 상호 보완적으로 동작하도록 하기
  (_`예시: 어플리케이션 파일 로그(로그 로테이션) + file reading agent(filebeat 등)가 MQ 또는 MongoDB에 현재 갱신되는 로그데이터를 전달`_)

---

## 8. 결과

Phase 5를 통해 이 프로젝트는 단순한 '기능 구현' 단계 이후로도 **'운영 가능한 시스템'**을 고려해볼 수 있었습니다. 이제 수천 명의 사용자가 동시에 접속하여 로그를 쏟아내더라도, 시스템은 가장 중요한 에러 정보를 놓치지 않으면서도 안정적으로 동작할 것입니다.

이러한 인프라적 단단함은 앞으로 진행할 Phase 6의 '자율 지능(Autonomous Intelligence)' 단계에서 AI Agent를 도입할 수 있는 최소한의 토대를 마련했습니다.
