import { Consumer } from "kafkajs";

export abstract class MqConsumerPort {
  abstract subscribe(topic: string): Promise<void>;
  abstract unsubscribe(topic: string): Promise<void>;
  abstract getConsumer(): Consumer;
}
