# Deploys the server to the shared backend host (app-factory/infra/backend-host):
# packs server/, copies it over the IAP tunnel, and runs install.sh there.
# Settings and keys stay on the VM, in /srv/apps/commute/deploy/.
#
#   ./server/deploy/deploy.ps1
param(
    [string]$Instance = "apps",
    [string]$Zone = "europe-west2-b",
    [string]$Project = "leatham-sandbox"
)
$ErrorActionPreference = "Stop"

$server = Split-Path $PSScriptRoot -Parent
$archive = Join-Path $env:TEMP "commute-server.tgz"
Remove-Item $archive -ErrorAction SilentlyContinue

# Only what the image and install.sh need; never .env, keys or local databases.
tar -czf $archive -C $server package.json Dockerfile .dockerignore data src `
    deploy/compose.yaml deploy/commute.env.example deploy/install.sh
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

$where = @("--zone=$Zone", "--project=$Project", "--tunnel-through-iap")
gcloud compute scp $archive "${Instance}:/tmp/commute-server.tgz" @where
if ($LASTEXITCODE -ne 0) { throw "copy failed" }

$remote = "rm -rf /tmp/commute-release && mkdir /tmp/commute-release && " +
          "tar -xzf /tmp/commute-server.tgz -C /tmp/commute-release && rm /tmp/commute-server.tgz && " +
          "sudo sh /tmp/commute-release/deploy/install.sh /tmp/commute-release"
gcloud compute ssh $Instance @where --command $remote
$code = $LASTEXITCODE
Remove-Item $archive
if ($code -eq 2) {
    Write-Host "`nFirst deploy: the code is on the VM, and /srv/apps/commute/deploy/.env was created from the template." -ForegroundColor Yellow
    Write-Host "Fill it in and copy apns.p8 and maps.p8 into /srv/apps/commute/deploy/secrets/, then run this again:" -ForegroundColor Yellow
    Write-Host "  gcloud compute ssh $Instance $($where -join ' ')"
    return
}
if ($code -ne 0) { throw "install failed with exit code $code (see above)" }
