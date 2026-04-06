import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeVynaaSocket, {
        CacheStore,
        DEFAULT_CONNECTION_CONFIG,
        DisconnectReason,
        fetchLatestBaileysVersion,
        generateMessageIDV2,
        getAggregateVotesInPollMessage,
        isJidNewsletter,
        makeCacheableSignalKeyStore,
        proto,
        useMultiFileAuthState,
        type WAMessageContent,
        type WAMessageKey
} from '../src'
import P from 'pino'

const logger = P({
        level: 'trace',
        transport: {
                targets: [
                        {
                                target: 'pino-pretty',
                                options: { colorize: true },
                                level: 'trace'
                        },
                        {
                                target: 'pino/file',
                                options: { destination: './vynaa-logs.txt' },
                                level: 'trace'
                        }
                ]
        }
})
logger.level = 'trace'

const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

// External map to track message retry counts across socket restarts
const msgRetryCounterCache = new NodeCache() as CacheStore

// Read line interface for terminal input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>(resolve => rl.question(text, resolve))

const startSocket = async () => {
        const { state, saveCreds } = await useMultiFileAuthState('vynaa_auth_info')

        // Only used for unit testing purposes
        if (process.env.ADV_SECRET_KEY) {
                state.creds.advSecretKey = process.env.ADV_SECRET_KEY
        }

        // Fetch the latest WhatsApp Web version
        const { version, isLatest } = await fetchLatestBaileysVersion()
        logger.debug({ version: version.join('.'), isLatest }, 'using latest WA version')

        const sock = makeVynaaSocket({
                version,
                logger,
                waWebSocketUrl: process.env.SOCKET_URL ?? DEFAULT_CONNECTION_CONFIG.waWebSocketUrl,
                auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                msgRetryCounterCache,
                generateHighQualityLinkPreview: true,
                getMessage
        })

        // Process all events in a single efficient batch
        sock.ev.process(async events => {
                // Connection state changed (WS closed/opened/connecting)
                if (events['connection.update']) {
                        const { connection, lastDisconnect, qr } = events['connection.update']

                        if (connection === 'close') {
                                const shouldReconnect =
                                        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
                                if (shouldReconnect) {
                                        startSocket()
                                } else {
                                        logger.fatal('Connection closed. You are logged out.')
                                }
                        }

                        if (qr && usePairingCode && !sock.authState.creds.registered) {
                                const phoneNumber = await question('Please enter your phone number:\n')
                                const code = await sock.requestPairingCode(phoneNumber)
                                console.log(`Pairing code: ${code}`)
                        }

                        logger.debug(events['connection.update'], 'connection update')
                }

                // Save credentials whenever they update
                if (events['creds.update']) {
                        await saveCreds()
                        logger.debug({}, 'creds saved')
                }

                if (events['labels.association']) {
                        logger.debug(events['labels.association'], 'labels.association event')
                }

                if (events['labels.edit']) {
                        logger.debug(events['labels.edit'], 'labels.edit event')
                }

                if (events['call']) {
                        logger.debug(events['call'], 'call event')
                }

                // History sync received
                if (events['messaging-history.set']) {
                        const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
                        if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
                                logger.debug(messages, 'received on-demand history sync')
                        }
                        logger.debug(
                                { contacts: contacts.length, chats: chats.length, messages: messages.length, isLatest, progress, syncType: syncType?.toString() },
                                'messaging-history.set event'
                        )
                }

                // New or updated messages received
                if (events['messages.upsert']) {
                        const upsert = events['messages.upsert']
                        logger.debug(upsert, 'messages.upsert fired')

                        if (upsert.requestId) {
                                logger.debug(upsert, 'placeholder request message received')
                        }

                        if (upsert.type === 'notify') {
                                for (const msg of upsert.messages) {
                                        const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text
                                        if (!text) continue

                                        if (text === 'requestPlaceholder' && !upsert.requestId) {
                                                const messageId = await sock.requestPlaceholderResend(msg.key)
                                                logger.debug({ id: messageId }, 'requested placeholder resync')
                                        }

                                        if (text === 'onDemandHistSync') {
                                                const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!)
                                                logger.debug({ id: messageId }, 'requested on-demand history resync')
                                        }

                                        if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key?.remoteJid!)) {
                                                const id = generateMessageIDV2(sock.user?.id)
                                                logger.debug({ id, orig_id: msg.key.id }, 'replying to message')
                                                await sock.sendMessage(msg.key.remoteJid!, { text: 'pong ' + msg.key.id }, { messageId: id })
                                        }
                                }
                        }
                }

                // Message status updates (read, delivered, deleted, etc.)
                if (events['messages.update']) {
                        logger.debug(events['messages.update'], 'messages.update fired')

                        for (const { key, update } of events['messages.update']) {
                                if (update.pollUpdates) {
                                        const pollCreation: proto.IMessage = {}
                                        if (pollCreation) {
                                                console.log(
                                                        'got poll update, aggregation: ',
                                                        getAggregateVotesInPollMessage({
                                                                message: pollCreation,
                                                                pollUpdates: update.pollUpdates
                                                        })
                                                )
                                        }
                                }
                        }
                }

                if (events['message-receipt.update']) {
                        logger.debug(events['message-receipt.update'])
                }

                if (events['contacts.upsert']) {
                        logger.debug(events['contacts.upsert'], 'contacts.upsert event')
                }

                if (events['messages.reaction']) {
                        logger.debug(events['messages.reaction'])
                }

                if (events['presence.update']) {
                        logger.debug(events['presence.update'])
                }

                if (events['chats.update']) {
                        logger.debug(events['chats.update'])
                }

                if (events['contacts.update']) {
                        for (const contact of events['contacts.update']) {
                                if (typeof contact.imgUrl !== 'undefined') {
                                        const newUrl =
                                                contact.imgUrl === null
                                                        ? null
                                                        : await sock.profilePictureUrl(contact.id!).catch(() => null)
                                        logger.debug({ id: contact.id, newUrl }, 'contact has a new profile pic')
                                }
                        }
                }

                if (events['chats.delete']) {
                        logger.debug('chats deleted ', events['chats.delete'])
                }

                if (events['group.member-tag.update']) {
                        logger.debug('group member tag update', JSON.stringify(events['group.member-tag.update'], undefined, 2))
                }
        })

        return sock

        async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
                // Implement message retrieval from your store here
                return proto.Message.create({ conversation: 'test' })
        }
}

startSocket()
