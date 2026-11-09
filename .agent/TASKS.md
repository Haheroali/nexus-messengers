# Execution Roadmap for Autonomous Agent

Execute phases sequentially. Verify compilation and test passage at each step before checking the box.

> Execution status (2026-11-08): all roadmap tasks are implemented and verified. The Docker stack is running; PostgreSQL has three applied Prisma migrations; frontend and backend TypeScript checks and the full monorepo production build pass; all five Playwright end-to-end tests pass. The object-storage container is S3-compatible (`pgsty/silo`) and is wired through the MinIO service name in Compose.

### Phase 1: Environment & Core Infrastructure
- [x] Initialize monorepo workspace with Turborepo or npm workspaces.
- [x] Generate `docker-compose.yml` defining PostgreSQL 16, Redis 7, and S3-compatible object storage.
- [x] Setup Prisma ORM with the schema defined in `schema.prisma`. Run migrations and generate TypeScript client.
- [x] Implement JWT Authentication with refresh token rotation and Argon2id password hashing.

### Phase 2: Real-Time Communication Engine
- [x] Build WebSocket Server with authentication middleware checking JWT on connection handshake.
- [x] Implement Redis adapter for Socket.IO / WebSocket to ensure multi-instance broadcasting.
- [x] Implement Presence tracking (User Online/Offline status, Heartbeat ping/pong, and "Typing..." throttled broadcast).
- [x] Implement Message Delivery pipeline:
  - Save to DB with status `SENT`.
  - Push to recipient socket with confirmation ack (`DELIVERED`).
  - Read receipts updating state to `READ` upon active client view.

### Phase 3: Media Processing & Voice Notes
- [x] Setup S3 presigned URL generation endpoint for media uploads.
- [x] Implement client-side `MediaRecorder` API to capture AAC/Opus audio with real-time waveform extraction.
- [x] Build `WaveformPlayer` component using Canvas/Web Audio API with scrubbable seekbars and speed toggles.

### Phase 4: WebRTC Real-Time Calling Engine
- [x] Implement signaling gateway handling `offer`, `answer`, `ice-candidate`, and `hangup`.
- [x] Implement `useWebRTC` hook on the client managing `RTCPeerConnection`, local and remote audio/video tracks.
- [x] Build Call UI with floating/fullscreen layout, audio visualizer, camera flip, and microphone toggles.
- [x] Integrate Web Audio API synthesized ringing and connection tones.

### Phase 5: Social Feed & Community Features
- [x] Implement Stories module with 24-hour TTL queries and S3 media display.
- [x] Implement Channels module supporting subscriber counts, public links, and admin-only broadcast restrictions.
- [x] Implement Community Posts with dynamic Polls:
  - Atomic transaction for poll voting to prevent duplicate votes.
  - Real-time recalculation of percentages sent to all viewers via WebSockets.

### Phase 6: End-to-End Encryption (E2EE)
- [x] Integrate `libsignal-protocol-javascript` into the frontend.
- [x] Store encrypted PreKey Bundles on the server.
- [x] Implement local identity key derivation and message ciphertext decrypt on client arrival.

### Phase 7: UI Polish, RTL Optimization & End-to-End Tests
- [x] Apply full RTL Arabic typography using Tajawal / IBM Plex Sans Arabic.
- [x] Implement local state persistence via Zustand / `localStorage` fallback.
- [x] Write end-to-end tests using Playwright covering: Registration -> Chat creation -> Message exchange -> Voice note transmission -> WebRTC call handshake.
