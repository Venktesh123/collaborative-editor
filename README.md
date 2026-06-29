# Collaborative Document Editor
### House of Edtech — Fullstack Assignment 2 (v2.1)

A **Local-First, Real-Time Collaborative Document Editor** with Offline Sync, Operational Transform conflict resolution, granular version control, and AI-powered writing assistance.

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR, API routes, TypeScript |
| Language | TypeScript (strict) | End-to-end type safety |
| Database | PostgreSQL | JSONB ops log, RLS-ready, transactions |
| ORM | Prisma | Type-safe queries, migrations, tenant scoping |
| Auth | NextAuth v5 (Auth.js) | JWT sessions, credentials provider |
| Real-time | Socket.IO | WebSocket rooms, presence, fast-path ops |
| AI | Vercel AI SDK + Google Gemini | Streaming suggestions, structured outputs |
| Styling | Tailwind CSS + shadcn/ui | Accessible component library |
| Testing | Jest + Playwright | Unit (OT engine) + E2E (sync flows) |
| Deployment | EC2 + GitHub Actions | CI/CD, preview deployments |

---

## Architecture: Local-First + OT

### The Core Problem
When two users edit the same document simultaneously (or one edits offline), their changes can conflict. Naive "last write wins" destroys data.

### Our Solution: Operational Transform (OT)

```
User A (online):   "Hello world"  → INSERT(" ") at 5
User B (offline):  "Hello world"  → INSERT("!") at 11

Naive merge: "Hello !world" ← WRONG, destroys A's intent

OT transform:
  transform(opB, opA) → INSERT("!") at 12  ← adjusted for A's insert
  
Final state: "Hello world!" ← CORRECT on both clients
```

**Convergence guarantee**: No matter what order ops arrive, all clients converge to the same document state.

### Sync Flow

```
Client (offline)          Server
    │                       │
    │  [edits accumulate]   │
    │  [in IndexedDB]       │
    │                       │
    │──POST /sync──────────>│
    │  { ops, baseRevision} │
    │                       │──┐ Lock document row
    │                       │  │ Fetch ops since baseRevision
    │                       │  │ Rebase client ops via OT
    │                       │  │ Apply to document
    │                       │  │ Write to op log
    │                       │<─┘
    │<──{ newRevision,      │
    │    missingOps,        │
    │    vectorClock }──────│
    │                       │
    │  [apply missingOps]   │
    │  [update IndexedDB]   │
```

---

## Project Structure

```
collaborative-editor/
├── prisma/
│   ├── schema.prisma          # Full schema: docs, ops log, versions, RLS
│   └── seed.ts                # Test users + sample document
├── src/
│   ├── app/api/
│   │   ├── auth/[...nextauth]/ # NextAuth handlers
│   │   ├── documents/
│   │   │   ├── route.ts        # GET list, POST create
│   │   │   └── [id]/
│   │   │       ├── route.ts           # GET, PATCH, DELETE
│   │   │       ├── sync/route.ts      # ← Core sync endpoint (OT engine)
│   │   │       ├── versions/route.ts  # GET list, POST snapshot
│   │   │       ├── restore/route.ts   # POST safe time-travel restore
│   │   │       └── collaborators/route.ts # CRUD collaborators
│   │   └── ai/
│   │       ├── suggest/route.ts   # Streaming text suggestions
│   │       └── summarize/route.ts # Structured document summary
│   ├── lib/
│   │   ├── prisma.ts              # Singleton + tenant-scoped helpers
│   │   ├── auth.ts                # NextAuth config + requireAuth()
│   │   ├── rate-limit.ts          # Sliding window rate limiter
│   │   ├── socket-server.ts       # Socket.IO rooms, presence, fast-path ops
│   │   └── sync-engine/
│   │       ├── ot.ts              # OT core: transform(), rebaseOps()
│   │       ├── validator.ts       # Zod + semantic validation
│   │       └── merger.ts          # Conflict resolution helpers
│   ├── types/
│   │   ├── document.ts            # Op types, VectorClock, DTOs
│   │   └── sync.ts                # Zod schemas, SyncPayload, Socket events
│   └── middleware.ts              # Edge auth guard + security headers
├── server.ts                      # Custom HTTP server (Next.js + Socket.IO)
└── .github/workflows/ci.yml       # Lint → Test → Build → Deploy
```

---

## API Reference

### Documents

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/documents` | ✅ | List accessible documents (paginated) |
| POST | `/api/documents` | ✅ | Create new document |
| GET | `/api/documents/:id` | ✅ | Get document with user role |
| PATCH | `/api/documents/:id` | EDITOR+ | Update title/visibility |
| DELETE | `/api/documents/:id` | OWNER | Soft-delete document |
| **POST** | **`/api/documents/:id/sync`** | EDITOR+ | **Offline sync (OT engine)** |
| GET | `/api/documents/:id/versions` | ✅ | List version snapshots |
| POST | `/api/documents/:id/versions` | EDITOR+ | Create named snapshot |
| POST | `/api/documents/:id/restore` | EDITOR+ | Safe time-travel restore |
| GET | `/api/documents/:id/collaborators` | ✅ | List collaborators |
| POST | `/api/documents/:id/collaborators` | OWNER | Add collaborator by email |
| PATCH | `/api/documents/:id/collaborators` | OWNER | Update collaborator role |
| DELETE | `/api/documents/:id/collaborators` | OWNER/SELF | Remove collaborator |

### AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/suggest` | Streaming writing suggestions (continue, rephrase, fix_grammar…) |
| POST | `/api/ai/summarize` | Structured summary: TL;DR, key points, tags |

---

## Security Architecture

### Defense Against OOM / Payload Bombs

```typescript
// 1. Raw byte size check BEFORE JSON.parse


// 3. Semantic validation — position bounds, duplicate IDs
// 4. Document size guard — prevents unbounded growth
```

### Row-Level Security (ORM Layer)

All document queries go through `getDocumentForUser(documentId, userId)` which always includes `OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }]`. A user can never access a document they aren't connected to, regardless of the document ID passed.

### Role Enforcement

```
VIEWER  → Can read documents and view version history
EDITOR  → Can edit content, create versions, restore
OWNER   → All above + manage collaborators, delete document
```

Viewers attempting to POST to `/sync` or WebSocket `ops:submit` receive **403 Forbidden**.

### Additional Hardening

- **Rate limiting**: Sliding window on sync (30/min), auth (10/15min), AI (20/min)
- **Idempotent ops**: `clientOpId` UUID prevents duplicate op application on retry
- **Atomic transactions**: PostgreSQL `FOR UPDATE NOWAIT` on sync prevents race conditions
- **Audit log**: Every sensitive action (sync, restore, collaborator changes) is logged
- **Security headers**: CSP, X-Frame-Options, X-Content-Type-Options on all responses
- **Origin check**: Mutation endpoints verify `Origin` header matches app URL

---

## Setup

### Prerequisites
- Node.js ≥ 20
- PostgreSQL ≥ 15

### 1. Clone and Install

```bash
git clone <your-repo>
cd collaborative-editor
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL, NEXTAUTH_SECRET, GOOGLE_GENERATIVE_AI_API_KEY
```

### 3. Database Setup

```bash
# Create database and run migrations
npm run db:migrate

# Seed with test users and sample document
npm run db:seed
```

### 4. Run Development Server

```bash
npm run dev
# → http://localhost:3000
# → Socket.IO on same port
```

### 5. Test Accounts (after seed)

| Email | Password | Role on sample doc |
|-------|----------|--------------------|
| alice@example.com | Password123! | Owner |
| bob@example.com | Password123! | Editor |
| carol@example.com | Password123! | Viewer |

---

## Testing

```bash
# Unit tests (OT engine, validators)
npm test

# Unit tests with coverage
npm test -- --coverage

# E2E tests (requires running server + seeded DB)
npm run test:e2e
```

---

## Deployment

### Vercel (Frontend + API)
1. Push to GitHub
2. Connect repo to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy — Next.js builds and deploys automatically

### Socket.IO Server
Socket.IO requires a persistent Node.js process. Deploy `server.ts` to:
- **Railway**: Connect GitHub repo, set start command to `npm run start`
- **Fly.io**: Use the included Dockerfile template
- Set `NEXT_PUBLIC_SOCKET_URL` in Vercel to point to your Socket.IO server

### Database
Use [Neon](https://neon.tech) or [Supabase](https://supabase.com) for managed PostgreSQL.

```bash
# Run migrations in production
npm run db:migrate:prod
```

---

## Real-World Considerations

### Scalability
- **Horizontal scaling**: Socket.IO rooms must use Redis adapter (`socket.io-redis`) for multi-instance deployments
- **Op log growth**: Implement periodic compaction (snapshots + truncate old ops beyond N versions)
- **Document size**: 5MB limit enforced; large documents should use chunked loading

### Monitoring
- Audit log provides full activity trail for compliance
- Sync rejection rate is a key health metric
- `SyncQueueEntry.status` allows replay of failed syncs

---

Built for House of Edtech Fullstack 
