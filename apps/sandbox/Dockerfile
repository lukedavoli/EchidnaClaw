FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git gnupg python3 \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
  && dpkg -i /tmp/packages-microsoft-prod.deb \
  && rm /tmp/packages-microsoft-prod.deb \
  && apt-get update \
  && apt-get install -y --no-install-recommends powershell \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN useradd --create-home --home-dir /home/sandbox --shell /bin/bash sandbox

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @echidna-claw/sandbox build
RUN mkdir -p /sandbox/workspaces \
  && chown -R sandbox:sandbox /sandbox /home/sandbox

USER sandbox

ENV HOME=/home/sandbox
ENV ECHIDNA_SANDBOX_WORKSPACE_ROOT=/sandbox/workspaces

EXPOSE 3002

CMD ["node", "apps/sandbox/dist/index.js"]
