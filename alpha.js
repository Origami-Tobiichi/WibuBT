require('./settings')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    makeCacheableSignalKeyStore,
    PHONENUMBER_MCC
} = require("@adiwajshing/baileys")

// Import makeInMemoryStore dari path yang benar
let makeInMemoryStore;
try {
    makeInMemoryStore = require("@adiwajshing/baileys/lib/Store").makeInMemoryStore;
} catch (error) {
    console.log('makeInMemoryStore not found in lib/Store, trying alternative import...');
    // Fallback implementation jika import gagal
    makeInMemoryStore = () => ({
        bind: function(ev) {
            ev.on('contacts.update', this.contactsUpdate.bind(this));
            ev.on('messages.upsert', this.messagesUpsert.bind(this));
            ev.on('messages.update', this.messagesUpdate.bind(this));
            ev.on('groups.update', this.groupsUpdate.bind(this));
        },
        contacts: {},
        messages: {},
        groups: {},
        loadMessage: async function(jid, id) {
            return this.messages[jid]?.[id] || null;
        },
        contactsUpdate: function(updates) {
            for (const update of updates) {
                this.contacts[update.id] = update;
            }
        },
        messagesUpsert: function(updates) {
            for (const message of updates.messages) {
                if (!this.messages[message.key.remoteJid]) {
                    this.messages[message.key.remoteJid] = {};
                }
                this.messages[message.key.remoteJid][message.key.id] = message;
            }
        },
        messagesUpdate: function(updates) {
            for (const update of updates) {
                const jid = update.key.remoteJid;
                const id = update.key.id;
                if (this.messages[jid] && this.messages[jid][id]) {
                    Object.assign(this.messages[jid][id], update);
                }
            }
        },
        groupsUpdate: function(updates) {
            for (const update of updates) {
                this.groups[update.id] = update;
            }
        }
    });
}

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

// Pastikan file database ada sebelum membaca dengan error handling
let set_welcome_db = {}, set_left_db = {}, _welcome = [], _left = [], set_open = {}, set_close = {}, antilink = {}, antiwame = {}, antilink2 = {}, antiwame2 = {};

// Fungsi untuk load JSON dengan default value
function loadJSON(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath));
        }
    } catch (e) {
        console.log(`Error loading ${filePath}:`, e.message);
    }
    return defaultValue;
}

set_welcome_db = loadJSON('./database/set_welcome.json', {});
set_left_db = loadJSON('./database/set_left.json', {});
_welcome = loadJSON('./database/welcome.json', []);
_left = loadJSON('./database/left.json', []);
set_open = loadJSON('./database/set_open.json', {});
set_close = loadJSON('./database/set_close.json', {});
antilink = loadJSON('./database/antilink.json', {});
antiwame = loadJSON('./database/antiwame.json', {});
antilink2 = loadJSON('./database/antilink2.json', {});
antiwame2 = loadJSON('./database/antiwame2.json', {});

// Buat direktori jika belum ada
if (!fs.existsSync('./database')) {
    fs.mkdirSync('./database', { recursive: true });
}
if (!fs.existsSync('./image')) {
    fs.mkdirSync('./image', { recursive: true });
}

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

// Fungsi untuk normalisasi JID
function jidNormalizedUser(jid) {
    if (!jid) return jid
    if (typeof jid !== 'string') return jid
    
    // Jika jid sudah memiliki method decodeJid
    if (jid.decodeJid) return jid.decodeJid()
    
    // Normalisasi manual
    if (jid.includes('@s.whatsapp.net') || jid.includes('@g.us')) {
        return jid;
    }
    
    // Decode JID manual
    if (/:\d+@/gi.test(jid)) {
        try {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server ? decode.user + '@' + decode.server : jid
        } catch (e) {
            return jid
        }
    }
    
    return jid
}

async function Botstarted() {
    try {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(`./${sessionName}`)
        
        const { version, isLatest } = await fetchLatestBaileysVersion();
        const msgRetryCounterCache = new NodeCache()
        
        const alpha = makeWASocket({
            version,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            printQRInTerminal: !pairingCode,
            mobile: useMobile, 
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            generateHighQualityLinkPreview: true,
            getMessage: async (key) => {
                try {
                    let jid = jidNormalizedUser(key.remoteJid)
                    let msg = await store.loadMessage(jid, key.id)
                    return msg?.message || ""
                } catch (e) {
                    return ""
                }
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
        })

        // Load case module
        require('./case')
        nocache('./case', module => console.log(` "${module}" Telah diupdate!`))
        nocache('./settings', module => console.log(` "${module}" Telah diupdate!`))

        store.bind(alpha.ev)

        alpha.ev.on('messages.upsert', async chatUpdate => {
            try {
                let mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') return
                if (!alpha.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
                let m = smsg(alpha, mek, store)
                require("./case")(alpha, m, chatUpdate, store, antilink, antiwame, antilink2, antiwame2, set_welcome_db, set_left_db, set_open, set_close, _welcome, _left)
            }
            catch (err) {
                console.log('Error in messages.upsert:', err)
            }
        })

        if (pairingCode && !alpha.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phoneNumber
            if (typeof pairingNumber !== 'undefined' && pairingNumber) {
                phoneNumber = pairingNumber.replace(/[^0-9]/g, '')

                if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
                    console.log("Start with your country's WhatsApp code, Example : 62xxx")
                    process.exit(0)
                }
            } else {
                phoneNumber = await question(`Please type your WhatsApp number : `)
                phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

                // Ask again when entering the wrong number
                if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
                    console.log("Start with your country's WhatsApp code, Example : 62xxx")
                    phoneNumber = await question(`Please type your WhatsApp number : `)
                    phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
                }
            }

            setTimeout(async () => {
                try {
                    let code = await alpha.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(`Your Pairing Code : ${code}`)
                } catch (error) {
                    console.log('Error getting pairing code:', error)
                }
            }, 3000)
        }

        alpha.ev.on('group-participants.update', async (anu) => {
            const isWelcome = _welcome.includes(anu.id)
            const isLeft = _left.includes(anu.id)
            try {
                let metadata = await alpha.groupMetadata(anu.id)
                let participants = anu.participants
                const groupName = metadata.subject
                const groupDesc = metadata.desc || ''
                
                for (let num of participants) {
                    let ppuser, ppgroup;
                    
                    try {
                        ppuser = await alpha.profilePictureUrl(num, 'image')
                    } catch {
                        ppuser = 'https://telegra.ph/file/c3f3d2c2548cbefef1604.jpg'
                    }

                    try {
                        ppgroup = await alpha.profilePictureUrl(anu.id, 'image')
                    } catch {
                        ppgroup = 'https://telegra.ph/file/c3f3d2c2548cbefef1604.jpg'
                    }
                    
                    if (anu.action == 'add' && isWelcome) {
                        console.log('Welcome event:', anu)
                        let welcome, ppu, ppgc;
                        
                        try {
                            let hmm = await getBuffer(ppuser)
                            let ff = './image/ppuser-1.png'
                            await fs.writeFileSync(ff, hmm)
                            ppu = await TelegraPh(ff)
                        } catch {
                            ppu = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                        }
                        
                        try {
                            let hmm2 = await getBuffer(ppgroup)
                            let fff = './image/ppgc-495.png'
                            await fs.writeFileSync(fff, hmm2)
                            ppgc = await TelegraPh(fff)
                        } catch {
                            ppgc = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                        }
                        
                        try {
                            let res = await fetch(global.api('alfa', '/api/canvas/welcomev2', {
                                avatar: ppu,
                                username: `${encodeURI(num.split("@")[0])}`,
                                background: typeof background !== 'undefined' ? background : 'https://telegra.ph/file/0d50687b197cac991115e.jpg',
                                guildname: metadata.subject,
                                membercount: `${encodeURI(participants.length)}`
                            }, 'apikey'))
                            
                            if (!res.ok) throw await res.text()
                            welcome = await res.buffer()
                        } catch {
                            welcome = await getBuffer("https://telegra.ph/file/0d50687b197cac991115e.jpg")
                        }
                        
                        if (isSetWelcome(anu.id, set_welcome_db)) {
                            let get_teks_welcome = await getTextSetWelcome(anu.id, set_welcome_db)
                            let replace_pesan = get_teks_welcome.replace(/@user/gi, `@${num.split('@')[0]}`)
                            let full_pesan = replace_pesan.replace(/@group/gi, groupName).replace(/@desc/gi, groupDesc)
                            
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
                        console.log('Left event:', anu)
                        let goobye, ppu, ppgc;
                        
                        try {
                            let hmm = await getBuffer(ppuser)
                            let ff = './image/ppuser-1.png'
                            await fs.writeFileSync(ff, hmm)
                            ppu = await TelegraPh(ff)
                        } catch {
                            ppu = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                        }
                        
                        try {
                            let hmm2 = await getBuffer(ppgroup)
                            let fff = './image/ppgc-495.png'
                            await fs.writeFileSync(fff, hmm2)
                            ppgc = await TelegraPh(fff)
                        } catch {
                            ppgc = "https://telegra.ph/file/0d50687b197cac991115e.jpg"
                        }
                        
                        try {
                            let res = await fetch(global.api('alfa', '/api/canvas/goodbyev2', {
                                avatar: ppu,
                                username: `${encodeURI(num.split("@")[0])}`,
                                background: typeof background !== 'undefined' ? background : 'https://telegra.ph/file/0d50687b197cac991115e.jpg',
                                guildname: metadata.subject,
                                membercount: `${encodeURI(participants.length)}`
                            }, 'apikey'))
                            
                            if (!res.ok) throw await res.text()
                            goobye = await res.buffer()
                        } catch {
                            goobye = await getBuffer("https://telegra.ph/file/0d50687b197cac991115e.jpg")
                        }
                        
                        if (isSetLeft(anu.id, set_left_db)) {
                            let get_teks_left = await getTextSetLeft(anu.id, set_left_db)
                            let replace_pesan = get_teks_left.replace(/@user/gi, `@${num.split('@')[0]}`)
                            let full_pesan = replace_pesan.replace(/@group/gi, groupName).replace(/@desc/gi, groupDesc)
                            
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
                console.log('Error in group-participants.update:', err)
            }
        })

        // Setting
        alpha.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        alpha.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = alpha.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = {
                    id,
                    name: contact.notify
                }
            }
        })

        alpha.getName = (jid, withoutContact = false) => {
            let id = alpha.decodeJid(jid)
            withoutContact = alpha.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = alpha.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? {
                    id,
                    name: 'WhatsApp'
                } : id === alpha.decodeJid(alpha.user.id) ?
                alpha.user :
                (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        alpha.sendContact = async (jid, kon, quoted = '', opts = {}) => {
            let list = []
            for (let i of kon) {
                list.push({
                    displayName: await alpha.getName(i + '@s.whatsapp.net'),
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await alpha.getName(i + '@s.whatsapp.net')}\nFN:${await alpha.getName(i + '@s.whatsapp.net')}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
                })
            }
            alpha.sendMessage(jid, {
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
                    console.log(`Bad Session File, Please Delete Session and Scan Again`);
                    alpha.logout();
                } else if (reason === DisconnectReason.connectionClosed) {
                    console.log("Connection closed, reconnecting....");
                    Botstarted();
                } else if (reason === DisconnectReason.connectionLost) {
                    console.log("Connection Lost from Server, reconnecting...");
                    Botstarted();
                } else if (reason === DisconnectReason.connectionReplaced) {
                    console.log("Connection Replaced, Another New Session Opened, reconnecting...");
                    Botstarted();
                } else if (reason === DisconnectReason.loggedOut) {
                    console.log(`Device Logged Out, Please Scan Again And Run.`);
                    alpha.logout();
                } else if (reason === DisconnectReason.restartRequired) {
                    console.log("Restart Required, Restarting...");
                    Botstarted();
                } else if (reason === DisconnectReason.timedOut) {
                    console.log("Connection TimedOut, Reconnecting...");
                    Botstarted();
                } else if (reason === DisconnectReason.Multidevicemismatch) {
                    console.log("Multi device mismatch, please scan again");
                    alpha.logout();
                } else {
                    console.log(`Unknown DisconnectReason: ${reason}|${connection}`)
                    Botstarted();
                }
            }
            if (update.connection == "open" || update.receivedPendingNotifications == "true") {
                console.log(`Connected to = ` + JSON.stringify(alpha.user, null, 2))
            }
        })

        alpha.ev.on('creds.update', saveCreds)

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

        alpha.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message
            let mime = (message.msg || message).mimetype || ''
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
            const stream = await downloadContentFromMessage(quoted, messageType)
            let buffer = Buffer.from([])
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            let type = await FileType.fromBuffer(buffer)
            let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
            await fs.writeFileSync(trueFileName, buffer)
            return trueFileName
        }

        alpha.sendTextWithMentions = async (jid, text, quoted, options = {}) => alpha.sendMessage(jid, {
            text: text,
            mentions: [...text.matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net'),
            ...options
        }, {
            quoted
        })

        alpha.getFile = async (PATH, returnAsFilename) => {
            let res, filename
            const data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,` [1], 'base64') : /^https?:\/\//.test(PATH) ? await (res = await fetch(PATH)).buffer() : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0)
            if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer')
            const type = await FileType.fromBuffer(data) || {
                mime: 'application/octet-stream',
                ext: '.bin'
            }
            if (data && returnAsFilename && !filename) {
                filename = path.join(__dirname, './image/' + new Date * 1 + '.' + type.ext)
                await fs.promises.writeFile(filename, data)
            }
            return {
                res,
                filename,
                ...type,
                data,
                deleteFile() {
                    return filename && fs.promises.unlink(filename)
                }
            }
        }

        alpha.sendFile = async (jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) => {
            let type = await alpha.getFile(path, true)
            let {
                res,
                data: file,
                filename: pathFile
            } = type
            if (res && res.status !== 200 || file.length <= 65536) {
                try {
                    throw {
                        json: JSON.parse(file.toString())
                    }
                }
                catch (e) {
                    if (e.json) throw e.json
                }
            }
            let opt = {
                filename
            }
            if (quoted) opt.quoted = quoted
            if (!type) options.asDocument = true
            let mtype = '',
                mimetype = type.mime,
                convert
            if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker'
            else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image'
            else if (/video/.test(type.mime)) mtype = 'video'
            else if (/audio/.test(type.mime))(
                convert = await (ptt ? toPTT : toAudio)(file, type.ext),
                file = convert.data,
                pathFile = convert.filename,
                mtype = 'audio',
                mimetype = 'audio/ogg; codecs=opus'
            )
            else mtype = 'document'
            if (options.asDocument) mtype = 'document'

            delete options.asSticker
            delete options.asLocation
            delete options.asVideo
            delete options.asDocument
            delete options.asImage

            let message = {
                ...options,
                caption,
                ptt,
                [mtype]: {
                    url: pathFile
                },
                mimetype
            }
            let m
            try {
                m = await alpha.sendMessage(jid, message, {
                    ...opt,
                    ...options
                })
            }
            catch (e) {
                m = null
            }
            finally {
                if (!m) m = await alpha.sendMessage(jid, {
                    ...message,
                    [mtype]: file
                }, {
                    ...opt,
                    ...options
                })
                file = null
                return m
            }
        }

        alpha.sendMedia = async (jid, path, filename, quoted = '', options = {}) => {
            let {
                ext,
                mime,
                data
            } = await alpha.getFile(path)
            let messageType = mime.split("/")[0]
            let pase = messageType.replace('application', 'document') || messageType
            return await alpha.sendMessage(jid, {
                [`${pase}`]: data,
                mimetype: mime,
                fileName: filename + (ext ? ext : ''),
                ...options
            }, {
                quoted
            })
        }

        alpha.sendMediaAsSticker = async (jid, path, quoted, options = {}) => {
            let {
                ext,
                mime,
                data
            } = await alpha.getFile(path)
            let media = {}
            let buffer
            media.data = data
            media.mimetype = mime
            if (options && (options.packname || options.author)) {
                buffer = await writeExif(media, options)
            } else {
                buffer = /image/.test(mime) ? await imageToWebp(data) : /video/.test(mime) ? await videoToWebp(data) : ""
            }
            await alpha.sendMessage(jid, {
                sticker: {
                    url: buffer
                },
                ...options
            }, {
                quoted
            })
            return buffer
        }

        alpha.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
            let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,` [1], 'base64') : /^https?:\/\//.test(path) ? await (await fetch(path)).buffer() : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
            let buffer
            if (options && (options.packname || options.author)) {
                buffer = await writeExifImg(buff, options)
            }
            else {
                buffer = await imageToWebp(buff)
            }

            await alpha.sendMessage(jid, {
                sticker: {
                    url: buffer
                },
                ...options
            }, {
                quoted
            })
            return buffer
        }

        alpha.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
            let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,` [1], 'base64') : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
            let buffer
            if (options && (options.packname || options.author)) {
                buffer = await writeExifVid(buff, options)
            }
            else {
                buffer = await videoToWebp(buff)
            }

            await alpha.sendMessage(jid, {
                sticker: {
                    url: buffer
                },
                ...options
            }, {
                quoted
            })
            return buffer
        }

        alpha.sendButtonText = (jid, buttons = [], text, footer, quoted = '', options = {}) => {
            let buttonMessage = {
                text,
                footer,
                buttons,
                headerType: 2,
                ...options
            }
            alpha.sendMessage(jid, buttonMessage, {
                quoted,
                ...options
            })
        }

        alpha.send1ButMes = (jid, text = '', footer = '', butId = '', dispText = '', quoted, ments) => {
            let but = [{
                buttonId: butId,
                buttonText: {
                    displayText: dispText
                },
                type: 1
            }]
            let butMes = {
                text: text,
                buttons: but,
                footer: footer,
                mentions: ments ? ments : []
            }
            alpha.sendMessage(jid, butMes, {
                quoted: quoted
            })
        }

        alpha.sendButImage = async (jid, link, but = [], text = '', footer = '', ments = [], quoted) => {
            let dlimage;
            try {
                dlimage = await getBuffer(link)
            }
            catch {
                dlimage = await getBuffer('https://telegra.ph/file/ca0234ea67c9a8b8af9a1.jpg')
            }
            const buttonMessage = {
                image: dlimage,
                caption: text,
                footer: footer,
                buttons: but,
                headerType: 'IMAGE',
                mentions: ments
            }

            alpha.sendMessage(jid, buttonMessage, quoted)
        }

        alpha.sendFakeLink = (jid, text, salam, footer_text, pp_bot, myweb, pushname, quoted) => alpha.sendMessage(jid, {
            text: text,
            contextInfo: {
                "externalAdReply": {
                    "title": `Selamat ${salam} ${pushname}`,
                    "body": footer_text,
                    "previewType": "PHOTO",
                    "thumbnailUrl": ``,
                    "thumbnail": pp_bot,
                    "sourceUrl": myweb
                }
            }
        }, {
            quoted
        })

        return alpha

    } catch (error) {
        console.log('Error in Botstarted:', error)
        // Restart bot setelah 5 detik jika error
        setTimeout(() => {
            console.log('Restarting bot...')
            Botstarted()
        }, 5000)
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Start bot
Botstarted().catch(console.error)
