#!/usr/bin/env bun
// .github/workflows/calibration-pr.yml: reads GET /api/ops/calibration's answer (a file), decides, and when the fit is
// worth a pull request writes it into src/evaluation/default-config.json and the body into pr-body.md. Prints
// `apply=true|false` and `version=N` for $GITHUB_OUTPUT, the reason on stderr; exits 1 when the fit is stale.
// 0 WCL points. Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md.
//
//   bun scripts/calibration/apply-candidate.ts <fit.json> [config path] [body path]
import { readFileSync, writeFileSync } from "node:fs";
import { applyCandidate, planApply } from "../../src/calibration/apply.ts";
import type { FitResult } from "../../src/calibration/report.ts";

const [fitPath, configPath = "src/evaluation/default-config.json", bodyPath = "pr-body.md"] = process.argv.slice(2);
if (!fitPath) {
  console.error("usage: apply-candidate <fit.json> [config path] [body path]");
  process.exit(2);
}
const fit = JSON.parse(readFileSync(fitPath, "utf8")) as FitResult & { comparison: string };
const text = readFileSync(configPath, "utf8");
const plan = planApply(fit, (JSON.parse(text) as { version: string }).version, Date.now());
console.error(plan.reason);
if (!plan.apply) {
  console.log("apply=false");
  process.exit(plan.fail ? 1 : 0);
}
const out = applyCandidate(text, fit.candidate);
writeFileSync(configPath, out.text);
writeFileSync(bodyPath, `${fit.comparison}\nConfig version ${fit.baseVersion} → ${out.version}.\n`);
console.log("apply=true");
console.log(`version=${out.version}`);
