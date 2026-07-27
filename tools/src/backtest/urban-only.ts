// Calibration loop helper: run only the urban target with fewer seeds.
import { urbanRatio } from './targets';

const r = urbanRatio(12);
console.log(r.detail);
console.log(r.pass ? 'PASS' : 'FAIL');
