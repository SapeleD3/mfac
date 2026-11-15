#!/usr/bin/env bash
#
# Sets up the factory on a Mac. Safe to run again: each step checks first and only installs what's
# missing. Only the Homebrew install (if Homebrew isn't there yet) asks for your password; nothing
# after setup needs admin rights, and the engine starts at login as you.
#
#   ./setup.sh              engine, CLI, login agent and the app
#   ./setup.sh --headless   engine, CLI and login agent only (no Rust, no app)
#   ./setup.sh --rebuild    rebuild the app even if this version is already installed
#
# After a git pull, rerunning it brings everything up to date: it rebuilds the engine, restarts it,
# and rebuilds, reinstalls and reopens the app when the code changed. `factory update` does the same
# and pulls first.
#
set -euo pipefail

HEADLESS=0
REBUILD=0
REBUILT=0
for arg in "$@"; do
  case "$arg" in
    --headless) HEADLESS=1 ;;
    --rebuild) REBUILD=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $arg (try --help)"; exit 2 ;;
  esac
done

cd "$(dirname "$0")"
REPO="$(pwd)"
FACTORY_HOME="${FACTORY_HOME:-$HOME/.factory}"
APP_DEST="$HOME/Applications/Factory.app"

step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
note() { printf '  \033[33m!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "setup.sh is for macOS. Elsewhere: npm ci && npm run build && npm link && factory engine start"
  exit 1
fi

step "Homebrew"
if ! have brew; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$b" ]] && eval "$("$b" shellenv)" && break; done
fi
if have brew; then
  ok "brew $(brew --version | head -1 | awk '{print $2}')"
else
  note "Installing Homebrew. This is the one step that asks for your password."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$b" ]] && eval "$("$b" shellenv)" && break; done
fi

brew_need() {
  for f in "$@"; do
    if brew list --formula "$f" >/dev/null 2>&1; then ok "$f"; else brew install "$f"; fi
  done
}

step "Base tools"
if have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  ok "node $(node -v)"
else
  brew install node
fi
brew_need tmux git gh
if /usr/libexec/java_home -v 11+ >/dev/null 2>&1; then
  ok "java $(/usr/libexec/java_home -v 11+)"
else
  brew_need openjdk@21
  export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
fi

step "Claude Code"
if have claude; then
  ok "claude $(claude --version 2>/dev/null | head -1)"
else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  note "ANTHROPIC_API_KEY is set in this shell. The factory's sessions should use your subscription: remove it from your shell profile."
fi

if [[ $HEADLESS -eq 0 ]]; then
  step "Rust (for the app)"
  [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
  if have cargo; then ok "$(cargo --version)"; else curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal; source "$HOME/.cargo/env"; fi
fi

step "Engine and the factory command"
npm ci --no-audit --no-fund --loglevel=error
npm run -s build
if have factory && [[ "$(readlink -f "$(command -v factory)" 2>/dev/null || true)" == "$REPO"* ]]; then ok "factory is linked"; else npm link --no-audit --no-fund --loglevel=error; ok "factory linked onto your PATH"; fi
mkdir -p "$FACTORY_HOME" && chmod 700 "$FACTORY_HOME"

step "TLC (the research rule's model checker)"
node scripts/tlc.mjs --fetch | sed 's/^/  /'

step "graphify (knowledge graph CLI)"
if have graphify; then
  ok "graphify $(graphify --version 2>/dev/null | head -1)"
else
  brew_need uv
  uv tool install graphifyy
  export PATH="$HOME/.local/bin:$PATH"
fi

step "Skills: superpowers, pstack, ponytail, graphify, design-principles (linked from Claude Code if you already have them)"
factory skills install | sed 's/^/  /'

if [[ $HEADLESS -eq 0 ]]; then
  step "The app"
  BUILT_FROM="$FACTORY_HOME/app-built-from"
  HEAD="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  if [[ -d "$APP_DEST" && $REBUILD -eq 0 && -f "$BUILT_FROM" && "$(cat "$BUILT_FROM")" == "$HEAD" ]]; then
    ok "Factory.app is up to date"
  else
    (cd app && npm ci --no-audit --no-fund --loglevel=error && npm run -s app)
    mkdir -p "$HOME/Applications"
    rm -rf "$APP_DEST"
    ditto app/src-tauri/target/release/bundle/macos/Factory.app "$APP_DEST"
    echo "$HEAD" > "$BUILT_FROM"
    REBUILT=1
    ok "installed $APP_DEST"
  fi
fi

step "Start at login (launch agent, no admin)"
if [[ $HEADLESS -eq 0 ]]; then factory engine install --app "$APP_DEST" | sed 's/^/  /'; else factory engine install | sed 's/^/  /'; fi
factory engine restart | sed 's/^/  /'
for _ in $(seq 1 50); do factory engine status >/dev/null 2>&1 && break; sleep 0.2; done
factory engine status | sed 's/^/  /'
if [[ $HEADLESS -eq 1 ]]; then factory settings ui.mode=headless >/dev/null; ok "headless: no UI at login"; fi

step "Checks"
factory doctor || true

cat <<'DONE'

Next:
  factory connect slack       checks the Slack connector you have in Claude (no token, no Slack app)
  factory connect notion      same for Notion, then makes your board on a page you pick
  factory connect jira        optional: the Atlassian connector
  factory repo add ~/code/some-repo
  factory add "Your first task" --repo some-repo
DONE
if [[ $HEADLESS -eq 0 ]]; then
  if [[ $REBUILT -eq 1 ]]; then
    osascript -e 'tell application id "com.sapeled3.factory" to quit' >/dev/null 2>&1 || true
    for _ in $(seq 1 50); do pgrep -f "$APP_DEST/Contents/MacOS/" >/dev/null || break; sleep 0.2; done
  fi
  open -g "$APP_DEST" || true
fi
