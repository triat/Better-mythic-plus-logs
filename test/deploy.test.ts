import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(b).toContain("chown caddy:caddy /var/log/caddy/bmpl.log");
    expect(b).toContain('grep -qs "/opt/bmpl/bmpl.db" /etc/litestream.yml');
    expect(b).toContain("put \"$HERE/backup-check.sh\" /usr/local/sbin/bmpl-backup-check 755 root:root");
  });
  test("the recalibration units: the bmpl binary and .env, hardened like bmpl.service, hourly and Wednesday 06:00 Paris", () => {
    for (const [unit, cmd] of [["bmpl-calibrate-collect", "calibrate --hourly"], ["bmpl-calibrate-fit", "calibrate --fit"]] as const) {
      const svc = read(`${unit}.service`);
      for (const line of ["Type=oneshot", "User=bmpl", "WorkingDirectory=/opt/bmpl", "EnvironmentFile=/opt/bmpl/.env", `ExecStart=/opt/bmpl/bmpl ${cmd}`, "ProtectSystem=strict", "ReadWritePaths=/opt/bmpl", "NoNewPrivileges=yes"]) expect(svc).toContain(line);
      expect(read("bootstrap.sh")).toContain(`${unit}.timer`);
    }
    expect(read("bmpl-calibrate-collect.timer")).toContain("OnCalendar=hourly");
    expect(read("bmpl-calibrate-fit.timer")).toContain("OnCalendar=Wed *-*-* 06:00 Europe/Paris");
  });
  test("the logs stack: loopback only, capped memory, 90 days, logs.<domain> to Grafana, Caddy's log readable by Alloy", () => {
    const vl = read("victorialogs.service");
    for (const line of ["-retentionPeriod=90d", "-httpListenAddr=127.0.0.1:9428", "-storageDataPath=/var/lib/victorialogs", "User=victorialogs", "MemoryMax=", "ProtectSystem=strict", "NoNewPrivileges=yes"]) expect(vl).toContain(line);
    const gf = read("grafana/systemd/grafana-bmpl.conf");
    for (const line of ["GF_SERVER_HTTP_ADDR=127.0.0.1", "GF_SERVER_HTTP_PORT=3001", "GF_USERS_ALLOW_SIGN_UP=false", "GF_AUTH_ANONYMOUS_ENABLED=false", "EnvironmentFile=/etc/grafana/grafana.env", "MemoryMax="]) expect(gf).toContain(line);
    expect(read("alloy/alloy-bmpl.conf")).toContain("MemoryMax=");
    const alloy = read("alloy/config.alloy");
    expect(alloy).toContain("http://127.0.0.1:9428/insert/loki/api/v1/push");
    expect(alloy).toContain("/var/log/caddy/bmpl.log");
    expect(alloy).toContain("ignore_fields=request.headers.*,resp_headers.*");
    const caddy = read("Caddyfile");
    expect(caddy.slice(caddy.indexOf("\nlogs.bmpl.example.com {"))).toContain("reverse_proxy 127.0.0.1:3001");
    expect(caddy).toContain("mode 640");
    const b = read("bootstrap.sh");
    for (const piece of ["victorialogs.service", "sha256sum -c", "apt.grafana.com", "/etc/alloy/config.alloy", "usermod -aG caddy alloy", "grafana-server.service.d/bmpl.conf", "DISCORD_ALERT_WEBHOOK", "for s in victorialogs alloy grafana-server"]) expect(b).toContain(piece);
    expect(b).not.toMatch(/ufw allow (3001|9428|12345)/);
  });
  test("Grafana provisioning: every panel and alert rule queries the VictoriaLogs data source by uid; no secret in the files", async () => {
    const { readdirSync } = await import("node:fs");
    const ds = read("grafana/provisioning/datasources/victorialogs.yaml");
    expect(ds).toContain("uid: victorialogs");
    expect(ds).toContain("url: http://127.0.0.1:9428");
    const dir = new URL("../deploy/grafana/dashboards/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(["activity.json", "dependencies.json", "errors.json", "lookups.json", "recalibration.json", "security.json", "system.json"]);
    for (const f of files) {
      const d = JSON.parse(read(`grafana/dashboards/${f}`)) as { uid: string; editable: boolean; panels: { datasource: { uid: string }; targets: { datasource: { uid: string }; expr: string }[] }[] };
      expect(d.uid.startsWith("bmpl-")).toBe(true);
      expect(d.editable).toBe(false);
      for (const p of d.panels) {
        expect(p.datasource.uid).toBe("victorialogs");
        for (const t of p.targets) { expect(t.datasource.uid).toBe("victorialogs"); expect(t.expr.length).toBeGreaterThan(0); }
      }
    }
    const alerting = read("grafana/provisioning/alerting/bmpl.yaml");
    const doc = JSON.parse(alerting.slice(alerting.indexOf("{"))) as { contactPoints: { receivers: { settings: { url: string } }[] }[]; groups: { rules: { data: { datasourceUid: string }[] }[] }[] };
    expect(doc.contactPoints[0]!.receivers[0]!.settings.url).toBe("$DISCORD_ALERT_WEBHOOK");
    for (const r of doc.groups[0]!.rules) expect(r.data[0]!.datasourceUid).toBe("victorialogs");
    for (const f of ["grafana/provisioning/alerting/bmpl.yaml", "grafana/systemd/grafana-bmpl.conf", "alloy/config.alloy"]) expect(read(f)).not.toMatch(/discord\.com\/api\/webhooks\/\d|GF_SECURITY_ADMIN_PASSWORD=\S/);
  });
  test("provisioning: bmpl-provision downloads the tag itself, applies deploy/ only when its fingerprint changed, and the deploy job calls it", () => {
    const p = read("provision.sh");
    for (const piece of ["set -euo pipefail", "^v[0-9]+\\.[0-9]+\\.[0-9]+$", "https://codeload.github.com/${REPO}/tar.gz/refs/tags/${TAG}", "flock", "find deploy -type f -print0 | sort -z | xargs -0 sha256sum", "/var/lib/bmpl-provision", "systemd-cat -t bmpl-provision", "--force"]) expect(p).toContain(piece);
    expect(p).toContain("--domain");
    expect(p).toContain("first run: pass --domain");
    // pasting the webhook is enough: a path unit on grafana.env runs bmpl-grafana-alerts.
    expect(read("bmpl-grafana-alerts.path")).toContain("PathChanged=/etc/grafana/grafana.env");
    expect(read("bmpl-grafana-alerts.service")).toContain("ExecStart=/usr/local/sbin/bmpl-grafana-alerts");
    const ga = read("grafana-alerts.sh");
    for (const piece of ["set -euo pipefail", "DISCORD_ALERT_WEBHOOK=.\\+", "/etc/grafana/provisioning/alerting/bmpl.yaml", "systemctl restart grafana-server"]) expect(ga).toContain(piece);
    const b = read("bootstrap.sh");
    for (const piece of ["/usr/local/sbin/bmpl-grafana-alerts", "systemctl enable --now bmpl-grafana-alerts.path", "/usr/local/share/bmpl/grafana-alerting.yaml"]) expect(b).toContain(piece);
    expect(b).not.toContain('put "$HERE/grafana/provisioning/alerting/bmpl.yaml" /etc/grafana/provisioning/alerting/bmpl.yaml');
    expect(read("bootstrap.sh")).toContain('put "$HERE/provision.sh" /usr/local/sbin/bmpl-provision 755 root:root');
    expect(read("sudoers-bmpl-deploy")).toContain(", /usr/local/sbin/bmpl-provision");
    expect(read("alloy/config.alloy")).toContain(".*;bmpl-provision");
    const wf = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
    expect(wf).toContain("sudo -n /usr/local/sbin/bmpl-provision '$TAG'");
    // The binary is installed and bmpl restarted before deploy/ is applied; the public check runs after both.
    expect(wf.indexOf("Ship the binary")).toBeLessThan(wf.indexOf("Provision the VPS"));
    expect(wf.indexOf("Provision the VPS")).toBeLessThan(wf.indexOf("Public health check"));
  });
  test("bootstrap.sh's put(): installs only what differs (content, mode), marks its tags, and is quiet otherwise", () => {
    const b = read("bootstrap.sh");
    const fn = b.slice(b.indexOf("put() {"), b.indexOf("\n}\n", b.indexOf("put() {")) + 2);
    const dir = mkdtempSync(join(tmpdir(), "bmpl-put-"));
    try {
      const owner = `${Bun.spawnSync(["id", "-un"]).stdout.toString().trim()}:${Bun.spawnSync(["id", "-gn"]).stdout.toString().trim()}`;
      writeFileSync(join(dir, "src"), "one\n");
      const script = `declare -A CHANGED=()\n${fn}\nput "${dir}/src" "${dir}/dst" 640 ${owner} caddy systemd\necho "tags:\${!CHANGED[*]}"\nCHANGED=()\nput "${dir}/src" "${dir}/dst" 640 ${owner} caddy\necho "tags:\${!CHANGED[*]}"`;
      const run = () => Bun.spawnSync(["bash", "-c", script]).stdout.toString();
      const first = run();
      expect(first).toContain(`installed ${dir}/dst`);
      expect(first).toMatch(/tags:(caddy systemd|systemd caddy)\ntags:\n/);
      expect(readFileSync(join(dir, "dst"), "utf8")).toBe("one\n");
      writeFileSync(join(dir, "src"), "two\n");
      expect(run()).toMatch(/installed .*\/dst\ntags:(caddy systemd|systemd caddy)\ntags:\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("no real secret or host leaks into the templates", () => {
    for (const f of ["Caddyfile", "litestream.yml", "bootstrap.sh"]) expect(read(f)).not.toMatch(/AKIA|sk_live|BEGIN (RSA|OPENSSH)/);
    expect(read("Caddyfile")).toContain("bmpl.example.com");
  });
});
