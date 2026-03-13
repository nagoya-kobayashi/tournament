const BRACKET_ORDER = ["main", "third_place", "consolation"];

const BRACKET_TITLES = {
  main: "本戦トーナメント",
  third_place: "3位決定戦",
  consolation: "コンソレーション",
};

const CHIP_WIDTH = 52;
const CHIP_HEIGHT = 30;
const LABEL_WIDTH = 110;
const LABEL_HEIGHT = 28;
const LABEL_GAP = 12;
const STEP_X = 80;
const STEP_Y = 56;
const PADDING_X = 22;
const PADDING_Y = 24;
const FINAL_GAP = 34;
const TREE_GAP_UNITS = 1.2;

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

function connectionState(match, slot) {
  const resolvedTeamId = slot === "top" ? match.resolved_top_team_id : match.resolved_bottom_team_id;
  if (!resolvedTeamId) {
    return "pending";
  }
  if (match.winner_team_id && match.winner_team_id === resolvedTeamId) {
    return "winning";
  }
  return "resolved";
}

function elbowPath(x1, y1, x2, y2) {
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
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

  for (const leaf of tree.leaves) {
    const parent = nodeMap.get(leaf.parentMatchId);
    const centerY = PADDING_Y + (leaf.y + yOffsetUnits) * STEP_Y;
    const left = side === "left" ? parent.left - LABEL_GAP - LABEL_WIDTH : parent.right + LABEL_GAP;
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
    for (const slot of ["top", "bottom"]) {
      const input = node.inputs[slot];
      if (input.kind === "node") {
        const child = nodeMap.get(input.matchId);
        if (!child) {
          continue;
        }
        connections.push({
          d:
            side === "left"
              ? elbowPath(child.right, child.centerY, node.left, node.centerY)
              : elbowPath(node.right, node.centerY, child.left, child.centerY),
          state: connectionState(node.match, slot),
        });
      } else {
        const leaf = leafMap.get(`${node.match.match_id}:${slot}`);
        if (!leaf) {
          continue;
        }
        connections.push({
          d:
            side === "left"
              ? elbowPath(leaf.right, leaf.centerY, node.left, node.centerY)
              : elbowPath(node.right, node.centerY, leaf.left, leaf.centerY),
          state: connectionState(node.match, slot),
        });
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

function buildForestLayout(matches) {
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

function buildThirdPlaceLayout(matches) {
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
      {
        d: elbowPath(leaves[0].right, leaves[0].centerY, node.left, node.centerY),
        state: connectionState(match, "top"),
      },
      {
        d: elbowPath(node.right, node.centerY, leaves[1].left, leaves[1].centerY),
        state: connectionState(match, "bottom"),
      },
    ],
  };
}

function buildMainLayout(matches) {
  const sortedMatches = [...matches].sort(sortByDisplayOrder);
  const matchMap = buildMatchMap(sortedMatches);
  const downstream = buildDownstreamMap(sortedMatches, matchMap);
  const roots = sortedMatches.filter((match) => !downstream.has(match.match_id));

  if (
    roots.length !== 1 ||
    !isInternalRef(matchMap, roots[0].slot_top_type, roots[0].slot_top_ref) ||
    !isInternalRef(matchMap, roots[0].slot_bottom_type, roots[0].slot_bottom_ref)
  ) {
    return buildForestLayout(sortedMatches);
  }

  const finalMatch = roots[0];
  const leftTree = collectTree(finalMatch.slot_top_ref, matchMap);
  const rightTree = collectTree(finalMatch.slot_bottom_ref, matchMap);
  const alignRootY = Math.max(leftTree.root.y, rightTree.root.y);
  const leftWing = positionWing(leftTree, {
    side: "left",
    yOffsetUnits: alignRootY - leftTree.root.y,
    matchStartX: PADDING_X + LABEL_WIDTH + LABEL_GAP,
  });
  const finalLeft = PADDING_X + LABEL_WIDTH + LABEL_GAP + leftTree.root.depth * STEP_X + FINAL_GAP;
  const rightWing = positionWing(rightTree, {
    side: "right",
    yOffsetUnits: alignRootY - rightTree.root.y,
    rootLeftX: finalLeft + CHIP_WIDTH + FINAL_GAP,
  });

  const rootCenterY = PADDING_Y + alignRootY * STEP_Y;
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
  const leftSemi = leftWing.nodes.find((node) => node.match.match_id === finalMatch.slot_top_ref);
  const rightSemi = rightWing.nodes.find((node) => node.match.match_id === finalMatch.slot_bottom_ref);

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
        d: elbowPath(leftSemi.right, leftSemi.centerY, finalNode.left, finalNode.centerY),
        state: connectionState(finalMatch, "top"),
      },
      {
        d: elbowPath(finalNode.right, finalNode.centerY, rightSemi.left, rightSemi.centerY),
        state: connectionState(finalMatch, "bottom"),
      },
    ],
  };
}

export function buildBracketSections(matches) {
  const grouped = new Map();
  for (const match of matches) {
    if (!grouped.has(match.bracket_type)) {
      grouped.set(match.bracket_type, []);
    }
    grouped.get(match.bracket_type).push(match);
  }

  return BRACKET_ORDER.filter((type) => grouped.has(type)).map((type) => {
    const sectionMatches = grouped.get(type).sort(sortByDisplayOrder);
    let layout;
    if (type === "main") {
      layout = buildMainLayout(sectionMatches);
    } else if (type === "third_place" && sectionMatches.length === 1) {
      layout = buildThirdPlaceLayout(sectionMatches);
    } else {
      layout = buildForestLayout(sectionMatches);
    }
    return {
      type,
      title: BRACKET_TITLES[type] || type,
      layout,
    };
  });
}
