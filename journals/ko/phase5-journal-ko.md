Phase 5 Step 1-3 구현 전략
핵심 원칙
기존 코드 수정 최소화: Adapter 패턴으로 새 객체만 추가
확장성 강조: Hexagonal Architecture 유지, 인터페이스 기반 확장
Docker 인프라: docker/ 디렉토리에 Redis/Kafka 추가 (atlas_local 패턴)
Step 1: Asynchronous Logging Pipeline (MQ Integration)
전략: Decorator/Wrapper 패턴
기존 MongoLogger는 유지하고, MQ를 통한 비동기 전송을 담당하는 새로운 Adapter를 추가합니다.
1.1 Docker 인프라 추가
docker/
├── docker-compose.yml (기존 + Redis, Kafka 추가)
├── mongo/ (기존)
├── redis/
│ └── Dockerfile (또는 docker-compose에서 직접 이미지 사용)
└── kafka/
└── docker-compose-kafka.yml (또는 docker-compose에 통합)
docker/├── docker-compose.yml (기존 + Redis, Kafka 추가)├── mongo/ (기존)├── redis/│ └── Dockerfile (또는 docker-compose에서 직접 이미지 사용)└── kafka/ └── docker-compose-kafka.yml (또는 docker-compose에 통합)
docker-compose.yml 확장:
services:
atlas_local: # 기존
...

redis_local:
image: redis:7-alpine
hostname: redis_local
ports: - 6379:6379
volumes: - redis_data:/data

kafka_local:
image: apache/kafka:latest
hostname: kafka_local
ports: - 9092:9092
environment:
KAFKA_BROKER_ID: 1
KAFKA_ZOOKEEPER_CONNECT: zookeeper_local:2181 # ... 기타 설정
depends_on: - zookeeper_local

zookeeper_local:
image: confluentinc/cp-zookeeper:latest # ... 설정

volumes:
data: # 기존
config: # 기존
redis_data:
services: atlas_local: # 기존 ... redis_local: image: redis:7-alpine hostname: redis_local ports: - 6379:6379 volumes: - redis_data:/data kafka_local: image: apache/kafka:latest hostname: kafka_local ports: - 9092:9092 environment: KAFKA_BROKER_ID: 1 KAFKA_ZOOKEEPER_CONNECT: zookeeper_local:2181 # ... 기타 설정 depends_on: - zookeeper_local zookeeper_local: image: confluentinc/cp-zookeeper:latest # ... 설정volumes: data: # 기존 config: # 기존 redis_data:
1.2 아키텍처 설계
새로운 컴포넌트 추가 (기존 코드 수정 없음):
libs/logging/
├── core/ports/out/
│ └── logger.port.ts (기존 - 수정 없음)
├── infrastructure/
│ ├── mongodb/
│ │ └── mongo.logger.ts (기존 - 수정 없음)
│ └── mq/ (NEW)
│ ├── mq-logger.adapter.ts (NEW - LoggerPort 구현)
│ ├── mq-client.ts (NEW - Kafka/Redis Streams 클라이언트)
│ └── mq-consumer.service.ts (NEW - Background Worker)
libs/logging/├── core/ports/out/│ └── logger.port.ts (기존 - 수정 없음)├── infrastructure/│ ├── mongodb/│ │ └── mongo.logger.ts (기존 - 수정 없음)│ └── mq/ (NEW)│ ├── mq-logger.adapter.ts (NEW - LoggerPort 구현)│ ├── mq-client.ts (NEW - Kafka/Redis Streams 클라이언트)│ └── mq-consumer.service.ts (NEW - Background Worker)
구현 방식:
MqLoggerAdapter (LoggerPort 구현)
LoggingService.finalize() 호출 시 MQ로 publish (비동기)
기존 MongoLogger는 그대로 유지
MqConsumerService (Background Worker)
MQ에서 consume → MongoLogger.log() 호출
배치 처리 (100개 또는 1초 타임아웃)
Module 설정 변경 (의존성만 변경)
// LoggingModule에서
{
provide: LoggerPort,
useClass: MqLoggerAdapter, // MongoLogger → MqLoggerAdapter로 변경
}
// MqLoggerAdapter는 내부적으로 MongoLogger를 주입받음
// LoggingModule에서 { provide: LoggerPort, useClass: MqLoggerAdapter, // MongoLogger → MqLoggerAdapter로 변경 } // MqLoggerAdapter는 내부적으로 MongoLogger를 주입받음
장점:
LoggingService 코드 수정 없음
MongoLogger 코드 수정 없음
MQ 실패 시 Fallback 전략 구현 가능
1.3 Fallback 전략
// MqLoggerAdapter
async log(...) {
try {
await this.mqClient.publish(event);
} catch (error) {
// MQ 실패 시 동기적으로 MongoLogger
// MqLoggerAdapterasync log(...) { try { await this.mqClient.publish(event); } catch (error) { // MQ 실패 시 동기적으로 MongoLogger
Step 2: Redis-based Distributed Caching
전략: Port/Adapter 패턴으로 추상화
기존 SemanticCacheService와 SessionCacheService는 유지하고, Cache 인터페이스를 도입해 Redis Adapter를 추가합니다.
2.1 아키텍처 설계
새로운 인터페이스 추가:
src/embeddings/
├── core/ports/out/ (NEW)
│ ├── cache.port.ts (NEW - CachePort 인터페이스)
│ └── session-cache.port.ts (NEW - SessionCachePort 인터페이스)
├── infrastructure/cache/ (NEW)
│ ├── redis/
│ │ ├── redis-cache.adapter.ts (NEW)
│ │ ├── redis-session-cache.adapter.ts (NEW)
│ │ └── redis.client.ts (NEW)
│ └── memory/ (NEW - 기존 로직을 Adapter로 이동)
│ ├── memory-cache.adapter.ts (NEW)
│ └── memory-session-cache.adapter.ts (NEW)
└── service/
├── semantic-cache.service.ts (기존 - CachePort 사용하도록 리팩토링)
└── session-cache.service.ts (기존 - SessionCachePort 사용하도록 리팩토링)
src/embeddings/├── core/ports/out/ (NEW)│ ├── cache.port.ts (NEW - CachePort 인터페이스)│ └── session-cache.port.ts (NEW - SessionCachePort 인터페이스)├── infrastructure/cache/ (NEW)│ ├── redis/│ │ ├── redis-cache.adapter.ts (NEW)│ │ ├── redis-session-cache.adapter.ts (NEW)│ │ └── redis.client.ts (NEW)│ └── memory/ (NEW - 기존 로직을 Adapter로 이동)│ ├── memory-cache.adapter.ts (NEW)│ └── memory-session-cache.adapter.ts (NEW)└── service/ ├── semantic-cache.service.ts (기존 - CachePort 사용하도록 리팩토링) └── session-cache.service.ts (기존 - SessionCachePort 사용하도록 리팩토링)
인터페이스 정의:
// cache.port.ts
export abstract class CachePort {
abstract get(key: string): Promise<any | null>;
abstract set(key: string, value: any, ttl?: number): Promise<void>;
abstract delete(key: string): Promise<void>;
abstract exists(key: string): Promise<boolean>;
}

// session-cache.port.ts
export abstract class SessionCachePort {
abstract getHistory(sessionId: string): Promise<AnalysisResult[]>;
abstract updateSession(sessionId: string, result: AnalysisResult): Promise<void>;
abstract clearSession(sessionId: string): Promise<void>;
}
// cache.port.tsexport abstract class CachePort { abstract get(key: string): Promise<any | null>; abstract set(key: string, value: any, ttl?: number): Promise<void>; abstract delete(key: string): Promise<void>; abstract exists(key: string): Promise<boolean>;}// session-cache.port.tsexport abstract class SessionCachePort { abstract getHistory(sessionId: string): Promise<AnalysisResult[]>; abstract updateSession(sessionId: string, result: AnalysisResult): Promise<void>; abstract clearSession(sessionId: string): Promise<void>;}
2.2 마이그레이션 전략
기존 서비스 리팩토링 (최소 변경)
SemanticCacheService: 내부 Map 로직을 MemoryCacheAdapter로 분리
SessionCacheService: 내부 Map 로직을 MemorySessionCacheAdapter로 분리
서비스는 CachePort/SessionCachePort에 의존하도록 변경
Redis Adapter 추가
RedisCacheAdapter: CachePort 구현
RedisSessionCacheAdapter: SessionCachePort 구현
Module 설정 (환경 변수 기반 선택)
// EmbeddingsModule
{
provide: CachePort,
useClass: process.env.REDIS_ENABLED === 'true'
? RedisCacheAdapter
: MemoryCacheAdapter,
}
// EmbeddingsModule { provide: CachePort, useClass: process.env.REDIS_ENABLED === 'true' ? RedisCacheAdapter : MemoryCacheAdapter, }
장점:
기존 서비스 로직은 유지, 인프라만 교체
로컬 개발은 Memory, 프로덕션은 Redis로 전환 가능
테스트 시 Mock Adapter 주입 용이
2.3 Redis 클라이언트 설계
// redis.client.ts
@Injectable()
export class RedisClient implements OnModuleInit, OnModuleDestroy {
private client: Redis;

async onModuleInit() {
this.client = new Redis({
host: process.env.REDIS_HOST || 'redis_local',
port: parseInt(process.env.REDIS_PORT || '6379'),
// ... 설정
});
}

// Redis 명령어 래핑 메서드들
}
// redis.client.ts@Injectable()export class RedisClient implements OnModuleInit, OnModuleDestroy { private client: Redis; async onModuleInit() { this.client = new Redis({ host: process.env.REDIS_HOST || 'redis_local', port: parseInt(process.env.REDIS_PORT || '6379'), // ... 설정 }); } // Redis 명령어 래핑 메서드들}
Step 3: Tail-Based Sampling
전략: Service Composition
LoggingService에 SamplingService를 주입해 샘플링 결정을 위임합니다.
3.1 아키텍처 설계
새로운 컴포넌트 추가:
libs/logging/
├── service/
│ ├── logging.service.ts (기존 - SamplingService 주입만 추가)
│ └── sampling.service.ts (NEW)
├── core/value-objects/
│ └── sampling-config.ts (NEW - 설정 Value Object)
└── infrastructure/sampling/
└── (필요시 확장 가능)
libs/logging/├── service/│ ├── logging.service.ts (기존 - SamplingService 주입만 추가)│ └── sampling.service.ts (NEW)├── core/value-objects/│ └── sampling-config.ts (NEW - 설정 Value Object)└── infrastructure/sampling/ └── (필요시 확장 가능)
구현 방식:
SamplingService 생성
@Injectable()
export class SamplingService {
shouldSample(event: WideEvent, context: LoggingContext): boolean {
// 100% retention: errors, slow requests
if (event.error || this.isSlowRequest(event)) {
return true;
}

       // Statistical sampling: deterministic based on requestId
       return this.deterministicSample(event.requestId, context.service);
     }

     private deterministicSample(requestId: string, service: string): boolean {
       // Hash-based deterministic sampling
       const hash = crypto.createHash('sha256')
         .update(`${requestId}:${service}`)
         .digest('hex');
       const sampleRate = this.getSampleRate(service);
       return parseInt(hash.substring(0, 8), 16) % 100 < sampleRate * 100;
     }

}
@Injectable() export class SamplingService { shouldSample(event: WideEvent, context: LoggingContext): boolean { // 100% retention: errors, slow requests if (event.error || this.isSlowRequest(event)) { return true; } // Statistical sampling: deterministic based on requestId return this.deterministicSample(event.requestId, context.service); } private deterministicSample(requestId: string, service: string): boolean { // Hash-based deterministic sampling const hash = crypto.createHash('sha256') .update(`${requestId}:${service}`) .digest('hex'); const sampleRate = this.getSampleRate(service); return parseInt(hash.substring(0, 8), 16) % 100 < sampleRate \* 100; } }
LoggingService.finalize() 수정 (최소 변경)
async finalize(...) {
// ... 기존 코드 ...

     // Sampling 결정
     if (!this.samplingService.shouldSample(event, context)) {
       return; // 샘플링되지 않음
     }

     // 기존 로깅 로직 (수정 없음)
     await this.logger.log(event, context._metadata, _summary);

}
async finalize(...) { // ... 기존 코드 ... // Sampling 결정 if (!this.samplingService.shouldSample(event, context)) { return; // 샘플링되지 않음 } // 기존 로깅 로직 (수정 없음) await this.logger.log(event, context.\_metadata, \_summary); }
설정 Value Object
// sampling-config.ts
export class SamplingConfig {
readonly errorRetentionRate = 1.0; // 100%
readonly slowRequestThresholdMs = 1000;
readonly serviceRates: Record<string, number> = {
'payments': 1.0, // 100%
'health': 0.001, // 0.1%
'default': 0.01, // 1%
};
}
// sampling-config.ts export class SamplingConfig { readonly errorRetentionRate = 1.0; // 100% readonly slowRequestThresholdMs = 1000; readonly serviceRates: Record<string, number> = { 'payments': 1.0, // 100% 'health': 0.001, // 0.1% 'default': 0.01, // 1% }; }
장점:
LoggingService 변경 최소화 (샘플링 체크만 추가)
LoggerPort 구현체 수정 없음
설정 기반으로 확장 가능
3.2 샘플링 메타데이터
// WideEvent에 \_sampled 필드 추가 (선택적)
interface WideEvent {
// ... 기존 필드들
\_sampled?: boolean; // 샘플링 여부 (analytics용)
}
// WideEvent에 \_sampled 필드 추가 (선택적)interface WideEvent { // ... 기존 필드들 \_sampled?: boolean; // 샘플링 여부 (analytics용)}
추가 고려사항

1. 환경 변수 관리

# .env.example

# MQ Configuration

MQ_ENABLED=true
MQ_TYPE=kafka # or 'redis-streams'
KAFKA_BROKER=kafka_local:9092
REDIS_STREAM_KEY=log-events

# Redis Configuration

REDIS_ENABLED=true
REDIS_HOST=redis_local
REDIS_PORT=6379

# Sampling Configuration

SAMPLING_ENABLED=true
SAMPLING_DEFAULT_RATE=0.01
SAMPLING_SLOW_THRESHOLD_MS=1000

# .env.example# MQ ConfigurationMQ_ENABLED=trueMQ_TYPE=kafka # or 'redis-streams'KAFKA_BROKER=kafka_local:9092REDIS_STREAM_KEY=log-events# Redis ConfigurationREDIS_ENABLED=trueREDIS_HOST=redis_localREDIS_PORT=6379# Sampling ConfigurationSAMPLING_ENABLED=trueSAMPLING_DEFAULT_RATE=0.01SAMPLING_SLOW_THRESHOLD_MS=1000

2. 모니터링 및 메트릭
   각 Step에 메트릭 수집:
   Step 1: MQ queue depth, publish rate, consumer lag
   Step 2: Cache hit rate, Redis connection status
   Step 3: Sampling rate by service, retention rate
3. 테스트 전략
   Unit: 각 Adapter 단위 테스트
   Integration: Docker Compose 환경에서 E2E 테스트
   Fallback: MQ/Redis 실패 시나리오 테스트
4. 문서화
   각 Step별 README:
   docs/phase5/step1-mq-integration.md
   docs/phase5/step2-redis-caching.md
   docs/phase5/step3-sampling.md
5. 점진적 롤아웃
   Step 1: MQ Adapter 추가 → 환경 변수로 활성화
   Step 2: Redis Adapter 추가 → Memory와 병행 운영 후 전환

   Step 3: Sampling 활성화 → 샘플링 비율 점진적 조정
   구현 순서 제안
   Docker 인프라 (Redis, Kafka) 추가
   Step 2: Redis Caching (인터페이스 도입, 기존 서비스 리팩토링)
   Step 1: MQ Integration (LoggerPort Wrapper)

   Step 3: Tail-Based Sampling (SamplingService 추가)
   이 순서의 이유:
   Step 2가 가장 독립적이고 기존 코드 영향이 적음
   Step 1은 Step 2의 Redis를 활용 가능 (Redis Streams 옵션)
   Step 3는 Step 1 완료 후 적용하면 MQ 부하 감소 효과 확인 가능

# 문제점

- metadata 가 로그에 포함이 안되고 있음
- 쿼리 조인 -> LLM 리턴으로 가상 표현으로 변환
- 내부 인자 값이 한국어로 답변 받으면 안돼는데 한국어로 답변 받는 경우
- 쿼리 전략:
  - 처음 부터 통계 조회까지 가정한 기능을 도입하려고 한 게 문제다. 우선 답변에 포함할 수 있는 요소들을 고려하고, 이 전부를 제공하고 답변을 얻는게 우선이었다는 생각이 든다.
  - 이후 intent를 구분하고,
    - 단순한 답변을 요구할지
    - 통계 정보 제공에 필요한 별도의 aggregation 결과를 포함하여 답변을 보낼지
  - 선택/ 확장 했어야 했다.

# 쿼리 수정 전 후 결과

- 수정 전 문제점:
  - 프롬프트에 포함하고자 하는 쿼리를 기본적으로 단순한 형태로 변환하여 사용 중이었는데,
  - 세션 정보에 대한 질문을 해도, 우선 답변 생성 후 리턴하지 않고, 이를 이전 질문과 병합하여 다시 통계 질문으로 만드는 문제.
  - 문제 상황:

  ```bash
  Scenario3/docker on  phase5 [!?] took 3s
  ❯ curl -G "http://localhost:3000/search/ask" \
        --data-urlencode "q=최근 60시간의 결제 건 중 프리미엄 유저가 결제에 실패하는 빈도를 알려줘" \
        --data-urlencode "sessionId=test-session" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                   Dload  Upload   Total   Spent    Left  Speed
  100   253  100   253    0     0     40      0  0:00:06  0:00:06 --:--:--    62
  {
  "question": "최근 60시간의 결제 건 중 프리미엄 유저가 결제에 실패하는 빈도를 알려줘",
  "intent": "STATISTICAL",
  "answer": "Not enough evidence to provide a reliable answer.",
  "sources": [],
  "confidence": 0,
  "sessionId": "test-session"
  }

  Scenario3/docker on  phase5 [!?] took 9s
  ❯ curl -G "http://localhost:3000/search/ask" \
        --data-urlencode "q=방금 내가 한 질문이 뭐였지?" \
        --data-urlencode "sessionId=test-session" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                   Dload  Upload   Total   Spent    Left  Speed
  100   332  100   332    0     0     48      0  0:00:06  0:00:06 --:--:--    92
  {
  "question": "방금 내가 한 질문이 뭐였지?",
  "intent": "STATISTICAL",
  "answer": "제공된 로그에는 최근 60시간 동안 프리미엄 유저의 결제 실패 빈도에 대한 구체적인 집계 정보가 부족합니다. 따라서 답변드릴 수 없습니다.",
  "sources": [],
  "confidence": 0.1,
  "sessionId": "test-session"
  }
  ```

- 수정 후
  - 우선 intent를 먼저 구분하도록 하고, 세션에 대한 내용이면 되도록 곧바로 리턴하도록 수정
  - 결과:

  ```bash
  Scenario3/docker on  phase5 [!?] took 6s
  ❯ curl -G "http://localhost:3000/search/ask" \
        --data-urlencode "q=최근 60시간의 결제 건 중 프리미엄 유저가 결제에 실패하는 빈도를 알려줘" \
        --data-urlencode "sessionId=test-session" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                   Dload  Upload   Total   Spent    Left  Speed
  100   879  100   879    0     0    123      0  0:00:07  0:00:07 --:--:--   225
  {
  "question": "최근 60시간의 결제 건 중 프리미엄 유저가 결제에 실패하는 빈도를 알려줘",
  "intent": "STATISTICAL",
  "answer": "최근 60시간 동안 프리미엄 유저의 결제 실패 빈도는 다음과 같습니다.\n\n1.  **GATEWAY_TIMEOUT**: 4건\n    *   설명: 결제 게이트웨이 연결 시간 초과로 인한 실패입니다.\n2.  **INSUFFICIENT_FUNDS**: 1건\n    *   설명: 사용자의 계정 잔액 부족으로 인한 실패입니다.\n\n[Note: Some claims could not be fully verified: 최근 60시간이라는 시간 범위가 로그 데이터에서 명시적으로 확인되지 않습니다., GATEWAY_TIMEOUT 오류가 4건 발생했다는 정보는 로그 데이터에서 4건으로 확인되지만, '최근 60시간'이라는 시간적 범위는 특정할 수 없습니다.]",
  "sources": [],
  "confidence": 0.5,
  "sessionId": "test-session"
  }

  Scenario3/docker on  phase5 [!?] took 9s
  ❯ curl -G "http://localhost:3000/search/ask" \
        --data-urlencode "q=방금 내가 한 질문이 뭐였지?" \
        --data-urlencode "sessionId=test-session" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                   Dload  Upload   Total   Spent    Left  Speed
  100   328  100   328    0     0    359      0 --:--:-- --:--:-- --:--:--   359
  {
  "question": "방금 내가 한 질문이 뭐였지?",
  "intent": "CONVERSATIONAL",
  "answer": "제공된 대화 기록에 따르면, 당신이 방금 한 질문은 \"최근 60시간의 결제 건 중 프리미엄 유저가 결제에 실패하는 빈도를 알려줘\"입니다.",
  "sources": [],
  "confidence": 1,
  "sessionId": "test-session"
  }

  ```
