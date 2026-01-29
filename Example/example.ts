import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeWASocket, {
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
  WAMessageContent,
  WAMessageKey
} from '../src'
import P from 'pino'

/* =======================
   GLOBAL START TEXT
   (WA + TELEGRAM)
======================= */
console.clear()
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
   LOGGER
======================= */
const logger = P({
  level: "trace",
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: { colorize: true },
        level: "trace",
      },
      {
        target: "pino/file",
        options: { destination: './wa-logs.txt' },
        level: "trace",
      },
    ],
  },
})

const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

const msgRetryCounterCache = new NodeCache() as CacheStore

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>(resolve => rl.question(text, resolve))

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
    generateHighQualityLinkPreview: true,
    getMessage
  })

  sock.ev.process(async (events) => {

    /* ===== CONNECTION ===== */
    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update']

      if (connection === 'close') {
        if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
          startSock()
        } else {
          logger.fatal('Logged out.')
        }
      }

      if (connection === 'open') {
        console.log(`
█▀█ █░ ▄▀█ █▄░█ █▀▀ ▀█▀
█▀▀ █▄ █▀█ █░▀█ ██▄ ░█░
Welcome To Baileys Planet
Telegram : @planetoffc
        `)
      }

      /* ===== PAIRING ===== */
      if (qr && usePairingCode && !sock.authState.creds.registered) {
        console.log(`
====================================
𝐏𝐋𝐀𝐍𝐄𝐓 - 𝐎𝐅𝐅𝐈𝐂𝐈𝐀𝐋 - 𝐁𝐀𝐈𝐋𝐄𝐘𝐒 - 𝐕𝐈𝐏
====================================
        `)

        const phoneNumber = await question('📱 Masukkan Nomor WhatsApp:\n')
        const realCode = await sock.requestPairingCode(phoneNumber)

        console.log(`
====================================
📲 Code WhatsApp   : ${realCode}
====================================
        `)
      }
    }

    /* ===== CREDS ===== */
    if (events['creds.update']) {
      await saveCreds()
    }

    /* ===== MESSAGE ===== */
    if (events['messages.upsert']) {
      const upsert = events['messages.upsert']

      if (upsert.type === 'notify') {
        for (const msg of upsert.messages) {
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text

          if (!text) continue

          if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key.remoteJid!)) {
            const id = generateMessageIDV2(sock.user?.id)
            await sock.sendMessage(
              msg.key.remoteJid!,
              { text: `pong ${msg.key.id}` },
              { messageId: id }
            )
          }
        }
      }
    }

  })

  return sock

  async function getMessage(_: WAMessageKey): Promise<WAMessageContent | undefined> {
    return proto.Message.create({ conversation: 'PLANET-BOT' })
  }
}

startSock()
