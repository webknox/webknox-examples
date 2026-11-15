import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {csvCell, csvRecords, csvRows} from '../lib/csv.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('quoted fields keep their commas, quotes and line breaks', () => {
  const rows = [...csvRows('"a","b, with comma","c ""quoted"""\n"multi\nline",2,\n')];
  assert.deepEqual(rows, [
    ['a', 'b, with comma', 'c "quoted"'],
    ['multi\nline', '2', ''],
  ]);
});

test('CRLF line ends, a byte order mark and a last line without a newline', () => {
  assert.deepEqual([...csvRows('﻿x,y\r\n1,2\r\n3,4')], [['x', 'y'], ['1', '2'], ['3', '4']]);
});

test('records are keyed by the header and blank lines are skipped', () => {
  const records = [...csvRecords('"id","name"\n\n"1","Beef, ""steak"""\n')];
  assert.deepEqual(records, [{id: '1', name: 'Beef, "steak"'}]);
});

test('reads the SR Legacy fixture with commas and quotes inside descriptions', () => {
  const foods = [...csvRecords(fixture('food.csv'))];
  assert.equal(foods.length, 8);
  assert.equal(foods[0].description, 'Cheese, cheddar, sharp, sliced');
  assert.equal(foods[3].description, 'Beef, "steak", trimmed to 0" fat, raw');
  const nutrients = [...csvRecords(fixture('food_nutrient.csv'))];
  assert.equal(nutrients.at(-1).footnote, 'a footnote, with a comma');
});

test('csvCell quotes only when it must', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a, b'), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(12.5), '12.5');
});
