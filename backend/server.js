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

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'opticalsense';
  mqttClient.subscribe(`${topicPrefix}/device/+/telemetry`);
  mqttClient.subscribe(`${topicPrefix}/device/+/status`);
  mqttClient.subscribe(`${topicPrefix}/device/+/command/response`);
  mqttClient.subscribe(`${topicPrefix}/device/+/pair/request`);
  mqttClient.subscribe(`${topicPrefix}/device/+/heartbeat`);
});

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log(`MQTT Message [${topic}]:`, data);
    
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
      io.to(`test-${data.testId}`).emit('telemetry', data);
    }
  } catch (err) {
    console.error('Error parsing MQTT message:', err);
  }
});

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
