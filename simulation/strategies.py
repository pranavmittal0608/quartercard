"""
Playing strategies.

Two families:

  * The three in-game bots, ported line for line from js/app.js
    (Guesser = Easy, Rule Player = Medium, Odds Player = Hard), including
    their blunder model: a bot only ever misplays a decision that was
    already close, at a fixed rate per level.

  * Archetypes that isolate one idea each -- how far to push, and when to
    call -- so their results can be read as the value of that idea.

Every strategy answers two questions, using only information a real player
at the table has: its own cards, the pot, and how many cards the player in
the call window has taken. Nobody ever sees a hidden hand.
"""

from engine import MAX_HITS, TARGET, best_total, is_bust


def clamp_hits(h):
    return min(MAX_HITS, max(1, h))


def call_ev(p_bust, hitter, t):
    """Chips a single caller expects to make by calling right now."""
    S = t.stakes
    win = min(t.pot, hitter.contributed + S.call)   # their stake + the bonus
    lose = S.call + S.pen
    return p_bust * win - (1 - p_bust) * lose


class Strategy:
    name = "base"
    kind = "archetype"
    summary = ""

    def new_hand(self, me, t):
        pass

    def wants_hit(self, me, t):
        raise NotImplementedError

    def wants_call(self, me, hitter, t):
        raise NotImplementedError


# ---------------------------------------------------------------- archetypes

class Threshold(Strategy):
    """Take cards while below `stand`; call according to `call_rule`."""

    def __init__(self, name, stand, call_rule, summary, bust_table=None):
        self.name, self.stand, self.call_rule = name, stand, call_rule
        self.summary, self.bust_table = summary, bust_table

    def wants_hit(self, me, t):
        return best_total(me.base, me.aces) < self.stand

    def wants_call(self, me, hitter, t):
        r = self.call_rule
        if r == "never":
            return False
        if r == "always":
            return True
        if r == "from2":
            return hitter.hits >= 2
        if r == "ev":
            p = self.bust_table[clamp_hits(hitter.hits)]
            return call_ev(p, hitter, t) > 0
        raise ValueError(r)


# ---------------------------------------------------------- the in-game bots

BLUNDER_RATE = {1: 0.15, 2: 0.08, 3: 0.03, 4: 0.0}    # js/app.js:632


def maybe_blunder(rng, level, margin, close, choice):
    """js/app.js maybeBlunder: flip only a decision that was nearly a coin toss."""
    rate = BLUNDER_RATE[level]
    if rate == 0 or abs(margin) > close:
        return choice
    return (not choice) if rng.random() < rate else choice


class Guesser(Strategy):
    """Level 1 (Easy): picks a nerve each hand; suspicion grows with the pile."""
    name, kind = "Guesser", "in-game bot"
    summary = "In-game Easy bot: random nerve 19-24 each hand, uncalibrated suspicion"
    FEEL = {1: 0.07, 2: 0.24, 3: 0.44, 4: 0.58}

    def new_hand(self, me, t):
        me.nerve = 19 + t.rng.randrange(6)

    def wants_hit(self, me, t):
        best = best_total(me.base, me.aces)
        return maybe_blunder(t.rng, 1, best - me.nerve, 1.5, best < me.nerve)

    def wants_call(self, me, hitter, t):
        return t.rng.random() < self.FEEL[clamp_hits(hitter.hits)]


class RulePlayer(Strategy):
    """Level 2 (Medium): stop at 21; three cards is a lot of cards."""
    name, kind = "Rule Player", "in-game bot"
    summary = "In-game Medium bot: stands on 21, calls from the 3rd card"

    def wants_hit(self, me, t):
        best = best_total(me.base, me.aces)
        return maybe_blunder(t.rng, 2, best - 21, 1.5, best < 21)

    def wants_call(self, me, hitter, t):
        h = clamp_hits(hitter.hits)
        return maybe_blunder(t.rng, 2, h - 2.5, 0.6, h >= 3)


class OddsPlayer(Strategy):
    """Level 3 (Hard): stands on 22; calls on exact EV from a static bust table."""
    name, kind = "Odds Player", "in-game bot"
    summary = "In-game Hard bot: stands on 22, calls when its static odds table says EV > 0"

    def __init__(self, bust_table):
        self.bust_table = bust_table

    def wants_hit(self, me, t):
        best = best_total(me.base, me.aces)
        return maybe_blunder(t.rng, 3, best - 22, 1.2, best < 22)

    def wants_call(self, me, hitter, t):
        ev = call_ev(self.bust_table[clamp_hits(hitter.hits)], hitter, t)
        return maybe_blunder(t.rng, 3, ev, 2.5, ev > 0)


def odds_player_table(rng, samples=200_000):
    """
    Port of js/app.js buildOdds()/playOut(): the bust-by-hits table the
    in-game Odds Player and the landing-page trainer are built on. It models
    a plausible opponent who stops somewhere in 20-23 and spreads cards
    across both rounds, and measures how often they are over 25 at a random
    one of their call windows.
    """
    tally = {k: [0, 0] for k in range(1, MAX_HITS + 1)}
    from engine import BASE, IS_ACE
    for _ in range(samples):
        draw = rng.sample(range(52), 6)
        base = BASE[draw[0]] + BASE[draw[1]]
        aces = IS_ACE[draw[0]] + IS_ACE[draw[1]]
        nerve = 20 + rng.randrange(4)
        hits = 0
        prefix = [(base, aces)]
        for rnd in (1, 2):
            if hits >= MAX_HITS:
                break
            took = 0
            while hits < MAX_HITS:
                if best_total(base, aces) >= nerve:
                    break
                if took > 0 and rng.random() < 0.45:
                    break
                c = draw[2 + hits]
                base += BASE[c]; aces += IS_ACE[c]
                hits += 1; took += 1
                prefix.append((base, aces))
                if rng.random() < 0.12:
                    break
            if hits == 0 and rnd == 2:
                c = draw[2]
                base += BASE[c]; aces += IS_ACE[c]
                hits += 1
                prefix.append((base, aces))
        if hits == 0:
            c = draw[2]
            base += BASE[c]; aces += IS_ACE[c]
            hits = 1
            prefix.append((base, aces))
        at = 1 + rng.randrange(hits)
        t = tally[at]
        t[1] += 1
        if is_bust(prefix[at][0]):
            t[0] += 1
    return {k: (v[0] / v[1] if v[1] else 0.0) for k, v in tally.items()}


# ---------------------------------------------------------------- the roster

def league(odds_table, calibrated_table):
    """The eight strategies that meet each other in the main experiment."""
    return [
        Threshold("Rock", 19, "never",
                  "Stands on 19, never calls — plays not to lose"),
        Threshold("Silent Pro", 23, "never",
                  "Stands on 23 (the measured optimum), never calls"),
        Threshold("Analyst", 23, "ev",
                  "Stands on 23, calls only when calling is +EV (calibrated odds)",
                  bust_table=calibrated_table),
        Threshold("Sheriff", 22, "always",
                  "Stands on 22, calls every single card anyone takes"),
        Threshold("Maniac", TARGET, "from2",
                  "Pushes all the way to 25, calls anyone on their 2nd card or later"),
        Guesser(),
        RulePlayer(),
        OddsPlayer(odds_table),
    ]
