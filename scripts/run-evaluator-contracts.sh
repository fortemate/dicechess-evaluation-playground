#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Jegors Čemisovs
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

FIXTURE_PID=""

cleanup() {
	if [ -n "$FIXTURE_PID" ]; then
		kill "$FIXTURE_PID" 2>/dev/null || true
		wait "$FIXTURE_PID" 2>/dev/null || true
	fi
}
trap cleanup EXIT

DEFAULT_BEARER_TOKEN="test-evaluator-token"
DEFAULT_MODEL_ID="dicechess-v1-test"
DEFAULT_MODEL_SHA256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

if [ -z "${EVALUATOR_ORIGIN:-}" ]; then
	echo "No EVALUATOR_ORIGIN provided; starting local mock evaluator fixture..."

	PORT="${FIXTURE_PORT:-8088}"
	export EVALUATOR_BEARER_TOKEN="${EVALUATOR_BEARER_TOKEN:-$DEFAULT_BEARER_TOKEN}"
	export EXPECTED_MODEL_ID="${EXPECTED_MODEL_ID:-$DEFAULT_MODEL_ID}"
	export EXPECTED_MODEL_SHA256="${EXPECTED_MODEL_SHA256:-$DEFAULT_MODEL_SHA256}"
	export PORT

	node tests/fixtures/evaluator/mock-server.js &
	FIXTURE_PID=$!

	for i in {1..30}; do
		if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
			break
		fi
		sleep 0.1
	done

	EVALUATOR_ORIGIN="http://127.0.0.1:${PORT}"
else
	EVALUATOR_BEARER_TOKEN="${EVALUATOR_BEARER_TOKEN:-$DEFAULT_BEARER_TOKEN}"
	EXPECTED_MODEL_ID="${EXPECTED_MODEL_ID:-$DEFAULT_MODEL_ID}"
	EXPECTED_MODEL_SHA256="${EXPECTED_MODEL_SHA256:-$DEFAULT_MODEL_SHA256}"
fi

hurl --jobs 1 --no-output \
	--variable EVALUATOR_ORIGIN="$EVALUATOR_ORIGIN" \
	--variable EVALUATOR_BEARER_TOKEN="$EVALUATOR_BEARER_TOKEN" \
	--variable EXPECTED_MODEL_ID="$EXPECTED_MODEL_ID" \
	--variable EXPECTED_MODEL_SHA256="$EXPECTED_MODEL_SHA256" \
	tests/contracts/evaluator/*.hurl
