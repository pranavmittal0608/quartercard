# Twenty·Five — setup

Five files. No build step, no npm install. Edit two lines, run one SQL
script, upload the folder.

```
index.html            the page
css/styles.css        all styling
js/supabase-client.js accounts + wallet  <- the two lines you edit
js/app.js             the game
sql/schema.sql        run this once in Supabase
docs/                 design context and history (not loaded by the game)
legacy/               pre-split single-file version, reference only
```

**New here?** Read `docs/PROJECT-CONTEXT.md` first — the rules, why each tuned
number is what it is, and what is deliberately unfinished. `docs/DESIGN-HISTORY.md`
covers how the design got here and which changes were tested and rejected.

## 1. Supabase

Create a free project at supabase.com, then:

**Run the schema.** Dashboard → SQL Editor → New query → paste all of
`sql/schema.sql` → Run. This creates the profiles table, the chip ledger,
the security policies, and the three functions that are the only way chips
ever move.

**Copy your keys in.** Dashboard → Project Settings → API. Open
`js/supabase-client.js` and replace the two placeholders:

```js
const SUPABASE_URL = "https://yourproject.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGci...";
```

The anon key is *meant* to be public — it's safe in client code because
every table it can reach is locked down by the policies in the schema.
Never put the `service_role` key here. That one bypasses all security.

**Decide about email confirmation.** Dashboard → Authentication →
Providers → Email. If "Confirm email" is ON, new players must click a link
before they can play. If OFF, they're in immediately. The app handles both
correctly — it just shows a different message.

## 2. Put it online

Any static host works, since there's no server side. Two easy ones:

- **Netlify Drop** — go to app.netlify.com/drop, drag the whole `site`
  folder onto the page. Done in about ten seconds.
- **Cloudflare Pages** — free, and lets you add real access control later
  (Cloudflare Access is free for up to 50 users) if you want to keep
  strangers out entirely.

Both give you an `https://` link. A custom domain is £8–12/year and
optional.

Opening `index.html` straight off your hard drive mostly works, but lobby
play won't, and invite links won't be shareable. Use a real link.

## 3. Money model, as built

- New account → one-time welcome bonus, granted by the database, once ever.
  Calling it again returns zero rather than paying twice.
- Chips move between real players through the pot. That funds itself.
- **No cash-out. Ever.** This is the line that keeps it a game rather than
  a licensed gambling operation. Don't add chip transfers between players,
  chip gifting, or any way for a third party to resell chips — that's
  precisely what has put similar apps in legal trouble, even where the
  platform itself never touched real money.

## 4. Known limits — read before taking real payments

**The game runs in the browser, not on a server.** The wallet is protected;
the *game* is not. `cash_out` can't verify that the number it's handed
actually happened at a table — it only checks the claim is within a
plausible range and rate-limits attempts. Someone able to forge network
messages could extract more than they won.

That's fine for play money. It is **not** fine once real payments are
involved. Before connecting a payment processor, the game engine needs to
move server-side (Supabase Edge Functions or a small Node service), so the
server deals the cards and reports the result — not the player's phone.

**Wallet-backed play is one signed-in human plus bots.** A wallet belongs
to one account, so pass-the-phone games and invite-link guests (who have no
account at all) stay free practice with throwaway chips. Extending real
stakes to multiplayer means every seat needs its own signed-in account.

**Lobby play needs the host's tab to stay open.** The host's device is the
table. That's the tradeoff for having no game server.
