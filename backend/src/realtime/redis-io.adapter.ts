import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import type { Env } from '@tasker/config';
import { ConfigService } from '@nestjs/config';
import { RedisConnectionFactory } from '../common/redis/redis-connection.factory';

// Custom IoAdapter that wires @socket.io/redis-adapter to the shared Redis
// connection factory. Broadcasts on one API replica reach clients connected
// to any replica via Redis pub/sub.
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private redisAdapter?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const factory = this.app.get(RedisConnectionFactory);
    const { pub, sub } = factory.createPubSubPair();
    await Promise.all([pub.connect(), sub.connect()]);
    this.redisAdapter = createAdapter(pub, sub);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const config = this.app.get<ConfigService<Env, true>>(ConfigService);
    const origins = config
      .get('RT_ALLOWED_ORIGINS')
      .split(',')
      .map((o: string) => o.trim())
      .filter(Boolean);

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: origins,
        credentials: true,
      },
    }) as ReturnType<IoAdapter['createIOServer']>;

    if (this.redisAdapter) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).adapter(this.redisAdapter);
    }
    return server;
  }
}
