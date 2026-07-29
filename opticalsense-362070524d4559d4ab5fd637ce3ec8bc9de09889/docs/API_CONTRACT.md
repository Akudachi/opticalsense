# API Contract

## Overview

This document specifies the REST API endpoints that the backend must implement to support the OpticalSense web application. The frontend communicates with these endpoints via the service layer defined in `src/services/interfaces.ts`.

## Base URL

All endpoints are relative to the base API URL:

```
https://<your-backend>.onrender.com/api
```

## Authentication

### Authentication Method

JWT (JSON Web Tokens) with access and refresh tokens.

### Headers

```
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Token Endpoints

#### POST /auth/login

Authenticate user and receive tokens.

**Request Body**:
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200 OK)**:
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "fullName": "string",
    "role": "doctor|admin",
    "clinicId": "string",
    "avatarUrl": "string (optional)"
  },
  "accessToken": "string",
  "refreshToken": "string",
  "expiresIn": "number (seconds)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid email or password format
  ```json
  {
    "error": "Invalid request format",
    "details": "Email and password are required"
  }
  ```
- **401 Unauthorized**: Invalid credentials
  ```json
  {
    "error": "Invalid credentials"
  }
  ```

#### POST /auth/refresh

Refresh access token using refresh token.

**Request Body**:
```json
{
  "refreshToken": "string"
}
```

**Response (200 OK)**:
```json
{
  "accessToken": "string",
  "expiresIn": "number (seconds)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid or expired refresh token
  ```json
  {
    "error": "Invalid or expired refresh token"
  }
  ```

#### POST /auth/logout

Invalidate refresh token.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "message": "Logged out successfully"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
  ```json
  {
    "error": "Invalid access token"
  }
  ```

---

## Patient Endpoints

### GET /patients

List patients with pagination and search.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `search` (optional): Search term for name, phone, email, or tooth of interest
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Items per page (default: 10)

**Response (200 OK)**:
```json
{
  "items": [
    {
      "id": "string",
      "clinicId": "string",
      "fullName": "string",
      "dateOfBirth": "string (ISO 8601)",
      "sex": "male|female|other",
      "phone": "string",
      "email": "string (optional)",
      "medicalNotes": "string (optional)",
      "toothOfInterest": "string (optional, FDI notation)",
      "createdAt": "string (ISO 8601)",
      "updatedAt": "string (ISO 8601)"
    }
  ],
  "total": "number",
  "page": "number",
  "pageSize": "number"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

### GET /patients/:id

Get a specific patient by ID.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "fullName": "string",
  "dateOfBirth": "string (ISO 8601)",
  "sex": "male|female|other",
  "phone": "string",
  "email": "string (optional)",
  "medicalNotes": "string (optional)",
  "toothOfInterest": "string (optional)",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Patient not found
- **500 Internal Server Error**: Server error

### POST /patients

Create a new patient.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "fullName": "string",
  "dateOfBirth": "string (ISO 8601)",
  "sex": "male|female|other",
  "phone": "string",
  "email": "string (optional)",
  "medicalNotes": "string (optional)",
  "toothOfInterest": "string (optional)"
}
```

**Response (201 Created)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "fullName": "string",
  "dateOfBirth": "string (ISO 8601)",
  "sex": "male|female|other",
  "phone": "string",
  "email": "string (optional)",
  "medicalNotes": "string (optional)",
  "toothOfInterest": "string (optional)",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
  ```json
  {
    "error": "Invalid request data",
    "details": "fullName is required"
  }
  ```
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

### PUT /patients/:id

Update an existing patient.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "fullName": "string (optional)",
  "dateOfBirth": "string (optional)",
  "sex": "string (optional)",
  "phone": "string (optional)",
  "email": "string (optional)",
  "medicalNotes": "string (optional)",
  "toothOfInterest": "string (optional)"
}
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "fullName": "string",
  "dateOfBirth": "string (ISO 8601)",
  "sex": "male|female|other",
  "phone": "string",
  "email": "string (optional)",
  "medicalNotes": "string (optional)",
  "toothOfInterest": "string (optional)",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Patient not found
- **500 Internal Server Error**: Server error

### DELETE /patients/:id

Delete a patient.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (204 No Content)**: Patient deleted successfully

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Patient not found
- **409 Conflict**: Patient has associated tests
  ```json
  {
    "error": "Cannot delete patient with associated tests"
  }
  ```
- **500 Internal Server Error**: Server error

---

## Test Endpoints

### GET /tests

List tests with pagination and filtering.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `patientId` (optional): Filter by patient ID
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Items per page (default: 20)

**Response (200 OK)**:
```json
{
  "items": [
    {
      "id": "string",
      "clinicId": "string",
      "patientId": "string",
      "deviceId": "string",
      "doctorId": "string",
      "startedAt": "string (ISO 8601)",
      "endedAt": "string (ISO 8601, optional)",
      "status": "in_progress|completed|aborted",
      "toothOfInterest": "string (optional)",
      "samples": [
        {
          "t": "number (ms since test start)",
          "red": "number",
          "ir": "number",
          "spo2": "number",
          "pulse": "number",
          "temperature": "number",
          "batteryPct": "number",
          "signalQuality": "number",
          "confidence": "low|medium|high"
        }
      ],
      "summary": {
        "avgSpO2": "number",
        "avgPulse": "number",
        "avgTemp": "number",
        "minSpO2": "number",
        "maxPulse": "number",
        "signalQuality": "number",
        "confidence": "low|medium|high",
        "durationSec": "number"
      },
      "observations": "string",
      "pulpVerdict": "vital|non_vital|inconclusive"
    }
  ],
  "total": "number",
  "page": "number",
  "pageSize": "number"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

### GET /tests/:id

Get a specific test by ID.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "patientId": "string",
  "deviceId": "string",
  "doctorId": "string",
  "startedAt": "string (ISO 8601)",
  "endedAt": "string (ISO 8601, optional)",
  "status": "in_progress|completed|aborted",
  "toothOfInterest": "string (optional)",
  "samples": [...],
  "summary": {...},
  "observations": "string",
  "pulpVerdict": "vital|non_vital|inconclusive"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Test not found
- **500 Internal Server Error**: Server error

### POST /tests

Start a new test.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "patientId": "string",
  "deviceId": "string",
  "toothOfInterest": "string (optional, FDI notation)"
}
```

**Response (201 Created)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "patientId": "string",
  "deviceId": "string",
  "doctorId": "string",
  "startedAt": "string (ISO 8601)",
  "endedAt": null,
  "status": "in_progress",
  "toothOfInterest": "string (optional)",
  "samples": [],
  "summary": {
    "avgSpO2": 0,
    "avgPulse": 0,
    "avgTemp": 0,
    "minSpO2": 0,
    "maxPulse": 0,
    "signalQuality": 0,
    "confidence": "low",
    "durationSec": 0
  },
  "observations": "",
  "pulpVerdict": "inconclusive"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
  ```json
  {
    "error": "Invalid request data",
    "details": "patientId and deviceId are required"
  }
  ```
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Patient or device not found
- **409 Conflict**: Device is not online or already in use
  ```json
  {
    "error": "Device is not available"
  }
  ```
- **500 Internal Server Error**: Server error

### PUT /tests/:id

Update a test (e.g., add observations).

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "observations": "string (optional)",
  "toothOfInterest": "string (optional)"
}
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "patientId": "string",
  "deviceId": "string",
  "doctorId": "string",
  "startedAt": "string (ISO 8601)",
  "endedAt": "string (ISO 8601, optional)",
  "status": "in_progress|completed|aborted",
  "toothOfInterest": "string (optional)",
  "samples": [...],
  "summary": {...},
  "observations": "string",
  "pulpVerdict": "vital|non_vital|inconclusive"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Test not found
- **500 Internal Server Error**: Server error

### POST /tests/:id/stop

Stop a test and finalize results.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "samples": [
    {
      "t": "number",
      "red": "number",
      "ir": "number",
      "spo2": "number",
      "pulse": "number",
      "temperature": "number",
      "batteryPct": "number",
      "signalQuality": "number",
      "confidence": "low|medium|high"
    }
  ],
  "observations": "string (optional)"
}
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "patientId": "string",
  "deviceId": "string",
  "doctorId": "string",
  "startedAt": "string (ISO 8601)",
  "endedAt": "string (ISO 8601)",
  "status": "completed",
  "toothOfInterest": "string (optional)",
  "samples": [...],
  "summary": {
    "avgSpO2": "number",
    "avgPulse": "number",
    "avgTemp": "number",
    "minSpO2": "number",
    "maxPulse": "number",
    "signalQuality": "number",
    "confidence": "low|medium|high",
    "durationSec": "number"
  },
  "observations": "string",
  "pulpVerdict": "vital|non_vital|inconclusive"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Test not found
- **409 Conflict**: Test is not in progress
  ```json
  {
    "error": "Test is not in progress"
  }
  ```
- **500 Internal Server Error**: Server error

### DELETE /tests/:id

Delete a test.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (204 No Content)**: Test deleted successfully

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Test not found
- **409 Conflict**: Test has associated report
  ```json
  {
    "error": "Cannot delete test with associated report"
  }
  ```
- **500 Internal Server Error**: Server error

---

## Report Endpoints

### GET /reports

List reports with optional patient filtering.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `patientId` (optional): Filter by patient ID

**Response (200 OK)**:
```json
[
  {
    "id": "string",
    "testId": "string",
    "patientId": "string",
    "clinicId": "string",
    "generatedAt": "string (ISO 8601)",
    "aiAnalysis": "string (optional)"
  }
]
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

### GET /reports/:id

Get a specific report by ID.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "testId": "string",
  "patientId": "string",
  "clinicId": "string",
  "generatedAt": "string (ISO 8601)",
  "aiAnalysis": "string (optional)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Report not found
- **500 Internal Server Error**: Server error

### POST /reports

Generate a report for a test.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "testId": "string",
  "aiAnalysis": "string (optional)"
}
```

**Response (201 Created)**:
```json
{
  "id": "string",
  "testId": "string",
  "patientId": "string",
  "clinicId": "string",
  "generatedAt": "string (ISO 8601)",
  "aiAnalysis": "string (optional)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
  ```json
  {
    "error": "Invalid request data",
    "details": "testId is required"
  }
  ```
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Test not found
- **409 Conflict**: Report already exists for this test
  ```json
  {
    "error": "Report already exists for this test"
  }
  ```
- **500 Internal Server Error**: Server error

---

## Device Endpoints

### GET /devices

List all devices for the clinic.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
[
  {
    "id": "string",
    "clinicId": "string",
    "name": "string",
    "deviceId": "string (hardware ID)",
    "firmware": "string",
    "online": "boolean",
    "wifi": {
      "ssid": "string",
      "rssi": "number (dBm)",
      "connected": "boolean"
    },
    "mqtt": "connected|connecting|disconnected|error",
    "batteryPct": "number (0-100)",
    "signalStrength": "number (0-100)",
    "lastSeen": "string (ISO 8601)",
    "pairedAt": "string (ISO 8601)"
  }
]
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

### GET /devices/:id

Get a specific device by ID.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "name": "string",
  "deviceId": "string",
  "firmware": "string",
  "online": "boolean",
  "wifi": {
    "ssid": "string",
    "rssi": "number",
    "connected": "boolean"
  },
  "mqtt": "connected|connecting|disconnected|error",
  "batteryPct": "number",
  "signalStrength": "number",
  "lastSeen": "string (ISO 8601)",
  "pairedAt": "string (ISO 8601)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Device not found
- **500 Internal Server Error**: Server error

### POST /devices/pair

Pair a new device using pairing code.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "code": "string (6 digits)"
}
```

**Response (201 Created)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "name": "string",
  "deviceId": "string",
  "firmware": "string",
  "online": "boolean",
  "wifi": {
    "ssid": "string",
    "rssi": "number",
    "connected": "boolean"
  },
  "mqtt": "connected",
  "batteryPct": "number",
  "signalStrength": "number",
  "lastSeen": "string (ISO 8601)",
  "pairedAt": "string (ISO 8601)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid pairing code format
  ```json
  {
    "error": "Invalid pairing code",
    "details": "Pairing code must be 6 digits"
  }
  ```
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Pairing code not found or expired
  ```json
  {
    "error": "Invalid or expired pairing code"
  }
  ```
- **409 Conflict**: Device already paired to another clinic
  ```json
  {
    "error": "Device already paired"
  }
  ```
- **500 Internal Server Error**: Server error

### DELETE /devices/:id

Unpair a device.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (204 No Content)**: Device unpaired successfully

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Device not found
- **409 Conflict**: Device has active test
  ```json
  {
    "error": "Cannot unpair device with active test"
  }
  ```
- **500 Internal Server Error**: Server error

### POST /devices/:id/refresh

Refresh device status (request latest status from device).

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "clinicId": "string",
  "name": "string",
  "deviceId": "string",
  "firmware": "string",
  "online": "boolean",
  "wifi": {
    "ssid": "string",
    "rssi": "number",
    "connected": "boolean"
  },
  "mqtt": "connected|connecting|disconnected|error",
  "batteryPct": "number",
  "signalStrength": "number",
  "lastSeen": "string (ISO 8601)",
  "pairedAt": "string (ISO 8601)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Device not found
- **503 Service Unavailable**: Device not online
  ```json
  {
    "error": "Device is not online"
  }
  ```
- **500 Internal Server Error**: Server error

---

## Clinic Endpoints

### GET /clinic

Get clinic information.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "name": "string",
  "logoDataUrl": "string (optional, base64)",
  "doctorName": "string",
  "address": "string",
  "phone": "string",
  "email": "string",
  "licenseNo": "string (optional)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Clinic not found
- **500 Internal Server Error**: Server error

### PUT /clinic

Update clinic information.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "name": "string (optional)",
  "logoDataUrl": "string (optional)",
  "doctorName": "string (optional)",
  "address": "string (optional)",
  "phone": "string (optional)",
  "email": "string (optional)",
  "licenseNo": "string (optional)"
}
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "name": "string",
  "logoDataUrl": "string (optional)",
  "doctorName": "string",
  "address": "string",
  "phone": "string",
  "email": "string",
  "licenseNo": "string (optional)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **404 Not Found**: Clinic not found
- **500 Internal Server Error**: Server error

---

## Activity Endpoints

### GET /activity

List activity events.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `limit` (optional): Number of events to return (default: 25)

**Response (200 OK)**:
```json
[
  {
    "id": "string",
    "at": "string (ISO 8601)",
    "kind": "test_started|test_stopped|report_generated|patient_added|device_paired|device_online|device_offline",
    "message": "string",
    "refId": "string (optional)"
  }
]
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

### POST /activity

Push an activity event (internal use, typically called by backend).

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "kind": "string",
  "message": "string",
  "refId": "string (optional)"
}
```

**Response (201 Created)**:
```json
{
  "id": "string",
  "at": "string (ISO 8601)",
  "kind": "string",
  "message": "string",
  "refId": "string (optional)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Invalid access token
- **403 Forbidden**: User not authorized for this clinic
- **500 Internal Server Error**: Server error

---

## User Profile Endpoints

### GET /auth/me

Get current user profile.

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "email": "string",
  "fullName": "string",
  "role": "doctor|admin",
  "clinicId": "string",
  "avatarUrl": "string (optional)"
}
```

**Error Responses**:
- **401 Unauthorized**: Invalid access token
- **500 Internal Server Error**: Server error

### PUT /auth/me

Update current user profile.

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "fullName": "string (optional)",
  "avatarUrl": "string (optional)"
}
```

**Response (200 OK)**:
```json
{
  "id": "string",
  "email": "string",
  "fullName": "string",
  "role": "doctor|admin",
  "clinicId": "string",
  "avatarUrl": "string (optional)"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Invalid access token
- **500 Internal Server Error**: Server error

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": "string (error message)",
  "details": "string (optional, additional details)",
  "code": "string (optional, error code for programmatic handling)"
}
```

### Common Error Codes

- `INVALID_REQUEST`: Malformed request
- `UNAUTHORIZED`: Missing or invalid authentication
- `FORBIDDEN`: User lacks permission
- `NOT_FOUND`: Resource not found
- `CONFLICT`: Resource conflict
- `VALIDATION_ERROR`: Request validation failed
- `INTERNAL_ERROR`: Server error

---

## Rate Limiting

- **Default**: 100 requests per minute per user
- **Login endpoint**: 5 requests per minute per IP
- **Pairing endpoint**: 10 requests per minute per clinic

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

When rate limited:
```
HTTP/1.1 429 Too Many Requests
```

```json
{
  "error": "Rate limit exceeded",
  "details": "Try again in 30 seconds"
}
```

---

## CORS Configuration

The backend must support CORS for the frontend domain:

```
Access-Control-Allow-Origin: https://<your-vercel-app>.vercel.app
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Credentials: true
```

---

## WebSocket/Socket.IO

### Connection

Connect to Socket.IO server at:

```
wss://<your-backend>.onrender.com
```

### Authentication

Send JWT in handshake:

```javascript
const socket = io("wss://<your-backend>.onrender.com", {
  auth: {
    token: "<access_token>"
  }
});
```

### Events

#### Client → Server

**join_test_room**
```json
{
  "testId": "string"
}
```

Join a room to receive telemetry for a specific test.

**leave_test_room**
```json
{
  "testId": "string"
}
```

Leave a test room.

#### Server → Client

**telemetry**
```json
{
  "testId": "string",
  "t": "number",
  "red": "number",
  "ir": "number",
  "spo2": "number",
  "pulse": "number",
  "temperature": "number",
  "batteryPct": "number",
  "signalQuality": "number",
  "confidence": "low|medium|high"
}
```

Real-time sensor sample for a test.

**device_status**
```json
{
  "deviceId": "string",
  "status": "online|offline|error",
  "batteryPct": "number",
  "signalStrength": "number"
}
```

Device status update.

**error**
```json
{
  "message": "string"
}
```

Socket error.

---

## Pagination

List endpoints support pagination:

- `page`: Page number (1-indexed)
- `pageSize`: Items per page

Response includes:
```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

Calculate total pages: `Math.ceil(total / pageSize)`

---

## Date Format

All dates use ISO 8601 format:

```
2024-01-15T10:30:00Z
```

Timezone: Always UTC

---

## ID Format

All IDs are strings. Recommended format:

- **User ID**: `usr-{uuid}`
- **Clinic ID**: `clinic-{uuid}`
- **Patient ID**: `pat-{uuid}`
- **Test ID**: `test-{uuid}`
- **Report ID**: `rep-{uuid}`
- **Device ID**: `dev-{uuid}`
- **Activity ID**: `act-{uuid}`

Example: `usr-abc123-def456-ghi789`

---

## Versioning

API version included in URL:

```
/api/v1/...
```

Current version: v1

Breaking changes require new version (v2).

Non-breaking changes may be added to current version.

---

## Testing

### Example cURL Commands

**Login**:
```bash
curl -X POST https://api.opticalsense.io/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@opticalsense.io","password":"password"}'
```

**Get Patients**:
```bash
curl -X GET https://api.opticalsense.io/api/v1/patients \
  -H "Authorization: Bearer <access_token>"
```

**Start Test**:
```bash
curl -X POST https://api.opticalsense.io/api/v1/tests \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"patientId":"pat-abc123","deviceId":"dev-def456"}'
```

---

## Security Considerations

- Always use HTTPS in production
- Validate and sanitize all inputs
- Implement rate limiting
- Use parameterized queries for database
- Never expose sensitive data in error messages
- Implement CORS properly
- Use secure cookie flags for refresh tokens (if using cookies)
- Implement CSRF protection if using cookie-based auth
- Log all authentication attempts
- Implement IP-based blocking for repeated failures

---

## Performance Requirements

- **Response time**: < 200ms for 95th percentile
- **Throughput**: Support 100+ concurrent users per clinic
- **Database**: Use connection pooling
- **Caching**: Cache frequently accessed data (clinic info, device status)
- **MQTT**: Bridge telemetry with < 50ms latency

---

## Monitoring

### Metrics to Track

- Request rate per endpoint
- Response time percentiles
- Error rate per endpoint
- Database query performance
- MQTT message latency
- WebSocket connection count

### Logging

Log all:
- Requests (method, path, status, duration)
- Errors with stack traces
- Authentication attempts
- MQTT message failures
- Database query failures

---

## References

- REST API Best Practices: https://restfulapi.net/
- JWT Specification: https://tools.ietf.org/html/rfc7519
- Socket.IO Documentation: https://socket.io/docs/
