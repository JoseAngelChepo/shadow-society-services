# Shadow Society — Services

NestJS API for **Shadow Society** (Qwen Cloud Global AI Hackathon 2026 · Agent Society).

Exposes **`/api/v1`** with debate simulation, Judge (Mirror / Shadow), and optional Qwen/DashScope LLM.

Pairs with [`shadow-society-platform`](https://github.com/JoseAngelChepo/shadow-society-platform) (Next.js on `:3010`).

License: [MIT](./LICENSE)

## Prerequisites

- Node.js 20+
- MongoDB Atlas connection string (`MONGODB_URI`) for persistence
- Optional: `DASHSCOPE_API_KEY` for real Qwen scoring (without it, Judge runs in demo/heuristic mode)

## Quick start

```bash
cp .env.example .env   # or: npm run setup-env
# Edit .env — set at least MONGODB_URI
npm ci
npm run dev            # http://localhost:3011
```

Health: `GET http://localhost:3011/api/v1/health`

## Main routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health (+ LLM mode) |
| `GET` | `/api/v1/debate/models` | Available Qwen models |
| `POST` | `/api/v1/debate/judge` | Judge one round |
| `POST` | `/api/v1/debate/simulations` | Create simulation |
| `POST` | `/api/v1/debate/simulations/:id/advance` | Advance / run to end |

## Env (highlights)

| Variable | Notes |
|----------|--------|
| `PORT` | `3011` |
| `MONGODB_URI` | Required MongoDB Atlas connection |
| `DASHSCOPE_API_KEY` | Enables real Qwen; without it → demo/heuristic |
| `QWEN_DEFAULT_MODEL` | e.g. `qwen-plus` |
| `FRONTEND_URL` / `CORS_ORIGIN` | `http://localhost:3010` |

Core code: `src/debate/` (Judge, agents, simulation orchestration).
