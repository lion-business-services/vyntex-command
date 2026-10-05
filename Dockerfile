# syntax=docker/dockerfile:1
#
# Container image of the platform, for the day it has to run somewhere other than Vercel.
# The recommended production path is Vercel + Supabase. Read deploy/k8s/README.md before using this file.
#
# STATUS: written and reviewed, NOT built. No Docker daemon was available where this was written, so the image has
# never been built or started. The server it runs (deploy/container/server.mjs) was run and tested without Docker.
#
# One image per deployment. The deployment is chosen at build time, as on Vercel:
#   docker build --build-arg VX_DEPLOY=vyntex -t vyntex-command .
#   docker build --build-arg VX_DEPLOY=lbs    -t lbs-command .
# The two images go to separate registries or repositories and run in separate namespaces with separate secrets.
#
# BASE IMAGES ARE PINNED BY DIGEST. A tag such as "22" can be moved to different content at any time; a digest cannot.
# The two values below are placeholders on purpose, and the build fails until they are replaced, so nobody builds
# from an unpinned image by accident. To fill them in:
#   IN: VS Code terminal    docker buildx imagetools inspect node:22-bookworm-slim
#   IN: VS Code terminal    docker buildx imagetools inspect gcr.io/distroless/nodejs22-debian12:nonroot
# Each prints a line "Digest: sha256:...". Put that value after the "@" below (or pass it with --build-arg).
# Dependabot (.github/dependabot.yml) then proposes a new digest when the base image is updated.
#
# NEVER pass a secret as a build argument or copy one into the image. Secrets reach the container as environment
# variables at run time, from the platform's secret store. Build arguments here are public values only.

ARG NODE_BUILD_IMAGE=docker.io/library/node:22-bookworm-slim@sha256:REPLACE_WITH_THE_DIGEST_OF_THE_BUILD_IMAGE
ARG NODE_RUN_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot@sha256:REPLACE_WITH_THE_DIGEST_OF_THE_RUN_IMAGE

# ---- 1. every library, exactly as package-lock.json records it ---------------------------------------------------
FROM ${NODE_BUILD_IMAGE} AS deps
WORKDIR /src
COPY package.json package-lock.json ./
# --ignore-scripts: a library's install script cannot run code during the build
RUN npm ci --ignore-scripts

# ---- 2. build the pages, then refuse to continue if the build carries anything it must not --------------------
FROM deps AS build
ARG VX_DEPLOY=vyntex
# Public values that end up in the pages: the sample preview switch and the two client links of LBS Command.
ARG VX_SAMPLE_PREVIEW=
ARG VX_LINK_BOOKKEEPING=
ARG VX_LINK_PAYROLL=
ENV VX_DEPLOY=${VX_DEPLOY} VX_SAMPLE_PREVIEW=${VX_SAMPLE_PREVIEW} VX_LINK_BOOKKEEPING=${VX_LINK_BOOKKEEPING} VX_LINK_PAYROLL=${VX_LINK_PAYROLL}
COPY . .
RUN node scripts/build.mjs --deploy "${VX_DEPLOY}" --out /out/dist \
 && node scripts/security/scan-bundle.mjs /out/dist --deploy "${VX_DEPLOY}" \
 && node scripts/security/check-headers.mjs

# ---- 3. only the libraries the server needs at run time -------------------------------------------------------
FROM ${NODE_BUILD_IMAGE} AS prod-deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- 4. the image that runs: Node and the application, nothing else ---------------------------------------------
# Distroless: no shell, no package manager, no compiler, no npm. The ":nonroot" variant runs as user 65532.
FROM ${NODE_RUN_IMAGE} AS run
ARG VX_DEPLOY=vyntex
# VX_ENV defaults to production so that a container never falls back to "local" behaviour (cookies without the
# Secure flag, for one). Set it to staging for a staging deployment.
ENV NODE_ENV=production VX_ENV=production VX_DEPLOY=${VX_DEPLOY} PORT=8080 DIST=dist
WORKDIR /app
# Files are owned by root and the process runs as 65532, so the application cannot change its own code.
COPY --from=prod-deps /src/node_modules ./node_modules
COPY --from=build /src/package.json /src/vercel.json ./
COPY --from=build /src/api ./api
COPY --from=build /src/config ./config
COPY --from=build /src/deploy/container/server.mjs /src/deploy/container/healthcheck.mjs /src/deploy/container/cron-call.mjs ./deploy/container/
COPY --from=build /out/dist ./dist
USER 65532:65532
EXPOSE 8080
# The final image has no shell and no curl, so the check is a small Node script. Kubernetes ignores HEALTHCHECK and
# uses the probes in deploy/k8s/base/deployment.yaml, which call the same /healthz address.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "deploy/container/healthcheck.mjs"]
# The distroless image starts Node itself; this is the file it runs. The server writes nothing to disk, so the
# container can run with a read-only root file system (docker run --read-only, or readOnlyRootFilesystem: true).
CMD ["deploy/container/server.mjs"]
