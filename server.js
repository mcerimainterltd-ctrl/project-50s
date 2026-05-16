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
const { Resend }  = require('resend');
// const resend      = // new Resend(process.env.RESEND_API_KEY);
const twilio      = require('twilio');
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
const crypto     = require('crypto');
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
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
const webpush    = require('web-push');
require('dotenv').config();
const admin = require('firebase-admin');
const basicAuth = require('express-basic-auth');
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (serviceAccount.project_id) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('Firebase Admin initialized');
  }
} catch(e) { console.warn('Firebase Admin init failed:', e.message); }

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

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(cors());

// ============================================================
// CLOUDINARY
// ============================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    timeout:    120000
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
                public_id: `user_${userId}_${Date.now()}`,
                overwrite: false,
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

// ── XamePay Wallet Schema ────────────────────────────────────────────────────
const walletSchema = new mongoose.Schema({
    xameId:       { type: String, required: true, unique: true },
    balance:      { type: Number, default: 0 },
    currency:     { type: String, default: process.env.WALLET_DEFAULT_CURRENCY || 'NGN' },
    virtualAccount: {
        accountNumber: { type: String, default: '' },
        bankName:      { type: String, default: '' },
        provider:      { type: String, default: '' },
    },
    transactions: [{
        id:     { type: String },
        label:  { type: String },
        icon:   { type: String },
        amount: { type: Number },
        type:   { type: String, enum: ['credit','debit'] },
        status: { type: String, default: 'Completed' },
        ref:    { type: String },
        ts:     { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Wallet = mongoose.model('Wallet', walletSchema);

// ── Call Credits Schema ───────────────────────────────────────────────────
const callCreditsSchema = new mongoose.Schema({
    xameId:   { type: String, required: true, unique: true },
    balance:  { type: Number, default: 0 }, // in units (1 unit = 1 second of call)
    currency: { type: String, default: 'NGN' },
    transactions: [{
        id:       { type: String },
        type:     { type: String, enum: ['topup', 'debit', 'recharge'] },
        amount:   { type: Number },
        label:    { type: String },
        ref:      { type: String },
        ts:       { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});
const CallCredits = mongoose.model('CallCredits', callCreditsSchema);

// ── PSTN Rates (per minute in NGN) ───────────────────────────────────────
const PSTN_RATES = {
    'NG': { rate: 12, label: 'Nigeria' },
    'US': { rate: 8,  label: 'United States' },
    'GB': { rate: 10, label: 'United Kingdom' },
    'GH': { rate: 15, label: 'Ghana' },
    'KE': { rate: 15, label: 'Kenya' },
    'ZA': { rate: 12, label: 'South Africa' },
    'default': { rate: 20, label: 'International' }
};

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
    fcmToken:           { type: String, default: '' },
    extraSecurity: {
        enabled:   { type: Boolean, default: false },
        email:     { type: String, default: '' },
        phone:     { type: String, default: '' },
    },
    otpCode:            { type: String, default: null },
    otpExpires:         { type: Date,   default: null },
    sessions:           [{
        token:     { type: String, required: true },
        deviceInfo:{ type: String, default: 'Unknown device' },
        createdAt: { type: Date, default: Date.now },
        lastSeen:  { type: Date, default: Date.now }
    }],
    createdAt:          { type: Date, default: Date.now },
    suspended:          { type: Boolean, default: false },
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
    duration:    { type: Number, default: 0 }, // seconds
    type:        { type: String, default: "xamepage", enum: ["xamepage", "pstn"] },
    cost:        { type: Number, default: 0 },
    seen:        { type: Boolean, default: false },
    status: {
        type: String, required: true,
        enum: ['pending', 'accepted', 'rejected', 'ended', 'missed', 'offline']
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
    description: { type: String, default: '' },
    price:       { type: String, default: '' },
    phone:       { type: String, default: '' },
    email:       { type: String, default: '' },
    category:    { type: String, default: 'personal' },
    visibility:  { type: String, enum: ['public', 'contacts', 'private'], default: 'contacts' },
    mode:        { type: String, enum: ['personal', 'business'], default: 'personal' },
    likes:       { type: Number, default: 0 },
    views:       { type: Number, default: 0 },
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

const galleryViewSchema = new mongoose.Schema({
    viewerId:  { type: String, required: true },
    ownerId:   { type: String, required: true },
    viewedAt:  { type: Date, default: Date.now }
});
galleryViewSchema.index({ viewerId: 1, ownerId: 1 }, { unique: true });
const GalleryView = mongoose.model('GalleryView', galleryViewSchema);

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
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

async function createDirectories() {
    for (const dir of [uploadDir, profilePicsDir]) {
        if (!fs.existsSync(dir)) {
            await fsPromises.mkdir(dir, { recursive: true });
            console.log(`✅ Created: ${dir}`);
        }
    }
}

// Static files
app.use(express.static(BASE_DIR, { etag: false, lastModified: false, setHeaders: (res, path) => { if (path.endsWith('.js') || path.endsWith('.css')) { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); } } }));
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

        const [unread, missed, interaction, galleryView, latestGallery] = await Promise.all([
            Message.countDocuments({
                senderId: xameId, recipientId: userId,
                status: { $in: ['sent', 'delivered'] }
            }),
            CallHistory.countDocuments({
                callerId: xameId, recipientId: userId,
                status: { $in: ['pending', 'missed'] }
            }),
            getLastInteractionDetails(userId, xameId),
            GalleryView.findOne({ viewerId: userId, ownerId: xameId }),
            GalleryItem.findOne({ userId: xameId }).sort({ createdAt: -1 }).select('createdAt')
        ]);

        const hasNewGallery = latestGallery
            ? (!galleryView || latestGallery.createdAt > galleryView.viewedAt)
            : false;

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
            personalStatus:         partner?.settings?.personalStatus || null,
            hasNewGallery
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

        if (user.suspended) {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

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

        // Extra Security OTP check
        if (user.extraSecurity?.enabled && (user.extraSecurity.email || user.extraSecurity.phone)) {
            const { otp } = req.body;
            if (!otp) {
                // First login attempt — generate and send OTP
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                user.otpCode    = code;
                user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
                await user.save();
                // Send OTP via email and/or SMS simultaneously
                const sendPromises = [];
                if (user.extraSecurity.email) {
                    sendPromises.push(resend.emails.send({
                        from: process.env.RESEND_FROM_EMAIL || 'XamePage Security <onboarding@resend.dev>',
                        to:   user.extraSecurity.email,
                        subject: 'Your XamePage Login Code',
                        html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px;background:#1a2332;color:#fff;border-radius:12px;">
                            <h2 style="color:#00B0A0;">XamePage Security Code</h2>
                            <p>Your one-time login code is:</p>
                            <h1 style="font-size:42px;letter-spacing:8px;color:#00B0A0;text-align:center;">${code}</h1>
                            <p style="color:#aaa;font-size:13px;">This code expires in 10 minutes. Do not share it with anyone.</p>
                        </div>`
                    }));
                }
                if (user.extraSecurity.phone && twilioClient) {
                    sendPromises.push(twilioClient.messages.create({
                        body: `Your XamePage login code is: ${code}. Expires in 10 minutes. Do not share.`,
                        from: process.env.TWILIO_PHONE_NUMBER,
                        to:   user.extraSecurity.phone
                    }));
                }
                await Promise.allSettled(sendPromises);
                const channels = [user.extraSecurity.email ? 'email' : '', user.extraSecurity.phone && twilioClient ? 'SMS' : ''].filter(Boolean).join(' and ');
                return res.json({ success: false, requiresOTP: true, message: `OTP sent via ${channels}.` });
            }
            // Verify OTP
            if (!user.otpCode || user.otpCode !== otp) {
                return res.status(401).json({ success: false, message: 'Invalid OTP code.' });
            }
            if (user.otpExpires < new Date()) {
                return res.status(401).json({ success: false, message: 'OTP has expired. Please try again.' });
            }
            // Clear OTP after successful verification
            user.otpCode    = null;
            user.otpExpires = null;
        }

        // Generate session token
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const deviceInfo = req.headers['user-agent'] || 'Unknown device';
        user.sessions = user.sessions || [];
        // Keep max 5 sessions
        if (user.sessions.length >= 5) user.sessions.shift();
        user.sessions.push({ token: sessionToken, deviceInfo, createdAt: new Date(), lastSeen: new Date() });
        await user.save();
        const resp = { ...user.toObject(), privacySettings: {
            hidePreferredName:  user.hidePreferredName,
            hideProfilePicture: user.hideProfilePicture
        }};
        delete resp.password;
        delete resp.sessions;
        res.json({ success: true, user: resp, sessionToken });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// Setup extra security
app.post('/api/extra-security/setup', async (req, res) => {
    const { userId, email, phone, enabled } = req.body;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false });
        user.extraSecurity = { enabled: enabled !== false, email: email || '', phone: phone || '' };
        await user.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Get extra security status
app.get('/api/extra-security/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false });
        res.json({ success: true, extraSecurity: user.extraSecurity || { enabled: false, email: '', phone: '' } });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Get all active sessions
app.get('/api/sessions/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false });
        const sessions = (user.sessions || []).map((s, i) => ({
            id: s._id,
            deviceInfo: s.deviceInfo,
            createdAt: s.createdAt,
            lastSeen: s.lastSeen,
            index: i
        }));
        res.json({ success: true, sessions });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Kill a specific session (remote logout)
app.post('/api/sessions/kill', async (req, res) => {
    const { userId, sessionId } = req.body;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false });
        user.sessions = (user.sessions || []).filter(s => s._id.toString() !== sessionId);
        await user.save();
        // Force logout the target socket
        const targetSocketId = findSocketId(userId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('force-logout', { reason: 'Session terminated remotely' });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Kill ALL other sessions (stolen device)
app.post('/api/sessions/kill-all', async (req, res) => {
    const { userId, keepToken } = req.body;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false });
        user.sessions = (user.sessions || []).filter(s => s.token === keepToken || s._id.toString() === keepToken);
        await user.save();
        // Force logout all sockets for this user
        const targetSocketId = findSocketId(userId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('force-logout', { reason: 'All sessions terminated. Please log in again.' });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
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

// ── FCM Token ────────────────────────────────────────────────────────────────
app.post('/api/save-fcm-token', async (req, res) => {
    const { userId, fcmToken } = req.body;
    if (!userId || !fcmToken) return res.status(400).json({ success: false });
    try {
        await User.updateOne({ xameId: userId }, { fcmToken });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
});

async function sendCallNotification(recipientId, callerName, callType) {
    try {
        const user = await User.findOne({ xameId: recipientId });
        if (!user || !user.fcmToken) return;
        if (!admin.apps.length) return;
        await admin.messaging().send({
            token: user.fcmToken,
            android: {
                priority: 'high'
            },
            data: {
                type: 'incoming_call',
                callerId: recipientId,
                callerName,
                callType
            }
        });
        console.log('FCM call notification sent to:', recipientId);
    } catch(e) { console.warn('FCM notification failed:', e.message); }
}

app.get('/api/check-fcm-token/:userId', async (req, res) => {
    try {
        const user = await User.findOne({ xameId: req.params.userId });
        if (!user) return res.json({ found: false });
        res.json({ found: true, hasToken: !!user.fcmToken, tokenLength: user.fcmToken?.length, tokenPreview: user.fcmToken?.substring(0, 20) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/test-fcm', async (req, res) => {
    const { userId } = req.body;
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.json({ success: false, reason: 'user not found' });
        if (!user.fcmToken) return res.json({ success: false, reason: 'no fcm token', tokenValue: user.fcmToken });
        const result = await admin.messaging().send({
            token: user.fcmToken,
            android: { priority: 'high' },
            data: { type: 'incoming_call', callerId: userId, callerName: 'Test Caller', callType: 'voice' }
        });
        res.json({ success: true, messageId: result, fcmToken: user.fcmToken.substring(0, 20) + '...' });
    } catch(e) { res.status(500).json({ success: false, error: e.message, code: e.code }); }
});

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
        res.json({ success: true, user: {
            xameId:             user.xameId,
            firstName:          user.firstName,
            lastName:           user.lastName,
            preferredName:      user.preferredName,
            profilePic:         user.profilePic,
            dob:                user.dob,
            phone:              user.phone,
            email:              user.email,
            contacts:           user.contacts,
            sessions:           user.sessions,
            extraSecurity:      user.extraSecurity,
            fcmToken:           user.fcmToken,
            hideProfilePicture: user.hideProfilePicture,
            hidePreferredName:  user.hidePreferredName,
            createdAt:          user.createdAt,
            suspended:          user.suspended || false,
            isOnline:           onlineUsers.has(user.xameId),
        }});
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

async function uploadToSupabase(buffer, fileName) {
    const safeName = Date.now() + '_' + fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const { data, error } = await supabase.storage
        .from('xamepage-files')
        .upload(safeName, buffer, { upsert: true, contentType: 'application/octet-stream' });
    if (error) throw new Error('Supabase upload failed: ' + error.message);
    const { data: urlData } = supabase.storage.from('xamepage-files').getPublicUrl(safeName);
    return urlData.publicUrl;
}

app.post('/api/upload-file', memoryUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    try {
        const cloudinaryOk = process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
        if (cloudinaryOk) {
            const isVideo = req.file.mimetype.startsWith('video');
            const isAudio = req.file.mimetype.startsWith('audio');
            const isImage = req.file.mimetype.startsWith('image');
            if (isVideo || isAudio || isImage) {
                const resourceType = isVideo ? 'video' : isAudio ? 'video' : 'image';
                const url = await new Promise((resolve, reject) => {
                    const stream = cloudinary.uploader.upload_stream(
                        { folder: 'xamepage_chat', resource_type: resourceType },
                        (err, result) => { if (err) { console.error("Cloudinary upload error:", JSON.stringify(err)); reject(err); } else resolve(result.secure_url); }
                    );
                    stream.end(req.file.buffer);
                });
                res.json({ success: true, url });
            } else {
                // Upload non-media files to Supabase
                try {
                    const url = await uploadToSupabase(req.file.buffer, req.file.originalname);
                    res.json({ success: true, url });
                } catch(supaErr) {
                    console.error('Supabase upload error:', supaErr.message);
                    res.status(500).json({ success: false, message: supaErr.message });
                }
            }
        } else {
            const ext = path.extname(req.file.originalname);
            const newName = `${uuidv4()}${ext}`;
            const newPath = path.join(uploadDir, newName);
            await fsPromises.writeFile(newPath, req.file.buffer);
            res.json({ success: true, url: `/uploads/${newName}` });
        }
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
                profilePic:         user.hideProfilePicture ? '' : user.profilePic,
                preferredName:      user.hidePreferredName  ? userId : user.preferredName,
                hideProfilePicture: user.hideProfilePicture,
                hidePreferredName:  user.hidePreferredName
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

    socket.on('wallet:transfer', ({ recipientId, senderId, senderName, amount, currency }) => {
        const recipSocketId = findSocketId(recipientId);
        if (recipSocketId) {
            io.to(recipSocketId).emit('wallet:receive', { senderId, senderName, amount, currency });
        }
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
                }, 180000); // 3 minute grace period before marking offline
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
            }).sort({ ts: -1 }).limit(500).lean();
            messages.reverse();

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
                const result = await Message.deleteMany({ messageId: { $in: messageIds }, senderId: uid }); console.log("sync-deletions result:", JSON.stringify({ messageIds, uid, deletedCount: result.deletedCount }));
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

                // Notify caller that recipient's phone is ringing
                socket.emit('call-ringing', { recipientId, callId });

                // Push notification
                try {
                    const pushSub = await PushSubscription.findOne({ userId: recipientId });
                    if (pushSub) {
                        await webpush.sendNotification(pushSub.subscription, JSON.stringify({
                            type: 'incoming-call', callerId, callerName: incomingName, callType, callId
                        }));
                    }
                } catch (_) { /* non-fatal */ }

                // FCM notification for lock screen
                await sendCallNotification(recipientId, incomingName, callType);

            } catch (err) {
                console.error('call-user error:', err);
                socket.emit('call-error', { message: 'Failed to initiate call.' });
            }
        } else {
            try {
                await new CallHistory({ callId: uuidv4(), callerId, recipientId, callType, status: 'offline' }).save();
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
            const endTime = new Date();
            const callRecord = await CallHistory.findOne({
                $or: [
                    { callerId: uid, recipientId, status: { $in: ['accepted', 'pending'] } },
                    { callerId: recipientId, recipientId: uid, status: { $in: ['accepted', 'pending'] } }
                ]
            });
            if (callRecord) {
                const duration = Math.round((endTime - callRecord.startTime) / 1000);
                await callRecord.updateOne({ status: 'ended', endTime, duration });
            }
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

// ── Call Credits API ─────────────────────────────────────────────────────

app.get('/api/call-credits/:userId', async (req, res) => {
    try {
        let credits = await CallCredits.findOne({ xameId: req.params.userId });
        if (!credits) credits = await CallCredits.create({ xameId: req.params.userId });
        res.json({ success: true, balance: credits.balance, currency: credits.currency, transactions: credits.transactions.slice(-20).reverse() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/call-credits/topup', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        if (!userId || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid request' });
        // Deduct from wallet
        const wallet = await Wallet.findOne({ xameId: userId });
        if (!wallet || wallet.balance < amount) return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
        wallet.balance -= amount;
        wallet.transactions.push({ id: require('uuid').v4(), label: 'Call Credits Top-up', icon: '📞', amount: -amount, type: 'debit', ref: 'call-credits', ts: new Date() });
        await wallet.save();
        // Credit call credits
        let credits = await CallCredits.findOne({ xameId: userId });
        if (!credits) credits = new CallCredits({ xameId: userId });
        credits.balance += amount;
        credits.transactions.push({ id: require('uuid').v4(), type: 'topup', amount, label: `Topped up ${amount} ${credits.currency}`, ref: 'wallet', ts: new Date() });
        await credits.save();
        res.json({ success: true, balance: credits.balance });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/call-credits/recharge', async (req, res) => {
    try {
        const { userId, token } = req.body;
        if (!userId || !token) return res.status(400).json({ success: false, message: 'Invalid request' });
        // Token format: XAME-XXXX-XXXX-XXXX (encode amount in token)
        // For now validate token format and extract amount
        const validToken = /^XAME-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(token);
        if (!validToken) return res.status(400).json({ success: false, message: 'Invalid recharge token' });
        // Decode amount from token (last 4 chars = amount in hundreds)
        const lastSegment = token.split('-')[3];
        const amount = parseInt(lastSegment, 36) * 100;
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid token value' });
        let credits = await CallCredits.findOne({ xameId: userId });
        if (!credits) credits = new CallCredits({ xameId: userId });
        credits.balance += amount;
        credits.transactions.push({ id: require('uuid').v4(), type: 'recharge', amount, label: `Recharge token: ${token}`, ref: token, ts: new Date() });
        await credits.save();
        res.json({ success: true, balance: credits.balance });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/call-credits/rates', (req, res) => {
    res.json({ success: true, rates: PSTN_RATES });
});

// ── Twilio Voice SDK Token ───────────────────────────────────────────────────
app.get('/api/pstn/token/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const AccessToken = require('twilio').jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;
        const apiKey    = process.env.TWILIO_API_KEY;
        const apiSecret = process.env.TWILIO_API_SECRET;
        const appSid    = process.env.TWILIO_APP_SID;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        if (!apiKey || !apiSecret || !appSid) {
            return res.status(503).json({ success: false, message: 'Voice SDK not configured' });
        }
        const token = new AccessToken(accountSid, apiKey, apiSecret, { identity: userId, ttl: 3600 });
        const voiceGrant = new VoiceGrant({ outgoingApplicationSid: appSid, incomingAllow: false });
        token.addGrant(voiceGrant);
        res.json({ success: true, token: token.toJwt() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PSTN Call API ─────────────────────────────────────────────────────────

app.post('/api/pstn/call', async (req, res) => {
    try {
        const { userId, to, countryCode } = req.body;
        if (!userId || !to) return res.status(400).json({ success: false, message: 'Missing parameters' });
        if (!twilioClient) return res.status(503).json({ success: false, message: 'PSTN not available' });
        // Check credits
        const credits = await CallCredits.findOne({ xameId: userId });
        const rate = (PSTN_RATES[countryCode] || PSTN_RATES['default']).rate;
        if (!credits || credits.balance < rate) return res.status(400).json({ success: false, message: 'Insufficient call credits' });
        // Initiate call via Twilio
        // Twilio Voice SDK handles the actual call from browser
        // This endpoint just validates credits and returns confirmation
        const twimlUrl = `${process.env.SERVER_URL || 'https://project-50s.onrender.com'}/api/pstn/twiml?to=${encodeURIComponent(to)}`;
        const call = await twilioClient.calls.create({
            url: twimlUrl,
            to: to,
            from: process.env.TWILIO_PHONE_NUMBER,
            statusCallback: `${process.env.SERVER_URL || 'https://project-50s.onrender.com'}/api/pstn/status`,
            statusCallbackMethod: 'POST',
        });
        // Deduct 1 minute upfront, refund unused later via webhook
        credits.balance -= rate;
        credits.transactions.push({ id: require('uuid').v4(), type: 'debit', amount: -rate, label: `PSTN call to ${to}`, ref: call.sid, ts: new Date() });
        await credits.save();
        // Log in call history
        await new CallHistory({ callId: call.sid, callerId: userId, recipientId: to, callType: 'voice', status: 'pending', type: 'pstn' }).save();
        res.json({ success: true, callSid: call.sid, deducted: rate });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/pstn/twiml', (req, res) => {
    const to = req.body?.To || req.query?.to || '';
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting your call via XamePage.</Say><Dial>${to}</Dial></Response>`);
});

app.get('/api/pstn/twiml', (req, res) => {
    const to = req.query?.to || '';
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting your call via XamePage.</Say><Dial>${to}</Dial></Response>`);
});

// ── PSTN SMS API ──────────────────────────────────────────────────────────

app.post('/api/pstn/sms', async (req, res) => {
    try {
        const { userId, to, message } = req.body;
        if (!userId || !to || !message) return res.status(400).json({ success: false, message: 'Missing parameters' });
        if (!twilioClient) return res.status(503).json({ success: false, message: 'SMS not available' });
        const credits = await CallCredits.findOne({ xameId: userId });
        const SMS_COST = 5; // 5 units per SMS
        if (!credits || credits.balance < SMS_COST) return res.status(400).json({ success: false, message: 'Insufficient call credits' });
        const msg = await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: to
        });
        credits.balance -= SMS_COST;
        credits.transactions.push({ id: require('uuid').v4(), type: 'debit', amount: -SMS_COST, label: `SMS to ${to}`, ref: msg.sid, ts: new Date() });
        await credits.save();
        res.json({ success: true, messageSid: msg.sid });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Check if phone numbers are on XamePage ────────────────────────────────

app.post('/api/phone/check-xamepage', async (req, res) => {
    try {
        const { phones } = req.body; // array of phone numbers
        if (!phones || !Array.isArray(phones)) return res.status(400).json({ success: false });
        const users = await User.find({ xameId: { $in: phones } }, { xameId: 1, preferredName: 1, firstName: 1, profilePic: 1 });
        const map = {};
        users.forEach(u => { map[u.xameId] = { name: u.preferredName || u.firstName, profilePic: u.profilePic }; });
        res.json({ success: true, registered: map });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// -- Gallery API --
app.post('/api/gallery/upload', memoryUpload.single('file'), async (req, res) => {
    try {
        const { userId, caption, description, price, phone, email, visibility, mode } = req.body;
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
        const item = await GalleryItem.create({ userId, url, type: fileType, caption: caption || '', description: description || '', price: price || '', phone: phone || '', email: email || '', visibility: visibility || 'contacts', mode: mode || 'personal' });
        res.json({ success: true, item });
    } catch (err) {
        console.error('Gallery upload error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/gallery/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { viewerId } = req.query;
        const items = await GalleryItem.find({ userId }).sort({ createdAt: -1 });
        let hasNewGallery = false;
        if (viewerId && viewerId !== userId && items.length > 0) {
            const latest = items[0].createdAt;
            const view = await GalleryView.findOne({ viewerId, ownerId: userId });
            hasNewGallery = !view || latest > view.viewedAt;
        }
        res.json({ success: true, items, hasNewGallery });
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



app.post('/api/gallery/:userId/viewed', async (req, res) => {
    try {
        const { userId } = req.params;
        const { viewerId } = req.body;
        if (!viewerId) return res.status(400).json({ success: false });
        await GalleryView.findOneAndUpdate(
            { viewerId, ownerId: userId },
            { viewedAt: new Date() },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ── Contact Management ────────────────────────────────────────────────────────

app.post('/api/rename-contact', async (req, res) => {
    try {
        const { userId, contactId, newName } = req.body;
        if (!userId || !contactId || !newName)
            return res.status(400).json({ success: false, message: 'Missing fields' });
        const contact = await User.findOne({ xameId: contactId });
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
        await User.updateOne(
            { xameId: userId, 'contacts.contactId': contact._id },
            { $set: { 'contacts.$.customName': newName } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/remove-contact', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        if (!userId || !contactId)
            return res.status(400).json({ success: false, message: 'Missing fields' });
        const contact = await User.findOne({ xameId: contactId });
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
        await User.updateOne(
            { xameId: userId },
            { $pull: { contacts: { contactId: contact._id } } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/block-contact', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        if (!userId || !contactId)
            return res.status(400).json({ success: false, message: 'Missing fields' });
        const contact = await User.findOne({ xameId: contactId });
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
        await User.updateOne(
            { xameId: userId },
            { 
                $pull: { contacts: { contactId: contact._id } },
                $addToSet: { blockedUsers: contactId }
            }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/clear-chat', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        if (!userId || !contactId)
            return res.status(400).json({ success: false, message: 'Missing fields' });
        await Message.deleteMany({
            $or: [
                { senderId: userId, recipientId: contactId },
                { senderId: contactId, recipientId: userId }
            ]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Wallet API Keys (stored per user in DB or env) ───────────────────────────

// Create Flutterwave virtual account
app.post('/api/wallet/flw/virtual-account', async (req, res) => {
  const { userId, email, name, currency } = req.body;
  const flwSecret = req.headers['x-flw-secret'];
  if (!flwSecret || !userId) return res.json({ success: false, message: 'Missing fields' });
  try {
    const response = await fetch('https://api.flutterwave.com/v3/virtual-account-numbers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email || userId + '@xamepage.app',
        is_permanent: true,
        bvn: '00000000000',
        tx_ref: 'xamepay-va-' + userId + '-' + Date.now(),
        amount: 0,
        currency: currency || 'NGN',
        narration: 'XamePay/' + userId
      })
    });
    const data = await response.json();
    if (data.status === 'success') {
      res.json({ success: true, account: data.data });
    } else {
      res.json({ success: false, message: data.message, data: data });
    }
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// Flutterwave webhook
app.post('/api/wallet/flw/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH || 'xamepay-flw-hash';
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== secretHash) return res.status(401).send('Unauthorized');
  const payload = JSON.parse(req.body);
  if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
    const narration = payload.data.narration || '';
    const userId = narration.split('/')[1]?.trim();
    const amount = payload.data.amount;
    const currency = payload.data.currency;
    if (userId && amount) {
      // Notify user via socket
      const recipSocketId = findSocketId(userId);
      if (recipSocketId) {
        io.to(recipSocketId).emit('wallet:receive', {
          senderId: 'bank',
          senderName: payload.data.payment_type === 'account' ? 'Bank Transfer' : 'Card Payment',
          amount,
          currency
        });
      }
      console.log(`✅ FLW webhook: credited ${amount} ${currency} to ${userId}`);
    }
  }
  res.sendStatus(200);
});

// Create Paystack dedicated virtual account
app.post('/api/wallet/psk/virtual-account', async (req, res) => {
  const { userId, email, name } = req.body;
  const pskSecret = req.headers['x-psk-secret'];
  if (!pskSecret || !userId) return res.json({ success: false, message: 'Missing fields' });
  try {
    // First create a Paystack customer
    const custRes = await fetch('https://api.paystack.co/customer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pskSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || userId + '@xamepage.app', first_name: name || userId, last_name: 'XamePay' })
    });
    const custData = await custRes.json();
    if (!custData.status) return res.json({ success: false, message: custData.message });
    const customerCode = custData.data.customer_code;
    // Then create dedicated virtual account
    const vaRes = await fetch('https://api.paystack.co/dedicated_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pskSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: customerCode, preferred_bank: 'test-bank' })
    });
    const vaData = await vaRes.json();
    if (vaData.status) {
      res.json({ success: true, account: vaData.data });
    } else {
      res.json({ success: false, message: vaData.message });
    }
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// Paystack webhook
app.post('/api/wallet/psk/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const pskSecret = process.env.PAYSTACK_SECRET_KEY || '';
  const hash = crypto.createHmac('sha512', pskSecret).update(req.body).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) return res.status(401).send('Unauthorized');
  const payload = JSON.parse(req.body);
  if (payload.event === 'charge.success' || payload.event === 'dedicatedaccount.assign.success') {
    const amount = payload.data.amount / 100;
    const currency = payload.data.currency;
    const customerEmail = payload.data.customer?.email || '';
    const userId = customerEmail.split('@')[0];
    if (userId && amount) {
      const recipSocketId = findSocketId(userId);
      if (recipSocketId) {
        io.to(recipSocketId).emit('wallet:receive', {
          senderId: 'bank',
          senderName: 'Bank Transfer',
          amount,
          currency
        });
      }
      console.log(`✅ PSK webhook: credited ${amount} ${currency} to ${userId}`);
    }
  }
  res.sendStatus(200);
});


// ── Reloadly VTU API ─────────────────────────────────────────────────────────

async function getReloadlyToken() {
  const clientId = process.env.RELOADLY_CLIENT_ID || '';
  const clientSecret = process.env.RELOADLY_CLIENT_SECRET || '';
  const mode = process.env.RELOADLY_MODE || 'sandbox';
  if (!clientId || !clientSecret) throw new Error('Reloadly not configured');
  const audience = mode === 'live' ? 'https://topups.reloadly.com' : 'https://topups-sandbox.reloadly.com';
  const res = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      audience
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Auth failed');
  return data.access_token;
}

// Get operators/networks for a country
app.get('/api/vtu/operators/:countryCode', async (req, res) => {
  try {
    const token = await getReloadlyToken();
    const r = await fetch(`https://topups.reloadly.com/operators/countries/${req.params.countryCode}?includeBundles=true`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/com.reloadly.topups-v1+json' }
    });
    const data = await r.json();
    res.json({ success: true, operators: Array.isArray(data) ? data : [] });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

// Buy airtime
app.post('/api/vtu/airtime', async (req, res) => {
  const { phone, countryCode, amount, operatorId, userId } = req.body;
  if (!phone || !amount || !userId) return res.json({ success: false, message: 'Missing fields' });
  try {
    const token = await getReloadlyToken();
    const r = await fetch('https://topups.reloadly.com/topups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/com.reloadly.topups-v1+json' },
      body: JSON.stringify({
        operatorId,
        amount,
        useLocalAmount: true,
        customIdentifier: 'xamepay-' + userId + '-' + Date.now(),
        recipientPhone: { countryCode, number: phone }
      })
    });
    const data = await r.json();
    if (data.transactionId) {
      res.json({ success: true, transactionId: data.transactionId, message: 'Airtime sent!' });
    } else {
      res.json({ success: false, message: data.message || 'Top-up failed' });
    }
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

// Get data bundles for operator
app.get('/api/vtu/bundles/:operatorId', async (req, res) => {
  try {
    const token = await getReloadlyToken();
    const r = await fetch(`https://topups.reloadly.com/operators/${req.params.operatorId}/bundles`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/com.reloadly.topups-v1+json' }
    });
    const data = await r.json();
    res.json({ success: true, bundles: data });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

// Buy data bundle
app.post('/api/vtu/data', async (req, res) => {
  const { phone, countryCode, operatorId, bundleId, amount, userId } = req.body;
  if (!phone || !operatorId || !userId) return res.json({ success: false, message: 'Missing fields' });
  try {
    const token = await getReloadlyToken();
    const r = await fetch('https://topups.reloadly.com/topups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/com.reloadly.topups-v1+json' },
      body: JSON.stringify({
        operatorId,
        amount,
        useLocalAmount: true,
        customIdentifier: 'xamepay-data-' + userId + '-' + Date.now(),
        recipientPhone: { countryCode, number: phone }
      })
    });
    const data = await r.json();
    if (data.transactionId) {
      res.json({ success: true, transactionId: data.transactionId, message: 'Data bundle sent!' });
    } else {
      res.json({ success: false, message: data.message || 'Data purchase failed' });
    }
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});



// Get bank list from Flutterwave
app.get('/api/wallet/banks', async (req, res) => {
  const { currency } = req.query;
  const flwSecret = req.headers['x-flw-secret'];
  const pskSecret = req.headers['x-psk-secret'];
  try {
    if (flwSecret) {
      const r = await fetch(`https://api.flutterwave.com/v3/banks/${currency||'NG'}`, {
        headers: { Authorization: `Bearer ${flwSecret}` }
      });
      const data = await r.json();
      if (data.status === 'success') {
        return res.json({ success: true, banks: data.data.map(b => ({ name: b.name, code: b.code })) });
      }
    }
    if (pskSecret) {
      const r = await fetch(`https://api.paystack.co/bank?currency=${currency||'NGN'}&perPage=100`, {
        headers: { Authorization: `Bearer ${pskSecret}` }
      });
      const data = await r.json();
      if (data.status) {
        return res.json({ success: true, banks: data.data.map(b => ({ name: b.name, code: b.code })) });
      }
    }
    res.json({ success: false, message: 'No API keys configured' });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

// Resolve bank account name
app.post('/api/wallet/resolve-account', async (req, res) => {
  const { account_number, account_bank, currency } = req.body;
  const flwSecret = req.headers['x-flw-secret'];
  const pskSecret = req.headers['x-psk-secret'];
  if (!account_number || !account_bank) return res.json({ success: false, message: 'Missing fields' });
  try {
    console.log('Resolve request:', { account_number, account_bank, currency, hasFlw: !!flwSecret, hasPsk: !!pskSecret, flwKeyLen: (flwSecret||'').length });
    if (flwSecret) {
      const r = await fetch(`https://api.flutterwave.com/v3/accounts/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number, account_bank })
      });
      const data = await r.json();
      console.log('FLW resolve response:', JSON.stringify(data));
      if (data.status === 'success') {
        return res.json({ success: true, account_name: data.data.account_name });
      }
    }
    if (pskSecret) {
      const r = await fetch(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${account_bank}`, {
        headers: { Authorization: `Bearer ${pskSecret}` }
      });
      const data = await r.json();
      if (data.status) {
        return res.json({ success: true, account_name: data.data.account_name });
      }
    }
    res.json({ success: false, message: 'Could not resolve account' });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});



// ── XamePay Bills Payment (Flutterwave) ──────────────────────────────────────

// GET bill categories by type
app.get('/api/wallet/bills/categories', async (req, res) => {
    const { type, country } = req.query;
    try {
        const r = await fetch('https://api.flutterwave.com/v3/bill-categories', {
            headers: { Authorization: `Bearer ${FLW_SECRET}` }
        });
        const data = await r.json();
        if (data.status !== 'success') return res.json({ success: false, message: data.message });
        let bills = data.data;
        if (country) bills = bills.filter(b => b.country === country.toUpperCase());
        if (type) {
            const typeMap = {
                electricity: ['ELECTRICITY', 'DISCO', 'ELECTRIC', 'KPLC', 'BEDC'],
                tv: ['DSTV', 'GOTV', 'STARTIMES', 'MULTICHOICE'],
                internet: ['SMILE', 'SPECTRANET', 'SWIFT', 'IPNX', 'MTN HYNET'],
                airtime: ['AIRTEL NIGERIA', 'MTN VTU', '9MOBILE NIGERIA', 'GLO NIGERIA'],
                data: ['DATA BUNDLE'],
                water: ['WATER', 'WATERBOARD', 'WASA', 'GWCL', 'NWSC', 'LWSC'],
                gas: ['GAS', 'LPG', 'NNPC', 'TOTAL GAS', 'AGAS'],
            };
            const keywords = typeMap[type] || [];
            bills = bills.filter(b => keywords.some(k => b.name.toUpperCase().includes(k)));
        }
        // Group by biller name
        const grouped = {};
        bills.forEach(b => {
            if (!grouped[b.name]) grouped[b.name] = { name: b.name, biller_code: b.biller_code, country: b.country, items: [] };
            grouped[b.name].items.push({ item_code: b.item_code, label: b.biller_name || b.short_name, amount: b.amount, fee: b.fee, label_name: b.label_name });
        });
        res.json({ success: true, categories: Object.values(grouped) });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Validate bill customer (e.g. meter number, smartcard number)
app.post('/api/wallet/bills/validate', async (req, res) => {
    const { item_code, biller_code, customer } = req.body;
    if (!item_code || !biller_code || !customer) return res.json({ success: false, message: 'Missing fields' });
    try {
        const r = await fetch(`https://api.flutterwave.com/v3/bill-items/${item_code}/validate?code=${biller_code}&customer=${customer}`, {
            headers: { Authorization: `Bearer ${FLW_SECRET}` }
        });
        const data = await r.json();
        if (data.status === 'success') return res.json({ success: true, name: data.data.name, address: data.data.address, responseCode: data.data.responseCode });
        res.json({ success: false, message: data.message });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Pay bill
app.post('/api/wallet/bills/pay', async (req, res) => {
    const { userId, biller_code, item_code, customer, amount, country } = req.body;
    if (!userId || !biller_code || !item_code || !customer) return res.json({ success: false, message: 'Missing fields' });
    try {
        // Debit wallet first
        const wallet = await getWallet(userId);
        const fee = Math.round((amount || 0) * SERVICE_FEE * 100) / 100;
        const totalDebit = (parseFloat(amount) || 0) + fee;
        if (wallet.balance < totalDebit) return res.json({ success: false, message: 'Insufficient balance' });
        await debitWallet(userId, totalDebit, 'Bill Payment', '🧾', 'bill-'+Date.now());
        // Pay via Flutterwave
        const r = await fetch('https://api.flutterwave.com/v3/bills', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                country: country || 'NG',
                customer,
                amount: parseFloat(amount),
                recurrence: 'ONCE',
                type: biller_code,
                reference: 'xamepay-bill-' + Date.now(),
                biller_name: item_code
            })
        });
        const data = await r.json();
        if (data.status === 'success') {
            // Update transaction label with biller info
            const w = await getWallet(userId);
            if (w.transactions[0]) w.transactions[0].label = 'Bill - ' + (data.data?.biller_name || biller_code);
            await w.save();
            return res.json({ success: true, fee, reference: data.data?.reference, message: 'Bill paid successfully' });
        }
        // Refund on failure
        await creditWallet(userId, totalDebit, 'Refund - Failed bill payment', '↩️', 'refund-'+Date.now());
        res.json({ success: false, message: data.message || 'Bill payment failed' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// ── XamePay Server-Side Wallet API (keys from .env, balances in MongoDB) ─────

const FLW_SECRET = process.env.FLW_SECRET_KEY || '';
const FLW_PUBLIC = process.env.FLW_PUBLIC_KEY || '';
const PSK_SECRET = process.env.PSK_SECRET_KEY || '';
const PSK_PUBLIC = process.env.PSK_PUBLIC_KEY || '';
const SERVICE_FEE = parseFloat(process.env.WALLET_SERVICE_FEE || '0.01');

// Helper: get or create wallet for user
async function getWallet(xameId) {
    let wallet = await Wallet.findOne({ xameId });
    if (!wallet) wallet = await Wallet.create({ xameId });
    return wallet;
}

// Helper: add transaction and update balance
async function creditWallet(xameId, amount, label, icon, ref) {
    const wallet = await getWallet(xameId);
    wallet.balance = Math.round((wallet.balance + amount) * 100) / 100;
    wallet.transactions.unshift({ id: Date.now().toString(), label, icon: icon||'💳', amount, type: 'credit', status: 'Completed', ref: ref||'', ts: new Date() });
    if (wallet.transactions.length > 100) wallet.transactions = wallet.transactions.slice(0, 100);
    wallet.updatedAt = new Date();
    await wallet.save();
    return wallet;
}

async function debitWallet(xameId, amount, label, icon, ref) {
    const wallet = await getWallet(xameId);
    if (wallet.balance < amount) throw new Error('Insufficient balance');
    wallet.balance = Math.round((wallet.balance - amount) * 100) / 100;
    wallet.transactions.unshift({ id: Date.now().toString(), label, icon: icon||'💸', amount, type: 'debit', status: 'Completed', ref: ref||'', ts: new Date() });
    if (wallet.transactions.length > 100) wallet.transactions = wallet.transactions.slice(0, 100);
    wallet.updatedAt = new Date();
    await wallet.save();
    return wallet;
}

// GET public keys (safe to expose to client)
app.get('/api/wallet/pubkey', (req, res) => {
    res.json({
        flw: process.env.FLW_PUBLIC_KEY || '',
        psk: process.env.PSK_PUBLIC_KEY || '',
        provider: process.env.WALLET_DEFAULT_PROVIDER || 'flutterwave',
        currency: process.env.WALLET_DEFAULT_CURRENCY || 'NGN',
        configured: !!(process.env.FLW_SECRET_KEY || process.env.PSK_SECRET_KEY)
    });
});

// GET wallet balance and transactions
app.get('/api/wallet/me', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, message: 'Missing userId' });
    try {
        const wallet = await getWallet(userId);
        res.json({ success: true, balance: wallet.balance, currency: wallet.currency, transactions: wallet.transactions, virtualAccount: wallet.virtualAccount });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Update wallet currency
app.post('/api/wallet/currency', async (req, res) => {
    const { userId, currency } = req.body;
    if (!userId || !currency) return res.json({ success: false, message: 'Missing fields' });
    try {
        await Wallet.findOneAndUpdate({ xameId: userId }, { currency }, { upsert: true });
        res.json({ success: true });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Resolve bank account name (uses server .env keys)
app.post('/api/wallet/resolve', async (req, res) => {
    const { account_number, account_bank } = req.body;
    if (!account_number || !account_bank) return res.json({ success: false, message: 'Missing fields' });
    try {
        if (FLW_SECRET) {
            const r = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
                method: 'POST',
                headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_number, account_bank })
            });
            const data = await r.json();
            console.log('FLW resolve:', JSON.stringify(data));
            if (data.status === 'success') return res.json({ success: true, account_name: data.data.account_name });
            if (!PSK_SECRET) return res.json({ success: false, message: data.message || 'Could not resolve account' });
        }
        if (PSK_SECRET) {
            const r = await fetch(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${account_bank}`, {
                headers: { Authorization: `Bearer ${PSK_SECRET}` }
            });
            const data = await r.json();
            if (data.status) return res.json({ success: true, account_name: data.data.account_name });
        }
        res.json({ success: false, message: 'Could not resolve account' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Get bank list (uses server .env keys)
app.get('/api/wallet/banklist', async (req, res) => {
    const { cc } = req.query;
    try {
        if (FLW_SECRET) {
            const r = await fetch(`https://api.flutterwave.com/v3/banks/${cc||'NG'}`, {
                headers: { Authorization: `Bearer ${FLW_SECRET}` }
            });
            const data = await r.json();
            if (data.status === 'success') return res.json({ success: true, banks: data.data.map(b=>({ name: b.name, code: b.code })) });
        }
        if (PSK_SECRET) {
            const r = await fetch(`https://api.paystack.co/bank?perPage=100`, {
                headers: { Authorization: `Bearer ${PSK_SECRET}` }
            });
            const data = await r.json();
            if (data.status) return res.json({ success: true, banks: data.data.map(b=>({ name: b.name, code: b.code })) });
        }
        res.json({ success: false, message: 'No provider configured' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// P2P transfer between users
app.post('/api/wallet/p2p', async (req, res) => {
    const { senderId, recipientId, amount, currency } = req.body;
    if (!senderId || !recipientId || !amount) return res.json({ success: false, message: 'Missing fields' });
    try {
        const fee = Math.round(amount * SERVICE_FEE * 100) / 100;
        const totalDebit = amount + fee;
        await debitWallet(senderId, totalDebit, 'Sent to ' + recipientId, '💸', 'p2p-'+Date.now());
        await creditWallet(recipientId, amount, 'Received from ' + senderId, '💸', 'p2p-'+Date.now());
        // Notify recipient via socket
        const recipSocketId = findSocketId(recipientId);
        if (recipSocketId) {
            io.to(recipSocketId).emit('wallet:receive', { senderId, senderName: senderId, amount, currency });
        }
        res.json({ success: true, fee, message: 'Transfer successful' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Send to bank account
app.post('/api/wallet/send-bank', async (req, res) => {
    const { userId, account_bank, account_number, amount, currency, narration, accName } = req.body;
    if (!userId || !account_bank || !account_number || !amount) return res.json({ success: false, message: 'Missing fields' });
    try {
        const fee = Math.round(amount * SERVICE_FEE * 100) / 100;
        const totalDebit = amount + fee;
        // Debit wallet first
        await debitWallet(userId, totalDebit, 'Transfer to ' + accName, '🏦', 'bank-'+Date.now());
        // Send via Flutterwave
        if (FLW_SECRET) {
            const r = await fetch('https://api.flutterwave.com/v3/transfers', {
                method: 'POST',
                headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_bank, account_number, amount, currency: currency||'NGN', narration: narration||'XamePay Transfer', reference: 'xamepay-'+Date.now() })
            });
            const data = await r.json();
            if (data.status === 'success') return res.json({ success: true, fee, message: 'Transfer successful' });
            // Refund on failure
            await creditWallet(userId, totalDebit, 'Refund - Failed transfer', '↩️', 'refund-'+Date.now());
            return res.json({ success: false, message: data.message });
        }
        res.json({ success: false, message: 'No payment provider configured' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Buy airtime via Reloadly (uses server keys if available)
app.post('/api/wallet/airtime', async (req, res) => {
    const { userId, phone, countryCode, operatorId, amount } = req.body;
    if (!userId || !phone || !amount) return res.json({ success: false, message: 'Missing fields' });
    try {
        await debitWallet(userId, amount, 'Airtime - ' + phone, '📱', 'airtime-'+Date.now());
        res.json({ success: true, message: 'Airtime purchased successfully' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Flutterwave payment verification & wallet credit
app.post('/api/wallet/fund/verify', async (req, res) => {
    const { transaction_id, expected_amount, currency, userId } = req.body;
    if (!transaction_id || !userId) return res.json({ success: false, message: 'Missing fields' });
    try {
        const r = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
            headers: { Authorization: `Bearer ${FLW_SECRET}` }
        });
        const data = await r.json();
        if (data.status === 'success' && data.data.status === 'successful' && data.data.amount >= expected_amount) {
            const wallet = await creditWallet(userId, data.data.amount, 'Wallet funded via Card', '💳', transaction_id);
            // Notify user
            const sockId = findSocketId(userId);
            if (sockId) io.to(sockId).emit('wallet:funded', { amount: data.data.amount, balance: wallet.balance });
            return res.json({ success: true, amount: data.data.amount, balance: wallet.balance });
        }
        res.json({ success: false, message: 'Payment verification failed' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Flutterwave webhook (server-side, uses FLW_SECRET_HASH from .env)
app.post('/api/wallet/webhook/flw', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['verif-hash'];
    if (signature !== (process.env.FLW_SECRET_HASH || 'xamepay-webhook-hash-2024')) return res.status(401).send('Unauthorized');
    try {
        const payload = JSON.parse(req.body);
        if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
            const userId = (payload.data.narration||'').split('/')[1]?.trim() || payload.data.meta?.userId;
            if (userId) {
                const wallet = await creditWallet(userId, payload.data.amount, 'Bank Transfer', '🏦', payload.data.id?.toString());
                const sockId = findSocketId(userId);
                if (sockId) io.to(sockId).emit('wallet:funded', { amount: payload.data.amount, balance: wallet.balance });
            }
        }
        res.sendStatus(200);
    } catch(err) { res.sendStatus(200); }
});

// ── XamePay Wallet API ───────────────────────────────────────────────────

// Verify Flutterwave payment and credit wallet
app.post('/api/wallet/verify', async (req, res) => {
  const { transaction_id, expected_amount, currency, userId } = req.body;
  if (!transaction_id || !userId) return res.json({ success: false, message: 'Missing fields' });

  try {
    const flwSecret = req.headers['x-flw-secret'];
    if (!flwSecret) return res.json({ success: false, message: 'Missing secret key' });

    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
      headers: { Authorization: `Bearer ${flwSecret}` }
    });
    const data = await response.json();

    if (data.status === 'success' && data.data.status === 'successful' &&
        data.data.amount >= expected_amount && data.data.currency === currency) {
      res.json({ success: true, amount: data.data.amount, currency: data.data.currency });
    } else {
      res.json({ success: false, message: 'Payment verification failed', data: data.data });
    }
  } catch (err) {
    console.error('Wallet verify error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

// Flutterwave bank transfer (send to bank)
app.post('/api/wallet/transfer', async (req, res) => {
  const { account_bank, account_number, amount, currency, narration, reference, userId } = req.body;
  if (!account_bank || !account_number || !amount || !userId) return res.json({ success: false, message: 'Missing fields' });

  try {
    const flwSecret = req.headers['x-flw-secret'];
    if (!flwSecret) return res.json({ success: false, message: 'Missing secret key' });

    const response = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_bank, account_number, amount, currency: currency || 'NGN', narration: narration || 'XamePay Transfer', reference: reference || Date.now().toString() })
    });
    const data = await response.json();
    if (data.status === 'success') {
      res.json({ success: true, data: data.data });
    } else {
      res.json({ success: false, message: data.message });
    }
  } catch (err) {
    console.error('Wallet transfer error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});


app.get('/api/ice-servers', async (req, res) => {
    try {
        if (!twilioClient) {
            return res.json({ iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]});
        }
        const token = await twilioClient.tokens.create({ ttl: 3600 });
        return res.json({ iceServers: token.iceServers });
    } catch (e) {
        console.error('ICE token error:', e);
        return res.status(500).json({ error: 'Failed to get ICE servers' });
    }
});


app.get('/api/chat/:userId/:contactId', async (req, res) => {
    try {
        const { userId, contactId } = req.params;
        const limit  = parseInt(req.query.limit)  || 50;
        const before = parseInt(req.query.before) || Date.now();
        const messages = await Message.find({
            $or: [
                { senderId: userId,    recipientId: contactId },
                { senderId: contactId, recipientId: userId    }
            ],
            ts: { $lt: before }
        }).sort({ ts: -1 }).limit(limit).lean();
        messages.reverse();
        const mapped = messages.map(msg => ({
            id:        msg.messageId,
            text:      msg.text,
            file:      msg.file      || null,
            type:      msg.senderId === userId ? 'sent' : 'received',
            ts:        msg.ts,
            status:    msg.status,
            replyTo:   msg.replyTo   || null,
            expiresAt: msg.expiresAt || null,
            reactions: msg.reactions  || {},
            forwarded: msg.forwarded  || false,
        }));
        res.json({ success: true, messages: mapped, hasMore: messages.length === limit });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});




// ============================================================
// DISCOVERY — Posts, Stories, People, Likes
// ============================================================

// ── Schemas ───────────────────────────────────────────────────────────────────


// ── APP VERSION SCHEMA ───────────────────────────────────────────────────────
const appVersionSchema = new mongoose.Schema({
    version:     { type: String, required: true },
    buildNumber: { type: Number, required: true },
    downloadUrl: { type: String, default: '' },
    forceUpdate: { type: Boolean, default: false },
    changelog:   { type: String, default: '' },
    updatedAt:   { type: Date, default: Date.now },
});
const AppVersion = mongoose.model('AppVersion', appVersionSchema);

// ── XAMEPAGE OFFICIAL ANNOUNCEMENTS ───────────────────────────────────────────
const xamePageAnnouncementSchema = new mongoose.Schema({
    announcementId: { type: String, required: true, unique: true },
    title:          { type: String, required: true },
    caption:        { type: String, default: '' },
    mediaUrl:       { type: String, required: true },
    mediaType:      { type: String, default: 'image' },
    actionUrl:      { type: String, default: '' },
    actionLabel:    { type: String, default: '' },
    version:        { type: String, default: '' },
    ts:             { type: Date, default: Date.now },
});
const XamePageAnnouncement = mongoose.model('XamePageAnnouncement', xamePageAnnouncementSchema);

const discoveryPostSchema = new mongoose.Schema({
    postId:       { type: String, required: true, unique: true },
    authorId:     { type: String, required: true, index: true },
    authorName:   { type: String, required: true },
    authorAvatar: { type: String, default: '' },
    title:        { type: String, required: true },
    caption:      { type: String, default: '' },
    mediaUrl:     { type: String, required: true },
    mediaType:    { type: String, enum: ['image','video'], default: 'image' },
    thumbnailUrl: { type: String, default: '' },
    region:       { type: String, default: 'Global' },
    category:     { type: String, default: 'General' },
    isLive:       { type: Boolean, default: false },
    viewCount:    { type: Number, default: 0 },
    likeCount:    { type: Number, default: 0 },
    likedBy:      [{ type: String }],
    commentCount: { type: Number, default: 0 },
    ts:           { type: Date, default: Date.now },
});
discoveryPostSchema.index({ region: 1, ts: -1 });
const DiscoveryPost = mongoose.model('DiscoveryPost', discoveryPostSchema);

const discoveryStorySchema = new mongoose.Schema({
    storyId:      { type: String, required: true, unique: true },
    authorId:     { type: String, required: true, index: true },
    authorName:   { type: String, required: true },
    authorAvatar: { type: String, default: '' },
    mediaUrl:     { type: String, required: true },
    mediaType:    { type: String, enum: ['image','video'], default: 'image' },
    seen:         [{ type: String }],
    expiresAt:    { type: Date, default: () => new Date(Date.now() + 24*60*60*1000) },
    ts:           { type: Date, default: Date.now },
});
const DiscoveryStory = mongoose.model('DiscoveryStory', discoveryStorySchema);

// ── GET /api/discover/feed ────────────────────────────────────────────────────
// Returns paginated discovery posts filtered by region
app.get('/api/discover/feed', async (req, res) => {
    try {
        const { region, limit = 20, page = 1 } = req.query;
        const query = {};
        if (region && region !== 'global' && region !== 'Global') {
            query.region = new RegExp(region, 'i');
        }
        const posts = await DiscoveryPost.find(query)
            .sort({ ts: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();
        const total = await DiscoveryPost.countDocuments(query);
        res.json({
            success: true,
            posts: posts.map(p => ({
                id:           p.postId,
                title:        p.title,
                caption:      p.caption,
                mediaUrl:     p.mediaUrl,
                mediaType:    p.mediaType,
                thumbnailUrl: p.thumbnailUrl,
                authorId:     p.authorId,
                authorName:   p.authorName,
                authorAvatar: p.authorAvatar,
                region:       p.region,
                category:     p.category,
                isLive:       p.isLive,
                viewCount:    p.viewCount,
                likeCount:    p.likeCount,
                commentCount: p.commentCount,
                ts:           p.ts,
            })),
            total,
            page:  parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
        });
    } catch (err) {
        console.error('Discovery feed error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── GET /api/discover/stories ─────────────────────────────────────────────────
// Returns active stories (not expired) from all users
app.get('/api/discover/stories', async (req, res) => {
    try {
        const { userId } = req.query;
        const stories = await DiscoveryStory.find({
            expiresAt: { $gt: new Date() }
        }).sort({ ts: -1 }).limit(50).lean();

        // Group by author
        const grouped = {};
        for (const s of stories) {
            if (!grouped[s.authorId]) {
                grouped[s.authorId] = {
                    authorId:     s.authorId,
                    authorName:   s.authorName,
                    authorAvatar: s.authorAvatar,
                    hasSeen:      userId ? s.seen.includes(userId) : false,
                    isOnline:     false,
                    stories:      [],
                };
            }
            grouped[s.authorId].stories.push({
                storyId:   s.storyId,
                mediaUrl:  s.mediaUrl,
                mediaType: s.mediaType,
                expiresAt: s.expiresAt,
                ts:        s.ts,
                seen:      userId ? s.seen.includes(userId) : false,
            });
        }
        res.json({ success: true, stories: Object.values(grouped) });
    } catch (err) {
        console.error('Stories error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── GET /api/discover/people ──────────────────────────────────────────────────
// Returns suggested people — users not already contacts
app.get('/api/discover/people', async (req, res) => {
    try {
        const { userId, limit = 20 } = req.query;
        if (!userId) return res.json({ success: false, message: 'userId required' });

        const me = await User.findOne({ xameId: userId }).lean();
        if (!me) return res.json({ success: false, message: 'User not found' });

        const myContactIds = (me.contacts || []).map(c => c.contactId?.toString());
        myContactIds.push(userId); // exclude self

        // Find users not in contacts
        const suggestions = await User.find({
            xameId: { $nin: myContactIds }
        }).limit(parseInt(limit)).lean();

        // Calculate mutual contacts
        const result = await Promise.all(suggestions.map(async (u) => {
            const theirContactIds = (u.contacts || []).map(c => c.contactId?.toString());
            const mutualCount = myContactIds.filter(id =>
                theirContactIds.includes(id)).length;
            return {
                id:           u.xameId,
                name:         u.preferredName ||
                              `${u.firstName} ${u.lastName}`.trim(),
                avatarUrl:    u.hideProfilePicture ? '' : (u.profilePic || ''),
                mutualCount,
                isOnline:     false,
                tagline:      '',
            };
        }));

        res.json({ success: true, people: result });
    } catch (err) {
        console.error('People discovery error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/post ───────────────────────────────────────────────────
// Create a new discovery post — upload media to Cloudinary
app.post('/api/discover/post', memoryUpload.single('media'), async (req, res) => {
    try {
        const { authorId, title, caption, region, category, mediaType } = req.body;
        if (!authorId || !title) {
            return res.json({ success: false, message: 'authorId and title required' });
        }

        const author = await User.findOne({ xameId: authorId }).lean();
        if (!author) return res.json({ success: false, message: 'User not found' });

        let mediaUrl     = '';
        let thumbnailUrl = '';

        if (req.file) {
            // Upload to Cloudinary
            const uploadResult = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder:        'xamepage/discovery',
                        resource_type: (mediaType === 'video') ? 'video' : 'image',
                        public_id:     `post_${authorId}_${Date.now()}`,
                    },
                    (err, result) => err ? reject(err) : resolve(result)
                );
                stream.end(req.file.buffer);
            });
            mediaUrl = uploadResult.secure_url;
            if (mediaType === 'video') {
                thumbnailUrl = uploadResult.secure_url.replace('/upload/', '/upload/so_0/');
            }
        } else if (req.body.mediaUrl) {
            mediaUrl = req.body.mediaUrl;
        }

        if (!mediaUrl) {
            return res.json({ success: false, message: 'Media required' });
        }

        const post = await DiscoveryPost.create({
            postId:       uuidv4(),
            authorId,
            authorName:   author.preferredName ||
                          `${author.firstName} ${author.lastName}`.trim(),
            authorAvatar: author.hideProfilePicture ? '' : (author.profilePic || ''),
            title,
            caption:      caption  || '',
            mediaUrl,
            thumbnailUrl,
            mediaType:    mediaType || 'image',
            region:       region   || 'Global',
            category:     category || 'General',
        });

        res.json({ success: true, post: { id: post.postId, mediaUrl, thumbnailUrl } });
    } catch (err) {
        console.error('Create post error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/story ──────────────────────────────────────────────────
// Create a new story (24hr expiry) — upload to Cloudinary
app.post('/api/discover/story', memoryUpload.single('media'), async (req, res) => {
    try {
        const { authorId, mediaType } = req.body;
        if (!authorId) return res.json({ success: false, message: 'authorId required' });

        const author = await User.findOne({ xameId: authorId }).lean();
        if (!author) return res.json({ success: false, message: 'User not found' });

        let mediaUrl = '';
        if (req.file) {
            const uploadResult = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder:        'xamepage/stories',
                        resource_type: (mediaType === 'video') ? 'video' : 'image',
                        public_id:     `story_${authorId}_${Date.now()}`,
                    },
                    (err, result) => err ? reject(err) : resolve(result)
                );
                stream.end(req.file.buffer);
            });
            mediaUrl = uploadResult.secure_url;
        } else if (req.body.mediaUrl) {
            mediaUrl = req.body.mediaUrl;
        }

        if (!mediaUrl) return res.json({ success: false, message: 'Media required' });

        const story = await DiscoveryStory.create({
            storyId:      uuidv4(),
            authorId,
            authorName:   author.preferredName ||
                          `${author.firstName} ${author.lastName}`.trim(),
            authorAvatar: author.hideProfilePicture ? '' : (author.profilePic || ''),
            mediaUrl,
            mediaType:    mediaType || 'image',
        });

        res.json({ success: true, storyId: story.storyId, mediaUrl });
    } catch (err) {
        console.error('Create story error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/like ───────────────────────────────────────────────────
// Toggle like on a discovery post
app.post('/api/discover/like', async (req, res) => {
    try {
        const { userId, postId } = req.body;
        if (!userId || !postId) {
            return res.json({ success: false, message: 'userId and postId required' });
        }
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.json({ success: false, message: 'Post not found' });

        const hasLiked = post.likedBy.includes(userId);
        if (hasLiked) {
            post.likedBy.pull(userId);
            post.likeCount = Math.max(0, post.likeCount - 1);
        } else {
            post.likedBy.push(userId);
            post.likeCount += 1;
        }
        await post.save();
        res.json({ success: true, liked: !hasLiked, likeCount: post.likeCount });
    } catch (err) {
        console.error('Like error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/view ───────────────────────────────────────────────────
// Increment view count on a post
app.post('/api/discover/view', async (req, res) => {
    try {
        const { postId } = req.body;
        if (!postId) return res.json({ success: false, message: 'postId required' });
        await DiscoveryPost.updateOne({ postId }, { $inc: { viewCount: 1 } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── GET /api/discover/story/:storyId/seen ─────────────────────────────────────
// Mark a story as seen by a user
app.post('/api/discover/story/seen', async (req, res) => {
    try {
        const { userId, storyId } = req.body;
        if (!userId || !storyId) {
            return res.json({ success: false, message: 'userId and storyId required' });
        }
        await DiscoveryStory.updateOne(
            { storyId },
            { $addToSet: { seen: userId } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── DELETE /api/discover/post/:postId ─────────────────────────────────────────
// Delete own post
app.delete('/api/discover/post/:postId', async (req, res) => {
    try {
        const { postId }  = req.params;
        const { userId }  = req.body;
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.json({ success: false, message: 'Post not found' });
        if (post.authorId !== userId) {
            return res.json({ success: false, message: 'Unauthorized' });
        }
        await DiscoveryPost.deleteOne({ postId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── GET APP VERSION ──────────────────────────────────────────────────────────
app.get('/api/app/version', async (req, res) => {
    try {
        const v = await AppVersion.findOne().sort({ updatedAt: -1 });
        if (!v) return res.json({
            success: true, version: '2.1.1', buildNumber: 478,
            downloadUrl: 'https://github.com/mcerimainterltd-ctrl/Project-50s-flutter/releases/latest',
            forceUpdate: false, changelog: 'Latest improvements and bug fixes.',
        });
        res.json({
            success:     true,
            version:     v.version,
            buildNumber: v.buildNumber,
            downloadUrl: v.downloadUrl,
            forceUpdate: v.forceUpdate,
            changelog:   v.changelog,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── GET XAMEPAGE ANNOUNCEMENTS ────────────────────────────────────────────────
app.get('/api/xamepage/announcements', async (req, res) => {
    try {
        const announcements = await XamePageAnnouncement.find()
            .sort({ ts: -1 })
            .limit(10);
        res.json({ success: true, announcements });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ── Admin Console (HTTP Basic Auth protected) ────────────────────────────────
const adminConsoleAuth = basicAuth({
    users: { [process.env.ADMIN_CONSOLE_USER || 'xamepage']: process.env.ADMIN_CONSOLE_PASS || 'admin' },
    challenge: true,
    realm: 'XamePage Admin',
});

app.get('/admin', adminConsoleAuth, (req, res) => {
    res.sendFile(path.join(BASE_DIR, 'admin', 'index.html'));
});

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API endpoint not found' });
    }
    res.sendFile(path.join(BASE_DIR, 'index.html'));
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 8080;

createDirectories().then(() => {

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────
function verifyAdminSecret(req, res) {
    const secret = req.body.secret;
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        res.status(403).json({ success: false, message: 'Unauthorized.' });
        return false;
    }
    return true;
}

app.post('/api/admin/reset-password', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { xameId, newPassword } = req.body;
    if (!xameId || !newPassword || newPassword.length < 8)
        return res.status(400).json({ success: false, message: 'xameId and newPassword (8+ chars) required.' });
    try {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash(newPassword, 10);
        const result = await User.updateOne({ xameId }, { password: hash });
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'User not found.' });
        res.json({ success: true, message: 'Password reset successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/delete-account', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { xameId } = req.body;
    if (!xameId) return res.status(400).json({ success: false, message: 'xameId required.' });
    try {
        const user = await User.findOne({ xameId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        await Promise.all([
            User.deleteOne({ xameId }),
            Message.deleteMany({ $or: [{ senderId: xameId }, { recipientId: xameId }] }),
        ]);
        res.json({ success: true, message: `Account ${xameId} permanently deleted.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/app/promote', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { version, buildNumber, downloadUrl, changelog, forceUpdate } = req.body;
    if (!version || !buildNumber || !downloadUrl)
        return res.status(400).json({ success: false, message: 'version, buildNumber and downloadUrl required.' });
    try {
        const users = await User.find({ fcmToken: { $ne: '' } }).select('fcmToken');
        let sent = 0, failed = 0;
        await Promise.all(users.map(async u => {
            try {
                await admin.messaging().send({
                    token: u.fcmToken,
                    android: { priority: 'high' },
                    notification: {
                        title: `XamePage v${version} is available`,
                        body: changelog || 'A new update is ready. Tap to download.',
                    },
                    data: {
                        type: 'app_update',
                        version,
                        buildNumber: String(buildNumber),
                        downloadUrl,
                        forceUpdate: forceUpdate ? 'true' : 'false',
                    }
                });
                sent++;
            } catch (e) { failed++; }
        }));
        res.json({ success: true, message: `Update notification sent to ${sent} users. ${failed} failed.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/xamepage/announce', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { title, caption, mediaUrl, mediaType, downloadUrl, actionLabel, version } = req.body;
    if (!title || !mediaUrl)
        return res.status(400).json({ success: false, message: 'title and mediaUrl required.' });
    try {
        const { v4: uuidv4 } = require('uuid');
        const post = await XamePageAnnouncement.create({
            announcementId: uuidv4(),
            title,
            caption:     caption     || '',
            mediaUrl,
            mediaType:   mediaType   || 'image',
            actionUrl:   downloadUrl || '',
            actionLabel: actionLabel || '',
            version:     version     || '',
        });
        const users = await User.find({ fcmToken: { $ne: '' } }).select('fcmToken');
        let sent = 0, failed = 0;
        await Promise.all(users.map(async u => {
            try {
                await admin.messaging().send({
                    token: u.fcmToken,
                    android: { priority: 'high' },
                    notification: {
                        title: `XamePage${version ? ' v' + version : ''}: ${title}`,
                        body: caption || 'New announcement from XamePage.',
                    },
                    data: {
                        type: 'announcement',
                        postId: post.announcementId,
                        title,
                        mediaUrl,
                        downloadUrl: downloadUrl || '',
                        version: version || '',
                    }
                });
                sent++;
            } catch (e) { failed++; }
        }));
        res.json({ success: true, message: `Announcement posted and pushed to ${sent} users. ${failed} failed.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/delete-discovery-post', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { postId } = req.body;
    if (!postId) return res.status(400).json({ success: false, message: 'postId required.' });
    try {
        await DiscoveryPost.deleteOne({ postId });
        res.json({ success: true, message: 'Post deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


app.post('/api/admin/suspend-account', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { xameId, suspend } = req.body;
    if (!xameId) return res.status(400).json({ success: false, message: 'xameId required.' });
    try {
        const result = await User.updateOne({ xameId }, { suspended: suspend !== false });
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'User not found.' });
        const action = suspend !== false ? 'suspended' : 'unsuspended';
        res.json({ success: true, message: `Account ${xameId} ${action}.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


app.post('/api/admin/set-version', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { version, buildNumber, downloadUrl, forceUpdate, changelog } = req.body;
    if (!version || !buildNumber)
        return res.status(400).json({ success: false, message: 'version and buildNumber required.' });
    try {
        await AppVersion.deleteMany({});
        await AppVersion.create({
            version, buildNumber: parseInt(buildNumber),
            downloadUrl: downloadUrl || 'https://github.com/mcerimainterltd-ctrl/Project-50s-flutter/releases/latest',
            forceUpdate: forceUpdate === true || forceUpdate === 'true',
            changelog:   changelog || 'Latest improvements and bug fixes.',
            updatedAt:   new Date(),
        });
        res.json({ success: true, message: `Version set to ${version} (build ${buildNumber}).` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


app.post('/api/admin/ai-assist', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { messages, userContext } = req.body;
    if (!messages || !Array.isArray(messages))
        return res.status(400).json({ success: false, message: 'messages required.' });
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                max_tokens: 1000,
                messages: [
                    {
                        role: 'system',
                        content: `You are a smart, concise admin assistant for XamePage — a modern social communication app. Help the administrator manage users, resolve issues, draft communications, and understand platform behavior.

${userContext || 'No user currently loaded.'}

Be direct and actionable. Keep responses under 150 words unless drafting a document. Reference available buttons: Reset Password, Kill Sessions, Suspend Account, Delete Account. You know all XamePage features: messaging, calls, Discovery, Stories, Pay, wallet, contacts, app lock, 2FA, FCM notifications.`
                    },
                    ...messages,
                ],
            }),
        });
        const data = await response.json();
        const reply = data.choices && data.choices[0] ? data.choices[0].message.content : 'No response received.';
        res.json({ success: true, reply });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


app.post('/api/admin/delete-announcement', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { announcementId } = req.body;
    if (!announcementId) return res.status(400).json({ success: false, message: 'announcementId required.' });
    try {
        const result = await XamePageAnnouncement.deleteOne({ announcementId });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Announcement not found.' });
        res.json({ success: true, message: 'Announcement deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── END ADMIN ENDPOINTS ───────────────────────────────────────────────────────

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
