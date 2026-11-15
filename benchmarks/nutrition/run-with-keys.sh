#!/bin/sh
# Runs `node bench.mjs <args>` with the API keys from a Java-style properties file exported for
# that one process. The keys are never printed and never passed as command-line arguments.
#   KEYS_FILE=/path/to/webknox.properties sh run-with-keys.sh ask --limit 20
# Default: config/webknox.properties in a webknox checkout next to this repo.
# OPENAI_API_KEY comes from the environment.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
file=${KEYS_FILE:-"$here/../../../webknox/config/webknox.properties"}
if [ ! -r "$file" ]; then
  echo "No readable keys file at $file (set KEYS_FILE)." >&2
  exit 1
fi

# Prints the value of one key: `key = value` or `key=value`, surrounding blanks and a CR removed.
prop() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*[=:][[:space:]]*//p" "$file" | tail -n 1 | tr -d '\r' | sed 's/[[:space:]]*$//'
}

ANTHROPIC_API_KEY=$(prop 'api\.anthropic\.key')
GEMINI_API_KEY=$(prop 'api\.gemini\.key')
TOGETHER_API_KEY=$(prop 'api\.together\.key')
export ANTHROPIC_API_KEY GEMINI_API_KEY TOGETHER_API_KEY
for name in ANTHROPIC_API_KEY GEMINI_API_KEY TOGETHER_API_KEY OPENAI_API_KEY; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || echo "Warning: $name is empty." >&2
done
unset value

exec node "$here/bench.mjs" "$@"
