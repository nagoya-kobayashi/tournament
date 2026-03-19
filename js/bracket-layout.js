const BRACKET_ORDER = ["main", "third_place", "consolation"];

const BRACKET_TITLES = {
  main: "本戦トーナメント",
  third_place: "3位決定戦",
  consolation: "コンソレーション",
};

const CHIP_WIDTH = 44;
const CHIP_HEIGHT = 26;
const LABEL_WIDTH = 110;
const LABEL_HEIGHT = 28;
const LABEL_GAP = 12;
const STEP_X = 80;
const STEP_Y = 56;
const PADDING_X = 22;
const PADDING_Y = 24;
const FINAL_GAP = 34;
const TREE_GAP_UNITS = 1.2;
const MATCH_INPUT_GAP = 0;
const FINAL_RAISE = 20;

function sortByDisplayOrder(a, b) {
  return Number(a.display_order) - Number(b.display_order);
}

function buildMatchMap(matches) {
  return new Map(matches.map((match) => [match.match_id, match]));
}

function isInternalRef(matchMap, slotType, slotRef) {
  return (slotType === "winner" || slotType === "loser") && matchMap.has(slotRef);
}

function buildDownstreamMap(matches, matchMap) {
  const downstream = new Map();
  for (const match of matches) {
    if (isInternalRef(matchMap, match.slot_top_type, match.slot_top_ref)) {
      if (!downstream.has(match.slot_top_ref)) {
        downstream.set(match.slot_top_ref, []);
      }
      downstream.get(match.slot_top_ref).push(match.match_id);
    }
    if (isInternalRef(matchMap, match.slot_bottom_type, match.slot_bottom_ref)) {
      if (!downstream.has(match.slot_bottom_ref)) {
        downstream.set(match.slot_bottom_ref, []);
      }
      downstream.get(match.slot_bottom_ref).push(match.match_id);
    }
  }
  return downstream;
}

function collectTree(rootMatchId, matchMap) {
  const nodesMemo = new Map();
  const leaves = [];
  let nextLeafY = 0;

  function visitSource(slotType, slotRef, slot, parentMatchId) {
    if (isInternalRef(matchMap, slotType, slotRef)) {
      const node = visitMatch(slotRef);
      return {
        kind: "node",
        slot,
        matchId: node.match.match_id,
        y: node.y,
        depth: node.depth,
      };
    }

    const leaf = {
      id: `${parentMatchId}:${slot}`,
      kind: "leaf",
      slot,
      slotType,
      slotRef,
      parentMatchId,
      y: nextLeafY,
      depth: 0,
    };
    nextLeafY += 1;
    leaves.push(leaf);
    return leaf;
  }

  function visitMatch(matchId) {
    if (nodesMemo.has(matchId)) {
      return nodesMemo.get(matchId);
    }

    const match = matchMap.get(matchId);
    const top = visitSource(match.slot_top_type, match.slot_top_ref, "top", matchId);
    const bottom = visitSource(match.slot_bottom_type, match.slot_bottom_ref, "bottom", matchId);
    const node = {
      match,
      y: (top.y + bottom.y) / 2,
      depth: 1 + Math.max(top.depth, bottom.depth),
      inputs: {
        top,
        bottom,
      },
    };
    nodesMemo.set(matchId, node);
    return node;
  }

  const root = visitMatch(rootMatchId);

  return {
    root,
    nodes: [...nodesMemo.values()].sort((a, b) => sortByDisplayOrder(a.match, b.match)),
    leaves,
    leafCount: Math.max(nextLeafY, 1),
  };
}

function connectionState(input, match, slot, allMatchMap) {
  const winnerSlot = getVisualWinnerSlot(match);
  const resolvedTeamId = slot === "top" ? match.resolved_top_team_id : match.resolved_bottom_team_id;
  if (winnerSlot === slot) {
    return "winning";
  }
  if (!resolvedTeamId) {
    return "pending";
  }

  const upstreamMatchId =
    input.kind === "node"
      ? input.matchId
      : input.slotType === "winner" || input.slotType === "loser"
        ? input.slotRef
        : "";
  const upstreamMatch = upstreamMatchId ? allMatchMap.get(upstreamMatchId) : null;

  if (upstreamMatch && !isAutoAdvanceMatch(upstreamMatch) && upstreamMatch.winner_team_id === resolvedTeamId) {
    return "winning";
  }
  if (upstreamMatch && input.slotType === "loser" && upstreamMatch.loser_team_id === resolvedTeamId) {
    return "resolved";
  }
  if (!isAutoAdvanceMatch(match) && match.winner_team_id && match.winner_team_id === resolvedTeamId) {
    return "winning";
  }
  return "resolved";
}

function isAutoAdvanceMatch(match) {
  const topResolved = !!match.resolved_top_team_id;
  const bottomResolved = !!match.resolved_bottom_team_id;
  return (topResolved && match.slot_bottom_type === "bye") || (bottomResolved && match.slot_top_type === "bye");
}

function getMatchWinnerSlot(match) {
  if (match.winner_slot) {
    return match.winner_slot;
  }
  if (match.winner_team_id && match.winner_team_id === match.resolved_top_team_id) {
    return "top";
  }
  if (match.winner_team_id && match.winner_team_id === match.resolved_bottom_team_id) {
    return "bottom";
  }
  return "";
}

function getVisualWinnerSlot(match) {
  return isAutoAdvanceMatch(match) ? "" : getMatchWinnerSlot(match);
}

function elbowGeometry(x1, y1, x2, y2, options = {}) {
  const movingRight = x2 >= x1;
  const insetStart = Number(options.insetStart || 0);
  const insetEnd = Number(options.insetEnd || 0);
  const startX = movingRight ? x1 + insetStart : x1 - insetStart;
  const endX = movingRight ? x2 - insetEnd : x2 + insetEnd;
  const midX =
    typeof options.branchX === "number" && Number.isFinite(options.branchX)
      ? options.branchX
      : startX + (endX - startX) / 2;
  return { movingRight, startX, startY: y1, endX, endY: y2, midX };
}

function elbowPath(x1, y1, x2, y2, options = {}) {
  const geometry = elbowGeometry(x1, y1, x2, y2, options);
  return `M ${geometry.startX} ${geometry.startY} L ${geometry.midX} ${geometry.startY} L ${geometry.midX} ${geometry.endY} L ${geometry.endX} ${geometry.endY}`;
}

function elbowFillPath(x1, y1, x2, y2, options = {}) {
  const geometry = elbowGeometry(x1, y1, x2, y2, options);
  if (options.fullToParent || geometry.startY === geometry.endY) {
    return `M ${geometry.startX} ${geometry.startY} L ${geometry.midX} ${geometry.startY} L ${geometry.midX} ${geometry.endY} L ${geometry.endX} ${geometry.endY}`;
  }
  const stopX = geometry.movingRight ? geometry.midX - 5 : geometry.midX + 5;
  return `M ${geometry.startX} ${geometry.startY} L ${stopX} ${geometry.startY}`;
}

function buildConnection(input, match, slot, sourceX, sourceY, parentX, parentY, allMatchMap, options = {}) {
  const fullToParent = getVisualWinnerSlot(match) === slot;
  return {
    d: elbowPath(sourceX, sourceY, parentX, parentY, { insetEnd: MATCH_INPUT_GAP, branchX: options.branchX }),
    fillD: elbowFillPath(sourceX, sourceY, parentX, parentY, {
      insetEnd: MATCH_INPUT_GAP,
      fullToParent,
      branchX: options.branchX,
    }),
    state: connectionState(input, match, slot, allMatchMap),
  };
}

function straightPath(x1, y1, x2, y2) {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

function overallMatchState(match) {
  if (isAutoAdvanceMatch(match)) {
    return "resolved";
  }
  if (match.winner_slot || match.winner_team_id) {
    return "winning";
  }
  if (match.resolved_top_team_id && match.resolved_bottom_team_id) {
    return "resolved";
  }
  return "pending";
}

function positionWing(tree, options) {
  const side = options.side;
  const yOffsetUnits = options.yOffsetUnits || 0;
  const nodes = [];
  const leaves = [];
  const nodeMap = new Map();

  for (const node of tree.nodes) {
    const left =
      side === "left"
        ? options.matchStartX + (node.depth - 1) * STEP_X
        : options.rootLeftX + (tree.root.depth - node.depth) * STEP_X;
    const centerY = PADDING_Y + (node.y + yOffsetUnits) * STEP_Y;
    const positioned = {
      kind: "node",
      side,
      match: node.match,
      left,
      top: centerY - CHIP_HEIGHT / 2,
      right: left + CHIP_WIDTH,
      centerX: left + CHIP_WIDTH / 2,
      centerY,
      inputs: node.inputs,
    };
    nodes.push(positioned);
    nodeMap.set(node.match.match_id, positioned);
  }

  const leafEntries = tree.leaves.map((leaf) => {
    const parent = nodeMap.get(leaf.parentMatchId);
    return {
      leaf,
      parent,
      naturalLeft: side === "left" ? parent.left - LABEL_GAP - LABEL_WIDTH : parent.right + LABEL_GAP,
    };
  });
  const teamLeafLefts = leafEntries.filter((entry) => entry.leaf.slotType === "team").map((entry) => entry.naturalLeft);
  const edgeTeamLeft = teamLeafLefts.length
    ? side === "left"
      ? Math.min(...teamLeafLefts)
      : Math.max(...teamLeafLefts)
    : null;

  for (const entry of leafEntries) {
    const { leaf } = entry;
    const centerY = PADDING_Y + (leaf.y + yOffsetUnits) * STEP_Y;
    const left = leaf.slotType === "team" && edgeTeamLeft != null ? edgeTeamLeft : entry.naturalLeft;
    leaves.push({
      kind: "leaf",
      side,
      left,
      top: centerY - LABEL_HEIGHT / 2,
      right: left + LABEL_WIDTH,
      centerY,
      width: LABEL_WIDTH,
      align: side === "left" ? "left" : "right",
      slot: leaf.slot,
      slotType: leaf.slotType,
      slotRef: leaf.slotRef,
      matchId: leaf.parentMatchId,
    });
  }

  const leafMap = new Map(leaves.map((leaf) => [`${leaf.matchId}:${leaf.slot}`, leaf]));
  const connections = [];

  for (const node of nodes) {
    const topInput = node.inputs.top;
    const bottomInput = node.inputs.bottom;
    const hasSeedLeafPair =
      (topInput.kind === "leaf" && topInput.slotType === "team" && bottomInput.kind === "node") ||
      (bottomInput.kind === "leaf" && bottomInput.slotType === "team" && topInput.kind === "node");
    let sharedBranchX = null;
    if (hasSeedLeafPair) {
      const nodeInput = topInput.kind === "node" ? topInput : bottomInput;
      const child = nodeMap.get(nodeInput.matchId);
      if (child) {
        const geometry =
          side === "left"
            ? elbowGeometry(child.right, child.centerY, node.left, node.centerY, { insetEnd: MATCH_INPUT_GAP })
            : elbowGeometry(child.left, child.centerY, node.right, node.centerY, { insetEnd: MATCH_INPUT_GAP });
        sharedBranchX = geometry.midX;
      }
    }
    for (const slot of ["top", "bottom"]) {
      const input = node.inputs[slot];
      if (input.kind === "node") {
        const child = nodeMap.get(input.matchId);
        if (!child) {
          continue;
        }
        connections.push(
          side === "left"
            ? buildConnection(input, node.match, slot, child.right, child.centerY, node.left, node.centerY, options.allMatchMap, {
                branchX: sharedBranchX,
              })
            : buildConnection(input, node.match, slot, child.left, child.centerY, node.right, node.centerY, options.allMatchMap, {
                branchX: sharedBranchX,
              })
        );
      } else {
        const leaf = leafMap.get(`${node.match.match_id}:${slot}`);
        if (!leaf) {
          continue;
        }
        connections.push(
          side === "left"
            ? buildConnection(input, node.match, slot, leaf.right, leaf.centerY, node.left, node.centerY, options.allMatchMap, {
                branchX: sharedBranchX,
              })
            : buildConnection(input, node.match, slot, leaf.left, leaf.centerY, node.right, node.centerY, options.allMatchMap, {
                branchX: sharedBranchX,
              })
        );
      }
    }
  }

  const width = Math.max(
    ...nodes.map((node) => node.right),
    ...leaves.map((leaf) => leaf.right),
    options.matchStartX || options.rootLeftX || 0
  ) + PADDING_X;
  const height = Math.max(
    ...nodes.map((node) => node.top + CHIP_HEIGHT),
    ...leaves.map((leaf) => leaf.top + LABEL_HEIGHT),
    PADDING_Y + CHIP_HEIGHT
  ) + PADDING_Y;

  return {
    nodes,
    leaves,
    connections,
    width,
    height,
  };
}

function buildForestLayout(matches, allMatchMap) {
  const sortedMatches = [...matches].sort(sortByDisplayOrder);
  const matchMap = buildMatchMap(sortedMatches);
  const downstream = buildDownstreamMap(sortedMatches, matchMap);
  const rootIds = sortedMatches.filter((match) => !downstream.has(match.match_id)).map((match) => match.match_id);
  const matchStartX = PADDING_X + LABEL_WIDTH + LABEL_GAP;

  let yOffsetUnits = 0;
  let width = matchStartX + CHIP_WIDTH + PADDING_X;
  let height = PADDING_Y * 2 + CHIP_HEIGHT;
  const nodes = [];
  const leaves = [];
  const connections = [];

  for (const rootId of rootIds) {
    const tree = collectTree(rootId, matchMap);
    const positioned = positionWing(tree, {
      side: "left",
      yOffsetUnits,
      matchStartX,
      allMatchMap,
    });
    nodes.push(...positioned.nodes);
    leaves.push(...positioned.leaves);
    connections.push(...positioned.connections);
    width = Math.max(width, positioned.width);
    height = Math.max(height, positioned.height);
    yOffsetUnits += tree.leafCount + TREE_GAP_UNITS;
  }

  return {
    variant: "forest",
    width,
    height,
    nodes,
    leaves,
    connections,
  };
}

function buildThirdPlaceLayout(matches, allMatchMap) {
  const match = [...matches].sort(sortByDisplayOrder)[0];
  const centerX = PADDING_X + LABEL_WIDTH + 70;
  const centerY = PADDING_Y + STEP_Y;
  const node = {
    kind: "node",
    side: "center",
    match,
    left: centerX,
    top: centerY - CHIP_HEIGHT / 2,
    right: centerX + CHIP_WIDTH,
    centerX: centerX + CHIP_WIDTH / 2,
    centerY,
  };
  const leaves = [
    {
      kind: "leaf",
      side: "left",
      left: node.left - LABEL_GAP - LABEL_WIDTH,
      top: centerY - LABEL_HEIGHT / 2,
      right: node.left - LABEL_GAP,
      centerY,
      width: LABEL_WIDTH,
      align: "left",
      slot: "top",
      slotType: match.slot_top_type,
      slotRef: match.slot_top_ref,
      matchId: match.match_id,
    },
    {
      kind: "leaf",
      side: "right",
      left: node.right + LABEL_GAP,
      top: centerY - LABEL_HEIGHT / 2,
      right: node.right + LABEL_GAP + LABEL_WIDTH,
      centerY,
      width: LABEL_WIDTH,
      align: "right",
      slot: "bottom",
      slotType: match.slot_bottom_type,
      slotRef: match.slot_bottom_ref,
      matchId: match.match_id,
    },
  ];

  return {
    variant: "third_place",
    width: leaves[1].right + PADDING_X,
    height: node.top + CHIP_HEIGHT + PADDING_Y,
    nodes: [node],
    leaves,
    connections: [
      buildConnection(leaves[0], match, "top", leaves[0].right, leaves[0].centerY, node.left, node.centerY, allMatchMap),
      buildConnection(leaves[1], match, "bottom", leaves[1].left, leaves[1].centerY, node.right, node.centerY, allMatchMap),
    ],
  };
}

function buildMainLayout(matches, allMatchMap) {
  const sortedMatches = [...matches].sort(sortByDisplayOrder);
  const matchMap = buildMatchMap(sortedMatches);
  const downstream = buildDownstreamMap(sortedMatches, matchMap);
  const roots = sortedMatches.filter((match) => !downstream.has(match.match_id));

  if (
    roots.length !== 1 ||
    !isInternalRef(matchMap, roots[0].slot_top_type, roots[0].slot_top_ref) ||
    !isInternalRef(matchMap, roots[0].slot_bottom_type, roots[0].slot_bottom_ref)
  ) {
    return buildForestLayout(sortedMatches, allMatchMap);
  }

  const finalMatch = roots[0];
  const leftTree = collectTree(finalMatch.slot_top_ref, matchMap);
  const rightTree = collectTree(finalMatch.slot_bottom_ref, matchMap);
  const alignRootY = Math.max(leftTree.root.y, rightTree.root.y);
  const leftWing = positionWing(leftTree, {
    side: "left",
    yOffsetUnits: alignRootY - leftTree.root.y,
    matchStartX: PADDING_X + LABEL_WIDTH + LABEL_GAP,
    allMatchMap,
  });
  const maxDepth = Math.max(leftTree.root.depth, rightTree.root.depth);
  const estimatedFinalLeft = PADDING_X + LABEL_WIDTH + LABEL_GAP + maxDepth * STEP_X + FINAL_GAP;
  const rightWing = positionWing(rightTree, {
    side: "right",
    yOffsetUnits: alignRootY - rightTree.root.y,
    rootLeftX: estimatedFinalLeft + CHIP_WIDTH + FINAL_GAP,
    allMatchMap,
  });

  const leftSemi = leftWing.nodes.find((node) => node.match.match_id === finalMatch.slot_top_ref);
  const rightSemi = rightWing.nodes.find((node) => node.match.match_id === finalMatch.slot_bottom_ref);
  const finalCenterX = (leftSemi.right + rightSemi.left) / 2;
  const finalLeft = finalCenterX - CHIP_WIDTH / 2;
  const rootCenterY = leftSemi.centerY - FINAL_RAISE;
  const finalNode = {
    kind: "node",
    side: "center",
    match: finalMatch,
    left: finalLeft,
    top: rootCenterY - CHIP_HEIGHT / 2,
    right: finalLeft + CHIP_WIDTH,
    centerX: finalLeft + CHIP_WIDTH / 2,
    centerY: rootCenterY,
  };

  return {
    variant: "main",
    width: Math.max(leftWing.width, rightWing.width, finalNode.right + PADDING_X),
    height: Math.max(leftWing.height, rightWing.height, finalNode.top + CHIP_HEIGHT + PADDING_Y),
    nodes: [...leftWing.nodes, finalNode, ...rightWing.nodes],
    leaves: [...leftWing.leaves, ...rightWing.leaves],
    connections: [
      ...leftWing.connections,
      ...rightWing.connections,
      {
        d: straightPath(leftSemi.right, leftSemi.centerY, finalNode.centerX, leftSemi.centerY),
        fillD: straightPath(leftSemi.right, leftSemi.centerY, finalNode.centerX, leftSemi.centerY),
        state: connectionState({ kind: "node", matchId: finalMatch.slot_top_ref, slotType: "winner" }, finalMatch, "top", allMatchMap),
      },
      {
        d: straightPath(rightSemi.left, rightSemi.centerY, finalNode.centerX, rightSemi.centerY),
        fillD: straightPath(rightSemi.left, rightSemi.centerY, finalNode.centerX, rightSemi.centerY),
        state: connectionState({ kind: "node", matchId: finalMatch.slot_bottom_ref, slotType: "winner" }, finalMatch, "bottom", allMatchMap),
      },
      {
        d: straightPath(finalNode.centerX, leftSemi.centerY, finalNode.centerX, finalNode.top + CHIP_HEIGHT),
        fillD: straightPath(finalNode.centerX, leftSemi.centerY, finalNode.centerX, finalNode.top + CHIP_HEIGHT),
        state: overallMatchState(finalMatch),
      },
    ],
  };
}

export function buildBracketSections(matches, allMatches = matches, titleOverrides = {}) {
  const grouped = new Map();
  const allMatchMap = buildMatchMap(allMatches);
  for (const match of matches) {
    if (!grouped.has(match.bracket_type)) {
      grouped.set(match.bracket_type, []);
    }
    grouped.get(match.bracket_type).push(match);
  }

  const orderedTypes = [
    ...BRACKET_ORDER.filter((type) => grouped.has(type)),
    ...[...grouped.keys()]
      .filter((type) => !BRACKET_ORDER.includes(type))
      .sort((left, right) => {
        const leftFirst = grouped.get(left).slice().sort(sortByDisplayOrder)[0];
        const rightFirst = grouped.get(right).slice().sort(sortByDisplayOrder)[0];
        return sortByDisplayOrder(leftFirst, rightFirst);
      }),
  ];

  return orderedTypes.map((type) => {
    const sectionMatches = grouped.get(type).sort(sortByDisplayOrder);
    let layout;
    if (type === "main") {
      layout = buildMainLayout(sectionMatches, allMatchMap);
    } else if (type === "third_place" && sectionMatches.length === 1) {
      layout = buildThirdPlaceLayout(sectionMatches, allMatchMap);
    } else {
      layout = buildForestLayout(sectionMatches, allMatchMap);
    }
    return {
      type,
      title: titleOverrides[type] || BRACKET_TITLES[type] || type,
      layout,
    };
  });
}
