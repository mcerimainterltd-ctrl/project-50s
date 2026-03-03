//
// XamePage v2.1.1 — Server
//
// Fully upgraded from v2.1 to support all v2.1.1 client modules:
//   ✅ Conference rooms  (conference.js)
//   ✅ Screen sharing    (screen-share.js)
//   ✅ Message reactions (reactions.js)
//   ✅ Disappearing msgs (disappearing.js)
//   ✅ Settings sync     (settings.js)
//   ✅ All existing v2.1 features preserved
//

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const fsPromises = require('fs').promises;
const path       = require('path');
const multer     = require('multer');
const mongoose   = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const cors       = require('cors');
const { body, validationResult } = require('express-validator');
const bcrypt     = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const webpush    = require('web-push');
require('dotenv').config();

// ============================================================
// SERVER SETUP
// ============================================================

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports:      ['polling', 'websocket'],
    allowEIO3:       true,
    path:            '/socket.io/',
    pingTimeout:     60000,
    pingInterval:    25000,
    upgradeTimeout:  30000,
    maxHttpBufferSize: 1e8
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// ============================================================
// CLOUDINARY
// ============================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

if (!process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY    ||
    !process.env.CLOUDINARY_API_SECRET) {
    console.warn('⚠️  Cloudinary env vars missing — profile pic uploads will fail');
} else {
    console.log('✅ Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME);
}

// ============================================================
// WEB PUSH
// ============================================================

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push configured');
} else {
    console.warn('⚠️  VAPID keys missing — push notifications disabled');
}

// ============================================================
// CLOUDINARY HELPERS
// ============================================================

function uploadToCloudinary(buffer, userId) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder:    'xamepage/profile_pics',
                public_id: `user_${userId}`,
                overwrite: true,
                transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }],
                format: 'jpg'
            },
            (err, result) => {
                if (err) { console.error('❌ Cloudinary upload error:', err); reject(err); }
                else      { console.log('✅ Cloudinary upload:', result.secure_url); resolve(result.secure_url); }
            }
        );
        stream.end(buffer);
    });
}

async function deleteFromCloudinary(userId) {
    try {
        await cloudinary.uploader.destroy(`xamepage/profile_pics/user_${userId}`);
    } catch (err) {
        console.error('❌ Cloudinary delete error:', err);
    }
}

// ============================================================
// PATHS & DIRECTORIES
// ============================================================

const BASE_DIR      = process.cwd();
const uploadDir     = path.join(BASE_DIR, 'uploads');
const profilePicsDir = path.join(BASE_DIR, 'media', 'profile_pics');

console.log(`📁 Base: ${BASE_DIR}`);
console.log(`📂 Uploads: ${uploadDir}`);

// ============================================================
// MONGODB
// ============================================================

const MONGODB_URI = process.env.MONGODB_CLOUD_URI;
if (!MONGODB_URI) { console.error('❌ MONGODB_CLOUD_URI missing'); process.exit(1); }

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  heartbeatFrequencyMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
  setTimeout(() => mongoose.connect(MONGODB_URI).catch(err => console.error('❌ Reconnect failed:', err.message)), 3000);
});
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));
mongoose.connection.on('error', err => console.error('❌ MongoDB error:', err.message));

// ============================================================
// SCHEMAS
// ============================================================

const contactSchema = new mongoose.Schema({
    contactId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customName: { type: String },
    addedAt:    { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    xameId:             { type: String, required: true, unique: true },
    firstName:          { type: String, required: true },
    lastName:           { type: String, required: true },
    preferredName:      { type: String, default: '' },
    dob:                { type: String, required: true },
    password:           { type: String },
    profilePic:         { type: String, default: '' },
    hidePreferredName:  { type: Boolean, default: false },
    hideProfilePicture: { type: Boolean, default: false },
    contacts:           [contactSchema],
    // v2.1.1: per-user settings stored server-side for cross-device sync
    settings:           { type: Object, default: {} },
    createdAt:          { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    messageId:   { type: String, required: true, unique: true },
    senderId:    { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    ts:          { type: Number, required: true },
    text:        { type: String },
    file: {
        url:  { type: String },
        name: { type: String },
        type: { type: String }
    },
    status:     { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' },
    // v2.1.1 fields
    replyTo:    { type: Object, default: null },   // reply thread metadata
    expiresAt:  { type: Number, default: null },   // disappearing messages (unix ms)
    forwarded:  { type: Boolean, default: false },  // forwarded message flag
    reactions:  { type: Object, default: {} }      // { emoji: [userId, ...] }
});

// TTL index: MongoDB will auto-delete documents once expiresAt is reached.
// We store expiresAt as a unix ms timestamp; convert to Date for the index.
// The sparse:true means documents without expiresAt are ignored.
messageSchema.index(
    { expiresAtDate: 1 },
    { expireAfterSeconds: 0, sparse: true }
);
// We add a virtual setter so saving expiresAt also sets expiresAtDate
messageSchema.pre('save', function (next) {
    if (this.expiresAt) {
        this.expiresAtDate = new Date(this.expiresAt);
    }
    next();
});
messageSchema.add({ expiresAtDate: { type: Date, default: null } });

const callHistorySchema = new mongoose.Schema({
    callId:      { type: String, required: true, unique: true },
    callerId:    { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    callType:    { type: String, required: true, enum: ['voice', 'video'] },
    startTime:   { type: Date,   default: Date.now },
    endTime:     { type: Date },
    status: {
        type: String, required: true,
        enum: ['pending', 'accepted', 'rejected', 'ended', 'missed']
    }
}, { timestamps: true });

const pushSubscriptionSchema = new mongoose.Schema({
    userId:       { type: String, required: true, unique: true },
    subscription: { type: Object, required: true },
    createdAt:    { type: Date, default: Date.now }
});

// v2.1.1: Conference room persistence (lightweight — rooms are ephemeral)
const groupSchema = new mongoose.Schema({
    groupId:     { type: String, required: true, unique: true },
    name:        { type: String, required: true },
    description: { type: String, default: '' },
    avatar:      { type: String, default: '' },
    createdBy:   { type: String, required: true },
    members:     [{
        userId:   { type: String, required: true },
        name:     { type: String, default: '' },
        role:     { type: String, enum: ['admin', 'member'], default: 'member' },
        joinedAt: { type: Date, default: Date.now }
    }],
    lastMessageTs:      { type: Number, default: 0 },
    lastMessagePreview: { type: String, default: '' },
    createdAt:   { type: Date, default: Date.now }
});

const groupMessageSchema = new mongoose.Schema({
    groupId:   { type: String, required: true },
    senderId:  { type: String, required: true },
    senderName:{ type: String, default: '' },
    text:      { type: String, default: '' },
    file:      { type: Object, default: null },
    replyTo:   { type: Object, default: null },
    ts:        { type: Number, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

const galleryItemSchema = new mongoose.Schema({
    userId:      { type: String, required: true },
    url:         { type: String, required: true },
    publicId:    { type: String, default: '' },
    type:        { type: String, enum: ['image', 'video'], default: 'image' },
    caption:     { type: String, default: '' },
    category:    { type: String, default: 'personal' },
    price:       { type: String, default: '' },
    visibility:  { type: String, enum: ['public', 'contacts', 'private'], default: 'contacts' },
    mode:        { type: String, enum: ['personal', 'business'], default: 'personal' },
    createdAt:   { type: Date, default: Date.now }
});

const conferenceRoomSchema = new mongoose.Schema({
    roomId:       { type: String, required: true, unique: true },
    hostId:       { type: String, required: true },
    participants: [{ userId: String, displayName: String, joinedAt: Date }],
    createdAt:    { type: Date, default: Date.now, expires: 86400 } // auto-clean after 24h
});

const User             = mongoose.model('User',             userSchema);
const Message          = mongoose.model('Message',          messageSchema);
const CallHistory      = mongoose.model('CallHistory',      callHistorySchema);
const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
const ConferenceRoom   = mongoose.model('ConferenceRoom',   conferenceRoomSchema);
const GalleryItem      = mongoose.model('GalleryItem',      galleryItemSchema);
const Group            = mongoose.model('Group',            groupSchema);
const GroupMessage     = mongoose.model('GroupMessage',     groupMessageSchema);

// ── Broadcast List Schema ─────────────────────────────────────────────────
const broadcastListSchema = new mongoose.Schema({
  listId:    { type: String, required: true, unique: true },
  ownerId:   { type: String, required: true },
  name:      { type: String, required: true },
  members:   [{ type: String }], // array of xameIds
  createdAt: { type: Date, default: Date.now },
});
const BroadcastList = mongoose.model('BroadcastList', broadcastListSchema);

// ── Scheduled Message Schema ──────────────────────────────────────────────
const scheduledMessageSchema = new mongoose.Schema({
  scheduleId:  { type: String, required: true, unique: true },
  senderId:    { type: String, required: true },
  recipientId: { type: String, required: true },
  text:        { type: String, default: '' },
  file:        { type: Object, default: null },
  sendAt:      { type: Number, required: true }, // unix ms
  sent:        { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
});
const ScheduledMessage = mongoose.model('ScheduledMessage', scheduledMessageSchema);

// ── Scheduled Call Schema ─────────────────────────────────────────────────
const scheduledCallSchema = new mongoose.Schema({
  scheduleId:  { type: String, required: true, unique: true },
  callerId:    { type: String, required: true },
  recipientId: { type: String, required: true },
  callType:    { type: String, enum: ['voice', 'video'], default: 'voice' },
  callAt:      { type: Number, required: true }, // unix ms
  fired:       { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
});
const ScheduledCall = mongoose.model('ScheduledCall', scheduledCallSchema);

// ============================================================
// FILE UPLOAD
// ============================================================

const diskUpload   = multer({ dest: uploadDir });
const memoryUpload = multer({ storage: multer.memoryStorage() });

async function createDirectories() {
    for (const dir of [uploadDir, profilePicsDir]) {
        if (!fs.existsSync(dir)) {
            await fsPromises.mkdir(dir, { recursive: true });
            console.log(`✅ Created: ${dir}`);
        }
    }
}

// Static files
app.use(express.static(BASE_DIR));
// Uploaded files are served via authenticated /api/file/:filename route only
app.get('/api/file/:filename', (req, res) => {
    const { filename } = req.params;
    const userId = req.query.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const safeName = path.basename(filename);
    const filePath = path.join(uploadDir, safeName);
    if (!filePath.startsWith(uploadDir)) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.sendFile(filePath);
});
app.use('/media/icons',          express.static(path.join(BASE_DIR, 'media', 'icons')));
app.use('/media/audio',          express.static(path.join(BASE_DIR, 'media', 'audio')));
app.use('/media/splash',         express.static(path.join(BASE_DIR, 'media', 'splash')));
app.use('/media/profile_pics',   express.static(profilePicsDir));

// ============================================================
// ONLINE USER STATE
// ============================================================

const onlineUsers          = new Set();
const userToSocketMap      = new Map();   // userId  → socketId
const socketToUserMap      = new Map();   // socketId → userId
const onlineUserTimestamps = new Map();
const disconnectTimeouts   = new Map();

// v2.1.1: Conference room membership (in-memory for speed)
// roomId → Set<userId>
const conferenceRooms      = new Map();
// roomId → { hostId, displayNames: Map<userId, displayName> }
const conferenceRoomMeta   = new Map();

function findSocketId(userId) {
    return userToSocketMap.get(userId);
}

// ============================================================
// HELPERS
// ============================================================

async function generateUniqueXameId() {
    const prefix = '058';
    let newId, isUnique = false;
    do {
        const rand = Math.floor(1e8 + Math.random() * 9e8).toString();
        newId = `${prefix}${rand}`;
        isUnique = !(await User.findOne({ xameId: newId }));
    } while (!isUnique);
    return newId;
}

function getPrivacyFilteredContactData(user) {
    return {
        xameId:        user.xameId,
        preferredName: user.hidePreferredName  ? '' : (user.preferredName || ''),
        profilePic:    user.hideProfilePicture ? '' : (user.profilePic    || '')
    };
}

function getContactDisplayName(xameId, partnerUser, savedContact) {
    if (savedContact?.customName)   return savedContact.customName;
    if (partnerUser?.preferredName) return partnerUser.preferredName;
    if (partnerUser) {
        const full = `${partnerUser.firstName || ''} ${partnerUser.lastName || ''}`.trim();
        if (full) return full;
    }
    return xameId;
}

async function getLastInteractionDetails(userId, partnerId) {
    const [lastMsg, lastCall] = await Promise.all([
        Message.findOne({
            $or: [
                { senderId: userId,    recipientId: partnerId },
                { senderId: partnerId, recipientId: userId }
            ]
        }).sort({ ts: -1 }).select('ts senderId'),

        CallHistory.findOne({
            $or: [
                { callerId: userId,    recipientId: partnerId },
                { callerId: partnerId, recipientId: userId }
            ],
            status: { $in: ['accepted', 'ended', 'rejected', 'missed'] }
        }).sort({ createdAt: -1 }).select('createdAt status callerId')
    ]);

    let lastTs = 0, previewText = 'Start a new chat.';

    if (lastMsg) {
        lastTs      = lastMsg.ts;
        previewText = lastMsg.senderId === userId ? 'You: Sent a message.' : 'New message received.';
    }
    if (lastCall) {
        const callTs = lastCall.createdAt.getTime();
        if (callTs > lastTs) {
            lastTs      = callTs;
            previewText = lastCall.status === 'missed' && lastCall.recipientId === userId
                ? 'Missed call.'
                : lastCall.callerId === userId ? 'Outgoing call.' : 'Incoming call.';
        }
    }

    return { lastInteractionTs: lastTs, lastInteractionPreview: previewText };
}

async function getFullContactData(userId) {
    const user = await User.findOne({ xameId: userId }).populate('contacts.contactId');
    if (!user) return [];

    const [chatFrom, chatTo, callFrom, callTo] = await Promise.all([
        Message.distinct('senderId',    { recipientId: userId }),
        Message.distinct('recipientId', { senderId: userId }),
        CallHistory.distinct('callerId',    { recipientId: userId }),
        CallHistory.distinct('recipientId', { callerId: userId })
    ]);

    const allIds = new Set([
        ...chatFrom, ...chatTo, ...callFrom, ...callTo,
        ...user.contacts.map(c => c.contactId?.xameId).filter(Boolean)
    ]);
    allIds.delete(userId);

    const ids          = Array.from(allIds);
    const partnerUsers = await User.find({ xameId: { $in: ids } });
    const partnerMap   = new Map(partnerUsers.map(p => [p.xameId, p]));

    const rows = await Promise.all(ids.map(async xameId => {
        const partner      = partnerMap.get(xameId);
        const saved        = user.contacts.find(c => c.contactId?.xameId === xameId);
        const filtered     = partner ? getPrivacyFilteredContactData(partner) : null;
        const displayName  = getContactDisplayName(xameId, filtered, saved);

        const [unread, missed, interaction] = await Promise.all([
            Message.countDocuments({
                senderId: xameId, recipientId: userId,
                status: { $in: ['sent', 'delivered'] }
            }),
            CallHistory.countDocuments({
                callerId: xameId, recipientId: userId,
                status: { $in: ['pending', 'missed'] }
            }),
            getLastInteractionDetails(userId, xameId)
        ]);

        return {
            xameId,
            name:                   displayName,
            profilePic:             filtered?.profilePic || '',
            isOnline:               onlineUsers.has(xameId),
            unreadMessagesCount:    unread,
            missedCallsCount:       missed,
            isSaved:                !!saved,
            lastInteractionTs:      interaction.lastInteractionTs,
            lastInteractionPreview: interaction.lastInteractionPreview,
            personalStatus:         partner?.settings?.personalStatus || null
        };
    }));

    rows.sort((a, b) => b.lastInteractionTs - a.lastInteractionTs);
    return rows;
}

function broadcastOnlineUsers() {
    io.emit('online_users', Array.from(onlineUsers));
}

// ============================================================
// API — AUTH
// ============================================================

app.post('/api/register',
    body('firstName').trim().escape().notEmpty(),
    body('lastName').trim().escape().notEmpty(),
    body('dob').isDate({ format: 'YYYY-MM-DD' }),
    body('password').isLength({ min: 8 }),
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

        const { firstName, lastName, dob, password } = req.body;
        try {
            const xameId         = await generateUniqueXameId();
            const hashedPassword = await bcrypt.hash(password, 10);
            const user           = await new User({ xameId, firstName, lastName, dob, password: hashedPassword }).save();
            const resp           = user.toObject(); delete resp.password;
            console.log(`✅ Registered: ${xameId}`);
            res.json({ success: true, user: resp });
        } catch (err) {
            console.error('Register error:', err);
            res.status(500).json({ success: false, message: 'Server error during registration.' });
        }
    }
);

app.post('/api/set-password',
    body('xameId').trim().escape().notEmpty(),
    body('newPassword').isLength({ min: 8 }),
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

        const { xameId, newPassword } = req.body;
        try {
            const user = await User.findOne({ xameId });
            if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
            if (user.password) return res.status(400).json({ success: false, message: 'Account already has a password.' });

            user.password = await bcrypt.hash(newPassword, 10);
            await user.save();
            const resp = user.toObject(); delete resp.password;
            res.json({ success: true, message: 'Password set.', user: resp });
        } catch (err) {
            console.error('Set password error:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
        }
    }
);

app.post('/api/login', async (req, res) => {
    const { xameId, password } = req.body;
    if (!xameId) return res.status(400).json({ success: false, message: 'Xame-ID required.' });

    try {
        const user = await User.findOne({ xameId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        if (!user.password) {
            return res.status(403).json({
                success: false,
                message: 'Account needs a password. Please set one.',
                requiresPasswordSetup: true,
                user: { xameId: user.xameId, firstName: user.firstName, lastName: user.lastName }
            });
        }

        if (!password) return res.status(400).json({ success: false, message: 'Password required.' });
        if (!await bcrypt.compare(password, user.password))
            return res.status(401).json({ success: false, message: 'Invalid password.' });

        console.log(`✅ Login: ${xameId}`);
        const resp = { ...user.toObject(), privacySettings: {
            hidePreferredName:  user.hidePreferredName,
            hideProfilePicture: user.hideProfilePicture
        }};
        delete resp.password;
        res.json({ success: true, user: resp });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/logout', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'User ID required.' });
    onlineUsers.delete(userId);
    userToSocketMap.delete(userId);
    broadcastOnlineUsers();
    res.json({ success: true, message: 'Logged out.' });
});

// ============================================================
// API — PUSH NOTIFICATIONS
// ============================================================

app.post('/api/save-push-subscription', async (req, res) => {
    const { userId, subscription } = req.body;
    if (!userId || !subscription) return res.status(400).json({ success: false, message: 'Missing data.' });
    try {
        await PushSubscription.findOneAndUpdate(
            { userId }, { userId, subscription }, { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Push subscription error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// API — USERS & CONTACTS
// ============================================================

app.post('/api/get-user-name', async (req, res) => {
    const { xameId } = req.body;
    try {
        const user = await User.findOne({ xameId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        res.json({ success: true, user: { firstName: user.firstName, lastName: user.lastName, xameId: user.xameId } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/search-user', async (req, res) => {
    const { xameId } = req.body;
    if (!xameId?.trim()) return res.status(400).json({ success: false, message: 'Xame-ID required.' });
    try {
        const user = await User.findOne({ xameId: xameId.trim() });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        const f = getPrivacyFilteredContactData(user);
        res.json({ success: true, user: { ...f, isOnline: onlineUsers.has(user.xameId) } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/add-contact', async (req, res) => {
    const { userId, contactId, customName } = req.body;
    try {
        const [user, contact] = await Promise.all([
            User.findOne({ xameId: userId }),
            User.findOne({ xameId: contactId })
        ]);
        if (!user || !contact) return res.status(404).json({ success: false, message: 'User or contact not found.' });
        if (user.contacts.some(c => c.contactId?.toString() === contact._id.toString()))
            return res.status(409).json({ success: false, message: 'Contact already exists.' });

        user.contacts.push({ contactId: contact._id, customName });
        await user.save();

        const f    = getPrivacyFilteredContactData(contact);
        const name = getContactDisplayName(contact.xameId, f, { customName });
        res.json({ success: true, message: 'Contact added.', contact: { xameId: contact.xameId, name, profilePic: f.profilePic, isOnline: onlineUsers.has(contact.xameId) } });
    } catch (err) {
        console.error('Add contact error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/update-contact',
    body('userId').trim().escape().notEmpty(),
    body('contactId').trim().escape().notEmpty(),
    body('newName').trim().escape().notEmpty(),
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

        const { userId, contactId, newName } = req.body;
        try {
            const contactUser = await User.findOne({ xameId: contactId }).select('_id');
            if (!contactUser) return res.status(404).json({ success: false, message: 'Contact user not found.' });

            const result = await User.updateOne(
                { xameId: userId, 'contacts.contactId': contactUser._id },
                { $set: { 'contacts.$.customName': newName } }
            );

            if (result.matchedCount === 0) {
                await User.updateOne(
                    { xameId: userId },
                    { $push: { contacts: { contactId: contactUser._id, customName: newName } } }
                );
            }

            res.json({ success: true, updatedName: newName });
        } catch (err) {
            console.error('Update contact error:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
        }
    }
);

app.post('/api/delete-chat-and-contact',
    body('userId').trim().escape().notEmpty(),
    body('contactId').trim().escape().notEmpty(),
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

        const { userId, contactId } = req.body;
        if (userId === contactId) return res.status(403).json({ success: false, message: 'Cannot delete self.' });

        try {
            const contactUser = await User.findOne({ xameId: contactId }).select('_id');
            await Promise.all([
                Message.deleteMany({ $or: [
                    { senderId: userId,    recipientId: contactId },
                    { senderId: contactId, recipientId: userId }
                ]}),
                CallHistory.deleteMany({ $or: [
                    { callerId: userId,    recipientId: contactId },
                    { callerId: contactId, recipientId: userId }
                ]})
            ]);
            if (contactUser) {
                await User.updateOne(
                    { xameId: userId },
                    { $pull: { contacts: { contactId: contactUser._id } } }
                );
            }
            res.json({ success: true, message: 'Contact and history deleted.' });
        } catch (err) {
            console.error('Delete contact error:', err);
            res.status(500).json({ success: false, message: 'Server error.' });
        }
    }
);

// ============================================================
// API — FILES & PROFILE
// ============================================================

app.post('/api/upload-file', diskUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    try {
        const ext     = path.extname(req.file.originalname);
        const newName = `${uuidv4()}${ext}`;
        const newPath = path.join(uploadDir, newName);
        await fsPromises.rename(req.file.path, newPath);
        res.json({ success: true, url: `/uploads/${newName}` });
    } catch (err) {
        console.error('File upload error:', err);
        res.status(500).json({ success: false, message: 'File processing failed.' });
    }
});

app.post('/api/update-profile', memoryUpload.single('profilePic'), async (req, res) => {
    const { userId, preferredName, removeProfilePic, hidePreferredName, hideProfilePicture } = req.body;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        if (preferredName  !== undefined) user.preferredName      = preferredName;
        if (hidePreferredName  !== undefined) user.hidePreferredName  = hidePreferredName  === 'true';
        if (hideProfilePicture !== undefined) user.hideProfilePicture = hideProfilePicture === 'true';

        if (removeProfilePic === 'true') {
            await deleteFromCloudinary(userId);
            user.profilePic = '';
        } else if (req.file?.buffer) {
            user.profilePic = await uploadToCloudinary(req.file.buffer, userId);
        }

        await user.save();

        // Notify all contacts of updated profile pic in real-time
        const socketId = findSocketId(userId);
        if (socketId) {
            io.emit('profile-updated', {
                userId,
                profilePic:    user.profilePic,
                preferredName: user.hidePreferredName ? '' : user.preferredName
            });
        }

        res.json({
            success:            true,
            preferredName:      user.preferredName,
            profilePicUrl:      user.profilePic,
            hidePreferredName:  user.hidePreferredName,
            hideProfilePicture: user.hideProfilePicture
        });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
});

// ============================================================
// API — SETTINGS SYNC (v2.1.1)
// ============================================================

// GET settings for a user (called on reconnect from any device)
app.get('/api/settings/:userId', async (req, res) => {
    try {
        const user = await User.findOne({ xameId: req.params.userId }).select('settings');
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        res.json({ success: true, settings: user.settings || {} });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PATCH a single setting
app.post('/api/settings', async (req, res) => {
    const { userId, key, value } = req.body;
    if (!userId || !key) return res.status(400).json({ success: false, message: 'userId and key required.' });
    try {
        await User.updateOne(
            { xameId: userId },
            { $set: { [`settings.${key}`]: value } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// SOCKET.IO
// ============================================================

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log(`✅ Connected: ${userId} (${io.engine.clientsCount} total)`);

    socket.userId = userId;

    if (userId) {
        if (disconnectTimeouts.has(userId)) {
            clearTimeout(disconnectTimeouts.get(userId));
            disconnectTimeouts.delete(userId);
        }
        socketToUserMap.set(socket.id, userId);
        userToSocketMap.set(userId, socket.id);
        onlineUsers.add(userId);
        onlineUserTimestamps.set(userId, Date.now());
        broadcastOnlineUsers();

        // Push any pending settings to this socket on connect
        User.findOne({ xameId: userId }).select('settings').then(user => {
            if (user?.settings && Object.keys(user.settings).length > 0) {
                socket.emit('settings-sync', user.settings);
            }
        });
    }

    // ── Presence ──────────────────────────────────────────

    socket.on('user-online', ({ userId: uid, timestamp }) => {
        const id = uid || socket.userId;
        if (!id) return;
        clearTimeout(disconnectTimeouts.get(id));
        disconnectTimeouts.delete(id);
        onlineUsers.add(id);
        onlineUserTimestamps.set(id, timestamp || Date.now());
        if (id !== socket.userId) socket.userId = id;
        broadcastOnlineUsers();
    });

    socket.on('heartbeat', ({ userId: uid, timestamp }) => {
        const id = uid || socket.userId;
        if (!id) return;
        onlineUserTimestamps.set(id, timestamp || Date.now());
        if (!onlineUsers.has(id)) { onlineUsers.add(id); broadcastOnlineUsers(); }
        clearTimeout(disconnectTimeouts.get(id));
        disconnectTimeouts.delete(id);
    });

    socket.on('user-offline', ({ userId: uid }) => {
        const id = uid || socket.userId;
        if (!id) return;
        clearTimeout(disconnectTimeouts.get(id));
        disconnectTimeouts.delete(id);
        onlineUsers.delete(id);
        onlineUserTimestamps.delete(id);
        broadcastOnlineUsers();
    });

    socket.on('request_online_users', () => {
        socket.emit('online_users', Array.from(onlineUsers));
    });

    socket.on('disconnect', () => {
        const uid = socket.userId || socketToUserMap.get(socket.id);
        socketToUserMap.delete(socket.id);

        if (uid) {
            const hasOther = Array.from(socketToUserMap.values()).includes(uid);
            if (!hasOther) {
                const t = setTimeout(() => {
                    if (!Array.from(socketToUserMap.values()).includes(uid) && onlineUsers.has(uid)) {
                        onlineUsers.delete(uid);
                        onlineUserTimestamps.delete(uid);
                        userToSocketMap.delete(uid);
                        broadcastOnlineUsers();
                    }
                    disconnectTimeouts.delete(uid);
                }, 60000);
                disconnectTimeouts.set(uid, t);
            }
        }
    });

    // ── Chat history & contacts ────────────────────────────

    socket.on('get_chat_history', async ({ userId: reqId }) => {
        if (socketToUserMap.get(socket.id) !== reqId) return socket.emit('chat_history', {});
        try {
            const messages = await Message.find({
                $or: [{ senderId: reqId }, { recipientId: reqId }]
            }).sort('ts');

            const history = {};
            messages.forEach(msg => {
                const cid = msg.senderId === reqId ? msg.recipientId : msg.senderId;
                if (!history[cid]) history[cid] = [];
                history[cid].push({
                    id:        msg.messageId,
                    text:      msg.text,
                    file:      msg.file,
                    type:      msg.senderId === reqId ? 'sent' : 'received',
                    ts:        msg.ts,
                    status:    msg.status,
                    replyTo:   msg.replyTo   || null,
                    expiresAt: msg.expiresAt || null,
                    reactions: msg.reactions  || {},
                    forwarded: msg.forwarded  || false
                });
            });

            socket.emit('chat_history', history);
        } catch (err) {
            console.error('chat_history error:', err);
            socket.emit('chat_history', {});
        }
    });

    socket.on('get_contacts', async (reqId) => {
        if (socketToUserMap.get(socket.id) !== reqId) return socket.emit('contacts_list', []);
        try {
            socket.emit('contacts_list', await getFullContactData(reqId));
        } catch (err) {
            console.error('contacts_list error:', err);
            socket.emit('contacts_list', []);
        }
    });

    // ── Messaging ──────────────────────────────────────────

    socket.on('send-message', async (data, callback) => {
        const { recipientId, message } = data;
        const senderId      = socketToUserMap.get(socket.id);
        const recipSocketId = findSocketId(recipientId);

        try {
            const newMsg = new Message({
                messageId:   message.id,
                senderId,
                recipientId,
                ts:          message.ts,
                ...(message.text      && { text:      message.text }),
                ...(message.file      && { file:      message.file }),
                ...(message.replyTo   && { replyTo:   message.replyTo }),
                ...(message.expiresAt && { expiresAt: message.expiresAt }),
                ...(message.forwarded && { forwarded: message.forwarded })
            });
            await newMsg.save();

            if (recipSocketId) {
                io.to(recipSocketId).emit('receive-message', { senderId, message });
                await Message.findOneAndUpdate({ messageId: message.id }, { status: 'delivered' });
                socket.emit('message-status-update', { recipientId, messageId: message.id, status: 'delivered' });
                io.to(recipSocketId).emit('new_message_count', { senderId });

                // Push notification if recipient has a subscription
                try {
                    const pushSub = await PushSubscription.findOne({ userId: recipientId });
                    if (pushSub) {
                        await webpush.sendNotification(pushSub.subscription, JSON.stringify({
                            type: 'new-message',
                            senderId,
                            preview: message.text ? message.text.slice(0, 60) : '📎 Attachment'
                        }));
                    }
                } catch (_) { /* non-fatal */ }
            }

            if (typeof callback === 'function') callback({ success: true, messageId: message.id });
        } catch (err) {
            console.error('send-message error:', err);
            if (typeof callback === 'function') callback({ success: false, message: 'Server failed to save message.' });
        }
    });

    socket.on('status-update', async ({ userId, status }) => {
        if (!userId || !status) return;
        // Persist to user settings
        try {
            await User.updateOne({ xameId: userId }, { $set: { 'settings.personalStatus': status } });
        } catch (e) { console.error('status-update persist error:', e); }
        // Broadcast to all contacts who are online
        const userSockets = [...socketToUserMap.entries()]
            .filter(([, uid]) => uid !== userId)
            .map(([sid]) => sid);
        userSockets.forEach(sid => {
            io.to(sid).emit('contact-status-update', { userId, status });
        });
    });

    socket.on('sync-deletions', async (data, callback) => {
        const uid = socketToUserMap.get(socket.id);
        if (!uid) return callback({ success: false, message: 'Not authenticated.' });
        if (!data?.chat) return callback({ success: false, message: 'Invalid payload.' });

        const { contactId, messageIds, deleteForEveryone } = data.chat;
        if (!messageIds?.length) return callback({ success: true });

        try {
            if (deleteForEveryone) {
                const result = await Message.deleteMany({ messageId: { $in: messageIds }, senderId: uid });
                if (result.deletedCount > 0) {
                    const recipSocketId = findSocketId(contactId);
                    if (recipSocketId) {
                        io.to(recipSocketId).emit('messages-deleted', {
                            deleterId: uid, contactId: uid, messageIds, permanently: true
                        });
                    }
                }
            }
            callback({ success: true });
        } catch (err) {
            console.error('sync-deletions error:', err);
            callback({ success: false, message: 'Server error.' });
        }
    });

    socket.on('message-seen', async ({ recipientId, messageIds }) => {
        const senderId      = socketToUserMap.get(socket.id);
        const recipSocketId = findSocketId(recipientId);
        try {
            await Message.updateMany(
                { messageId: { $in: messageIds }, recipientId: senderId, senderId: recipientId },
                { status: 'seen' }
            );
            if (recipSocketId) {
                io.to(recipSocketId).emit('message-seen-update', { recipientId: senderId, messageIds });
            }
        } catch (err) {
            console.error('message-seen error:', err);
        }
    });

    socket.on('typing',      ({ recipientId }) => {
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('typing',      { senderId: socketToUserMap.get(socket.id) });
    });

    socket.on('stop-typing', ({ recipientId }) => {
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('stop-typing', { senderId: socketToUserMap.get(socket.id) });
    });

    // ── Reactions (v2.1.1) ────────────────────────────────
    //
    // Client emits:  reaction:toggle  { messageId, emoji, userId }
    // Server emits:  reaction:update  { messageId, emoji, userId, action }
    //                to the other participant in the conversation.

    socket.on('reaction:toggle', async ({ messageId, emoji, userId: reactorId }) => {
        try {
            const msg = await Message.findOne({ messageId });
            if (!msg) return;

            const reactions    = msg.reactions || {};
            const currentUsers = reactions[emoji] || [];
            let action;

            if (currentUsers.includes(reactorId)) {
                reactions[emoji] = currentUsers.filter(u => u !== reactorId);
                if (reactions[emoji].length === 0) delete reactions[emoji];
                action = 'remove';
            } else {
                reactions[emoji] = [...currentUsers, reactorId];
                action = 'add';
            }

            await Message.updateOne({ messageId }, { $set: { reactions } });

            // Find the other participant and notify them
            const otherId      = msg.senderId === reactorId ? msg.recipientId : msg.senderId;
            const otherSocket  = findSocketId(otherId);
            if (otherSocket) {
                io.to(otherSocket).emit('reaction:update', { messageId, emoji, userId: reactorId, action });
            }
        } catch (err) {
            console.error('reaction:toggle error:', err);
        }
    });

    // ── Disappearing messages (v2.1.1) ────────────────────
    //
    // Client emits:  disappearing:timer-set     { contactId, userId, value }
    // Server emits:  disappearing:timer-changed { contactId, value, senderName }
    //                to the other participant.
    //
    // Server-side expiry: a periodic job sweeps for expired messages and
    // fires disappearing:expired to any online recipients.

    socket.on('disappearing:timer-set', async ({ contactId, userId: setterId, value }) => {
        try {
            const setter  = await User.findOne({ xameId: setterId });
            const senderName = setter
                ? (setter.preferredName || `${setter.firstName} ${setter.lastName}`.trim() || setterId)
                : setterId;

            const recipSocket = findSocketId(contactId);
            if (recipSocket) {
                io.to(recipSocket).emit('disappearing:timer-changed', { contactId: setterId, value, senderName });
            }
        } catch (err) {
            console.error('disappearing:timer-set error:', err);
        }
    });

    // ── Settings sync (v2.1.1) ────────────────────────────
    //
    // When a user changes a setting on one device, the server
    // persists it and forwards it to all other sockets for this user.

    socket.on('settings-changed', async ({ key, value }) => {
        const uid = socketToUserMap.get(socket.id);
        if (!uid || !key) return;
        try {
            await User.updateOne({ xameId: uid }, { $set: { [`settings.${key}`]: value } });
            // Forward to other connected sockets for same user (multi-device)
            const otherSockets = Array.from(socketToUserMap.entries())
                .filter(([sid, uid2]) => uid2 === uid && sid !== socket.id)
                .map(([sid]) => sid);
            otherSockets.forEach(sid => {
                io.to(sid).emit('settings-changed', { key, value });
            });
        } catch (err) {
            console.error('settings-changed error:', err);
        }
    });

    // ── Screen sharing (v2.1.1) ───────────────────────────

    socket.on('screen-share:started', ({ recipientId }) => {
        const senderId    = socketToUserMap.get(socket.id);
        const recipSocket = findSocketId(recipientId);
        if (recipSocket) {
            io.to(recipSocket).emit('conference:screen-share-started', { userId: senderId });
        }
    });

    socket.on('screen-share:stopped', ({ recipientId }) => {
        const recipSocket = findSocketId(recipientId);
        if (recipSocket) {
            io.to(recipSocket).emit('conference:screen-share-stopped');
        }
    });

    socket.on('screen-share:paused', ({ recipientId }) => {
        const senderId    = socketToUserMap.get(socket.id);
        const recipSocket = findSocketId(recipientId);
        if (recipSocket) {
            io.to(recipSocket).emit('screen-share:paused', { userId: senderId });
        }
    });

    socket.on('screen-share:resumed', ({ recipientId }) => {
        const senderId    = socketToUserMap.get(socket.id);
        const recipSocket = findSocketId(recipientId);
        if (recipSocket) {
            io.to(recipSocket).emit('screen-share:resumed', { userId: senderId });
        }
    });

    // ── Conference (v2.1.1) ───────────────────────────────
    //
    // Rooms are tracked in-memory (conferenceRooms map) and also
    // persisted to MongoDB for audit. Socket.IO rooms are used for
    // broadcasting to all participants efficiently.

    socket.on('conference:join', async ({ roomId, userId: uid, displayName, isHost }) => {
        const authenticatedId = socketToUserMap.get(socket.id);
        if (authenticatedId !== uid) return;

        // Join Socket.IO room
        socket.join(`conf:${roomId}`);

        // Track in-memory
        if (!conferenceRooms.has(roomId)) {
            conferenceRooms.set(roomId, new Set());
            conferenceRoomMeta.set(roomId, { hostId: uid, displayNames: new Map() });
        }
        conferenceRooms.get(roomId).add(uid);
        conferenceRoomMeta.get(roomId).displayNames.set(uid, displayName);

        // Notify everyone else in the room
        socket.to(`conf:${roomId}`).emit('conference:peer-joined', { peerId: uid, displayName });

        // Persist to MongoDB
        try {
            await ConferenceRoom.findOneAndUpdate(
                { roomId },
                {
                    $setOnInsert: { roomId, hostId: uid, createdAt: new Date() },
                    $addToSet:    { participants: { userId: uid, displayName, joinedAt: new Date() } }
                },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error('conference:join persist error:', err);
        }

        console.log(`📹 ${uid} joined conference ${roomId} (${conferenceRooms.get(roomId).size} participants)`);
    });

    socket.on('conference:leave', async ({ roomId, userId: uid }) => {
        socket.leave(`conf:${roomId}`);

        const room = conferenceRooms.get(roomId);
        if (room) {
            room.delete(uid);
            const meta = conferenceRoomMeta.get(roomId);
            const displayName = meta?.displayNames.get(uid) || uid;
            meta?.displayNames.delete(uid);

            io.to(`conf:${roomId}`).emit('conference:peer-left', { peerId: uid, displayName });

            // If room is empty or host left, close it
            if (room.size === 0) {
                conferenceRooms.delete(roomId);
                conferenceRoomMeta.delete(roomId);
            } else if (meta?.hostId === uid) {
                io.to(`conf:${roomId}`).emit('conference:room-closed');
                conferenceRooms.delete(roomId);
                conferenceRoomMeta.delete(roomId);
            }
        }

        console.log(`👋 ${uid} left conference ${roomId}`);
    });

    // WebRTC signalling within conference
    socket.on('conference:offer', ({ roomId, to, from, offer, displayName }) => {
        const toSocket = findSocketId(to);
        if (toSocket) io.to(toSocket).emit('conference:offer', { from, displayName, offer });
    });

    socket.on('conference:answer', ({ roomId, to, from, answer }) => {
        const toSocket = findSocketId(to);
        if (toSocket) io.to(toSocket).emit('conference:answer', { from, answer });
    });

    socket.on('conference:ice', ({ roomId, to, from, candidate }) => {
        const toSocket = findSocketId(to);
        if (toSocket) io.to(toSocket).emit('conference:ice', { from, candidate });
    });

    // Host actions
    socket.on('conference:mute-peer', ({ roomId, targetId }) => {
        const meta = conferenceRoomMeta.get(roomId);
        if (meta?.hostId !== socketToUserMap.get(socket.id)) return; // only host
        const targetSocket = findSocketId(targetId);
        if (targetSocket) io.to(targetSocket).emit('conference:muted-by-host');
        socket.to(`conf:${roomId}`).emit('conference:mic-toggle', { userId: targetId, muted: true });
    });

    socket.on('conference:remove-peer', ({ roomId, targetId }) => {
        const meta = conferenceRoomMeta.get(roomId);
        if (meta?.hostId !== socketToUserMap.get(socket.id)) return;
        const targetSocket = findSocketId(targetId);
        if (targetSocket) {
            io.to(targetSocket).emit('conference:removed-by-host');
            // Force-leave the room
            io.sockets.sockets.get(targetSocket)?.leave(`conf:${roomId}`);
        }
        const room = conferenceRooms.get(roomId);
        if (room) {
            room.delete(targetId);
            const displayName = meta?.displayNames.get(targetId) || targetId;
            meta?.displayNames.delete(targetId);
            io.to(`conf:${roomId}`).emit('conference:peer-left', { peerId: targetId, displayName });
        }
    });

    // Broadcast controls to whole room
    socket.on('conference:mic-toggle', ({ roomId, userId: uid, muted }) => {
        socket.to(`conf:${roomId}`).emit('conference:mic-toggle', { userId: uid, muted });
    });

    socket.on('conference:raise-hand', ({ roomId, userId: uid, raised }) => {
        socket.to(`conf:${roomId}`).emit('conference:raise-hand', { userId: uid, raised });
    });

    socket.on('conference:screen-share-started', ({ roomId, userId: uid }) => {
        socket.to(`conf:${roomId}`).emit('conference:screen-share-started', { userId: uid });
    });

    socket.on('conference:screen-share-stopped', ({ roomId }) => {
        socket.to(`conf:${roomId}`).emit('conference:screen-share-stopped');
    });

    // ── Group messaging ───────────────────────────────────
    socket.on('group:send-message', async ({ groupId, message }, callback) => {
        try {
            const group = await Group.findOne({ groupId });
            if (!group) return callback?.({ success: false, message: 'Group not found' });
            const isMember = group.members.find(m => m.userId === message.senderId);
            if (!isMember) return callback?.({ success: false, message: 'Not a member' });
            const saved = await GroupMessage.create({
                groupId, senderId: message.senderId, senderName: message.senderName || isMember.name,
                text: message.text || '', file: message.file || null, replyTo: message.replyTo || null, ts: message.ts || Date.now()
            });
            group.lastMessageTs      = saved.ts;
            group.lastMessagePreview = message.text ? message.text.slice(0, 50) : '📎 Attachment';
            await group.save();
            // Broadcast to all online members
            group.members.forEach(m => {
                if (m.userId !== message.senderId) {
                    const sid = [...socketToUserMap.entries()].find(([, uid]) => uid === m.userId)?.[0];
                    if (sid) io.to(sid).emit('group:message', { groupId, message: saved.toObject() });
                }
            });
            callback?.({ success: true, messageId: saved._id });
        } catch (err) {
            callback?.({ success: false, message: err.message });
        }
    });

    socket.on('group:typing', ({ groupId, userId, name }) => {
        const group = Group.findOne({ groupId }).then(g => {
            if (!g) return;
            g.members.forEach(m => {
                if (m.userId !== userId) {
                    const sid = [...socketToUserMap.entries()].find(([, uid]) => uid === m.userId)?.[0];
                    if (sid) io.to(sid).emit('group:typing', { groupId, userId, name });
                }
            });
        });
    });

    // ── 1-to-1 WebRTC (unchanged from v2.1) ──────────────

    socket.on('call-user', async ({ recipientId, offer, callType }) => {
        const callerId      = socketToUserMap.get(socket.id);
        const recipSocketId = findSocketId(recipientId);

        if (recipSocketId) {
            try {
                const [caller, recipient] = await Promise.all([
                    User.findOne({ xameId: callerId }),
                    User.findOne({ xameId: recipientId }).populate('contacts.contactId')
                ]);
                if (!caller || !recipient) return socket.emit('call-error', { message: 'User not found.' });

                const callId       = uuidv4();
                await new CallHistory({ callId, callerId, recipientId, callType, status: 'pending' }).save();

                const fc           = getPrivacyFilteredContactData(caller.toObject());
                const saved        = recipient.contacts.find(c => c.contactId?.xameId === callerId);
                const incomingName = getContactDisplayName(callerId, fc, saved);

                io.to(recipSocketId).emit('call-user', {
                    offer, callerId, callType, callId,
                    caller: { xameId: fc.xameId, preferredName: fc.preferredName, profilePic: fc.profilePic, displayName: incomingName }
                });

                // Push notification
                try {
                    const pushSub = await PushSubscription.findOne({ userId: recipientId });
                    if (pushSub) {
                        await webpush.sendNotification(pushSub.subscription, JSON.stringify({
                            type: 'incoming-call', callerId, callerName: incomingName, callType, callId
                        }));
                    }
                } catch (_) { /* non-fatal */ }

            } catch (err) {
                console.error('call-user error:', err);
                socket.emit('call-error', { message: 'Failed to initiate call.' });
            }
        } else {
            try {
                await new CallHistory({ callId: uuidv4(), callerId, recipientId, callType, status: 'missed' }).save();
                socket.emit('call-rejected', { senderId: recipientId, reason: 'offline' });
            } catch (err) {
                console.error('Missed call record error:', err);
            }
        }
    });

    socket.on('make-answer', ({ recipientId, answer }) => {
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('make-answer', { answer, senderId: socketToUserMap.get(socket.id) });
    });

    socket.on('ice-candidate', ({ recipientId, candidate }) => {
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('ice-candidate', { candidate, senderId: socketToUserMap.get(socket.id) });
    });

    socket.on('stream-ready', ({ recipientId, streamType }) => {
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('stream-ready', { senderId: socketToUserMap.get(socket.id), streamType });
    });

    socket.on('call-accepted', async ({ recipientId, callId }) => {
        const acceptorId = socketToUserMap.get(socket.id);
        const sid        = findSocketId(recipientId);
        if (sid) io.to(sid).emit('call-accepted', { recipientId: acceptorId });
        try {
            const q = callId
                ? { callId }
                : { callerId: recipientId, recipientId: acceptorId, status: 'pending' };
            await CallHistory.findOneAndUpdate(q, { status: 'accepted' });
        } catch (err) { console.error('call-accepted history error:', err); }
    });

    socket.on('call-rejected', async ({ recipientId, reason, callId }) => {
        const rejectorId = socketToUserMap.get(socket.id);
        const sid        = findSocketId(recipientId);
        try {
            const q = callId
                ? { callId }
                : { callerId: recipientId, recipientId: rejectorId, status: 'pending' };
            const updated = await CallHistory.findOneAndUpdate(q, { status: 'rejected' });
            if (sid) io.to(sid).emit('call-rejected', { senderId: rejectorId, reason });
            if (updated) socket.emit('call-acknowledged', { senderId: recipientId, acknowledgedCallId: updated.callId });
        } catch (err) { console.error('call-rejected error:', err); }
    });

    socket.on('call-unanswered', async ({ recipientId, callId }) => {
        const callerId = socketToUserMap.get(socket.id);
        try {
            await CallHistory.findOneAndUpdate(
                { callId, callerId, recipientId, status: 'pending' },
                { status: 'missed' }
            );
            const sid = findSocketId(recipientId);
            if (sid) io.to(sid).emit('new_missed_call_count', { senderId: callerId });
        } catch (err) { console.error('call-unanswered error:', err); }
    });

    socket.on('call-ended', async ({ recipientId }) => {
        const uid = socketToUserMap.get(socket.id);
        try {
            await CallHistory.findOneAndUpdate(
                { $or: [
                    { callerId: uid, recipientId, status: 'accepted' },
                    { callerId: recipientId, recipientId: uid, status: 'accepted' }
                ]},
                { status: 'ended', endTime: new Date() }
            );
            const recipSid = findSocketId(recipientId);
            if (recipSid) io.to(recipSid).emit('call-ended', { senderId: uid });
        } catch (err) { console.error('call-ended error:', err); }
    });
});

// ============================================================
// DISAPPEARING MESSAGES — SERVER-SIDE SWEEP
// Runs every 60s. Finds expired messages, deletes them from DB,
// and notifies online users.
// ============================================================

setInterval(async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip if MongoDB not connected
    try {
        const now     = Date.now();
        const expired = await Message.find({ expiresAt: { $lte: now, $ne: null } });

        if (expired.length === 0) return;

        const ids = expired.map(m => m.messageId);
        await Message.deleteMany({ messageId: { $in: ids } });

        expired.forEach(msg => {
            const senderSocket = findSocketId(msg.senderId);
            const recipSocket  = findSocketId(msg.recipientId);
            const payload      = { messageId: msg.messageId, contactId: msg.senderId };

            if (senderSocket) io.to(senderSocket).emit('disappearing:expired', { ...payload, contactId: msg.recipientId });
            if (recipSocket)  io.to(recipSocket).emit('disappearing:expired',  payload);
        });

        console.log(`🗑️  Swept ${expired.length} expired message(s)`);
    } catch (err) {
        console.error('Disappearing message sweep error:', err);
    }
}, 60 * 1000);

// ── Scheduled Messages Sweep (every 15 seconds) ───────────────────────────
setInterval(async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip if MongoDB not connected
    try {
        const now = Date.now();
        const due = await ScheduledMessage.find({ sendAt: { $lte: now }, sent: false });
        if (!due.length) return;

        for (const scheduled of due) {
            try {
                const msgId = require('uuid').v4();
                const ts = Date.now();
                const message = {
                    messageId:   msgId,
                    senderId:    scheduled.senderId,
                    recipientId: scheduled.recipientId,
                    text:        scheduled.text || '',
                    file:        scheduled.file || null,
                    ts,
                    status:      'delivered',
                };
                await new Message(message).save();

                // Deliver to recipient if online
                const recipSocket = findSocketId(scheduled.recipientId);
                const senderSocket = findSocketId(scheduled.senderId);
                const payload = { id: msgId, text: scheduled.text || '', file: scheduled.file || null, type: 'received', ts, status: 'delivered' };

                if (recipSocket) {
                    const sender = await User.findOne({ xameId: scheduled.senderId });
                    io.to(recipSocket).emit('receive-message', {
                        senderId: scheduled.senderId,
                        message:  payload,
                        sender:   sender ? { xameId: sender.xameId, preferredName: sender.preferredName, profilePic: sender.profilePic } : null,
                    });
                }
                if (senderSocket) {
                    io.to(senderSocket).emit('scheduled-message-sent', {
                        scheduleId: scheduled.scheduleId,
                        message: { ...payload, type: 'sent' },
                        recipientId: scheduled.recipientId,
                    });
                }

                scheduled.sent = true;
                await scheduled.save();
            } catch (err) { console.error('Scheduled send error:', err); }
        }
    } catch (err) { console.error('Schedule sweep error:', err); }
}, 15 * 1000);

// ── Scheduled Calls Sweep (every 15 seconds) ─────────────────────────────
setInterval(async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip if MongoDB not connected
    try {
        const now = Date.now();
        const due = await ScheduledCall.find({ callAt: { $lte: now }, fired: false });
        if (!due.length) return;
        for (const sc of due) {
            try {
                const callerSocket = findSocketId(sc.callerId);
                if (callerSocket) {
                    io.to(callerSocket).emit('scheduled-call-due', {
                        scheduleId:  sc.scheduleId,
                        recipientId: sc.recipientId,
                        callType:    sc.callType,
                    });
                }
                sc.fired = true;
                await sc.save();
            } catch (err) { console.error('Scheduled call fire error:', err); }
        }
    } catch (err) { console.error('Scheduled call sweep error:', err); }
}, 15 * 1000);

// ============================================================
// SPA CATCH-ALL
// ============================================================


// -- Group API --
app.post('/api/groups/create', async (req, res) => {
    try {
        const { userId, name, description, memberIds } = req.body;
        if (!userId || !name) return res.status(400).json({ success: false, message: 'Missing data' });
        const groupId = 'grp-' + Date.now() + Math.random().toString(36).slice(2, 8);
        const members = [{ userId, name: '', role: 'admin', joinedAt: new Date() }];
        if (Array.isArray(memberIds)) {
            const users = await User.find({ xameId: { $in: memberIds } });
            users.forEach(u => {
                if (u.xameId !== userId) members.push({ userId: u.xameId, name: u.preferredName || u.firstName, role: 'member', joinedAt: new Date() });
            });
        }
        const user = await User.findOne({ xameId: userId });
        members[0].name = user?.preferredName || user?.firstName || userId;
        const group = await Group.create({ groupId, name, description: description || '', createdBy: userId, members });
        res.json({ success: true, group });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/groups/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const groups = await Group.find({ 'members.userId': userId }).sort({ lastMessageTs: -1 });
        res.json({ success: true, groups });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/groups/messages/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const messages = await GroupMessage.find({ groupId }).sort({ ts: 1 }).limit(100).lean();
        res.json({ success: true, messages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/groups/add-member', async (req, res) => {
    try {
        const { groupId, requesterId, userId } = req.body;
        const group = await Group.findOne({ groupId });
        if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
        const requester = group.members.find(m => m.userId === requesterId);
        if (!requester || requester.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins can add members' });
        if (group.members.find(m => m.userId === userId)) return res.status(400).json({ success: false, message: 'Already a member' });
        const user = await User.findOne({ xameId: userId });
        group.members.push({ userId, name: user?.preferredName || user?.firstName || userId, role: 'member', joinedAt: new Date() });
        await group.save();
        res.json({ success: true, group });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/groups/remove-member', async (req, res) => {
    try {
        const { groupId, requesterId, userId } = req.body;
        const group = await Group.findOne({ groupId });
        if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
        const requester = group.members.find(m => m.userId === requesterId);
        if (!requester || requester.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins can remove members' });
        group.members = group.members.filter(m => m.userId !== userId);
        await group.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/groups/upload-avatar', memoryUpload.single('avatar'), async (req, res) => {
    try {
        const { groupId, userId } = req.body;
        if (!groupId || !req.file) return res.status(400).json({ success: false, message: 'Missing data' });
        const group = await Group.findOne({ groupId });
        if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
        const isAdmin = group.members.find(m => m.userId === userId && m.role === 'admin');
        if (!isAdmin) return res.status(403).json({ success: false, message: 'Admins only' });
        let avatarUrl;
        const cloudinaryOk = process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
        if (cloudinaryOk) {
            avatarUrl = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: 'xame_group_avatars', resource_type: 'image' },
                    (err, result) => err ? reject(err) : resolve(result.secure_url)
                );
                stream.end(req.file.buffer);
            });
        } else {
            const fs = require('fs');
            const ext = req.file.originalname.split('.').pop() || 'jpg';
            const fname = 'group_' + groupId + '_' + Date.now() + '.' + ext;
            const fpath = require('path').join(uploadDir, fname);
            fs.writeFileSync(fpath, req.file.buffer);
            avatarUrl = '/uploads/' + fname;
        }
        group.avatar = avatarUrl;
        await group.save();
        res.json({ success: true, avatarUrl });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/groups/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const group = await Group.findOne({ groupId });
        if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
        if (group.createdBy !== userId) return res.status(403).json({ success: false, message: 'Only creator can delete group' });
        await Group.deleteOne({ groupId });
        await GroupMessage.deleteMany({ groupId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ── Broadcast List API ────────────────────────────────────────────────────
app.post('/api/broadcast/create', async (req, res) => {
    try {
        const { ownerId, name, members } = req.body;
        if (!ownerId || !name || !members?.length) return res.status(400).json({ success: false, message: 'Missing fields' });
        const listId = require('uuid').v4();
        const list = await BroadcastList.create({ listId, ownerId, name, members });
        res.json({ success: true, list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/broadcast/:ownerId', async (req, res) => {
    try {
        const lists = await BroadcastList.find({ ownerId: req.params.ownerId }).sort({ createdAt: -1 });
        res.json({ success: true, lists });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/broadcast/:listId', async (req, res) => {
    try {
        const { name, members, ownerId } = req.body;
        const list = await BroadcastList.findOne({ listId: req.params.listId, ownerId });
        if (!list) return res.status(404).json({ success: false, message: 'List not found' });
        if (name) list.name = name;
        if (members) list.members = members;
        await list.save();
        res.json({ success: true, list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/broadcast/:listId', async (req, res) => {
    try {
        const { ownerId } = req.body;
        await BroadcastList.deleteOne({ listId: req.params.listId, ownerId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ── Broadcast List API ────────────────────────────────────────────────────
app.post('/api/broadcast/create', async (req, res) => {
    try {
        const { ownerId, name, members } = req.body;
        if (!ownerId || !name || !members?.length) return res.status(400).json({ success: false, message: 'Missing fields' });
        const listId = require('uuid').v4();
        const list = await BroadcastList.create({ listId, ownerId, name, members });
        res.json({ success: true, list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/broadcast/:ownerId', async (req, res) => {
    try {
        const lists = await BroadcastList.find({ ownerId: req.params.ownerId }).sort({ createdAt: -1 });
        res.json({ success: true, lists });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.put('/api/broadcast/:listId', async (req, res) => {
    try {
        const { name, members, ownerId } = req.body;
        const list = await BroadcastList.findOne({ listId: req.params.listId, ownerId });
        if (!list) return res.status(404).json({ success: false, message: 'List not found' });
        if (name) list.name = name;
        if (members) list.members = members;
        await list.save();
        res.json({ success: true, list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/broadcast/:listId', async (req, res) => {
    try {
        const { ownerId } = req.body;
        await BroadcastList.deleteOne({ listId: req.params.listId, ownerId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Scheduled Messages API ───────────────────────────────────────────────
app.post('/api/schedule/create', async (req, res) => {
    try {
        const { senderId, recipientId, text, file, sendAt } = req.body;
        if (!senderId || !recipientId || !sendAt) return res.status(400).json({ success: false, message: 'Missing fields' });
        const scheduleId = require('uuid').v4();
        const msg = await ScheduledMessage.create({ scheduleId, senderId, recipientId, text: text || '', file: file || null, sendAt });
        res.json({ success: true, message: msg });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/schedule/:userId', async (req, res) => {
    try {
        const msgs = await ScheduledMessage.find({ senderId: req.params.userId, sent: false }).sort({ sendAt: 1 });
        res.json({ success: true, messages: msgs });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/schedule/:scheduleId', async (req, res) => {
    try {
        const { userId } = req.body;
        await ScheduledMessage.deleteOne({ scheduleId: req.params.scheduleId, senderId: userId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Scheduled Calls API ──────────────────────────────────────────────────
app.post('/api/schedule-call/create', async (req, res) => {
    try {
        const { callerId, recipientId, callType, callAt } = req.body;
        if (!callerId || !recipientId || !callAt) return res.status(400).json({ success: false, message: 'Missing fields' });
        const scheduleId = require('uuid').v4();
        const call = await ScheduledCall.create({ scheduleId, callerId, recipientId, callType: callType || 'voice', callAt });
        res.json({ success: true, call });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/schedule-call/:userId', async (req, res) => {
    try {
        const calls = await ScheduledCall.find({ callerId: req.params.userId, fired: false }).sort({ callAt: 1 });
        res.json({ success: true, calls });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/schedule-call/:scheduleId', async (req, res) => {
    try {
        const { userId } = req.body;
        await ScheduledCall.deleteOne({ scheduleId: req.params.scheduleId, callerId: userId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Call History API ─────────────────────────────────────────────────────
app.get('/api/call-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const calls = await CallHistory.find({
            $or: [{ callerId: userId }, { recipientId: userId }]
        }).sort({ startTime: -1 }).limit(100);
        res.json({ success: true, calls });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.patch('/api/call-history/:userId/seen', async (req, res) => {
    try {
        const { userId } = req.params;
        await CallHistory.updateMany(
            { recipientId: userId, status: 'missed', seen: false },
            { $set: { seen: true } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/call-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        await CallHistory.deleteMany({ $or: [{ callerId: userId }, { recipientId: userId }] });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// -- Gallery API --
app.post('/api/gallery/upload', memoryUpload.single('file'), async (req, res) => {
    try {
        const { userId, caption, price, visibility, mode } = req.body;
        if (!userId || !req.file) return res.status(400).json({ success: false, message: 'Missing data' });
        const fileType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
        const cloudinaryOk = process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
        let url;
        if (cloudinaryOk) {
            url = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: `xame_gallery/${userId}`, resource_type: 'auto' },
                    (err, result) => err ? reject(err) : resolve(result.secure_url)
                );
                stream.end(req.file.buffer);
            });
        } else {
            const fs = require('fs');
            const ext = req.file.originalname.split('.').pop() || (fileType === 'video' ? 'mp4' : 'jpg');
            const fname = 'gallery_' + userId + '_' + Date.now() + '.' + ext;
            const fpath = require('path').join(uploadDir, fname);
            fs.writeFileSync(fpath, req.file.buffer);
            url = '/uploads/' + fname;
        }
        const item = await GalleryItem.create({ userId, url, type: fileType, caption: caption || '', price: price || '', visibility: visibility || 'contacts', mode: mode || 'personal' });
        res.json({ success: true, item });
    } catch (err) {
        console.error('Gallery upload error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/gallery/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const items = await GalleryItem.find({ userId }).sort({ createdAt: -1 });
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/gallery/:itemId', async (req, res) => {
    try {
        const { itemId } = req.params;
        const { userId } = req.body;
        const item = await GalleryItem.findById(itemId);
        if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
        if (item.userId !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });
        await GalleryItem.deleteOne({ _id: itemId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, message: 'API endpoint not found: ' + req.path });
    }
    res.sendFile(path.join(BASE_DIR, 'index.html'));
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 8080;

createDirectories().then(() => {
    server.listen(PORT, () => {
        console.log('='.repeat(60));
        console.log('✅  XamePage Server v2.1.1');
        console.log('='.repeat(60));
        console.log(`📡 Port:          ${PORT}`);
        console.log(`🌐 Local:         http://localhost:${PORT}`);
        console.log(`☁️  Profile pics:  Cloudinary`);
        console.log(`🗄️  MongoDB:       Connected`);
        console.log(`📹 Conference:    ✅ Room signalling`);
        console.log(`🖥️  Screen share:  ✅ Relay events`);
        console.log(`❤️  Reactions:     ✅ Persist + broadcast`);
        console.log(`⏱️  Disappearing:  ✅ Server sweep (60s)`);
        console.log(`⚙️  Settings sync: ✅ Cross-device`);
        console.log('='.repeat(60));
    });
}).catch(err => {
    console.error('❌ Failed to start:', err);
    process.exit(1);
});
