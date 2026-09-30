// Starter Learn content. Edit here and re-run `npm run seed:learn`: lessons are matched by
// slug, so existing tracks are updated in place and members' progress is kept.
export type LessonSeed = { slug: string; title: string; summary: string; minutes: number; body: string };
export type TrackSeed = { slug: string; title: string; description: string; lessons: LessonSeed[] };

export const TRACKS: TrackSeed[] = [
  {
    slug: 'your-first-website',
    title: 'Your first website',
    description: 'Go from a blank file to a page that is live on the internet, in four short lessons.',
    lessons: [
      {
        slug: 'what-a-website-is',
        title: 'What a website really is',
        summary: 'Files, a browser, and a server. That is the whole trick.',
        minutes: 4,
        body: `A website is just a folder of files that a computer somewhere is happy to hand to anyone who asks.

## The three pieces

- **Your files.** Mostly HTML (the content), CSS (the looks) and sometimes JavaScript (the behaviour).
- **A server.** A computer that is always on and keeps your files.
- **A browser.** The app you use to ask for a page and show it.

When you type an address, your browser asks a server for the files, then draws them on your screen.

## Try it

Open any website, right-click, and choose "View page source". That wall of text is the actual file your browser downloaded. Nothing is hidden. Everything you love on the internet started as text like this.

Next lesson, you will write some.`,
      },
      {
        slug: 'write-some-html',
        title: 'Write your first HTML',
        summary: 'Headings, paragraphs, links and images.',
        minutes: 6,
        body: `HTML describes what is on the page. You wrap things in tags, and tags come in pairs.

## The tags you need first

- **h1** is the big title of the page.
- **p** is a paragraph.
- **a** is a link. It needs an href, which is where it goes.
- **img** is a picture. It needs a src, which is where the picture lives.

## Make a page

Create a file called index.html and put this in it:

    <h1>Hi, I am Sam</h1>
    <p>I make things with code.</p>
    <a href="https://teenovatex.org">My favourite community</a>

Double-click the file. Your browser opens it. You just made a website.

## Your turn

Change the heading to your name. Add a second paragraph about something you love. Refresh the page after every change and watch it update.`,
      },
      {
        slug: 'make-it-look-good',
        title: 'Make it look like you',
        summary: 'CSS: colours, fonts and space.',
        minutes: 7,
        body: `CSS is how you say what things should look like. You pick something, then list the changes.

## A first taste

    h1 {
      color: #8d355b;
      font-size: 48px;
    }

    body {
      background: #fff9eb;
      font-family: sans-serif;
      max-width: 600px;
      margin: 40px auto;
    }

## Three habits that make any page better

- **Give it room.** A max-width and some margin make text far easier to read.
- **Pick two colours, not ten.** One background, one accent.
- **Use one font.** Two at most.

## Where does CSS go?

Put it in a file called style.css and link it from the top of your HTML with a link tag. Keeping looks and content in separate files means you can redesign without touching your words.

## Your turn

Change the colours to ones that feel like you, then look at your page on your phone. Does it still read well?`,
      },
      {
        slug: 'put-it-online',
        title: 'Put it on the internet',
        summary: 'Publish for free so anyone can visit.',
        minutes: 6,
        body: `Right now your site only exists on your computer. Publishing puts the folder on a server so anyone can visit.

## Free ways to publish

- **GitHub Pages.** Put your folder in a GitHub repository, switch on Pages in the settings, and you get an address.
- **Netlify or Vercel.** Drag your folder in, and you get an address in seconds.

All three are free for personal projects.

## Before you share it

- Does the page have a title? Add a title tag inside a head tag so the browser tab says something nice.
- Does it look fine on a phone?
- Is there anything private in it, like an email or a real address? Take it out.

## Then tell people

Start a lab on TeenovateX, paste your address in as the demo link, and let the community vote. Your first project is officially real.`,
      },
    ],
  },
  {
    slug: 'idea-to-launch',
    title: 'From idea to launch',
    description: 'How to pick something worth building, shrink it, finish it and show people.',
    lessons: [
      {
        slug: 'pick-a-problem',
        title: 'Start with a real problem',
        summary: 'Good projects begin with someone who needs help.',
        minutes: 5,
        body: `The best ideas are rarely lightning bolts. They are small annoyances you noticed and could not ignore.

## Where to find one

- **Your own day.** What is slow, boring or confusing at school or at home?
- **Your friends.** What do they complain about? Write it down.
- **Things you wish existed.** Even if it seems small.

## A quick test

Finish this sentence: "___ struggles with ___ because ___."

If you can name a real person, you have a problem. If you can only say "everyone", keep looking.

## Your turn

Write down five annoyances from this week. Circle the one you would enjoy fixing most. That is your project.`,
      },
      {
        slug: 'shrink-it',
        title: 'Shrink it until it is finishable',
        summary: 'Cut your idea down to a version you can build this week.',
        minutes: 5,
        body: `Most projects die because they were too big, not because they were bad.

## The one-week rule

Ask: what is the smallest version I could finish in a week? Then cut it in half.

## How to cut

- **One user.** Build for a single kind of person.
- **One job.** Do one thing well. Everything else is version two.
- **No accounts, no settings.** You almost never need them at the start.

## Write it down

Make a short list called "Version one" with three things on it, no more. Put the rest in a list called "Later" and do not look at it until version one is live.

## Your turn

Take your idea from the last lesson and write its Version one list.`,
      },
      {
        slug: 'build-in-public',
        title: 'Build a little every day',
        summary: 'Small daily progress beats big bursts.',
        minutes: 5,
        body: `Finishing is a habit, not a talent.

## The tiny daily win

Do something on your project every day, even for ten minutes. A streak of small steps beats one heroic weekend.

## Keep a build log

At the end of each session, write one sentence: what you did and what is next. Two months later you will love having it.

## When you get stuck

- Say the problem out loud, or write it as a question. Often that solves it.
- Search for the exact error message.
- Ask for help in the community, and show what you tried.

Being stuck is not a sign you are bad at this. It is what building feels like for everyone.`,
      },
      {
        slug: 'show-people',
        title: 'Show people what you made',
        summary: 'Share early, listen, and improve.',
        minutes: 5,
        body: `A project nobody sees cannot get better. Sharing is scary, and it is the whole point.

## Share before it is perfect

Post it when it works, not when it is flawless. A rough demo people can click beats a perfect idea in your head.

## What to include

- **A one-line summary.** What is it and who is it for?
- **A link to try it.** The easier, the better.
- **A picture.** A screenshot makes people stop scrolling.

## Listen well

When someone gives feedback, say thank you first. Look for the pattern: if three people trip on the same thing, fix that thing.

## Your turn

Start a lab on TeenovateX with your project. Add a cover image, a demo link, and a sentence about what you learned. Then vote for two other labs and leave your first follow.`,
      },
    ],
  },
];
