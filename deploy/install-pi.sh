#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pbs-cmms}"
APP_USER="${APP_USER:-${SUDO_USER:-${USER:-pi}}}"
PORT="${PORT:-3300}"
REPO_URL="${REPO_URL:-https://github.com/syauqimushoffa-max/cmms.git}"
SERVICE_NAME="pbs-cmms"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "User '${APP_USER}' does not exist. Set APP_USER to the Linux user that should run CMMS."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1 || [ "$(node -p "Number(process.versions.node.split('.')[0])")" -lt 24 ]; then
  echo "Installing Node.js Current. CMMS requires Node.js 24 or newer because it uses node:sqlite."
  curl -fsSL https://deb.nodesource.com/setup_current.x -o /tmp/nodesource_setup.sh
  sudo -E bash /tmp/nodesource_setup.sh
  sudo apt-get install -y nodejs
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${NODE_MAJOR}" -lt 24 ]; then
  echo "Node.js 24 or newer is required. Current version: $(node -v)"
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required and should be included with Node.js 24."
  exit 1
fi

sudo corepack enable
sudo install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"

if [ -d "${APP_DIR}/.git" ]; then
  sudo -H -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only
else
  sudo -H -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
fi

sudo -H -u "${APP_USER}" corepack pnpm --dir "${APP_DIR}" install --frozen-lockfile
sudo -H -u "${APP_USER}" corepack pnpm --dir "${APP_DIR}" build

sudo install -m 0644 "${APP_DIR}/deploy/${SERVICE_NAME}.service" "${SERVICE_PATH}"
sudo sed -i "s/^User=.*/User=${APP_USER}/" "${SERVICE_PATH}"
sudo sed -i "s/^Group=.*/Group=${APP_USER}/" "${SERVICE_PATH}"
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" "${SERVICE_PATH}"
sudo sed -i "s|^EnvironmentFile=.*|EnvironmentFile=-${APP_DIR}/.env|" "${SERVICE_PATH}"
sudo sed -i "s/^Environment=PORT=.*/Environment=PORT=${PORT}/" "${SERVICE_PATH}"

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"
sudo systemctl status "${SERVICE_NAME}" --no-pager
