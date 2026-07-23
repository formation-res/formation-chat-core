#!/usr/bin/env sh
set -eu

curl -fsS http://127.0.0.1:13000/health/live >/dev/null
curl -fsS http://127.0.0.1:13000/health/ready >/dev/null
