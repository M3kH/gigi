#!/bin/bash
set -e

ORG="${1:-acme}"
GITEA_URL="${GITEA_URL:?Set GITEA_URL env var}"
GITEA_TOKEN="${GITEA_TOKEN:?GITEA_TOKEN environment variable is required}"

echo "Creating org-level labels for: $ORG"

# Priority labels
curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"priority/critical","color":"#d73a4a","description":"Blocks core functionality"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"priority/high","color":"#e99695","description":"Important but not blocking"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"priority/medium","color":"#fbca04","description":"Normal priority"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"priority/low","color":"#0e8a16","description":"Nice to have"}'

# Status labels
curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"status/blocked","color":"#b60205","description":"Cannot proceed"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"status/needs-info","color":"#d876e3","description":"Awaiting information"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"status/ready","color":"#0e8a16","description":"Ready to work on"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"status/in-progress","color":"#1d76db","description":"Currently being worked on"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"status/review","color":"#fbca04","description":"Awaiting review"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"status/done","color":"#0e8a16","description":"Completed"}'

# Type labels
curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/bug","color":"#d73a4a","description":"Something broken"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/feature","color":"#a2eeef","description":"New functionality"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/enhancement","color":"#84b6eb","description":"Improvement to existing feature"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/refactor","color":"#d4c5f9","description":"Code improvement without behavior change"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/docs","color":"#0075ca","description":"Documentation only"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/infra","color":"#5319e7","description":"Infrastructure/deployment"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"type/security","color":"#b60205","description":"Security-related"}'

# Scope labels
curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"scope/backend","color":"#c2e0c6","description":"Backend/API work"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"scope/frontend","color":"#bfdadc","description":"UI/UX work"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"scope/ci-cd","color":"#0e8a16","description":"CI/CD pipeline"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"scope/deps","color":"#0366d6","description":"Dependencies update"}'

# Size labels
curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"size/xs","color":"#ededed","description":"< 1 hour"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"size/s","color":"#ededed","description":"1-4 hours"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"size/m","color":"#ededed","description":"1 day"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"size/l","color":"#ededed","description":"2-3 days"}'

curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/labels" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"size/xl","color":"#ededed","description":"> 3 days"}'

echo "✅ Org-level labels created for: $ORG"
