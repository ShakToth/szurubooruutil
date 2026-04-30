FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV DOWNLOAD_DIR=/data/downloads

COPY package.json ./
COPY web ./web
COPY public ./public

RUN mkdir -p /data/downloads

EXPOSE 8080
CMD ["npm", "start"]
