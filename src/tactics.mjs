/**
 * Reconstruct tactical challenges directly from one fully replayed Go game.
 * The caller supplies buildStudyReplay(session).frames, not browser scores
 * or user-provided event assertions. Every invitation points to a position
 * immediately before a *known, accepted legal move* and names a rules-event
 * acceptance criterion; alternatives count only when the game engine emits
 * that event. This is an invitation, not evidence of cultural lineage,
 * sect membership, Go ranking or a monetary reward.
 *
 * color: 1 Black, 2 White, null both. In ordinary local play the caller
 * MUST select the actual human color; imported SGFs have no authenticated
 * player ownership and can only be read as either side's recorded tactics.
 */
export function planTacticalTryouts(frames, { color = null, limit = 5 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new TypeError("A tactical tryout requires an engine-replayed game with an opening frame");
  }
  if (color !== null && color !== 1 && color !== 2) {
    throw new TypeError("Tactical observations must name Black, White or both colors");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError("Tryout limit must be a positive integer at most 20");
  }
  const kinds = Object.freeze({
    capture: Object.freeze({ title: "Finish the capture", term: "capture", priority: 80 }),
    "atari-escaped": Object.freeze({ title: "Save the threatened group", term: "atari", priority: 75 }),
    "ko-started": Object.freeze({ title: "Start the ko fight", term: "ko", priority: 70 }),
    connection: Object.freeze({ title: "Connect the divided groups", term: "connection", priority: 65 }),
    "atari-given": Object.freeze({ title: "Put a group in atari", term: "atari", priority: 60 }),
    "eye-formed": Object.freeze({ title: "Complete a simple eye shape", term: "eye", priority: 45 }),
  });
  const seen = new Map();
  const counts = Object.fromEntries(Object.keys(kinds).map(kind => [kind, 0]));
  let played = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame?.version !== i || !Array.isArray(frame.events)) {
      throw new TypeError("Tactical tryouts require contiguous engine-accepted Study frames");
    }
    if (i === 0 || frame.command?.kind !== "play") continue;
    if (frame.mover !== 1 && frame.mover !== 2) {
      throw new TypeError("A played frame must name its actual moving color");
    }
    if (color !== null && color !== frame.mover) continue;
    played++;
    for (const event of frame.events) {
      const rule = typeof event?.type === "string" && Object.hasOwn(kinds, event.type)
        ? kinds[event.type] : null;
      if (!rule || (event.type === "capture" && event.detail?.selfCapture)) continue;
      counts[event.type]++;
      const potency = event.type === "capture"
        ? Math.max(1, Math.min(20, Number.isSafeInteger(event.detail?.stonesCaptured)
          ? event.detail.stonesCaptured : 1))
        : 1;
      const opportunity = Object.freeze({
        kind: event.type, title: rule.title, term: rule.term,
        termRef: event.termRef ?? null, color: frame.mover,
        sourceVersion: frame.version, branchVersion: frame.version - 1,
        sourceMove: frame.command.move, sourceEvents: Object.freeze([event.type]),
        priority: rule.priority + potency,
      });
      const prior = seen.get(event.type);
      if (!prior || opportunity.priority > prior.priority) seen.set(event.type, opportunity);
    }
  }
  const invitations = [...seen.values()]
    .sort((a, b) => b.priority - a.priority || a.sourceVersion - b.sourceVersion)
    .slice(0, limit).sort((a, b) => a.sourceVersion - b.sourceVersion);
  const evidence = Object.freeze(Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => Object.freeze({ kind, count })));
  return Object.freeze({
    color, observedMoves: played, evidence: Object.freeze(evidence),
    invitations: Object.freeze(invitations),
  });
}
