/**
 * LoggingMode - 로깅 시스템의 동작 모드를 정의합니다.
 *
 * KAFKA: Kafka Producer/Consumer를 사용하여 비동기 로깅
 * DIRECT: MongoDB에 직접 로깅 (Kafka 장애 시 Fallback)
 */
export enum LoggingMode {
  KAFKA = 'KAFKA',
  DIRECT = 'DIRECT',
}
