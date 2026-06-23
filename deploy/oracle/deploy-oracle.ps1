[CmdletBinding()]
param(
    [string]$HostName = "82.70.47.203",
    [string]$UserName = "ubuntu",
    [string]$KeyPath = "",
    [string]$RemoteAppDir = "/opt/stacks/snicksnack",
    [string]$PublicUrl = "https://snicksnack.mrcheng.se/",
    [switch]$SkipBuildCheck,
    [switch]$SkipPublicVerify
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "../..")
$ComposePath = Join-Path $ScriptDir "docker-compose.yml"
$CaddyBlockPath = Join-Path $ScriptDir "Caddyfile.block"
$LocalAppEnvPath = Join-Path $ScriptDir "app.env"
$ProjectPath = Join-Path $ProjectRoot "SnickSnack.csproj"
$Stamp = Get-Date -Format "yyyyMMddHHmmss"
$ArchivePath = Join-Path ([System.IO.Path]::GetTempPath()) "snicksnack-src-$Stamp.tar.gz"
$PublicUri = [Uri]$PublicUrl
$PublicHost = $PublicUri.Host

if ([string]::IsNullOrWhiteSpace($KeyPath)) {
    $HomeDir = [Environment]::GetEnvironmentVariable("USERPROFILE")
    if ([string]::IsNullOrWhiteSpace($HomeDir)) {
        $HomeDir = [Environment]::GetEnvironmentVariable("HOME")
    }

    if ([string]::IsNullOrWhiteSpace($HomeDir)) {
        throw "Could not determine home directory. Pass -KeyPath explicitly."
    }

    $KeyPath = Join-Path $HomeDir ".ssh/oracle.key"
}

if (-not (Test-Path $KeyPath)) {
    throw "SSH key not found: $KeyPath"
}

$SshTarget = "$UserName@$HostName"
$SshOptions = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new")

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Test-PublicUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    }
    catch {
        Write-Host "Public verification failed: $($_.Exception.Message)"
        return $false
    }
}

if (-not $SkipBuildCheck) {
    Write-Host "Building Snick Snack locally..."
    Invoke-Native dotnet "build" $ProjectPath "-c" "Release" "-o" (Join-Path $ProjectRoot "bin_verify")
}

Write-Host "Packaging source..."
Invoke-Native tar `
    "--exclude=.git" `
    "--exclude=.github" `
    "--exclude=.vs" `
    "--exclude=.vscode" `
    "--exclude=.env" `
    "--exclude=bin" `
    "--exclude=bin_verify" `
    "--exclude=obj" `
    "--exclude=*.env" `
    "--exclude=*.log" `
    "--exclude=publish" `
    "--exclude=*.tar" `
    "--exclude=*.tar.gz" `
    "-czf" $ArchivePath `
    "-C" $ProjectRoot "."

$prepareRemote = @'
set -euo pipefail
remote_app_dir="$1"

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi

sudo mkdir -p "$remote_app_dir/src" /opt/stacks/proxy
sudo chown -R ubuntu:ubuntu /opt/stacks

if ! sudo docker network inspect shared_backend >/dev/null 2>&1; then
  sudo docker network create shared_backend >/dev/null
fi

app_env="$remote_app_dir/.env"
if [ ! -f "$app_env" ]; then
  cat > "$app_env" <<ENV
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://+:8080
ENV
  chmod 600 "$app_env"
fi

sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
if ! dpkg -s iptables-persistent >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
fi
sudo mkdir -p /etc/iptables
sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
'@

Write-Host "Preparing remote directories and network..."
$prepareRemote | & ssh @SshOptions $SshTarget "bash -s -- '$RemoteAppDir'"
if ($LASTEXITCODE -ne 0) {
    throw "Remote preparation failed with exit code $LASTEXITCODE"
}

Write-Host "Uploading source and stack files..."
Invoke-Native scp @SshOptions $ArchivePath "${SshTarget}:/tmp/snicksnack-src.tar.gz"
Invoke-Native scp @SshOptions $ComposePath "${SshTarget}:$RemoteAppDir/docker-compose.yml"
Invoke-Native scp @SshOptions $CaddyBlockPath "${SshTarget}:$RemoteAppDir/Caddyfile.block"
if (Test-Path $LocalAppEnvPath) {
    Write-Host "Uploading local app.env to remote .env..."
    Invoke-Native scp @SshOptions $LocalAppEnvPath "${SshTarget}:$RemoteAppDir/.env"
}

$deployRemote = @'
set -euo pipefail
remote_app_dir="$1"
public_host="$2"
managed_domains="$public_host"
app_env="$remote_app_dir/.env"

rm -rf "$remote_app_dir/src"
mkdir -p "$remote_app_dir/src"
tar -xzf /tmp/snicksnack-src.tar.gz -C "$remote_app_dir/src"
chmod 600 "$app_env"

if [ ! -f /opt/stacks/proxy/docker-compose.yml ]; then
  cat > /opt/stacks/proxy/docker-compose.yml <<'YAML'
services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - shared_backend

volumes:
  caddy_data:
    name: caddy_data
  caddy_config:
    name: caddy_config

networks:
  shared_backend:
    external: true
    name: shared_backend
YAML
fi

cat > "$remote_app_dir/Caddyfile.block" <<CADDY
$public_host {
    encode zstd gzip
    reverse_proxy snicksnack-web:8080
}
CADDY

touch /opt/stacks/proxy/Caddyfile
sudo python3 - "$managed_domains" "$remote_app_dir/Caddyfile.block" /opt/stacks/proxy/Caddyfile <<'PY'
import pathlib
import sys

managed_domains, block_path, caddy_path = sys.argv[1:]
managed = {domain.strip() for domain in managed_domains.split(",") if domain.strip()}
block = pathlib.Path(block_path).read_text().strip() + "\n"
path = pathlib.Path(caddy_path)
text = path.read_text() if path.exists() else ""
lines = text.splitlines()
out = []
i = 0

def is_managed_site_header(line):
    stripped = line.strip()
    if not stripped.endswith("{"):
        return False
    hosts = [host.strip() for host in stripped[:-1].split(",")]
    return any(host in managed for host in hosts)

while i < len(lines):
    if is_managed_site_header(lines[i]):
        depth = lines[i].count("{") - lines[i].count("}")
        i += 1
        while i < len(lines) and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}")
            i += 1
        while out and out[-1].strip() == "":
            out.pop()
        continue
    out.append(lines[i])
    i += 1

new_text = "\n".join(out).rstrip()
if new_text:
    new_text += "\n\n"
new_text += block
path.write_text(new_text)
PY

cd "$remote_app_dir"
sudo docker compose up -d --build snicksnack-web

cd /opt/stacks/proxy
sudo docker compose up -d
sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || sudo docker restart caddy >/dev/null

sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
'@

Write-Host "Deploying remote stack..."
$deployRemote | & ssh @SshOptions $SshTarget "bash -s -- '$RemoteAppDir' '$PublicHost'"
if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed with exit code $LASTEXITCODE"
}

if (-not $SkipPublicVerify) {
    Write-Host "Verifying $PublicUrl ..."
    $attempts = 12
    for ($i = 1; $i -le $attempts; $i++) {
        if (Test-PublicUrl -Url $PublicUrl) {
            Write-Host "Public verification succeeded."
            break
        }

        if ($i -eq $attempts) {
            throw "Public verification failed for $PublicUrl after $attempts attempts."
        }

        Write-Host "Waiting for HTTPS to become ready ($i/$attempts)..."
        Start-Sleep -Seconds 10
    }
}

Write-Host "Snick Snack deployment complete."
