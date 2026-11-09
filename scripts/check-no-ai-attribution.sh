#!/usr/bin/env bash
# Fails if AI tool attribution is found. Usage:
#   check-no-ai-attribution.sh message <file>      check one commit message file
#   check-no-ai-attribution.sh range <base> <head>  check commits (messages, author, committer) in base..head
#   check-no-ai-attribution.sh text <file>          check free text (e.g. a PR title/body)
set -u
BAD_TEXT='co-authored-by:.*(claude|anthropic)|claude-session|generated with.*claude|claude\.ai/code/session|noreply@anthropic\.com'
BAD_IDENT='claude|anthropic'
fail=0
report() { echo "::error::$1"; fail=1; }

case "${1:-}" in
  message|text)
    grep -qiE "$BAD_TEXT" "$2" && report "AI attribution found in $2. Remove Co-Authored-By/Claude-Session/Generated-with lines." ;;
  range)
    for c in $(git rev-list "$2..$3"); do
      git log -1 --format=%B "$c" | grep -qiE "$BAD_TEXT" && report "Commit $c has AI attribution in its message."
      ident=$(git log -1 --format='%an %ae %cn %ce' "$c")
      echo "$ident" | grep -qiE "$BAD_IDENT" && report "Commit $c has an AI author/committer identity: $ident"
    done ;;
  *) echo "usage: $0 message|text <file> | range <base> <head>"; exit 2 ;;
esac
exit $fail
