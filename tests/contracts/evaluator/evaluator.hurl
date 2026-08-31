# Public liveness check
GET {{EVALUATOR_ORIGIN}}/health
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"

# Public readiness check
GET {{EVALUATOR_ORIGIN}}/ready
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

# Protected endpoint missing bearer token rejection
GET {{EVALUATOR_ORIGIN}}/version
HTTP 401
[Asserts]
jsonpath "$.code" == "AUTHENTICATION_FAILURE"

# Protected endpoint wrong bearer token rejection
GET {{EVALUATOR_ORIGIN}}/version
Authorization: Bearer invalid-bearer-token
HTTP 401
[Asserts]
jsonpath "$.code" == "AUTHENTICATION_FAILURE"

# Protected version endpoint
GET {{EVALUATOR_ORIGIN}}/version
Authorization: Bearer {{EVALUATOR_BEARER_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.version" exists

# Protected manifest endpoint
GET {{EVALUATOR_ORIGIN}}/manifest
Authorization: Bearer {{EVALUATOR_BEARER_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.modelId" == "{{EXPECTED_MODEL_ID}}"
jsonpath "$.modelSha256" == "{{EXPECTED_MODEL_SHA256}}"

# Protected position evaluation invalid FEN rejection
POST {{EVALUATOR_ORIGIN}}/api/v1/evaluate/position
Authorization: Bearer {{EVALUATOR_BEARER_TOKEN}}
Content-Type: application/json
{
  "fen": "invalid_fen_string"
}
HTTP 422
[Asserts]
jsonpath "$.code" == "INVALID_FEN"

# Protected position evaluation valid request
POST {{EVALUATOR_ORIGIN}}/api/v1/evaluate/position
Authorization: Bearer {{EVALUATOR_BEARER_TOKEN}}
Content-Type: application/json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
}
HTTP 200
[Asserts]
jsonpath "$.fen" == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
jsonpath "$.sideToMove" == "w"
jsonpath "$.winProbability" >= 0.0
jsonpath "$.winProbability" <= 1.0
jsonpath "$.provenance.modelId" == "{{EXPECTED_MODEL_ID}}"
jsonpath "$.provenance.modelSha256" == "{{EXPECTED_MODEL_SHA256}}"
