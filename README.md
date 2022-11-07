# Simple RabbitMQ Helper Library

```typescript
import RabbitMQ from "@gibme/rabbitmq";

interface Payload {
    data: number;
}

(async () => {
    const client = new RabbitMQ({
        host: 'somehost',
        user: 'someuser',
        password: 'somepassword'
    });
    
    const listenQueue = 'somequeue';
    
    await client.connect();

    // request/reply
    {
        // worker/consumer
        {
            client.on<Payload>('message', async (queue, message, payload) => {
                if (queue === listenQueue) {
                    console.log(payload.data);

                    await client.reply(message, {data: payload.data++});
                } else {
                    await client.nack(message);
                }
            });

            await client.registerConsumer(listenQueue);
        }

        // sender
        {
            const reply = await client.requestReply<Payload, Payload>(listenQueue, {data: 10});

            console.log(reply.data);
        }
    }

    // push/publish
    {
        // worker/consumer
        {
            client.on<Payload>('message', async (queue, message, payload) => {
                if (queue === listenQueue) {
                    console.log(payload.data);

                    await client.ack(message);
                } else {
                    await client.nack(message);
                }
            });

            await client.registerConsumer(listenQueue);
        }

        // sender
        {
            await client.sendToQueue(listenQueue, {data: 10});
        }
    }
})()
```
