import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { promises as fs } from "fs";
import { join, dirname } from "path";
import { ConfigService } from "@nestjs/config";
import { LoggerPort } from "@logging/out-ports";
import { WideEvent } from "@logging/domain";

/**
 * FileLogger - Infrastructure layer implementation of Logger interface.
 * Appends Wide Events as JSON lines to a local file.
 * No business logic, no context construction - pure I/O.
 */
@Injectable()
export class FileLogger
  extends LoggerPort
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logFilePath: string;
  private logFileHandle: fs.FileHandle | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
    const projectRoot = this.configService.get<string>("paths.projectRoot");

    if (!projectRoot) {
      throw new Error("Project root path not configured");
    }

    this.logFilePath =
      this.configService.get<string>("LOG_FILE_PATH") ||
      join(projectRoot, "logs", "app.log");
  }

  async onModuleInit(): Promise<void> {
    const logDir = dirname(this.logFilePath);
    try {
      await fs.mkdir(logDir, { recursive: true });
    } catch {}

    try {
      this.logFileHandle = await fs.open(this.logFilePath, "a");
    } catch {
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
      const jsonLine = JSON.stringify(event) + "\n";

      await fs.appendFile(this.logFilePath, jsonLine, "utf8");
    } catch {
      // Future:Silently fail and emit to a fallback logger or metrics.
    }
  }
}
