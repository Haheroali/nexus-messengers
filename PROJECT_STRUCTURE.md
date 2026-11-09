nexus-platform/
├── .agent/
│   ├── AGENT_INSTRUCTIONS.md
│   ├── PRD.md
│   ├── TASKS.md
│   └── ARCHITECTURE.md
├── docker-compose.yml
├── .env.example
├── package.json
├── apps/
│   ├── web/                         # Next.js 15 Client
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   ├── (main)/
│   │   │   └── api/
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   ├── calls/
│   │   │   ├── feed/
│   │   │   └── layout/
│   │   ├── hooks/
│   │   └── lib/
│   └── server/                      # Node.js API & WebSocket Gateway
│       ├── src/
│       │   ├── auth/
│       │   ├── chats/
│       │   ├── messages/
│       │   ├── gateway/
│       │   └── storage/
│       └── prisma/
│           └── schema.prisma
