FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile

EXPOSE 3002

CMD ["pnpm", "--filter", "@echidna-claw/sandbox", "start"]
