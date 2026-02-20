import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import makeWASocket, {
  CacheStore,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isJidNewsletter,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState,
  WAMessageContent,
  WAMessageKey
} from '../src'
import P from 'pino'

/* =======================================================
   DISPLAY BANNER (Berlaku untuk semua jenis panel)
======================================================= */
const displayBanner = () => {
  console.clear() // Membersihkan sampah log sebelumnya
  console.log(`
\x1b[35m   //==============//
  //   \x1b[37mPLANETBAIL\x1b[35m  //
 //==============//\x1b[0m

\x1b[36m█▀█ █░ ▄▀█ █▄░█ █▀▀ ▀█▀
█▀▀ █▄ █▀█ █░▀█ ██▄ ░█░\x1b[0m

\x1b[33m𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝗣𝗟𝗔𝗡𝗘𝗧 𝗕𝗔𝗜𝗟𝗘𝗬𝗦! \x1b[0m
──────────────────────────────────────
\x1b[34m𝄞 Baileys By  :\x1b[0m PlanetOffc
\x1b[34mTelegram    :\x1b[0m @planetoffc
\x1b[34mChannel     :\x1b[0m @zisneed
\x1b[34mVersion     :\x1b[0m 2.0 
──────────────────────────────────────
\x1b[32mSelamat menggunakan baileys planet :=)\x1b[0m
`)
}

// Panggil Banner di awal
displayBanner()

/* =======================
   LOGGER (Optimized)
======================= */
const logger = P({
  level: "error", 
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: { colorize: true },
        level: "error",
      },
    ],
  },
})

const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

const msgRetryCounterCache = new NodeCache({ 
  stdTTL: 0, 
  checkperiod: 0, 
  useClones: false 
}) as CacheStore

/* =======================
   START SOCKET
======================= */
const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    waWebSocketUrl: process.env.SOCKET_URL ?? DEFAULT_CONNECTION_CONFIG.waWebSocketUrl,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: undefined,
    getMessage
  })

  sock.ev.process(async (events) => {

    /* ===== CONNECTION UPDATE ===== */
    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update']

      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode
        if (code !== DisconnectReason.loggedOut) {
          console.log('\x1b[33m🔄 Reconnecting for stability...\x1b[0m')
          startSock()
        } else {
          console.log('\x1b[31m❌ Logged out.\x1b[0m')
        }
      }

      if (connection === 'open') {
        console.log('\x1b[32m✅ Connected successfully to WhatsApp!\x1b[0m')
      }

      /* ===== PAIRING CODE (Optimized Visual) ===== */
      if (qr && usePairingCode && !sock.authState.creds.registered) {
        const phoneNumber = process.env.WA_NUMBER || '628xxxxxxxxxx'
        setTimeout(async () => {
            const realCode = await sock.requestPairingCode(phoneNumber)
            console.log(`
\x1b[44m\x1b[37m  PAIRING CODE ANDA  \x1b[0m
\x1b[1m\x1b[33m> ${realCode} <\x1b[0m
            `)
        }, 3000)
      }
    }

    if (events['creds.update']) {
      await saveCreds()
    }

    /* ===== MESSAGE HANDLING (Turbo Mode) ===== */
    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert']

      if (type === 'notify') {
        for (const msg of messages) {
          if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key.remoteJid!)) {
            (async () => {
              const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
              if (!text) return
              
              const id = generateMessageIDV2(sock.user?.id)
              await sock.sendMessage(
                msg.key.remoteJid!, 
                { text: `pong ${msg.key.id}` }, 
                { messageId: id }
              )
            })().catch(err => logger.error(err))
          }
        }
      }
    }
  })

  return sock

  async function getMessage(_: WAMessageKey): Promise<WAMessageContent | undefined> {
    return proto.Message.fromObject({ conversation: 'PLANET-BOT' })
  }
}

startSock().catch(err => console.error('\x1b[31m❌ Socket failed\x1b[0m', err))
