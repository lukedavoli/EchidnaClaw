FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @echidna-claw/web... build

EXPOSE 4173

CMD ["pnpm", "--filter", "@echidna-claw/web", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
