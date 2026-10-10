# Override NODE_IMAGE with an independently verified sha256 digest for deployment.
ARG NODE_IMAGE=node:22.22.2-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --chown=node:node worker.mjs server.mjs bootstrap.mjs ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]