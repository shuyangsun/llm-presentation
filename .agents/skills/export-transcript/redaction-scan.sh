#!/usr/bin/env bash
# Scan an exported session transcript for data that commonly needs redaction:
# emails, phone numbers, IPv4/IPv6 addresses, and common secret/token formats.
# Bundled with the export-transcript skill as a REVIEW AID, not a guarantee:
# the regexes are best-effort and will miss novel or obfuscated secrets, so the
# agent must still read the transcript itself before committing.
# Portable across GNU (Linux) and BSD (macOS) grep — ERE only, no -P / \b.
# Usage: bash redaction-scan.sh <transcript-file>
set -uo pipefail

file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "usage: bash redaction-scan.sh <transcript-file>" >&2
  exit 2
fi

printf 'Scanning %s\n\n' "$file"

total=0
# scan LABEL REGEX [i]   -- pass 'i' as the 3rd arg for a case-insensitive match.
scan() {
  local label="$1" regex="$2" ci="${3:-}" flags=(-nE) matches
  [[ "$ci" == i ]] && flags+=(-i)
  matches="$(grep "${flags[@]}" -e "$regex" -- "$file" 2>/dev/null | cut -c1-240 || true)"
  if [[ -n "$matches" ]]; then
    printf '== %s ==\n%s\n\n' "$label" "$matches"
    total=$((total + $(printf '%s\n' "$matches" | wc -l)))
  fi
}
# Retrieve environment and repository paths for path-based scans. Resolve the
# repo root from the current working directory, preferring Git, then Jujutsu,
# then CWD, so the scan works in any repo regardless of VCS.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  repo_root="$(jj root 2>/dev/null || true)"
fi
if [[ -z "$repo_root" ]]; then
  repo_root="$(pwd)"
fi
escaped_repo_root="$(echo "$repo_root" | sed 's/[^A-Za-z0-9_]/\\&/g')"

home_dir="${HOME:-}"
escaped_home_dir="$(echo "$home_dir" | sed 's/[^A-Za-z0-9_]/\\&/g')"

# Author email is intentional transcript metadata (VCS user.email); skip it.
author_email="$(git config user.email 2>/dev/null || true)"
if [[ -z "$author_email" ]]; then
  author_email="$(jj config get user.email 2>/dev/null || true)"
fi
email_matches="$(grep -nE -e '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- "$file" 2>/dev/null | cut -c1-240 || true)"
if [[ -n "$author_email" && -n "$email_matches" ]]; then
  email_matches="$(printf '%s\n' "$email_matches" | grep -Fv -- "$author_email" || true)"
fi
if [[ -n "$email_matches" ]]; then
  printf '== Email address ==\n%s\n\n' "$email_matches"
  total=$((total + $(printf '%s\n' "$email_matches" | wc -l)))
fi
scan "IPv4 address"               '((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
scan "IPv6 address"               '([0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}'
scan "Phone number"               '(\+?[0-9]{1,3}[ .-])?\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}'
scan "AWS access key id"          '(AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}'
scan "Google API key"             'AIza[0-9A-Za-z_-]{35}'
scan "GitHub token"               'gh[pousr]_[A-Za-z0-9]{36,}'
scan "GitHub fine-grained PAT"    'github_pat_[A-Za-z0-9_]{22,}'
scan "Slack token"                'xox[baprs]-[A-Za-z0-9-]{10,}'
scan "Stripe key"                 '(sk|pk|rk)_(test|live)_[A-Za-z0-9]{16,}'
scan "Generic sk- secret key"     'sk-[A-Za-z0-9_-]{20,}'
scan "JWT"                        'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
scan "Private key block"          '-----BEGIN[A-Z ]*PRIVATE KEY-----'
scan "Credential assignment"      "(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token)[\"']?[[:space:]]*[:=]" i
scan "Bearer token"               'bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}' i
scan "1Password CLI / URI"          'op://[A-Za-z0-9_.-]+' i

# Scan for absolute paths inside the repository (should be converted to relative)
matches_inside="$(grep -nE -e "${escaped_repo_root}/[^[:space:]\"']+" -- "$file" 2>/dev/null | cut -c1-240 || true)"
if [[ -n "$matches_inside" ]]; then
  printf '== Absolute path inside repo (convert to relative) ==\n%s\n\n' "$matches_inside"
  total=$((total + $(printf '%s\n' "$matches_inside" | wc -l)))
fi

# Scan for paths outside the repository under home directory (should be redacted)
if [[ -n "$escaped_home_dir" ]]; then
  matches_outside="$(grep -nE -e "${escaped_home_dir}/[^[:space:]\"']+" -- "$file" 2>/dev/null | grep -v "${escaped_repo_root}" | cut -c1-240 || true)"
  if [[ -n "$matches_outside" ]]; then
    printf '== Path outside repo (redact) ==\n%s\n\n' "$matches_outside"
    total=$((total + $(printf '%s\n' "$matches_outside" | wc -l)))
  fi
fi

if (( total == 0 )); then

  echo "No obvious sensitive patterns matched."
else
  printf '%d candidate line(s) flagged above.\n' "$total"
fi
echo "NOTE: best-effort regex scan — also read the transcript yourself before committing."
