/**
 * MQTT Client for HiveMQ Cloud
 * Handles WebSocket connections to receive device telemetry
 */
import mqtt, { MqttClient } from 'mqtt';
import { env } from '@/config/env';

type MessageCallback = (topic: string, message: Buffer) => void;
type ConnectionCallback = (connected: boolean) => void;

class MQTTClient {
  private client: MqttClient | null = null;
  private messageCallbacks: Map<string, Set<MessageCallback>> = new Map();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.client?.connected) {
        console.log('MQTT already connected');
        resolve();
        return;
      }

      const wsUrl = `wss://${env.MQTT.host}:8884/mqtt`;
      console.log('Connecting to MQTT:', wsUrl);
      
      this.client = mqtt.connect(wsUrl, {
        username: env.MQTT.username,
        password: env.MQTT.password,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 5000,
      });

      this.client.on('connect', () => {
        console.log('MQTT Connected successfully');
        this.reconnectAttempts = 0;
        this.notifyConnectionCallbacks(true);
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('MQTT Error:', err);
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.notifyConnectionCallbacks(false);
          reject(err);
        }
      });

      this.client.on('close', () => {
        console.log('MQTT Connection closed');
        this.notifyConnectionCallbacks(false);
      });

      this.client.on('message', (topic, message) => {
        console.log('MQTT message received on topic:', topic);
        const callbacks = this.messageCallbacks.get(topic);
        if (callbacks) {
          callbacks.forEach(cb => cb(topic, message));
        } else {
          console.log('No callbacks registered for topic:', topic);
        }
      });
    });
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.notifyConnectionCallbacks(false);
    }
  }

  subscribe(topic: string, callback: MessageCallback): () => void {
    console.log('Subscribing to topic:', topic);
    if (!this.messageCallbacks.has(topic)) {
      this.messageCallbacks.set(topic, new Set());
      
      if (this.client?.connected) {
        console.log('Client connected, subscribing to:', topic);
        this.client.subscribe(topic);
      } else {
        console.log('Client not connected yet, will subscribe when connected');
      }
    }

    this.messageCallbacks.get(topic)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.messageCallbacks.get(topic);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.messageCallbacks.delete(topic);
          if (this.client?.connected) {
            this.client.unsubscribe(topic);
          }
        }
      }
    };
  }

  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback);
    
    // Immediately notify with current state
    if (this.client) {
      callback(this.client.connected);
    }

    return () => {
      this.connectionCallbacks.delete(callback);
    };
  }

  private notifyConnectionCallbacks(connected: boolean): void {
    this.connectionCallbacks.forEach(cb => cb(connected));
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

// Singleton instance
export const mqttClient = new MQTTClient();
