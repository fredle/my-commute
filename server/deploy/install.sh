#!/bin/sh
# Runs on the backend host, as root, from a freshly unpacked copy of server/.
# deploy.ps1 calls it; it can also be run by hand:  sudo sh install.sh /tmp/commute-release
# Replaces the code, keeps deploy/.env, deploy/secrets and the database volume.
set -eu
SRC=${1:?unpacked release folder}
APP=/srv/apps/commute

mkdir -p "$APP/deploy/secrets"
rm -rf "$APP/src" "$APP/data"
cp -r "$SRC/src" "$SRC/data" "$SRC/package.json" "$SRC/Dockerfile" "$SRC/.dockerignore" "$APP/"
cp "$SRC/deploy/compose.yaml" "$SRC/deploy/commute.env.example" "$SRC/deploy/install.sh" "$APP/deploy/"
rm -rf "$SRC"

cd "$APP/deploy"
if [ ! -f .env ]; then
  cp commute.env.example .env
  chmod 600 .env
  echo "First deploy: fill in $APP/deploy/.env and copy the .p8 keys into $APP/deploy/secrets/, then run deploy.ps1 again." >&2
  # 2 tells deploy.ps1 this is the expected first-run stop, not a failure.
  exit 2
fi
# The container runs as uid 1000 and must be able to read the keys.
chown -R 1000:1000 secrets
chmod 700 secrets
find secrets -type f -exec chmod 600 {} +
for key in apns maps; do
  [ -f "secrets/$key.p8" ] || echo "Note: secrets/$key.p8 is missing; that feature stays off." >&2
done

DOMAIN=$(sed -n 's/^COMMUTE_DOMAIN=//p' .env | tr -d '"\r ')
[ -n "$DOMAIN" ] || { echo "Set COMMUTE_DOMAIN in $APP/deploy/.env" >&2; exit 1; }

docker compose up -d --build
app-site commute "$DOMAIN" commute:8080
docker image prune -f >/dev/null
sleep 3
docker compose ps
docker compose logs --tail 15 server
echo "Live at https://$DOMAIN/healthz"
