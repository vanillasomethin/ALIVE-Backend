# Contributing

Thanks for your interest in contributing!

## Getting started

This repository ships a minimal API skeleton with database migrations. You can run the supporting services with Docker Compose to validate schema changes locally.

### Prerequisites

- Docker + Docker Compose

### Configure environment

```bash
cp .env.example .env
```

### Run Postgres + Redis

```bash
docker compose up -d
```

### Apply migrations

```bash
npm install
npm run migrate
```

### Run the API

```bash
npm run dev
```

Or run the full flow in one command:

```bash
make dev
```

### Stop services

```bash
docker compose down
```

## Testing

```bash
npm test
```
