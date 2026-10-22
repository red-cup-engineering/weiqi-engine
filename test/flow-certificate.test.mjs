import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, EMPTY, findGroupBoundaryIncidence, neighbors } from "../src/board.mjs";
import { unitGridCutCapacityOf, unitGridDivergenceReceiptOf, verifyUnitGridFlowCutOf } from "../src/flow-certificate.mjs";

const optimal2x2={
  source:0,sink:3,sourceSide:[0,1,2],
  flowEdges:[
    {a:0,b:1,flow:1},{a:0,b:2,flow:1},
    {a:1,b:3,flow:1},{a:2,b:3,flow:1},
  ],
};
test("two edge-disjoint paths furnish a full unit-grid flow/cut optimality certificate",()=>{
  const result=verifyUnitGridFlowCutOf(2,2,optimal2x2);
  assert.equal(result.flowValue,2);
  assert.equal(result.cutCapacity,2);
  assert.equal(result.cutFlux,2);
  assert.equal(result.optimal,true);
  assert.equal(result.status,"dual-optimality-certified");
  assert.deepEqual(result.divergence,[2,0,0,-2]);
  assert.equal(result.physics,"not-an-RT-or-quantum-bit-thread-certificate");
});

test("ordinary Weiqi group full cut need NOT be a minimum source-sink cut",()=>{
  const board=Uint8Array.from([BLACK,BLACK,BLACK,EMPTY,BLACK,EMPTY,EMPTY,EMPTY,EMPTY]);
  const group=findGroupBoundaryIncidence(board,3,3,0);
  assert.equal(group.unitCutCapacity,5);
  const groupCut=unitGridCutCapacityOf(3,3,group.stones);
  assert.equal(groupCut.capacity,group.unitCutCapacity);
  const strictlyCheaperCut=unitGridCutCapacityOf(3,3,[0]);
  assert.equal(strictlyCheaperCut.capacity,2);
  assert.ok(strictlyCheaperCut.capacity<groupCut.capacity);
  // Source 0 is in both source-side sets; terminal 8 is outside both.
  // A cheaper separating cut proves delta(group) cannot be minimum.
  assert.ok(group.stones.includes(0) && !group.stones.includes(8));
});

test("missing edges, overcapacity, impossible conservation and malformed cuts refuse",()=>{
  assert.throws(()=>verifyUnitGridFlowCutOf(2,2,{
    ...optimal2x2,flowEdges:optimal2x2.flowEdges.slice(0,-1),
  }),/every original grid edge/);
  assert.throws(()=>verifyUnitGridFlowCutOf(2,2,{
    ...optimal2x2,flowEdges:[{a:0,b:1,flow:2},...optimal2x2.flowEdges.slice(1)],
  }),/unit edge capacity/);
  assert.throws(()=>verifyUnitGridFlowCutOf(2,2,{
    ...optimal2x2,flowEdges:[{a:0,b:1,flow:0},...optimal2x2.flowEdges.slice(1)],
  }),/conservation or terminal direction/);
  assert.throws(()=>verifyUnitGridFlowCutOf(2,2,{
    ...optimal2x2,sourceSide:[0,1,2,3],
  }),/contain source and exclude sink/);
  assert.throws(()=>unitGridCutCapacityOf(3,2,[0,0]),/duplicate source-side/);
  assert.throws(()=>unitGridCutCapacityOf(20,2,[0]),/width\/height 1..19/);
});

test("all 3^7 signed grid flows on 3x2 obey weak duality if admitted",()=>{
  const width=3,height=2,edges=[];
  for(let a=0;a<width*height;a++)
    for(const b of neighbors(width,height,a))
      if(a<b)edges.push({a,b});
  edges.sort((a,b)=>a.a-b.a||a.b-b.b);
  assert.equal(edges.length,7);
  let admitted=0,rejected=0;
  for(let code=0;code<3**edges.length;code++){
    let n=code;
    const flowEdges=edges.map(({a,b})=>{
      const flow=n%3-1;n=Math.floor(n/3);return {a,b,flow};
    });
    try{
      const result=verifyUnitGridFlowCutOf(width,height,{
        source:0,sink:5,sourceSide:[0,1,2],flowEdges,
      });
      admitted++;
      assert.ok(result.flowValue<=result.cutCapacity);
    }catch(error){
      rejected++;
      assert.match(error.message,/conservation or terminal direction/);
    }
  }
  assert.equal(admitted,12);
  assert.equal(rejected,2175);
});


test("original-grid divergence theorem holds on all 2,187 flows and all 64 source-side cuts",()=>{
  const width=3,height=2,edges=[];
  for(let a=0;a<width*height;a++)
    for(const b of neighbors(width,height,a))
      if(a<b)edges.push({a,b});
  edges.sort((a,b)=>a.a-b.a||a.b-b.b);
  assert.equal(edges.length,7);
  let receipts=0;
  for(let code=0;code<3**edges.length;code++){
    let n=code;
    const flowEdges=edges.map(({a,b})=>{
      const flow=n%3-1;n=Math.floor(n/3);return {a,b,flow};
    });
    for(let mask=0;mask<1<<(width*height);mask++){
      const sourceSide=Array.from({length:width*height},(_,i)=>i)
        .filter(i=>mask&(1<<i));
      const receipt=unitGridDivergenceReceiptOf(width,height,{sourceSide,flowEdges});
      assert.equal(receipt.kind,"weiqi.originalGridDivergenceIdentity.v1");
      assert.equal(receipt.totalDivergence,0);
      assert.equal(receipt.cutFlux,receipt.sourceSideDivergence);
      receipts++;
    }
  }
  assert.equal(receipts,139968);
});

test("bulk endpoints are visible but refused by the classical conservation certificate",()=>{
  const flowEdges=[
    {a:0,b:1,flow:1},{a:0,b:2,flow:0},
    {a:1,b:3,flow:0},{a:2,b:3,flow:0},
  ];
  const receipt=unitGridDivergenceReceiptOf(2,2,{sourceSide:[0],flowEdges});
  assert.deepEqual(receipt.divergence,[1,-1,0,0]);
  assert.deepEqual(receipt.nonzeroDivergencePointIndices,[0,1]);
  assert.equal(receipt.cutFlux,1);
  assert.equal(receipt.sourceSideDivergence,1);
  assert.equal(receipt.physics,"not-a-quantum-covariant-bulk-endpoint-entropy");
  assert.throws(()=>verifyUnitGridFlowCutOf(2,2,{
    source:0,sink:3,sourceSide:[0,1,2],flowEdges,
  }),/internal conservation or terminal direction/);
  // This is a refusal to confuse a finite bulk endpoint with a
  // static source-sink-only flow, NOT a derived quantum bit-thread law.
});


test("all ordered terminal pairs on 3x2 attain finite max-flow=min-cut independently",()=>{
  const edges=[];
  for(let a=0;a<6;a++)
    for(const b of neighbors(3,2,a))if(a<b)edges.push({a,b});
  edges.sort((x,y)=>x.a-y.a||x.b-y.b);
  assert.equal(edges.length,7);
  const candidates=[];
  for(let code=0;code<3**edges.length;code++){
    let k=code;
    const flowEdges=edges.map(({a,b})=>{
      const flow=k%3-1;k=Math.floor(k/3);return {a,b,flow};
    });
    // Independent oracle: signed incidence, without calling the verifier.
    const div=Array(6).fill(0);
    for(const {a,b,flow} of flowEdges){div[a]+=flow;div[b]-=flow}
    candidates.push({flowEdges,div});
  }
  let pairs=0;
  for(let source=0;source<6;source++)for(let sink=0;sink<6;sink++){
    if(source===sink)continue;
    const cuts=[];
    for(let mask=0;mask<64;mask++){
      if(!(mask&(1<<source))||(mask&(1<<sink)))continue;
      const side=Array.from({length:6},(_,i)=>i).filter(i=>mask&(1<<i));
      // Another independent oracle: direct source-side crossing count.
      const inSide=new Set(side);
      const capacity=edges.filter(({a,b})=>inSide.has(a)!==inSide.has(b)).length;
      cuts.push({side,capacity});
    }
    cuts.sort((a,b)=>a.capacity-b.capacity||a.side.length-b.side.length);
    let max=-1,witness=null;
    for(const {flowEdges,div} of candidates){
      const value=div[source];
      if(value<0||div[sink]!==-value||
          div.some((d,i)=>i!==source&&i!==sink&&d!==0))continue;
      if(value>max){max=value;witness=flowEdges}
    }
    assert.equal(max,cuts[0].capacity,"exhaustive primal/dual optimum for "+source+":"+sink);
    const received=verifyUnitGridFlowCutOf(3,2,{
      source,sink,sourceSide:cuts[0].side,flowEdges:witness,
    });
    assert.equal(received.optimal,true);
    assert.equal(received.flowValue,max);
    pairs++;
  }
  assert.equal(pairs,30);
});
