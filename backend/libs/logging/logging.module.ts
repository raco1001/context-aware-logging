import { Module, Global, Provider, DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as dotenv from "dotenv";
import {
  LoggingService,
  ContextService,
  MqConsumerService,
  LoggingModeService,
} from "libs/logging/service";
import {
  MongoLogger,
  MongoConnectionClient,
  KafkaProducerClient,
  KafkaConsumerClient,
  KafkaProducer,
  KafkaLogger,
  FileLogger,
} from "@logging/infrastructure";
import { LoggerPort } from "@logging/out-ports";
import { MqProducerPort } from "@logging/out-ports";
import { LoggingUseCase } from "@logging/in-ports";
import { LoggingInterceptor } from "@logging/presentation";
import { SamplingPolicy } from "@logging/domain";

// Load environment variables immediately to support dynamic module registration
dotenv.config();

/**
 * LoggingModule - NestJS module for the logging library.
 *
 * This module uses a dynamic module pattern with global: true
 * to ensure it's initialized early and destroyed late in the NestJS lifecycle.
 */
@Module({})
export class LoggingModule {
  /**
   * Standard Dynamic Module for Logging.
   * Uses process.env.STORAGE_TYPE to determine which infrastructure to load.
   */
  static forRoot(): DynamicModule {
    const storageType = process.env.STORAGE_TYPE || "mongodb";

    const providers: Provider[] = [
      ContextService,
      SamplingPolicy,
      {
        provide: LoggingUseCase,
        useClass: LoggingService,
      },
      LoggingService,
      LoggingInterceptor,
    ];

    const exports: any[] = [
      LoggingUseCase,
      LoggingService,
      ContextService,
      LoggingInterceptor,
    ];

    if (storageType === "file") {
      console.log("########## File storage type is enabled ##########");
      providers.push(FileLogger);
      providers.push({
        provide: LoggerPort,
        useClass: FileLogger,
      });
      exports.push(LoggerPort);
    } else if (storageType === "mongodb") {
      console.log("########## MongoDB storage type is enabled ##########");
      providers.push(MongoConnectionClient, MongoLogger);
      providers.push({
        provide: LoggerPort,
        useClass: MongoLogger,
      });
      exports.push(LoggerPort);
    } else if (storageType === "kafka") {
      console.log("########## Kafka storage type is enabled ##########");
      providers.push(
        MongoConnectionClient,
        MongoLogger,
        KafkaProducerClient,
        KafkaConsumerClient,
        KafkaProducer,
        LoggingModeService,
        {
          provide: MqProducerPort,
          useClass: KafkaProducer,
        },
        {
          provide: LoggerPort,
          useFactory: (producer, mongo, modeService, config) =>
            new KafkaLogger(producer, mongo, modeService, config),
          inject: [
            MqProducerPort,
            MongoLogger,
            LoggingModeService,
            ConfigService,
          ],
        },
        MqConsumerService,
      );
      exports.push(LoggerPort, MqProducerPort);
    }

    return {
      global: true,
      module: LoggingModule,
      providers: providers,
      exports: exports,
    };
  }
}
