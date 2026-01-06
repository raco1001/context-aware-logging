import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import pathConfig from "@config/utils/path.config";
import { LoggingModule } from "@logging";
import { PaymentsModule } from "@payments";
import { EmbeddingsModule } from "@embeddings";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      load: [pathConfig],
    }),
    LoggingModule.forRoot(),
    ...(process.env.STORAGE_TYPE === "file" ? [] : [EmbeddingsModule]),
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
