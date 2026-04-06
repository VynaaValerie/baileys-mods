# VynaaValerie

> A modern TypeScript/Node.js WebSocket library for building WhatsApp bots and automation — fast, lightweight, and ready for production.

---

## Features

- **Full WhatsApp Web API** — connect without a browser or Selenium
- **TypeScript-first** — complete type definitions included
- **End-to-end encryption** — Signal Protocol via libsignal
- **Event-driven architecture** — clean, buffered event system
- **Modular design** — plug in your own auth store, cache, and logger
- **Multi-device support** — works with the modern WhatsApp multi-device API
- **ESM-native** — built for Node.js 20+ with ES Modules

---

## Requirements

| Dependency | Minimum version |
|------------|-----------------|
| Node.js    | `>= 20.0.0`     |

---

## Installation

```bash
npm install vynaavalerie
# or
yarn add vynaavalerie
```

---

## Quick Start

```typescript
import makeVynaaSocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestVersion,
} from 'vynaavalerie'
import { Boom } from '@hapi/boom'

const startSocket = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestVersion()

  const sock = makeVynaaSocket({
    version,
    auth: {
      creds: state.creds,
      keys: state.keys,
    },
  })

  sock.ev.process(async (events) => {
    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update']

      if (qr) {
        console.log('QR:', qr)
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
        if (shouldReconnect) startSocket()
      }
    }

    if (events['creds.update']) {
      await saveCreds()
    }

    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert']
      if (type === 'notify') {
        for (const msg of messages) {
          console.log('Received:', msg.message?.conversation)
        }
      }
    }
  })
}

startSocket()
```

---

## Authentication

File-based multi-device authentication:

```typescript
import { useMultiFileAuthState } from 'vynaavalerie'

const { state, saveCreds } = await useMultiFileAuthState('./auth_folder')
```

Credentials are saved as JSON files. For production, implement your own auth state backed by a real database.

---

## Sending Messages

```typescript
// Plain text
await sock.sendMessage('628123456789@s.whatsapp.net', { text: 'Hello!' })

// Image
await sock.sendMessage('628123456789@s.whatsapp.net', {
  image: { url: './image.jpg' },
  caption: 'Check this out!'
})

// Reply to a message
await sock.sendMessage(
  '628123456789@s.whatsapp.net',
  { text: 'This is a reply' },
  { quoted: originalMsg }
)

// React to a message
await sock.sendMessage('628123456789@s.whatsapp.net', {
  react: { text: '👍', key: msg.key }
})
```

---

## Event System

```typescript
// Batch processing (recommended)
sock.ev.process(async (events) => {
  if (events['messages.upsert']) { /* ... */ }
  if (events['chats.update'])   { /* ... */ }
})

// Individual listener
sock.ev.on('messages.upsert', ({ messages, type }) => {
  console.log('New messages:', messages)
})
```

### Available Events

| Event | Description |
|-------|-------------|
| `connection.update` | Connection state changed (connecting, open, close, QR) |
| `creds.update` | Credentials updated — call `saveCreds()` here |
| `messaging-history.set` | History sync batch received |
| `messages.upsert` | New or incoming messages |
| `messages.update` | Message status updated (read, delivered, deleted) |
| `messages.reaction` | Reaction added/removed |
| `message-receipt.update` | Read/delivery receipt updates |
| `chats.upsert` | New chats received |
| `chats.update` | Chat metadata updated |
| `chats.delete` | Chats deleted |
| `contacts.upsert` | New contacts received |
| `contacts.update` | Contact info updated |
| `groups.upsert` | New group created/joined |
| `groups.update` | Group settings updated |
| `group-participants.update` | Participant added/removed/promoted |
| `presence.update` | Contact presence (online/typing/away) |
| `call` | Incoming call event |
| `labels.edit` | Label edited |
| `labels.association` | Label associated/removed |

---

## Configuration

```typescript
const sock = makeVynaaSocket({
  version,
  auth: { creds, keys },
  logger,
  browser: Browsers.ubuntu('Chrome'),
  connectTimeoutMs: 20_000,
  keepAliveIntervalMs: 30_000,
  defaultQueryTimeoutMs: 60_000,
  generateHighQualityLinkPreview: true,
  syncFullHistory: false,
  getMessage: async (key) => undefined,
  cachedGroupMetadata: async (jid) => undefined,
})
```

---

## Browser Identities

```typescript
import { Browsers } from 'vynaavalerie'

Browsers.ubuntu('Chrome')          // Ubuntu + Chrome
Browsers.macOS('Safari')           // Mac OS + Safari
Browsers.windows('Edge')           // Windows + Edge
Browsers.vynaavalerie('Node')      // VynaaValerie identity
Browsers.appropriate('Chrome')     // Auto-detect OS
```

---

## Group & Community Management

```typescript
// Create group
const group = await sock.groupCreate('My Group', ['628123456789@s.whatsapp.net'])

// Get group metadata
const meta = await sock.groupMetadata('12345@g.us')

// Add/remove participants
await sock.groupParticipantsUpdate('12345@g.us', ['628123456789@s.whatsapp.net'], 'add')

// Get invite link
const code = await sock.groupInviteCode('12345@g.us')
```

---

## Media Upload & Download

```typescript
import { downloadContentFromMessage } from 'vynaavalerie'

// Download media
const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image')

// Send from buffer
await sock.sendMessage('628123456789@s.whatsapp.net', {
  image: buffer,
  caption: 'Image'
})
```

---

## Pairing Code (no QR)

```typescript
if (!sock.authState.creds.registered) {
  const code = await sock.requestPairingCode('+628123456789')
  console.log('Pairing code:', code)
}
```

---

## TypeScript Types

```typescript
import type {
  VynaaSocket,
  VynaaEventMap,
  VynaaEventEmitter,
  SocketConfig,
  WAMessage,
  WAMessageKey,
  AuthenticationState,
  GroupMetadata,
  Contact,
  DisconnectReason,
} from 'vynaavalerie'
```

---

## Running the Example

```bash
npm run example

# With pairing code instead of QR
npm run example -- --use-pairing-code

# Auto-reply to incoming messages
npm run example -- --do-reply
```

Auth credentials will be saved to `vynaa_auth_info/` automatically.

---

## Build

```bash
npm run build    # compile TypeScript to lib/
npm test         # run unit tests
npm run lint     # run linter
```

---

## License

MIT — © VynaaValerie
