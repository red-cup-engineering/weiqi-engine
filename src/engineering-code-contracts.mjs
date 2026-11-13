import { admit } from "@red-cup-engineering/signcell/type-system";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalizeJson as __factoryCanonicalize, JSON_RESOURCE_ENVELOPE as __factoryJsonBounds } from "@red-cup-engineering/json-engineering-services-section/canonical-json";
import { isPromise as __factoryIsPromise } from "node:util/types";
import { isProxy as __factoryIsProxy } from "node:util/types";
/** Generated from specifications/*.schema.json. Do not edit. */
import { defineSchemaType } from "@red-cup-engineering/signcell/type-system/schema-type";
const __freezeGeneratedSchema = value => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) __freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
};
export const __inputSchema0 = __freezeGeneratedSchema(JSON.parse("{\"$id\":\"https://schemas.561.group/engineering/unadmitted/2Ts3hF71XdbGAwd_rZAdP0E2zdcfvKvxi2gPQPy-pfU/replay-engine/input\",\"title\":\"replay-engine input\",\"description\":\"Source-observed LLD candidate; semantic Proof unreceived\",\"additionalProperties\":false,\"properties\":{\"arguments\":{\"maxItems\":2,\"type\":\"array\"},\"calls\":{\"items\":{\"type\":\"object\"},\"maxItems\":16,\"type\":\"array\"}},\"required\":[\"arguments\",\"calls\"],\"type\":\"object\",\"x-javascript-factory\":{\"maxArguments\":2,\"maxCalls\":16,\"methods\":[\"initialPosition\",\"extend\"],\"resultReferences\":{\"maxPathLength\":1}}}"));

export const __outputSchema0 = __freezeGeneratedSchema(JSON.parse("{\"$id\":\"https://schemas.561.group/engineering/unadmitted/2Ts3hF71XdbGAwd_rZAdP0E2zdcfvKvxi2gPQPy-pfU/replay-engine/output\",\"title\":\"replay-engine output\",\"description\":\"Source-observed LLD candidate; semantic Proof unreceived\",\"items\":{\"properties\":{\"status\":{\"enum\":[\"returned\",\"threw\"]}},\"required\":[\"status\"],\"type\":\"object\"},\"maxItems\":16,\"type\":\"array\"}"));

export const __inputType0 = defineSchemaType(__inputSchema0);
export const __outputType0 = defineSchemaType(__outputSchema0);
export const engineeringCodeSource = (() => {
/** Generated from specifications/*.schema.json. Do not edit. */
const __freezeGeneratedSchema = value => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) __freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
};
const __engineeringCodeSourceSchema = __freezeGeneratedSchema(JSON.parse("{\"const\":{\"kind\":\"engineering.code-source-contract-candidate.v1\",\"originalComponentOwner\":\"red-cup-engineering/weiqi-engine\",\"designCarrierId\":\"ni:///sha-256;2Ts3hF71XdbGAwd_rZAdP0E2zdcfvKvxi2gPQPy-pfU\",\"sourceCut\":[{\"digest\":\"sha256:3629da908743e8e2b33ace2bd226236e0ee364f1a9cce23d5aa77b966f61f9a6\",\"kind\":\"requirement\"},{\"digest\":\"sha256:64b7762236bb613fb32a33a80bc6a62b93daee0731eca5a6695d35c7ee2511f2\",\"kind\":\"specification\"},{\"digest\":\"sha256:5af48004efa0cc177144951d9071edb03f34a0f7c6d57453fae8bd26be34874c\",\"kind\":\"architecture\"},{\"digest\":\"sha256:0018460971c23a59c5f9e920065397a6ef5fefe0900463f0085ae971545a251f\",\"kind\":\"high-level\"}],\"codeSnapshotScope\":\"supplied-target-views-only\",\"sourceVerification\":{\"clauseCount\":2,\"declaredTestCount\":2,\"missingClauseIds\":[],\"scope\":\"original-specification-clauses\",\"status\":\"source-tests-declared-unverified\"},\"operations\":[{\"bindingObservation\":{\"evidence\":[{\"end\":2879,\"exportedName\":\"createWeiqiGameEngine\",\"path\":\"src/replay.mjs\",\"start\":1139}],\"reason\":null,\"resolved\":{\"binding\":\"createWeiqiGameEngine\",\"owner\":\"red-cup-engineering/weiqi-engine\",\"path\":\"src/replay.mjs\"},\"status\":\"observed\"},\"componentId\":\"replay-engine\",\"expectedSha256\":\"sha256:4937a09acb4f19bea68a5c152bcd44316812c35391626de0fb84d378e88e66d3\",\"exportName\":\"createWeiqiGameEngine\",\"interface\":{\"inputSchema\":{\"additionalProperties\":false,\"properties\":{\"arguments\":{\"maxItems\":2,\"type\":\"array\"},\"calls\":{\"items\":{\"type\":\"object\"},\"maxItems\":16,\"type\":\"array\"}},\"required\":[\"arguments\",\"calls\"],\"type\":\"object\",\"x-javascript-factory\":{\"maxArguments\":2,\"maxCalls\":16,\"methods\":[\"initialPosition\",\"extend\"],\"resultReferences\":{\"maxPathLength\":1}}},\"outputSchema\":{\"items\":{\"properties\":{\"status\":{\"enum\":[\"returned\",\"threw\"]}},\"required\":[\"status\"],\"type\":\"object\"},\"maxItems\":16,\"type\":\"array\"}},\"module\":\"src/replay.mjs\",\"observedSha256\":\"sha256:4937a09acb4f19bea68a5c152bcd44316812c35391626de0fb84d378e88e66d3\",\"operationId\":\"replay-engine\",\"originalComponentOwner\":\"red-cup-engineering/weiqi-engine\",\"originalTrace\":[{\"architectureModelIds\":[\"model-a\"],\"requirementCellId\":\"weiqi-replay-state-references:identity\",\"sourceTarget\":\"held\",\"specificationClauseIds\":[\"clause-0\"]},{\"architectureModelIds\":[\"model-b\"],\"requirementCellId\":\"weiqi-replay-state-references:refusal\",\"sourceTarget\":\"held\",\"specificationClauseIds\":[\"clause-1\"]}],\"reviewedPortContracts\":null,\"sourceStatus\":\"source-present-unassayed\",\"testObligations\":{\"acceptance\":[\"Generate sequential, branching and ko cases. Compare full states/events with the original session owner; instrument Game.play to require six accepted commands to cause exactly six applications, while a JSON-clone control still replays its prefix.\",\"Observe occupied/configuration refusals and recover from earlier successful states. Require missing, future and failed result references to reject outside captureError. Qualify simultaneous fresh invocations separately.\"],\"behavior\":\"Construct a fresh Weiqi engine and execute declared own methods. Explicit reference metadata binds null argument slots to prior successful raw states without cloning, while observations remain detached canonical JSON.\",\"effectBoundaries\":[\"In-memory game only; no persistence, browser, network or cleanup protocol.\"],\"failureCases\":[\"Invalid references refuse outside source-error capture. Illegal moves and configuration mismatches retain the original game errors. Capturing a source error does not imply rollback.\"],\"postconditions\":[\"Accepted commands use the original incremental session state. Older successful states remain valid independent branch points. Observation snapshots do not change after later calls.\"],\"preconditions\":[\"Only earlier successful nonvoid results in this invocation may be referenced. Paths address existing own enumerable data properties and cannot traverse getters, proxies or prototypes.\"],\"resourceBounds\":[\"At most 16 calls, 2 arguments per call and one path component. Original JSON request/observation bounds apply.\"],\"sourceVerification\":[{\"requirementCellId\":\"weiqi-replay-state-references:identity\",\"specificationClauseId\":\"clause-0\",\"status\":\"declared-unverified\",\"test\":\"Generate sequential, branching and ko cases. Compare full states/events with the original session owner; instrument Game.play to require six accepted commands to cause exactly six applications, while a JSON-clone control still replays its prefix.\"},{\"requirementCellId\":\"weiqi-replay-state-references:refusal\",\"specificationClauseId\":\"clause-1\",\"status\":\"declared-unverified\",\"test\":\"Observe occupied/configuration refusals and recover from earlier successful states. Require missing, future and failed result references to reject outside captureError. Qualify simultaneous fresh invocations separately.\"}],\"status\":\"unreceived\"},\"checkedExport\":\"checkedOperation0\",\"sourceSha256\":\"sha256:4937a09acb4f19bea68a5c152bcd44316812c35391626de0fb84d378e88e66d3\"}],\"semanticProof\":\"unreceived\",\"originalWorkAuthority\":\"unreceived\",\"independentCustomerAcceptance\":\"unreceived\"}}"));

  return __engineeringCodeSourceSchema.const;
})();
export async function checkedOperation0(input) {
  const admitReferenceData = value => {
    // Detect active carriers before any reflective traversal can activate a
    // Proxy trap. The original JSON supplier still owns JSON semantics/bounds.
    const pending = [value], seen = new WeakSet();
    let visited = 0;
    while (pending.length) {
      const current = pending.pop();
      if (++visited > __factoryJsonBounds.maxNodes) throw new TypeError("Design result-reference node bound exceeded");
      if (current === null || typeof current !== "object") continue;
      if (__factoryIsProxy(current)) throw new TypeError("Design result-reference Proxy refused");
      if (seen.has(current)) continue;
      seen.add(current);
      const descriptors = Object.getOwnPropertyDescriptors(current);
      if (Array.isArray(current)) {
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== null && (prototype !== Array.prototype ||
            Object.getPrototypeOf(Array.prototype) !== Object.prototype ||
            Object.getOwnPropertyDescriptor(Array.prototype, "0") ||
            Object.getOwnPropertyDescriptor(Object.prototype, "0")))
          throw new TypeError("Design result-reference active array prototype refused");
        const length = descriptors.length.value;
        if (length > __factoryJsonBounds.maxArrayLength) throw new TypeError("Design result-reference array bound exceeded");
        // The supplier's pair-spine detector can inspect array positions before
        // rejecting holes. Prove all positions are inert own data first.
        for (let index = 0; index < length; index++) {
          const part = Object.hasOwn(descriptors, index) ? descriptors[index] : null;
          if (!part || !part.enumerable || !Object.hasOwn(part, "value"))
            throw new TypeError("Design result-reference sparse or accessor array refused");
        }
      }
      for (const key of Reflect.ownKeys(descriptors)) {
        if (Array.isArray(current) && key === "length") continue;
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, "value")) throw new TypeError("Design result-reference accessor refused");
        if (pending.length + visited >= __factoryJsonBounds.maxNodes) throw new TypeError("Design result-reference node bound exceeded");
        pending.push(descriptor.value);
      }
    }
    return __factoryCanonicalize(value, __factoryJsonBounds);
  };
  const policy = JSON.parse("{\"maxArguments\":2,\"maxCalls\":16,\"methods\":[\"initialPosition\",\"extend\"],\"resultReferences\":{\"maxPathLength\":1}}");
  const request = JSON.parse(admitReferenceData(input).text);
  const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const args = value => Array.isArray(value) && value.length <= policy.maxArguments;
  if (!exact(request, ["arguments", "calls"]) || !args(request.arguments) ||
      !Array.isArray(request.calls) || request.calls.length > policy.maxCalls)
    throw new TypeError("Design factory sequence input disagreement");
  for (const [callIndex, call] of request.calls.entries()) {
    if (!([["method", "arguments"], ["method", "arguments", "captureError"],
          ["method", "arguments", "references"], ["method", "arguments", "references", "captureError"]].some(keys => exact(call, keys))) ||
        !policy.methods.includes(call.method) || !args(call.arguments) ||
        Object.hasOwn(call, "captureError") && typeof call.captureError !== "boolean")
      throw new TypeError("Design factory method input disagreement");
    const references = Object.hasOwn(call, "references") ? call.references : [];
    if (!Array.isArray(references) || references.length > policy.maxArguments)
      throw new TypeError("Design result-reference input disagreement");
    const replaced = new Set();
    for (const reference of references) {
      if (!exact(reference, ["argument", "result", "path"]) ||
          !Number.isSafeInteger(reference.argument) || reference.argument < 0 || reference.argument >= call.arguments.length ||
          call.arguments[reference.argument] !== null || replaced.has(reference.argument) ||
          !Number.isSafeInteger(reference.result) || reference.result < 0 || reference.result >= callIndex ||
          !Array.isArray(reference.path) || reference.path.length > policy.resultReferences.maxPathLength ||
          reference.path.some(key => !(typeof key === "string" && key.length > 0 && key.length <= 128 &&
              !["constructor", "prototype", "__proto__"].includes(key) ||
            Number.isSafeInteger(key) && key >= 0 && key < __factoryJsonBounds.maxArrayLength)))
        throw new TypeError("Design result-reference input disagreement");
      replaced.add(reference.argument);
    }
  }
  if (!admit(__inputType0, request).ok) throw new TypeError("Design input disagreement: replay-engine");
  const location = new URL("./replay.mjs", import.meta.url);
  const bytes = await readFile(location);
  const actual = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  if (actual !== "sha256:4937a09acb4f19bea68a5c152bcd44316812c35391626de0fb84d378e88e66d3") throw new Error("Design source revision disagreement: replay-engine");
  const module = await import(location.href + "?source=" + actual.slice(7));
  const implementation = module["createWeiqiGameEngine"];
  if (typeof implementation !== "function") throw new TypeError("Design export disagreement: replay-engine");
  const created = implementation(...request.arguments);
  const instance = __factoryIsPromise(created) ? await created : created;
  if (instance === null || typeof instance !== "object")
    throw new TypeError("Design factory must return an object instance");
  if (__factoryIsProxy(instance)) throw new TypeError("Design factory Proxy instance refused");
  const results = [];
  const output = [];
  let observationBytes = 2;
  for (const call of request.calls) {
    const descriptor = Object.getOwnPropertyDescriptor(instance, call.method);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function")
      throw new TypeError("Design factory requires an own data-property method");
    const methodArguments = call.arguments.slice(), validated = new Set();
    for (const reference of call.references ?? []) {
      const record = results[reference.result];
      if (!record?.ok || record.value === undefined) throw new TypeError("Design result-reference target unavailable");
      if (!validated.has(reference.result)) {
        admitReferenceData(record.value);
        validated.add(reference.result);
      }
      let selected = record.value;
      for (const key of reference.path) {
        if (selected === null || typeof selected !== "object") throw new TypeError("Design result-reference path disagreement");
        const part = Object.getOwnPropertyDescriptor(selected, key);
        if (!part || !part.enumerable || !Object.hasOwn(part, "value")) throw new TypeError("Design result-reference path disagreement");
        selected = part.value;
      }
      // Never use the detached JSON observation here. Raw identity is the
      // source factory's state/session key, including aliases and older forks.
      methodArguments[reference.argument] = selected;
    }
    let value, failure;
    try {
      value = Reflect.apply(descriptor.value, instance, methodArguments);
      if (__factoryIsPromise(value)) value = await value;
    } catch (error) {
      if (!call.captureError || __factoryIsProxy(error)) throw error;
      const type = error !== null && typeof error === "object" &&
        [Error, TypeError, RangeError, SyntaxError].find(Type => Object.getPrototypeOf(error) === Type.prototype);
      const message = type && Object.getOwnPropertyDescriptor(error, "message");
      if (!type || message && (!Object.hasOwn(message, "value") || typeof message.value !== "string")) throw error;
      failure = {status: "threw", name: type.name, message: message ? message.value : ""};
    }
    // Keep observation outside the source-method catch: malformed output and
    // exhausted JSON budgets must never masquerade as an expected source error.
    const observation = failure ?? (value === undefined ? {status: "returned"} : {status: "returned", value});
    const snapshot = admitReferenceData(observation);
    observationBytes += snapshot.byteLength + (output.length ? 1 : 0);
    if (observationBytes > __factoryJsonBounds.maxCanonicalBytes)
      throw new TypeError("Design factory observation byte bound exceeded");
    output.push(snapshot.value);
    results.push({ok: !failure, value});
  }
  if (!admit(__outputType0, output).ok) throw new TypeError("Design output disagreement: replay-engine");
  return output;
}
