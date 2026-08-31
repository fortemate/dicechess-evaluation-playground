#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Jegors Čemisovs
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

FIXTURE_PID=""
FIXTURE_READY_FILE=""

cleanup() {
	if [[ -n "$FIXTURE_PID" ]]; then
		kill "$FIXTURE_PID" 2>/dev/null || true
		wait "$FIXTURE_PID" 2>/dev/null || true
	fi
	if [[ -n "$FIXTURE_READY_FILE" ]]; then
		rm -f -- "$FIXTURE_READY_FILE"
	fi
}
trap cleanup EXIT

DEFAULT_BEARER_TOKEN="test-evaluator-token"
DEFAULT_MODEL_ID="dicechess-v1-test"
DEFAULT_MODEL_SHA256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

require_external_variable() {
	local variable_name="$1"
	if [[ -z "${!variable_name:-}" ]]; then
		printf 'Missing required environment variable for external evaluator: %s\n' "$variable_name" >&2
		exit 2
	fi
}

if [[ -z "${EVALUATOR_ORIGIN:-}" ]]; then
	echo "No EVALUATOR_ORIGIN provided; starting local mock evaluator fixture..."

	PORT="${FIXTURE_PORT:-8088}"
	export EVALUATOR_BEARER_TOKEN="${EVALUATOR_BEARER_TOKEN:-$DEFAULT_BEARER_TOKEN}"
	export EXPECTED_MODEL_ID="${EXPECTED_MODEL_ID:-$DEFAULT_MODEL_ID}"
	export EXPECTED_MODEL_SHA256="${EXPECTED_MODEL_SHA256:-$DEFAULT_MODEL_SHA256}"
	export PORT
	FIXTURE_READY_FILE="$(mktemp "${TMPDIR:-/tmp}/dicechess-evaluator-fixture.XXXXXX")"
	export FIXTURE_READY_FILE

	node tests/fixtures/evaluator/mock-server.js &
	FIXTURE_PID=$!

	for _ in {1..30}; do
		if [[ -s "$FIXTURE_READY_FILE" ]]; then
			break
		fi
		if ! kill -0 "$FIXTURE_PID" 2>/dev/null; then
			wait "$FIXTURE_PID" 2>/dev/null || true
			echo "Mock evaluator fixture failed to start" >&2
			exit 1
		fi
		sleep 0.1
	done

	if [[ ! -s "$FIXTURE_READY_FILE" ]]; then
		echo "Timed out waiting for the mock evaluator fixture" >&2
		exit 1
	fi
	if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
		echo "Mock evaluator fixture did not pass its health check" >&2
		exit 1
	fi

	EVALUATOR_ORIGIN="http://127.0.0.1:${PORT}"
else
	require_external_variable EVALUATOR_BEARER_TOKEN
	require_external_variable EXPECTED_MODEL_ID
	require_external_variable EXPECTED_MODEL_SHA256
fi

if [[ ! "$EXPECTED_MODEL_SHA256" =~ ^[[:xdigit:]]{64}$ ]]; then
	echo "EXPECTED_MODEL_SHA256 must contain exactly 64 hexadecimal characters" >&2
	exit 2
fi

hurl --jobs 1 --no-output \
	--secret EVALUATOR_ORIGIN="$EVALUATOR_ORIGIN" \
	--secret EVALUATOR_BEARER_TOKEN="$EVALUATOR_BEARER_TOKEN" \
	--variable EXPECTED_MODEL_ID="$EXPECTED_MODEL_ID" \
	--variable EXPECTED_MODEL_SHA256="$EXPECTED_MODEL_SHA256" \
	tests/contracts/evaluator/*.hurl
