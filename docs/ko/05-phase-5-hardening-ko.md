# Phase 5 — 운영 안정화 (인프라 및 회복 탄력성)

## 목표

프로덕션 환경의 안정성을 위해 로깅 파이프라인을 견고하게 다지고, 향후 지능형 기능을 위한 탄력적인 기반을 구축합니다.
Phase 5는 **인프라 회복 탄력성(Infrastructure Resilience)** (성능, 확장성, 비용 최적화)과 **실용적인 지능(Pragmatic Intelligence)** (규칙 기반 사고 탐지) 사이의 다리를 놓는 데 집중합니다.

## 전략

Phase 5는 애플리케이션 성능에 영향을 주지 않으면서 프로덕션 부하를 처리할 수 있도록 "하드닝(Hardening)"을 우선시 했습니다.

1.  **프로덕션급 인프라**: 비동기 파이프라인을 사용하여 로깅을 애플리케이션 성능으로부터 디커플링(Decouple)합니다.
2.  **분산 확장성**: 인스턴스 간 상태 관리를 위해 인메모리 방식에서 Redis로 전환합니다.
3.  **비용 인식 샘플링 (Cost-Aware Sampling)**: 가치가 높은 신호(에러/지연 시간)는 모두 보존하면서 로그 볼륨을 전략적으로 줄입니다.
4.  **우아한 성능 저하 (Graceful Degradation)**: 인프라(MQ/Redis) 장애 시에도 시스템이 작동하도록 보장합니다.

## 우선순위: Phase 5-A (핵심 하드닝)

### 높은 우선순위 (완료를 위한 필수 사항)

1.  **비동기 로깅 파이프라인 (MQ 통합)**: API 지연 시간을 저장소 지연 시간으로부터 분리합니다.
2.  **분산 캐시 (Redis 통합)**: 다중 인스턴스 배포를 지원합니다.
3.  **Tail-Aware 샘플링**: 저장 비용과 대역폭을 최적화합니다.
4.  **규칙 기반 사고 집계 (Incident Aggregation)**: 즉각적인 운영 가치를 위해 단순한 "그룹화 + 요약"을 수행합니다.

### 중간 우선순위 (관측 가능성)

5.  **인프라 메타데이터**: 큐 깊이, 캐시 히트율, 샘플링 보존율 등을 모니터링합니다.

---

## 구현 단계

### 1단계: 비동기 로깅 파이프라인 (MQ 통합)

**목표**: 로깅 오버헤드를 API 응답 지연 시간으로부터 분리합니다.

**구현 내용**:

- `LoggingService`와 `LoggerPort` 사이에 메시지 큐(Kafka/Redis Streams)를 도입합니다.
- **프로듀서 (Producer)**: `LoggingService.finalize()`가 `WideEvent`를 MQ에 발행합니다 (Non-blocking).
- **컨슈머 (Consumer)**: 백그라운드 워커가 MQ에서 메시지를 소비하여 MongoDB에 저장합니다.
- **에러 처리**:
  - **재시도**: 단순한 백오프(Backoff)와 함께 고정 횟수(예: 3회) 재시도를 수행합니다.
  - **우아한 폴백 (Graceful Fallback)**: MQ를 사용할 수 없는 경우, 데이터 유실 방지를 위해 동기식 로깅(파일 또는 직접 DB 저장)으로 전환합니다.

**설계 결정 사항**:

- PoC 단계에서는 복잡한 전달 보장(Delivery Guarantees)보다 **지연 시간 디커플링**을 우선시합니다.
- 효율성을 위해 MongoDB에 배치(Batch)로 저장합니다 (예: 1초마다 또는 100개 이벤트마다).

### Kafka Topic 확인

```bash
# Kafka 컨테이너에 접속
docker exec -it kafka_local bash

# 토픽 목록 확인
kafka-topics.sh --bootstrap-server localhost:9092 --list

# 토픽 상세 정보
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic log-events

# Consumer Group 상태 확인
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group log-consumer-group --describe
```

### 로그 확인

애플리케이션 로그에서 다음을 확인할 수 있습니다:

- **Publish 성공**: `Published log event to Kafka topic: log-events, requestId: ...`
- **Batch 처리**: `Processed batch: X events (Y success, Z failures) in Wms`
- **Fallback**: `MQ publish failed, falling back to direct logging`

## 성능 개선 효과

### Before (동기 로깅)

- API 응답 시간 = 비즈니스 로직 + MongoDB 쓰기 시간
- MongoDB 지연이 API 응답에 직접 영향

### After (비동기 로깅)

- API 응답 시간 = 비즈니스 로직 + Kafka publish 시간 (매우 빠름)
- MongoDB 쓰기는 백그라운드에서 처리
- **예상 개선**: API 응답 시간 50-90% 감소 (MongoDB 쓰기 시간에 따라)

### 2단계: Redis 기반 분산 캐싱

**목표**: 분산 배포 환경을 지원하고 인스턴스 간 캐시 일관성을 유지합니다.

**구현 내용**:

- **추상화**: `InMemory`와 `Redis` 어댑터를 모두 지원하도록 `SessionCachePort` 및 `SemanticCachePort`를 사용합니다.
- **세션 캐시**: 직렬화된 대화 기록을 TTL과 함께 Redis에 저장합니다.
- **시맨틱 캐시 (실용적 접근)**: 벡터 유사도 대신 정확한 키 조회(Exact-key lookup)를 사용합니다.
  - 키 전략: `hash(normalized_query + prompt_version + language)`.
  - 값: 캐싱된 LLM 응답.

**설계 결정 사항**:

- 복잡성을 줄이고 결정론적인 캐시 히트를 보장하기 위해, Phase 5에서는 Redis의 벡터 유사도 검색을 지양합니다.

### 3단계: Tail-Aware 샘플링 (비용 효율적)

**목표**: 로그 볼륨을 80-90% 줄이면서도 에러 및 지연 시간 신호는 보존합니다.

**구현 내용**:

- **샘플링 전략**:
  - **100% 보존**: `error.code`가 있거나, `durationMs > threshold`인 이벤트, 또는 중요 경로(Critical routes)의 이벤트.
  - **확률적 샘플링**: "정상적인" 성공 요청의 1-5%.
- **결정 시점**: 대역폭과 큐 부하를 줄이기 위해 MQ 발행 직전에 샘플링 여부를 결정합니다.

**설계 결정 사항**:

- 샘플링 결정은 **결정론적**(`requestId` 해시 기반)이어야 하며, **정책적으로 설명 가능**해야 합니다.

---

## 의도적인 미구현 사항 (설계적 트레이드오프)

핵심 안정성에 집중하기 위해 다음 사항들은 **의도적으로 Phase 6로 미룹니다**.

- **복잡한 클러스터링**: 로그 그룹화를 위한 DBSCAN/K-means는 규칙 기반 집계로 대체되었습니다.
- **완전한 DLQ 관리**: 고급 데드 레터 큐(Dead-letter queue) 오케스트레이션은 개념화만 하고 고정 재시도로 단순화했습니다.
- **벡터 유사도 캐시**: 더 높은 신뢰성과 낮은 지연 시간을 위해 정확한 키 해싱으로 교체했습니다.
- **그라운딩 지표**: 전체 RAG 검증 지표는 지능화 단계로 이동했습니다.

---

## 성공 기준

1.  **지연 시간**: MongoDB 쓰기 성능과 관계없이 API 응답 시간이 일정하게 유지됨.
2.  **회복 탄력성**: Kafka나 Redis가 다운되어도 시스템은 폴백 로직을 통해 로깅을 지속함.
3.  **비용**: 에러 데이터를 100% 유지하면서 로그 저장 용량을 대폭 줄임.

---

## 단계 간 경계: Phase 6로 이동

Phase 5-A를 통해 **프로덕션급 인프라**가 완성되었습니다. 이제 시스템은 "지능(Intelligence)" 레이어를 얹을 준비가 되었습니다.

- 최소 하나 이상의 규칙 기반 사고 요약 자동 생성.
- 고급 클러스터링 (DBSCAN).
- 자동화된 일일 보고 (Reverse RAG).
- 분야별 전문 에이전트 분석가.
