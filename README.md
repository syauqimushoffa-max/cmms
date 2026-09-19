# PBS CMMS System

A learning-friendly CMMS foundation using:

- React + TypeScript PWA frontend
- Node/Express API backend
- SQLite primary database through Node 24's built-in `node:sqlite`
- Optional Google Sheets work-order mirror through a secured Apps Script web app
- Local server upload storage

## How To Run

Install dependencies:

```powershell
pnpm install
```

Start both API and web app:

```powershell
pnpm dev
```

Default local URLs:

- Web app: http://localhost:5173
- API health: http://localhost:3300/api/health

## Production Access and Integrations

Work Orders and Spare Parts follow existing role permissions. Technicians can access assigned PM work; executives can manage PM and view Assets, Performance and Reports. Admin and developer accounts manage users and settings. API sessions expire after 30 days; an HttpOnly session cookie also authenticates photos and live updates. Dashboard and TV data now require sign-in.

### Port Klang and Sendayan

Role and plant access are separate. In **Users → People**, set each account's **Plant access** to **Port Klang**, **Sendayan**, or **Both plants**. Existing records and ordinary users migrate to Port Klang; existing admins and developers receive both plants. Changing plant access revokes the user's sessions, so they must sign in again. An administrator with access to only one plant cannot grant access to the other plant or manage its users.

The **Settings → Plant view** selector controls work orders, spare stock and movement history, sections/machines, assets, PM plans/checklists/schedules, notifications and integration settings. It is not displayed above every page. Single-plant users are restricted to their assignment by the API. Users assigned both plants can choose **Both plants** from the compact filter on Performance and Reports. Combined reporting includes both datasets; operational changes require one selected plant. Exports identify the plant for each exception.

To set up Sendayan:

1. Back up the production SQLite database and uploads using the deployment instructions below before installing this update.
2. Sign in as an admin/developer, select **Sendayan**, and create its users, sections, machines and issue categories.
3. Import Sendayan's spare-parts master list. The same part number can exist in both plants with independent balances and movement history.
4. In **Preventive Maintenance**, choose **New PM plan**, assign a Sendayan technician, then create and connect its checklists.
5. Configure Sendayan's Google Sheets/webhook settings while Sendayan is selected. Existing settings and environment-variable integration defaults remain Port Klang-only; use separate spreadsheet destinations/tabs for Sendayan to keep external stock balances separate.
6. Use `/requester?plant=sendayan` for Sendayan's guest request form/QR and `/requester?plant=port-klang` for Port Klang. The selected plant is visible on the form. Private tracking links remain specific to one work order.

The migration preserves existing IDs, work-order numbers, stock balances and history. New Sendayan work orders include `SDN` in their number; counters are independent by plant. Sendayan starts without copied operational records. PM schedules are generated for the current and next year for each plant. Existing photo URLs now require an authorized session or a valid guest tracking token, including when opened from a spreadsheet.

Plant regression tests run against isolated databases under `tmp`, without modifying the working database:

```powershell
pnpm test:plants
pnpm typecheck
pnpm build
```

For database development, query the `scoped_*` views for plant-owned reads, insert `plantId = cmms_write_plant()`, and execute request work inside `plantContext`. Base-table triggers reject cross-plant writes and relationships. The unscoped database connection is reserved for migrations, authentication and explicitly checked media access. Do not access base tables directly from new resource endpoints.

Guest requesters receive a private signed tracking link after submitting a work order. The link shows live progress, photos, maintenance notes, and the requester verification controls when a repair is resolved. It does not require an account; anyone holding the link can view and verify that specific guest work order. Executives, admins, and developers can retrieve the same link from the work-order detail page.

Create a `.env` file on the production host and use strong, unique passwords:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-long-unique-password
DEVELOPER_USERNAME=developer
DEVELOPER_PASSWORD=replace-with-a-different-long-unique-password
DEVELOPER_NAME=CMMS Developer
USER_PASSWORDS_JSON={"hafiz":"replace-with-unique-password","kumar":"replace-with-another-password","azlan":"replace-with-third-password"}
APP_PUBLIC_URL=http://cmms-server-ip:3300
```

`DEVELOPER_PASSWORD` enables developer sign-in. `ADMIN_PASSWORD` replaces the seeded admin password on startup. `USER_PASSWORDS_JSON` applies per-user passwords (minimum 12 characters) using usernames as keys. Do not leave the original local-development passwords active on a production network.

Admins can create, edit, reset passwords for, and remove sign-in accounts from **Users → People**. Passwords are stored as one-way hashes and are never displayed; an admin can set a replacement password instead. Changing a password or role revokes that account's existing sessions. Removing an account immediately revokes its sessions and hides it from active-user lists while retaining its historical work orders, PM records, uploads, and stock activity.

### PWA push notifications

Generate one VAPID key pair and add it to `.env`. Keep the same keys across deployments; replacing them invalidates existing device subscriptions.

```powershell
pnpm push:keys
```

```dotenv
VAPID_SUBJECT=mailto:cmms@example.com
VAPID_PUBLIC_KEY=paste-the-generated-public-key
VAPID_PRIVATE_KEY=paste-the-generated-private-key
```

After signing in, open the notification bell (or the requester account screen) and choose **Enable push alerts**. An administrator can use **Send test to all** to broadcast a test alert to every registered device; the test action is hidden and API-blocked for every other role. Browser permission must be requested from this user action. Work-order events that already create in-app notifications will also send Web Push alerts to registered devices.

`http://localhost` is allowed for local development. A phone opening the PWA through a LAN IP such as `http://192.168.x.x:3300` is not a secure context, so production and phone testing require HTTPS. On iPhone and iPad, add the PWA to the Home Screen before enabling alerts.

### Google Sheets work-order mirror

PostgreSQL is not used by this repository: the server database in this version is SQLite. It is the authoritative store, and Google Sheets is a secondary mirror. Failed Sheet updates stay in a durable outbox and retry every minute, so work-order submission continues during Google or network outages.

1. Create the target Google Sheet.
2. Follow [docs/work-orders-apps-script.js](docs/work-orders-apps-script.js), deploy it as an Apps Script web app, and set a strong `CMMS_SHARED_TOKEN` script property.
3. Sign in as admin/developer, open **Settings**, and enter the `/exec` URL, shared token, and Sheet tab name.
4. Use **Sync now** to send queued records and verify the status counters.

In row 1 of the `WorkOrders` tab, paste these column names exactly (the Apps Script also creates missing headers when it receives its first record):

```text
WorkOrderID	DateSubmitted	Date	Shift	Type	Section	Area	Machine Name	MachineID	IssueCategory	ReportedBy	Department	Priority	IssueDescription	PhotoIssue	Downtime Actual	Total Downtime	Total Time	Production Downtime	Total Queue Time	System Repair Elapsed	Maintenance Actual	Downtime Reason	Status	MaintenanceBy	MaintenanceNotes	PhotoFix	DateAcknowledge	AcknowledgeTime	DateRepair	RepairTime	FinishTime	VerifyTime	Change Spare Part	Part Name	Quantity	Part Number	DateResolved	Date Finish	DateClosed	Remarks	ReturnPhoto	UpdatedAt
```

The same screen accepts the existing Node-RED endpoint (for example `http://node-red:1880/workorderpk`). CMMS posts the compatible `{ "Data": ... }` payload only for work-order lifecycle events, allowing the supplied Telegram flow to keep handling Open/Returned alerts and Resolved/Closed removal.

Work-order timing uses separate accountability clocks:

- **Total Time** is system-calculated from issue submission until requester closure.
- **Production Downtime** remains available in exports as issue submission until maintenance resolution.
- **Total Queue Time** is system-calculated from issue submission until the first Start Repair action.
- **System Repair Elapsed** is system-calculated from the first Start Repair action until the latest resolution.
- **Maintenance Actual** is the hands-on time entered by maintenance at resolution.
- Production work orders open for at least 60 minutes show a pulsing **Reason Pending** prompt and notify Production requesters to follow up with maintenance.

The Apps Script formats the mirror for people rather than exposing raw payloads: dates use `dd/mm/yyyy`, timestamps use `dd/mm/yyyy hh:mm`, duration fields show elapsed minutes, photo paths become compact links, long descriptions wrap, and technical ID/sync columns are hidden by default. After changing `docs/work-orders-apps-script.js`, create a new Apps Script deployment version so the live `/exec` endpoint uses the update. Reload the Sheet and run **PBS CMMS → Format existing work orders** once to clean up rows written by an older script. Set `APP_PUBLIC_URL` to the CMMS address reachable by Sheet users if photo links should open from Google Sheets.

Deleting a work order in CMMS also queues deletion of the matching `WorkOrderID` row in Google Sheets. The deletion queue is durable and is retried through the normal sync worker if Apps Script is temporarily unavailable. The deployed Apps Script must include the `deleteWorkOrder` action from the current `docs/work-orders-apps-script.js`.

### AppSheet Air Leak work orders

The Air Leak App can create duplicate-safe SHE work orders through `POST /api/integrations/appsheet/air-leaks`. Configure its inbound token and return-sync Apps Script URL in **Settings → AppSheet Air Leak Integration**. The AppSheet Bot must send `Air Leak ID`, date, section, picture URL, issue, machine/equipment and issuer. `Air Leak ID` is the external key, so webhook retries return the existing CMMS work order instead of creating a duplicate.

CMMS queues every mapped lifecycle update separately from the general WorkOrders mirror. When the CMMS work order closes, [docs/air-leak-apps-script.js](docs/air-leak-apps-script.js) updates the matching Air Leak row to `Close`, including the close date, assigned technician, proof-photo URL and detailed CMMS status. Existing Production master data is retained as Production; new sections, machines and issue categories are assigned to a department and are only offered for that department's work orders.

To mirror AppSheet deletions, add a second AppSheet Bot for **Deletes only** that calls the same endpoint and token with `{"action":"delete","airLeakId":"<<[_THISROW_BEFORE].[Air Leak ID]>>"}`. The operation is idempotent: it permanently removes only the CMMS work order mapped to that Air Leak ID, and a retry after deletion returns `deleted: false` without affecting another work order.

These values can also be supplied without the UI:

```dotenv
WORK_ORDER_SYNC_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
WORK_ORDER_SYNC_TOKEN=the-same-shared-token
WORK_ORDER_SYNC_SHEET_NAME=WorkOrders
WORK_ORDER_WEBHOOK_URL=http://node-red:1880/workorderpk
```

The generated IDs use `WO-<section>-<type>-<YYMM>-<sequence>`, for example `WO-CV-MNT-2608-001` or `WO-RM-KZN-2608-001`. The monthly counter is atomic, avoiding duplicate numbers during simultaneous submissions.

## GitHub: Pull and Push Updates

Run these commands from the project folder. The main branch for this project is `main`.

### Pull the latest update

Before starting work, check that you do not have unfinished changes:

```powershell
git status
```

Then download and apply the latest version from GitHub:

```powershell
git pull --rebase origin main
pnpm install
```

Run `pnpm install` after pulling because an update may add or change a dependency. Start the updated app with:

```powershell
pnpm dev
```

### Push your changes

Review the changed files:

```powershell
git status
git diff
```

Add the files, create a commit, and push it to GitHub:

```powershell
git add .
git commit -m "Describe what was changed"
git pull --rebase origin main
git push origin main
```

The second pull checks for updates made by someone else before your push. Do not use `git add .` if the status shows files that should not be included; add only the required paths instead, for example `git add README.md`.

If Git reports a conflict, do not force-push. Open each conflicted file, choose the correct content, and then continue:

```powershell
git add <fixed-file>
git rebase --continue
git push origin main
```

To cancel the conflicted rebase and return to the state before the pull:

```powershell
git rebase --abort
```

### Update the existing production Docker deployment on the Atom PC

The current PBS CMMS production server uses these locations:

- App repository: `/srv/apps/cmms`
- Compose file: `/srv/apps/cmms/docker-compose.yml`
- SQLite data: `/srv/app-data/cmms/data`
- Uploaded images: `/srv/app-data/cmms/uploads`
- Container: `pbs-cmms`
- Port: `3300`

The repository also contains a default `compose.yaml` for fresh installations. On this existing server, always include `-f docker-compose.yml` so Docker uses the production bind mounts above and does not accidentally start a separate empty installation.

First, check that the repository has no unfinished local changes:

```bash
cd /srv/apps/cmms
git status
git remote -v
git branch --show-current
```

Before an update, make a timestamped backup. The short stop ensures the SQLite file is copied consistently:

```bash
backup_file="/srv/app-data/cmms-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

docker stop pbs-cmms
sudo tar -czf "$backup_file" -C /srv/app-data/cmms data uploads
docker start pbs-cmms

echo "Backup saved to: $backup_file"
```

Pull the latest code, rebuild the image, and recreate the container using the existing production configuration:

```bash
cd /srv/apps/cmms
git pull --ff-only origin main
docker compose -f docker-compose.yml up -d --build --remove-orphans
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 cmms
curl http://localhost:3300/api/health
```

The bind-mounted database and uploads remain in `/srv/app-data/cmms` when the container is rebuilt. Do not delete that directory. Also avoid `docker compose down -v` because it can delete Docker-managed volumes in other Compose configurations.

Useful commands for this production deployment:

```bash
# Follow app logs
docker compose -f /srv/apps/cmms/docker-compose.yml logs -f --tail=100 cmms

# Restart without rebuilding
docker compose -f /srv/apps/cmms/docker-compose.yml restart cmms

# Check the API
curl http://localhost:3300/api/health

# Stop and start while retaining the bind-mounted data
docker compose -f /srv/apps/cmms/docker-compose.yml stop cmms
docker compose -f /srv/apps/cmms/docker-compose.yml start cmms
```

### Update the Raspberry Pi deployment

After pushing an update, run these commands on the Raspberry Pi:

```bash
cd /opt/pbs-cmms
git pull --ff-only origin main
corepack pnpm install --frozen-lockfile
corepack pnpm build
sudo systemctl restart pbs-cmms
sudo systemctl status pbs-cmms --no-pager
```

## Docker Install on a Linux Atom PC

This repository includes a production `Dockerfile` and `compose.yaml`. The Docker image uses Node.js 24 and serves both the API and built website on port `3300`.

Install Docker Engine with the official instructions for your Linux distribution, including the Docker Compose plugin. Confirm that both commands work:

```bash
docker --version
docker compose version
```

Clone and start PBS CMMS:

```bash
sudo mkdir -p /opt/pbs-cmms
sudo chown "$USER":"$USER" /opt/pbs-cmms
git clone https://github.com/syauqimushoffa-max/cmms.git /opt/pbs-cmms
cd /opt/pbs-cmms
docker compose up -d --build
```

Open the application from another device on the same network:

- CMMS: `http://<atom-pc-ip>:3300`
- API health: `http://<atom-pc-ip>:3300/api/health`

Find the Atom PC's IP address with:

```bash
hostname -I
```

If port `3300` is already used, create a `.env` file beside `compose.yaml` with another host port:

```dotenv
CMMS_PORT=8080
```

Then recreate the container and open `http://<atom-pc-ip>:8080`:

```bash
docker compose up -d
```

### Back up Docker data

Stop the app briefly so the SQLite backup is consistent, copy both persistent folders, and start it again:

```bash
cd /opt/pbs-cmms
backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
docker compose stop cmms
docker compose cp cmms:/app/apps/api/data "$backup_dir/data"
docker compose cp cmms:/app/apps/api/uploads "$backup_dir/uploads"
docker compose start cmms
```

Keep the resulting `backups/<date-time>` folder somewhere safe outside the Atom PC as well.

## Raspberry Pi Service Install

This app requires Node.js 24 or newer because the API uses `node:sqlite`. The installer below installs Node.js Current from NodeSource if the Pi does not already have Node.js 24+.

On the Raspberry Pi, clone and install the service with:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo install -d -o "$USER" -g "$USER" /opt/pbs-cmms
git clone https://github.com/syauqimushoffa-max/cmms.git /opt/pbs-cmms
cd /opt/pbs-cmms
bash deploy/install-pi.sh
```

The installer creates a `pbs-cmms` systemd service that runs the production build on port `3300`.

Useful service commands:

```bash
sudo systemctl status pbs-cmms --no-pager
sudo journalctl -u pbs-cmms -f
sudo systemctl restart pbs-cmms
```

After install, open:

- CMMS: http://<raspberry-pi-ip>:3300
- API health: http://<raspberry-pi-ip>:3300/api/health

## Learning Path

The app is split into three layers:

- `packages/shared`: common TypeScript types used by both frontend and backend.
- `apps/api`: Express API, SQLite database, uploads, work order workflow, notifications.
- `apps/web`: React PWA interface for requesters, technicians, executives, and TV dashboard.

The first real feature is Work Orders. Other CMMS areas are included as placeholder pages so the system already has a proper product shape.
