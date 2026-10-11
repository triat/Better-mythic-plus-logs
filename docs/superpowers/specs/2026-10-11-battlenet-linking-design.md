# Battle.net linking: import My characters from the account — design

Status: approved 2026-10-11 (cap 20 confirmed: "Validé, 20 c'est bien"); the operator added the Blizzard client to
the production `.env` the same day. Implemented 2026-10-11 (plan
`docs/superpowers/plans/2026-10-11-battlenet-linking.md`), live check pending the release. Parent spec:
`docs/superpowers/specs/2026-10-09-self-review-pillars-design.md`, decision 1 ("Linking a Battle.net account
(`wow.profile` scope, `GET /profile/user/wow`) imports the account's characters as `source: "bnet"` and is its own
step with its own spec"). The user's answers of 2026-10-11 are decisions 2, 6 and 7.

## Goal

A hosted member links their Battle.net account once and picks their characters from the account's own list
instead of typing `Name-Realm`. A character on that list is one the member really plays: the owner's view, the
season sync and the crowd-control fetch (phase 2, decision 4) then rest on proof rather than on a claim.

## Non-goals

- No sign-in with Battle.net. Discord stays the hosted sign-in; Battle.net is linked to an account that exists.
- No Battle.net in local mode. Blizzard requires an HTTPS redirect ("This must be a valid HTTPS (SSL-enabled)
  URL", Using OAuth guide) and one registered client per installation; local mode keeps the manual list.
- No stored Blizzard token, no background import. A user token lasts 24 hours ("Access tokens last for 24
  hours") and the docs offer no refresh token, so each import is one visit to Battle.net.
- No WCL points spent on import. Importing writes the list; a lookup or a sync stays the member's own act.
- No China region (separate OAuth host, `oauth.battlenet.com.cn`; bmpl has no `cn` region).
- No guild, collection or achievement data. Only `wow.profile` is requested.

## Sources (fetched 2026-10-11)

Blizzard developer portal, now `community.developer.battle.net` (read through its page JSON,
`/api/pages/content/<path>.json`):

| Fact | Source | Quote |
|---|---|---|
| Authorize / token | `/documentation/guides/using-oauth` | `https://oauth.battle.net/authorize`, `/token` for "US, EU, APAC" |
| Scope | same | `wow.profile`: "Access to a user's World of Warcraft characters" |
| Token lifetime | same | "Access tokens last for 24 hours" |
| Token request | `/documentation/guides/using-oauth/authorization-code-flow` | "using the developer's client ID and secret with HTTP basic authorization" |
| Granted scopes may shrink | same | "users can fine-tune which ones they authorize … the returned list may contain fewer scopes" |
| Redirect must match | `/documentation/battle-net/oauth-apis` | "must match one of the URLs specified for the application … or the request will return an error" |
| Character list | `/documentation/world-of-warcraft/profile-apis` | `GET /profile/user/wow` "requires an access token with the wow.profile scope acquired via the Authorization Code Flow" |
| One region per call | `/documentation/guides/regionality-and-apis` | "a user that has both US and EU WoW accounts has different characters … in each region" |
| Link by account id | same | developers "should use an accountId to link a user" |
| Character status | profile-apis, "Character Profile Status", `/profile/wow/character/{realmSlug}/{characterName}/status` | "A client should delete information about a character … if … an HTTP 404 Not Found error is returned … the is_valid value is false … the returned character ID doesn't match the previously recorded value"; "If the character is valid and the character IDs match, the client retains the data for another 30 days." |
| 30-day TTL | Blizzard Developer API Terms of Use (updated 2019-10-01) | "You must implement a maximum 30-day TTL (time-to-live) policy for all Data" |
| Unlink | same | on request "that their account be de-linked … delete all copies of the individual's Data" |
| Use limits | same | not "For Marketing Or Monetization Purposes"; a privacy policy must be posted |
| Rate limit | `/documentation/guides/getting-started` | "36,000 requests per hour at a rate of 100 requests per second" |
| Empty list | forum `/t/12653` (2020) | a 404 on `/profile/user/wow` was fixed by the account's "Game Data And Profile Privacy" option (account.blizzard.com/privacy) |

Unconfirmed, to check on the first live link (section "Live check"): the exact `https://oauth.battle.net/userinfo` keys (`id`,
`battletag` expected), whether characters under level 10 are listed, whether Blizzard's `realm.slug` always
equals the WCL realm slug bmpl stores (`realmToSlug`), whether `http://localhost` is accepted as a redirect.

## Decisions

1. **Hosted only, one Blizzard client per instance.** Two new required variables in hosted mode,
   `BMPL_BNET_CLIENT_ID` and `BMPL_BNET_CLIENT_SECRET` (`validateHostedEnv`, `.env.hosted.example`,
   `describeConfig` shows only whether the secret is set). The client's redirect URI is
   `${BMPL_BASE_URL}/auth/bnet/callback`. Required rather than optional because decision 7 removes the manual
   list: without a client a hosted member could not have characters at all.

2. **The member picks from the whole account; the cap rises to 20.** (User, 2026-10-11: "1 et 3".) After
   Battle.net, `/me` lists every character of the account, all four regions, highest level first, then by name;
   the member ticks the ones to keep and marks the main (first of the list, as today). `MAX_CHARACTERS` goes from
   5 to **20**, in both modes, a bound for the page and the settings row rather than a product limit (confirmed
   2026-10-11).

3. **One import = one Battle.net visit, nothing kept but the picks.** `GET /auth/bnet/start` (signed-in member; a
   GET, so protected like Discord's by the session cookie, the `state` and a nonce cookie rather than the origin
   check, which runs only for non-GET requests) issues a `state` bound to a nonce cookie (its own `OAuthStates`). The callback consumes it,
   exchanges the code (HTTP Basic), reads `https://oauth.battle.net/userinfo` (account id, BattleTag), then
   `GET https://{region}.api.blizzard.com/profile/user/wow?namespace=profile-{region}&locale=en_US` for `eu`, `us`,
   `kr`, `tw` in turn (a 404 in a region means no account there, or the privacy option off). The token is then
   dropped. The candidate list goes to `bnet_imports` (one row per user, overwritten by a new import, deleted on
   pick or after **1 hour**), and the browser lands on `/me?bnet=pick`.

4. **A pick must come from the import.** `PUT /api/bnet/characters` takes the chosen candidates (by Blizzard
   character id) in order; the server keeps only ids present in the member's `bnet_imports` row, writes
   `user_settings.characters` as `{ name, realm, region, source: "bnet", bnetId, verifiedAt }` and deletes the
   row. `PUT /api/settings` in hosted mode accepts a `characters` value only if it is a reordering or a subset of
   the stored list (remove, make main); it can no longer add one. Local mode is unchanged (manual entries, now
   up to 20).

5. **One Battle.net account per member.** `user_bnet (user_id PK, account_id UNIQUE, battletag, linked_at)`.
   A callback whose account id is already linked to another member is refused (`bnet_taken`) and nothing is
   imported, so two members cannot both own the same characters. A new import by the same member replaces the
   candidate list; the BattleTag is refreshed. Linking a *different* account first unlinks the old one (its
   import and its `bnet` characters go, decision 8), so the old account's characters are free for whoever links
   it next and never owned twice; a race on the same account between two members ends in `taken` (review,
   2026-10-11). The `state` is bound to the member who started the link: a callback in a browser where another
   member has signed in since is refused (`state`).

6. **The 30-day rule, checked by the server.** (User, 2026-10-11: "Vérif. serveur".) Every 6 hours the hosted
   process takes the `bnet` characters whose `verifiedAt` is older than **25 days**, gets an application token
   (client credentials, kept in memory until it expires) and calls the character status endpoint. 200 with
   `is_valid: true` and the same id: `verifiedAt` = now. 404, `is_valid: false` or another id: the character
   leaves the list (audit `bnet_character_removed` with the reason only: no name, no BattleTag in the audit log, so
   an unlink leaves nothing from Blizzard behind). Network error, 429 or 5xx: kept, retried at the next round.
   A character whose `verifiedAt` passes **30 days** without a successful check leaves the list anyway (the ToU's
   maximum), with the same audit row. The member sees the removal on `/me` ("no longer on your Battle.net
   account, or not checked for 30 days: link again to bring it back"). The rule is applied by the rounds: with
   the 25-day window an entry is checked several times before 30 days, and one that reaches 30 days only through
   failed checks leaves at the next round, at most 6 hours later (plus any downtime of the server).

7. **Manual entries are removed at launch.** (User, 2026-10-11: "Supprimés au lancement".) A one-time
   migration deletes every `source: "manual"` entry from `user_settings.characters` on the first hosted start
   of the release; an audit row per member touched (`characters_reset`). Until a member links, their `/me`
   shows the link card only and every result opens the vetting view. The "This is me" chip disappears in hosted
   mode for a character not on the list (it stays as the remove toggle for one that is); local mode keeps it.

8. **Unlink.** `DELETE /api/bnet` removes `user_bnet`, any `bnet_imports` row and every `bnet` character of the
   list (audit `bnet_unlink`). `DELETE /api/me` (account deletion) does the same. The ToU's de-link rule is met
   by this alone: bmpl stores nothing else from Blizzard. The season store (`character_runs`) and the WCL caches
   are WCL data, kept as today.

9. **Privacy and docs.** `/privacy` gains a Battle.net paragraph: what is read (account id, BattleTag, character
   names, realms, levels, classes, Blizzard ids), what is kept (the picks, the BattleTag, the account id), for
   how long (re-checked every 30 days, deleted on unlink or account deletion), and that nothing is used for
   marketing. `docs/hosted.md` and `docs/operator.md`: creating the Blizzard client (developer portal, two-factor
   authentication required, redirect URI), the two variables.

10. **Design first.** The `/me` link card, the picker (list, ticks, main, the count against 20), the linked
    state (BattleTag, "Import again", "Unlink"), the removal notice, the errors of section "Error handling" and the
    `/privacy` paragraph go through the Claude Design canvas as a new page "bnet", 2–3 variants for the picker,
    before any front code. Chosen 2026-10-11 ("A et 1", canvas version 25): picker **A** (`BnetPickA`, one list
    with ticks, highest level first, "make main" on a ticked row, the main is the first ticked) and result chip
    **1** (no chip in hosted mode for a character not on the list; the chip stays as the remove toggle for one that
    is). The details board `BnetDetails` holds the other screens.

## Data flow

```
/me "Link Battle.net" ─► GET /auth/bnet/start ─► oauth.battle.net/authorize (scope wow.profile, state)
                                                     │ member approves
GET /auth/bnet/callback?code&state ◄─────────────────┘
  consume state ─► POST /token (Basic) ─► GET /userinfo ─► user_bnet (account id unique)
  ─► GET {eu,us,kr,tw}.api.blizzard.com/profile/user/wow ─► bnet_imports (1 h) ─► 302 /me?bnet=pick
/me picker ─► GET /api/bnet ─► member ticks ≤ 20, orders ─► PUT /api/bnet/characters
  ─► user_settings.characters (source bnet, bnetId, verifiedAt) ─► bnet_imports deleted
every 6 h ─► bnet characters verifiedAt > 25 d ─► client-credentials token ─► /status ─► keep / remove
```

Blizzard calls cost no WCL points; an import is at most 1 token + 1 userinfo + 4 list calls, a check round one
status call per due character, far under "36,000 requests per hour".

## Error handling

| Case | What the member sees | Stored |
|---|---|---|
| Member denies on Battle.net (`error=access_denied`) | `/me`: "Battle.net linking cancelled." | nothing |
| `wow.profile` not granted | "Battle.net did not share your characters: allow World of Warcraft profile access and link again." | nothing |
| State missing, expired or from another browser | "This Battle.net link expired: start again from My characters." | nothing |
| Account linked to another member | "This Battle.net account is linked to another bmpl account." | nothing |
| No character in any region | "Battle.net returned no characters. Check that third-party access is allowed in your Blizzard privacy settings (account.blizzard.com/privacy), then link again." | the link, no candidates |
| Blizzard down or 5xx/429 during import | "Battle.net did not answer: try again in a moment." | nothing |
| Import older than 1 hour at pick time | "This import expired: link again." | row deleted |
| Pick contains an id not in the import | 400 `bnet_unknown_character`, nothing written | nothing |
| Status check fails (network) | nothing until 30 days, then the removal notice | `verifiedAt` unchanged |

All errors are logged to the error ring without the code, the token or the client secret; the audit rows carry
the member and the action, never a Blizzard token.

## Tests

Every Blizzard call goes through an injected `fetchFn` (as `src/hosted/discord.ts`), so no test touches the
network. Fixtures: one `/profile/user/wow` answer per region shape (characters in two regions, an empty region,
a 404), trimmed and anonymised; one status answer per outcome (valid, invalid, other id, 404).

- OAuth: authorize URL params; state consumed once; code exchange with Basic auth; scope check.
- Import: four regions merged, sorted (level, then name), duplicates by id removed; `bnet_imports` overwritten and
  expired after 1 hour; account id already linked to another member refused.
- Pick: only imported ids kept, order kept, cap 20, row deleted; `PUT /api/settings` hosted refuses an addition,
  accepts a removal or a reorder; local mode accepts manual entries up to 20.
- Check: the four status outcomes; 25-day due window; 30-day forced removal; network error keeps the character.
- Migration: manual entries removed once, `bnet` ones kept, audit rows written, second start a no-op.
- Unlink and account deletion: link, candidates and `bnet` characters gone.
- Config: hosted refuses to start without the two variables; `describeConfig` never shows the secret.
- Front view models: picker rows, count, main, errors from the `?bnet=` query, removal notice; English and French.

## Live check (after implementation)

On bmpl.riat.dev with the operator's own account: link, compare the imported list with the armory (all regions),
pick three, check that the owner's view and the season sync open for them and that a manual `Name-Realm` can no
longer be added; read `/userinfo`'s real keys and one realm slug with a space or an apostrophe against WCL; unlink
and check that the list empties. Costs no WCL points unless a sync is started.

## Out of scope

- Battle.net as the hosted sign-in (would replace Discord's identity; a separate decision).
- Importing a guild roster or alts' WCL history automatically.
- China region.
- Keeping a token to re-import without a visit (would need refresh tokens, which the docs do not offer).

