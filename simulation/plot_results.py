#!/usr/bin/env python3
"""
Charts for the README, drawn from results/results.json.

    python3 plot_results.py        (needs matplotlib; the simulator itself does not)

Writes a light and a dark version of each chart so GitHub can serve the one
matching the reader's theme.
"""

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")

THEMES = {
    "light": dict(surface="#fcfcfb", ink="#0b0b0b", ink2="#52514e", muted="#898781",
                  grid="#e1e0d9", axis="#c3c2b7", pos="#2a78d6", neg="#e34948"),
    "dark":  dict(surface="#1a1a19", ink="#f0efec", ink2="#c3c2b7", muted="#898781",
                  grid="#2c2c2a", axis="#383835", pos="#3987e5", neg="#e66767"),
}


def style(ax, th):
    ax.set_facecolor(th["surface"])
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(th["axis"])
    ax.tick_params(colors=th["muted"], labelcolor=th["ink2"], length=0, labelsize=10)
    ax.grid(axis="x", color=th["grid"], linewidth=0.8)
    ax.set_axisbelow(True)


def header(fig, th, title, subtitle):
    fig.text(0.02, 0.955, title, ha="left", va="top", color=th["ink"], fontsize=14, fontweight="bold")
    fig.text(0.02, 0.885, subtitle, ha="left", va="top", color=th["ink2"], fontsize=10)


def strategy_chart(R, th, path):
    L = R["league"]
    names = sorted(L, key=lambda n: L[n]["ev_per_hand"])        # best at the top
    ev = [L[n]["ev_per_hand"] for n in names]
    ci = [L[n]["ev_ci95"] for n in names]
    kind = R["strategy_info"]
    labels = [f"{n}  ·  bot" if kind[n]["kind"] == "in-game bot" else n for n in names]

    fig, ax = plt.subplots(figsize=(8, 4.6), dpi=200)
    fig.patch.set_facecolor(th["surface"])
    style(ax, th)
    colors = [th["pos"] if v >= 0 else th["neg"] for v in ev]
    ax.barh(range(len(names)), ev, height=0.56, color=colors, zorder=2)
    ax.errorbar(ev, range(len(names)), xerr=ci, fmt="none", ecolor=th["ink2"],
                elinewidth=1.2, capsize=3, capthick=1.2, zorder=3)
    ax.axvline(0, color=th["axis"], linewidth=1, zorder=1)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(labels, color=th["ink"], fontsize=10.5)
    lo = min(e - c for e, c in zip(ev, ci)); hi = max(e + c for e, c in zip(ev, ci))
    pad = (hi - lo) * 0.14
    ax.set_xlim(lo - pad, hi + pad)
    for i, (v, c) in enumerate(zip(ev, ci)):
        x = v + c + pad * 0.12 if v >= 0 else v - c - pad * 0.12
        ax.text(x, i, f"{v:+.2f}".replace("-", "−"), va="center",
                ha="left" if v >= 0 else "right", color=th["ink"], fontsize=9.5)
    ax.set_xlabel("Expected value, chips per hand (95% CI)", color=th["ink2"], fontsize=10)
    header(fig, th, "Which strategy wins",
           f"{R['league_meta']['hands']:,} hands · {R['league_meta']['games']:,} complete games · shipped rules, Low stakes")
    fig.tight_layout(rect=(0, 0, 1, 0.85))
    fig.savefig(path, facecolor=th["surface"])
    plt.close(fig)


def threshold_chart(R, th, path):
    rows = R["threshold"]
    x = [r["stand"] for r in rows]
    y = [r["ev_per_hand"] for r in rows]
    c = [r["ev_ci95"] for r in rows]
    best = max(rows, key=lambda r: r["ev_per_hand"])

    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=200)
    fig.patch.set_facecolor(th["surface"])
    style(ax, th)
    ax.grid(axis="y", color=th["grid"], linewidth=0.8)
    ax.grid(axis="x", visible=False)
    ax.axhline(0, color=th["axis"], linewidth=1, zorder=1)
    ax.fill_between(x, [a - b for a, b in zip(y, c)], [a + b for a, b in zip(y, c)],
                    color=th["pos"], alpha=0.16, linewidth=0, zorder=2)
    ax.plot(x, y, color=th["pos"], linewidth=2, marker="o", markersize=6,
            markeredgecolor=th["surface"], markeredgewidth=1.5, zorder=3)
    ax.annotate(f"stand on {best['stand']}: {best['ev_per_hand']:+.2f} chips / hand",
                xy=(best["stand"], best["ev_per_hand"]),
                xytext=(17.6, best["ev_per_hand"] + 0.1),
                color=th["ink"], fontsize=10,
                arrowprops=dict(arrowstyle="-", color=th["ink2"], linewidth=1))
    ax.set_xticks(x)
    ax.set_xlabel("Stop taking cards at this total", color=th["ink2"], fontsize=10)
    ax.set_ylabel("Chips per hand", color=th["ink2"], fontsize=10)
    header(fig, th, "Where to stop",
           "One player at each threshold vs three random league opponents · band = 95% CI")
    fig.tight_layout(rect=(0, 0, 1, 0.85))
    fig.savefig(path, facecolor=th["surface"])
    plt.close(fig)


def main():
    with open(os.path.join(RES, "results.json"), encoding="utf-8") as f:
        R = json.load(f)
    for mode, th in THEMES.items():
        strategy_chart(R, th, os.path.join(RES, f"strategies-{mode}.png"))
        threshold_chart(R, th, os.path.join(RES, f"threshold-{mode}.png"))
    print("charts written to", RES)


if __name__ == "__main__":
    main()
