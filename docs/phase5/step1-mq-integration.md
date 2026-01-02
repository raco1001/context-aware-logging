# Phase 5 Step 1: MQ Integration - Asynchronous Logging Pipeline

## 개요

Step 1은 로깅 오버헤드를 API 응답 지연 시간에서 분리하기 위해 Message Queue를 도입합니다. `LoggingService.finalize()`가 호출되면 이벤트를 Kafka로 publish하고, 백그라운드 worker가 이를 consume하여 MongoDB에 저장합니다.

## 아키텍처

```
LoggingService.finalize()
    ↓
MqLoggerAdapter (LoggerPort 구현)
    ↓ (비동기 publish)
Kafka Topic: log-events
    ↓ (백그라운드 consume)
MqConsumerService
    ↓ (배치 처리)
MongoLogger
    ↓
MongoDB (wide_events collection)
```

## 구현 세부사항

### 1. Docker 인프라

`docker/docker-compose.yml`에 Kafka와 Zookeeper가 추가되었습니다:

- **zookeeper_local**: Kafka의 메타데이터 관리
- **kafka_local**: 메시지 브로커 (포트 9092)

### 2. MQ Client 인터페이스

**`MqClientPort`** (추상 클래스):
- `publish()`: 로그 이벤트를 MQ로 publish
- `connect()` / `disconnect()`: 연결 관리

**`KafkaClient`** (구현체):
- KafkaJS를 사용한 Kafka 브로커 연결
- Idempotent producer 설정 (중복 방지)
- Retry 로직 (최대 3회, exponential backoff)

### 3. MqLoggerAdapter

**역할**: `LoggerPort`를 구현하는 Wrapper

**동작**:
1. `MQ_ENABLED=true`인 경우: Kafka로 publish (비동기)
2. `MQ_ENABLED=false`인 경우: MongoLogger로 직접 전달 (동기)
3. MQ 실패 시: Fallback으로 MongoLogger 사용

**Fallback 전략**:
- MQ publish 실패 시 자동으로 MongoLogger로 전환
- 로그 손실 방지

### 4. MqConsumerService

**역할**: 백그라운드 worker로 MQ에서 consume하여 MongoDB에 저장

**특징**:
- **배치 처리**: 100개 이벤트 또는 1초 타임아웃
- **Consumer Group**: `log-consumer-group` (여러 인스턴스 지원)
- **Graceful Shutdown**: 종료 시 남은 배치 처리

**배치 처리 로직**:
```typescript
// 배치 크기 도달 시 즉시 처리
if (batch.length >= batchSize) {
  await flushBatch();
}
// 또는 타임아웃 시 처리
setTimeout(() => flushBatch(), batchTimeoutMs);
```

## 환경 변수 설정

`.env` 파일에 다음 변수를 추가하세요:

```env
# MQ Configuration
MQ_ENABLED=true
MQ_TYPE=kafka
KAFKA_BROKER=localhost:9092
KAFKA_LOG_TOPIC=log-events
KAFKA_CONSUMER_GROUP=log-consumer-group

# Batch Processing
MQ_BATCH_SIZE=100
MQ_BATCH_TIMEOUT_MS=1000
```

### 환경 변수 설명

- **MQ_ENABLED**: `true`로 설정하면 MQ 사용, `false`면 동기 로깅
- **KAFKA_BROKER**: Kafka 브로커 주소 (Docker: `localhost:9092`)
- **KAFKA_LOG_TOPIC**: 로그 이벤트를 저장할 Kafka 토픽
- **MQ_BATCH_SIZE**: 배치 처리 크기 (기본값: 100)
- **MQ_BATCH_TIMEOUT_MS**: 배치 타임아웃 (기본값: 1000ms)

## 실행 방법

### 1. Docker 인프라 시작

```bash
cd docker
docker-compose up -d
```

이 명령으로 다음 서비스가 시작됩니다:
- MongoDB (atlas_local)
- Zookeeper (zookeeper_local)
- Kafka (kafka_local)

### 2. 애플리케이션 시작

```bash
cd backend
pnpm install
pnpm start:dev
```

### 3. MQ 활성화 확인

애플리케이션 로그에서 다음 메시지를 확인하세요:

```
[KafkaClient] Connected to Kafka broker at localhost:9092
[MqConsumerService] Started MQ consumer for topic: log-events, group: log-consumer-group
```

## 모니터링

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

## 문제 해결

### Kafka 연결 실패

**증상**: `Failed to connect to Kafka: ...`

**해결**:
1. Docker 컨테이너가 실행 중인지 확인: `docker ps`
2. Kafka 브로커 주소 확인: `KAFKA_BROKER` 환경 변수
3. 네트워크 연결 확인: `telnet localhost 9092`

### Consumer가 메시지를 처리하지 않음

**증상**: Kafka에 메시지는 쌓이지만 MongoDB에 저장되지 않음

**해결**:
1. Consumer 로그 확인: `[MqConsumerService] Started MQ consumer...`
2. Consumer Group 상태 확인 (위의 모니터링 섹션 참조)
3. MongoDB 연결 확인

### Fallback 로깅이 자주 발생

**증상**: 로그에 "MQ publish failed, falling back..." 메시지가 자주 나타남

**해결**:
1. Kafka 브로커 상태 확인
2. 네트워크 지연 확인
3. Kafka 브로커 리소스 확인 (메모리, 디스크)

## 다음 단계

Step 1 완료 후:
- Step 2: Redis-based Distributed Caching
- Step 3: Tail-Based Sampling

## 참고 자료

- [KafkaJS Documentation](https://kafka.js.org/)
- [Confluent Kafka Docker Images](https://docs.confluent.io/platform/current/installation/docker/config-reference.html)

