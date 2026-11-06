/* Worker tail: runs after the bundled cubejs source. */
(function () {
  'use strict';

  var PHASE2 = {
    U: 1, U2: 1, "U'": 1,
    D: 1, D2: 1, "D'": 1,
    R2: 1, L2: 1, F2: 1, B2: 1
  };

  function isG1(cube) {
    if (!cube || !cube.co || !cube.eo || !cube.ep) return false;
    for (var i = 0; i < 8; i++) if (cube.co[i] !== 0) return false;
    for (var j = 0; j < 12; j++) if (cube.eo[j] !== 0) return false;
    var slice = cube.ep.slice(8, 12).slice().sort(function (a, b) { return a - b; });
    return slice[0] === 8 && slice[1] === 9 && slice[2] === 10 && slice[3] === 11;
  }

  function phase2Only(moves, from) {
    for (var i = from; i < moves.length; i++) {
      if (!PHASE2[moves[i]]) return false;
    }
    return true;
  }

  self.onmessage = function (event) {
    var msg = event.data || {};
    if (msg.type === 'init') {
      try {
        var t0 = performance.now();
        CubeJS.initSolver();
        self.postMessage({ type: 'ready', initMs: performance.now() - t0 });
      } catch (err) {
        self.postMessage({ type: 'error', scope: 'init', message: String(err && err.stack || err) });
      }
      return;
    }

    if (msg.type === 'solve') {
      try {
        var start = performance.now();
        var cube = CubeJS.fromString(msg.facelets);
        var solution = cube.solve();
        var moves = solution ? solution.split(' ').filter(Boolean) : [];

        // Phase 1 targets G1 relative to the solver's upright frame. If slice
        // moves rotated the centers, the returned face labels live in a
        // rotated frame, so a prefix check in the original frame is not
        // meaningful. In that case return 0 and let the UI show one sequence.
        var centersCanonical = cube.center.every(function (value, index) {
          return value === index;
        });
        var probe = cube.clone();
        var boundary = centersCanonical ? moves.length : 0;
        if (centersCanonical) {
          for (var i = 0; i <= moves.length; i++) {
            if (i > 0) probe.move(moves[i - 1]);
            if (isG1(probe) && phase2Only(moves, i)) {
              boundary = i;
              break;
            }
          }
        }

        self.postMessage({
          type: 'solution',
          requestId: msg.requestId,
          solution: moves,
          phase1Length: boundary,
          solveMs: performance.now() - start
        });
      } catch (err) {
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          scope: 'solve',
          message: String(err && err.message || err)
        });
      }
    }
  };
})();
