/*
 * Rubik Matrix Lab — core cube engine
 * A 3x3x3 cube is a 54-dimensional state vector. Every quarter turn is a
 * 54x54 permutation matrix. Face matrices are the six 3x3 slices of the vector.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RubikMatrix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  // Coordinate system: x = right, y = up, z = front (right-handed).
  var NORMALS = {
    U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
    D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1]
  };
  var COLORS = {
    U: '#f4f6f8', R: '#ff3b47', F: '#21c06b',
    D: '#ffd43b', L: '#ff8a1f', B: '#2f7cff'
  };
  var COLOR_NAMES = {
    U: '白', R: '红', F: '绿', D: '黄', L: '橙', B: '蓝'
  };
  var DARK = {
    U: '#c9d1da', R: '#bd1f2c', F: '#12834a',
    D: '#c9a300', L: '#c76200', B: '#1859c4'
  };

  // Position of each facelet in cube coordinates. r/c are the row/column in
  // the standard cube net (reading order), matching URFDLB facelet order.
  var CELLS = [];
  var CELL_LOOKUP = {};
  FACES.forEach(function (face) {
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var p;
        switch (face) {
          case 'U': p = [c - 1, 1, r - 1]; break;
          case 'D': p = [c - 1, -1, 1 - r]; break;
          case 'F': p = [c - 1, 1 - r, 1]; break;
          case 'B': p = [1 - c, 1 - r, -1]; break;
          case 'R': p = [1, 1 - r, 1 - c]; break;
          case 'L': p = [-1, 1 - r, c - 1]; break;
        }
        var n = NORMALS[face];
        var index = FACE_INDEX[face] * 9 + r * 3 + c;
        var cell = { index: index, face: face, r: r, c: c, pos: p, normal: n };
        CELLS[index] = cell;
        CELL_LOOKUP[p[0] + ',' + p[1] + ',' + p[2] + '|' + n[0] + ',' + n[1] + ',' + n[2]] = index;
      }
    }
  });

  // Standard URFDLB corner/edge facelet tables. They are also used by the
  // legality checker, so painted states are verified before they reach search.
  var CORNER_FACELETS = [
    [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]
  ];
  var CORNER_COLORS = [
    ['U', 'R', 'F'], ['U', 'F', 'L'], ['U', 'L', 'B'], ['U', 'B', 'R'],
    ['D', 'F', 'R'], ['D', 'L', 'F'], ['D', 'B', 'L'], ['D', 'R', 'B']
  ];
  var EDGE_FACELETS = [
    [5, 10], [7, 19], [3, 37], [1, 46],
    [32, 16], [28, 25], [30, 43], [34, 52],
    [23, 12], [21, 41], [50, 39], [48, 14]
  ];
  var EDGE_COLORS = [
    ['U', 'R'], ['U', 'F'], ['U', 'L'], ['U', 'B'],
    ['D', 'R'], ['D', 'F'], ['D', 'L'], ['D', 'B'],
    ['F', 'R'], ['F', 'L'], ['B', 'L'], ['B', 'R']
  ];
  var CENTER_FACELETS = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };

  function solvedState() {
    var state = [];
    FACES.forEach(function (f) {
      for (var i = 0; i < 9; i++) state.push(f);
    });
    return state;
  }

  function colorCounts(state) {
    var counts = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
    for (var i = 0; i < 54; i++) {
      if (counts[state[i]] === undefined) return null;
      counts[state[i]]++;
    }
    return counts;
  }

  function permutationParity(arr) {
    var inversions = 0;
    for (var i = 0; i < arr.length; i++) {
      for (var j = i + 1; j < arr.length; j++) {
        if (arr[i] > arr[j]) inversions++;
      }
    }
    return inversions % 2;
  }

  /**
   * Check whether a 54-facelet state can be produced by legal face turns.
   * Constraints: color counts, centers, corner/edge orientation sums and
   * permutation parity. Returns explicit reasons for the paint UI.
   */
  function validateState(state) {
    var reasons = [];
    var counts = colorCounts(state);
    if (!counts) {
      return { valid: false, reasons: ['包含未知颜色'], counts: null };
    }
    var countBad = false;
    FACES.forEach(function (face) {
      if (counts[face] !== 9) {
        countBad = true;
        reasons.push(face + ' 色有 ' + counts[face] + ' 个（应为 9 个）');
      }
      if (state[CENTER_FACELETS[face]] !== face) {
        reasons.push(face + ' 面中心块被改动');
      }
    });

    var cp = new Array(8), co = new Array(8);
    var ep = new Array(12), eo = new Array(12);
    var usedCorners = {}, usedEdges = {};
    var cornerBad = false, edgeBad = false;

    for (var i = 0; i < 8; i++) {
      var colors = CORNER_FACELETS[i].map(function (index) { return state[index]; });
      var d = -1;
      for (var k = 0; k < 3; k++) {
        if (colors[k] === 'U' || colors[k] === 'D') { d = k; break; }
      }
      var found = -1;
      if (d >= 0) {
        var h = colors[(d + 1) % 3];
        var n = colors[(d + 2) % 3];
        for (var c = 0; c < 8; c++) {
          if (colors[d] === CORNER_COLORS[c][0] &&
              h === CORNER_COLORS[c][1] &&
              n === CORNER_COLORS[c][2]) {
            found = c;
            break;
          }
        }
      }
      if (found < 0) {
        cornerBad = true;
      } else {
        cp[i] = found;
        co[i] = d % 3;
        usedCorners[found] = (usedCorners[found] || 0) + 1;
      }
    }

    for (var e = 0; e < 12; e++) {
      var e0 = state[EDGE_FACELETS[e][0]];
      var e1 = state[EDGE_FACELETS[e][1]];
      var edgeFound = -1;
      var orientation = 0;
      for (var j = 0; j < 12; j++) {
        if (e0 === EDGE_COLORS[j][0] && e1 === EDGE_COLORS[j][1]) {
          edgeFound = j; orientation = 0; break;
        }
        if (e0 === EDGE_COLORS[j][1] && e1 === EDGE_COLORS[j][0]) {
          edgeFound = j; orientation = 1; break;
        }
      }
      if (edgeFound < 0) {
        edgeBad = true;
      } else {
        ep[e] = edgeFound;
        eo[e] = orientation;
        usedEdges[edgeFound] = (usedEdges[edgeFound] || 0) + 1;
      }
    }

    var cornerSetBad = cornerBad || Object.keys(usedCorners).length !== 8 ||
      Object.keys(usedCorners).some(function (key) { return usedCorners[key] !== 1; });
    var edgeSetBad = edgeBad || Object.keys(usedEdges).length !== 12 ||
      Object.keys(usedEdges).some(function (key) { return usedEdges[key] !== 1; });

    if (cornerSetBad) reasons.push('角块颜色组合重复或缺失');
    if (edgeSetBad) reasons.push('棱块颜色组合重复或缺失');

    var cornerTwist = 0, edgeFlip = 0;
    for (var t = 0; t < 8; t++) cornerTwist += (co[t] || 0);
    for (var f = 0; f < 12; f++) edgeFlip += (eo[f] || 0);
    if (!cornerSetBad && cornerTwist % 3 !== 0) reasons.push('角块方向不合法（扭转和不是 3 的倍数）');
    if (!edgeSetBad && edgeFlip % 2 !== 0) reasons.push('棱块方向不合法（翻转和不是偶数）');
    if (!cornerSetBad && !edgeSetBad &&
        permutationParity(cp) !== permutationParity(ep)) {
      reasons.push('角块与棱块的排列奇偶性不一致');
    }

    if (countBad && reasons.length > 6) reasons = reasons.slice(0, 6);

    return {
      valid: reasons.length === 0,
      reasons: reasons,
      counts: counts,
      cp: cp,
      co: co,
      ep: ep,
      eo: eo
    };
  }

  function cellKey(pos, normal) {
    return pos[0] + ',' + pos[1] + ',' + pos[2] + '|' +
      normal[0] + ',' + normal[1] + ',' + normal[2];
  }

  function cellIndex(pos, normal) {
    var i = CELL_LOOKUP[cellKey(pos, normal)];
    if (i === undefined) throw new Error('Unmapped facelet position ' + cellKey(pos, normal));
    return i;
  }

  // Right-handed quarter-turn helper. sign=+1 is +90° about the positive axis.
  function rotate90(v, axis, sign) {
    var x = v[0], y = v[1], z = v[2];
    if (axis === 'x') return [x, -sign * z, sign * y];
    if (axis === 'y') return [sign * z, y, -sign * x];
    return [-sign * y, sign * x, z];
  }

  // Rotate the whole cube (not a layer). Used to normalize a state whose
  // centers were moved by a slice turn before it enters the paint editor.
  function rotateWholeCube(state, axis, sign) {
    var next = new Array(54);
    for (var i = 0; i < 54; i++) {
      var cell = CELLS[i];
      next[cellIndex(rotate90(cell.pos, axis, sign), rotate90(cell.normal, axis, sign))] = state[i];
    }
    return next;
  }

  function centerKey(state) {
    return FACES.map(function (face) { return state[CENTER_FACELETS[face]]; }).join('');
  }

  function centersCanonical(state) {
    return FACES.every(function (face) { return state[CENTER_FACELETS[face]] === face; });
  }

  function normalizeCenters(state) {
    if (centersCanonical(state)) {
      return { state: state.slice(), applied: false, rotations: [] };
    }
    var queue = [{ state: state.slice(), rotations: [] }];
    var seen = {};
    seen[centerKey(state)] = true;
    var axes = ['x', 'y', 'z'];
    while (queue.length) {
      var current = queue.shift();
      for (var a = 0; a < axes.length; a++) {
        for (var s = -1; s <= 1; s += 2) {
          var next = rotateWholeCube(current.state, axes[a], s);
          var key = centerKey(next);
          if (seen[key]) continue;
          var rotations = current.rotations.concat([axes[a] + (s > 0 ? '' : "'")]);
          if (centersCanonical(next)) {
            return { state: next, applied: true, rotations: rotations };
          }
          seen[key] = true;
          queue.push({ state: next, rotations: rotations });
        }
      }
    }
    return { state: state.slice(), applied: false, rotations: [] };
  }

  // The signs below are calibrated to standard Singmaster notation:
  // U/R/F turn clockwise seen from outside, and the same for D/L/B.
  // Face turns and middle-slice turns. M follows L, E follows D, S follows F.
  var MOVE_DEFS = {
    U: { axis: 'y', layer: 1, sign: -1 },
    R: { axis: 'x', layer: 1, sign: -1 },
    F: { axis: 'z', layer: 1, sign: -1 },
    D: { axis: 'y', layer: -1, sign: 1 },
    L: { axis: 'x', layer: -1, sign: 1 },
    B: { axis: 'z', layer: -1, sign: 1 },
    M: { axis: 'x', layer: 0, sign: 1 },
    E: { axis: 'y', layer: 0, sign: 1 },
    S: { axis: 'z', layer: 0, sign: -1 }
  };

  var ALL_MOVES = [];
  ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S'].forEach(function (f) {
    ALL_MOVES.push(f, f + '2', f + "'");
  });

  function parseMove(token) {
    if (!/^[URFDLBMES](?:2|')?$/.test(token)) throw new Error('Invalid move: ' + token);
    return token;
  }

  function parseMoves(text) {
    if (!text) return [];
    var tokens = String(text).replace(/[(),]/g, ' ').trim().split(/\s+/);
    return tokens.filter(Boolean).map(parseMove);
  }

  function movesToString(moves) {
    return moves.join(' ');
  }

  /**
   * Build the permutation for one move: old index i -> new index perm[i].
   * As a matrix, P[perm[i]][i] = 1 and state' = P * state.
   */
  function movePermutation(move) {
    var turns = move.indexOf('2') >= 0 ? 2 : 1;
    var face = move[0];
    var prime = move.indexOf("'") >= 0;
    var base = MOVE_DEFS[face];
    var sign = base.sign * (prime ? -1 : 1);
    var axisIndex = base.axis === 'x' ? 0 : base.axis === 'y' ? 1 : 2;
    var quarter = [];
    for (var i = 0; i < 54; i++) {
      var cell = CELLS[i];
      if (cell.pos[axisIndex] !== base.layer) {
        quarter[i] = i;
      } else {
        quarter[i] = cellIndex(
          rotate90(cell.pos, base.axis, sign),
          rotate90(cell.normal, base.axis, sign)
        );
      }
    }
    var perm = [];
    for (var j = 0; j < 54; j++) perm[j] = j;
    for (var k = 0; k < turns; k++) {
      var next = new Array(54);
      for (var old = 0; old < 54; old++) next[old] = quarter[perm[old]];
      perm = next;
    }
    return perm;
  }

  var PERMUTATIONS = {};
  ALL_MOVES.forEach(function (m) { PERMUTATIONS[m] = movePermutation(m); });

  function applyPermutation(state, perm) {
    var next = new Array(54);
    for (var i = 0; i < 54; i++) next[perm[i]] = state[i];
    return next;
  }

  function applyMove(state, move) {
    var perm = PERMUTATIONS[move] || movePermutation(move);
    return applyPermutation(state, perm);
  }

  function applyMoves(state, moves) {
    var next = state;
    for (var i = 0; i < moves.length; i++) next = applyMove(next, moves[i]);
    return next;
  }

  function invertMove(move) {
    if (move.indexOf('2') >= 0) return move;
    return move[0] + (move.indexOf("'") >= 0 ? '' : "'");
  }

  function invertMoves(moves) {
    return moves.slice().reverse().map(invertMove);
  }

  function isSolved(state) {
    for (var f = 0; f < 6; f++) {
      var color = state[f * 9 + 4];
      for (var i = 0; i < 9; i++) {
        if (state[f * 9 + i] !== color) return false;
      }
    }
    return true;
  }

  function countSolvedFaces(state) {
    var count = 0;
    for (var f = 0; f < 6; f++) {
      var color = state[f * 9 + 4], ok = true;
      for (var i = 0; i < 9; i++) if (state[f * 9 + i] !== color) { ok = false; break; }
      if (ok) count++;
    }
    return count;
  }

  function faceMatrix(state, face) {
    var base = FACE_INDEX[face] * 9;
    return [
      state.slice(base, base + 3),
      state.slice(base + 3, base + 6),
      state.slice(base + 6, base + 9)
    ];
  }

  function stateMatrix(state) {
    var rows = [];
    for (var f = 0; f < 6; f++) rows.push(state.slice(f * 9, f * 9 + 9));
    return rows;
  }

  function toFaceletString(state) {
    return state.join('');
  }

  function fromFaceletString(str) {
    if (typeof str !== 'string' || str.length !== 54) throw new Error('Facelet string must have 54 characters');
    var state = str.toUpperCase().split('');
    for (var i = 0; i < 54; i++) {
      if (FACES.indexOf(state[i]) < 0) throw new Error('Invalid facelet color: ' + state[i]);
    }
    return state;
  }

  function randomScramble(length) {
    length = length || 20;
    var moves = [];
    var faces = ['U', 'R', 'F', 'D', 'L', 'B'];
    var prev = '';
    var prev2 = '';
    while (moves.length < length) {
      var f = faces[Math.floor(Math.random() * 6)];
      if (f === prev) continue;
      if (prev2 && f === prev2 && axisOf(f) === axisOf(prev)) continue;
      var suffix = ['', '2', "'"][Math.floor(Math.random() * 3)];
      moves.push(f + suffix);
      prev2 = prev;
      prev = f;
    }
    return moves;
  }

  function axisOf(face) {
    if (face === 'U' || face === 'D' || face === 'E') return 'y';
    if (face === 'R' || face === 'L' || face === 'M') return 'x';
    return 'z';
  }

  function moveFamily(move) {
    var f = move[0];
    return {
      face: f,
      axis: axisOf(f),
      isDouble: move.indexOf('2') >= 0,
      isPrime: move.indexOf("'") >= 0,
      turns: move.indexOf('2') >= 0 ? 2 : 1
    };
  }

  // Build the full 54x54 permutation matrix for a move.
  function permutationMatrix(move) {
    var perm = PERMUTATIONS[move] || movePermutation(move);
    var matrix = [];
    for (var r = 0; r < 54; r++) matrix.push(new Array(54).fill(0));
    for (var c = 0; c < 54; c++) matrix[perm[c]][c] = 1;
    return matrix;
  }

  // Product of permutations for moves[0..n-1]: old index -> final index.
  function sequencePermutation(moves) {
    var labels = [];
    for (var i = 0; i < 54; i++) labels.push(i);
    moves.forEach(function (m) {
      var perm = PERMUTATIONS[m] || movePermutation(m);
      var next = new Array(54);
      for (var i = 0; i < 54; i++) next[i] = perm[labels[i]];
      labels = next;
    });
    return labels;
  }

  // Human-readable move description.
  function describeMove(move) {
    var face = move[0];
    var suffix = move.slice(1);
    var names = { U: '上', R: '右', F: '前', D: '下', L: '左', B: '后' };
    var sliceNames = { M: 'M 中层（随 L）', E: 'E 赤道层（随 D）', S: 'S 站立层（随 F）' };
    var amount = suffix === '2' ? '180°' : suffix === "'" ? '逆时针 90°' : '顺时针 90°';
    return (sliceNames[face] || (names[face] + '层')) + ' · ' + amount;
  }

  return {
    FACES: FACES,
    FACE_INDEX: FACE_INDEX,
    NORMALS: NORMALS,
    COLORS: COLORS,
    DARK: DARK,
    COLOR_NAMES: COLOR_NAMES,
    CELLS: CELLS,
    MOVE_DEFS: MOVE_DEFS,
    ALL_MOVES: ALL_MOVES,
    PERMUTATIONS: PERMUTATIONS,
    solvedState: solvedState,
    colorCounts: colorCounts,
    validateState: validateState,
    cellIndex: cellIndex,
    rotate90: rotate90,
    rotateWholeCube: rotateWholeCube,
    normalizeCenters: normalizeCenters,
    parseMove: parseMove,
    parseMoves: parseMoves,
    movesToString: movesToString,
    movePermutation: movePermutation,
    permutationMatrix: permutationMatrix,
    applyMove: applyMove,
    applyMoves: applyMoves,
    applyPermutation: applyPermutation,
    invertMove: invertMove,
    invertMoves: invertMoves,
    isSolved: isSolved,
    countSolvedFaces: countSolvedFaces,
    faceMatrix: faceMatrix,
    stateMatrix: stateMatrix,
    toFaceletString: toFaceletString,
    fromFaceletString: fromFaceletString,
    randomScramble: randomScramble,
    sequencePermutation: sequencePermutation,
    axisOf: axisOf,
    moveFamily: moveFamily,
    describeMove: describeMove
  };
});
