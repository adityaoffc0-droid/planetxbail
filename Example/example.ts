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

/* =======================
   GLOBAL START TEXT
======================= */
console.log(`
====================================
█▀█ █░ ▄▀█ █▄░█ █▀▀ ▀█▀
█▀▀ █▄ █▀█ █░▀█ ██▄ ░█░
ᗯᗴᒪᑕOᗰᗴ TO ᗷᗩIᒪᗴYՏ planet

ᴛᴇʟᴇɢʀᴀᴍ : @planetoffc
ᴄʜᴀɴᴇᴇʟ : @zisneed
ᴠᴇʀsɪᴏɴ ʙᴀɪʟᴇʏs : 2.0

sᴇʟᴀᴍᴀᴛ ᴍᴇɴɢɢᴜɴᴀᴋᴀɴ ʙᴀɪʟᴇʏsɴʏᴀ
====================================
`)

/* =======================
   LOGGER (Optimized for Speed)
======================= */
const logger = P({
  level: "error", // Mengurangi overhead I/O dengan hanya mencatat error
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

// Cache dengan performa tinggi (tanpa cloning untuk akses memori instan)
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
    generateHighQualityLinkPreview: false, // Mempercepat pengiriman pesan tanpa preview berat
    syncFullHistory: false, // Mencegah bot lambat karena sinkronisasi chat lama
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
          console.log('🔄 Reconnecting for stability...')
          startSock()
        } else {
          console.log('❌ Logged out.')
        }
      }

      if (connection === 'open') {
        console.log('✅ Connected to WhatsApp!')
      }

      /* ===== PAIRING (Optimized) ===== */
      if (qr && usePairingCode && !sock.authState.creds.registered) {
        const phoneNumber = process.env.WA_NUMBER || '628xxxxxxxxxx'
        // Delay singkat untuk memastikan socket siap meminta code
        setTimeout(async () => {
            const realCode = await sock.requestPairingCode(phoneNumber)
            console.log(`
====================================
📱 PAIRING CODE : ${realCode}
====================================
            `)
        }, 2000)
      }
    }

    /* ===== CREDS UPDATE ===== */
    if (events['creds.update']) {
      await saveCreds()
    }

    /* ===== MESSAGE HANDLING (Turbo Mode) ===== */
    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert']

      if (type === 'notify') {
        // Gunakan for-of dengan eksekusi async non-blocking agar ribuan pesan tidak antre
        for (const msg of messages) {
          if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key.remoteJid!)) {
            
            // Eksekusi tanpa await di sini agar loop lanjut ke pesan berikutnya segera
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

  /* ===== GET MESSAGE (Fast Proto) ===== */
  async function getMessage(_: WAMessageKey): Promise<WAMessageContent | undefined> {
    return proto.Message.fromObject({ conversation: 'PLANET-BOT' })
  }
}

// Start bot
startSock().catch(err => console.error('❌ Socket failed', err))
