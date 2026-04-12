FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

ARG VITE_API_BASE_URL=http://127.0.0.1:3001
ARG VITE_APP_BASE_URL=http://127.0.0.1:4173
ARG VITE_APP_TITLE=EchidnaClaw Control Plane
ARG VITE_RUNTIME_MODE=local-minimal

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_BASE_URL=$VITE_APP_BASE_URL
ENV VITE_APP_TITLE=$VITE_APP_TITLE
ENV VITE_RUNTIME_MODE=$VITE_RUNTIME_MODE

RUN corepack enable

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 4173

CMD ["pnpm", "--filter", "@echidna-claw/web", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
