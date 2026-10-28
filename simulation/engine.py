"""
quartercard rules engine -- a faithful Python port of the shipped game.

Every rule here mirrors js/app.js (the browser game) line for line, so that
what the simulator measures is the game people actually play:

  * one 52-card deck, freshly shuffled each hand
  * aces count 1 or 11, chosen automatically: the hand is read as whichever
    total sits closest to 25 (ties go to the lower total); a hand is only
    bust if even its lowest reading is over 25
  * two cards each, THEN the ante; two rounds of turns in seat order;
    at most four cards taken per hand, each costing the hit fee
  * every card taken opens a call window on that player; anyone still in
    the hand who can cover call + penalty may throw a chip in, all at once
  * correct call  -> callers split (accused's contribution + call fee) out of
                     the pot; the accused is out of the hand
  * wrong call    -> callers split paying (call fee + penalty) to the accused,
                     the hand dies on the spot and the pot carries over
  * showdown      -> closest to 25 wins; equal distance splits (24 ties 26)
  * a player who cannot cover the ante is eliminated

Chips are conserved by construction: they only ever move between players and
the pot. play_hand() asserts that invariant after every hand.
"""

TARGET = 25
MAX_HITS = 4


class Stakes:
    __slots__ = ("name", "ante", "hit", "call", "pen", "bank")

    def __init__(self, name, ante, hit, call, pen, bank):
        self.name, self.ante, self.hit = name, ante, hit
        self.call, self.pen, self.bank = call, pen, bank


# js/app.js:62 -- the three stake tiers exactly as shipped.
STAKES = {
    "low":    Stakes("Low",    ante=10, hit=2,  call=5,  pen=7,  bank=200),
    "middle": Stakes("Middle", ante=20, hit=4,  call=10, pen=14, bank=400),
    "high":   Stakes("High",   ante=50, hit=10, call=25, pen=35, bank=1000),
}

# Cards are ints 0..51; rank = c % 13 with 0 = ace, 9..12 = 10/J/Q/K.
BASE = tuple(1 if c % 13 == 0 else (10 if c % 13 >= 9 else c % 13 + 1) for c in range(52))
IS_ACE = tuple(c % 13 == 0 for c in range(52))


def best_total(base, aces):
    """Total closest to 25 over every ace reading; ties keep the lower one."""
    best, bd, t = base, abs(base - TARGET), base
    for _ in range(aces):
        t += 10
        d = abs(t - TARGET)
        if d < bd:
            best, bd = t, d
    return best


def distance(base, aces):
    return abs(best_total(base, aces) - TARGET)


def is_bust(base):
    # `base` already counts every ace as 1, i.e. it is the lowest reading.
    return base > TARGET


class Player:
    __slots__ = ("seat", "strategy", "chips", "base", "aces", "hits",
                 "contributed", "in_hand", "out", "eliminated", "nerve")

    def __init__(self, seat, strategy, chips):
        self.seat, self.strategy, self.chips = seat, strategy, chips
        self.base = self.aces = self.hits = self.contributed = 0
        self.in_hand = self.out = self.eliminated = False
        self.nerve = None

    def take(self, card):
        self.base += BASE[card]
        if IS_ACE[card]:
            self.aces += 1

    @property
    def best(self):
        return best_total(self.base, self.aces)


class Table:
    __slots__ = ("players", "stakes", "pot", "total", "rng", "hand_no")

    def __init__(self, strategies, stakes, bank, rng):
        self.players = [Player(i, s, bank) for i, s in enumerate(strategies)]
        self.stakes, self.pot, self.rng, self.hand_no = stakes, 0, rng, 0
        self.total = bank * len(strategies)        # chips in existence at this table


# Hand outcomes
SHOWDOWN, DEAD, GAME_OVER = "showdown", "dead", "game_over"


class Recorder:
    """Collects what the experiments need, without the engine knowing why."""

    def __init__(self):
        self.windows = []        # (hits, was_bust) for every call window
        self.calls = []          # (caller_strategy, hits, correct, net_to_caller)

    def window(self, hitter, bust):
        self.windows.append((hitter.hits, bust))

    def call(self, caller, hitter, correct, net):
        self.calls.append((caller.strategy.name, hitter.hits, correct, net))


def _call_window(t, hitter, live, rec):
    S = t.stakes
    bust = is_bust(hitter.base)
    if rec is not None:
        rec.window(hitter, bust)
    need = S.call + S.pen
    eligible = [q for q in live
                if q is not hitter and q.in_hand and not q.out and q.chips >= need]
    if not eligible:
        return None
    # Everyone decides at the same moment; nobody sees another chip first.
    chosen = [q for q in eligible if q.strategy.wants_call(q, hitter, t)]
    if not chosen:
        return None
    n = len(chosen)
    if bust:
        take = min(t.pot, hitter.contributed + S.call)   # their stake + the bonus
        t.pot -= take
        share, rem = divmod(take, n)
        for i, q in enumerate(chosen):
            got = share + (1 if i < rem else 0)
            q.chips += got
            if rec is not None:
                rec.call(q, hitter, True, got)
        hitter.out = True
        hitter.in_hand = False
        return True
    cost = S.call + S.pen
    share, rem = divmod(cost, n)
    for i, q in enumerate(chosen):
        paid = share + (1 if i < rem else 0)
        q.chips -= paid
        if rec is not None:
            rec.call(q, hitter, False, -paid)
    hitter.chips += cost
    return False


def _showdown(t, live):
    contenders = [q for q in live if q.in_hand and not q.out]
    if not contenders:                       # everybody called out: pot carries
        return []
    dists = [distance(q.base, q.aces) for q in contenders]
    best = min(dists)
    winners = [q for q, d in zip(contenders, dists) if d == best]
    share, rem = divmod(t.pot, len(winners))
    for i, q in enumerate(winners):
        q.chips += share + (1 if i < rem else 0)
    t.pot = 0
    return winners


def play_hand(t, rec=None):
    """Play one hand. Returns (outcome, winners)."""
    S = t.stakes
    for p in t.players:
        if not p.eliminated and p.chips < S.ante:
            p.eliminated = True
    live = [p for p in t.players if not p.eliminated]
    if len(live) < 2:
        return GAME_OVER, live

    t.hand_no += 1
    deck = list(range(52))
    t.rng.shuffle(deck)
    pos = 0
    for p in live:
        p.base = p.aces = p.hits = p.contributed = 0
        p.in_hand, p.out = True, False
        p.strategy.new_hand(p, t)
    for _ in range(2):                       # two cards each, round the table
        for p in live:
            p.take(deck[pos]); pos += 1
    for p in live:                           # antes AFTER the cards are dealt
        p.chips -= S.ante
        p.contributed += S.ante
        t.pot += S.ante

    outcome, winners = None, []
    for _round in (1, 2):
        for p in live:
            if not p.in_hand or p.out or p.hits >= MAX_HITS:
                continue
            while p.hits < MAX_HITS and p.chips >= S.hit and p.strategy.wants_hit(p, t):
                p.chips -= S.hit
                p.contributed += S.hit
                t.pot += S.hit
                p.take(deck[pos]); pos += 1
                p.hits += 1
                result = _call_window(t, p, live, rec)
                if result is False:          # wrong call: the hand dies, pot carries
                    outcome = DEAD
                    break
                if result is True:           # correct call: accused is out
                    if sum(1 for q in live if q.in_hand and not q.out) <= 1:
                        outcome = SHOWDOWN
                    break
            if outcome:
                break
        if outcome:
            break

    if outcome != DEAD:
        outcome = SHOWDOWN
        winners = _showdown(t, live)

    # The economy's one invariant: chips are never created or destroyed.
    assert sum(p.chips for p in t.players) + t.pot == t.total, "chip conservation violated"
    return outcome, winners
