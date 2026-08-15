require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// MQTT Connection
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  reconnectPeriod: 5000
});

// Track device last seen timestamps for offline detection
const deviceLastSeen = new Map();
const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'opticalsense';

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  mqttClient.subscribe(`${topicPrefix}/device/+/telemetry`);
  mqttClient.subscribe(`${topicPrefix}/device/+/status`);
  mqttClient.subscribe(`${topicPrefix}/device/+/command/response`);
  mqttClient.subscribe(`${topicPrefix}/device/+/pair/request`);
  mqttClient.subscribe(`${topicPrefix}/device/+/heartbeat`);
  mqttClient.subscribe(`${topicPrefix}/device/+/status/+`); // For device online/offline status updates
});

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log(`MQTT Message [${topic}]:`, data);

    // Extract device ID from topic
    const deviceId = data.deviceId || (topic.match(/device\/([^\/]+)/)?.[1]);

    // Update device last seen time for any message FROM a device (not backend-generated status)
    // Only update if the message is from the device itself (telemetry, heartbeat, status, commands)
    // Do NOT update for backend-generated status/offline messages to prevent loops
    if (deviceId && !topic.includes('/status/offline') && !topic.includes('/status/online')) {
      deviceLastSeen.set(deviceId, Date.now());
      console.log(`Updated last seen for device ${deviceId}: ${new Date().toISOString()}`);
    }

    // Handle pairing requests
    if (topic.includes('pair/request')) {
      console.log('Received pairing request from device:', data.deviceId);
      console.log('Pairing code:', data.pairingCode);
      console.log('Full topic:', topic);

      // Publish pairing response back to the specific device
      const responseTopic = `${topicPrefix}/device/${data.deviceId}/pair/response`;
      const responseData = {
        status: 'SUCCESS',
        deviceId: data.deviceId,
        clinicId: 'demo-clinic-id',
        clinicName: 'Demo Clinic',
        deviceName: data.name || data.deviceId,
        timestamp: new Date().toISOString()
      };

      console.log('Response topic:', responseTopic);
      console.log('Response data:', JSON.stringify(responseData));

      mqttClient.publish(responseTopic, JSON.stringify(responseData), { retain: true, qos: 1 });
      console.log('Published pairing response to:', responseTopic);
    }

    // Bridge MQTT messages to Socket.IO
    if (topic.includes('telemetry')) {
      // Normalize GY-MAX3010x data format for frontend compatibility
      const normalizedData = {
        ...data,
        online: true,
        // Ensure GY-MAX3010x specific fields are properly handled
        redRaw: data.redRaw || 0,
        irRaw: data.irRaw || 0,
        fingerDetected: data.fingerDetected || false,
        stableSampleCount: data.stableSampleCount || 0,
        redFiltered: data.redFiltered || 0,
        irFiltered: data.irFiltered || 0,
        redAC: data.redAC || 0,
        redDC: data.redDC || 0,
        irAC: data.irAC || 0,
        irDC: data.irDC || 0,
        testDuration: data.testDuration || 0,
        // Legacy field compatibility
        probeOnTooth: data.fingerDetected || false, // Map fingerDetected to probeOnTooth for compatibility
        ambient: data.ambient || 0, // Keep for backward compatibility
      };

      // Emit to both test-specific room and device-specific room
      io.to(`test-${data.testId}`).emit('telemetry', normalizedData);
      io.to(`device-${data.deviceId}`).emit('telemetry', normalizedData);

      console.log('Bridged telemetry to Socket.IO for device:', data.deviceId);
    }

    // Handle heartbeat - also emit device status update via MQTT and Socket.IO
    if (topic.includes('heartbeat') && deviceId) {
      const statusTopic = `${topicPrefix}/device/${deviceId}/status/online`;
      const statusData = {
        deviceId,
        online: true,
        status: 'online',
        lastSeen: new Date().toISOString(),
        deviceState: data.state,
        battery: data.battery,
        wifi: data.wifi,
        mqtt: data.mqtt
      };
      mqttClient.publish(statusTopic, JSON.stringify(statusData));
      io.to(`device-${deviceId}`).emit('device_status', statusData);
    }
  } catch (err) {
    console.error('Error parsing MQTT message:', err);
  }
});

// Check for offline devices every 5 seconds
setInterval(() => {
  const now = Date.now();
  const offlineThreshold = 30000; // Increased to 30 seconds to prevent false offline detection

  console.log(`Checking offline devices - tracked devices: ${deviceLastSeen.size}`);

  deviceLastSeen.forEach((lastSeen, deviceId) => {
    const timeSinceLastSeen = now - lastSeen;
    console.log(`Device ${deviceId}: last seen ${Math.floor(timeSinceLastSeen / 1000)}s ago`);

    if (timeSinceLastSeen > offlineThreshold) {
      // Device is offline - publish via MQTT and Socket.IO for frontend to receive
      const statusTopic = `${topicPrefix}/device/${deviceId}/status/offline`;
      const statusData = {
        deviceId,
        online: false,
        status: 'offline',
        lastSeen: new Date(lastSeen).toISOString()
      };
      mqttClient.publish(statusTopic, JSON.stringify(statusData));
      io.to(`device-${deviceId}`).emit('device_status', statusData);
      console.log(`Device ${deviceId} marked as offline (last seen ${Math.floor(timeSinceLastSeen / 1000)}s ago)`);
      deviceLastSeen.delete(deviceId);
    }
  });
}, 5000);

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_test_room', ({ testId }) => {
    socket.join(`test-${testId}`);
    console.log(`Socket ${socket.id} joined test room: ${testId}`);
  });

  socket.on('leave_test_room', ({ testId }) => {
    socket.leave(`test-${testId}`);
    console.log(`Socket ${socket.id} left test room: ${testId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mqtt: mqttClient.connected ? 'connected' : 'disconnected' });
});

// Import routes (to be implemented)
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/patients', require('./routes/patients'));
// app.use('/api/tests', require('./routes/tests'));
// app.use('/api/reports', require('./routes/reports'));
// app.use('/api/devices', require('./routes/devices'));
// app.use('/api/clinic', require('./routes/clinic'));
// app.use('/api/activity', require('./routes/activity'));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
