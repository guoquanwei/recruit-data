FROM node:24-alpine AS deps

WORKDIR /app

ENV NODE_ENV=production
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV TZ=Asia/Shanghai

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  && apk add --no-cache tzdata \
  && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone \
  && rm -rf /var/cache/apk/*

COPY package*.json ./

RUN npm ci --omit=dev --prefer-offline --no-audit --progress=false \
  && npm cache clean --force \
  && rm -rf /tmp/npm-*


FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Shanghai

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  && apk add --no-cache tzdata wget \
  && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone \
  && rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R node:node /app \
  && find /app/node_modules -name "*.md" -delete \
    -o -name "*.txt" -not -name "LICENSE*" -delete \
    -o -name "README*" -delete \
    -o -name "CHANGELOG*" -delete \
    -o -name "HISTORY*" -delete \
    -o -name "AUTHORS*" -delete \
    -o -name ".npmrc" -delete \
    2>/dev/null || true

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]