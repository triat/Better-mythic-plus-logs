# Members' feedback

Status: implemented 2026-11-02. Canvas **https://claude.ai/artifact/H6yVpvg2ES5mQiT7bmeMdj** ("bmpl · Retours"; sources
in `docs/design/feedback/`): `Main.dc.html` the sidebar's foot, variant B chosen 2026-11-02; `Verdict.dc.html` the
verdict question; `Form.dc.html` the form and the invitation.

## Goal

Hear from members without getting in their way: whether a verdict seems right (labels for the evaluation's validity
work, phase 4 "labelled profiles"), and ideas or problems in their own words.

## Decisions

1. **The sidebar does not grow (variant B).** The row "Discord · Support" under the version line is gone; the account
   menu holds "Give feedback", then the Discord and Support links (↗). Local mode has no feedback (no account).
2. **The verdict question** sits at the foot of the Synthèse verdict card, one grey line and two small buttons. "Yes"
   saves in one click; "No" opens, in place, an optional reason (too generous, too harsh, runs are missing, other) and
   an optional word. One answer per member, character and key level (`target` = `region|realm|name|level`), replaced by
   a later one; once answered, the line shows the answer and "Edit", never the question again. Not shown without a
   verdict (`insufficient`).
3. **The form** is the What's new panel's frame: the kind (idea, problem, something else), the message (1 to 1000
   characters), "You can answer me on Discord" (ticked by default). The admins see the member's Discord name only when
   it is ticked.
4. **The invitation, never spam**: a small card at the bottom right after the 5th successful lookup in this browser
   (`localStorage` `bmpl.feedbackPrompt`); "Later" waits 14 days and 10 more lookups; at most twice in all; the cross,
   or any message sent from anywhere (`GET /api/feedback`'s `sentGeneral`), stops it for good. It never covers the page.
5. **Storage**: table `feedback` (`src/hosted/feedback.ts`), deleted with the member (`ON DELETE CASCADE`); writes
   share the usage rate limit (30 a minute). Admin page section "Feedback" (`GET /api/admin/feedback`, the newest 200,
   unread marked; `POST /api/admin/feedback/:id/read`), its unread count in the admin nav.
6. **Counted**: usage events `feedback_verdict`, `feedback_sent` (server), `feedback_open`, `feedback_prompt_later`,
   `feedback_prompt_dismiss` (page); Umami events `feedback_open` (`place`), `feedback_sent` (`kind`),
   `feedback_verdict` (`rating`), `feedback_prompt` (`action`). Never the message.
7. **Privacy page**: one line on what is stored and who reads it. Changelog: one line.

## Routes

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/api/feedback` | user | `{ kind, message, replyOk, page? }` |
| GET | `/api/feedback` | user | `sentGeneral`, and with `region, realm, name, level` the member's answer for that verdict |
| PUT | `/api/feedback/verdict` | user | `{ region, realm, name, level, rating, reason?, message?, label, verdict?, score? }` |
| GET | `/api/admin/feedback` | admin | `{ rows, unread }` |
| POST | `/api/admin/feedback/:id/read` | admin | `{ unread }` |

## Tests

`test/server-feedback.test.ts` (validation, one answer per target, the admin list's names, deletion with the account),
`web/src/lib/feedback.test.ts` (`verdictSubject`, the invitation's rules, `parsePrompt`, `feedbackLine`).
