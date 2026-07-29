# Project Architecture

## Overview

This document provides a high-level system architecture for OpticalSense, explaining how all components interact to enable real-time optical pulp vitality monitoring.

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpticalSense System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐         ┌──────────────┐                      │
│  │   Website    │         │   Backend    │                      │
│  │  (Frontend)  │◄────────┤   (API +     │                      │
│  │              │  HTTPS  │   Socket.IO) │                      │
│  │  React 19    │         │              │                      │
│  │  TanStack    │         │  Node.js     │                      │
│  │  Start       │         │              │                      │
│  └──────────────┘         └──────┬───────┘                      │
│                                   │                              │
│                                   │ MQTT Bridge                  │
│                                   ▼                              │
│                          ┌─────────────────┐                     │
│                          │  MQTT Broker    │                     │
│                          │  (HiveMQ Cloud) │                     │
│                          │                 │                     │
│                          │  TLS on 8883    │                     │
│                          └────────┬────────┘                     │
│                                   │                              │
│                                   │ MQTTS                        │
│                                   ▼                              │
│                          ┌─────────────────┐                     │
│                          │     ESP32       │                     │
│                          │   Device        │                     │
│                          │                 │                     │
│                          │  • WiFi         │                     │
│                          │  • MQTT Client  │                     │
│                          │  • Sensors      │                     │
│                          │  • Processing   │                     │
│                          └────────┬────────┘                     │
│                                   │                              │
│                                   │ Sensor Interface              │
│                                   │ (I2C/SPI/ADC/etc.)           │
│                                   ▼                              │
│                          ┌─────────────────┐                     │
│                          │   Sensors       │                     │
│                          │                 │                     │
│                          │  • Configurable │                     │
│                          │    based on     │                     │
│                          │    requirements │                     │
│                          └─────────────────┘                     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   │ REST API
                                   ▼
                          ┌─────────────────┐
                          │   Database      │
                          │  (MongoDB)      │
                          │                 │
                          │  • Patients     │
                          │  • Tests        │
                          │  • Reports      │
                          │  • Devices      │
                          │  • Clinics      │
                          └─────────────────┘
```

## Component Descriptions

### 1. Website (Frontend)

**Technology Stack**:
- Framework: TanStack Start (React 19)
- Language: TypeScript
- Build Tool: Vite 7
- Styling: Tailwind v4 + shadcn/ui
- State Management: TanStack Query
- Forms: React Hook Form + Zod
- Charts: Recharts
- PDF Generation: jsPDF + jspdf-autotable
- Animation: Framer Motion

**Responsibilities**:
- User authentication and session management
- Patient management (CRUD operations)
- Test execution and monitoring
- Real-time waveform display
- Report generation and PDF export
- Device management and pairing
- Clinic configuration
- Activity feed display

**Deployment**: Vercel

**Environment Variables**:
- `VITE_USE_MOCK`: Toggle demo/live mode
- `VITE_API_URL`: Backend API endpoint
- `VITE_SOCKET_URL`: WebSocket endpoint
- `VITE_MQTT_HOST`: MQTT broker host
- `VITE_MQTT_PORT`: MQTT broker port
- `VITE_MQTT_USERNAME`: MQTT username (if direct connection)
- `VITE_MQTT_PASSWORD`: MQTT password (if direct connection)
- `VITE_MQTT_TOPIC_PREFIX`: MQTT topic prefix

---

### 2. Backend (API + Socket.IO)

**Technology Stack**:
- Runtime: Node.js
- Framework: Express.js or Hono
- Realtime: Socket.IO
- Authentication: JWT (access + refresh tokens)
- Database: MongoDB (Mongoose ODM)
- MQTT Client: MQTT.js
- Deployment: Render

**Responsibilities**:
- REST API endpoints for all resources
- JWT authentication and token refresh
- Socket.IO server for real-time communication
- MQTT client for device communication
- MQTT to Socket.IO bridging
- Device command publishing
- Telemetry data processing
- Business logic enforcement
- Data validation and sanitization
- CORS handling

**API Endpoints**:
- Authentication: `/auth/login`, `/auth/refresh`, `/auth/logout`
- Patients: `/patients` (CRUD)
- Tests: `/tests` (CRUD + start/stop)
- Reports: `/reports` (generate)
- Devices: `/devices` (list, pair, unpair, refresh)
- Clinic: `/clinic` (get, update)
- Activity: `/activity` (list, push)

**Socket.IO Events**:
- `join_test_room`: Join telemetry room for a test
- `leave_test_room`: Leave telemetry room
- `telemetry`: Real-time sensor sample
- `device_status`: Device status update
- `error`: Socket error

**MQTT Topics**:
- Subscribes: `opticalsense/device/+/telemetry`, `opticalsense/device/+/status`, `opticalsense/device/+/command/response`, `opticalsense/device/+/pair/request`, `opticalsense/device/+/heartbeat`
- Publishes: `opticalsense/device/{deviceId}/command`, `opticalsense/device/{deviceId}/pair/response`

**Deployment**: Render

**Environment Variables**:
- `PORT`: Server port (default: 10000)
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: JWT signing secret
- `JWT_REFRESH_SECRET`: JWT refresh token secret
- `MQTT_URL`: MQTT broker URL (mqtts://...)
- `MQTT_USERNAME`: MQTT username
- `MQTT_PASSWORD`: MQTT password
- `MQTT_TOPIC_PREFIX`: MQTT topic prefix
- `CORS_ORIGIN`: Frontend URL for CORS

---

### 3. MQTT Broker (HiveMQ Cloud)

**Technology**: HiveMQ Cloud (managed MQTT broker)

**Responsibilities**:
- Real-time message routing
- QoS guarantees (0, 1, 2)
- TLS encryption (port 8883)
- Authentication and authorization
- Message persistence (retain flag)
- Last Will and Testament

**Configuration**:
- Protocol: MQTTS (TLS)
- Port: 8883
- QoS: 0, 1, 2 supported
- Retain: Supported
- Authentication: Username/password
- Topic ACL: Device-specific topics

**Topics**:
- `opticalsense/device/{deviceId}/telemetry`: Device → Cloud
- `opticalsense/device/{deviceId}/status`: Device → Cloud
- `opticalsense/device/{deviceId}/command`: Cloud → Device
- `opticalsense/device/{deviceId}/command/response`: Device → Cloud
- `opticalsense/device/{deviceId}/pair/request`: Device → Cloud
- `opticalsense/device/{deviceId}/pair/response`: Cloud → Device
- `opticalsense/device/{deviceId}/heartbeat`: Device → Cloud

---

### 4. ESP32 Device

**Technology Stack**:
- Hardware: ESP32-WROOM-32
- Framework: ESP-IDF v5.x
- Language: C/C++
- Build System: CMake

**Responsibilities**:
- WiFi connectivity and management
- MQTT client implementation
- Sensor data acquisition (configurable based on hardware)
- Signal processing (filtering, peak detection, etc.)
- Metric computation (depends on sensor type)
- Command execution
- Device state management
- Pairing workflow
- Battery monitoring
- Error handling and recovery

**Components**:
- WiFi Manager: Network configuration and connection
- MQTT Manager: MQTT communication
- Device Manager: Lifecycle and state management
- Sensor Manager: Sensor interface
- Signal Processing: Data processing algorithms
- Command Handler: Command execution
- Pairing: Device pairing workflow

**Sensors**:
- Configurable based on requirements (I2C, SPI, ADC, etc.)
- Examples: PPG sensors, temperature sensors, accelerometers, etc.

**Deployment**: Physical device in clinical setting

---

### 5. Sensors

**Sensor Configuration**:
- Configurable based on application requirements
- Interface options: I2C, SPI, ADC, UART, etc.
- Examples: PPG sensors, temperature sensors, accelerometers, etc.
- Sensor-specific configuration in firmware

---

### 6. Database (MongoDB Atlas)

**Technology**: MongoDB Atlas (managed MongoDB)

**Responsibilities**:
- Persistent data storage
- Data indexing and querying
- Data replication and backup
- User authentication

**Collections**:
- `users`: User accounts (doctors, admins)
- `clinics`: Clinic information
- `patients`: Patient records
- `tests`: Test sessions and results
- `reports`: Generated reports
- `devices`: Device records
- `activity`: Activity event log

**Deployment**: MongoDB Atlas

---

## Data Flow Diagrams

### Test Execution Flow

```
User                 Website              Backend              MQTT Broker            ESP32
 │                     │                    │                     │                    │
 │ Start Test          │                    │                     │                    │
 ├────────────────────►│                    │                     │                    │
 │                     │ POST /tests        │                     │                    │
 │                     ├───────────────────►│                     │                    │
 │                     │                    │ Create test record  │                    │
 │                     │                    │                     │                    │
 │                     │                    │ Publish command     │                    │
 │                     │                    ├─────────────────────►│                    │
 │                     │                    │                     │ start_test          │
 │                     │                    │                     ├───────────────────►│
 │                     │                    │                     │                    │
 │                     │                    │                     │ Acknowledge        │
 │                     │                    │                     │◄───────────────────┤
 │                     │                    │                     │                    │
 │                     │                    │                     │ Start streaming    │
 │                     │                    │                     │                    │
 │                     │                    │                     │ telemetry          │
 │                     │                    │                     │◄───────────────────┤
 │                     │                    │                     │                    │
 │                     │                    │ Bridge to Socket.IO │                    │
 │                     │                    │◄─────────────────────┤                    │
 │                     │                    │                     │                    │
 │                     │ telemetry          │                     │                    │
 │                     │◄───────────────────┤                     │                    │
 │                     │                    │                     │                    │
 │ Display waveform    │                    │                     │                    │
 │                     │                    │                     │                    │
 │                     │                    │                     │ telemetry (10Hz)   │
 │                     │                    │                     │◄───────────────────┤
 │                     │                    │                     │                    │
 │                     │                    │ Bridge to Socket.IO │                    │
 │                     │                    │◄─────────────────────┤                    │
 │                     │                    │                     │                    │
 │                     │ telemetry          │                     │                    │
 │                     │◄───────────────────┤                     │                    │
 │                     │                    │                     │                    │
 │                     │                    │                     │ telemetry (10Hz)   │
 │                     │                    │                     │◄───────────────────┤
 │                     │                    │                     │                    │
 │ (continues for test duration...)         │                     │                    │
 │                     │                    │                     │                    │
 │ Stop Test           │                    │                     │                    │
 ├────────────────────►│                    │                     │                    │
 │                     │ POST /tests/:id/stop│                     │                    │
 │                     ├───────────────────►│                     │                    │
 │                     │                    │ Publish command     │                    │
 │                     │                    ├─────────────────────►│                    │
 │                     │                    │                     │ stop_test           │
 │                     │                    │                     ├───────────────────►│
 │                     │                    │                     │                    │
 │                     │                    │                     │ Stop streaming     │
 │                     │                    │                     │                    │
 │                     │                    │                     │ Final samples      │
 │                     │                    │                     │◄───────────────────┤
 │                     │                    │                     │                    │
 │                     │                    │ Compute summary     │                    │
 │                     │                    │                     │                    │
 │                     │                    │ Update test record  │                    │
 │                     │                    │                     │                    │
 │                     │ Test results       │                     │                    │
 │                     │◄───────────────────┤                     │                    │
 │                     │                    │                     │                    │
 │ Display results     │                    │                     │                    │
```

### Device Pairing Flow

```
ESP32                MQTT Broker            Backend              Website
 │                       │                     │                    │
 │ Boot                  │                     │                    │
 │                       │                     │                    │
 │ No credentials        │                     │                    │
 │                       │                     │                    │
 │ Start WiFi Manager    │                     │                    │
 │                       │                     │                    │
 │ User configures WiFi │                     │                    │
 │                       │                     │                    │
 │ Connect to MQTT       │                     │                    │
 ├──────────────────────►│                     │                    │
 │                       │                     │                    │
 │ Subscribe to pair/response                     │                    │
 │◄──────────────────────┤                     │                    │
 │                       │                     │                    │
 │ Generate pairing code │                     │                    │
 │                       │                     │                    │
 │ Publish pair request  │                     │                    │
 ├──────────────────────►│                     │                    │
 │                       │ pair/request        │                    │
 │                       ├────────────────────►│                    │
 │                       │                     │                    │
 │                       │                     │ Create pending     │
 │                       │                     │ device record      │
 │                       │                     │                    │
 │                       │                     │                    │
 │ Display code to user  │                     │                    │
 │                       │                     │                    │
 │                       │                     │                    │ User enters code
 │                       │                     │                    │
 │                       │                     │◄───────────────────┤
 │                       │                     │                    │
 │                       │                     │ Validate code      │
 │                       │                     │                    │
 │                       │                     │ Associate device   │
 │                       │                     │                    │
 │                       │                     │ Publish pair       │
 │                       │                     │ response           │
 │                       │                     ├────────────────────►│
 │                       │ pair/response       │                    │
 │                       ├────────────────────┤                    │
 │                       │                     │                    │
 │ pair/response         │                     │                    │
 │◄──────────────────────┤                     │                    │
 │                       │                     │                    │
 │ Validate response     │                     │                    │
 │                       │                     │                    │
 │ Store credentials     │                     │                    │
 │                       │                     │                    │
 │ Reconnect to MQTT     │                     │                    │
 ├──────────────────────►│                     │                    │
 │                       │                     │                    │
 │ Publish status: paired│                     │                    │
 ├──────────────────────►│                     │                    │
 │                       │ status              │                    │
 │                       ├────────────────────►│                    │
 │                       │                     │                    │
 │                       │                     │ Update device      │
 │                       │                     │ record              │
 │                       │                     │                    │
 │                       │                     │                    │ Device paired
 │                       │                     │                    ├───────────────────►│
 │                       │                     │                    │
 │                       │                     │                    │ Display success
```

### Real-time Telemetry Flow

```
ESP32                MQTT Broker            Backend              Website
 │                       │                     │                    │
 │ Sample sensors (10Hz)  │                     │                    │
 │                       │                     │                    │
 │ Process signals        │                     │                    │
 │                       │                     │                    │
 │ Compute metrics        │                     │                    │
 │                       │                     │                    │
 │ Publish telemetry      │                     │                    │
 ├──────────────────────►│                     │                    │
 │                       │ telemetry           │                    │
 │                       ├────────────────────►│                    │
 │                       │                     │                    │
 │                       │                     │ Bridge to Socket.IO│
 │                       │                     │                    │
 │                       │                     │ telemetry          │
 │                       │                     ├────────────────────►│
 │                       │                     │                    │
 │                       │                     │                    │ Display waveform
 │                       │                     │                    │ Update metrics
 │                       │                     │                    │
 │ (repeats at 10Hz)     │                     │                    │
```

---

## Communication Protocols

### Website ↔ Backend

**Protocol**: HTTPS (REST API)

**Authentication**: JWT Bearer tokens

**Data Format**: JSON

**Endpoints**: See API_CONTRACT.md

**Real-time**: Socket.IO over WebSocket Secure (WSS)

---

### Backend ↔ MQTT Broker

**Protocol**: MQTTS (TLS)

**Authentication**: Username/password

**QoS**: 0, 1, 2 (varies by topic)

**Topics**: See MQTT_PROTOCOL.md

---

### Backend ↔ Database

**Protocol**: MongoDB Wire Protocol

**Authentication**: SCRAM-SHA-256

**Data Format**: BSON (Binary JSON)

**ODM**: Mongoose

---

### ESP32 ↔ MQTT Broker

**Protocol**: MQTTS (TLS)

**Authentication**: Device-specific username/password

**QoS**: 0, 1, 2 (varies by topic)

**Topics**: See MQTT_PROTOCOL.md

---

### ESP32 ↔ Sensors

**Protocol**: I2C (Inter-Integrated Circuit)

**Speed**: 100 kHz (standard) or 400 kHz (fast)

**Addressing**: 7-bit addressing

**Sensor Address**: MAX30101 at 0x57

---

## Security Architecture

### Authentication Flow

```
1. User enters credentials on website
2. Website POSTs to /auth/login
3. Backend validates credentials
4. Backend generates JWT access token (15 min expiry)
5. Backend generates JWT refresh token (7 day expiry)
6. Backend returns tokens to website
7. Website stores tokens securely
8. Website includes access token in Authorization header
9. Backend validates access token on each request
10. If access token expired, website uses refresh token
11. Backend validates refresh token, issues new access token
```

### Device Authentication

```
1. Device generates unique device ID (MAC-based)
2. Device enters pairing mode
3. Device generates pairing code
4. User enters code on website
5. Backend validates code
6. Backend generates device-specific MQTT credentials
7. Backend publishes credentials to device
8. Device stores credentials in NVS (encrypted)
9. Device uses credentials for MQTT authentication
```

### Data Encryption

- **Website ↔ Backend**: TLS 1.2/1.3
- **Backend ↔ MQTT Broker**: TLS 1.2/1.3
- **ESP32 ↔ MQTT Broker**: TLS 1.2/1.3
- **Backend ↔ Database**: TLS (MongoDB Atlas)
- **Device Credentials**: AES-256 encryption in NVS

### Authorization

- **Website**: Role-based (doctor, admin)
- **Backend**: JWT claims validation
- **MQTT**: Topic ACLs (device-specific topics)
- **Database**: User/clinic isolation

---

## Deployment Architecture

### Production Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
┌──────────────────────┐        ┌──────────────────────┐
│      Vercel          │        │       Render          │
│  (Frontend Hosting)  │        │  (Backend Hosting)   │
│                      │        │                      │
│  • React 19          │        │  • Node.js           │
│  • TanStack Start    │        │  • Express/Hono      │
│  • Global CDN        │        │  • Socket.IO         │
│  • Auto-scaling      │        │  • Auto-scaling      │
└──────────┬───────────┘        └──────────┬───────────┘
           │                               │
           │ HTTPS                         │ HTTPS
           │                               │
           │                               │
           │                    ┌──────────┴──────────┐
           │                    │                     │
           │                    ▼                     ▼
           │          ┌─────────────────┐  ┌─────────────────┐
           │          │  HiveMQ Cloud   │  │  MongoDB Atlas │
           │          │  (MQTT Broker)  │  │  (Database)    │
           │          │                 │  │                 │
           │          │  • TLS          │         │  • TLS          │
           │          │  • Cluster      │  │  • Replica Set │
           │          │  • Auto-scaling │  │  • Backups     │
           │          └─────────────────┘  └─────────────────┘
           │                    │                     │
           │                    │ MQTTS               │ MongoDB Wire
           │                    │                     │ Protocol
           │                    │                     │
           │                    ▼                     │
           │          ┌─────────────────┐              │
           │          │  ESP32 Devices  │              │
           │          │  (Clinical)     │              │
           │          │                 │              │
           │          │  • WiFi         │              │
           │          │  • MQTT Client  │              │
           │          │  • Sensors      │              │
           │          └─────────────────┘              │
           │                                            │
           └────────────────────────────────────────────┘
```

### Demo Mode Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                    Local Browser                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Website (Demo Mode)                                   │   │
│  │                                                         │   │
│  │  • No backend required                                 │   │
│  │  • Mock service layer                                  │   │
│  │  • LocalStorage for data                               │   │
│  │  • Simulated sensor stream                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Scalability Considerations

### Frontend Scaling

- **Vercel**: Automatic horizontal scaling
- **CDN**: Global content delivery
- **Static assets**: Optimized and cached
- **API calls**: Efficient with TanStack Query caching

### Backend Scaling

- **Render**: Auto-scaling based on load
- **Socket.IO**: Horizontal scaling with Redis adapter (future)
- **Database**: Connection pooling
- **MQTT**: HiveMQ Cloud auto-scaling

### MQTT Scaling

- **HiveMQ Cloud**: Handles millions of connections
- **Topic design**: Device-specific topics for isolation
- **QoS**: Appropriate QoS for each use case
- **Message size**: Keep payloads small

### Database Scaling

- **MongoDB Atlas**: Automatic sharding
- **Indexing**: Optimized queries
- **Caching**: Redis for frequently accessed data (future)
- **Data retention**: Archive old test data (future)

---

## Redundancy and High Availability

### Frontend

- **Vercel**: 99.99% uptime SLA
- **CDN**: Multiple edge locations
- **Rollback**: Instant rollback capability

### Backend

- **Render**: Multiple availability zones
- **Health checks**: Automatic failover
- **Graceful shutdown**: Handle in-flight requests

### MQTT Broker

- **HiveMQ Cloud**: 99.99% uptime SLA
- **Cluster**: Multiple broker instances
- **Automatic failover**: Transparent to clients

### Database

- **MongoDB Atlas**: 99.99% uptime SLA
- **Replica set**: Multiple nodes
- **Automatic failover**: < 10 seconds
- **Continuous backups**: Point-in-time recovery

---

## Monitoring and Observability

### Frontend Monitoring

- **Error tracking**: Sentry (future)
- **Performance**: Web Vitals monitoring
- **Analytics**: User behavior tracking (future)

### Backend Monitoring

- **Logs**: Structured logging
- **Metrics**: Request rate, response time, error rate
- **Health checks**: /health endpoint
- **Alerts**: Critical error notifications

### MQTT Monitoring

- **HiveMQ Cloud**: Built-in monitoring
- **Message rate**: Track telemetry volume
- **Connection status**: Device online/offline tracking
- **Latency**: End-to-end message latency

### Database Monitoring

- **MongoDB Atlas**: Built-in monitoring
- **Query performance**: Slow query tracking
- **Storage usage**: Capacity planning
- **Replication lag**: Replica set health

---

## Development Workflow

### Local Development

```
1. Clone frontend repository
2. Run: bun install
3. Set VITE_USE_MOCK=true in .env
4. Run: bun run dev
5. Access at http://localhost:5173
```

### Backend Development (Future)

```
1. Clone backend repository
2. Run: npm install
3. Configure .env with MongoDB and MQTT credentials
4. Run: npm run dev
5. Access API at http://localhost:10000
```

### ESP32 Development (Future)

```
1. Clone ESP32 firmware repository
2. Install ESP-IDF
3. Configure sdkconfig
4. Run: idf.py build
5. Flash: idf.py flash
6. Monitor: idf.py monitor
```

---

## Technology Rationale

### Frontend Stack

- **TanStack Start**: Modern React framework with excellent performance
- **TypeScript**: Type safety and better developer experience
- **Tailwind v4**: Utility-first CSS with modern features
- **shadcn/ui**: Beautiful, accessible components
- **TanStack Query**: Efficient data fetching and caching
- **Recharts**: Flexible charting library

### Backend Stack

- **Node.js**: JavaScript ecosystem, fast I/O
- **Express.js/Hono**: Lightweight, flexible framework
- **Socket.IO**: Real-time bidirectional communication
- **JWT**: Stateless authentication
- **MongoDB**: Flexible schema for medical data

### MQTT Stack

- **HiveMQ Cloud**: Managed, scalable MQTT broker
- **MQTT 3.1.1**: Widely supported, reliable protocol
- **TLS**: Secure communication

### Hardware Stack

- **ESP32**: Low-cost, WiFi-enabled microcontroller
- **MAX30101**: Integrated PPG sensor with excellent performance
- **ESP-IDF**: Official ESP32 development framework

---

## Future Architecture Enhancements

### Planned Improvements

1. **Multi-clinic support**: Enhanced data isolation
2. **Multi-device support**: Concurrent device monitoring
3. **AI analysis**: Machine learning for pulp vitality prediction
4. **Mobile app**: React Native for iOS/Android
5. **Push notifications**: Real-time alerts for doctors
6. **OTA updates**: Over-the-air firmware updates
7. **Redis caching**: Improved performance
8. **Socket.IO scaling**: Redis adapter for horizontal scaling

### Architecture Evolution

```
Current:
Website → Backend → MQTT → ESP32

Future (Multi-device):
Website → Backend → Redis Adapter → MQTT Cluster → Multiple ESP32s

Future (AI):
Website → Backend → AI Service → MQTT → ESP32

Future (Mobile):
Mobile App → Backend → MQTT → ESP32
```

---

## References

- ESP32_INTEGRATION.md: Detailed ESP32 integration guide
- MQTT_PROTOCOL.md: Complete MQTT protocol specification
- API_CONTRACT.md: REST API endpoint documentation
- SENSOR_DATA_SCHEMA.md: Sensor data field definitions
- COMMAND_PROTOCOL.md: Command protocol specification
- ESP32_FIRMWARE_PLAN.md: Firmware implementation roadmap
