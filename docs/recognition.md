# Recognition: Teenovator of the Month and badges

**Status: proposal. Owner approval required before the first Teenovator of the Month award.**
This document is the written policy. It does not change the server. Where it says **OWNER DECISION NEEDED**, the sentence under it is a proposal, not a decision.

TeenovateX does not rank people by popularity. Votes, streaks, and points can be evidence. They are never the award by themselves.

Two kinds of recognition exist today:

- **Activity badges** are a fixed list in `src/lib/badges.ts`. The server awards them from real activity. Section 3 has one criteria entry for each.
- **Honour badges** are created by an admin (`badge_definitions`) and awarded by hand. They have a tier: `standard`, `high`, or `top`. The only honour named in this repo is **Teenovator of the Month** (used as an example in tests, at tier `high`). There is no seeded catalogue of other honours, and the frontend badge dialog is not in this repo. This document does not invent badges.

High-rank honours show on a profile only when that profile is public (`docs/SAFEGUARDING-ROLES.md`, section J). Every honour award and revocation is audited.

## 1. Teenovator of the Month

One named honour for a single calendar month. It recognises a member who started something, helped other people, kept going, learned, and had an effect beyond their own score.

**OWNER DECISION NEEDED:** approve the weights below, or replace them. They are the draft this issue started from. They already total 100%.

| Criterion | Weight |
| --- | ---: |
| Initiative and innovation | 25% |
| Contribution to others | 20% |
| Consistency | 20% |
| Real-world impact | 20% |
| Learning and growth | 15% |
| **Total** | **100%** |

Writing code is not required for any criterion. A lab, a lesson, an event, a design, a piece of writing, or a way of helping people can all count.

### How a score is built

**OWNER DECISION NEEDED:** the scale. Proposed scale, so two reviewers can use the same numbers:

Each criterion is scored from 0 to 4.

- **0** — not shown this month.
- **1** — a single thin example.
- **2** — clear evidence a reviewer can point at.
- **3** — strong evidence across the month.
- **4** — exceptional. It would still stand if votes and points were ignored.

Weighted score = sum of `(score / 4) × weight`. The maximum is 100. Example: innovation 3, contribution 2, consistency 4, impact 2, learning 2 → `(0.75×25) + (0.5×20) + (1×20) + (0.5×20) + (0.5×15) = 18.75 + 10 + 20 + 10 + 7.5 = 66.25`.

Reviewers write the score and the evidence for each criterion. A feeling without evidence is a 0.

### Initiative and innovation (25%)

Starting something new, or changing how something is done, so that the result is better or newly possible.

Evidence that counts: a lab or project they opened this month; a lab update that shows a new approach; a workshop, lesson, or event they planned and ran; a design, poster, script, research note, or process other people then used; teaching a method they came up with. Code, a prototype, or a shipped feature counts when it exists. It is one kind of evidence, not the entrance requirement.

Evidence that does not count: liking other people's work, a title with nothing behind it, or an idea that stayed private and unchanged.

### Contribution to others (20%)

Time spent making another member more able to finish or to learn.

Evidence that counts: help on a lab they do not own, after the owner accepted them; comments, reviews, or messages that unblock someone (the other person's progress is the evidence); pairing or tutoring in a class; writing something others used to get unstuck.

Evidence that does not count: vote totals, a busy profile, or being popular in chat. Being on a team only counts when they did work for that team.

### Consistency (20%)

Showing up across the month, not one strong day.

Evidence that counts: a login streak that covers much of the month (a streak freeze can keep a streak; it is not a substitute for the rest of the work); lab updates or lessons spread over different weeks; class attendance across the month; a board of tasks that moved more than once.

Evidence that does not count: a single post, one all-night push, or a streak with no work behind it.

### Learning and growth (15%)

Getting better at a thing they could not do as well at the start of the month, and being able to show the change.

Evidence that counts: lessons or a whole Learn track finished; a lab update or note that says what they tried, what failed, and what they do differently; taking on a harder part of a lab than they held last month; a non-code skill they practised in public (running a session, interviewing a user, explaining a topic).

Evidence that does not count: points, level, or a streak on their own.

### Real-world impact (20%)

Someone outside the member's own score benefited.

Evidence that counts: a person, class, school, or local group that used the work; a problem that got smaller, with the nominee able to say who noticed; an event that happened and had attendees; a teammate who shipped something they could not have shipped alone, when the nominee's part is specific.

Evidence that does not count: votes, leaderboard rank, or a claim of impact with no one who could confirm it. There is no follower count on TeenovateX, and popularity is not this criterion.

### Dialog text

Suitable for the honour's `criteria_text` (the badge detail dialog, 10 to 1200 characters):

> Awarded for one calendar month. Reviewers score initiative and innovation (25%), contribution to others (20%), consistency (20%), real-world impact (20%), and learning and growth (15%). Building something without code counts. Votes and popularity are not the score.

## 2. Governance

### Who nominates

**OWNER DECISION NEEDED.** Proposed rule: any member whose account is active, and any admin, may nominate one other person for that month. The nomination is a short note that points at evidence for the five criteria. Self-nomination is not allowed. Nominations close when the month ends. The owner still has to name who is allowed to nominate before the first award.

### Who decides

**OWNER DECISION NEEDED.** Proposed rule: two admins score the shortlist independently using section 1. They then agree a winner. If they were both nominators, they do not score their own nominee. The owner still has to name the deciding admins.

The server today lets any single admin with `badges.award` award an honour alone, at every tier. This policy is stricter than that for the top tier. Making the server match it is separate work, and it is not part of this document.

**OWNER DECISION NEEDED:** Teenovator of the Month is stored as tier `high` in the test example, not `top`. Confirm the tier. Only `top` requires the second admin below. If this honour should be hard to give, set it to `top`.

### Conflict of interest

- Nobody awards an honour to themselves. The server already rejects this (`SELF_AWARD`).
- Nobody nominates themselves.
- A nominee does not score, approve, or revoke their own award.
- **Top tier:** a second admin must approve the award. The second admin is not the admin who submitted it, and is not the nominee. Both approvals record a written reason. The audit log keeps both.

**OWNER DECISION NEEDED:** the name of the second admin for top-tier awards. Shazily is the second approving admin for tutors (`docs/SAFEGUARDING-ROLES.md`). This document does not reuse that assignment for badges.

### One award per month, and later months

**OWNER DECISION NEEDED.** Proposed rule: at most one Teenovator of the Month per calendar month. A member may win again in a later month. The honour is repeatable across months and not twice in the same month. Which timezone defines the month is part of this decision. The server's `repeatable` flag is a single switch and does not know about months; until that exists, admins follow this rule by hand.

### Who can win

**OWNER DECISION NEEDED.** Proposed rule: an active member (role `member`) who was not suspended during that month. Admins, moderators, mentors, tutors acting as staff, and partners are not eligible, so the award stays a member honour. A suspended member is not eligible. There is no minimum point total.

**OWNER DECISION NEEDED:** what happens when two people tie, and whether a minimum score is required. Proposed rule: if the top two weighted scores are equal, the deciding admins prefer the higher real-world impact score, then the higher contribution score. If those are also equal, there are two winners that month, or no award if both scores are under 50. The owner picks which of those two endings applies.

### Revocation

Grounds, any one of them:

- The award was a mistake (wrong person, wrong month).
- The evidence was false or materially misleading.
- A safeguarding outcome after the award makes displaying it wrong. Follow `docs/SAFEGUARDING.md` for the incident itself. This document only covers the badge.

Who can revoke: an admin with `badges.award`, which is the permission the server already checks. A nominee cannot revoke or restore their own award.

**OWNER DECISION NEEDED:** whether revoking a **top-tier** award also needs the second admin. Proposed rule: yes. The same pair of rules as the award (two different admins, neither is the nominee, written reasons).

Process:

1. The admin writes a reason. The server requires 5 to 400 characters.
2. The award is marked revoked. It leaves the profile and the featured row. The audit log records `badge.revoke` and the reason.
3. Restoring it means a new award, under the same rules as the first one, including a second admin when the tier is `top`.

**OWNER DECISION NEEDED:** whether the person is notified. Proposed rule: yes. They receive a notification that the honour was removed and the reason. The server today does not send that notification; it only updates the award and the audit log.

Activity badges in section 3 have no revoke action on the server. **OWNER DECISION NEEDED:** whether a false activity badge can be removed, and by whom. Until that decision, they stay once earned.

## 3. Badge criteria

Each entry is the text for the badge detail dialog. Activity badges are awarded by `src/lib/badges.ts` and are not voted on. Once earned, they stay if a streak later drops or a lab changes, because the server only adds them.

### Lab Starter (`first_lab`)

You created a lab. One lab is enough. Joining someone else's lab does not earn this.

### Supporter (`first_vote`)

You voted for a lab. One vote is enough. Votes on your own labs are a different badge (Crowd Favourite).

### Conversation Starter (`first_comment`)

You posted in Community, left a comment, or published a lab update. One of those is enough.

### Student (`first_lesson`)

You finished a lesson in Learn. Opening a lesson without finishing it does not count.

### Graduate (`track_done`)

You finished every lesson in a published Learn track that has at least one lesson. An empty track does not count.

### On a Roll (`streak_3`)

Your login streak reached 3 days. The streak uses your own calendar. A streak freeze can bridge one missed day. The badge stays if the streak later resets.

### Week Warrior (`streak_7`)

Your login streak reached 7 days, on the same rules as On a Roll.

### Unstoppable (`streak_30`)

Your login streak reached 30 days, on the same rules as On a Roll.

### Crowd Favourite (`loved_10`)

Labs you created have 10 votes between them. Votes you cast, and votes on labs you only joined, do not count.

### Team Player (`team_player`)

You joined a lab you do not own, and the owner accepted you. Creating your own lab does not earn this.

### Finisher (`milestone`)

A lab you belong to, as owner or teammate, has a milestone marked done. You earn this even when a teammate marked it done, including when you join a lab that already has one.

### Teenovator of the Month

Use the dialog text in section 1. It is an honour badge, awarded by admins under section 2, not an activity badge.

Judged challenges can point at an honour badge created for that challenge. Those badges are not a fixed list here. The admin who creates one writes its own `criteria_text`. No challenge badge is seeded in this repo.

## Sign-off

- [ ] Owner: weights, scale, nominators, deciders, tier, second admin, month timezone, eligibility, ties, revocation notice
- [ ] Date: ________
