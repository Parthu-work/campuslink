#!/usr/bin/env bash
# The host firewall (prompt 4, P3), run as root by provision.sh and weekly after the Cloudflare
# ranges are refreshed. One layer below nginx's own check, one layer above Oracle's security list:
#
#   443 and 80: only from Cloudflare's published ranges.  22: only from SSH_ALLOW (the owner's
#   address, comma-separated; set in /etc/campuslink/firewall.env).  Everything else: dropped.
#
# Docker publishes ports through its own chains, which bypass the INPUT chain, so the web ports are
# filtered in DOCKER-USER (the chain Docker leaves for the administrator). Oracle's Ubuntu images
# ship their own iptables rules (a REJECT at the end of INPUT, saved in /etc/iptables/rules.v4);
# this script inserts its rules ahead of them and saves the result with netfilter-persistent.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo "error: run as root" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
CONF=/etc/campuslink/firewall.env
SSH_ALLOW=$(sed -n 's/^SSH_ALLOW=//p' "$CONF" 2>/dev/null || true)
[[ -n $SSH_ALLOW ]] || { echo "error: set SSH_ALLOW=<your address or range> in $CONF first (or you lock yourself out)" >&2; exit 2; }
RANGES=$(runuser -u deploy -- "$HERE/cloudflare-ips.sh" --firewall 2>/dev/null | grep '/' || true)
V4=$(grep -v ':' <<<"$RANGES" || true)
V6=$(grep ':' <<<"$RANGES" || true)
(($(wc -l <<<"$V4") >= 10)) || { echo "error: no plausible Cloudflare list; the firewall is unchanged" >&2; exit 1; }
need_set() { ipset list "$1" >/dev/null 2>&1 || ipset create "$1" hash:net family "$2"; }
need_set cf4 inet
need_set cf6 inet6
need_set ssh4 inet
# Swap in fresh sets atomically.
ipset create cf4-new hash:net family inet -exist && ipset flush cf4-new
ipset create cf6-new hash:net family inet6 -exist && ipset flush cf6-new
ipset create ssh4-new hash:net family inet -exist && ipset flush ssh4-new
while read -r r; do [[ -n $r ]] && ipset add cf4-new "$r"; done <<<"$V4"
while read -r r; do [[ -n $r ]] && ipset add cf6-new "$r"; done <<<"$V6"
tr ',' '\n' <<<"$SSH_ALLOW" | while read -r r; do [[ -n $r ]] && ipset add ssh4-new "$r"; done
ipset swap cf4-new cf4 && ipset destroy cf4-new
ipset swap cf6-new cf6 && ipset destroy cf6-new
ipset swap ssh4-new ssh4 && ipset destroy ssh4-new
ipset save >/etc/iptables/ipsets

rule() { "$1" -C "${@:2}" 2>/dev/null || "$1" -I "${@:2}"; }
# SSH: the owner's address only (inserted at the top of INPUT, ahead of Oracle's REJECT).
rule iptables INPUT 1 -p tcp --dport 22 -m set ! --match-set ssh4 src -j DROP
# The published web ports go through DOCKER-USER: drop anything not from Cloudflare.
iptables -N DOCKER-USER 2>/dev/null || true
rule iptables DOCKER-USER 1 -p tcp -m multiport --dports 80,443,8080,8443 -m conntrack --ctstate NEW \
  -m set ! --match-set cf4 src -i "$(ip route show default | awk '{print $5; exit}')" -j DROP
ip6tables -N DOCKER-USER 2>/dev/null || true
rule ip6tables DOCKER-USER 1 -p tcp -m multiport --dports 80,443,8080,8443 -m conntrack --ctstate NEW \
  -m set ! --match-set cf6 src -j DROP
netfilter-persistent save >/dev/null
echo "Firewall: web ports from $(wc -l <<<"$V4") + $(wc -l <<<"$V6") Cloudflare ranges, SSH from $SSH_ALLOW."
