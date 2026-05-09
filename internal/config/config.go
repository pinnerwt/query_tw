package config

import (
	"errors"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL       string
	RedisURL          string
	DeepSeekAPIKey    string
	ThreadsUser       string
	ThreadsPass       string
	AdminBasicAuth    string
	LLMDailyCapCents  int
	Port              string
}

func Load() (*Config, error) {
	c := &Config{
		DatabaseURL:      env("DATABASE_URL", "postgres://cuizhao:cuizhao@localhost:5433/cuizhao?sslmode=disable"),
		RedisURL:         env("REDIS_URL", "redis://localhost:6380/0"),
		DeepSeekAPIKey:   os.Getenv("DEEPSEEK_API_KEY"),
		ThreadsUser:      os.Getenv("THREADS_BURNER_USER"),
		ThreadsPass:      os.Getenv("THREADS_BURNER_PASS"),
		AdminBasicAuth:   env("ADMIN_BASIC_AUTH", "admin:changeme"),
		LLMDailyCapCents: envInt("LLM_DAILY_CAP_CENTS", 500),
		Port:             env("PORT", "8080"),
	}
	if c.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
