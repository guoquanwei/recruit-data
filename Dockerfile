FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Shanghai

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  && apk add --no-cache tzdata \
  && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
