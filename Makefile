# Developer entry points. CI runs the same commands (see .gitlab-ci.yml).

.PHONY: check lint test lint-frontend lint-backend test-frontend test-backend dev

check: lint test  ## run everything CI runs

lint: lint-frontend lint-backend

lint-frontend:
	cd frontend && pnpm exec eslint src && pnpm exec tsc --noEmit

lint-backend:
	cd backend && pipx run ruff check src tests

test: test-frontend test-backend

test-frontend:
	cd frontend && pnpm exec vitest run

# Backend tests need the backend's Python deps; run them inside the container
# (PYTHONPATH already includes /usr/src/app via the Dockerfile).
test-backend:
	docker compose run --rm --no-deps -v ./backend/tests:/usr/src/tests \
		-e DATABASE_URL=postgresql://test:test@localhost:5432/test backend \
		sh -c "pip install -q pytest && python -m pytest /usr/src/tests -q"

dev:
	docker compose up backend postgres
