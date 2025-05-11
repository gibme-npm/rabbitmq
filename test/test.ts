// Copyright (c) 2018-2025, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import assert from 'assert';
import { describe, it } from 'mocha';
import RabbitMQ from '../src';
import { config } from 'dotenv';
import { EventEmitter } from 'events';

config();

type SamplePayload = {
    value1: boolean;
    value2: number;
}

describe('Unit Tests', async () => {
    const rabbit = new RabbitMQ({
        host: process.env.MQ_HOST || '127.0.0.1',
        port: parseInt(process.env.MQ_PORT || '5672'),
        user: process.env.MQ_USER || undefined,
        password: process.env.MQ_PASSWORD || undefined,
        virtualHost: process.env.MQ_VHOST || undefined
    });

    const data: SamplePayload = {
        value1: true,
        value2: 1
    };

    const temp_queue = process.env.MQ_TEST_QUEUE || 'testqueue';

    before(async () => {
        await rabbit.connect();
    });

    after(async () => {
        await rabbit.close();
    });

    describe('Basic Tests', async () => {
        it('Connected?', () => {
            assert.equal(rabbit.connected, true);
        });

        it('Create Queue', async () => {
            await rabbit.createQueue(temp_queue);
        });

        it('Delete Queue', async () => {
            await rabbit.deleteQueue(temp_queue);
        });
    });

    describe('Worker / Consumer', async () => {
        let consumer: string;

        before(async () => {
            await rabbit.createQueue(temp_queue);

            consumer = await rabbit.registerConsumer(temp_queue);
        });

        after(async () => {
            await rabbit.cancelConsumer(consumer);

            rabbit.removeAllListeners('message');

            await rabbit.deleteQueue(temp_queue);
        });

        it('Request Reply', async () => {
            rabbit.on<SamplePayload>('message', async (queue, message, payload) => {
                if (queue === temp_queue) {
                    payload.value1 = !payload.value1;
                    payload.value2++;

                    await rabbit.reply(message, payload);
                } else {
                    await rabbit.nack(message);
                }
            });

            await rabbit.registerConsumer(temp_queue);

            const reply = await rabbit.requestReply<SamplePayload, SamplePayload>(temp_queue, data, 10_000);

            assert.notEqual(reply.value1, data.value1);
            assert.equal(reply.value2, data.value2 + 1);
        });
    });

    describe('Push / Publish to Workers', async () => {
        let consumer: string;

        before(async () => {
            await rabbit.createQueue(temp_queue);

            consumer = await rabbit.registerConsumer(temp_queue);
        });

        after(async () => {
            await rabbit.cancelConsumer(consumer);

            rabbit.removeAllListeners('message');

            await rabbit.deleteQueue(temp_queue);
        });

        it('Handle Work', async () => {
            const event = new EventEmitter();

            rabbit.on<SamplePayload>('message', async (queue, message, payload) => {
                if (queue === temp_queue) {
                    await rabbit.ack(message);

                    if (payload.value1 === data.value1 && payload.value2 === data.value2) {
                        event.emit('complete');
                    }
                } else {
                    await rabbit.nack(message);
                }
            });

            await rabbit.sendToQueue(temp_queue, data);

            return new Promise((resolve, reject) => {
                const timer = setTimeout(reject, 5_000);

                event.on('complete', () => {
                    clearTimeout(timer);

                    return resolve();
                });
            });
        });
    });
});
