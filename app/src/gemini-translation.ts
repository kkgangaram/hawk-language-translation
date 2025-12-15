import WebSocket from 'ws';
import { ServerSession, AudioFrame, normalizeError, OpenTransactionContext } from '../audiohook';
import { PubSub } from '@google-cloud/pubsub';
import * as grpc from '@grpc/grpc-js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
const PUBSUB_TOPIC_ID = process.env.PUBSUB_TOPIC_ID;
const GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;

const MAX_BUFFER_SIZE = 500; // Limit buffer 

class GeminiSession {
    private ws: WebSocket | null = null;
    private channelName: string;
    private session: ServerSession;
    private topic: any;
    private conversationId: string;
    private audioBuffer: any[] = [];
    private isReconnecting: boolean = false;
    private reconnectDelay: number = 1000;
    private isClosed: boolean = false;

    // Batching state
    private pendingAudioChunks: Buffer[] = [];
    private batchInterval: NodeJS.Timeout | null = null;
    private readonly BATCH_MS = 100;
    private currentRate: number = 0;

    constructor(channelName: string, session: ServerSession, topic: any, conversationId: string) {
        this.channelName = channelName;
        this.session = session;
        this.topic = topic;
        this.conversationId = conversationId;

        this.connect();
        this.startBatcher();
    }

    private startBatcher() {
        this.batchInterval = setInterval(() => {
            this.flushAudioBatch();
        }, this.BATCH_MS);
    }

    private flushAudioBatch() {
        if (this.pendingAudioChunks.length === 0) return;

        // Combine all pending PCM data into one buffer
        const combinedBuffer = Buffer.concat(this.pendingAudioChunks as Uint8Array[]);
        this.pendingAudioChunks = []; // Clear pending

        const base64Audio = combinedBuffer.toString('base64');

        const realTimeInput = {
            realtime_input: {
                media_chunks: [
                    {
                        mime_type: `audio/pcm;rate=${this.currentRate}`,
                        data: base64Audio
                    }
                ]
            }
        };

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(realTimeInput));
        } else {
            // Buffer if not open (connecting or reconnecting)
            if (this.audioBuffer.length < MAX_BUFFER_SIZE) {
                this.audioBuffer.push(realTimeInput);
            } else {
                // Drop oldest packet if buffer full
                this.session.logger.warn(`[${this.channelName}] Audio buffer full (${MAX_BUFFER_SIZE}), dropping oldest packet to make room.`);
                this.audioBuffer.shift();
                this.audioBuffer.push(realTimeInput);
            }
        }
    }

    private connect() {
        if (this.isClosed) return;

        try {
            this.ws = new WebSocket(GEMINI_URL);

            this.ws.on('open', () => {
                this.session.logger.info(`[${this.channelName}] Connected to Gemini Live API`);
                this.isReconnecting = false;
                this.reconnectDelay = 1000; // Reset backoff

                // Initial setup message
                const setupMessage = {
                    setup: {
                        model: "models/gemini-2.0-flash-exp",
                        generation_config: {
                            response_modalities: ["TEXT"],
                            speech_config: {
                                voice_config: { prebuilt_voice_config: { voice_name: "Puck" } }
                            }
                        },
                        system_instruction: {
                            parts: [
                                { text: "You are a translator. Your task is to listen to the audio stream and translate it into English text. The audio may contain English or Tagalog or Spanish or French or Contonese or Mandarin or Vietnamese. If it is English, transcribe it exactly. If it is Tagalog or Spanish or French or Contonese or Mandarin or Vietnamese, translate it to English. Output only the English translation/transcription. Do not engage in conversation." }
                            ]
                        }
                    }
                };
                this.ws?.send(JSON.stringify(setupMessage));

                // Flush buffered audio (old full messages)
                if (this.audioBuffer.length > 0) {
                    this.session.logger.info(`[${this.channelName}] Flushing ${this.audioBuffer.length} buffered audio packets.`);
                    while (this.audioBuffer.length > 0) {
                        const msg = this.audioBuffer.shift();
                        this.ws?.send(JSON.stringify(msg));
                    }
                }
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.serverContent?.modelTurn?.parts) {
                        for (const part of response.serverContent.modelTurn.parts) {
                            if (part.text) {
                                this.session.logger.info(`[${this.channelName}] Gemini Translation: ${part.text}`);
                                if (this.topic) {
                                    const messageBuffer = Buffer.from(JSON.stringify({
                                        originaltext: part.original_text || "",
                                        translatedtext: part.text,
                                        timestamp: new Date().toISOString(),
                                        conversationId: this.conversationId,
                                        channel: this.channelName
                                    }));
                                    this.topic.publishMessage({ data: messageBuffer }).catch((err: any) => {
                                        this.session.logger.error(`[${this.channelName}] Failed to publish to Pub/Sub: ${normalizeError(err).message}`);
                                    });
                                }
                            }
                        }
                    }
                } catch (err) {
                    this.session.logger.error(`[${this.channelName}] Error parsing Gemini message: ${normalizeError(err).message}`);
                }
            });

            this.ws.on('error', (err) => {
                this.session.logger.error(`[${this.channelName}] Gemini WebSocket error: ${normalizeError(err).message}`);
            });

            this.ws.on('close', (code, reason) => {
                this.session.logger.info(`[${this.channelName}] Gemini WebSocket closed: ${code} - ${reason}`);
                if (!this.isClosed) {
                    this.reconnect();
                }
            });

        } catch (err) {
            this.session.logger.error(`[${this.channelName}] Failed to create WebSocket: ${normalizeError(err).message}`);
            this.reconnect();
        }
    }

    private reconnect() {
        if (this.isClosed || this.isReconnecting) return;

        this.isReconnecting = true;
        this.session.logger.warn(`[${this.channelName}] Attempting to reconnect to Gemini in ${this.reconnectDelay}ms...`);

        setTimeout(() => {
            if (this.isClosed) return;

            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Exponential backoff max 30s
            this.connect();
        }, this.reconnectDelay);
    }

    public sendAudio(base64Audio: string, rate: number) {
        // Just store the buffer for batching
        const buffer = Buffer.from(base64Audio, 'base64');
        this.pendingAudioChunks.push(buffer);
        this.currentRate = rate; // Update rate (assumed constant usually)
    }

    public close() {
        this.isClosed = true;
        if (this.batchInterval) {
            clearInterval(this.batchInterval);
            this.batchInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

export const addGeminiTranslation = (session: ServerSession) => {
    if (!GEMINI_API_KEY) {
        session.logger.error('GEMINI_API_KEY is not set. Gemini Translation will not be active.');
        return;
    }

    process.env.GOOGLE_CLOUD_USE_BROWSER_BUILD = "false";
    let pubsub: PubSub | null = null;
    let topic: any = null;

    if (PUBSUB_TOPIC_ID && GOOGLE_CLOUD_PROJECT_ID) {
        try {
            pubsub = new PubSub({
                projectId: GOOGLE_CLOUD_PROJECT_ID,
                grpc
            });
            topic = pubsub.topic(PUBSUB_TOPIC_ID);
            session.logger.info(`Initialized Pub/Sub for topic: ${PUBSUB_TOPIC_ID}`);
        } catch (err) {
            session.logger.error(`Failed to initialize Pub/Sub: ${normalizeError(err).message}`);
        }
    } else {
        session.logger.warn('PUBSUB_TOPIC_ID or GOOGLE_CLOUD_PROJECT_ID not set. Pub/Sub publishing disabled.');
    }

    let currentConversationId = '';
    session.addOpenHandler((context: OpenTransactionContext) => {
        currentConversationId = context.openParams.conversationId;
        session.logger.info(`Captured conversationId: ${currentConversationId}`);
    });

    const geminiSessions: Map<string, GeminiSession> = new Map();

    // Hook into audio stream
    let firstFrameLogged = false;
    session.on('audio', (frame: AudioFrame<string>) => {
        if (!firstFrameLogged) {
            session.logger.info(`Received first AudioFrame: Rate=${frame.rate}, Channels=${JSON.stringify(frame.channels)}, Format=${frame.format}, Duration=${frame.duration}ms`);
            firstFrameLogged = true;
        }

        // Ensure L16 format (Linear PCM 16-bit)
        const l16Frame = frame.as('L16');

        for (const channelName of l16Frame.channels) {
            let geminiSession = geminiSessions.get(channelName);
            if (!geminiSession) {
                // Initialize new session for this channel
                geminiSession = new GeminiSession(channelName, session, topic, currentConversationId);
                geminiSessions.set(channelName, geminiSession);
                session.logger.info(`Created Gemini session for channel: ${channelName}`);
            }

            const channelView = l16Frame.getChannelView(channelName);
            const buffer = Buffer.from(channelView.data.buffer, channelView.data.byteOffset, channelView.data.byteLength);
            const base64Audio = buffer.toString('base64');
            const rate = l16Frame.rate;

            geminiSession.sendAudio(base64Audio, rate);
        }
    });

    // Handle protocol events for debugging gaps
    session.on('discarded', (params) => {
        session.logger.warn(`[Session] Audio DISCARDED by client: Start=${params.start}, Duration=${params.discarded}`);
    });

    session.on('paused', () => {
        session.logger.info('[Session] Audio stream PAUSED');
    });

    session.on('resumed', (params) => {
        session.logger.info(`[Session] Audio stream RESUMED: Start=${params.start}, Discarded=${params.discarded}`);
    });

    // Clean up on session close
    session.addCloseHandler(() => {
        for (const geminiSession of geminiSessions.values()) {
            geminiSession.close();
        }
        geminiSessions.clear();
    });
};
