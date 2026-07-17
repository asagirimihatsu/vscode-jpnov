// Entry for `node --import ./test/register.mjs --test …` (all test scripts route through it).
import { register } from 'node:module';

register(new URL('./resolve-hooks.mjs', import.meta.url));
