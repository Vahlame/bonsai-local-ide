import assert from 'node:assert/strict';
import {convert} from '../src/index.mjs'; assert.equal(convert(32,'F'),0); assert.equal(convert(8,'C'),8);
