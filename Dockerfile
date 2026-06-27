FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_MODE=file
ENV SQLITE_FILE=data/recruitment.db

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data && chown -R node:node /app

USER node

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["npm", "start"]
