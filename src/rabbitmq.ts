// Copyright (c) 2018-2022, Brandon Lehmann <brandonlehmann@gmail.com>
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

import amqplib from 'amqplib';
import { EventEmitter } from 'events';
import { v4 as UUID } from 'uuid';
import AbortController from 'abort-controller';
import Message = amqplib.Message;
import Channel = amqplib.Channel;
import ConsumeMessage = amqplib.ConsumeMessage;
import PublishOptions = amqplib.Options.Publish;
import Connection = amqplib.Connection;

export { Message, Channel, PublishOptions };

export interface OptionalOptions {
    /**
     * @default true
     */
    autoReconnect: boolean;
    /**
     * @default 5672
     */
    port: number;
    user: string;
    password: string;
    virtualHost: string;
    query: string;
}

export interface RequiredOptions {
    host: string;
}

export interface ConnectionOptions extends RequiredOptions, Partial<OptionalOptions> {}

export default class RabbitMQ extends EventEmitter {
    public readonly replyQueue = this.uuid();
    private readonly connectionString;
    private channel?: Channel;
    private connection?: Connection;

    /**
     * Creates a new instance of the RabbitMQ helper
     *
     * @param options
     */
    constructor (public readonly options: ConnectionOptions) {
        super();

        options.autoReconnect ??= true;

        this.connectionString = this.buildConnectionString(options);

        if (this.options.autoReconnect) {
            this.on('disconnect', error => {
                this.emit('log', error.toString());
                this.emit('log', 'Reconnecting to server...');

                this.connect()
                    .then(() => this.emit('log', 'Reconnected'))
                    .catch(error => this.emit('log', error.toString()));
            });
        }
    }

    /**
     * Returns if the server is connected
     */
    public get connected (): boolean {
        return this.connection?.connection.serverProperties.version !== 'undefined';
    }

    public on(event: 'disconnect', listener: (error: Error) => void): this;

    public on(event: 'connect', listener: () => void): this;

    public on(event: 'log', listener: (entry: Error | string) => void): this;

    /** @ignore */
    public on(event: 'reply', listener: (message: ConsumeMessage) => void): this;

    public on<T>(event: 'message', listener: (queue: string, message: Message, payload: T) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Acknowledges the receipt of a message from the server
     * This should only be called on messages that have successfully processed
     * or that you want to remove from the queue so that it is not retried again
     *
     * @param message
     */
    public async ack (message: Message): Promise<void> {
        return this.channel?.ack(message);
    }

    /**
     * Connects to the RabbitMQ server
     */
    public async connect (): Promise<void> {
        this.connection = await amqplib.connect(this.connectionString);

        this.connection.on('disconnect', error => this.emit('disconnect', error));

        this.channel = await this.connection.createChannel();

        this.channel.on('disconnect', error => this.emit('disconnect', error));

        await this.createQueue(this.replyQueue, false, true);

        await this.channel.consume(this.replyQueue, message => {
            if (message !== null) {
                this.emit('reply', message);
            }
        });
    }

    /**
     * Closes the connection to the server
     */
    public async close (): Promise<void> {
        const delChannel = (): undefined => {
            delete this.channel;
            return undefined;
        };

        return this.channel?.close() && delChannel() && this.connection?.close();
    }

    /**
     * Creates a new message queue on the server
     *
     * @param queue
     * @param durable
     * @param exclusive
     */
    public async createQueue (
        queue: string,
        durable = true,
        exclusive = false
    ): Promise<void> {
        if (!this.channel) {
            throw new Error('Channel not connected');
        }

        await this.channel.assertQueue(queue, { durable, exclusive });
    }

    /**
     * Deletes a message queue from the server
     *
     * @param queue
     */
    public async deleteQueue (
        queue: string
    ): Promise<void> {
        if (!this.channel) {
            throw new Error('Channel not connected');
        }

        if (queue === this.replyQueue) {
            throw new Error('Cannot delete reply queue');
        }

        await this.channel.deleteQueue(queue);
    }

    /**
     * No-Acknowledges the receipt of a message from the server
     * his should only be called on messages that have not successfully processed or
     * that you do not want to remove from the queue so that it is attempted again
     *
     * @param message
     * @param requeue
     */
    public async nack (message: Message, requeue = true): Promise<void> {
        return this.channel?.nack(message, undefined, requeue);
    }

    /**
     * Sets our RabbitMQ channel to prefetch such that it limits how many unacknowledged messages
     * we can hold in our specific RabbitMQ channel
     *
     * @param count
     */
    public async prefetch (count: number): Promise<void> {
        if (!this.channel) {
            throw new Error('Channel not connected');
        }

        await this.channel.prefetch(count);
    }

    /**
     * Cancels the specified consumer
     *
     * @param consumerTag
     */
    public async cancelConsumer (consumerTag: string): Promise<void> {
        if (!this.channel) {
            throw new Error('Channel not connected');
        }

        await this.channel.cancel(consumerTag);
    }

    /**
     * Registers a consumer of messages on the channel for the specified queue
     *
     * @param queue
     * @param prefetch
     */
    public async registerConsumer<PayloadType = any> (queue: string, prefetch?: number): Promise<string> {
        if (!this.channel) {
            throw new Error('Channel not connected');
        }

        if (prefetch) {
            await this.prefetch(prefetch);
        }

        return (await this.channel.consume(queue, message => {
            if (message !== null) {
                const payload: PayloadType = JSON.parse(message.content.toString());

                this.emit('message', queue, message, payload);
            }
        })).consumerTag;
    }

    /**
     * Replies to the given message with the response payload specified
     *
     * @param message
     * @param payload
     * @param noAck if true, we will not automatically reply to the message with ack/nack
     * @param requeue by default, we requeue the message we are replying to,
     *        if we do not want to requeue, set to false
     */
    public async reply<PayloadType = any> (
        message: Message,
        payload: PayloadType,
        noAck = false,
        requeue = true
    ): Promise<boolean> {
        const success = await this.sendToQueue<PayloadType>(message.properties.replyTo, payload, {
            correlationId: message.properties.correlationId
        });

        if (noAck) {
            return success;
        }

        if (success) {
            await this.ack(message);

            return true;
        }

        await this.nack(message, requeue);

        return false;
    }

    /**
     * Sends a message to the specified queue requesting that we receipt a reply
     * from the worker that handles the message. This method will wait for the
     * worker to complete the request and the reply is received before the promise
     * will resolve
     *
     * @param queue
     * @param payload
     * @param timeout the amount of time (ms) that we are willing to wait for a reply.
     *        If timeout is 0, will wait indefinitely
     * @param useOneTimeQueue whether we should use a one-time use queue to receive the reply
     *        (this may be necessary in some use cases)
     */
    public async requestReply<PayloadType = any, ResponseType = any> (
        queue: string,
        payload: PayloadType,
        timeout = 15_000,
        useOneTimeQueue = false
    ): Promise<ResponseType> {
        let _timer: NodeJS.Timeout;

        const replyQueue = useOneTimeQueue ? this.uuid() : this.replyQueue;

        const requestId = this.uuid();

        const controller = new AbortController();

        return new Promise((resolve, reject) => {
            const timeoutListener = () =>
                reject(new Error('Could not complete the request within the specified timeout period'));

            controller.signal.addEventListener('abort', timeoutListener);

            const checkReply = async (message: ConsumeMessage): Promise<void> => {
                if (message.properties.correlationId === requestId) {
                    const response: ResponseType = JSON.parse(message.content.toString());

                    await this.ack(message);

                    if (!controller.signal.aborted) {
                        clearTimeout(_timer);
                    }

                    controller.signal.removeEventListener('abort', timeoutListener);

                    if (!useOneTimeQueue) {
                        this.removeListener('reply', checkReply);
                    } else {
                        await this.deleteQueue(replyQueue);
                    }

                    return resolve(response);
                } else {
                    return this.nack(message);
                }
            };

            (async () => {
                if (!this.channel) {
                    return reject(new Error('Channel not connected'));
                }

                if (!useOneTimeQueue) {
                    this.on('reply', checkReply);
                } else {
                    await this.createQueue(replyQueue, false, true);

                    await this.channel.consume(replyQueue, async (message) => {
                        if (message !== null) {
                            return checkReply(message);
                        }
                    });
                }

                const options: PublishOptions = {
                    correlationId: requestId,
                    replyTo: replyQueue
                };

                if (timeout !== 0) {
                    options.expiration = timeout;
                }

                if (!await this.sendToQueue(queue, payload, options)) {
                    return reject(new Error('Could not send request to queue'));
                }

                if (timeout !== 0) {
                    _timer = setTimeout(() => controller.abort(), timeout);
                }
            })();
        });
    }

    /**
     * Sends a payload to the specified queue for processing by a consumer
     *
     * @param queue
     * @param payload
     * @param options
     */
    public async sendToQueue<PayloadType = any> (
        queue: string,
        payload: PayloadType | Buffer,
        options?: PublishOptions
    ): Promise<boolean> {
        if (!this.channel) {
            throw new Error('Channel not connected');
        }

        if (!(payload instanceof Buffer)) {
            payload = Buffer.from(JSON.stringify(payload));
        }

        return this.channel.sendToQueue(queue, payload, options);
    }

    /**
     * Creates a new formatted UUID
     * @protected
     */
    protected uuid (): string {
        return UUID()
            .toString()
            .replace(/-/g, '');
    }

    /**
     * Builds the connection string from the options
     *
     * @param options
     * @protected
     */
    protected buildConnectionString (options: ConnectionOptions): string {
        const result = ['amqp://'];

        if (options.user) {
            result.push(options.user);

            if (options.password) {
                result.push(`:${options.password}`);
            }

            result.push('@');
        }

        result.push(options.host);

        result.push(`:${options.port || 5672}`);

        if (options.virtualHost) {
            result.push(`/${options.virtualHost}`);
        }

        if (options.query) {
            result.push(`?${options.query}`);
        }

        return result.join('');
    }
}

export { RabbitMQ };
