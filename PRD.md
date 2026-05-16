TX Build-in-Public Platform
Project Requirements Document (PRD)
Version: 1.0
Stack: React (Frontend) · Express.js + PostgreSQL (Backend)
Deadline: June 1st, 2026 (Countdown Launch)
1. Overview
TX is a community-driven Build-in-Public platform where developers submit projects, earn
community points, and compete in a 30-day contest decided by public votes. The platform has a
sleek, Telegram-inspired UI with 3D visual elements and a fun, modern aesthetic.
2. Design Language
• Vibe: Telegram-sleek meets Web3 — dark mode first, clean typography, glassy cards, subtle
gradients
• 3D Elements: Three.js or Spline embeds on landing page and dashboard (floating orbs,
rotating badge/trophy models, particle fields)
• Color Palette: Deep navy #0A0E1A , electric blue #2AABEE (Telegram blue), neon
accent #7B61FF , white text
• Font: Inter / Space Grotesk
• Animations: Framer Motion for page transitions, micro-interactions on votes/points
3. Global Components
3.1 Announcement Strip (Sitewide Top Bar)
• Fixed strip above the main nav on every page
• Content: "🚀 TX 30-Day Build-in-Public Contest is LIVE — Post, Tag, Build, Win!"
• Right side: Live Countdown Timer to June 1st, 2026 00:00 WAT
• Strip is dismissible per session (localStorage flag)
• Color: Electric blue gradient with white text
3.2 Navigation (Sidebar — Telegram-style)
• Logo / TX branding top-left
• Nav items with icons:
• 🏠 Home
• 📊 Dashboard
• 📁 Projects
• 🗳 Vote
• 👤 Profile
• ⚙ Settings
• User avatar + username at bottom of sidebar
• Active state with glowing blue pill indicator
4. Pages & Frontend Content
4.1 Landing Page ( / )
Purpose: Convert visitors into registered participants.
Sections:
1. Hero Section
• 3D animated model (rotating trophy or floating rocket — Three.js/Spline)
• Headline: "Build. Post. Win."
• Subheadline: "The 30-day community-voted developer contest. Ship your project, earn
points, claim glory."
• CTA Buttons: [ Get Started ] [ See Projects ]
• Countdown timer (large, styled) to June 1st
2. How It Works Section
• 3 steps in card format:
1. 2. 3. 🔨 Build your project publicly
📣 Post updates & tag TX
🗳 Community votes — highest score wins
3. Leaderboard Preview
• Top 5 contestants by votes/points (live data)
• "View Full Leaderboard →" link
4. Featured Projects Strip
• Horizontally scrollable cards of recent project uploads
5. Footer
• Links: About · Rules · Contact · Twitter/X
4.2 Auth Pages ( /login, /register, /forgot-password )
Register Page:
• Fields: Full Name, Username, Email, Password, Confirm Password
• OAuth: "Continue with Google" / "Continue with GitHub"
• Link to Login
Login Page:
• Fields: Email, Password
• "Forgot password?" link
• OAuth buttons
• Link to Register
Forgot Password:
• Email input → sends reset link
• Confirm reset page with new password fields
4.3 Dashboard ( /dashboard )
Purpose: Personal hub for the user's activity and community standing.
Content:
1. Welcome Banner — "Hey [Username] 👋 You're on Day X of 30"
2. Stats Cards Row:
• 🏅 Community Points (total)
• 🗳 Votes Received
• 📁 Projects Submitted
• 🔥 Current Streak (days posted)
3. Points Activity Feed
• Timeline of points earned: "+10 pts — Someone voted on your project", "+5 pts — You
posted an update today"
• Filterable by: All · Votes · Posts · Bonuses
4. Your Rank
• Position on leaderboard with rank badge (3D glowing badge model)
• Progress bar to next rank tier
5. Quick Actions
• [ + Upload Project ] [ Post Update ] [ View Leaderboard ]
6. Recent Notifications
• Vote received, comment, new follower, contest announcements
4.4 Projects Tab ( /projects )
Purpose: Browse and upload projects in the contest.
Sub-sections:
A. Browse Projects
• Search bar + filters: Category · Most Voted · Newest · Trending
• Project cards grid:
• Project thumbnail/cover image
• Project name + builder username + avatar
• Short description (2 lines)
• Vote count + upvote button
• Tags (e.g. #Web3, #AI, #Mobile)
• "View Project →"
B. Upload Project ( /projects/new )
• Form fields:
• Project Name
• Short Description (max 160 chars)
• Full Description (rich text / markdown)
• Category (dropdown)
• Cover Image upload
• Project URL / Demo Link
• GitHub Repo Link (optional)
• Tags (multi-input)
• TX Post Link (proof of public posting & tag)
• Submit button
C. Single Project Page ( /projects/:id )
• Cover image banner
• Project title, builder info, tags
• Full description
• Links (Demo, GitHub)
• Vote button (one vote per user per project per day)
• Vote count display
• Comments/Reactions section
• "Report Project" link
4.5 Vote Tab ( /vote )
Purpose: Dedicated fun voting experience.
Content:
1. Header: "Cast Your Vote — Support the Builders 🗳"
• Context blurb: "Each vote powers a builder's journey. You get 3 votes per day — use
them wisely."
2. Voting Arena
• Card-swipe style UI (Tinder-esque OR grid)
• Each card shows: project cover, name, builder, description snippet, current vote count
• Action buttons: [ 🗳 Vote ] [ 👀 View Project ] [ ⏭ Skip ]
• Animated vote confirmation (confetti burst or point pulse)
3. Daily Vote Counter
• "You have X / 3 votes left today" — resets at midnight
4. Trending Projects
• Horizontal scroll of top voted projects today
5. Leaderboard Sidebar
• Top 10 projects by total votes
4.6 Profile Page ( /profile/:username )
Purpose: Public-facing builder profile.
Content:
• Avatar (uploadable), Username, Full Name, Bio (max 200 chars)
• Social links: Twitter/X, GitHub, LinkedIn, Website
• Stats: Points · Projects · Votes Received · Rank Badge (3D)
• Projects Grid — all submitted projects
• Activity Feed — public build log (posts, updates)
• Follow / Unfollow button (for other users' profiles)
• Own profile shows [ Edit Profile ] button
4.7 Settings Page ( /settings )
Tabs:
1. 2. 3. 4. 5. Account — Edit name, username, email, bio, avatar, social links
Password & Security — Change password, active sessions list, revoke session
Notifications — Toggle: email notifications, vote alerts, contest updates
Privacy — Toggle: public profile, show points publicly
Danger Zone — Delete account (with confirmation modal)
5. Backend — API Endpoints
Base URL: /api/v1
Auth: JWT Bearer Token (Access Token 15min + Refresh Token 7d)
5.1 Auth Endpoints
POST /auth/register
Request:
json
{
"full_name": "John Doe",
"username": "johndoe",
"email": "john@example.com",
"password": "SecurePass123!"
}
Response 201 :
json
{
"message": "Registration successful",
"user": { "id": "uuid", "username": "johndoe", "email": "john@example.com" },
"access_token": "jwt...",
"refresh_token": "jwt..."
}
POST /auth/login
Request:
json
{ "email": "john@example.com", "password": "SecurePass123!" }
Response 200 :
json
{
"access_token": "jwt...",
"refresh_token": "jwt...",
"user": { "id": "uuid", "username": "johndoe", "avatar_url": "..." }
}
POST /auth/refresh
Request:
json
{ "refresh_token": "jwt..." }
Response 200 :
json
{ "access_token": "jwt..." }
POST /auth/forgot-password
Request: { "email": "john@example.com" }
Response 200 : { "message": "Reset link sent to email" }
POST /auth/reset-password
Request:
json
{ "token": "reset_token_from_email", "new_password": "NewPass123!" }
Response 200 : { "message": "Password updated successfully" }
POST /auth/logout
Headers: Authorization: Bearer <token>
Response 200 : { "message": "Logged out" }
5.2 User Endpoints
GET /users/me
Headers: Auth required
Response 200 :
json
{
"id": "uuid",
"username": "johndoe",
"full_name": "John Doe",
"email": "john@example.com",
"avatar_url": "...",
"bio": "...",
"points": 340,
"rank": 12,
"streak": 5,
"social_links": { "twitter": "...", "github": "..." },
"created_at": "2026-05-01T00:00:00Z"
}
PATCH /users/me
Request (multipart/form-data or JSON):
json
{
"full_name": "John Updated",
"bio": "Builder. Shipper.",
"social_links": { "twitter": "https://x.com/johndoe" }
}
Response 200 : Updated user object
POST /users/me/avatar
Request: multipart/form-data — avatar: <file>
Response 200 : { "avatar_url": "https://cdn.tx.com/avatars/uuid.jpg" }
GET /users/:username
Response 200 : Public profile object (no email, no private fields)
GET /users/:username/projects
Response 200 : Array of user's projects
POST /users/:username/follow
Headers: Auth required
Response 200 : { "message": "Following johndoe" }
DELETE /users/:username/follow
Response 200 : { "message": "Unfollowed johndoe" }
5.3 Project Endpoints
POST /projects
Headers: Auth required
Request (multipart/form-data):
json
{
"name": "DevTrack",
"short_description": "Track your daily builds publicly",
"description": "Full markdown content...",
"category": "Productivity",
"demo_url": "https://devtrack.io",
"github_url": "https://github.com/johndoe/devtrack",
"tx_post_url": "https://x.com/johndoe/status/...",
"tags": ["#Productivity", "#OpenSource"],
"cover_image": "<file>"
}
Response 201 :
json
{
"id": "uuid",
"name": "DevTrack",
"slug": "devtrack",
"builder": { "username": "johndoe", "avatar_url": "..." },
"vote_count": 0,
"created_at": "..."
}
GET /projects
Query Params: ?page=1&limit=12&sort=votes|newest|
trending&category=AI&search=devtrack
Response 200 :
json
{
"projects": [  ],
"total": 80,
"page": 1,
"pages": 7
}
GET /projects/:id
Response 200 : Full project object with builder info, vote count, tags, links
PATCH /projects/:id
Headers: Auth required (owner only)
Request: Any editable fields
Response 200 : Updated project object
DELETE /projects/:id
Headers: Auth required (owner only)
Response 200 : { "message": "Project deleted" }
5.4 Voting Endpoints
POST /projects/:id/vote
Headers: Auth required
Logic: Max 3 votes/user/day across all projects; 1 vote/user/project/day
Response 200 :
json
{
"message": "Vote cast successfully",
"new_vote_count": 47,
"points_awarded": 10,
"votes_remaining_today": 2
}
Response 429 : { "error": "Daily vote limit reached. Resets at midnight." }
DELETE /projects/:id/vote
Headers: Auth required
Response 200 : { "message": "Vote removed", "new_vote_count": 46 }
GET /votes/my-daily-status
Headers: Auth required
Response 200 :
json
{
"votes_used_today": 1,
"votes_remaining": 2,
"resets_at": "2026-05-09T00:00:00Z"
}
5.5 Points / Leaderboard Endpoints
GET /points/me
Headers: Auth required
Response 200 :
json
{
"total_points": 340,
"breakdown": {
"votes_received": 200,
"posts_tagged": 100,
"streak_bonus": 40
},
"activity": [
{ "description": "Vote received on DevTrack", "points": 10, "timestamp": "..." }
]
}
GET /leaderboard
Query: ?limit=10&page=1
Response 200 :
json
{
"leaderboard": [
{ "rank": 1, "username": "janedoe", "avatar_url": "...", "points": 890, "vote_count"
]
}
5.6 Notifications Endpoints
GET /notifications
Headers: Auth required
Response 200 : Array of notification objects { id, type, message, read, created_at }
PATCH /notifications/:id/read
Response 200 : { "message": "Marked as read" }
PATCH /notifications/read-all
Response 200 : { "message": "All notifications marked as read" }
5.7 Settings Endpoints
PATCH /settings/password
Request: { "current_password": "...", "new_password": "..." }
Response 200 : { "message": "Password updated" }
GET /settings/sessions
Response 200 : Array of active sessions { id, device, ip, last_active }
DELETE /settings/sessions/:id
Response 200 : { "message": "Session revoked" }
PATCH /settings/notifications
Request: { "email_notifications": true, "vote_alerts": false, "contest_updates":
true }
Response 200 : Updated notification preferences
DELETE /settings/account
Request: { "password": "confirm_password" }
Response 200 : { "message": "Account scheduled for deletion" }
6. Database — Key Tables (PostgreSQL)
Table Key Columns
users id, username, email, password_hash, avatar_url, bio, points, streak, created_at
projects id, user_id, name, slug, description, cover_url, demo_url, github_url, tx_post_url,
category, tags, vote_count, created_at
votes id, user_id, project_id, voted_at
points_log id, user_id, points, reason, reference_id, created_at
notifications id, user_id, type, message, read, created_at
sessions id, user_id, token_hash, device_info, ip, last_active
follows follower_id, following_id, created_at
settings user_id, email_notifications, vote_alerts, contest_updates, public_profile
7. Points System Logic
Action Points
Someone votes on your project +10 pts
You post an update & tag TX +5 pts
Daily login streak (per day) +3 pts
Streak milestone (7 days) +25 bonus pts
Project featured on homepage +50 pts
8. Non-Functional Requirements
• Auth: JWT (access 15min, refresh 7d), bcrypt password hashing
• File Uploads: Cloudinary or S3 for images
• Rate Limiting: 100 req/min per IP; vote endpoint stricter (5 req/min)
• CORS: Whitelist frontend domain only
• Validation: Zod (backend) + React Hook Form (frontend)
• Error Format: Consistent { error: string, code: string } across all endpoints
• Env vars: All secrets via .env — never hardcoded
9. Milestones
Milestone Target
Auth + DB setup Week 1
Projects CRUD + file upload Week 1–2
Voting system + points logic Week 2
Dashboard + leaderboard Week 2–3
UI polish + 3D elements + animations Week 3
Settings, notifications, profile Week 3
QA, testing, deployment Week 4
🚀 🚀 Launch June 1, 2026