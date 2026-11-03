// cases.json の全ケース（38件）を検証する。期待値は書き換えないこと
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcBimonthly, calcProrated, judgeContract, buildPdfFilename } from '../js/calc.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/cases.json', import.meta.url), 'utf8'));

describe('bimonthly（2か月分）', () => {
  for (const c of cases.bimonthly) {
    test(c.id, () => {
      const r = calcBimonthly(c.input);
      assert.deepEqual(
        { months: r.months, water: r.water, sewer: r.sewer, total: r.total },
        c.expected,
      );
    });
  }
});

describe('prorated（日割り）', () => {
  for (const c of cases.prorated) {
    test(c.id, () => {
      const r = calcProrated(c.input);
      assert.deepEqual({
        converted: r.converted,
        water_monthly_pretax: r.waterMonthlyPretax,
        water_prorated_pretax: r.waterProratedPretax,
        water_total: r.waterTotal,
        sewer_base: r.sewerBase,
        sewer_metered: r.sewerMetered,
        sewer_total: r.sewerTotal,
        total: r.total,
      }, c.expected);
    });
  }
});

describe('judgement（判定）', () => {
  for (const c of cases.judgement) {
    test(c.id, () => {
      const r = judgeContract(c.input);
      assert.deepEqual(
        { water: r.water.judge, sewer: r.sewer.judge, overall: r.overall },
        c.expected,
      );
    });
  }
});

describe('filename（PDFファイル名）', () => {
  for (const c of cases.filename) {
    test(c.id, () => {
      const r = buildPdfFilename(c.input.buildingId, c.input.contracts);
      assert.equal(r.ok ? r.filename : null, c.expected);
    });
  }
});
