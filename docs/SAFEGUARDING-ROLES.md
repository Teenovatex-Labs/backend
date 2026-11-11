# Safeguarding: roles, admissions, pairing and badges

**Status: owner signed off 2026-11-09. Counsel items and the deputy lead are still open (see "Sign-off" at the end).**
Owner and safeguarding lead: Anas Abubakar. This document extends `docs/SAFEGUARDING.md` (images in team chats). Where the two disagree, the stricter rule wins.

TeenovateX members are teenagers (13+). Every rule below is enforced on the server. The user interface may hide things, but it is never the control.

## 0. Decisions already made (from the owner)
- Applications run in monthly windows. Decisions are released together on the announced date.
- Declined applications are kept for 6 months; a reapplication resets the clock; if the person stays declined, the data is then deleted.
- Applicants under 13 are turned away at the date-of-birth step and nothing is stored. They are told to apply when they are old enough.
- Guardian confirmation (ages 13 to 15, threshold is a setting) is requested after acceptance and must be complete before activation.
- Application answers are sent to third-party AI providers (Gemini, Groq) as typed, on their free tiers, with counsel to review. See section K.
- Application data is deleted if a guardian confirmation that is required is not completed in time, or if the application is declined and the retention period ends.
- Payments go through HCB only. No payments in our system.

## A. Partners (adult outside organisations)
- A partner sees **aggregate counts only**. Any number based on fewer than N members (N is a setting, default 10) is hidden / suppressed.
- A partner sees showcase items only where the member explicitly opted in. Never member names, ages, locations, or chats.
- Every partner view is logged with who, what and when. Sessions expire after 30 minutes of inactivity.
- A partner can never message a member.

## B. Tutors (adults teaching a class)
- A tutor can message only students enrolled in their own class, only inside the class chat. Moderators can review class chats. **No private messages from tutors to students.**
- A tutor sees enrolled students' display names, attendance and progress for their own classes. Not birth dates, locations, email, phone or other classes.
- A tutor never sees other members, applications, or reports.
- **Class link (owner decision 2026-11-09):** each class has a meeting link that the host (tutor) adds. Links are allowed in class chats. A second person may join a class session. **Required (owner decision 2026-11-09):** when a tutor aged 18 or over teaches any student under 18, a second person (another vetted tutor, a moderator or an admin) must be in the session. Teenagers teaching teenagers do not need one.
- **Tutor age (owner decision 2026-11-09):** a tutor can be any age, as long as they are an accepted member (13+). A tutor under the guardian threshold needs guardian confirmation like any member. Age does not change the rules above: class chat only, no private messages to students.

## C. Vetting and approval of tutors and partners
1. The candidate is invited by an admin (single-use, expiring invitation tied to their email).
2. An admin records the checks done (identity, references, and any background check the owner requires) in the audit log.
3. A second admin approves (owner accepted two-admin approval, 2026-11-09; the owner names the second admin). The role is applied only when the invitation is accepted with the verified email.
4. An admin can suspend or revoke at any time. Every step is audited.

Checks required for every tutor and partner contact, whatever their age or country (owner decision 2026-11-09):
- A photo ID, checked by an admin, which also confirms age.
- Two references, at least one from an adult who knows them.
- Acceptance of the code of conduct.
- A probation period: a moderator or admin joins the tutor's first class.
- A police clearance or equivalent is **optional** and only for tutors aged 18 or over, where one is obtainable in their country. It is never a reason to turn away someone who cannot get one.
- The second approving admin is Shazily (named by the owner). The owner assigns the admin role to her account.

**COUNSEL CONFIRMATION NEEDED:** counsel to review whether this vetting is legally sufficient for adult tutors of minors across all operating regions.

## D. Retention and deletion
- Account deletion deletes the member's content, except files kept as escalated evidence (see `SAFEGUARDING.md`).
- Reports and audit entries are kept for 2 years (setting), then reduced to an event record without free text.
- **COUNSEL CONFIRMATION NEEDED:** counsel to confirm the retention periods for reports, audit entries, and escalated evidence.

## E. Incidents
- Serious safety matters (abuse, grooming, threats of harm, self-harm): follow `SAFEGUARDING.md`. Only the **designated safeguarding personnel** are notified, never every reviewer or moderator.
- A named deputy covers when the lead is unavailable. Deputy safeguarding lead (owner decision 2026-11-09): Shazily, who is also the second approving admin.
- Reporting channel (owner decision 2026-11-09): serious matters are reported through `support@teenovatex.org`.
- Reporting to authorities follows the law in the relevant country.
- **COUNSEL CONFIRMATION NEEDED:** counsel must confirm the statutory reporting channel and the evidence retention period before launch.
- Record the audit entry id and the date reported.

## F. Applicants
- An application stores: name, email, date of birth, country and city, WhatsApp number, school and education level, interests and skills, the answers and the questions Alfred asked, optional links and files, and reviewer scores and notes.
- Only authorised admissions admins can read applications. Every view is logged. Reviewer notes and safeguarding notes are never copied to a public profile.
- Retention: declined data is kept 6 months and only while the person stays declined; a reapplication resets the clock. Afterwards keep only a hash of the email and the decision date.
- Unfinished drafts are kept until the window they belong to has closed plus 30 days, then deleted.
- **OWNER DECISION NEEDED:** owner to confirm the draft application deletion timeline (window close + 30 days).
- Withdrawal and deletion: an applicant can withdraw in the tracker and ask for deletion. Deletion removes our copy. We cannot remove copies already processed by AI providers (see K); the privacy notice says so.
- Applicants under 13 are never stored. The date-of-birth question comes first.

## G. Parent or guardian confirmation (ages 13 to 15)
- Requested by emailed link after acceptance. The guardian email must differ from the applicant's.
- Stored upon confirmation: timestamp (`confirmed_at`), consent text version (`text_version`), hashed IP (`ip_hash`).
- Withdrawal: the guardian can withdraw confirmation at any time using the link in the email we sent them. Withdrawal revokes unconsumed invitations and pauses existing accounts (sets membership status to `inactive` with an audit event `guardian.withdraw`).
- Activation is blocked until confirmation is complete. If confirmation is not completed before the onboarding window closes, application data is deleted.
- The age threshold is a configurable setting (`config.guardianAgeBelow`, default 16), not hard-coded.
- Consent text (version `v1`):
  1. "TeenovateX is a community where young people learn and build projects together. Members are 13 and over."
  2. "By confirming, you agree that your child may create a TeenovateX account and take part in the community."
  3. "We collect only what the programme needs. Application answers are read by our team and, to help the team, by an AI assistant."
  4. "You can withdraw this confirmation at any time using the link in the email we sent you."
- **COUNSEL CONFIRMATION NEEDED:** guardian age threshold per country (some countries treat everyone under 18 as a child for data consent), whether applicants may be processed (including by AI) before consent, and review of final consent text.

## H. Pairing
- Pairs are curated by admins only. Default: same age band (13 to 15, 16 to 17, 18+).
- A minor and an adult are paired only as an exception: two different admins approve with a written reason, the adult is vetted (section C), the thread is supervised (a designated admin can read it from the start), time-boxed, and audited.

## I. Signup status lookup
- **Accepted risk:** An instant status lookup endpoint introduces the risk that a third party could probe an arbitrary email address to discover whether that person applied to TeenovateX, and whether they were accepted or declined.
- **Required mitigations:**
  1. *Strict rate limits:* aggressive per-IP and per-email rate limiting to prevent enumeration.
  2. *Bot challenge:* bot protection (CAPTCHA / challenge) required on public lookup forms.
  3. *Status only:* no applicant names, answers, dates of birth, or reviewer notes are ever revealed by lookup.
  4. *Logging:* every lookup request is logged with IP, hashed email, and timestamp to monitor for scraping attempts.
  5. *Neutral decline wording:* status messages use supportive, neutral phrasing without evaluative or embarrassing details.
  6. *Inbox delivery:* the public HTTP endpoint returns only a generic neutral message (`If that email can apply, we have sent a link to it. Check your inbox.`); actionable links and sensitive application state are delivered solely to the verified inbox.

## J. Badges and profiles
- High-rank badges show only if the member's profile is public.
- Criteria are published (`docs/recognition.md`). Every award and revocation is audited.

## K. AI processing of applications
- Alfred's questions are generated by Gemini or Groq (free tiers). The applicant's answers are sent to them as typed.
- Our database copy can be deleted. Copies held by the provider cannot be deleted by us. The privacy notice must say this in plain words, and applicants must see it before answering.
- AI never makes or recommends a decision on its own. Reviewers score independently. AI-detection scores are never used as evidence.
- Alfred never improvises when a person discloses harm. A scripted reply is shown, with resources, and the designated safeguarding personnel are alerted.
- A server switch turns AI off. With it off, a fixed question bank covers the same six criteria.
- **COUNSEL CONFIRMATION NEEDED:** counsel confirms whether sending minors' typed answers to third-party AI provider free tiers complies with child data protection laws.
- **OWNER DECISION NEEDED:** owner checks and confirms third-party AI provider terms of service regarding children's data.

## Open risks and decisions needed
| Item | Type | Section | Description | Owner | Target Date | Status |
|---|---|---|---|---|---|---|
| Tutor vetting sufficiency | COUNSEL CONFIRMATION NEEDED | C | Confirm whether ID, references, conduct, and probation are sufficient for adult tutors of minors | Anas Abubakar | ________ | Open |
| Data retention periods | COUNSEL CONFIRMATION NEEDED | D | Confirm 2-year retention for reports/audit logs and escalated evidence rules | Anas Abubakar | ________ | Open |
| Statutory incident reporting | COUNSEL CONFIRMATION NEEDED | E | Confirm statutory reporting channels and legal obligations per country | Anas Abubakar | ________ | Open |
| Draft application deletion | OWNER DECISION NEEDED | F | Confirm draft application deletion after window close + 30 days | Anas Abubakar | ________ | Open |
| Guardian age threshold & consent timing | COUNSEL CONFIRMATION NEEDED | G | Confirm age threshold per country (e.g. 16 vs 18) and pre-consent AI processing legality | Anas Abubakar | ________ | Open |
| Guardian consent wording | COUNSEL CONFIRMATION NEEDED | G | Approve final legal wording for guardian consent text | Anas Abubakar | ________ | Open |
| AI provider terms for child data | OWNER DECISION NEEDED | K | Confirm Gemini/Groq free tier terms regarding child data handling | Anas Abubakar | ________ | Open |
| AI processing child privacy compliance | COUNSEL CONFIRMATION NEEDED | K | Confirm GDPR-K / COPPA compliance for free-tier AI processing | Anas Abubakar | ________ | Open |

## Sign-off
- [x] Owner (Anas Abubakar): signed in the project thread  date: 2026-11-09
- [x] Named deputy safeguarding lead (section E): Shazily, 2026-11-09
- [ ] Counsel: reporting channel and retention (section D, E): ________  date: ________
- [ ] Counsel: guardian age threshold per country, consent wording, and AI processing before consent (section G, K): ________  date: ________
- [ ] Counsel: tutor vetting sufficiency for adult-to-minor classes (section C): ________  date: ________
