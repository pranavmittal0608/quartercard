# Simulation results

Produced by `python3 simulate.py --seed 2026`. **3,081,209 hands simulated** in total, 1,043,891 of them in the main league (2,500 complete games). Every game is played under the shipped rules at Low stakes — 200-chip stacks, ante 10, hit 2, call 5, wrong-call penalty 7 — four seats, until one player is left.

## 1. Strategy league — win rate and expected value

**EV** is chips won per hand played, with a 95% confidence interval from batch means over independent games. **Win rate** is the share of games the strategy wins outright — 25% is break-even at a four-seat table. **Pot win rate** is the share of hands in which it took the pot (split pots counted fractionally).

| Strategy | Type | EV / hand | Win rate | Pot win rate | Calls / hand | Call accuracy |
|---|---|---|---|---|---|---|
| **Analyst** | archetype | +0.62 ± 0.06 | 56.6% ± 2.8 | 42.5% | 0.127 | 54.6% |
| **Odds Player** | in-game bot | +0.60 ± 0.06 | 55.7% ± 2.7 | 42.7% | 0.157 | 54.3% |
| **Silent Pro** | archetype | +0.36 ± 0.06 | 43.9% ± 2.7 | 40.7% | 0.000 | — |
| **Rule Player** | in-game bot | +0.00 ± 0.06 | 25.0% ± 2.4 | 39.0% | 0.173 | 51.7% |
| **Guesser** | in-game bot | −1.05 ± 0.13 | 8.1% ± 1.5 | 30.1% | 0.256 | 34.2% |
| **Rock** | archetype | −2.07 ± 0.19 | 3.0% ± 0.9 | 22.9% | 0.000 | — |
| **Maniac** | archetype | −2.09 ± 0.20 | 3.1% ± 1.0 | 25.2% | 0.523 | 36.4% |
| **Sheriff** | archetype | −8.84 ± 1.16 | 5.1% ± 1.2 | 5.6% | 0.963 | 13.4% |

| Strategy | How it plays |
|---|---|
| Analyst | Stands on 23, calls only when calling is +EV (calibrated odds) |
| Odds Player | In-game Hard bot: stands on 22, calls when its static odds table says EV > 0 |
| Silent Pro | Stands on 23 (the measured optimum), never calls |
| Rule Player | In-game Medium bot: stands on 21, calls from the 3rd card |
| Guesser | In-game Easy bot: random nerve 19-24 each hand, uncalibrated suspicion |
| Rock | Stands on 19, never calls — plays not to lose |
| Maniac | Pushes all the way to 25, calls anyone on their 2nd card or later |
| Sheriff | Stands on 22, calls every single card anyone takes |

## 2. What a call is worth, card by card

When the call window opens on a player's k-th card: how often they are really over 25 in this field, and the expected value of one call at three penalty levels. The shipped penalty is 7 — chosen so a call on the second card is slightly negative, a read rather than a formula.

| Card | Share of windows | Actually over 25 | EV, penalty 5 | EV, penalty 7 (shipped) | EV, penalty 10 | Realised EV per call made |
|---|---|---|---|---|---|---|
| 1 | 60.9% | 14.2% | −6.17 | **−7.89** | −10.46 | −7.99 |
| 2 | 31.2% | 38.5% | +1.17 | **−0.06** | −1.90 | −0.39 |
| 3 | 7.5% | 55.5% | +7.20 | **+6.31** | +4.98 | +5.94 |
| 4 | 0.3% | 67.3% | +12.22 | **+11.56** | +10.58 | +11.98 |

_Realised EV is what the league's callers actually made per call at penalty 7, including split calls and the pot cap._

## 3. Where to stop

One player standing on each total, calling only at +EV, against three random opponents from the league.

| Stand on | EV / hand | Win rate |
|---|---|---|
| 17 | −3.19 ± 0.55 | 1.6% ± 1.1 |
| 18 | −2.37 ± 0.32 | 3.0% ± 1.5 |
| 19 | −1.14 ± 0.28 | 5.2% ± 1.9 |
| 20 | −0.70 ± 0.15 | 10.0% ± 2.6 |
| 21 | +0.06 ± 0.08 | 28.0% ± 3.9 |
| 22 | +0.44 ± 0.09 | 47.2% ± 4.4 |
| 23 | +0.53 ± 0.10 ← best | 51.8% ± 4.4 |
| 24 | −0.24 ± 0.09 | 16.0% ± 3.2 |
| 25 | −1.58 ± 0.20 | 4.0% ± 1.7 |

## 4. Shape of the game

- Hands reaching showdown: 84.0%. Hands killed by a wrong call, pot carried over: 16.0%.
- Showdowns ending in a split: 15.9%, of which mirror ties such as 24 v 26: 44.5%.
- Average game length: 418 hands. Longest run of consecutive dead hands in any game: 34. Largest carried pot: 748 chips.
- Games hitting the 5,000-hand safety cap: 0.
- **Chip conservation was asserted after every one of the 3,081,209 hands, and every game was verified exactly zero-sum.** Chips only ever moved between players.

_Run time 35s on 2 worker process(es), Python 3.13.18._
