# @gibme/rabbitmq

A simplified, event-driven RabbitMQ client library for Node.js with TypeScript support.

Provides request/reply (RPC) and publish/subscribe messaging patterns with automatic reconnection.

## Documentation

[https://gibme-npm.github.io/rabbitmq/](https://gibme-npm.github.io/rabbitmq/)

## Requirements

- Node.js >= 22
- RabbitMQ server

## Installation

```bash
npm install @gibme/rabbitmq
```

or

```bash
yarn add @gibme/rabbitmq
```

## Quick Start

```typescript
import RabbitMQ from "@gibme/rabbitmq";

const client = new RabbitMQ({
    host: "localhost",
    user: "guest",
    password: "guest",
});

await client.connect();
```

## Connection Options

| Option | Type | Default | Description |
|---|---|---|---|
| `host` | `string` | *required* | RabbitMQ server hostname |
| `port` | `number` | `5672` | Server port |
| `user` | `string` | | Authentication username |
| `password` | `string` | | Authentication password |
| `virtualHost` | `string` | | Virtual host path |
| `autoReconnect` | `boolean` | `true` | Automatically reconnect on disconnection |
| `query` | `string` | | Connection query string parameters |

## Usage

### Request / Reply (RPC)

Send a message and wait for a response from a consumer:

```typescript
import RabbitMQ from "@gibme/rabbitmq";

interface Payload {
    data: number;
}

const client = new RabbitMQ({ host: "localhost" });
await client.connect();

const queue = "rpc-queue";
await client.createQueue(queue);

// Set up the consumer (worker)
client.on<Payload>("message", async (q, message, payload) => {
    if (q === queue) {
        await client.reply(message, { data: payload.data + 1 });
    } else {
        await client.nack(message);
    }
});

await client.registerConsumer(queue);

// Send a request and await the reply
const reply = await client.requestReply<Payload, Payload>(queue, { data: 10 }, 15_000);
console.log(reply.data); // 11
```

### Publish / Subscribe (Worker Queue)

Push messages to a queue for processing by consumers:

```typescript
import RabbitMQ from "@gibme/rabbitmq";

interface Job {
    task: string;
}

const client = new RabbitMQ({ host: "localhost" });
await client.connect();

const queue = "work-queue";
await client.createQueue(queue);

// Set up the consumer
client.on<Job>("message", async (q, message, payload) => {
    if (q === queue) {
        console.log("Processing:", payload.task);
        await client.ack(message);
    } else {
        await client.nack(message);
    }
});

await client.registerConsumer(queue);

// Publish a message
await client.sendToQueue(queue, { task: "process-image" });
```

## Events

| Event | Listener Signature | Description |
|---|---|---|
| `connect` | `() => void` | Fired when connected to RabbitMQ |
| `disconnect` | `(error: Error) => void` | Fired on disconnection |
| `message` | `(queue: string, message: Message, payload: T) => void` | Fired when a message is consumed |
| `log` | `(entry: Error \| string) => void` | Informational logging (reconnection events, etc.) |

## API

### Connection

- `connect(): Promise<void>` - Connect to the RabbitMQ server
- `close(): Promise<void>` - Close the connection
- `connected: boolean` - Whether the connection is active

### Queue Management

- `createQueue(queue, durable?, exclusive?): Promise<void>` - Create a queue
- `deleteQueue(queue): Promise<void>` - Delete a queue

### Consumer Management

- `registerConsumer<T>(queue, prefetch?): Promise<string>` - Register a consumer, returns a consumer tag
- `cancelConsumer(consumerTag): Promise<void>` - Cancel a consumer
- `prefetch(count): Promise<void>` - Set the channel prefetch count

### Messaging

- `sendToQueue<T>(queue, payload, options?): Promise<boolean>` - Send a message to a queue
- `requestReply<T, R>(queue, payload, timeout?, useOneTimeQueue?): Promise<R>` - Send a request and wait for a reply (RPC)
- `reply<T>(message, payload, noAck?, requeue?): Promise<boolean>` - Reply to a received message
- `ack(message): Promise<void>` - Acknowledge a message
- `nack(message, requeue?): Promise<void>` - Negative-acknowledge a message

## License

MIT
