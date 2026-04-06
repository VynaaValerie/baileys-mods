import { DEFAULT_CONNECTION_CONFIG } from '../Defaults'
import type { UserFacingSocketConfig } from '../Types'
import { makeCommunitiesSocket } from './communities'

/**
 * Creates a VynaaValerie socket connection to WhatsApp Web.
 * Merges user-provided config with sensible defaults.
 */
const makeVynaaSocket = (config: UserFacingSocketConfig) => {
        const fullConfig = {
                ...DEFAULT_CONNECTION_CONFIG,
                ...config
        }

        return makeCommunitiesSocket(fullConfig)
}

export default makeVynaaSocket
