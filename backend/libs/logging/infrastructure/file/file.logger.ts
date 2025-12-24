import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Logger } from '../../core/domain/logger.interface';
import { WideEvent } from '../../core/domain/wide-event';

/**
 * FileLogger - Infrastructure layer implementation of Logger interface.
 * Appends Wide Events as JSON lines to a local file.
 * No business logic, no context construction - pure I/O.
 */
@Injectable()
export class FileLogger implements Logger, OnModuleInit, OnModuleDestroy {
  private readonly logFilePath: string;
  private logFileHandle: fs.FileHandle | null = null;

  constructor() {
    // Default to logs/app.log in the project root
    // Can be overridden via LOG_FILE_PATH environment variable
    this.logFilePath =
      process.env.LOG_FILE_PATH || join(process.cwd(), 'logs', 'app.log');
  }

  async onModuleInit(): Promise<void> {
    // Ensure logs directory exists
    const logDir = join(this.logFilePath, '..');
    try {
      await fs.mkdir(logDir, { recursive: true });
    } catch {
      // Directory might already exist, ignore
    }

    // Open file handle for appending
    try {
      this.logFileHandle = await fs.open(this.logFilePath, 'a');
    } catch {
      // If file open fails, we'll try to create it on first write
      // Silently fail - fallback to fs.appendFile will handle it
      this.logFileHandle = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.logFileHandle) {
      await this.logFileHandle.close();
      this.logFileHandle = null;
    }
  }

  /**
   * Log a Wide Event as a JSON line.
   * Implements the Logger interface contract.
   */
  async log(event: WideEvent): Promise<void> {
    try {
      const jsonLine = JSON.stringify(event) + '\n';

      // Use fs.appendFile for reliability in Phase 1
      // It handles opening, appending, and flushing correctly
      await fs.appendFile(this.logFilePath, jsonLine, 'utf8');
    } catch {
      // Logging failures should not break the application
      // Silently fail - in production, you might want to emit to a fallback logger or metrics
    }
  }
}
