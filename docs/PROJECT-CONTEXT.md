# Project context

**Read this first.** It is the single briefing document for anyone — human or
LLM — picking this repository up cold. It covers what the game is, the exact
rules as they currently stand, why each number is the number it is, how the
code is arranged, what is finished, and what is deliberately unfinished.

For how the design got here, see `DESIGN-HISTORY.md`. For the raw source
material, see `drafts/`.

---

## 1. What this is

An original card game, designed from scratch by Pranav Mittal in August 2026,
and a complete browser implementation of it.

The game is a Blackjack variant, but the resemblance is superficial. In
Blackjack the interesting question is arithmetic — do I take another card. Here
the arithmetic is nearly solved within a few hands, and the real game is an
accusation mechanic layered on top: at the moment any player takes a card,
anyone else may accuse them of having gone over the target, betting chips on
being right.

That accusation is the game's identity. Every design decision in this repository
either protects it or tunes it.

### Naming

The working name is **Twenty-Five**, after the target number. The repository is
named `quartercard`. The name is **not settled** — the target number itself may
change, which rules out any name built on "25". Candidates that survived
discussion, in rough order of preference: **Nerve** (the deciding quality, and
already the name of a variable in the Guesser bot's logic), **Baize** (the green
felt the visual design is built on), **The Call**, **Chancer**, **The Parlour**.
If you rename, note that `TARGET` in `js/app.js:11` is the only place the number
25 is defined — the rest of the code derives from it, though prose strings in
the rules panel mention it literally.

---

## 2. The rules, exactly as implemented

### Cards and target

A single 52-card deck, freshly shuffled every hand using crypto-grade
randomness. Aces are 1 or 11 — the player never declares which; the hand is
always read as whichever total sits closest to 25. A player is bust only if even
the kindest reading of their aces exceeds 25. Face cards are 10, everything else
face value. The target is **25**.

### Table

Two to four players. The dealer is a separate non-playing entity — it shuffles,
deals and adjudicates, does not ante, and cannot win the pot.

### Structure of a hand

Everyone is dealt two cards face down, and *then* antes — in that order,
deliberately. The table goes round twice, giving each player two turns. On your
turn you may take as many cards as you like or stick, capped at **four cards
total across the whole hand**. Each card taken costs a hit fee into the pot.

Nobody ever sees another player's cards unless a call forces them face up. The
only public information is who took cards and how many.

### The call

The instant a player takes a card, a call window opens on them and closes the
moment they act again. Only the player who just took a card can be called.

Multiple players may call simultaneously. In the implementation this is a
multi-select: each eligible player taps to throw their chip in, can take it back
before committing, and a single settle button resolves the window. See §4 for
why simultaneous calls are treated as one joint call rather than several
independent ones.

The accused turns their cards face up either way, and their hand is locked at
its current total regardless of outcome.

**Correct call** (they are over 25): the caller recovers their call fee, collects
everything the accused put into the pot — their ante plus every hit fee — plus a
bonus equal to the call fee. The accused is out of the hand.

**Wrong call** (they are 25 or under): the caller pays the call fee plus the
penalty, all of it to the accused, **and the hand ends immediately**. Nobody
wins the pot; it carries over to the next deal.

### Showdown

If nobody has called by the end of the second round, everyone still in reveals.
Closest to 25 wins. Exactly 25 beats everything. **Equal distance on either side
splits the pot** — 24 and 26 tie, 23 and 27 tie, and so on. Going over 25 does
not itself lose you the showdown.

That last rule is deliberate and was stress-tested (see §3). Undershooting still
weakly dominates overshooting, because only the player who is over can be
eliminated by a call — so there is no incentive to deliberately bust, you are
just not punished twice for it. The entire penalty for going over sits in the
call mechanic, which is the point.

### Elimination

A player is out when they can no longer cover the ante — not at literally zero
chips, since sitting on three chips with no way to buy in is not really being in
the game.

### Fee schedule

Three stake tiers, everything scaling proportionally off the ante:

| Tier | Ante | Hit | Call | Wrong-call penalty | Starting bank |
|---|---|---|---|---|---|
| Low | 10 | 2 | 5 | 7 | 200 |
| Middle | 20 | 4 | 10 | 14 | 400 |
| High | 50 | 10 | 25 | 35 | 1000 |

Defined at `js/app.js:62`. `MAX_HITS = 4` at `js/app.js:67`.

---

## 3. Why the numbers are these numbers

This is the part most likely to be quietly broken by a well-meaning future edit,
so it is worth understanding before changing anything.

The penalty of 7 is not arbitrary. It is the answer to a question the designer
posed explicitly: make calling on a player's second hit sit between −1 and 0
expected value.

Roughly four million simulated hands across eleven strategy archetypes
established the bust rate at the moment each call window opens. (That original
simulator was not kept. A reproducible re-implementation now lives in
`simulation/` — see `simulation/README.md` — and its independent results agree:
14 / 38 / 55 / 67% over 25 on cards one to four, stand on 23 still best, and
the second-card call at −0.06 EV under penalty 7, inside the −1 to 0 band.)

| Cards taken | Cards in hand | Actually over 25 | Frequency of that window |
|---|---|---|---|
| 1 | 3 | 13.8% | 62% of hits |
| 2 | 4 | 36.5% | 30% |
| 3 | 5 | 54.6% | 7% |
| 4 | 6 | 66.7% | 1% |

With a penalty of 10, calling after two hits was −2.59 EV — clearly losing, so
nobody rational ever did it, and the only profitable call (after three hits)
occurred in just 7% of windows. The mechanic that defines the game was handling
about one chip in five.

Dropping the penalty to 5 made that call +0.59 EV. The designer rejected this,
correctly: a positive-EV call becomes mechanical, the maths tells you to call,
and the read disappears. The chosen landing point was penalty **7**, putting the
two-hit call at about **−0.69 EV** — a marginal, judgment-dependent decision
rather than either a trap or a formula.

Two caveats recorded honestly at the time and still true:

The simulated opponents never bluff — they stand on fixed thresholds. Real
players who take cards while safe specifically to bait a call push the true bust
rate below 36.5%, which makes calling slightly worse than −0.69 in practice. If
the table finds calling dead after real sessions, penalty 5 is the documented
next stop.

The optimal stopping threshold is **stand on 23**, re-verified after the
wrong-call-ends-hand rule was added. Sticking on 21 is break-even; sticking on
19 bleeds badly.

### Other findings worth not rediscovering

Seat position is fair — spread across four seats is 0.105 chips per hand, which
is noise. Skill separates fast: the better player is ahead 83% of the time after
20 hands and 99% after 100, where poker takes thousands. And 25 is the right
target: at 21 the call mechanic barely fires (0.137 times per hand), at 31 it
fires often but hands drag to 8.9 cards.

Under the current rule set, roughly **half of all hands end before showdown**
because of a wrong call, and the carried pot is usually 0 but occasionally very
large (99th percentile 242, more than a starting stack). If that proves too
swingy in real play, refunding contributions instead of carrying the pot is the
measured alternative.

---

## 4. Decisions made by the implementer, not the designer

These were judgment calls, flagged at the time, and are all reversible.

**Simultaneous calls split rather than multiply.** The original physical rule was
"first chip in counts." On a shared screen you cannot tell who was first, so
every simultaneous call resolves as a split. It is computed exactly as it would
be for a single caller and then divided among whoever threw in, with any
remainder going to whoever tapped first. Treating them as independent calls would
let a crowd farm the bonus several times over and drain the pot in a way a lone
caller never could. Picking a random winner instead is a small change if
preferred.

**A wrongly-called player keeps their chip.** They are locked, but may still
call someone else later — they have money in the pot, so they keep a weapon.

**The pot carries on a wrong call.** The rule "wrong call ends the hand" left
open where the pot goes. Carry-over, paying the accused, and refunding everyone
were all simulated; carry-over was the only one that kept the bot difficulty
tiers correctly ordered.

**Ace values are computed, never asked.** Matches the designer's "decide on the
spot" intent without making anyone declare anything.

---

## 5. The bots

Four tiers. They differ by **what they know**, not by how well they use it — this
was an explicit requirement: lower tiers make less mathematical decisions rather
than becoming stupid about obvious things.

| Level | Name | Difficulty | Basis for decisions | Blunder rate |
|---|---|---|---|---|
| 1 | Guesser | Easy | Picks a nerve threshold each hand and plays to it; suspicion grows with the pile, uncalibrated | 15% |
| 2 | Rule Player | Medium | Rules of thumb — get close to 25 and stop, three cards is a lot of cards. No arithmetic | 8% |
| 3 | Odds Player | Hard | Correct probabilities and exact call EV, from static tables | 3% |
| 4 | Card Counter | Expert | Counts every card it can legally see and re-derives the odds from what is genuinely left | 0% |

Defined at `js/app.js:618`, blunder rates at `js/app.js:632`.

Blunders never touch obvious decisions. Hitting on 12 is correct 100% of the
time at every level; standing on 24 is correct 100% at levels 2–4 and 95% at
level 1. A level 1 bot only misfires when its own read said the spot was close.

Measured strength, 20 runs × 6,000 hands, chips per hand, four-handed:

```
Card Counter   +1.730  ±0.146
Odds Player    +1.286  ±0.107
Rule Player    −0.225  ±0.154
Guesser        −2.797  ±0.159
```

**Important caveat:** heads-up, the Card Counter and Odds Player are inside the
noise of each other. Only about twelve cards leave the deck per hand, so with two
players counting has nothing to bite on. The Counter is meaningfully stronger
only at a three or four seat table.

Two bugs found and fixed in the Counter that a future editor should not
reintroduce: minimising *expected distance* is the wrong objective, because it
is blind to the fact that landing exactly on 25 wins outright — it made the bot
stop on 21 instead of the optimal 23, worth about 1.8 chips a hand. And its
opponent model originally assumed everyone stops at 21, which systematically
discarded exactly the hands where a strong opponent pushed from 22 into a bust.

---

## 6. Architecture

```
index.html              markup, script/style tags, CDN links
css/styles.css          all styling
js/supabase-client.js   auth + wallet — the two lines you must edit
js/app.js               the entire game: engine, bots, networking, UI
sql/schema.sql          run once in Supabase
simulation/             Monte Carlo simulator (Python), tests, results
legacy/                 pre-split monolith, reference only
docs/                   this folder
```

The split from a single 2,977-line file into these was verified **byte-for-byte
lossless** — CSS and JS were moved without reordering. A full ES-modules rewrite
was considered and rejected: the global state (`G`, `NET`, shared DOM refs) is
touched from everywhere, so ordered `<script>` tags are mechanically identical to
the previous single-scope execution, and a topical split risked silently breaking
a dependency for no real benefit.

There is no build step and no `npm install`.

### Three play modes

**This device** — pass-and-play. One screen, a gate screen between turns so the
next player does not see the previous hand. Works offline.

**Lobby** — everyone on their own phone, connected peer-to-peer over WebRTC via
PeerJS. The host's device *is* the table: it holds the one true game state and
sends each player only their own slice. Hidden information is solved for free
because the host was always holding all the cards anyway. The host plays a normal
seat; the pass-the-phone gate disappears entirely.

**Invite link** — `yoursite.com/?join=ABCDE` drops a guest straight onto the join
screen with no login at all. They get the rules and nothing else: no front page,
no trainer, no setup screen, no access to the owner's account.

Lobby codes are five characters with confusable characters removed (no O/0, I/1,
S/5, B/8).

### Trainer

A practice tool on the landing page that deals a hand, plays it out with a
simulated opponent, freezes it at a random mid-hand moment, and asks whether you
would call. It grades in **chips, not right/wrong** — the original right/wrong
metric rewarded never calling, which taught the opposite of the game — and it
separates the decision from the outcome, so a call that loses at good odds is
correctly reported as good play. There is a toggle to hide the odds and play on
instinct.

---

## 7. The chip economy

The money model, settled deliberately:

A one-time welcome bonus granted by the database, once per account ever — the
second call returns zero rather than paying twice. Chips then move between real
players through the pot, which funds itself. **No cash-out, ever.**

That last line is the one that keeps this a game rather than a licensed gambling
operation. Under the UK Gambling Act 2005 and most equivalents, what matters is
whether a real-money prize is at stake; virtual currency with no redemption value
generally falls outside it. The failure mode to avoid is third-party resale —
apps using the identical "play chips, no official cash-out" framing get flagged
because club owners resell chips and convert winnings off-platform. So: no chip
transfers between players, no gifting, no resale route of any kind. Enforce it as
a database rule, not a stated policy.

The bot-payout idea (win real chips from bots for your first 50 games) was
considered and rejected in favour of the fixed welcome bonus. It was farmable —
a new player would obviously grind the easiest bot, which loses about 2.8 chips
a hand — and a real payout for new accounts is exactly what burner accounts are
created to farm.

### Security model

The schema was tested against a live local Postgres instance with adversarial
attempts, not read through. Thirteen checks pass on a genuinely fresh database.
That process caught three real bugs:

**Critical.** `cash_out` originally had no bound at all — any signed-in user
could call it directly with any number and mint unlimited chips in one request.
Fixed by tying cash-out to a 50× ceiling on real recorded buy-ins.

**The obvious bypass of that fix.** The ceiling was scoped to a client-supplied
`table_ref` string, so changing the string reset the ceiling. Now scoped to the
account over a rolling 24-hour window.

**The subtler gap that exposed.** A ratio ceiling permits many small
transactions each individually at the limit. Closed with a rate limit — more
than 20 cash-out calls in 10 minutes is rejected.

Also verified: direct table writes rejected by RLS, Postgres's default
PUBLIC-execute grant explicitly revoked so anonymous requests cannot even call
the functions, welcome bonus exactly-once under repeated concurrent attempts,
buy-in races handled by locking the profile row as a mutex, and one user's data
completely invisible to another.

### The limit that remains

**The wallet is protected. The game is not.** The game engine runs in the
browser, so `cash_out` cannot verify that a number the client reports actually
happened at a table — it bounds and rate-limits the claim, but cannot confirm
it. Fine for play money. **Not fine once real payments are involved.** Moving
the engine server-side is the prerequisite for payments, and it happens to fix
the host's-tab-must-stay-open limitation too.

---

## 8. Honest limitations

**Wallet-backed play is one signed-in human plus bots.** A wallet belongs to one
account, but pass-and-play shares a screen between several humans and invite-link
guests have no account at all. Charging one wallet for other people's play would
be wrong, so the other modes are free practice with throwaway chips. Extending
real stakes to multiplayer means every seat needs its own signed-in account —
that is a product decision, not a code change.

**The host's tab must stay open.** The host's device is the table. If they close
it, everyone gets "The table closed" and the game ends. There is no reconnect.
That is the honest cost of having no server.

**The host can technically cheat.** Their device holds every hand in order to run
the game. Their screen only ever shows their own, and redaction happens on the
host before anything goes on the wire — but someone determined could dig through
their own browser's memory.

**Lobby mode needs internet and an unrestricted network.** Strict school or
office wifi, some VPNs and certain routers block WebRTC. Failures are specific
rather than generic, and there is a 12-second timeout on every connection attempt
so it cannot hang. It will not work inside an app's built-in viewer (including
Claude's own preview pane), which sandboxes the frame — the app detects this and
says so up front.

**Nothing in the browser can be hidden.** Source, bot strategy, everything is
readable by anyone who opens developer tools. Minification does not change this.
Cloudflare Access (free to 50 users) is the real answer if strangers must be kept
out, since it checks identity before serving the page at all.

---

## 9. Current state

Complete and verified: the game engine, all four bot tiers, the multi-caller
resolution, all three play modes, the trainer, the file split, Supabase auth
(sign-up/sign-in tabs, session persistence, wallet display, sign-out), the chip
economy schema, and the buy-in/cash-out wiring into gameplay. Around 83 checks
pass across five regression suites, covering chip conservation, the host/guest
protocol including a specific test that no guest ever receives another player's
cards, invite links, mobile layout on six phone sizes, and bot ordering.

Also complete: a Python Monte Carlo simulator (`simulation/`) that plays the
shipped rules — its engine cross-checked against `js/app.js` for every 2–6 card
hand — measuring win rate and EV for eight strategies over 1,000,000+ hands and
asserting chip conservation after every hand. The economy is documented in
`docs/ECONOMY.md`, including the one place the build departs from the design:
wallet play against bots currently pays winnings into the wallet.

Not done, in the order it probably matters:

1. **Supabase is not configured.** `js/supabase-client.js:14–15` still holds
   `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_ANON_KEY`. Nothing
   wallet-related works until these are filled in and `sql/schema.sql` is run.
2. **Not deployed.** Needs any static host — Netlify Drop or Cloudflare Pages.
   Lobby play and invite links need a real `https://` link to work at all.
3. **Never tested over a real network.** The peer-to-peer protocol is proven
   against a real second instance of the shipped code over an in-memory wire, but
   the actual WebRTC handshake between two physical phones on the real internet
   has never been run.
4. **The name is unsettled.** See §1.
5. **The old hardcoded login is gone** (replaced by Supabase auth), but the
   **game-start PIN `4049` remains in the source** and is decorative — a
   doorman, not a lock.

### If you are an LLM picking this up

Read `DESIGN-HISTORY.md` next. Before changing any fee, threshold or rule,
re-read §3 above — most of those numbers are the output of simulation work, and
several plausible-sounding "improvements" were measured and rejected for reasons
recorded there. If you change a rule that affects hand length or bust rates, the
bot tier ordering needs re-verifying, because it has silently inverted twice
before.
