export {
  registerClient,
  authenticateClient,
  requestGrant,
  introspectToken,
  revokeToken,
  rotateToken,
  hasScope,
  clearGnapStore,
} from './gnap.js';
export type { AccessScope, AccessToken, GrantRequest, GrantResponse } from './gnap.js';
export { requireScope } from './gnap-middleware.js';
