import { boundaryApp } from '../../server/app'
import { errorResponse, toNodeHandler } from '../../server/http'

/**
 * POST /api/identity/token — mint a signed subject token, once per subject.
 * See `server/identity/mint.ts` for the trust-on-first-use rule this enforces.
 */
export default toNodeHandler(async (request) => {
  try {
    return await boundaryApp().handleMintToken(request)
  } catch (err) {
    return errorResponse(err)
  }
})
