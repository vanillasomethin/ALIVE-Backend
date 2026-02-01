# Contributing

Thanks for your interest in contributing!

## Getting started

This repository currently ships database migrations and architecture docs. You can run the supporting services with Docker Compose to validate schema changes locally.

### Prerequisites

- Docker + Docker Compose

### Run Postgres + Redis

```bash
docker compose up -d
```

### Apply migrations

```bash
psql "postgresql://alive:alive@localhost:5432/alive" -f db/migrations/001_init.sql
```

### Stop services

```bash
docker compose down
```

## Testing

There are no automated tests yet. If you add any, please document how to run them here.
