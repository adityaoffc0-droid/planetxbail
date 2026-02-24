import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache' 
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isJidNewsletter,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  Browsers 
} from '@whiskeysockets/baileys'
import P from 'pino'

const displayBanner = () => {
  process.stdout.write('\x1Bc'); 
  console.log(`
\x1b[35m   //==============//
  //   \x1b[37mPLANETBAIL\x1b[35m  //
 //==============//\x1b[0m

\x1b[36m█▀█ █░ ▄▀█ █▄░█ █▀▀ ▀█▀
█▀▀ █▄ █▀█ █░▀█ ██▄ ░█░\x1b[0m

\x1b[33m𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝗣𝗟𝗔𝗡𝗘𝗧 𝗕𝗔𝗜𝗟𝗘𝗬𝗦! \x1b[0m
──────────────────────────────────────
\x1b[34m𝄞 Baileys By  :\x1b[0m PlanetOffc
\x1b[34mTelegram      :\x1b[0m @planetoffc
\x1b[34mChannel       :\x1b[0m @zisneed
\x1b[34mVersion       :\x1b[0m 109.8.0.1
──────────────────────────────────────
\x1b[32mSelamat menggunakan baileys planet :=)\x1b[0m
\x1b[90m[ 😋 ]\x1b[0m
`)
}

const logger = P({ level: "silent" })

const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

const msgRetryCounterCache = new NodeCache()

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
  const { version, isLatest } = await fetchLatestBaileysVersion()

  displayBanner()
  console.log(`\x1b[36musing WA v${version.join('.')}, isLatest: ${isLatest}\x1b[0m`)

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !usePairingCode, 
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    browser: Browsers.ubuntu('Chrome'), 
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: 60000, 
    getMessage: async (key) => {
        return { conversation: 'PLANET-BOT' }
    }
  })

  if (usePairingCode && !sock.authState.creds.registered) {
    const phoneNumber = process.env.WA_NUMBER || '628xxxxxxxxxx'
    if(phoneNumber === '628xxxxxxxxxx') {
        console.log('\x1b[31m❌ Mohon set WA_NUMBER di environment variable!\x1b[0m')
    } else {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber)
            code = code?.match(/.{1,4}/g)?.join('-') || code
            console.log(`\n\x1b[44m\x1b[37m PAIRING CODE \x1b[0m \x1b[1m\x1b[33m ${code} \x1b[0m\n`)
        }, 3000)
    }
  }

  sock.ev.process(async (events) => {

    if (events['connection.update']) {
      const { connection, lastDisconnect } = events['connection.update']

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
        console.log('\x1b[33m🔄 Connection closed due to ', lastDisconnect?.error, ', reconnecting: ', shouldReconnect, '\x1b[0m')
        if (shouldReconnect) {
          startSock()
        } else {
          console.log('\x1b[31m❌ Session Logged Out. Hapus folder auth_info dan scan ulang.\x1b[0m')
        }
      }

      if (connection === 'open') {
        console.log('\x1b[32m✅ SUCCESS: Connected to WhatsApp!\x1b[0m')
      }
    }

    if (events['creds.update']) {
      await saveCreds()
    }

    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert']
      if (type === 'notify') {
        for (const msg of messages) {
          if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key.remoteJid!)) {
            try {
              const id = generateMessageIDV2(sock.user?.id)
              await sock.sendMessage(msg.key.remoteJid!, { text: `pong` }, { quoted: msg, messageId: id })
            } catch (err) {
              console.error('Error sending reply:', err)
            }
          }
        }
      }
    }
  })

  return sock
}

startSock().catch(err => console.error('\x1b[31m❌ Socket failed\x1b[0m', err))
