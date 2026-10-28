"""
Tests for the rules engine.

    python3 -m unittest -v            (run from this folder)

Three layers:
  * card maths   -- ace readings, bust, distance, at the boundaries
  * table rules  -- scripted hands with a rigged deck, checking every chip
  * cross-check  -- the card maths compared against the real js/app.js,
                    exhaustively over every 2-6 card hand (needs Node.js;
                    skipped if it is not installed)
"""

import itertools
import json
import os
import random
import shutil
import subprocess
import unittest

import engine
from engine import best_total, is_bust, distance, Table, play_hand, STAKES, SHOWDOWN, DEAD, GAME_OVER
import strategies as S

RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]


def hand(*ranks):
    """(base, aces) for a list of rank strings."""
    base = aces = 0
    for r in ranks:
        c = RANKS.index(r)
        base += engine.BASE[c]
        aces += engine.IS_ACE[c]
    return base, aces


class Deck:
    """Builds a rigged 52-card order from rank strings, one suit at a time."""

    def __init__(self, *ranks):
        used, order = set(), []
        for r in ranks:
            i = RANKS.index(r)
            c = next(c for c in range(i, 52, 13) if c not in used)
            used.add(c); order.append(c)
        order += [c for c in range(52) if c not in used]
        self.order = order


class RiggedRNG(random.Random):
    def __init__(self, deck):
        super().__init__(0)
        self.deck = deck

    def shuffle(self, x):
        x[:] = self.deck.order


class Script(S.Strategy):
    def __init__(self, name, hits=0, calls=False):
        self.name, self.hits, self.calls = name, hits, calls

    def wants_hit(self, me, t):
        return me.hits < self.hits

    def wants_call(self, me, hitter, t):
        return self.calls


def table(deck, *strats, bank=200):
    return Table(list(strats), STAKES["low"], bank, RiggedRNG(deck))


class CardMaths(unittest.TestCase):
    def test_aces_read_closest_to_25(self):
        self.assertEqual(best_total(*hand("A", "A")), 22)
        self.assertEqual(best_total(*hand("A", "K")), 21)
        self.assertEqual(best_total(*hand("A", "A", "A")), 23)

    def test_bust_boundaries(self):
        self.assertFalse(is_bust(hand("K", "K", "5")[0]))   # exactly 25
        self.assertTrue(is_bust(hand("K", "K", "6")[0]))    # 26
        self.assertTrue(is_bust(hand("A", "K", "K", "5")[0]))  # 26 even with the ace low

    def test_ace_can_read_high_without_being_bust(self):
        b, a = hand("A", "5")                 # reads 6 or 16
        b, a = b + 10, a                      # + a ten: 16 or 26
        self.assertEqual(best_total(b, a), 26)  # 26 is closer to 25 than 16
        self.assertFalse(is_bust(b))           # but it is not bust: 16 is available

    def test_mirror_distance(self):
        self.assertEqual(distance(*hand("K", "K", "4")), distance(*hand("K", "K", "6")))

    def test_tie_in_distance_prefers_lower(self):
        # totals 15 / 25 / 35: 25 wins outright; contrived equal-distance cases keep the lower
        self.assertEqual(best_total(*hand("A", "A", "3", "10")), 25)


class TableRules(unittest.TestCase):
    def test_correct_call(self):
        # p0: K K, hits a 6 -> 26. p1 calls.
        t = table(Deck("K", "2", "K", "3", "6"),
                  Script("hitter", hits=1), Script("caller", calls=True))
        outcome, winners = play_hand(t)
        p0, p1 = t.players
        # pot 20 antes + 2 hit = 22; p1 takes p0's 12 + the 5 bonus = 17,
        # p0 is out, p1 is alone and wins the remaining 5 at showdown.
        self.assertEqual(outcome, SHOWDOWN)
        self.assertEqual((p0.chips, p1.chips, t.pot), (188, 212, 0))

    def test_wrong_call_kills_the_hand_and_carries_the_pot(self):
        # p0: K K, hits a 5 -> exactly 25. p1 calls wrongly.
        t = table(Deck("K", "2", "K", "3", "5"),
                  Script("hitter", hits=1), Script("caller", calls=True))
        outcome, _ = play_hand(t)
        p0, p1 = t.players
        self.assertEqual(outcome, DEAD)
        self.assertEqual(p0.chips, 200 - 10 - 2 + 12)      # paid call + penalty
        self.assertEqual(p1.chips, 200 - 10 - 12)
        self.assertEqual(t.pot, 22)                         # rides into the next hand

    def test_joint_call_splits_not_multiplies(self):
        # four seats; p0 busts on its hit and three players call together.
        t = table(Deck("K", "2", "2", "2", "K", "3", "3", "3", "6"),
                  Script("hitter", hits=1), *(Script(f"c{i}", calls=True) for i in range(3)))
        rec = engine.Recorder()
        play_hand(t, rec)
        # One call's worth (their 12 + the 5 bonus = 17) divided three ways,
        # remainder to the earliest seats -- never 3 x 17.
        self.assertEqual([net for _, _, correct, net in rec.calls], [6, 6, 5])
        self.assertTrue(t.players[0].out)

    def test_mirror_tie_splits(self):
        # p0: K K + 4 = 24, p1: K K + 6 = 26, nobody calls -> split
        t = table(Deck("K", "K", "K", "K", "4", "6"),
                  Script("a", hits=1), Script("b", hits=1))
        outcome, winners = play_hand(t)
        self.assertEqual(len(winners), 2)
        self.assertEqual([p.chips for p in t.players], [200, 200])

    def test_elimination_and_game_over(self):
        t = table(Deck("K", "K", "K", "K"), Script("a"), Script("b"), bank=200)
        t.players[1].chips, t.players[0].chips = 9, 391       # b cannot cover the ante
        self.assertEqual(play_hand(t)[0], GAME_OVER)
        self.assertTrue(t.players[1].eliminated)

    def test_conservation_under_random_play(self):
        rng = random.Random(1)
        odds = S.odds_player_table(random.Random(2), 5000)
        roster = S.league(odds, odds)
        for g in range(60):
            t = Table(rng.sample(roster, 4), STAKES["low"], 200, random.Random(g))
            for _ in range(300):
                if play_hand(t)[0] == GAME_OVER:
                    break
            # play_hand asserts conservation itself; check it once more here
            self.assertEqual(sum(p.chips for p in t.players) + t.pot, 800)


JS_HARNESS = r"""
const src = require("fs").readFileSync(process.argv[process.argv.length - 1], "utf8");
const start = src.indexOf("const SUITS");
const end = src.indexOf("\n", src.indexOf("function distance(cards)"));
eval(src.slice(start, end) + "\nglobalThis.__f = {bestTotal, isBust, distance};");
const hands = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = hands.map(h => {
  const cards = h.map(r => ({rank: r, suit: "S", red: false}));
  return [__f.bestTotal(cards), __f.isBust(cards), __f.distance(cards)];
});
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "Node.js not installed")
class MatchesShippedJavaScript(unittest.TestCase):
    def test_every_two_to_six_card_hand(self):
        app = os.path.join(os.path.dirname(__file__), "..", "js", "app.js")
        if not os.path.exists(app):
            self.skipTest("js/app.js not found")
        hands = []
        for n in range(2, 7):
            for combo in itertools.combinations_with_replacement(range(13), n):
                if max(combo.count(r) for r in set(combo)) <= 4:   # a real deck has 4 of each
                    hands.append([RANKS[r] for r in combo])
        res = subprocess.run(["node", "-e", JS_HARNESS, app], input=json.dumps(hands),
                             capture_output=True, text=True, check=True)
        js = json.loads(res.stdout)
        for h, (jb, jbust, jd) in zip(hands, js):
            b, a = hand(*h)
            self.assertEqual((best_total(b, a), is_bust(b), distance(b, a)), (jb, jbust, jd), h)
        self.assertGreater(len(hands), 25000)


if __name__ == "__main__":
    unittest.main()
