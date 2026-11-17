# Linux test image for RunMate: every shell and Node version manager it
# supports, with no Node versions pre-installed in the managers.
FROM node:22-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends zsh fish curl ca-certificates git unzip \
 && rm -rf /var/lib/apt/lists/*

ENV HOME=/root
ENV NVM_DIR=/root/.nvm

# nvm (PROFILE=/dev/null: do not touch shell profiles, RunMate loads nvm.sh itself)
RUN mkdir -p "$NVM_DIR" \
 && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash

# fnm
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell --install-dir /root/.local/share/fnm

# Volta
RUN curl -fsSL https://get.volta.sh | bash -s -- --skip-setup

# The image's own Node stays first on PATH, so "active Node" is 22.
ENV PATH=/usr/local/bin:/root/.local/share/fnm:/root/.volta/bin:$PATH

WORKDIR /work

# VS Code and a virtual display, for the host test (test/host).
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb xauth dbus-x11 libasound2 libgbm1 libgtk-3-0 libnss3 libxss1 libxkbfile1 libsecret-1-0 \
 && curl -fsSL -o /tmp/code.deb "https://update.code.visualstudio.com/latest/linux-deb-x64/stable" \
 && apt-get install -y --no-install-recommends /tmp/code.deb \
 && rm -rf /tmp/code.deb /var/lib/apt/lists/*

# VS Code reads its environment from a login shell, and Debian's /etc/profile
# resets PATH for root; put the managers back.
RUN echo 'export PATH=/usr/local/bin:/root/.local/share/fnm:/root/.volta/bin:$PATH' > /etc/profile.d/runmate.sh

# Other script sources: Deno, just (make is already in the base image), and Yarn.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
 && curl -fsSL https://just.systems/install.sh | bash -s -- --to /usr/local/bin \
 && npm install -g yarn@1 --force

# lsof: how RunMate finds the program that holds a port.
RUN apt-get update \
 && apt-get install -y --no-install-recommends lsof \
 && rm -rf /var/lib/apt/lists/*
