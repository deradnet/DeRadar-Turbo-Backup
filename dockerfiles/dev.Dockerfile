FROM node:23.11.0

ENV NODE_ENV=development

WORKDIR /app

ARG CONTEXT_PATH
COPY ${CONTEXT_PATH}/package*.json ./

RUN npm install

COPY ${CONTEXT_PATH} .

RUN npm install -g @nestjs/cli

RUN apt-get update && apt-get install -y \
    && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["npm", "run", "start:dev"]
