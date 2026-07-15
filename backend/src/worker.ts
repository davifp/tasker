import 'reflect-metadata';

function keepAlive(): void {
  setInterval(() => {
    // intentional no-op keep-alive tick
  }, 30_000);
}

async function start(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'worker booted', time: Date.now() }));
  keepAlive();
}

start();
