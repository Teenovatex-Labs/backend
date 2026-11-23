# Labs API: moderated visibility

Labs are served by `/api/v1/projects`. Existing projects stay visible after the additive `projects.hidden` migration; new projects default to `hidden = false`.

Member-facing lists, category counts, search, profile lab lists, direct lab detail (ID or slug), updates, team tools, votes and lab chats exclude hidden labs. Direct requests for a hidden lab return `404 NOT_FOUND`. Owners cannot edit or delete a hidden lab through the member API. A moderator resolving a lab report with `action: "remove"` sets `hidden = true` and retains the lab and its related data. That action remains audited as `report.remove`.

The staff moderation API in #14 will list hidden labs and provide restore. Until that API lands, there is no member-facing restore operation.
