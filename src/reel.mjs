/**
 * Select an actual Go match's watchable moments from the rules engine's
 * accepted semantic events. Production impact ranks dramaturgy, NOT Go
 * strength, win probability, score swing or a predicted optimal move.
 * The only input is the existing immutable Study projection. No rules,
 * invented commentary, remote inference or additional game history.
 * The output is reusable by replay, match feeds and audio/scene consumers.
 */
export function planReplayMoments(frames, { limit = 9 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new TypeError("Replay requires at least the admitted opening frame");
  }
  if (!Number.isSafeInteger(limit) || limit < 2 || limit > 30) {
    throw new RangeError("Replay highlight limit must be an integer from 2 to 30");
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]?.version !== i || !Array.isArray(frames[i]?.events)) {
      throw new TypeError("Replay frames must have contiguous accepted versions and engine events");
    }
  }

  function moment(frame) {
    let selection = {
      kind: "continuation", title: `Move ${frame.version} · recorded continuation`,
      impact: 0, holdMs: 950, cue: "ui-tap",
    };
    function promote(candidate) {
      if (candidate.impact > selection.impact) selection = candidate;
    }
    for (const event of frame.events) {
      const detail = event.detail ?? {};
      switch (event.type) {
        case "capture": {
          const stones = Number.isSafeInteger(detail.stonesCaptured) && detail.stonesCaptured > 0
            ? detail.stonesCaptured : 1;
          promote({ kind: "capture", title: `${stones} stone${stones === 1 ? "" : "s"} captured`,
            impact: 50 + Math.min(20, stones) * 4, holdMs: 1700, cue: "impact" });
          break;
        }
        case "ko-started":
          promote({ kind: "ko-started", title: "Ko fight begins",
            impact: 48, holdMs: 1650, cue: "riser" });
          break;
        case "ko-resolved":
          promote({ kind: "ko-resolved", title: "Ko point resolved",
            impact: 42, holdMs: 1400, cue: "whoosh" });
          break;
        case "atari-escaped":
          promote({ kind: "atari-escaped", title: "Group escapes atari",
            impact: 41, holdMs: 1450, cue: "success" });
          break;
        case "atari-given":
          promote({ kind: "atari-given", title: "A group is in atari",
            impact: 38, holdMs: 1350, cue: "riser" });
          break;
        case "group-killed":
          promote({ kind: "group-killed", title: "Group captured",
            impact: 35, holdMs: 1450, cue: "impact" });
          break;
        case "connection":
          promote({ kind: "connection", title: "Two groups connect",
            impact: 19, holdMs: 1200, cue: "success" });
          break;
        case "eye-formed":
          promote({ kind: "eye-formed", title: "Eye shape formed",
            impact: 15, holdMs: 1200, cue: "chime" });
          break;
        case "game-ended":
          promote({ kind: "game-ended", title: "Two passes end play",
            impact: 90, holdMs: 1700, cue: "chime" });
          break;
        default:
          break;
      }
    }
    if (frame.command?.kind === "resign") {
      promote({ kind: "resignation", title: "Resignation",
        impact: 90, holdMs: 1700, cue: "chime" });
    } else if (frame.command?.kind === "settle") {
      promote({ kind: "settlement", title: "Count agreed",
        impact: 90, holdMs: 1700, cue: "chime" });
    }
    return Object.freeze({ version: frame.version, ...selection });
  }

  const opening = Object.freeze({
    version: 0, kind: "opening", title: "The board before the fight",
    impact: 0, holdMs: 1100, cue: "ui-tap",
  });
  if (frames.length === 1) return Object.freeze([opening]);
  const finale = moment(frames.at(-1));
  const highlights = frames.slice(1, -1).map(moment)
    .filter((beat) => beat.impact > 0)
    .sort((a, b) => b.impact - a.impact || a.version - b.version)
    .slice(0, limit - 2)
    .sort((a, b) => a.version - b.version);
  return Object.freeze([opening, ...highlights, finale]);
}
