import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  LoggingService,
  ContextService,
  MqConsumerService,
} from "libs/logging/service";
import {
  MongoLogger,
  MongoConnectionClient,
  KafkaProducerClient,
  KafkaConsumerClient,
  KafkaProducer,
  KafkaLogger,
} from "@logging/infrastructure";
import { LoggerPort } from "@logging/out-ports";
import { MqProducerPort } from "@logging/out-ports";
import { LoggingInterceptor } from "@logging/presentation";

/**
 * LoggingModule - NestJS module for the logging library.
 *
 * This module is marked as @Global() so it can be imported once in AppModule
 * and used throughout the application without re-importing.
 *
 * Phase 5: MQ Integration
 * - If MQ_ENABLED=true, uses KafkaLogger (publishes to Kafka)
 * - Otherwise, uses MongoLogger directly (synchronous logging)
 * - MqConsumerService runs in background to consume and persist logs
 */
@Global()
@Module({
  providers: [
    MongoConnectionClient,
    // Kafka Infrastructure Clients (Initialization only)
    KafkaProducerClient,
    KafkaConsumerClient,
    // MQ Producer Port (Kafka)
    {
      provide: MqProducerPort,
      useFactory: (
        kafkaProducerClient: KafkaProducerClient,
        configService: ConfigService,
      ) => {
        return new KafkaProducer(kafkaProducerClient, configService);
      },
      inject: [KafkaProducerClient, ConfigService],
    },
    // MongoLogger (used as fallback and by consumer)
    MongoLogger,
    // LoggerPort: MQ adapter if enabled, otherwise direct MongoLogger
    {
      provide: LoggerPort,
      useFactory: (
        kafkaProducer: MqProducerPort,
        mongoLogger: MongoLogger,
        configService: ConfigService,
      ) => {
        const mqEnabled = configService.get<string>("MQ_ENABLED") === "true";
        if (mqEnabled) {
          return new KafkaLogger(kafkaProducer, mongoLogger, configService);
        }
        return mongoLogger;
      },
      inject: [MqProducerPort, MongoLogger, ConfigService],
    },
    // MQ Consumer Service (background worker)
    {
      provide: MqConsumerService,
      useFactory: (
        kafkaConsumerClient: KafkaConsumerClient,
        mongoLogger: MongoLogger,
        configService: ConfigService,
      ) => {
        return new MqConsumerService(
          kafkaConsumerClient,
          mongoLogger,
          configService,
        );
      },
      inject: [KafkaConsumerClient, MongoLogger, ConfigService],
    },
    ContextService,
    LoggingService,
    LoggingInterceptor,
  ],
  exports: [LoggingService, ContextService, LoggingInterceptor],
})
export class LoggingModule {}
