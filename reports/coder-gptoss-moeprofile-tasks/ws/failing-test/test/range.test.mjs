import assert from 'node:assert/strict';
import {range} from '../src/range.mjs'; assert.deepEqual(range(3),[0,1,2]); assert.deepEqual(range(0),[]);
