// The starter Community spaces. Edit here and run `npm run seed:spaces`; matched by slug, so
// running it again renames and reorders but never deletes posts.
export const SPACES = [
  { slug: 'show-and-tell', name: 'Show and tell', description: 'Share what you built, made or figured out this week. Big or tiny, it counts.' },
  { slug: 'help', name: 'Help and questions', description: "Stuck? Ask here. No question is too basic, and everyone's been where you are." },
  { slug: 'ideas', name: 'Ideas and feedback', description: 'Got a wild idea or want honest feedback on something you are making?' },
  { slug: 'hangout', name: 'Hangout', description: 'Chat about anything else: games, music, school, life. Keep it kind.' },
] as const;
