import { boundaryApp } from '../../server/app'
import { errorResponse, toNodeHandler } from '../../server/http'

/**
 * POST /api/model/call — the single server-side entry point for every model
 * call. Provider keys live only behind this handler; the client bundle has no
 * way to reach a provider directly.
 *
 * Thin on purpose: parse, delegate, map errors. All the rules are in
 * `server/`, where they can be tested without HTTP.
 */
export default toNodeHandler(async (request) => {
  try {
    return await boundaryApp().handleModelCall(request)
  } catch (err) {
    // Reached only when app construction itself fails (e.g. no signing secret).
    return errorResponse(err)
  }
})
