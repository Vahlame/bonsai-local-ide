import {fahrenheitToCelsius} from './units.mjs';
export function convert(value, unit) {
  if (unit === 'C') return value;
  if (unit === 'F') return fahrenheitToCelsius(value);
  throw new Error('Unknown unit');
}
