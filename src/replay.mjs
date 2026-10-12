/**
 * The Weiqi specialization of Cartridge's deterministic game contract.
 *
 * Go-specific legality remains in Game. This adapter owns only the explicit
 * boundary from a replayable game intent to an immutable, JSON-safe state.
 * It neither replaces SGF (the public interchange format) nor invents a
 * second intent-log or hash rule.
 */
import { playVerifier, replayPlay } from "@red-cup-engineering/gaming/running/rules";
import {
  admitWeiqiGameCommand,
  createWeiqiGameSession,

} from "./session.mjs";

/** @deprecated Use WeiqiGameCommand from the package root. */

/** @deprecated Use WeiqiSessionState from the package root. */

function replayEvents(events) {
  return Object.freeze(events.map((event) => Object.freeze({
    kind: event.type,
    term: event.term,
    detail: event.detail,
  })));
}

/**
 * A configured game-engine peer for Cartridge. `seed` is deliberately
 * accepted but not interpreted: Weiqi has no random state transition; AI
 * policy belongs outside the rules engine and must log its chosen move.
 */
export function createWeiqiCartridge(config) {
  const frozenConfig = Object.freeze(config.handicap ? { size: config.size, ruleset: config.ruleset, handicap: config.handicap } : { size: config.size, ruleset: config.ruleset });
  return Object.freeze({
    initialPosition(_seed, configId) {
      if (configId !== undefined && configId !== configIdentifier(frozenConfig)) {
        throw new TypeError(`Weiqi configuration mismatch: expected ${configIdentifier(frozenConfig)}, got ${configId}`);
      }
      return createWeiqiGameSession(frozenConfig).state;
    },
    extend(state, intent) {
      if (state.version !== 2 || state.config.size !== frozenConfig.size || state.config.ruleset !== frozenConfig.ruleset || (state.config.handicap ?? 0) !== (frozenConfig.handicap ?? 0)) {
        throw new TypeError("Weiqi replay state belongs to a different engine configuration");
      }
      const session = createWeiqiGameSession(frozenConfig, state.commands);
      const outcome = admitWeiqiGameCommand(session, session.version, intent);
      if (!outcome.ok) throw new TypeError(`Illegal Weiqi intent: ${outcome.reason}`);
      return Object.freeze({
        state: outcome.session.state,
        events: replayEvents(outcome.events),
      });
    },
  });
}

export function configIdentifier(config) {
  return config.handicap ? `weiqi/${config.size}/${config.ruleset}/h${config.handicap}` : `weiqi/${config.size}/${config.ruleset}`;
}

export function replayWeiqi(
  config,
  intents,
  seed = "weiqi-deterministic",
) {
  const cartridge = createWeiqiCartridge(config);
  return replayPlay(cartridge, seed, intents, configIdentifier(config));
}

export function verifyWeiqiIntentLog(
  config,
  entries,
  seed = "weiqi-deterministic",
) {
  return playVerifier(createWeiqiCartridge(config))(seed, configIdentifier(config), entries);
}
