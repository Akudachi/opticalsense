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

  // Pattern matching for MQTT wildcards
  private topicMatches(pattern: string, topic: string): boolean {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');
    
    if (patternParts.length !== topicParts.length) return false;
    
    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const topicPart = topicParts[i];
      
      if (patternPart === '+') continue; // Single level wildcard
      if (patternPart === '#') return true; // Multi level wildcard (not used here)
      if (patternPart !== topicPart) return false;
    }
    
    return true;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // If already connected, just resolve
      if (this.client?.connected) {
        console.log('MQTT already connected - skipping connect()');
        resolve();
        return;
      }

      // If client exists but not connected, end it first
      if (this.client) {
        console.log('MQTT client exists but not connected - cleaning up...');
        this.client.end();
        this.client = null;
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
        
        // CRITICAL FIX: Clear any retained messages on pair/response topics from previous testing
        // This prevents devices from auto-pairing due to old retained SUCCESS messages
        console.log('Clearing retained messages from pair/response topics...');
        this.client!.publish(`${env.MQTT.topicPrefix}/device/+/pair/response`, '', { retain: true, qos: 1 });
        console.log('Cleared retained pair/response messages');
        
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
        console.log('Message content:', message.toString());
        
        // Check all registered patterns to find matches
        let matchedCallbacks = false;
        for (const [pattern, callbacks] of this.messageCallbacks.entries()) {
          if (this.topicMatches(pattern, topic)) {
            console.log(`Pattern ${pattern} matches topic ${topic}`);
            callbacks.forEach(cb => cb(topic, message));
            matchedCallbacks = true;
          }
        }
        
        if (!matchedCallbacks) {
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

  publish(topic: string, message: string, options?: { retain?: boolean; qos?: number }): void {
    if (!this.client?.connected) {
      console.error('Cannot publish - MQTT client not connected');
      return;
    }
    
    console.log('Publishing to topic:', topic);
    console.log('Message:', message);
    this.client.publish(topic, message, options);
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
