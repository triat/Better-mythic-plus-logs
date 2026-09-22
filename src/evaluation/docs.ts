import type { Locale } from "../hosted/locale.ts";
import { EVALUATION_DOCS_FR } from "./docs.fr.ts";
import type { AxisKey } from "./types.ts";

export interface SubSignalDoc {
  title: string; what: string; source: string; how: string; why: string; naWhen: string;
  /** What the curve's x axis is, e.g. "deaths per run, level-scaled". */
  unit: string;
  /** True when the value is multiplied by levelScale(run key level) before the curve. */
  scaledByLevel: boolean;
}
export interface ExtraDoc { title: string; what: string; how: string; why: string }
export interface AxisDoc { title: string; summary: string; why: string; subSignals: Record<string, SubSignalDoc>; extras?: Record<string, ExtraDoc> }
export interface TextBlock { title: string; text: string }
export interface SourceDoc extends TextBlock { freshness: string }
export interface FaqEntry { q: string; a: string; hostedOnly?: boolean }
/**
 * The hosted-only guide to a member's own Warcraft Logs client (/help#wcl-client). Prose may carry
 * links as `[label](href)`; the front renders them (web/src/lib/help.ts `linkSegments`). The
 * numbers (shared quota, WCL's own limit) come from GET /api/docs' `quota`, never from here.
 */
export interface WclClientDoc {
  title: string;
  /** Why bother: what the shared budget is and what an own client changes. */
  why: string;
  /** Captions of the two budget pills: "{n} pts / h" is printed above each by the front. */
  sharedHint: string;
  ownHint: string;
  /** Numbered steps on warcraftlogs.com, then in bmpl. */
  onWcl: string[];
  inBmpl: string[];
  safety: string;
}
/**
 * The guide to the in-game addon that draws the Live panel's pixel strip (/help#live-addon, the Live
 * chip's connect dialog links here — see `LiveChip.tsx`'s "Get the addon" link). Same shape as
 * `WclClientDoc`: prose, two numbered step lists, one closing line. Not hosted-only — the Live panel
 * works the same way locally and hosted (`useWowCapture()` is unconditional in `App.tsx`).
 */
export interface LiveAddonDoc {
  title: string;
  /** Why bother: what the addon draws and why the browser needs it. */
  why: string;
  /** Numbered steps: download/unzip/reload. */
  install: string[];
  /** Numbered steps: the Live chip, sharing the window, opening the Group Finder. */
  connect: string[];
  /** Closing line: the addon sends/receives/stores nothing — what actually leaves the browser. */
  sends: string;
}
export interface EvaluationDocs {
  axes: Record<AxisKey, AxisDoc>;
  verdict: { summary: string; global: string; thresholds: string; confidence: string; insufficient: string; role: string };
  levelScale: string;
  expectedIlvl: string;
  peers: string;
  runsUsed: string;
  notScored: TextBlock[];
  runSignals: TextBlock[];
  deepdive: { summary: string; usage: string; deaths: string; table: string; cost: string };
  sources: SourceDoc[];
  faq: FaqEntry[];
  wclClient: WclClientDoc;
  liveAddon: LiveAddonDoc;
}

export const EVALUATION_DOCS: EvaluationDocs = {
  sources: [
    { title: "Warcraft Logs rankings", text: "The character's best run per dungeon this season on the selected metric (DPS, or HPS for healers), with parse %, key level, date and report. This is the list the run table shows; the evaluation uses these runs plus the best run at the nearest key level below the target that has one. One region per lookup (EU, US, KR, TW) — the chip in the search field remembers your last choice; a pasted Raider.IO link brings its own region.", freshness: "Fetched at every lookup. A lookup stays in your history until you Refresh it; on a shared instance, a lookup of the same character made by another member less than 6 hours ago is reused instead of fetched again (the tab says \"cached\")." },
    { title: "Each run's log", text: "For every shown run, the fight's own events: deaths (what killed the player, who else died and when), damage taken, damage from the season's list of avoidable mechanics, interrupts, dispels, potions and healthstones — for the player and for the other four in the group.", freshness: "Fetched once per run (about 10 WCL points) and cached forever: a run never changes after the fact." },
    { title: "Raider.IO", text: "Item level, current and previous season score per role, and the last 10 runs with timed/depleted.", freshness: "Fetched at a lookup and reused for an hour (Refresh fetches it again); free, no key." },
  ],
  runsUsed: "\"Shown runs\" are the best run per dungeon this season (one per dungeon) plus, when it is not already one of them, the best run at the nearest key level below the target that has one. A run counts for the evaluation once its log has been fetched (\"enriched\"); the number of enriched runs is what the confidence and the minimum-runs rule look at.",
  peers: "\"Peers\" are the other players of the same run — never a global average. The comparison is (yours − median of the peers) / median of the peers, in %, so +20% means a fifth more than the typical player of that exact group and that exact key. Which players count as peers depends on the signal: everyone for avoidable damage, DPS only for damage taken (a tank is expected to take more), DPS and tanks for interrupts (healers rarely kick).",
  verdict: {
    summary: "The verdict is a rule-based reading of six axes. Each axis scores 0–100 from its sub-signals; the global score is a weighted mean of the axes; the verdict is the global score against two thresholds.",
    role: "The role (DPS, healer, tank) is the one the player had in most of the shown runs; with no run data it follows the metric (HPS → healer). Weights differ by role.",
    global: "Global = Σ(axis weight × axis score) / Σ(axis weight) over the axes that could be scored, with the weights of the player's role, rounded to a whole number. An axis that is n/a is left out of both sums, so it neither helps nor hurts.",
    thresholds: "INVITE when the global score reaches the invite threshold, MAYBE when it reaches the maybe threshold, PASS below. The thresholds are printed below from this instance's configuration.",
    confidence: "Confidence is only about how many enriched runs the evaluation saw: high, medium or low by the two run counts printed below. It does not change the score.",
    insufficient: "With fewer enriched runs than the minimum printed below the verdict is INSUFFICIENT DATA whatever the score would have been: there is not enough signal to say anything.",
  },
  levelScale: "A death at a high key is not a death at a low key. For the death-based sub-signals each run's count is multiplied by a factor read at that run's own key level (not the target you asked for, so asking for a harder key never makes the same deaths look better or worse), before it goes through the curve. Between two listed levels the factor is interpolated; outside them it is clamped.",
  expectedIlvl: "Item level is judged against what a character is expected to wear at the target key level this season. The expected value is interpolated between the listed levels and clamped outside them; the season is the one Raider.IO reports for the character, falling back to the newest season this instance knows.",
  axes: {
    survival: {
      title: "Survival",
      summary: "Whether the player stays alive and makes the healer's life easy: deaths, damage taken, avoidable damage and — once runs have been deep-dive analyzed — how they use their defensive cooldowns.",
      why: "In a key, a death costs time and often the run; the log shows exactly whose deaths were avoidable.",
      subSignals: {
        individualDeaths: { title: "Individual deaths", what: "Deaths of the player that were not part of a group wipe, per run.", source: "Each run's log: the player's death events. A death is \"in a wipe\" when at least 3 members of the group died within 15 seconds of it.", how: "For each run, the count of non-wipe deaths × the level factor of that run's key; then the mean over the enriched runs. The evidence line shows the unscaled mean.", why: "The strongest single predictor that a player will die in your key too.", naWhen: "Never: every enriched run has death data (zero deaths is a value).", unit: "deaths per run, level-scaled", scaledByLevel: true },
        wipeDeaths: { title: "Deaths in wipes", what: "Deaths of the player that happened inside a group wipe, per run.", source: "Each run's log, same death events, the ones flagged \"in a wipe\" (3+ group deaths within 15 seconds).", how: "Mean over the enriched runs of the count of wipe deaths. Not level-scaled.", why: "Wipes are mostly the group's doing; they are counted separately, with a lower weight, so a bad pull does not read as a personal failure.", naWhen: "Never.", unit: "deaths per run", scaledByLevel: false },
        avoidableVsPeers: { title: "Avoidable damage vs peers", what: "Damage taken from mechanics the season list marks as avoidable, compared with the other players of the same run.", source: "Each run's log filtered by the season's avoidable-damage list (the same classification the in-game death recap uses); everyone in the group is a peer here.", how: "Per run: avoidable damage per minute, then (yours − peer median) / peer median in %; the median of that over the runs that have a comparison.", why: "Standing in things is invisible in a parse and very visible in a key.", naWhen: "When no run has a comparison: the dungeon has no avoidable list, the fight's damage tables are missing, or no peer took any avoidable damage (the median is 0).", unit: "% vs peers", scaledByLevel: false },
        dtpsVsPeers: { title: "Damage taken vs peers", what: "All damage taken per second, compared with the DPS players of the same run.", source: "Each run's damage-taken table; peers are the DPS only, so the tank's larger intake never skews it.", how: "Per run: (your DTPS − peer median DTPS) / peer median in %; the median over runs. The role weights beside the curve show how much it counts for each role.", why: "Taking more than the other DPS of the same group means extra healing for the same output.", naWhen: "When no run has DPS peers with damage data (for a tank the comparison is not computed at all).", unit: "% vs peers", scaledByLevel: false },
        groupDeaths: { title: "Teammate deaths", what: "Deaths of the other four players, per run — a healer's signal.", source: "Each run's log: all deaths in the group minus the player's own.", how: "Per run, teammate deaths × the level factor of that run's key; the mean over runs. The role weights beside the curve show which roles it counts for.", why: "For a healer, the group's deaths are partly theirs.", naWhen: "Never for a healer; not counted for other roles.", unit: "teammate deaths per run, level-scaled", scaledByLevel: true },
        defensiveUsage: { title: "Defensive cooldown usage", what: "How much of the possible uses of major and immunity defensives the player actually cast, from deep-dive analyses.", source: "Deep-dive analysis of the run (the Analyze button): casts of each major/immunity defensive of the spec's table versus how many times it could have come off cooldown during the fight.", how: "Per defensive: min(1, casts / capacity) with capacity = ceil(fight length / cooldown), at least 1; per run the mean over the major and immunity defensives; then the median over the analyzed runs among the shown ones.", why: "A player who sits on their defensives is the one who dies to the next unavoidable hit.", naWhen: "Until at least the minimum number of shown runs printed below have been analyzed; also when the spec's table has no major or immunity entry.", unit: "share of possible uses (0–1)", scaledByLevel: false },
        avoidableDeaths: { title: "Deaths with a defensive available", what: "Share of the player's deaths where an immunity or a major defensive was off cooldown and not used, from deep-dive analyses.", source: "Deep-dive analysis: for each non-wipe death, which defensives were available, active or on cooldown at that moment.", how: "Over the analyzed shown runs: deaths judged \"immunity available\" or \"defensive available\" divided by all non-wipe deaths; \"covered\" (a defensive was active) and \"nothing available\" do not count against the player.", why: "A death with a defensive in hand is the most avoidable kind.", naWhen: "Until the minimum number of analyzed runs is reached, and when the analyzed runs contain no non-wipe death.", unit: "share of deaths (0–1)", scaledByLevel: false },
      },
    },
    utility: {
      title: "Utility",
      summary: "Interrupts, normalized by what the spec could physically cast, and dispels.",
      why: "In a key, a missed kick is a cast that lands on the group; utility is where a good player is felt more than seen.",
      subSignals: {
        kicksVsPeers: { title: "Kicks vs peers", what: "Interrupt usage compared with the DPS and tanks of the same run.", source: "Each run's interrupt table; every player's usage is normalized by their own spec's kick cooldown, so a spec with a short kick is not favoured.", how: "Usage = kicks / (fight length / kick cooldown). Per run: your usage − the peer median, in percentage points; the median over runs.", why: "Compared within the same pull count and the same affixes, the fairest kick measure there is.", naWhen: "When the spec has no interrupt, or when no run has an interrupt table.", unit: "percentage points vs peers", scaledByLevel: false },
        kicksAbsolute: { title: "Kick capacity used", what: "Interrupt usage on its own: how much of the possible kicks the player cast.", source: "Each run's interrupt table and the spec's baseline kick cooldown.", how: "Usage = kicks / (fight length / kick cooldown), per run; the median over runs.", why: "Even a group that kicks little should not hide a player who never kicks.", naWhen: "When the spec has no interrupt.", unit: "share of possible kicks (0–1)", scaledByLevel: false },
        dispels: { title: "Dispels", what: "Dispels, purges, spellsteals and soothes per run.", source: "Each run's dispel table (Warcraft Logs counts friendly dispels, enemy purges and pet dispels together).", how: "The median over runs of the count per run.", why: "Dispelling is the part of utility that scales with attention rather than with the kit.", naWhen: "When the class has no dispel or purge at all (rogues, warriors, death knights): n/a, not 0. The whole axis is n/a only when neither a kick nor a dispel applies; healers are always scored.", unit: "dispels per run", scaledByLevel: false },
      },
    },
    throughput: {
      title: "Throughput",
      summary: "Parse % on the selected metric: overall and at the target key level.",
      why: "Output is what the group signed up for; the parse already compares it with everyone else's on the same key and boss set.",
      subSignals: {
        medianParse: { title: "Median parse", what: "The median parse % of the best run per dungeon.", source: "Warcraft Logs rankings (parse % of each run on the selected metric).", how: "Median over the per-dungeon runs that Warcraft Logs has ranked. A 0% parse means an unranked log and is left out.", why: "One number for \"how well do they play their spec\" across the whole season.", naWhen: "When none of the shown runs is ranked yet.", unit: "parse %", scaledByLevel: false },
        parseAtTarget: { title: "Parse at target", what: "Parse % on the runs at or just below the target key level.", source: "Warcraft Logs rankings.", how: "Median parse of the ranked shown runs whose key level is at least the target minus 1.", why: "A strong parse at +12 says little about +20; this one looks at the keys you actually care about.", naWhen: "When no ranked run is at or above target − 1.", unit: "parse %", scaledByLevel: false },
      },
    },
    consistency: {
      title: "Consistency",
      summary: "How much parse, deaths and damage taken vary from run to run. Informational unless the operator gives it an axis weight: see the weights table under The verdict.",
      why: "Variance punishes players who push keys (a depleted +21 next to a timed +20 is not inconsistency), so it is shown, not counted, unless the operator decides otherwise.",
      subSignals: {
        parseSpread: { title: "Parse spread", what: "Standard deviation of parse % across runs.", source: "Warcraft Logs rankings.", how: "Population standard deviation over the ranked enriched runs; needs at least the consistency minimum of runs printed below.", why: "A 20-point swing between runs tells you which parse to expect on a bad night.", naWhen: "Below the consistency minimum of ranked runs.", unit: "± parse %", scaledByLevel: false },
        deathsSpread: { title: "Deaths spread", what: "Standard deviation of deaths per run.", source: "Each run's log.", how: "Population standard deviation of the per-run death count (all deaths, wipes included) over the enriched runs.", why: "Separates \"dies once every run\" from \"dies five times in one run\".", naWhen: "Below the consistency minimum of runs.", unit: "± deaths", scaledByLevel: false },
        damageSpread: { title: "Damage-vs-peers spread", what: "Standard deviation of the per-run damage comparison with peers.", source: "Each run's log: the avoidable-damage comparison when the run has one, otherwise the damage-taken comparison.", how: "Population standard deviation of those per-run % differences, over the runs that have one.", why: "Shows whether damage taken is a habit or a one-off.", naWhen: "Below the consistency minimum of runs with a comparison.", unit: "± % vs peers", scaledByLevel: false },
      },
    },
    preparation: {
      title: "Preparation",
      summary: "Consumables used per run and item level against what the target level expects.",
      why: "Cheap, fully in the player's hands, and a good proxy for how seriously they take a key.",
      subSignals: {
        potions: { title: "Potions", what: "Combat potions used per run.", source: "Each run's summary table (potion uses).", how: "Mean over the enriched runs that report consumables.", why: "A potion per pull-heavy stretch is the difference on a tight timer.", naWhen: "When no enriched run reports consumables.", unit: "potions per run", scaledByLevel: false },
        healthstones: { title: "Healthstones", what: "Healthstones used per run.", source: "Each run's summary table (healthstone uses).", how: "Mean over the enriched runs that report consumables.", why: "Using the healthstone before dying is the cheapest defensive there is.", naWhen: "When no enriched run reports consumables.", unit: "healthstones per run", scaledByLevel: false },
        ilvlVsLevel: { title: "Item level vs target", what: "Item level minus what the season expects at the target key level.", source: "Raider.IO (item level) and this instance's expected-item-level curve for the season.", how: "Item level − expected(target level), in item levels; the expected value is interpolated from the curve printed under Expected item level.", why: "Under-geared for the key is a survival and throughput problem waiting to happen; over-geared is fine.", naWhen: "When Raider.IO has no item level for the character.", unit: "item levels vs expected", scaledByLevel: false },
      },
    },
    experience: {
      title: "Experience",
      summary: "How much of the season the player has done at the level you are asking for, and how recently.",
      why: "A player who has timed every dungeon at your level has already solved the problems you are about to meet.",
      subSignals: {
        coverage: { title: "Dungeon coverage", what: "Share of the season's dungeons the player has a run in.", source: "Warcraft Logs rankings (best run per dungeon).", how: "Dungeons with at least one run / dungeons in the season.", why: "Eight dungeons at +15 beat one at +20 when the group needs all eight.", naWhen: "When the season has no dungeons listed (never in practice).", unit: "share of dungeons (0–1)", scaledByLevel: false },
        atTarget: { title: "Dungeons at target", what: "Share of the season's dungeons with a run at or above the target level.", source: "Warcraft Logs rankings.", how: "Dungeons whose best run is at or above the target / dungeons in the season.", why: "The most direct answer to \"have they done this key\".", naWhen: "Same as coverage.", unit: "share of dungeons (0–1)", scaledByLevel: false },
        medianVsTarget: { title: "Median key vs target", what: "The level the player actually plays at, compared with the target.", source: "Warcraft Logs rankings: the median key level of the best run per dungeon (the number that auto-detects the target, before rounding).", how: "Median best-run level − target level, in key levels.", why: "The median ignores the lone depleted push and tells you where they are comfortable.", naWhen: "When there is no run this season.", unit: "key levels vs target", scaledByLevel: false },
        activity: { title: "Recent activity", what: "Runs completed in the last 7 days.", source: "Raider.IO recent runs.", how: "Count of runs with a completion date within the last 7 days.", why: "Someone who has not played in a month is rusty on the current affixes.", naWhen: "When Raider.IO has no profile for the character.", unit: "runs in the last 7 days", scaledByLevel: false },
      },
      extras: {
        prevSeasonBonus: { title: "Previous season bonus", what: "A small bonus — never a penalty — for a strong previous-season Raider.IO score.", how: "Bonus = min(10, previous season score / 400) axis points, added to the Experience score after the curves and clamped at 100. It appears as its own evidence line.", why: "A returning player with a strong last season deserves the benefit of the doubt while this season's data is thin." },
      },
    },
  },
  notScored: [
    { title: "Timed vs depleted", text: "Shown in the run list with the chest count and clear time, never scored: a depleted key on an otherwise strong run is usually the group's doing, not the player's." },
    { title: "Unranked parses", text: "A 0% parse means Warcraft Logs has not ranked that log (yet). It is shown as \"unranked\" and left out of every parse-based signal instead of counting as a bad parse." },
    { title: "Affixes and routes", text: "Not read at all. Peers are compared inside the same run, so the pull count and affixes cancel out." },
    { title: "Chat, kicks by the group, leaver history", text: "Not in the data bmpl reads." },
  ],
  runSignals: [
    { title: "Timed / depleted", text: "From the fight's keystone data: timed with the chest count and the clear time, or depleted." },
    { title: "Deaths", text: "The player's deaths with what killed them; wipe deaths (3+ group deaths within 15 seconds) are marked as such." },
    { title: "DTPS vs peers", text: "Damage taken per second compared with the DPS players of the run, in %." },
    { title: "Avoidable vs peers", text: "Damage from the season's avoidable list, per minute, compared with everyone else in the run, in %." },
    { title: "Kicks vs peers", text: "Interrupt usage normalized by the spec's kick cooldown, minus the DPS-and-tank median of the run, in percentage points." },
    { title: "Dispels", text: "Dispels, purges, spellsteals and soothes in the run; n/a for classes that have none." },
    { title: "Stale", text: "A run older than 14 days carries a stale badge: the player's current form may differ." },
  ],
  deepdive: {
    summary: "The deep-dive goes one level deeper than the per-run signals: it fetches a run's cast and buff events and measures, per defensive cooldown, usage versus capacity, and for each death whether a defensive was available and unused. It is opt-in (the Analyze buttons) because it is a heavier query.",
    usage: "For each defensive of the spec's table: capacity = how many times it could have come off cooldown in the fight (ceil(fight length / cooldown), at least 1); usage = casts / capacity, capped at 1. Majors and immunities feed the Survival axis; minors are shown only.",
    deaths: "For each death: \"immunity available\" (an immunity was off cooldown), \"defensive available\" (a major was off cooldown and none was active), \"covered\" (a defensive was active when the player died) or \"nothing available\". The first two are the avoidable deaths. Deaths inside a group wipe get a verdict too but are left out of the ratio.",
    table: "Which spells count as defensives per spec is a versioned table shipped with bmpl; corrections made from the panel apply to you immediately and, on a shared instance, to everyone once an admin approves them.",
    cost: "About 3 Warcraft Logs points per run, once; analyses are cached forever and shown to everyone who opens the same run.",
  },
  faq: [
    { q: "Why is Utility n/a for this player?", a: "The spec has neither an interrupt nor a dispel (rogues, warriors and death knights have no dispel; a few specs have no kick). When only one of the two applies, the other sub-signal is skipped and the axis is scored on what remains. Healers are always scored, since their dispels alone are signal." },
    { q: "Why does an axis say n/a while others are scored?", a: "Every sub-signal has a condition under which it cannot be computed (listed as \"n/a when\" on its card). An axis is n/a when none of its sub-signals could be computed, or when its minimum number of runs is not reached (Consistency)." },
    { q: "Why INSUFFICIENT DATA when the character has a high Raider.IO score?", a: "The verdict needs a minimum number of enriched runs (printed under The verdict). A high score with few logged runs, or runs whose logs could not be fetched, is not enough signal." },
    { q: "The score disagrees with the Raider.IO score — which is right?", a: "They measure different things. Raider.IO scores how high the keys were; bmpl scores how the player played inside them. A high Raider.IO score with a low bmpl score usually means a player carried through keys; the reverse means a strong player who has not pushed yet." },
    { q: "Why is a depleted key not held against them?", a: "A depleted key is usually the group's doing. It is shown in the run list as context and never scored." },
    { q: "The numbers changed since yesterday. Why?", a: "Refresh fetched again: new runs replace older best runs per dungeon, Raider.IO scores move, and Warcraft Logs ranks logs after the fact (an unranked parse becomes a real one). On a shared instance you may also have been served another member's lookup made up to 6 hours earlier. The evaluation is recomputed from the current data every time." },
    { q: "Can I check the numbers myself?", a: "Yes: every run links to its Warcraft Logs report. Deaths, damage taken, interrupts and dispels are the report's own tables; the peer comparison is the median of the other players of that run on the same table; the curves and weights are printed on this page." },
    { q: "Why does the same character get a different verdict at a different key level?", a: "The target level changes what is compared: parse at target, dungeons at target, median key vs target and the expected item level all move with it. Death counts are scaled by each run's own level, not by the target, so the scaling itself does not move; only the extra run at the nearest level below the target can change which runs are counted." },
    { q: "How many Warcraft Logs points does a lookup cost?", a: "About 10 for the rankings, plus about 10 per shown run whose log is not cached yet, plus about 3 per deep-dive analysis. Cached runs and analyses cost nothing.", hostedOnly: false },
    { q: "What is the quota in the user menu?", a: "On a shared instance every member has an hourly budget of Warcraft Logs points; cached data never counts. When the budget is reached, lookups that would fetch are refused until the hour resets. Members who add their own Warcraft Logs client in Settings run on their own budget instead.", hostedOnly: true },
    { q: "What does the instance store about me?", a: "See the Privacy page: your Discord id, name and avatar, your lookup history and settings, your hourly usage, your corrections, and — if you added one — your Warcraft Logs client with its secret encrypted.", hostedOnly: true },
  ],
  wclClient: {
    title: "Your own Warcraft Logs client",
    why: "Every lookup that is not already cached spends Warcraft Logs points. On this instance you share a small hourly budget with the other members; with your own client — free, two minutes to create — you get Warcraft Logs' full budget for yourself and never wait for the hour to reset.",
    sharedHint: "shared budget, per member",
    ownHint: "your own client, nobody else on it",
    onWcl: [
      "Sign in at [warcraftlogs.com](https://www.warcraftlogs.com/) — any free account works.",
      "Open [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients) (avatar → Clients) and click Create Client.",
      "Name it anything (say `bmpl`), set Redirect URLs to `http://localhost`, leave Public Client? unchecked, submit.",
      "Copy the Client ID and the Client Secret — the secret is shown once.",
    ],
    inBmpl: [
      "Open [Settings → Warcraft Logs client](/settings#wcl-client), paste both, Save and verify.",
      "Done: the quota line in your menu now shows your own counter, and your lookups no longer touch the shared budget.",
    ],
    safety: "The secret is stored encrypted and only ever sent to Warcraft Logs. If it leaks, delete the client on the same page and create a new one.",
  },
  liveAddon: {
    title: "The in-game addon",
    why: "The Live panel reads a small strip of pixels the bmpl addon draws in-game, through a screen share — there is no server round trip and the addon has no network code of its own. Install it once and every applicant and party member you see in the Group Finder shows up here automatically, with class, role and score. A tank or healer applicant's spec is exact; a DPS applicant's spec is a best-effort guess, since Blizzard's Group Finder does not expose it before you invite them.",
    install: [
      "Download `bmpl-addon.zip` (from the repo's releases, or build it yourself with `just addon-zip`) and unzip it.",
      "Copy the `bmpl` folder into `World of Warcraft/_retail_/Interface/AddOns/`.",
      "`/reload`, and tick bmpl on the AddOns list if it isn't already.",
    ],
    connect: [
      "Click the Live chip in the header, then Pick the window, and share the World of Warcraft window in the browser's own dialog.",
      "Open the Group Finder in-game, or have an active posting — the strip appears top-left and this panel fills in within a couple of seconds.",
    ],
    sends: "The addon sends nothing, receives nothing and stores nothing — it only draws pixels. The browser reads them locally; only the player names it recognizes are sent to bmpl, to check against evaluations it already has.",
  },
};

/** The registry per UI language: GET /api/docs?lang= picks one; the CLI and the tests read the English one directly. */
export const EVALUATION_DOCS_BY_LOCALE: Record<Locale, EvaluationDocs> = { en: EVALUATION_DOCS, fr: EVALUATION_DOCS_FR };
