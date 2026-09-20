# dishwater bag

catch falling cats in a paper bag. miss three and it's over.

a small browser game, plain html + css + javascript on a canvas. no framework,
no bundler, nothing compiled.

## running it

```
npm install
npm run dev
```

that starts a dev server and reloads the page whenever a file changes, which is
the nicer way to work on it.

you can also just open `index.html` in a browser. it needs no server at all, and
that is deliberate, `game.js` is a plain script rather than a module so the page
works straight off the filesystem.

there is no build step. everything in the repo *is* the game, so deploying it
means copying the files onto any static host. note that `vite build` will not
produce a working `dist/`, it drops the plain script and the sprites, if you
ever want a real bundled build the page has to move to a module script and the
assets into `public/`.

## controls

| key | does |
| --- | --- |
| left / right arrow, or A / D | move the bag |
| P | pause |
| space | start, or restart after a game over |

the bag also follows the mouse or a trackpad, which works on a touchscreen too.

## rules

cats fall from the top. catch one and you score, drop one and you lose a life.
you start with three. the poop is the thing you are meant to *let* fall, it only
costs you a life if you catch it.

| falls | worth | how often |
| --- | --- | --- |
| big cat | 1 point | 48% |
| medium cat | 3 points | 24% |
| small cat | 6 points | 11% |
| poop | costs a life if caught | 16% |

all three cats are the same sprite drawn at different sizes, so the tiers are
told apart by how big they are. the smaller the cat the more it is worth.

things speed up over the first 60 seconds and then level off at 2.25x the
starting pace, so it gets harder without running away from you. your best score
is kept in `localStorage`.

## leaderboard

off until you connect it. with `leaderboard.js` left as it ships there is no
name prompt and no board, the game plays exactly as it does offline.

to turn it on:

1. make a project at [supabase.com](https://supabase.com)
2. open the sql editor and run `supabase-schema.sql`
3. copy the project url and the **publishable** key (`sb_publishable_...`) from
   project settings, api keys
4. paste both into the top of `leaderboard.js`

the publishable key is meant to sit in public client code, that is the whole
point of it. supabase is retiring the older `anon` key by the end of 2026, so
use the publishable one.

### how it hangs together

everyone gets a random id the first time they load the page, kept in
`localStorage` alongside the name they typed. that id is what makes someone the
same player next visit, so there is one row per person and a second game only
ever raises their score, never adds a duplicate.

worth knowing, that id lives in one browser. the same person on their phone, in
another browser, or after clearing site data counts as somebody new. tying
people together properly across devices means real accounts, which is a much
bigger thing to build.

the table has row level security on and no policies at all, so the key in the
page cannot read or write it directly. the browser can only call two functions:

| function | does |
| --- | --- |
| `submit_score` | upserts one row, keeps the higher score, caps the name at 16 characters |
| `get_leaderboard` | returns names and scores only |

`get_leaderboard` deliberately never returns player ids. an id is the only thing
standing between a stranger and writing to someone else's row, so it stays out
of the page. the name is set once when a player first appears and is never
updated after, which means even a leaked id cannot be used to rename anybody.

### it can still be cheated

the game runs on the player's machine, so anyone who opens the console can call
`Leaderboard.submit(99999)` by hand. the database caps a score at 100000 and
refuses to lower an existing one, which stops the silly cases, but it cannot
tell a real 300 from a typed one. that is true of any browser game without a
server refereeing the play. fine for friends, not fine for prizes.

## files

| file | holds |
| --- | --- |
| `index.html` | the markup, the hud and the title / game over overlay |
| `style.css` | page styling, the colour scheme and the responsive sizing |
| `game.js` | everything else, the whole game |
| `leaderboard.js` | names, player ids and talking to supabase |
| `supabase-schema.sql` | the table and the two functions, run once |
| `assets/` | the sprites, the background tile and the font |
| `package.json` | the dev server script, vite is the only dependency |

## assets

| asset | used for |
| --- | --- |
| `background.png` | the playfield, drawn once at 8x |
| `falling - 1..5` | the falling cat, a 5 frame tumble at 10fps |
| `bag - 1`, `bag - 2` | the bag sitting idle, alternating at 2.5fps |
| `bag - 4`, `bag - 5` | the two cat-in-the-bag poses, one picked at random per catch |
| `idle - 1..3` | the cat on the title screen, played 1 - 2 - 3 - 2 at 4fps |
| `poop.png` | the hazard, a single frame |
| `rainyhearts.ttf` | the font, used by the page and the canvas both |

`bag - 3.png` is a head-on view of the bag and is not currently used, the other
bag frames are all three quarter views so it does not cut into the animation.

## how it works

### a fixed playfield, drawn bigger

all the game logic works in a fixed 640 x 720 space (`VIRTUAL_WIDTH` and
`VIRTUAL_HEIGHT`), so every position, speed and size is written in those units
and never has to care what size the window is. the canvas itself is twice that,
and each frame starts with a `setTransform` that scales drawing up to match.
that keeps the sprites sharp on a big screen without touching any of the game
numbers. the page then sizes the whole frame to fit the window, keeping the
640:720 shape.

the one place the difference matters is the mouse, which converts from screen
pixels back into playfield units.
