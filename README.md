# Short Drama Membership Platform

Monorepo: `apps/api` (Fastify backend), `apps/web` (Next.js frontend), `tools/uploader` (local transcode+upload CLI).

## Local dev
1. `docker compose up -d` — starts PostgreSQL
2. `pnpm install`
3. `pnpm --filter api exec prisma migrate dev`
4. `pnpm --filter api exec prisma db seed`
5. `pnpm dev:api` and `pnpm dev:web` in separate terminals
