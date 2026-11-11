#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 (arm64) server for deploy/prod (prompt 4, P10). Run once as root
# on the Oracle A1 instance, after attaching the block volume (docs/deploy-oracle.md, step 2):
#
#   sudo SSH_ALLOW=<your.ip.address/32> DEPLOY_KEY="ssh-ed25519 AAAA… you@laptop" \
#        BLOCK_DEVICE=/dev/sdb bash provision.sh
#
#   SSH_ALLOW     where SSH is accepted from (comma-separated; Oracle Cloud Shell's address too if
#                 you use it). Everything else is dropped.
#   DEPLOY_KEY    the public key the `deploy` user accepts (yours; the release workflow's deploy
#                 key is added later, see docs/deploy-oracle.md › Continuous deployment).
#   BLOCK_DEVICE  the attached block volume. Formatted only if it has no filesystem yet.
#
# Safe to run again. It does: a non-root `deploy` user with SSH keys only; root login and password
# login off; unattended security upgrades; fail2ban for SSH; a 4 GB swap file; time sync; Docker
# Engine with the compose plugin, its data on the block volume; rclone and age for backups; the
# repository at /srv/campuslink; the host firewall (Cloudflare only on 80/443); and the timers
# (backup, restore drill, alerts, Cloudflare ranges).
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo "error: run as root (sudo)" >&2; exit 2; }
: "${SSH_ALLOW:?set SSH_ALLOW to your address, for example 203.0.113.7/32}"
: "${DEPLOY_KEY:?set DEPLOY_KEY to your SSH public key}"
BLOCK_DEVICE=${BLOCK_DEVICE:-}
REPO=${REPO:-https://github.com/Parthu-work/campuslink.git}
BRANCH=${BRANCH:-main}
export DEBIAN_FRONTEND=noninteractive
[[ $(dpkg --print-architecture) == arm64 ]] || echo "warning: this is not an arm64 server; the images also exist for amd64" >&2

echo "== packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git unattended-upgrades fail2ban chrony ipset \
  iptables-persistent netfilter-persistent ipset-persistent age rclone openssl jq
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now chrony fail2ban

echo "== the deploy user (SSH keys only)"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$DEPLOY_KEY" >>/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
cat >/etc/ssh/sshd_config.d/10-campuslink.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
CONF
sshd -t && systemctl reload ssh

echo "== swap (4 GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
sysctl -q -w vm.swappiness=10 && echo 'vm.swappiness=10' >/etc/sysctl.d/90-campuslink.conf

echo "== block volume for Docker's data"
if [[ -n $BLOCK_DEVICE ]]; then
  blkid "$BLOCK_DEVICE" >/dev/null 2>&1 || mkfs.ext4 -q -L campuslink "$BLOCK_DEVICE"
  mkdir -p /mnt/data
  UUID=$(blkid -s UUID -o value "$BLOCK_DEVICE")
  grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /mnt/data ext4 defaults,noatime,_netdev,nofail 0 2" >>/etc/fstab
  mountpoint -q /mnt/data || mount /mnt/data
  mkdir -p /mnt/data/docker /mnt/data/campuslink
else
  echo "warning: no BLOCK_DEVICE: Docker keeps its data on the boot volume" >&2
  mkdir -p /mnt/data/campuslink
fi

echo "== Docker Engine and compose"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<JSON
{
  "data-root": "$([[ -n $BLOCK_DEVICE ]] && echo /mnt/data/docker || echo /var/lib/docker)",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
JSON
systemctl enable docker && systemctl restart docker
usermod -aG docker deploy

echo "== the repository and state directories"
install -d -o deploy -g deploy /srv/campuslink /mnt/data/campuslink
ln -sfn /mnt/data/campuslink /var/lib/campuslink
if [[ ! -d /srv/campuslink/.git ]]; then
  runuser -u deploy -- git clone --branch "$BRANCH" --depth 1 "$REPO" /srv/campuslink
fi
install -d -m 700 -o deploy -g deploy /srv/campuslink/deploy/prod/tls /srv/campuslink/deploy/prod/cloudflare

echo "== firewall (Cloudflare only on 80/443, SSH from $SSH_ALLOW)"
install -d -m 700 /etc/campuslink
printf 'SSH_ALLOW=%s\n' "$SSH_ALLOW" >/etc/campuslink/firewall.env
runuser -u deploy -- /srv/campuslink/deploy/prod/cloudflare-ips.sh
/srv/campuslink/deploy/prod/firewall.sh
# Oracle's image REJECTs everything not listed in INPUT; Docker's published ports are forwarded
# (DOCKER-USER above), so nothing needs opening in INPUT for 80/443.

echo "== timers"
cp /srv/campuslink/deploy/prod/systemd/*.service /srv/campuslink/deploy/prod/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now campuslink-cloudflare-ips.timer campuslink-alerts.timer
# The backup and the drill start once backup.env is filled in (docs/deploy-oracle.md, step 7).
echo
echo "Done. Next, as the deploy user (docs/deploy-oracle.md, step 6):"
echo "  cd /srv/campuslink/deploy/prod && ./gen-secrets.sh --domain <your-domain>"
