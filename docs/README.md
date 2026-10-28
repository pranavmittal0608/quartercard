# docs

Context and history for this project. None of this is loaded by the game — it is
here so the reasoning behind the code survives independently of any chat
platform, and so anyone picking the repository up cold (human or LLM) can get
current without archaeology.

**Start with `PROJECT-CONTEXT.md`.** It is the briefing document: what the game
is, the exact rules as implemented, why each tuned number is the number it is,
how the code is arranged, what is finished, and what is deliberately not.

**Then `DESIGN-HISTORY.md`** if you need to know how it got here — what the game
looked like originally, what broke, what changed, and which plausible-sounding
improvements were measured and rejected.

**`ECONOMY.md`** covers the chip economy: the design, how the database enforces
it, how the simulation verifies it, and what is and isn't built yet.

**`../simulation/`** is the Monte Carlo simulator — win rate and expected value
per strategy, the value of a call card by card, and where to stop. Its
`README.md` has the results; `python3 simulate.py` reproduces them exactly.

**`drafts/`** holds raw source material. `original-conversation.md` is the
verbatim transcript of the design and build conversation, August–September 2026.
Long and uncurated; go there for the exact wording of a decision.

**`../legacy/`** holds `twenty-five-standalone-v1.html`, the 2,977-line
single-file version from before the split into `index.html` / `css` / `js`. Kept
for reference only — it is not loaded and not maintained.

## If you are changing something

Before touching any fee, threshold or rule, read `PROJECT-CONTEXT.md` §3. Most
of those numbers came out of simulation, and several obvious-looking adjustments
were tested and rejected for reasons recorded there. Re-run `simulation/` after
any rule change — and update `simulation/engine.py` to match, or the JavaScript
cross-check test will fail.

If you change anything affecting hand length or bust rates, re-verify the bot
tier ordering. It has silently inverted twice, both times because a rule change
invalidated an assumption buried in the Card Counter's opponent model.
