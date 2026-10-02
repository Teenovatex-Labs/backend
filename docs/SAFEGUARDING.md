# Safeguarding: images in team chats

**Moderation contact and reviewer:** Anas Abubakar (admin). Every image is reviewed by a person before the team can see it. There is no automated screening and no third-party image service, so images are never sent anywhere outside our own storage.

## What is allowed
- Images only (JPG, PNG, WebP, up to 5 MB), only in **lab team chats**. Not in private messages, not on posts.
- Sender must have an account at least 7 days old, no suspension, no open report against them, and be under 5 images a day.
- Each file is re-encoded on upload, which removes location and camera data. Files are stored privately and shown only through signed links the API gives to people allowed to see them.

## Review
1. New images appear in **Admin → Images** and the reviewer is notified.
2. **Approve** shows it to the team. **Remove** deletes the file, hides the message, tells the sender, and writes the audit log. Optionally suspend the sender for 7 days.
3. A member report on a message with an image sends it back to the queue and hides it from the team until reviewed again.
4. You cannot review your own image.

## Serious matters (suspected child sexual abuse material, grooming, threats of harm)
- Choose **Remove** and tick **Serious safety matter**. The file is kept privately as evidence instead of being deleted, and the sender can be suspended in the same step.
- Do not forward, download or share the image. Do not confront the sender.
- Report it to the relevant authority and the hosting providers as the law in your country requires. **Counsel must confirm the exact reporting channel and retention period before launch** and this section must be updated with the answer.
- Record the audit log entry id and the date you reported.

## Limits to be honest about
- Review is manual. If nobody reviews, images simply stay hidden from teammates. The queue is the capacity limit.
- Deleting an account deletes its images, except files kept as escalated evidence.
