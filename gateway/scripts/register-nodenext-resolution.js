// ts-node's CommonJS resolver doesn't understand the `.js`-suffixed relative imports that
// `nodenext` module resolution requires TypeScript source to use (Prisma's generated client
// is written that way). This mirrors the `moduleNameMapper` fix already applied for Jest in
// package.json/test/jest-e2e.json — copied from deeptalk-api-v3.
const Module = require('module');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  try {
    return originalResolveFilename.call(this, request, ...rest);
  } catch (error) {
    if (request.endsWith('.js') && (request.startsWith('./') || request.startsWith('../'))) {
      return originalResolveFilename.call(this, request.slice(0, -3), ...rest);
    }
    throw error;
  }
};
