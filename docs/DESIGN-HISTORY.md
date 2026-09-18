# Design history

How this went from a paragraph of rules to what is in the repository. Roughly
chronological, August to September 2026. Dates are when each exchange happened.

The point of this document is that several decisions here look arbitrary from
the outside and are not. Where something was measured, the number is recorded.
Where something was rejected, the reason is recorded — including the things that
sounded like improvements and turned out not to be.

The raw conversation this is drawn from is in `drafts/original-conversation.md`.

---

## The original idea (7 Aug)

The game was proposed in a single paragraph. The first version targeted **21**,
not 25. Everyone gets two cards, aces are 1 or 11, the aim is exactly 21, two
rounds, stick or hit, cards hidden. Hitting costs a small fee into the pot. When
someone hits, anyone can call against them, accusing them of being over. A
correct call takes the whole pot; a wrong call refunds around the table with the
caller's share going to the dealer. If nobody calls, exactly 21 wins, and
failing that the **highest** total wins regardless of being over.

### Four things that were broken

**Busting was rewarded.** "Highest wins regardless" meant 30 beat 22 beat 20.
Sticking on 20 became a losing move, and with no calls the correct play was
always to hit as hard as possible. That single clause deleted the entire risk
side of the game.

**A losing player should always call.** A wrong call splitting the pot among
everyone is roughly a refund. Sitting on 14 with no path to 21, calling costs one
fee for a shot at the whole pot with near-neutral downside. Desperate players
would spam calls.

**There was no bluff to catch.** Nobody claimed anything, so calling was a guess
based on how many times someone tapped the table, not the catching of a lie.

**One correct call took everything.** An enormous payoff for a coin-flip read,
and it ended the hand for everyone else.

### The strength, identified early

The hit fee was the best idea in the original design and its value was not
obvious at first. In poker, betting is information but it is also the whole game.
Here, hitting is the *only* information anyone has, and it costs money to
produce. Every scrap of readable signal in the game is paid for in cash. That is
an unusually tight loop — it makes hesitation, over-eagerness and stone-facedness
all legible without a single betting round.

---

## First round of fixes (7 Aug)

The designer's responses, in order: highest-wins became **closest**; wrong calls
were made to cost extra; the dealer became a separate non-playing entity; hits
were capped at four per hand; and the target moved from **21 to 25**.

Two exchanges here are worth preserving because the designer was right and the
initial analysis was wrong.

**On declarations.** The proposed fix for "there is no bluff to catch" was to
make players declare "I'm under" or "I'm on 21" when sticking. The designer
rejected this: a declaration that costs nothing and cannot be checked until
showdown is cheap talk, everyone lies constantly, and the words become noise.

That was correct, and it exposed something better: **hitting is already the
claim.** It costs money, it is public, and it implicitly says "I am low enough
that another card is worth it." That is a costly signal, which is exactly what a
bluff needs to be. And because a wrong call now pays the accused, the real bluff
becomes taking a card *when you are safe* specifically to look reckless and bait
a call. The deception layer lives in the action rather than in talk.

**On "closest" not being enough.** 22 is closer to 21 than 19 is, so switching to
"closest" moved the bug rather than killing it. It needed one more line: any hand
over the target loses to any hand at or under it.

Which leads to the rule the designer chose instead, and kept.

### The mirror-tie rule

The designer specified that equal distance on either side **splits the pot** —
24 and 26 tie. This was initially flagged as a reintroduction of the
busting-is-rewarded bug. It is not, and understanding why matters:

24 and 26 score the same, but only the player on 26 can be eliminated by a call.
Undershooting always weakly dominates overshooting at equal distance. So there is
no incentive to deliberately go over — you are simply not punished twice for it.
What it does mean is that the *entire* penalty for busting now sits in the call
mechanic. That is a bolder design than Blackjack and the right one here, because
it means money moves through reads rather than through arithmetic.

Later simulation confirmed this directly: making bust lose at showdown cuts the
over-25 rate from 31.6% to 1.3% but does not change calling behaviour at all —
0.455 calls per hand either way. It is a taste question, not a fix.

### First fee schedule

Ante 10, hit 2, call 5, wrong-call penalty 10 extra. The reasoning: a wrong call
costs 15 total, a correct call against someone who hit three times returns 21, so
you need to be right about 42% of the time to break even. Calls happen, but not
carelessly.

---

## First build (7 Aug)

Built as a single HTML file. The visual direction was set deliberately: not a
Vegas casino but a **private card room** — deep bottle-green baize, oxblood
leather rail, champagne brass, bone-white cards, Bodoni Moda for card indices and
the pot, Jost for the interface. One bold moment reserved for the call: a brass
chip physically flies across the table and slams into the accused before their
cards flip. Everything else stays quiet.

Deck fairness was verified rather than assumed — chi-square 40.8 on 51 degrees of
freedom across 20,000 deals, every hand containing exactly 52 distinct cards, and
ace logic checked at the boundaries (A+A reads 22 not 12, K+K+5 sits on 25 safe,
K+K+6 is bust, 24 and 26 come out an exact tie).

Then a series of refinements: the call-window timer was removed entirely (the
pressure at a real table comes from other players staring at you, not a bar
draining on a screen); a chip token was stamped on all 31 places a number means
money; and a landing page was added with a hero that deals a real hand landing on
exactly 25 from an actual shuffled deck.

---

## The trainer, rebuilt (2 Sep)

The first trainer scored right/wrong. That metric was broken: never call and you
are "right" about 70% of the time, so it taught you to sit on your hands.

Rebuilt around four changes. Scoring moved to **chips**, so doing nothing scores
exactly zero and you have to beat it. It **grades the decision separately from
the outcome** — a call that loses at good odds is good play and the trainer now
says so explicitly. It **freezes the hand mid-play** at a random moment rather
than judging a finished hand, because at a real table the window opens the
instant someone takes a card. And it shows the **behaviour trace** — which round,
how many cards in round one, how many since — because that is the real
information at a live table.

---

## The simulation work (2 Sep)

The designer asked for stress testing against archetypes: aggressive-call,
aggressive-hit, slow, fast, safe. An agent-based simulator mirroring the game
engine exactly was built and ran roughly **four million hands across eleven
archetypes**.

### Finding one: calling barely mattered

The call is the identity of the game and it was handling one chip in five. A
player who never called lost only 0.36 chips per hand to a player who called
perfectly.

The cause was the win-to-loss ratio. A correct call wins the accused's stake; a
wrong one costs a flat 15. At 10/2/5/10 you win 19 and lose 15, so you need to be
right 44% of the time — and after two hits people are only over 36.5% of the
time. Eight points short. The condition that has to hold:

```
0.365 × (ante + 2·hit + call)  >  0.635 × (call + penalty)
at 10/2/5/10:   6.9  vs  9.5   — fails
```

Only the third card was worth calling, and the third card almost never comes.

### Finding two: 29% of hands ended in a tie

Nearly a third of pots were split, and 45% of those splits existed only because
24 ties 26.

### What was recommended, and what the designer did

Two changes were proposed: drop the penalty from 10 to 5, and make the hand at or
under 25 win on equal distance.

The **tie change was proposed and then honestly withdrawn**. Asked what advantage
it gave, the answer was: none, strategically. It does not change how often people
hit or call, the skill spread, or anyone's EV. It only cuts the split rate from
28.9% to 19.7%. Purely aesthetic. The designer kept the mirror ties, and they are
what is in the code today.

The **penalty change the designer pushed back on**, and this is the most
important exchange in the whole history. Dropping to 5 makes the two-hit call
+0.59 EV. The designer's objection: *"making it positive EV would mean people
will simply start calling too often, it takes the whole element of risk away."*

That was right. A positive-EV call becomes mechanical — the maths says call, so
you call, and the read disappears. Worth noting that the simulation had already
hinted at this: the best players were using a calling margin of 0 to −2, meaning
they were *passing on marginal positive-EV calls*, not taking everything positive.

The designer then proposed the actual solution: target somewhere between −1 and
0 EV. Solving for it:

```
EV = 0.365 × 19 − 0.635 × (5 + penalty)
penalty 10 → −2.59      penalty 7 → −0.69      penalty 6 → −0.05
```

**Penalty 7** landed inside the band. Calling stays slightly unprofitable — so
you cannot just call everything and the bluff layer survives — but it is close
enough that reads, position and player patterns give you a real edge. That is the
number in the code.

### Things the simulation established that are still true

Stand on **23**. Sticking on 21 is exactly break-even; 19 bleeds. Optimal calling
margin is exactly zero — loose calling is the worst sin in the game, and the
archetype that called at −4 EV finished last of eleven, below the recklessly
hitting Maniac. Seat position is fair. Skill separates in one evening rather than
thousands of hands. And 25 is the right target: 21 barely fires the call
mechanic, 31 drags hands to 8.9 cards.

---

## Mobile, twice (2 Sep)

The setup panel was cut off at the top and bottom on a phone. The first attempt
reduced padding and font sizes, which did not fix it, because the problem was not
sizing.

The scrim used `align-items:center`. When a panel is taller than the screen, flex
centering pushes the overflow out of *both* ends, and the browser will not let
you scroll above the container's origin — so the top becomes physically
unreachable. Measured: 77px permanently out of reach. Fixed with
`align-items:flex-start` plus `margin:auto` on the panel, which still centers
when there is room and anchors to the top when there is not.

Three other things went in at the same time: `height:100dvh` so the scrim tracks
the viewport as the address bar slides away, `env(safe-area-inset-*)` padding for
notches, and inputs bumped to 16px to stop iOS auto-zooming on tap.

---

## Multiple callers (2–4 Sep)

The designer spotted a real gap in play: clicking one person's call button
immediately resolved the window, so a second player who also wanted to call never
got the chance.

Rebuilt as a multi-select. The money question — how several simultaneous callers
split — was resolved as **one joint call divided among the callers**, rather than
several independent calls. If three people each triggered a full call, a crowd
could farm the bonus three times over and drain the pot in a way a lone caller
never could. That is not a real risk anyone is taking, just a scoring exploit.

Tested rather than eyeballed: chip totals conserved across two-caller,
three-caller, non-dividing-remainder and two-player cases; selecting three then
unselecting one; and 40 turns of ordinary unscripted play hitting three organic
call windows with the books balanced at the end.

---

## Bots (4 Sep)

The brief was specific and unusual: as levels go down the bots should make **less
mathematical** decisions rather than becoming stupid about obvious things. The
top tier should use card counting and play purely off statistics. Lower tiers may
be slightly more open to genuinely hard blunders.

The first implementation had levels 2, 3 and 4 statistically tied, because
"stand on 22" happens to sit very close to optimal — so the rule of thumb was
accidentally almost as good as doing the maths. Each tier was given a distinct,
defensible basis, and the Counter was given the one insight only a counter can
have: it re-reads the deck as it thins. Same visible situation, different deck —
holding low cards it reads an opponent as 38.9% over, holding high cards 23.7%,
because the tens are gone.

A performance note worth keeping: the level 4 Monte Carlo was using crypto-grade
randomness for what is just a private internal estimate. Swapping it for ordinary
randomness took a decision from 8ms to 0.27ms — 30× faster. Card dealing still
uses crypto entropy, where fairness actually matters.

---

## Wrong call ends the hand (4 Sep)

A rule change from the designer that invalidated the existing tuning, so it was
simulated before being implemented.

The rule left one thing open: nobody wins the pot, so where does it go?
Carry-over, paying the accused, and refunding everyone were all measured.
**Carry-over was the only one that kept the bot levels correctly ordered.**

The change reshapes the game — half of all hands now die before showdown. Median
carried pot is 0 but the 99th percentile is 242, more than a starting stack. If
that proves too swingy in real play, refunding contributions is the measured
alternative.

### Two things that had been asserted without measuring

Both surfaced here, and both are the kind of error worth recording.

The Card Counter's lookahead had been described as "settling around standing on
23." It had never been measured. When probed, it was stopping on **21** — two
pips early, worth about 1.8 chips a hand. The cause: minimising *expected
distance* is the wrong objective, because it is blind to the fact that landing
exactly on 25 wins outright.

The Counter's opponent model assumed everyone stops at 21, but the strong bots
push to 23 — so it was systematically discarding exactly the hands where someone
pushed from 22 into a bust, reading opponents as safer than they were.

After both fixes the ordering was clean with non-overlapping intervals, and a
re-sweep confirmed **stand on 23 survives** under the new rule.

Also added in this pass: bot names with difficulty ratings (Guesser/Easy, Rule
Player/Medium, Odds Player/Hard, Card Counter/Expert), a "Nobody called" flash
across the felt, a mini log of the last three events carrying public facts only,
and the hardcoded login and PIN gates — flagged at the time as a doorman, not a
lock, since both sat in the page source.

---

## Going online (4 Sep)

The requirement: play either on one phone as now, or join the same game from
separate devices via a lobby code.

Three options were laid out honestly. A proper backend (Firebase, Supabase) —
reliable, but hidden cards need real per-player security rules, a decent chunk of
plumbing. A dedicated server — cleanest, but needs deploying and keeping alive. Or
**WebRTC peer-to-peer**, which is what was chosen.

The idea: the host's phone just *is* the game, exactly as it already was. Other
phones are not running a copy — they are remote controllers plugged into the
host's phone. Hidden information is solved for free, because the host was always
the one holding all the cards; it just also forwards the right slice to the right
screen.

The designer asked two clarifying questions worth recording, because the answers
shaped the build: everyone plays on their own phone with nothing passed around,
and the **host plays a normal seat** while their device does the bookkeeping
invisibly in the background. The pass-the-device gate disappears entirely in
lobby mode.

The test that mattered most: two independent instances of the shipped code, a
real host and a real guest, wired over an in-memory connection. The guest read
its own two cards (J♣ K♥) and received **six blanks** instead of the other three
players' hands. Redaction happens on the host before anything goes on the wire —
checked against the raw serialised payload, since face-down cards still exist in
the DOM and a curious guest could otherwise read them out of their own browser.

### The hang, and the invite link

Creating a lobby hung forever on "Opening the room…". The cause was a real bug:
the code waited for PeerJS to call back with either success or error, and when
WebRTC is blocked **neither ever fires**. No timeout. Fixed with a 12-second
limit, a try/catch, and a global error handler, so an attempt always ends in
either a lobby or a clear explanation.

The underlying trigger was environmental — it was being run inside an app's
built-in viewer, which sandboxes the frame and blocks the connection. The app now
detects that up front and says so rather than making you wait.

Separately, the designer raised a real concern: sending a friend the file gives
them the whole codebase, and joining a lobby required the owner's credentials,
which is backwards. The answer was an **invite link** — `?join=ABCDE` drops a
guest straight onto the join screen with no login, no front page, no trainer, no
setup. They keep the rules, because you cannot play without them.

The honest part of that answer: hosting solves handing out the file, but nothing
makes browser code unreadable. Minification does not lock it. What protects the
work is copyright and the fact that almost nobody reverse-engineers a card game;
if the logic genuinely must be hidden, the engine has to move server-side.
Cloudflare Access (free to 50 users) is the real answer for keeping strangers out
entirely, since it checks identity before serving the page at all.

---

## Commercial viability and the money model (5–6 Sep)

The designer's direction: website only, no app; Supabase for login and backend;
buy chips to play; win chips by playing online or against bots, capped at 50
games against bots; no cash-out.

Website-only genuinely simplifies things — it drops the entire app-store layer
(Apple's 17+ rating for simulated gambling, the extra review scrutiny, Google's
regional licensing). The gambling-law question underneath does not care about
platform: what matters is whether a real-money prize is at stake. Virtual
currency with no redemption value generally falls outside the Gambling Act 2005.

The cautionary case, which is specific and worth knowing: apps like PPPoker and
PokerBros use the identical "play chips, no official cash-out" framing and are
widely flagged as operating in a serious grey area, because club owners buy chips
and resell them at a markup, then convert winnings to cash off-platform. The
platform never touches real money and it is still the thing critics point to.
**"No checkout" only works if literally nobody can turn a chip back into cash.**

### The bot payout, considered and dropped

The bot-payout idea had a hole: a new player would obviously grind the *easiest*
bot for all fifty games, since the win rate is far better — the Guesser loses
about 2.8 chips a hand while the Rule Player is near break-even. Two fixes were
possible (lock the free games to the medium bot, or cap lifetime bot extraction
outright), but both left the deeper problem that a real payout for new accounts
is exactly what burner accounts exist to farm.

The alternative — a starting stack on signup plus a free top-up after a cooldown
— is the precedented pattern (PokerStars Play, WSOP's free app) but loses the "I
just won something real" moment, which is a genuinely strong hook for a new
player.

The designer chose the **hybrid**: a small, fixed, one-time welcome bonus,
genuinely capped rather than a renewable window. New players still get their win
moment, there is no ongoing exploit, and the real economy lives entirely in chips
moving between real people, which costs nothing to run.

---

## The chip economy, attacked (6 Sep)

Postgres was installed locally and the schema was **attacked rather than read
through**, using the same permissive-grants-plus-RLS pattern Supabase runs in
production so that a false pass from a missing GRANT could not hide a real RLS
bug.

Three genuine bugs, each found by the attempt that exploited the previous fix:

**`cash_out` had no bound at all.** A signed-in user could call it directly with
any number and mint a million chips in one request. Demonstrated, then fixed with
a 50× ceiling on real recorded buy-ins.

**The ceiling was scoped to a client-supplied string.** `table_ref` came from the
client, so a fresh string reset the ceiling and the extraction could be repeated
in chunks. Rescoped to the account over a rolling 24-hour window.

**A ratio ceiling limits ratio, not volume.** Repeating a 50-to-1 cycle sits
exactly *at* the ceiling by definition, so a script firing many small cycles
could still accumulate a large absolute number before the window rolled over.
Closed with a rate limit on the calls themselves.

Also verified: direct table writes rejected, the default PUBLIC execute grant
revoked (anonymous requests were reaching the functions and failing on unrelated
internal logic rather than a permission wall — which would have looked like
security and was not), the welcome bonus exactly-once under repeated attempts,
concurrent buy-ins unable to race past a balance check, and one user's data
invisible to another.

A methodology note that mattered more than once: a blocked UPDATE under RLS does
not throw, it silently affects zero rows. "No exception" is not "no bug."

---

## The file split and real auth (6–9 Sep)

2,977 lines in one file became `index.html` / `css/styles.css` / `js/app.js`.

A full ES-modules rewrite was considered and rejected — the global state is
touched from everywhere, so ordered `<script>` tags are mechanically identical to
the previous single-scope execution while a topical split risked silently
breaking a dependency. Even a fine-grained split by subject was rejected in
favour of splitting by file type, because moving content byte-for-byte with no
reordering is *mechanically verifiable* rather than something that has to be
trusted by eye. It was then diffed to prove it.

Supabase Auth replaced the fake gate: sign-up/sign-in tabs, session persistence
so returning players skip the gate, wallet balance in the header, sign-out. One
real shipped bug surfaced in testing — `setGateMode("in")` unconditionally reset
the gate message, immediately overwriting the "check your email to confirm" text
that had just been set.

Then the wallet was wired into gameplay, which forced a design decision: a wallet
belongs to one account, but pass-and-play shares a screen between several humans
and invite-link guests have no account at all. Charging one wallet for other
people's play would be wrong. **Wallet-backed play is one signed-in human plus
bots**; the other modes stay free practice, and the setup screen says which one
you are getting. Tested end to end: 500 → 400 on a 100 buy-in, → 575 after
cashing out a 175 stack.

Several older regression suites were found to be **silently passing while testing
nothing** — they logged in via `#gUser`, which no longer existed after the auth
rewrite. Worth remembering as a failure mode: a suite reporting zero failures
because it reported zero checks.

---

## Where it stopped (9–16 Sep)

The designer asked for the project to be put on GitHub, and separately said the
name Twenty-Five had to go, later adding that the target number itself might
change — which ruled out any name built around 25.

The repository is `pranavmittal0608/quartercard` and the code is pushed. The name
of the *game* is still open. See `PROJECT-CONTEXT.md` §1 for the shortlist.
