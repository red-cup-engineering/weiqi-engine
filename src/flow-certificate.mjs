/**
 * Exact unit-capacity grid flow/cut certificates over Weiqi's ORIGINAL
 * neighbors(width,height), with no second board representation or solver.
 *
 * A signed flow is given on every undirected grid edge oriented low->high.
 * Conservation plus unit edge capacities imply flowValue <= every separating
 * cut capacity. Equality of ONE feasible flow and ONE cut certifies both
 * optimal (finite max-flow/min-cut weak duality).
 *
 * This is a chosen mathematical network, NOT Go legality, scoring/ownership,
 * holographic Ryu–Takayanagi entropy, or quantum bit-thread geometry.
 */
import { neighbors } from "./board.mjs";

function grid(width,height) {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
      width<1||height<1||width>19||height>19)
    throw new RangeError("finite Go grid needs width/height 1..19");
  const size=width*height,edges=[];
  for(let a=0;a<size;a++)
    for(const b of neighbors(width,height,a))
      if(a<b) edges.push(Object.freeze({a,b}));
  edges.sort((x,y)=>x.a-y.a||x.b-y.b);
  return {size,edges};
}
function point(value,size) {
  if(!Number.isSafeInteger(value)||value<0||value>=size)
    throw new RangeError("grid certificate references nonexistent point");
  return value;
}
function sideOf(sourceSide,size) {
  if(!Array.isArray(sourceSide)||sourceSide.length>size)
    throw new TypeError("grid cut requires a finite source-side point array");
  const side=new Set();
  for(const p of sourceSide) {
    point(p,size);
    if(side.has(p))throw new TypeError("grid cut has duplicate source-side point");
    side.add(p);
  }
  return side;
}

/** Every crossing edge of a declared source-side cut, exactly once. */
export function unitGridCutCapacityOf(width,height,sourceSide) {
  const {size,edges}=grid(width,height),side=sideOf(sourceSide,size);
  const crossing=edges.filter(({a,b})=>side.has(a)!==side.has(b));
  return Object.freeze({
    kind:"weiqi.originalGridUnitCut.v1",
    width,height,
    sourceSide:Object.freeze([...side].sort((a,b)=>a-b)),
    crossingEdges:Object.freeze(crossing),
    capacity:crossing.length,
    status:"particular-cut-only; minimality-not-proved",
  });
}

/**
 * Discrete divergence theorem on the original board grid.
 * For ANY signed unit-bounded edge assignment (not necessarily conserved),
 * sum_{p in S} div(p) equals oriented net flux across delta(S).
 * This is the exact reason classical source/sink-only flow certificates
 * cannot silently admit extra bulk sources/sinks.
 *
 * Nonzero interior divergence is merely a finite graph endpoint observation,
 * NOT a bulk quantum entropy, covariant V-flow/U-flow or gravitational dual.
 */
export function unitGridDivergenceReceiptOf(width,height,{
  sourceSide,flowEdges,
}={}) {
  const {size,edges}=grid(width,height);
  const cut=unitGridCutCapacityOf(width,height,sourceSide);
  const side=new Set(cut.sourceSide);
  if(!Array.isArray(flowEdges)||flowEdges.length!==edges.length)
    throw new TypeError("flow certificate requires every original grid edge");
  const allowed=new Set(edges.map(({a,b})=>a+":"+b));
  const indexed=new Map();
  for(const row of flowEdges){
    const {a,b,flow}=row??{};
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>=b||
        !allowed.has(a+":"+b)||indexed.has(a+":"+b))
      throw new TypeError("flow contains missing, duplicate or unqualified grid edge");
    if(!Number.isSafeInteger(flow)||flow < -1||flow > 1)
      throw new RangeError("signed flow exceeds original unit edge capacity");
    indexed.set(a+":"+b,flow);
  }
  if(indexed.size!==allowed.size)
    throw new TypeError("flow misses an original grid edge");
  const divergence=Array(size).fill(0);
  for(const {a,b} of edges) {
    const flow=indexed.get(a+":"+b);
    divergence[a]+=flow;
    divergence[b]-=flow;
  }
  const sumAllDivergence=divergence.reduce((sum,x)=>sum+x,0);
  const sumInsideDivergence=cut.sourceSide.reduce((sum,p)=>sum+divergence[p],0);
  const cutFlux=cut.crossingEdges.reduce((sum,{a,b})=>
    sum+(side.has(a)?indexed.get(a+":"+b):-indexed.get(a+":"+b)),0);
  if(sumAllDivergence!==0||cutFlux!==sumInsideDivergence)
    throw new Error("original grid divergence/flux conservation identity violated");
  return Object.freeze({
    kind:"weiqi.originalGridDivergenceIdentity.v1",
    cut,
    divergence:Object.freeze(divergence),
    nonzeroDivergencePointIndices:Object.freeze(
      divergence.flatMap((value,p)=>value!==0?[p]:[])),
    cutFlux,sourceSideDivergence:sumInsideDivergence,
    totalDivergence:sumAllDivergence,
    status:"finite-signed-grid-identity-only",
    physics:"not-a-quantum-covariant-bulk-endpoint-entropy",
  });
}

/**
 * Check a producer-supplied flow and cut; do NOT search for a flow.
 * Values on canonical low->high edges are signed integers -1,0,1.
 * Every original grid edge must be present exactly once.
 * An invalid certificate refuses before returning any claimed dual bound.
 */
export function verifyUnitGridFlowCutOf(width,height,{
  source,sink,sourceSide,flowEdges,
}={}) {
  const {size}=grid(width,height);
  point(source,size);point(sink,size);
  if(source===sink)throw new TypeError("flow source and sink must differ");
  const cut=unitGridCutCapacityOf(width,height,sourceSide);
  const side=new Set(cut.sourceSide);
  if(!side.has(source)||side.has(sink))
    throw new TypeError("cut must contain source and exclude sink");
  const raw=unitGridDivergenceReceiptOf(width,height,{sourceSide,flowEdges});
  const divergence=raw.divergence;
  const cutFlux=raw.cutFlux;
  const value=divergence[source];
  if(value<0||divergence[sink]!==-value ||
      divergence.some((x,v)=>v!==source&&v!==sink&&x!==0))
    throw new TypeError("flow violates internal conservation or terminal direction");
  if(cutFlux!==value||value>cut.capacity)
    throw new Error("feasible flow violates finite cut weak duality");
  return Object.freeze({
    kind:"weiqi.originalGridFlowCutCertificate.v1",
    source,sink,flowValue:value,
    cutCapacity:cut.capacity,cutFlux,
    optimal:value===cut.capacity,
    status:value===cut.capacity?"dual-optimality-certified":"feasible-lower-upper-bounds-only",
    divergence,divergenceReceipt:raw,
    cut,
    gridSemantics:"all-points-unit-edges; independent-of-stones-and-Go-history",
    physics:"not-an-RT-or-quantum-bit-thread-certificate",
  });
}
