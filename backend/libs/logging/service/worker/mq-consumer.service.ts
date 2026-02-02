import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer } from 'kafkajs';
import { MongoLogger, KafkaConsumerClient } from '@logging/infrastructure';
import { WideEvent, LoggingContext } from '@logging/domain';
import { LoggingMode } from '../../core/domain/logging-mode.enum';
import { LoggingModeService } from '../logging-mode.service';

interface LogMessage {
  event: WideEvent;
  _metadata: LoggingContext['_metadata'];
  summary: string;
  timestamp: string;
}

/**
 * MqConsumerService - Background worker that consumes log events from MQ
 * and persists them to MongoDB via MongoLogger.
 *
 * 핵심 철학:
 * - Consumer는 "ephemeral worker"로 취급됩니다.
 * - Kafka가 정상일 때만 Consumer 인스턴스를 생성합니다.
 * - Kafka 장애 시 Consumer 인스턴스를 완전히 파괴합니다.
 * - Watchdog은 Consumer를 건드리지 않고 브로커 가용성만 확인합니다.
 *
 * Features:
 * - Batch processing (100 events or 1 second timeout)
 * - Error handling with graceful degradation
 * - State machine-based lifecycle management
 */
@Injectable()
export class MqConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqConsumerService.name);
  private consumer: Consumer | null = null; // 🔥 null로 초기화
  private readonly topic: string;
  private readonly batchSize: number;
  private readonly batchTimeoutMs: number;
  private isRunning = false;
  private batch: LogMessage[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private consecutiveSuccessCount = 0;
  private readonly STABILITY_THRESHOLD = 3;

  constructor(
    private readonly ConsumerClient: KafkaConsumerClient,
    private readonly mongoLogger: MongoLogger,
    private readonly loggingModeService: LoggingModeService, // 🔥 상태 머신 주입
    private readonly configService: ConfigService,
  ) {
    this.topic = this.configService.get<string>('MQ_LOG_TOPIC') || 'log-events';
    this.batchSize = parseInt(
      this.configService.get<string>('MQ_BATCH_SIZE') || '100',
      10,
    );
    this.batchTimeoutMs = parseInt(
      this.configService.get<string>('MQ_BATCH_TIMEOUT_MS') || '1000',
      10,
    );

    // 🔥 상태 변경 감지 - 모드가 변경되면 Consumer를 생성/파괴
    this.loggingModeService.onModeChange((mode) => {
      if (mode === LoggingMode.DIRECT) {
        this.logger.log('Mode changed to DIRECT. Destroying consumer...');
        this.destroyConsumer();
      } else if (mode === LoggingMode.KAFKA) {
        this.logger.log('Mode changed to KAFKA. Starting consumer...');
        this.startConsumer();
      }
    });
  }

  async onModuleInit(): Promise<void> {
    // 초기 모드에 따라 Consumer 시작
    if (this.loggingModeService.getMode() === LoggingMode.KAFKA) {
      await this.startConsumer();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroyConsumer();
    this.stopWatchdog();
  }

  /**
   * Consumer를 생성하고 시작합니다.
   * Kafka가 정상일 때만 호출됩니다.
   */
  private async startConsumer(): Promise<void> {
    if (this.consumer) {
      this.logger.debug('Consumer already exists, skipping...');
      return;
    }

    try {
      // 🔥 Consumer 인스턴스 생성
      this.consumer = await this.ConsumerClient.createAndConnect();

      await this.consumer.subscribe({
        topic: this.topic,
        fromBeginning: false,
      });

      this.isRunning = true;
      this.stopWatchdog();

      this.logger.log(
        `Started MQ consumer for topic: ${this.topic}, group: ${this.ConsumerClient.getGroupId()}`,
      );

      // 🔥 consume() 실행
      this.consume().catch((error) => {
        this.logger.error(
          `Consumer runtime error: ${error.message}`,
          error.stack,
        );
        this.handleConsumerFailure();
      });
    } catch (error) {
      this.logger.error(
        `Failed to start consumer: ${error.message}`,
        error.stack,
      );
      this.handleConsumerFailure();
    }
  }

  /**
   * Consumer를 완전히 파괴합니다.
   * disconnect() 후 반드시 null로 설정하여 GC 대상으로 만듭니다.
   */
  private async destroyConsumer(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    this.isRunning = false;

    try {
      // 배치 처리 중이면 완료 대기
      if (this.batch.length > 0) {
        this.logger.log(
          `Processing final batch of ${this.batch.length} events before destroying consumer...`,
        );
        await this.flushBatch();
      }

      // Consumer 중지
      if (this.consumer) {
        await this.consumer.stop();
      }
    } catch (error) {
      this.logger.warn(`Error stopping consumer: ${error.message}`);
    }

    // 🔥 ConsumerClient를 통해 완전 파괴
    await this.ConsumerClient.destroy();
    this.consumer = null; // 🔥 null로 설정

    // 배치 타이머 정리
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    this.logger.log('Consumer destroyed');
  }

  /**
   * Consumer 실패 시 처리
   * 상태를 DIRECT로 변경하여 Consumer 파괴를 트리거합니다.
   */
  private handleConsumerFailure(): void {
    this.logger.warn(
      'Consumer failure detected. Switching to DIRECT mode and starting watchdog.',
    );

    // 상태를 DIRECT로 변경 (이것이 Consumer 파괴를 트리거함)
    this.loggingModeService.setMode(LoggingMode.DIRECT);

    // Watchdog 시작
    this.startWatchdog();
  }

  /**
   * Watchdog: Kafka 브로커 가용성만 확인
   * Consumer를 절대 건드리지 않습니다.
   */
  private startWatchdog(): void {
    if (this.watchdogTimer) {
      return;
    }

    this.consecutiveSuccessCount = 0;
    this.logger.log(
      'Watchdog started. Monitoring Kafka broker availability...',
    );

    this.watchdogTimer = setInterval(async () => {
      try {
        const isAvailable = await this.ConsumerClient.checkBrokerAvailability();

        if (isAvailable) {
          this.consecutiveSuccessCount++;
          this.logger.debug(
            `Watchdog: Kafka available (${this.consecutiveSuccessCount}/${this.STABILITY_THRESHOLD})`,
          );

          if (this.consecutiveSuccessCount >= this.STABILITY_THRESHOLD) {
            this.logger.log(
              'Watchdog: Kafka is stable. Switching to KAFKA mode...',
            );
            this.consecutiveSuccessCount = 0;
            this.stopWatchdog();

            // 🔥 상태 변경만 하면 됨 - onModeChange 콜백이 Consumer를 생성함
            this.loggingModeService.setMode(LoggingMode.KAFKA);
          }
        } else {
          this.consecutiveSuccessCount = 0;
          this.logger.debug('Watchdog: Kafka still offline.');
        }
      } catch (error) {
        this.consecutiveSuccessCount = 0;
        this.logger.debug(`Watchdog error: ${error.message}`);
      }
    }, 60000); // 1분마다 체크
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async consume(): Promise<void> {
    if (!this.consumer) {
      throw new Error('Consumer instance does not exist');
    }

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          if (!message.value) {
            this.logger.warn('Received message with no value');
            return;
          }

          const logMessage: LogMessage = JSON.parse(message.value.toString());
          this.batch.push(logMessage);

          // Process batch if it reaches the size limit
          if (this.batch.length >= this.batchSize) {
            await this.flushBatch();
          } else {
            // Set timeout for batch processing
            this.scheduleBatchFlush();
          }
        } catch (error) {
          this.logger.error(
            `Error processing message from topic ${topic}, partition ${partition}: ${error.message}`,
            error.stack,
          );
        }
      },
      // Disable KafkaJS auto-restart - we handle recovery via state machine
      restartOnFailure: async (error) => {
        this.logger.warn(
          `Consumer error: ${error.message}. Disabling KafkaJS auto-restart.`,
        );
        // 🔥 false 반환하여 KafkaJS 자동 재시작 비활성화
        // 상태 머신이 Consumer 파괴 및 복구를 관리합니다.
        return false;
      },
    } as any); // Type assertion: restartOnFailure is supported in KafkaJS but may not be in TypeScript types yet
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimeout) {
      return;
    }

    this.batchTimeout = setTimeout(async () => {
      this.batchTimeout = null;
      if (this.batch.length > 0) {
        await this.flushBatch();
      }
    }, this.batchTimeoutMs);
  }

  private async flushBatch(): Promise<void> {
    if (this.batch.length === 0) {
      return;
    }

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    const batchToProcess = [...this.batch];
    this.batch = [];

    await this.processBatch(batchToProcess);
  }

  private async processBatch(batch: LogMessage[]): Promise<void> {
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;

    for (const message of batch) {
      try {
        await this.mongoLogger.log(
          message.event,
          message._metadata,
          message.summary,
        );
        successCount++;
      } catch (error) {
        failureCount++;
        this.logger.error(
          `Failed to persist log event (requestId: ${message.event.requestId}): ${error.message}`,
          error.stack,
        );
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Processed batch: ${batch.length} events (${successCount} success, ${failureCount} failures) in ${duration}ms`,
    );
  }
}
