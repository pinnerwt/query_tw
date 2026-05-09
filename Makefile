.PHONY: help build test web up down deps seed migrate api e2e all

help:
	@echo "Targets:"
	@echo "  deps      - go mod tidy + npm install"
	@echo "  build     - build go binaries to ./bin"
	@echo "  web       - build frontend bundle into web/dist (and copy to ./dist for embed)"
	@echo "  test      - go test ./..."
	@echo "  up        - docker compose up -d (postgres+redis+api+caddy)"
	@echo "  up-deps   - docker compose up -d postgres redis"
	@echo "  down      - docker compose down"
	@echo "  migrate   - bin/api --migrate"
	@echo "  seed      - bin/extractor --seed"
	@echo "  e2e       - run Playwright e2e against \$$BASE_URL (default http://localhost:8080)"
	@echo "  all       - deps web build"

deps:
	go mod tidy
	cd web && npm install

build: bin/api bin/scraper bin/extractor

bin/api: $(shell find cmd/api internal -type f -name '*.go') dist/index.html
	mkdir -p bin
	go build -o bin/api ./cmd/api

bin/scraper: $(shell find cmd/scraper -type f -name '*.go')
	mkdir -p bin
	go build -o bin/scraper ./cmd/scraper

bin/extractor: $(shell find cmd/extractor internal -type f -name '*.go')
	mkdir -p bin
	go build -o bin/extractor ./cmd/extractor

web:
	cd web && npm run build
	rm -rf dist
	cp -r web/dist dist

test:
	go test ./...

up-deps:
	docker compose -f deploy/docker-compose.yml up -d postgres redis

up:
	docker compose -f deploy/docker-compose.yml up -d --build

down:
	docker compose -f deploy/docker-compose.yml down

migrate: bin/api
	./bin/api --migrate

seed: bin/extractor
	./bin/extractor --seed

e2e:
	cd web && npm run e2e

all: deps web build
