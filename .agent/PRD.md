# Product Requirements Document (PRD) - NEXUS

## 1. System Architecture Overview
NEXUS uses a microservices-inspired modular monolith designed for horizontal scaling:
- **Client Tier**: Web (PWA/Responsive), Mobile-optimized layout, bidirectional RTL-first Arabic interface.
- **Gateway / Real-time Tier**: WebSocket Gateway handles presence (Online/Offline/Typing), instant message delivery, receipts, and typing indicators.
- **Media Tier**: Presigned S3 URLs with client-side chunked upload, audio compression, and thumbnail generation.
- **Call Engine**: Peer-to-peer WebRTC mesh for 1:1 calls; SFU (Selective Forwarding Unit) architecture for group calls.

## 2. Functional Modules & Deliverables

### A. Authentication & User Profile
- Registration & Login via Phone Number / OTP or Email + Strong Passphrase.
- Ed25519 cryptographic key generation on registration for E2EE device registration.
- Profile management: Avatar upload, Bio, Username (@handle uniqueness), status privacy toggles.

### B. Direct & Group Messaging
- Instant 1-on-1 chat with double-tick receipts (Sent, Delivered, Read).
- Message Types: Text (Markdown support), Voice Notes (waveform visualization, variable playback speed 1x/1.5x/2x), Media (Images, Videos, Documents), Location, and Contacts.
- Interaction: Reactions (Emojis), Pinned Messages, Reply threading, Message deletion ("Delete for everyone" window: 48h).

### C. Channels & Broadcasting (Telegram Style)
- Public and Private Broadcast Channels.
- Role-based permissions: Owner, Admin (Post messages, Edit info, Ban members), Subscriber (Read-only / Comments).
- Live views counter and forward tracking.

### D. Social Feed ("Moments / Discover")
- Ephemeral Stories (24-hour expiration) with video/photo support and viewer tracking.
- Interactive Community Posts with real-time Polling (dynamic percentage recalculation), comments, and likes.

### E. Encrypted Audio/Video Calls
- 1:1 Call signaling over WebSockets (`call-offer`, `call-answer`, `ice-candidate`, `call-hangup`).
- Screen sharing, mute/unmute audio, camera toggle, and dynamic bitrate adaptation based on network conditions.
- Fallback Web Audio API ringtone synthesis (no external audio assets required).

## 3. Non-Functional Requirements
- **Latency**: Sub-100ms real-time message delivery over WebSockets.
- **Scalability**: Stateless WebSocket servers leveraging Redis Pub/Sub for cross-node fanout.
- **Security**: Strict Content Security Policy (CSP), rate limiting on authentication and API endpoints (via Redis), sanitized inputs against XSS and SQL Injection.
