.PHONY: dev migrate test

dev:
	@docker compose up -d
	@npm install
	@npm run migrate
	@npm run dev

migrate:
	@npm run migrate

test:
	@npm test
