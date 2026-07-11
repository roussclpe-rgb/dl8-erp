const test = require("node:test");
const assert = require("node:assert/strict");
const { aMinorPEN } = require("../src/services/finanzas/montos");

test("PEN usa enteros y redondeo decimal half-up", () => {
  assert.equal(aMinorPEN("10"), 1000);
  assert.equal(aMinorPEN("10.004"), 1000);
  assert.equal(aMinorPEN("10.005"), 1001);
  assert.equal(aMinorPEN(0.1), 10);
  assert.throws(() => aMinorPEN(-1), /inválido/);
  assert.throws(() => aMinorPEN("1e3"), /inválido/);
});
