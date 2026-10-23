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
  private connectPromise: Promise<void> | null = null;

  // Pattern matching for MQTT wildcards
  private topicMatches(pattern: string, topic: string): boolean {
    if (pattern === topic) return true;
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');
    
    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      if (patternPart === '#') return true; // Multi-level wildcard
      if (i >= topicParts.length) return false;
      const topicPart = topicParts[i];
      if (patternPart === '+') continue; // Single-level wildcard
      if (patternPart !== topicPart) return false;
    }
    
    return patternParts.length === topicParts.length;
  }

  connect(): Promise<void> {
    // If already connected, just resolve
    if (this.client?.connected) {
      return Promise.resolve();
    }

    // Reuse in-flight connection promise to avoid tearing down concurrent connections
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      // If client exists but not connected, end it first
      if (this.client) {
        console.log('MQTT client exists but not connected - cleaning up...');
        this.client.end(true);
        this.client = null;
      }

      const wsUrl = `wss://${env.MQTT.host}:8884/mqtt`;
      console.log('Connecting to MQTT:', wsUrl);
      
      this.client = mqtt.connect(wsUrl, {
        username: env.MQTT.username,
        password: env.MQTT.password,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 3000, // Reconnect automatically every 3s if disconnected
      });

      this.client.on('connect', () => {
        console.log('MQTT Connected successfully');
        this.reconnectAttempts = 0;
        this.connectPromise = null;
        this.notifyConnectionCallbacks(true);
        
        // Subscribe to all pending topics that were registered before connection
        for (const topic of this.messageCallbacks.keys()) {
          console.log('Subscribing pending topic on connect:', topic);
          this.client!.subscribe(topic);
        }
        
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('MQTT Error:', err);
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('Max reconnect attempts reached');
          this.connectPromise = null;
          this.notifyConnectionCallbacks(false);
          reject(err);
        }
      });

      this.client.on('close', () => {
        console.log('MQTT Connection closed');
        this.connectPromise = null;
        this.notifyConnectionCallbacks(false);
      });

      this.client.on('reconnect', () => {
        console.log('MQTT Reconnecting...');
      });

      this.client.on('offline', () => {
        console.log('MQTT Client offline');
        this.connectPromise = null;
      });

      this.client.on('message', (topic, message) => {
        // Check all registered patterns to find matches
        let matchedCallbacks = false;
        for (const [pattern, callbacks] of this.messageCallbacks.entries()) {
          if (this.topicMatches(pattern, topic)) {
            callbacks.forEach(cb => cb(topic, message));
            matchedCallbacks = true;
          }
        }
        
        if (!matchedCallbacks) {
          console.log('No callbacks registered for topic:', topic);
        }
      });
    });

    return this.connectPromise;
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connectPromise = null;
      this.notifyConnectionCallbacks(false);
    }
  }

  subscribe(topic: string, callback: MessageCallback): () => void {
    if (!this.messageCallbacks.has(topic)) {
      this.messageCallbacks.set(topic, new Set());
      
      if (this.client?.connected) {
        this.client.subscribe(topic);
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

  async publish(
    topic: string,
    message: string,
    options?: { retain?: boolean; qos?: 0 | 1 | 2 }
  ): Promise<boolean> {
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (err) {
        console.error('Cannot publish - MQTT connection failed:', err);
        return false;
      }
    }

    return new Promise((resolve) => {
      this.client?.publish(topic, message, options || { qos: 1 }, (err) => {
        if (err) {
          console.error('Publish error on topic', topic, err);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
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
