require('./settings')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    makeCacheableSignalKeyStore,
    PHONENUMBER_MCC,
    Browsers
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const pino = require('pino')
const pairingCode = true
const useMobile = false
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))
const {
    Boom
} = require('@hapi/boom')
const fs = require('fs')
const axios = require('axios')
const FileType = require('file-type')
const fetch = require('node-fetch')
const PhoneNumber = require('awesome-phonenumber')
const path = require('path')
const {
    smsg,
    getBuffer,
    fetchJson,
    TelegraPh
} = require('./lib/simple')
const {
    isSetClose,
    addSetClose,
    removeSetClose,
    changeSetClose,
    getTextSetClose,
    isSetLeft,
    addSetLeft,
    removeSetLeft,
    changeSetLeft,
    getTextSetLeft,
    isSetOpen,
    addSetOpen,
    removeSetOpen,
    changeSetOpen,
    getTextSetOpen,
    isSetWelcome,
    addSetWelcome,
    removeSetWelcome,
    changeSetWelcome,
    getTextSetWelcome
} = require("./lib/store")
const {
    toAudio,
    toPTT,
    toVideo
} = require('./lib/converter')
const {
    imageToWebp,
    videoToWebp,
    writeExifImg,
    writeExifVid,
    writeExif
} = require('./lib/exif')

// Initialize databases
let set_welcome_db = JSON.parse(fs.readFileSync('./database/set_welcome.json'));
let set_left_db = JSON.parse(fs.readFileSync('./database/set_left.json'));
let _welcome = JSON.parse(fs.readFileSync('./database/welcome.json'));
let _left = JSON.parse(fs.readFileSync('./database/left.json'));
let set_open = JSON.parse(fs.readFileSync('./database/set_open.json'));
let set_close = JSON.parse(fs.readFileSync('./database/set_close.json'));
let antilink = JSON.parse(fs.readFileSync('./database/antilink.json'));
let antiwame = JSON.parse(fs.readFileSync('./database/antiwame.json'));
let antilink2 = JSON.parse(fs.readFileSync('./database/antilink2.json'));
let antiwame2 = JSON.parse(fs.readFileSync('./database/antiwame2.json'));

// Simple in-memory store implementation
const makeInMemoryStore = (options) => {
    const store = {
        messages: {},
        contacts: {},
        chats: {},
        groupMetadata: {},
        bind: (ev) => {
            ev.on('messages.upsert', ({ messages }) => {
                for (const message of messages) {
                    const jid = message.key.remoteJid;
                    if (!store.messages[jid]) store.messages[jid] = [];
                    store.messages[jid].push(message);
                }
            });
            
            ev.on('contacts.update', (updates) => {
                for (const update of updates) {
                    store.contacts[update.id] = update;
                }
            });
            
            ev.on('chats.set', ({ chats }) => {
                for (const chat of chats) {
                    store.chats[chat.id] = chat;
                }
            });
            
            ev.on('groups.update', (updates) => {
                for (const update of updates) {
                    store.groupMetadata[update.id] = update;
                }
            });
        },
        loadMessage: async (jid, id) => {
            return store.messages[jid]?.find(m => m.key.id === id);
        },
        logger: options?.logger || pino().child({ level: 'silent' })
    };
    return store;
};

const store = makeInMemoryStore({
    logger: pino().child({
        level: 'silent',
        stream: 'store'
    })
})

global.api = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({
    ...query,
    ...(apikeyqueryname ? {
        [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name]
    } : {})
})) : '')

function nocache(module, cb = () => {}) {
    fs.watchFile(require.resolve(module), async () => {
        await uncache(require.resolve(module))
        cb(module)
    })
}

function uncache(module = '.') {
    return new Promise((resolve, reject) => {
        try {
            delete require.cache[require.resolve(module)]
            resolve()
        }
        catch (e) {
            reject(e)
        }
    })
}

// JID normalization function
function jidNormalizedUser(jid) {
    if (!jid) return jid;
    if (jid.includes('@s.whatsapp.net')) return jid;
    if (jid.includes('@g.us')) return jid;
    return jid.includes('@') ? jid : jid + '@s.whatsapp.net';
}

async function Botstarted() {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(`./${sessionName}`)
    const { version, isLatest } = await fetchLatestBaileysVersion();
    const msgRetryCounterCache = new NodeCache()
    
    const alpha = makeWASocket({
        version,
        logger: pino({ level: "fatal" }),
        printQRInTerminal: !pairingCode,
        mobile: useMobile, 
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            let jid = jidNormalizedUser(key.remoteJid)
            let msg = await store.loadMessage(jid, key.id)
            return msg?.message || ""
        },
        msgRetryCounterCache,
        defaultQueryTimeoutMs: undefined,
    })

    require('./case')
    nocache('./case', module => console.log(` "${module}" Telah diupdate!`))
    nocache('./settings', module => console.log(` "${module}" Telah diupdate!`))

    store.bind(alpha.ev)

    alpha.ev.on('messages.upsert', async chatUpdate => {
        try {
            mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return
            if (!alpha.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
            m = smsg(alpha, mek, store)
            require("./case")(alpha, m, chatUpdate, store, antilink, antiwame, antilink2, antiwame2, set_welcome_db, set_left_db, set_open, set_close, _welcome, _left)
        }
        catch (err) {
            console.log(err)
        }
    })

    if (pairingCode && !alpha.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')

        let phoneNumber
        if (!!pairingNumber) {
            phoneNumber = pairingNumber.replace(/[^0-9]/g, '')

            if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
                console.log("Start with your country's WhatsApp code, Example : 62xxx")
                process.exit(0)
            }
        } else {
            phoneNumber = await question(`Please type your WhatsApp number : `)
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

            if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
                console.log("Start with your country's WhatsApp code, Example : 62xxx")
                phoneNumber = await question(`Please type your WhatsApp number : `)
                phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
                rl.close()
            }
        }

        setTimeout(async () => {
            let code = await alpha.requestPairingCode(phoneNumber)
            code = code?.match(/.{1,4}/g)?.join("-") || code
            console.log(`Your Pairing Code : `, code)
        }, 3000)
    }

    alpha.ev.on('group-participants.update', async (anu) => {
        const isWelcome = _welcome.includes(anu.id)
        const isLeft = _left.includes(anu.id)
        try {
            let metadata = await alpha.groupMetadata(anu.id)
            let participants = anu.participants
            const groupName = metadata.subject
            const groupDesc = metadata.desc || 'No description'

            for (let num of participants) {
                try {
                    var ppuser = await alpha.profilePictureUrl(num, 'image')
                } catch {
                    var ppuser = 'https://telegra.ph/file/c3f3d2c2548cbefef1604.jpg'
                }

                try {
                    var ppgroup = await alpha.profilePictureUrl(anu.id, 'image')
                } catch {
                    var ppgroup = 'https://telegra.ph/file/c3f3d2c2548cbefef1604.jpg'
                }

                if (anu.action == 'add' && isWelcome) {
                    console.log(anu)
                    let welcome, ppu, ppgc;
                    
                    try {
                        const hmm = await getBuffer(ppuser)
                        const ff = './image/ppuser-1.png'
                        await fs.writeFileSync(ff, hmm)
                        ppu = await TelegraPh(ff)
                    } catch {
                        ppu = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                    }
                    
                    try {
                        const hmm2 = await getBuffer(ppgroup)
                        const fff = './image/ppgc-495.png'
                        await fs.writeFileSync(fff, hmm2)
                        ppgc = await TelegraPh(fff)
                    } catch {
                        ppgc = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                    }
                    
                    try {
                        let res = await fetch(global.api('alfa', '/api/canvas/welcomev2', {
                            avatar: ppu,
                            username: `${encodeURI(num.split("@")[0])}`,
                            background: background,
                            guildname: metadata.subject,
                            membercount: `${encodeURI(metadata.participants.length)}`
                        }, 'apikey'))
                        
                        if (!res.ok) throw await res.text()
                        welcome = await res.buffer()
                    } catch {
                        welcome = await getBuffer("https://telegra.ph/file/0d50687b197cac991115e.jpg")
                    }
                    
                    if (isSetWelcome(anu.id, set_welcome_db)) {
                        var get_teks_welcome = await getTextSetWelcome(anu.id, set_welcome_db)
                        var replace_pesan = get_teks_welcome.replace(/@user/gi, `@${num.split('@')[0]}`)
                        var full_pesan = replace_pesan.replace(/@group/gi, groupName).replace(/@desc/gi, groupDesc)
                        
                        await alpha.sendMessage(anu.id, {
                            image: welcome, 
                            caption: full_pesan, 
                            mentions: [num]
                        })
                    } else {
                        await alpha.sendMessage(anu.id, {
                            image: welcome, 
                            caption: `Halo @${num.split("@")[0]}, Welcome To ${metadata.subject}`, 
                            mentions: [num]
                        })
                    }
                } else if (anu.action == 'remove' && isLeft) {
                    console.log(anu)
                    let goobye, ppu, ppgc;
                    
                    try {
                        const hmm = await getBuffer(ppuser)
                        const ff = './image/ppuser-1.png'
                        await fs.writeFileSync(ff, hmm)
                        ppu = await TelegraPh(ff)
                    } catch {
                        ppu = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                    }
                    
                    try {
                        const hmm2 = await getBuffer(ppgroup)
                        const fff = './image/ppgc-495.png'
                        await fs.writeFileSync(fff, hmm2)
                        ppgc = await TelegraPh(fff)
                    } catch {
                        ppgc = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                    }
                    
                    try {
                        let res = await fetch(global.api('alfa', '/api/canvas/goodbyev2', {
                            avatar: ppu,
                            username: `${encodeURI(num.split("@")[0])}`,
                            background: background,
                            guildname: metadata.subject,
                            membercount: `${encodeURI(metadata.participants.length)}`
                        }, 'apikey'))
                        
                        if (!res.ok) throw await res.text()
                        goobye = await res.buffer()
                    } catch {
                        goobye = await getBuffer("https://telegra.ph/file/0d50687b197cac991115e.jpg")
                    }
                    
                    if (isSetLeft(anu.id, set_left_db)) {
                        var get_teks_left = await getTextSetLeft(anu.id, set_left_db)
                        var replace_pesan = get_teks_left.replace(/@user/gi, `@${num.split('@')[0]}`)
                        var full_pesan = replace_pesan.replace(/@group/gi, groupName).replace(/@desc/gi, groupDesc)
                        
                        await alpha.sendMessage(anu.id, {
                            image: goobye, 
                            caption: full_pesan, 
                            mentions: [num]
                        })
                    } else {
                        await alpha.sendMessage(anu.id, {
                            image: goobye, 
                            caption: `Sayonara @${num.split("@")[0]}, doa terbaik untukmu kawan`, 
                            mentions: [num]
                        })
                    }
                }
            }
        } catch (err) {
            console.log(err)
        }
    })

    // Utility functions
    alpha.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else {
            return jid
        }
    }

    alpha.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = alpha.decodeJid(contact.id)
            if (store && store.contacts) {
                store.contacts[id] = {
                    id,
                    name: contact.notify
                }
            }
        }
    })

    alpha.getName = async (jid, withoutContact = false) => {
        id = alpha.decodeJid(jid)
        withoutContact = alpha.withoutContact || withoutContact
        
        if (id.endsWith("@g.us")) {
            try {
                let v = store.contacts[id] || {}
                if (!(v.name || v.subject)) {
                    v = await alpha.groupMetadata(id) || {}
                }
                return v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international')
            } catch {
                return PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international')
            }
        } else {
            let v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === alpha.decodeJid(alpha.user.id) ? alpha.user : (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }
    }

    alpha.sendContact = async (jid, kon, quoted = '', opts = {}) => {
        let list = []
        for (let i of kon) {
            const name = await alpha.getName(i + '@s.whatsapp.net')
            list.push({
                displayName: name,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            })
        }
        await alpha.sendMessage(jid, {
            contacts: {
                displayName: `${list.length} Kontak`,
                contacts: list
            },
            ...opts
        }, {
            quoted
        })
    }

    alpha.public = true
    alpha.serializeM = (m) => smsg(alpha, m, store)

    alpha.ev.on('connection.update', async (update) => {
        const {
            connection,
            lastDisconnect
        } = update
        
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason === DisconnectReason.badSession) {
                console.log(`Bad Session File, Please Delete Session and Scan Again`)
                alpha.logout()
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("Connection closed, reconnecting....")
                Botstarted()
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("Connection Lost from Server, reconnecting...")
                Botstarted()
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log("Connection Replaced, Another New Session Opened, reconnecting...")
                Botstarted()
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(`Device Logged Out, Please Scan Again And Run.`)
                alpha.logout()
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("Restart Required, Restarting...")
                Botstarted()
            } else if (reason === DisconnectReason.timedOut) {
                console.log("Connection TimedOut, Reconnecting...")
                Botstarted()
            } else if (reason === DisconnectReason.multideviceMismatch) {
                console.log("Multi device mismatch, please scan again")
                alpha.logout()
            } else {
                console.log(`Unknown DisconnectReason: ${reason}|${connection}`)
            }
        }
        
        if (update.connection == "open" || update.receivedPendingNotifications == "true") {
            console.log(`Connected to = ` + JSON.stringify(alpha.user, null, 2))
        }
    })

    alpha.ev.on('creds.update', saveCreds)

    // Message sending utilities
    alpha.sendText = (jid, text, quoted = '', options) => alpha.sendMessage(jid, {
        text: text,
        ...options
    }, {
        quoted,
        ...options
    })

    alpha.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || ''
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
        const stream = await downloadContentFromMessage(message, messageType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        return buffer
    }

    // Add other utility functions here (sendFile, sendMedia, etc.)
    // [The rest of your utility functions remain largely the same...]

    return alpha
}

Botstarted().catch(console.error)
