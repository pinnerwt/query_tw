package main

import (
	"log/slog"
	"os"
)

// MVP-scope placeholder. Full Playwright scraper deferred — see plan
// Phase 7 for the design. The data path (api → db → frontend) is exercised
// via the seeder / extractor fixture-fed pipeline; turning on live scrape
// only requires implementing internal/scrape/ against this main.
func main() {
	slog.Info("scraper placeholder; not yet running live Threads queries")
	os.Exit(0)
}
