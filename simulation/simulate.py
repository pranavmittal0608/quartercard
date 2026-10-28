#!/usr/bin/env python3
"""
quartercard Monte Carlo simulator.

    python3 simulate.py                  # full run (2,000,000+ hands)
    python3 simulate.py --quick          # ~2% size smoke test
    python3 simulate.py --hands 5000000  # bigger main league

Standard library only. Every game draws its own seeded RNG, so results are
identical for a given --seed no matter how many worker processes run them.

Every hand is played under the shipped rules (engine.py) with the shipped
Low stakes: 200-chip starting stacks, ante 10, hit 2, call 5, penalty 7.
Each simulated game is a complete game: four seats, play until one player
is left.

Experiments
  0  calibration   how often a player is really over 25 when the call
                   window opens on their k-th card, in this field. The
                   Analyst strategy calls off these measured numbers.
  1  league        eight strategies at random four-seat tables, 1,000,000+
                   hands: win rate and expected value per strategy
  2  call EV       what calling on each card is worth at penalties 5 / 7 / 10
                   -- the experiment behind the shipped penalty of 7
  3  threshold     where to stop: one player standing on 17..25 against
                   the league, 100,000+ hands per setting
"""

import argparse
import json
import math
import os
import random
import sys
import time
from multiprocessing import Pool

from engine import STAKES, MAX_HITS, Table, play_hand, DEAD, GAME_OVER
import strategies as S

SEATS = 4
MAX_GAME_HANDS = 5000        # safety cap; a real game ends long before this
BATCH = 500                  # games launched per batch (40 with --quick)
PENALTIES = (5, 7, 10)


# ------------------------------------------------------------------ recorder

class Tally:
    """Aggregating recorder: counts instead of lists, so millions of hands stay small."""

    def __init__(self):
        self.win_n = [0] * (MAX_HITS + 1)       # call windows opened on card k
        self.win_bust = [0] * (MAX_HITS + 1)    # ...where the player was over 25
        self.calls = {}                         # strategy -> [n, correct, net]
        self.calls_by_k = [[0, 0, 0] for _ in range(MAX_HITS + 1)]

    def window(self, hitter, bust):
        self.win_n[hitter.hits] += 1
        if bust:
            self.win_bust[hitter.hits] += 1

    def call(self, caller, hitter, correct, net):
        c = self.calls.setdefault(caller.strategy.name, [0, 0, 0])
        c[0] += 1; c[1] += correct; c[2] += net
        k = self.calls_by_k[hitter.hits]
        k[0] += 1; k[1] += correct; k[2] += net


# ------------------------------------------------------------- the roster

ROSTER = None   # built once per worker process


def _init(odds_table, calibrated):
    global ROSTER
    ROSTER = {"odds": odds_table, "cal": calibrated,
              "league": S.league(odds_table, calibrated)}


def _rng(seed, exp, i):
    return random.Random(f"{seed}:{exp}:{i}")


# ---------------------------------------------------------------- sessions

def game_session(args):
    """
    One complete game exactly as shipped: four seats, everyone starts on the
    Low bank (200 chips), anyone who cannot cover the ante is eliminated, and
    play continues until one player is left. Any pot still carried at the end
    is credited to the survivor, so every game is exactly zero-sum.
    """
    seed, exp, i, hero = args
    rng = _rng(seed, exp, i)
    league = ROSTER["league"]
    if hero is None:
        picks = rng.sample(league, SEATS)
    else:
        hero_strat = S.Threshold(f"Stand {hero}", hero, "ev", "", bust_table=ROSTER["cal"])
        picks = [hero_strat] + rng.sample(league, SEATS - 1)
        rng.shuffle(picks)
    st = STAKES["low"]
    t = Table(picks, st, st.bank, rng)
    tally = Tally()
    played = [0] * SEATS
    potwins = [0.0] * SEATS
    showdowns = dead = splits = mirror = 0
    streak = max_streak = max_pot = 0
    capped = False
    while True:
        live_before = [p.seat for p in t.players if not p.eliminated and p.chips >= st.ante]
        outcome, winners = play_hand(t, tally)
        if outcome == GAME_OVER:
            break
        for s in live_before:
            played[s] += 1
        max_pot = max(max_pot, t.pot)
        if outcome == DEAD:
            dead += 1
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
            if winners:
                showdowns += 1
                for w in winners:
                    potwins[w.seat] += 1.0 / len(winners)
                if len(winners) > 1:
                    splits += 1
                    tots = {w.best for w in winners}
                    if any(x < 25 for x in tots) and any(x > 25 for x in tots):
                        mirror += 1
        if t.hand_no >= MAX_GAME_HANDS:
            capped = True
            break
    live = [p for p in t.players if not p.eliminated]
    survivor = max(live or t.players, key=lambda p: (p.chips, -p.seat))
    survivor.chips += t.pot                 # the carried pot has nobody else to go to
    t.pot = 0
    nets = [p.chips - st.bank for p in t.players]
    assert sum(nets) == 0, "game is not zero-sum"
    return {
        "names": [p.strategy.name for p in t.players],
        "winner": survivor.strategy.name, "capped": capped,
        "nets": nets, "played": played, "hands": t.hand_no, "potwins": potwins,
        "showdowns": showdowns, "dead": dead, "splits": splits, "mirror": mirror,
        "max_streak": max_streak, "max_pot": max_pot,
        "win_n": tally.win_n, "win_bust": tally.win_bust,
        "calls": tally.calls, "calls_by_k": tally.calls_by_k,
    }


def run_games(pool, seed, exp, target_hands, hero=None, log=None, batch=BATCH):
    """Launch games in fixed-size batches, in index order, until at least
    target_hands have been played. Deterministic for a given seed."""
    out, hands, i = [], 0, 0
    while hands < target_hands:
        jobs = [(seed, exp, j, hero) for j in range(i, i + batch)]
        res = list(pool.imap(game_session, jobs, chunksize=8))
        out.extend(res)
        hands += sum(r["hands"] for r in res)
        i += batch
        if log:
            log(f"    {exp}: {len(out):,} games, {hands:,} hands")
    return out


# ---------------------------------------------------------------- statistics

def ratio_ci(nets, hands):
    """EV per hand with a 95% CI, by batch means over independent games."""
    pairs = [(x, h) for x, h in zip(nets, hands) if h > 0]
    n = len(pairs)
    H = sum(h for _, h in pairs)
    R = sum(x for x, _ in pairs) / H
    hbar = H / n
    ss = sum((x - R * h) ** 2 for x, h in pairs)
    se = math.sqrt(ss / (n * (n - 1))) / hbar
    return R, 1.96 * se


def prop_ci(k, n):
    p = k / n
    return p, 1.96 * math.sqrt(p * (1 - p) / n)


def summarise(results):
    per = {}
    meta = {"games": len(results), "hands": 0, "showdowns": 0, "dead": 0,
            "splits": 0, "mirror_splits": 0, "capped": 0,
            "max_dead_streak": 0, "max_pot": 0,
            "win_n": [0] * (MAX_HITS + 1), "win_bust": [0] * (MAX_HITS + 1),
            "calls_by_k": [[0, 0, 0] for _ in range(MAX_HITS + 1)]}
    for r in results:
        for key in ("hands", "showdowns", "dead"):
            meta[key] += r[key]
        meta["splits"] += r["splits"]; meta["mirror_splits"] += r["mirror"]
        meta["capped"] += r["capped"]
        meta["max_dead_streak"] = max(meta["max_dead_streak"], r["max_streak"])
        meta["max_pot"] = max(meta["max_pot"], r["max_pot"])
        for k in range(MAX_HITS + 1):
            meta["win_n"][k] += r["win_n"][k]; meta["win_bust"][k] += r["win_bust"][k]
            for j in range(3):
                meta["calls_by_k"][k][j] += r["calls_by_k"][k][j]
        for seat, name in enumerate(r["names"]):
            d = per.setdefault(name, {"nets": [], "played": [], "potwins": 0.0,
                                      "games": 0, "wins": 0, "calls": [0, 0, 0]})
            d["nets"].append(r["nets"][seat]); d["played"].append(r["played"][seat])
            d["potwins"] += r["potwins"][seat]
            d["games"] += 1
        per[r["winner"]]["wins"] += 1
        for name, c in r["calls"].items():
            for j in range(3):
                per[name]["calls"][j] += c[j]
    out = {}
    for name, d in per.items():
        H = sum(d["played"])
        ev, ci = ratio_ci(d["nets"], d["played"])
        wr, wci = prop_ci(d["wins"], d["games"])
        n_calls, correct, call_net = d["calls"]
        out[name] = {
            "games": d["games"], "hands": H,
            "ev_per_hand": ev, "ev_ci95": ci,
            "win_rate": wr, "win_ci95": wci,
            "pot_win_rate": d["potwins"] / H,
            "calls_per_hand": n_calls / H,
            "call_accuracy": (correct / n_calls) if n_calls else None,
            "call_net_per_hand": call_net / H,
        }
    return out, meta


# ---------------------------------------------------------------- reporting

def bust_table_from(meta):
    return {k: meta["win_bust"][k] / meta["win_n"][k] for k in range(1, MAX_HITS + 1)}


def call_ev_rows(meta):
    st = STAKES["low"]
    total_windows = sum(meta["win_n"][1:])
    rows = []
    for k in range(1, MAX_HITS + 1):
        p = meta["win_bust"][k] / meta["win_n"][k]
        win = st.ante + st.hit * k + st.call            # their stake + the bonus
        row = {"card": k, "windows": meta["win_n"][k],
               "window_share": meta["win_n"][k] / total_windows, "p_over_25": p}
        for pen in PENALTIES:
            row[f"ev_pen{pen}"] = p * win - (1 - p) * (st.call + pen)
        n, correct, net = meta["calls_by_k"][k]
        row["calls_made"] = n
        row["realised_ev_per_call"] = (net / n) if n else None
        rows.append(row)
    return rows


def fmt(x, nd=2):
    return "—" if x is None else f"{x:+.{nd}f}".replace("-", "−")


def pct(x, nd=1):
    return "—" if x is None else f"{100 * x:.{nd}f}%"


def write_markdown(R, path):
    L = R["league"]
    order = sorted(L, key=lambda n: -L[n]["ev_per_hand"])
    info = R["strategy_info"]
    m = R["league_meta"]
    st = R["stakes"]
    lines = []
    w = lines.append
    w("# Simulation results\n")
    w(f"Produced by `python3 simulate.py --seed {R['seed']}`. "
      f"**{R['total_hands']:,} hands simulated** in total, "
      f"{m['hands']:,} of them in the main league ({m['games']:,} complete games). "
      f"Every game is played under the shipped rules at Low stakes — {st['bank']}-chip stacks, "
      f"ante {st['ante']}, hit {st['hit']}, call {st['call']}, wrong-call penalty {st['pen']} — "
      f"four seats, until one player is left.\n")

    w("## 1. Strategy league — win rate and expected value\n")
    w("**EV** is chips won per hand played, with a 95% confidence interval from batch means "
      "over independent games. **Win rate** is the share of games the strategy wins outright — "
      "25% is break-even at a four-seat table. **Pot win rate** is the share of hands in which it "
      "took the pot (split pots counted fractionally).\n")
    w("| Strategy | Type | EV / hand | Win rate | Pot win rate | Calls / hand | Call accuracy |")
    w("|---|---|---|---|---|---|---|")
    for n in order:
        d = L[n]
        w(f"| **{n}** | {info[n]['kind']} | {fmt(d['ev_per_hand'])} ± {d['ev_ci95']:.2f} | "
          f"{pct(d['win_rate'])} ± {100 * d['win_ci95']:.1f} | {pct(d['pot_win_rate'])} | "
          f"{d['calls_per_hand']:.3f} | {pct(d['call_accuracy'])} |")
    w("")
    w("| Strategy | How it plays |")
    w("|---|---|")
    for n in order:
        w(f"| {n} | {info[n]['summary']} |")
    w("")

    w("## 2. What a call is worth, card by card\n")
    w("When the call window opens on a player's k-th card: how often they are really over 25 "
      "in this field, and the expected value of one call at three penalty levels. The shipped "
      "penalty is 7 — chosen so a call on the second card is slightly negative, a read rather "
      "than a formula.\n")
    w("| Card | Share of windows | Actually over 25 | EV, penalty 5 | EV, penalty 7 (shipped) | EV, penalty 10 | Realised EV per call made |")
    w("|---|---|---|---|---|---|---|")
    for r in R["call_ev"]:
        w(f"| {r['card']} | {pct(r['window_share'])} | {pct(r['p_over_25'])} | "
          f"{fmt(r['ev_pen5'])} | **{fmt(r['ev_pen7'])}** | {fmt(r['ev_pen10'])} | "
          f"{fmt(r['realised_ev_per_call'])} |")
    w("")
    w("_Realised EV is what the league's callers actually made per call at penalty 7, "
      "including split calls and the pot cap._\n")

    w("## 3. Where to stop\n")
    w("One player standing on each total, calling only at +EV, against three random "
      "opponents from the league.\n")
    w("| Stand on | EV / hand | Win rate |")
    w("|---|---|---|")
    best = max(R["threshold"], key=lambda r: r["ev_per_hand"])
    for r in R["threshold"]:
        tag = " ← best" if r is best else ""
        w(f"| {r['stand']} | {fmt(r['ev_per_hand'])} ± {r['ev_ci95']:.2f}{tag} | "
          f"{pct(r['win_rate'])} ± {100 * r['win_ci95']:.1f} |")
    w("")

    w("## 4. Shape of the game\n")
    w(f"- Hands reaching showdown: {pct(m['showdowns'] / m['hands'])}. Hands killed by a wrong "
      f"call, pot carried over: {pct(m['dead'] / m['hands'])}.")
    w(f"- Showdowns ending in a split: {pct(m['splits'] / max(1, m['showdowns']))}, of which "
      f"mirror ties such as 24 v 26: {pct(m['mirror_splits'] / max(1, m['splits']))}.")
    w(f"- Average game length: {m['hands'] / m['games']:.0f} hands. Longest run of consecutive "
      f"dead hands in any game: {m['max_dead_streak']}. Largest carried pot: {m['max_pot']} chips.")
    w(f"- Games hitting the {MAX_GAME_HANDS:,}-hand safety cap: {m['capped']}.")
    w(f"- **Chip conservation was asserted after every one of the {R['total_hands']:,} hands, "
      f"and every game was verified exactly zero-sum.** Chips only ever moved between players.")
    w("")
    w(f"_Run time {R['seconds']:.0f}s on {R['workers']} worker process(es), Python {R['python']}._\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hands", type=int, default=1_000_000,
                    help="minimum hands in the main league (default 1,000,000)")
    ap.add_argument("--seed", default="2026", help="master seed (default 2026)")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--quick", action="store_true", help="~2%% size smoke test")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"))
    a = ap.parse_args(argv)

    scale = 0.02 if a.quick else 1.0
    batch = 40 if a.quick else BATCH
    league_target = int(a.hands * scale)
    cal_target = int(100_000 * scale)
    sweep_target = int(100_000 * scale)
    thresholds = list(range(17, 26))
    log = lambda *x: print(*x, file=sys.stderr, flush=True)

    t0 = time.time()
    odds = S.odds_player_table(random.Random(f"{a.seed}:odds"), 200_000)
    total = 0

    # 0. calibration: the Analyst starts from the in-game odds table, then we measure
    log("[0] calibration")
    with Pool(a.workers, initializer=_init, initargs=(odds, odds)) as pool:
        cal_res = run_games(pool, a.seed, "cal", cal_target, log=log, batch=batch)
    _, cal_meta = summarise(cal_res)
    total += cal_meta["hands"]
    calibrated = bust_table_from(cal_meta)

    with Pool(a.workers, initializer=_init, initargs=(odds, calibrated)) as pool:
        log("[1] league")
        league, meta = summarise(run_games(pool, a.seed, "league", league_target, log=log, batch=batch))
        total += meta["hands"]

        log("[3] threshold sweep")
        sweep = []
        for T in thresholds:
            summ, m = summarise(run_games(pool, a.seed, f"stand{T}", sweep_target, hero=T, batch=batch))
            total += m["hands"]
            h = summ[f"Stand {T}"]
            sweep.append({"stand": T, "ev_per_hand": h["ev_per_hand"], "ev_ci95": h["ev_ci95"],
                          "win_rate": h["win_rate"], "win_ci95": h["win_ci95"],
                          "hands": h["hands"], "games": h["games"]})
            log(f"    stand {T}: {fmt(h['ev_per_hand'])}/hand over {m['hands']:,} hands")

    st = STAKES["low"]
    R = {
        "seed": a.seed, "workers": a.workers, "python": sys.version.split()[0],
        "seconds": time.time() - t0, "total_hands": total,
        "stakes": {"ante": st.ante, "hit": st.hit, "call": st.call, "pen": st.pen, "bank": st.bank},
        "odds_player_table": odds, "calibrated_bust_table": calibrated,
        "calibration_hands": cal_meta["hands"],
        "strategy_info": {s.name: {"kind": s.kind, "summary": s.summary}
                          for s in S.league(odds, calibrated)},
        "league": league, "league_meta": meta,
        "call_ev": call_ev_rows(meta),
        "threshold": sweep,
    }
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "results.json"), "w", encoding="utf-8") as f:
        json.dump(R, f, indent=2)
    write_markdown(R, os.path.join(a.out, "results.md"))
    log(f"done: {total:,} hands in {R['seconds']:.0f}s -> {a.out}")


if __name__ == "__main__":
    main()
