import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../deploy/${f}`, import.meta.url), "utf8");

describe("deploy/ files agree on the VPS layout", () => {
  test("Caddyfile proxies to loopback only, sets HSTS, compresses", () => {
    const c = read("Caddyfile");
    expect(c).toContain("reverse_proxy 127.0.0.1:3000");
    expect(c).toContain('Strict-Transport-Security "max-age=31536000');
    expect(c).toContain("encode zstd gzip");
    expect(c).not.toContain("trusted_proxies");
  });
  test("bmpl.service runs the binary as bmpl from /opt/bmpl, hardened, restarts", () => {
    const u = read("bmpl.service");
    for (const line of ["User=bmpl", "Group=bmpl", "WorkingDirectory=/opt/bmpl", "EnvironmentFile=/opt/bmpl/.env", "ExecStart=/opt/bmpl/bmpl serve --hosted --port 3000 --host 127.0.0.1", "Restart=always", "ProtectSystem=strict", "ReadWritePaths=/opt/bmpl", "NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectHome=yes", "WantedBy=multi-user.target"]) expect(u).toContain(line);
  });
  test("litestream replicates /opt/bmpl/bmpl.db and runs as its own unit", () => {
    const y = read("litestream.yml");
    expect(y).toContain("path: /opt/bmpl/bmpl.db");
    expect(y).toMatch(/type: s3/);
    expect(y).toContain("<bucket>");
    expect(y).toContain("access-key-id: <access-key>");
    expect(y).toContain("secret-access-key: <secret-key>");
    const u = read("litestream.service");
    expect(u).toContain("ExecStart=/usr/bin/litestream replicate -config /etc/litestream.yml");
    expect(u).toContain("Restart=always");
    expect(u).toContain("User=bmpl");
  });
  test("the backup check writes /opt/bmpl/last-backup only when the replica is fresh, hourly", () => {
    const s = read("backup-check.sh");
    expect(s.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(s).toContain("set -euo pipefail");
    expect(s).toContain("litestream snapshots -config /etc/litestream.yml /opt/bmpl/bmpl.db");
    expect(s).toContain("touch /opt/bmpl/last-backup");
    expect(read("bmpl-backup-check.timer")).toContain("OnCalendar=hourly");
    const svc = read("bmpl-backup-check.service");
    expect(svc).toContain("ExecStart=/usr/local/sbin/bmpl-backup-check");
    expect(svc).toContain("User=bmpl");
  });
  test("bootstrap opens only 22, 80 and 443 and installs the pieces", () => {
    const b = read("bootstrap.sh");
    expect(b).toContain("set -euo pipefail");
    expect(b).toContain("ufw default deny incoming");
    for (const p of ["22/tcp", "80/tcp", "443/tcp"]) expect(b).toContain(`ufw allow ${p}`);
    expect(b).not.toMatch(/ufw allow 3000/);
    expect(b).toContain("useradd --system");
    expect(b).toContain("install -d -o bmpl -g bmpl -m 750 /opt/bmpl");
    expect(b).toContain("systemctl enable --now caddy");
    expect(b).toContain("sqlite3");
    expect(b).toContain("systemctl reload caddy");
    expect(b).toContain('grep -qs "/opt/bmpl/bmpl.db" /etc/litestream.yml');
    expect(b).toContain("install -m 755 \"$HERE/backup-check.sh\" /usr/local/sbin/bmpl-backup-check");
  });
  test("no real secret or host leaks into the templates", () => {
    for (const f of ["Caddyfile", "litestream.yml", "bootstrap.sh"]) expect(read(f)).not.toMatch(/AKIA|sk_live|BEGIN (RSA|OPENSSH)/);
    expect(read("Caddyfile")).toContain("bmpl.example.com");
  });
});
