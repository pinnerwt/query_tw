package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/pgi/matching/internal/config"
	"github.com/pgi/matching/internal/db"
	"github.com/pgi/matching/internal/jobsrv"
	"github.com/pgi/matching/internal/skillsrv"
)

func main() {
	migrate := flag.Bool("migrate", false, "run migrations and exit")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("db open", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if *migrate || os.Getenv("RUN_MIGRATIONS") == "1" {
		if err := db.MigrateUp(ctx, pool, "/app/migrations"); err != nil {
			// fallback to local path
			if err2 := db.MigrateUp(ctx, pool, "./migrations"); err2 != nil {
				logger.Error("migrate up", "err", err, "fallback_err", err2)
				os.Exit(1)
			}
		}
		logger.Info("migrations applied")
		if *migrate {
			return
		}
	}

	repo := &jobsrv.Repo{Pool: pool}
	jh := &jobsrv.Handler{Repo: repo}
	sk := &skillsrv.Server{Pool: pool}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(corsMiddleware)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})

	r.Get("/api/jobs", jh.List)
	r.Get("/api/jobs/{id}", jh.One)
	r.Get("/api/skills", sk.Skills)
	r.Get("/api/roles", sk.Roles)
	r.Get("/api/cities", sk.CitiesH)

	// Static SPA — served from a directory configured at runtime so we don't
	// need to bake the bundle into the Go binary. Default tries dist/ then
	// web/dist/.
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		for _, c := range []string{"/app/dist", "./dist", "./web/dist"} {
			if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
				staticDir = c
				break
			}
		}
	}
	if staticDir != "" {
		fsServer := http.FileServer(http.Dir(staticDir))
		r.Handle("/assets/*", fsServer)
		r.Handle("/manifest.webmanifest", fsServer)
		r.Handle("/sw.js", fsServer)
		r.Handle("/registerSW.js", fsServer)
		r.Handle("/favicon.ico", fsServer)
		r.Handle("/robots.txt", fsServer)
		// SPA fallback for unmatched routes
		r.NotFound(func(w http.ResponseWriter, req *http.Request) {
			// pass through workbox-*.js and icon-*.png if they exist on disk
			if strings.HasPrefix(req.URL.Path, "/workbox-") || strings.HasPrefix(req.URL.Path, "/icon-") {
				p := filepath.Join(staticDir, filepath.Clean(req.URL.Path))
				if _, err := os.Stat(p); err == nil {
					http.ServeFile(w, req, p)
					return
				}
			}
			data, err := os.ReadFile(filepath.Join(staticDir, "index.html"))
			if err != nil {
				http.NotFound(w, req)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(data)
		})
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		logger.Info("api listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("listen", "err", err)
			os.Exit(1)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")
	ctx2, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx2)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
