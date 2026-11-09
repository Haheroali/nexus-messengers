# NEXUS System Architecture

## Component Interaction Diagram

```
+--------------------------------------------------------------+
|                         Client Tier                          |
|             Next.js 15 App Router (PWA / Responsive)         |
|  - Zustand (State)       - Web Audio API (Synthesizer/Notes)  |
|  - libsignal (E2EE)      - WebRTC RTCPeerConnection (Calls)   |
+------------------------------+-------------------------------+
                               |
                   WebSocket   |   HTTPS REST
                   Signaling   |   & GraphQL
                               v
+--------------------------------------------------------------+
|                       API & Gateway                          |
|            NestJS / Node.js Fastify Gateway                  |
|  - Socket.IO Gateway     - JWT & Argon2id Auth Engine        |
|  - Rate Limiter (Redis)  - Presigned S3 Uploader (MinIO)     |
+-------------------+--------------------+---------------------+
                    |                    |
                    v                    v
+-------------------------+    +-------------------------------+
|       Redis Cluster     |    |      PostgreSQL Database      |
|  - Presence & Heartbeat |    |  - Prisma ORM Data Access     |
|  - Pub/Sub Fanout Bus   |    |  - Full Text Search Indexes   |
|  - Ephemeral Sessions   |    |  - Relational Integrity       |
+-------------------------+    +-------------------------------+
```

## Security Model
1. **End-to-End Encryption**: Signal Protocol double ratchet with pre-keys stored encrypted on server. Server acts as untrusted relay.
2. **Access Control**: Role-based access control (RBAC) enforced at database query level and API middleware.
3. **Media Security**: Media objects uploaded through pre-signed, time-limited S3 URLs.
