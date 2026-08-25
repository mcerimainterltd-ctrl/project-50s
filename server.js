const claimRouter = require('./routes/claimRouter');
const viralObjectsRouter = require('./routes/viralObjectsRouter');
const spacesRouter = require('./routes/spacesRouter');
const SpaceMessage = require('./models/SpaceMessage');
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
const ImageKit   = require('imagekit');
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
    pingTimeout:     15000,
    pingInterval:    25000,
    upgradeTimeout:  30000,
    maxHttpBufferSize: 1e8
});

// Capture raw bytes for Monnify webhook signature verification BEFORE the
// global JSON parser below consumes the request stream.
app.use('/api/wallet/monnify/webhook', express.raw({ type: 'application/json' }));
app.use('/api/wallet/squad/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use('/api/v3/spaces', spacesRouter);
app.use('/api/v3/auth', claimRouter);
app.use('/api/v3/objects', viralObjectsRouter);
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

// ── ImageKit ──────────────────────────────────────────────────────────────────
const imagekit = new ImageKit({
    publicKey:   process.env.IMAGEKIT_PUBLIC_KEY   || '',
    privateKey:  process.env.IMAGEKIT_PRIVATE_KEY  || '',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || '',
});
if (!process.env.IMAGEKIT_PUBLIC_KEY) {
    console.warn('⚠️  ImageKit env vars missing — new media uploads will fail');
} else {
    console.log('✅ ImageKit configured:', process.env.IMAGEKIT_URL_ENDPOINT);
}

// ── ImageKit upload helper ─────────────────────────────────────────────────
async function uploadToImageKit(buffer, fileName, folder) {
    try {
        const result = await imagekit.upload({
            file:              buffer.toString('base64'),
            fileName:          fileName,
            folder:            `/xamepage/${folder}`,
            useUniqueFileName: true,
        });
        console.log('✅ ImageKit upload:', result.url);
        return result.url;
    } catch (err) {
        console.error('❌ ImageKit upload error:', err);
        throw err;
    }
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

function _unused_uploadToCloudinary_legacy(buffer, userId) {
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

async function deleteProfilePicFromImageKit(userId) {
    try {
        const files = await imagekit.listFiles({
            path:        '/xamepage/profile_pics/',
            searchQuery: `name:profile_${userId}_`,
            sort:        'DESC_CREATED',
            limit:       1
        });
        if (files && files.length > 0) {
            await imagekit.deleteFile(files[0].fileId);
            console.log('✅ ImageKit delete:', files[0].name);
        } else {
            console.log('ℹ️  No ImageKit profile pic found to delete for user', userId);
        }
    } catch (err) {
        console.error('❌ ImageKit delete error:', err);
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

// ── Payment Keys ──────────────────────────────────────────────────────────────
const FLW_SECRET = process.env.FLW_SECRET_KEY || '';
const FLW_PUBLIC = process.env.FLW_PUBLIC_KEY || '';
const PSK_SECRET = process.env.PSK_SECRET_KEY || '';
const PSK_PUBLIC = process.env.PSK_PUBLIC_KEY || '';
const SERVICE_FEE = parseFloat(process.env.WALLET_SERVICE_FEE || '0.02');
const PLATFORM_WALLET_ID = process.env.PLATFORM_WALLET_ID || '058776085099';
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
        accountNumber:    { type: String, default: '' },
        bankName:         { type: String, default: '' },
        accountName:      { type: String, default: '' },
        provider:         { type: String, default: '' },
        accountReference: { type: String, default: '' }, // Monnify reserved-account reference
    },
    transactions: [{
        id:        { type: String },
        label:     { type: String },
        icon:      { type: String },
        amount:    { type: Number },
        principal: { type: Number },   // amount before fee, when applicable
        fee:       { type: Number },   // fee charged, when applicable
        cashback:  { type: Number },   // XameCoins cashback earned, when applicable
        type:      { type: String, enum: ['credit','debit'] },
        status:    { type: String, default: 'Completed' },
        ref:       { type: String },
        flwRef:    { type: String, default: '' },
        source:    { type: String, default: '' }, // e.g. 'client_payment' for tagged business revenue
        ts:        { type: Date, default: Date.now },
        senderName:              { type: String, default: '' },
        senderBankName:          { type: String, default: '' },
        senderAccountNumber:     { type: String, default: '' },
        recipientName:           { type: String, default: '' },
        bankName:                { type: String, default: '' },
        accountNumber:           { type: String, default: '' },
        recipientBankName:       { type: String, default: '' },
        recipientAccountNumber:  { type: String, default: '' },
    }],
    transactionPin: { type: String, default: '' }, // bcrypt hashed
    pinEnabled:     { type: Boolean, default: false },
    pinAttempts:    { type: Number, default: 0 },
    pinLockedUntil: { type: Date,   default: null },
    beneficiaries: [{
        accountNumber: { type: String },
        bankCode:      { type: String },
        bankName:      { type: String },
        accountName:   { type: String },
        savedAt:       { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Wallet = mongoose.model('Wallet', walletSchema);

// ── Platform Revenue Ledger ── tracks our actual margin per transaction ──
const platformRevenueSchema = new mongoose.Schema({
    userId:    { type: String, required: true },
    txRef:     { type: String, required: true },
    type:      { type: String, required: true }, // e.g. 'bank_transfer_out'
    amount:    { type: Number, required: true }, // principal amount moved
    flwFee:    { type: Number, required: true }, // what Flutterwave actually charges us
    userFee:   { type: Number, required: true }, // what we charge the user
    ourMargin: { type: Number, required: true }, // userFee - flwFee
    currency:  { type: String, default: 'NGN' },
    ts:        { type: Date, default: Date.now },
});
const PlatformRevenue = mongoose.model('PlatformRevenue', platformRevenueSchema);

// ── Call Credits Schema ───────────────────────────────────────────────────
const rechargeTokenSchema = new mongoose.Schema({
    token:     { type: String, required: true, unique: true },
    amount:    { type: Number, required: true },
    currency:  { type: String, default: 'NGN' },
    usedBy:    { type: String, default: '' },
    usedAt:    { type: Date, default: null },
    batch:     { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
});
const RechargeToken = mongoose.model('RechargeToken', rechargeTokenSchema);

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
    bvn:                { type: String, default: '' }, // encrypted at rest, used for virtual account creation
    bvnPlain:           { type: String, default: '' }, // used only for Flutterwave VA creation
    dob:                { type: String, required: true },
    password:           { type: String },
    profilePic:         { type: String, default: '' },
    referralCode:       { type: String, default: '' },
    hidePreferredName:  { type: Boolean, default: false },
    hideProfilePicture: { type: Boolean, default: false },
    contacts:           [contactSchema],
    contactRequests:    [{
        fromId:   { type: String, required: true },
        fromName: { type: String, default: '' },
        fromPic:  { type: String, default: '' },
        sentAt:   { type: Date, default: Date.now },
        status:   { type: String, enum: ['pending','accepted','declined'], default: 'pending' }
    }],
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
        location:  { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
        lastSeen:  { type: Date, default: Date.now }
    }],
    createdAt:          { type: Date, default: Date.now },
    suspended:          { type: Boolean, default: false },
});

const messageSchema = new mongoose.Schema({
    messageId:   { type: String, required: true, unique: true },
    isBroadcast: { type: Boolean, default: false },
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
    reactions:  { type: Object, default: {} },     // { emoji: [userId, ...] }
    callType:   { type: String, default: null },      // 'audio' | 'video' | null
    callStatus: { type: String, default: null },      // 'ended' | 'no-answer' | 'missed'
    callDuration: { type: Number, default: null },    // seconds
    albumId:    { type: String, default: null },       // groups multi-image picks sent together
    albumIndex: { type: Number, default: null },       // position within the album (0-based)
    albumTotal: { type: Number, default: null },       // total images in this album
    actionButton: {                                     // optional tappable button (e.g. download links)
        label: { type: String, default: '' },
        url:   { type: String, default: '' },
    },
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
        enum: ['pending', 'accepted', 'rejected', 'ended', 'missed', 'offline', 'cancelled', 'no-answer']
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
// ── Cloudinary signed upload (duplicate for reliability) ─────────────────────
// ── Fix existing broken thumbnail URLs ───────────────────────────────────────
app.post('/api/admin/fix-thumbnails', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        const posts = await DiscoveryPost.find({ thumbnailUrl: /so_0,f_jpg/ }).lean();
        let fixed = 0;
        for (const post of posts) {
            const newThumb = post.thumbnailUrl.replace('so_0,f_jpg', 'so_0/f_jpg');
            await DiscoveryPost.updateOne({ _id: post._id }, { $set: { thumbnailUrl: newThumb } });
            fixed++;
        }
        res.json({ success: true, message: `Fixed ${fixed} thumbnails` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/cloudinary/sign', (req, res) => {
    try {
        const timestamp = Math.round(Date.now() / 1000);
        const folder    = req.query.folder || 'xamepage_chat';
        const params    = { timestamp, folder };
        const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
        res.json({ success: true, signature, timestamp, folder,
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key:    process.env.CLOUDINARY_API_KEY });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

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
const activeCalls          = new Set(); // tracks xameIds currently in a call
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
                status: { $in: ['pending', 'missed', 'no-answer', 'cancelled'] },
                seen: { $ne: true }
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
            isOnline:               onlineUsers.has(xameId) && !(partner?.settings?.stealthMode === true),
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

async function broadcastOnlineUsers() {
    const allOnline = Array.from(onlineUsers);
    if (allOnline.length === 0) { io.emit('online_users', []); return; }
    try {
        const stealthUsers = await User.find(
            { xameId: { $in: allOnline }, 'settings.stealthMode': true },
            'xameId'
        ).lean();
        const stealthSet = new Set(stealthUsers.map(u => u.xameId));
        const visible = allOnline.filter(id => !stealthSet.has(id));
        io.emit('online_users', visible);
    } catch (e) {
        // On DB error, broadcast all online users without stealth filtering
        console.warn('broadcastOnlineUsers DB error:', e.message);
        io.emit('online_users', allOnline);
    }
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

        const { firstName, lastName, dob, password, phone } = req.body;
        try {
            // If phone provided, verify it was OTP-verified
            if (phone) {
                global.verifiedPhones = global.verifiedPhones || {};
                const vp = global.verifiedPhones[phone];
                if (!vp || !vp.verified || new Date() > vp.expires) {
                    return res.status(400).json({ success: false, message: 'Phone number not verified. Please verify with OTP first.' });
                }
                // Check not already taken
                const taken = await User.findOne({ phone });
                if (taken) return res.status(400).json({ success: false, message: 'This phone number is already registered.' });
            }
            const xameId         = await generateUniqueXameId();
            const hashedPassword = await bcrypt.hash(password, 10);
            const referralCode   = xameId.replace('@', '').toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
            const userData       = { xameId, firstName, lastName, dob, password: hashedPassword, referralCode };
            if (phone) { userData.phone = phone; delete global.verifiedPhones[phone]; }
            const user           = await new User(userData).save();
            const resp           = user.toObject(); delete resp.password;
            console.log(`✅ Registered: ${xameId}`);

            // ── XamePage Team welcome contact + message ──────────────────
            try {
                const TEAM_ID = '058000000001';
                const team = await User.findOne({ xameId: TEAM_ID });
                if (team) {
                    user.contacts.push({ contactId: team._id });
                    await user.save();
                    const welcomeText = `Welcome to XamePage, ${firstName}! 🎉\n\nWe're thrilled to have you join our growing community. Explore Discovery, connect with friends, make calls, and earn XameCoins along the way.\n\nIf you ever need help, just reply here — our team is always glad to assist.\n\n— The XamePage Team`;
                    await new Message({
                        messageId:   'welcome-' + xameId + '-' + Date.now(),
                        senderId:    TEAM_ID,
                        recipientId: xameId,
                        ts:          Date.now(),
                        text:        welcomeText,
                    }).save();
                }
            } catch (welcomeErr) {
                console.error('Welcome message error:', welcomeErr.message);
            }

            res.json({ success: true, user: resp });
        } catch (err) {
            console.error('Register error:', err);
            res.status(500).json({ success: false, message: 'Server error during registration.' });
        }
    }
);

// ── 3.0: Send OTP for phone registration ─────────────────────────────────────
// ── 3.0: Contact matching — check which phone numbers are on XamePage ────────
app.post('/api/contacts/match', async (req, res) => {
    const { phones } = req.body;
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
        return res.status(400).json({ success: false, message: 'phones array required.' });
    }
    try {
        // Normalize all phones — strip spaces, dashes, ensure consistent format
        const normalize = (p) => p.replace(/[\s\-().]/g, '');
        const normalized = phones.map(normalize).filter(p => p.length >= 7);

        // Find all users whose phone matches any of the provided numbers
        const users = await User.find({
            phone: { $in: normalized }
        }).select('xameId firstName lastName profilePic phone').lean();

        // Build a map of phone → user for fast lookup
        const matched = {};
        for (const u of users) {
            if (u.phone) matched[normalize(u.phone)] = {
                xameId:     u.xameId,
                name:       `${u.firstName} ${u.lastName}`.trim(),
                profilePic: u.profilePic || '',
            };
        }

        res.json({ success: true, matched });
    } catch (err) {
        console.error('Contact match error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/auth/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number required.' });
    try {
        // Check if phone already registered
        const existing = await User.findOne({ phone });
        if (existing) return res.status(400).json({ success: false, message: 'This phone number is already registered.' });

        // Generate 6-digit OTP
        const code    = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store OTP temporarily (use a simple in-memory map keyed by phone)
        global.phoneOtps = global.phoneOtps || {};
        global.phoneOtps[phone] = { code, expires };

        // Send OTP via Twilio SMS
        if (twilioClient) {
            await twilioClient.messages.create({
                body: `Your XamePage verification code is: ${code}. Valid for 10 minutes.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to:   phone,
            });
            console.log(`✅ OTP sent to ${phone}`);
        } else {
            console.warn('⚠️ Twilio not configured — OTP:', code);
        }

        res.json({ success: true, message: 'OTP sent successfully.' });
    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ success: false, message: 'Failed to send OTP: ' + err.message });
    }
});

// ── 3.0: Verify OTP for phone registration ────────────────────────────────────
app.post('/api/auth/verify-otp', async (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP required.' });
    try {
        global.phoneOtps = global.phoneOtps || {};
        const record = global.phoneOtps[phone];
        if (!record) return res.status(400).json({ success: false, message: 'No OTP found for this number. Please request a new one.' });
        if (new Date() > record.expires) {
            delete global.phoneOtps[phone];
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
        }
        if (record.code !== otp.toString().trim()) {
            return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });
        }
        // OTP valid — mark phone as verified
        delete global.phoneOtps[phone];
        global.verifiedPhones = global.verifiedPhones || {};
        global.verifiedPhones[phone] = { verified: true, expires: new Date(Date.now() + 30 * 60 * 1000) };
        res.json({ success: true, message: 'Phone verified successfully.' });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

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
    const { xameId, password, phone } = req.body;
    if (!xameId && !phone) return res.status(400).json({ success: false, message: 'Xame-ID or phone number required.' });

    try {
        // Support login by phone number (3.0) or Xame-ID (existing)
        const user = phone
            ? await User.findOne({ phone })
            : await User.findOne({ xameId });
        if (!user) return res.status(404).json({ success: false, message: phone ? 'No account found for this phone number.' : 'User not found.' });

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
        // Resolve IP location
        let location = '';
        try {
          const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
          if (ip && ip !== '::1' && ip !== '127.0.0.1') {
            const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`);
            const geo    = await geoRes.json();
            if (geo.city) location = [geo.city, geo.regionName, geo.country].filter(Boolean).join(', ');
          }
        } catch (_) {}
        user.sessions = user.sessions || [];
        // Keep max 5 sessions
        if (user.sessions.length >= 5) user.sessions.shift();
        user.sessions.push({ token: sessionToken, deviceInfo, location, createdAt: new Date(), lastSeen: new Date() });
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
            location: s.location || '',
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
                priority: 'high',
                ttl: 30000, // 30 seconds — drop if not delivered (call already missed)
                notification: {
                    channelId: 'xamepage_headsup_v3',
                    priority: 'max',
                    visibility: 'public',
                    sound: 'default',
                },
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
    if (!xameId?.trim()) return res.status(400).json({ success: false, message: 'Search query required.' });
    const q = xameId.trim();
    try {
        // Try exact xameId first
        let user = await User.findOne({ xameId: q });
        if (user) {
            return res.json({ success: true, user: mapUser(user), users: null });
        }
        // Fall back to name search (first, last, preferred)
        const nameRegex = new RegExp(q, 'i');
        const users = await User.find({
            $or: [
                { firstName: nameRegex },
                { lastName: nameRegex },
                { preferredName: nameRegex },
            ]
        }).limit(20).lean();
        if (users.length === 1) return res.json({ success: true, user: mapUser(users[0]), users: null });
        if (users.length > 1) return res.json({ success: true, user: null, users: users.map(mapUser) });
        return res.status(404).json({ success: false, message: 'No user found.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

function mapUser(user) { return {
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
        };
}

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

// ── Contact Request System ───────────────────────────────────────────────────
app.post('/api/send-contact-request', async (req, res) => {
    const { userId, contactId } = req.body;
    if (!userId || !contactId) return res.status(400).json({ success: false, message: 'Missing fields.' });
    if (userId === contactId) return res.status(400).json({ success: false, message: 'Cannot send request to yourself.' });
    try {
        const [sender, recipient] = await Promise.all([
            User.findOne({ xameId: userId }),
            User.findOne({ xameId: contactId })
        ]);
        if (!sender || !recipient) return res.status(404).json({ success: false, message: 'User not found.' });
        if (sender.contacts.some(c => c.contactId?.toString() === recipient._id.toString()))
            return res.status(409).json({ success: false, message: 'Already in your contacts.' });
        if (!Array.isArray(recipient.contactRequests)) recipient.contactRequests = [];
        const now = Date.now();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const twentyFourHours = 24 * 60 * 60 * 1000;
        recipient.contactRequests = recipient.contactRequests.filter(r => now - new Date(r.sentAt).getTime() < sevenDays);
        const existing = recipient.contactRequests.find(r => r.fromId === userId && r.status === 'pending');
        if (existing) return res.status(409).json({ success: false, message: 'Request already sent.' });
        const recentDecline = recipient.contactRequests.find(r => r.fromId === userId && r.status === 'declined' && now - new Date(r.sentAt).getTime() < twentyFourHours);
        if (recentDecline) return res.status(429).json({ success: false, message: 'Please wait 24 hours before sending another request.' });
        recipient.contactRequests = recipient.contactRequests.filter(r => !(r.fromId === userId && r.status === 'declined'));
        const senderName = sender.preferredName || `${sender.firstName} ${sender.lastName}`;
        recipient.contactRequests.push({ fromId: userId, fromName: senderName, fromPic: sender.profilePic || '', sentAt: new Date(), status: 'pending' });
        await recipient.save();
        const recipientSocket = userToSocketMap.get(contactId);
        if (recipientSocket) {
            io.to(recipientSocket).emit('contact_request', { fromId: userId, fromName: senderName, fromPic: sender.profilePic || '', sentAt: new Date().toISOString() });
        }
        // FCM push for contact request
        if (recipient.fcmToken && admin.apps.length) {
            admin.messaging().send({
                token: recipient.fcmToken,
                android: { priority: 'high' },
                data: { type: 'contact_request', fromId: userId, fromName: senderName, fromPic: sender.profilePic || '' },
            }).catch(e => console.warn('FCM contact request failed:', e.message));
        }
        res.json({ success: true, message: 'Contact request sent.' });
    } catch (err) {
        console.error('send-contact-request error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.get('/api/contact-requests/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, message: 'Missing userId.' });
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        const now = Date.now();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const pending = (user.contactRequests || []).filter(r => r.status === 'pending' && now - new Date(r.sentAt).getTime() < sevenDays);
        res.json({ success: true, requests: pending });
    } catch (err) {
        console.error('contact-requests fetch error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/accept-contact-request', async (req, res) => {
    const { userId, fromId } = req.body;
    if (!userId || !fromId) return res.status(400).json({ success: false, message: 'Missing fields.' });
    try {
        const [acceptor, requester] = await Promise.all([
            User.findOne({ xameId: userId }),
            User.findOne({ xameId: fromId })
        ]);
        if (!acceptor || !requester) return res.status(404).json({ success: false, message: 'User not found.' });
        const reqIndex = (acceptor.contactRequests || []).findIndex(r => r.fromId === fromId && r.status === 'pending');
        if (reqIndex === -1) return res.status(404).json({ success: false, message: 'Request not found.' });
        acceptor.contactRequests[reqIndex].status = 'accepted';
        if (!acceptor.contacts.some(c => c.contactId?.toString() === requester._id.toString()))
            acceptor.contacts.push({ contactId: requester._id, addedAt: new Date() });
        if (!requester.contacts.some(c => c.contactId?.toString() === acceptor._id.toString()))
            requester.contacts.push({ contactId: acceptor._id, addedAt: new Date() });
        await Promise.all([acceptor.save(), requester.save()]);
        const requesterSocket = userToSocketMap.get(fromId);
        if (requesterSocket) {
            const acceptorName = acceptor.preferredName || `${acceptor.firstName} ${acceptor.lastName}`;
            io.to(requesterSocket).emit('contact_request_accepted', { byId: userId, byName: acceptorName, byPic: acceptor.profilePic || '' });
        }
        const f = getPrivacyFilteredContactData(requester);
        res.json({ success: true, message: 'Contact request accepted.', contact: { xameId: requester.xameId, name: requester.preferredName || `${requester.firstName} ${requester.lastName}`, profilePic: f.profilePic, isOnline: onlineUsers.has(fromId) }});
    } catch (err) {
        console.error('accept-contact-request error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/decline-contact-request', async (req, res) => {
    const { userId, fromId } = req.body;
    if (!userId || !fromId) return res.status(400).json({ success: false, message: 'Missing fields.' });
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        const reqIndex = (user.contactRequests || []).findIndex(r => r.fromId === fromId && r.status === 'pending');
        if (reqIndex === -1) return res.status(404).json({ success: false, message: 'Request not found.' });
        user.contactRequests[reqIndex].status = 'declined';
        await user.save();
        res.json({ success: true, message: 'Request declined.' });
    } catch (err) {
        console.error('decline-contact-request error:', err);
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
        const isVideo = req.file.mimetype.startsWith('video');
        const isAudio = req.file.mimetype.startsWith('audio');
        const isImage = req.file.mimetype.startsWith('image');
        const folder  = (isVideo || isAudio || isImage) ? 'chat' : 'chat_documents';
        const url = await uploadToImageKit(req.file.buffer, `chat_${Date.now()}_${req.file.originalname}`, folder);
        res.json({ success: true, url });
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
            await deleteProfilePicFromImageKit(userId);
            user.profilePic = '';
        } else if (req.file?.buffer) {
            user.profilePic = await uploadToImageKit(req.file.buffer, `profile_${userId}_${Date.now()}.jpg`, 'profile_pics');
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

    socket.on('wallet:transfer', async ({ recipientId, recipientName, senderId, senderName, amount, currency }) => {
        const recipSocketId = findSocketId(recipientId);
        if (recipSocketId) {
            io.to(recipSocketId).emit('wallet:receive', { senderId, senderName, amount, currency });
        }
        const senderSocketId = findSocketId(senderId);
        if (senderSocketId) {
            io.to(senderSocketId).emit('wallet:debit', { recipientId, recipientName: recipientName || recipientId, amount, currency });
        }
        // FCM push for wallet credit/debit
        try {
            const [recip, sender] = await Promise.all([
                User.findOne({ xameId: recipientId }).select('fcmToken'),
                User.findOne({ xameId: senderId }).select('fcmToken'),
            ]);
            if (recip?.fcmToken && admin.apps.length) {
                admin.messaging().send({
                    token: recip.fcmToken,
                    android: { priority: 'high' },
                    data: { type: 'wallet_credit', message: `${senderName} sent you ${currency} ${amount}` },
                }).catch(() => {});
            }
            if (sender?.fcmToken && admin.apps.length) {
                admin.messaging().send({
                    token: sender.fcmToken,
                    android: { priority: 'high' },
                    data: { type: 'wallet_debit', message: `You sent ${currency} ${amount} to ${recipientId}` },
                }).catch(() => {});
            }
        } catch (_) {}
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
                }, 3000); // 3 second grace period before marking offline
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
                    id:           msg.messageId,
                    text:         msg.text,
                    file:         msg.file,
                    type:         msg.callType ? 'call' : (msg.senderId === reqId ? 'sent' : 'received'),
                    direction:    msg.senderId === reqId ? 'sent' : 'received',
                    ts:           msg.ts,
                    status:       msg.status,
                    replyTo:      msg.replyTo      || null,
                    expiresAt:    msg.expiresAt    || null,
                    reactions:    msg.reactions    || {},
                    forwarded:    msg.forwarded    || false,
                    callType:     msg.callType     || null,
                    callStatus:   msg.callStatus   || null,
                    callDuration: msg.callDuration || null,
                    albumId:      msg.albumId      || null,
                    albumIndex:   msg.albumIndex   ?? null,
                    albumTotal:   msg.albumTotal   || null,
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
                ...(message.forwarded && { forwarded: message.forwarded }),
                ...(message.albumId    && { albumId:    message.albumId }),
                ...(message.albumIndex !== undefined && message.albumIndex !== null && { albumIndex: message.albumIndex }),
                ...(message.albumTotal && { albumTotal: message.albumTotal })
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

    socket.on('stealth-update', async ({ userId, enabled }) => {
        if (!userId) return;
        try {
            await User.updateOne({ xameId: userId }, { $set: { 'settings.stealthMode': enabled } });
            await broadcastOnlineUsers();
        } catch (e) { console.error('stealth-update error:', e); }
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
                // Reward: invite first call — credit referrer if caller was referred
                try {
                    const callerReward = await RewardAccount.findOne({ userId: callerId });
                    if (callerReward?.referredBy) {
                        const alreadyAwarded = await RewardTransaction.findOne({
                            userId: callerReward.referredBy, type: 'invite_first_call', referenceId: callerId });
                        if (!alreadyAwarded) {
                            await creditCoins(callerReward.referredBy, 100, 'invite_first_call',
                                'Referral made their first call', callerId);
                        }
                    }
                } catch (_) {}

                const fc           = getPrivacyFilteredContactData(caller.toObject());
                const saved        = recipient.contacts.find(c => c.contactId?.xameId === callerId);
                const incomingName = getContactDisplayName(callerId, fc, saved);

                // Check if recipient is already in an active call
                if (activeCalls.has(recipientId)) {
                    socket.emit('call-rejected', { senderId: recipientId, reason: 'busy' });
                    // Save busy call bubble for caller
                    try {
                        const { v4: uuidv4busy } = require('uuid');
                        const busyMsg = await new Message({
                            messageId:    uuidv4busy(),
                            senderId:     callerId,
                            recipientId,
                            ts:           Date.now(),
                            text:         '',
                            callType,
                            callStatus:   'busy',
                            callDuration: 0,
                            status:       'sent',
                        }).save();
                        const busyPayload = {
                            id: busyMsg.messageId, senderId: callerId, recipientId,
                            ts: busyMsg.ts, text: '', type: 'call',
                            callType, callStatus: 'busy', callDuration: 0, status: 'sent',
                        };
                        const callerSid  = findSocketId(callerId);
                        const recipSidB  = findSocketId(recipientId);
                        if (callerSid) io.to(callerSid).emit('new_message', { ...busyPayload, direction: 'sent' });
                        if (recipSidB)  io.to(recipSidB).emit('new_message', { ...busyPayload, direction: 'received' });
                    } catch (_) {}
                    return;
                }

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
                const offlineCallId = uuidv4();
                await new CallHistory({ callId: offlineCallId, callerId, recipientId, callType, status: 'offline' }).save();
                socket.emit('call-rejected', { senderId: recipientId, reason: 'offline' });
                // Save call bubble for caller
                const { v4: uuidv4msg } = require('uuid');
                const offlineMsg = await new Message({
                    messageId:    uuidv4msg(),
                    senderId:     callerId,
                    recipientId,
                    ts:           Date.now(),
                    text:         '',
                    callType,
                    callStatus:   'unavailable',
                    callDuration: 0,
                    status:       'sent',
                }).save();
                const offlinePayload = {
                    id: offlineMsg.messageId, senderId: callerId, recipientId,
                    ts: offlineMsg.ts, text: '', type: 'call',
                    callType, callStatus: 'unavailable', callDuration: 0, status: 'sent',
                };
                const callerSid  = findSocketId(callerId);
                const recipSidO  = findSocketId(recipientId);
                if (callerSid) io.to(callerSid).emit('new_message', { ...offlinePayload, direction: 'sent' });
                if (recipSidO)  io.to(recipSidO).emit('new_message', { ...offlinePayload, direction: 'received' });
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
        // Mark both parties as in an active call
        activeCalls.add(acceptorId);
        activeCalls.add(recipientId);
        try {
            const q = callId
                ? { callId }
                : { callerId: recipientId, recipientId: acceptorId, status: 'pending' };
            await CallHistory.findOneAndUpdate(q, { status: 'accepted', startTime: new Date() });
        } catch (err) { console.error('call-accepted history error:', err); }
    });

    socket.on('call-rejected', async ({ recipientId, reason, callId }) => {
        const rejectorId = socketToUserMap.get(socket.id);
        const sid        = findSocketId(recipientId);
        // Clear active call status for both parties
        activeCalls.delete(rejectorId);
        activeCalls.delete(recipientId);
        try {
            // 'cancelled' = caller hung up before answer; 'declined' = recipient rejected
            const isCancelled = reason === 'cancelled';
            const isNoAnswer  = reason === 'no-answer';
            const newStatus   = isCancelled ? 'cancelled' : 'rejected';
            // Skip DB update if no-answer — already handled by call-unanswered
            const q = callId
                ? { callId }
                : isCancelled
                    ? { callerId: rejectorId, recipientId, status: 'pending' }
                    : { callerId: recipientId, recipientId: rejectorId, status: 'pending' };
            const updated = isNoAnswer ? null : await CallHistory.findOneAndUpdate(q, { status: newStatus });
            if (sid && !isNoAnswer) io.to(sid).emit('call-rejected', { senderId: rejectorId, reason });
            if (updated) socket.emit('call-acknowledged', { senderId: recipientId, acknowledgedCallId: updated.callId });

            // Save call message for cancelled and declined
            if (!isNoAnswer) {
                const { v4: uuidv4rej } = require('uuid');
                const callStatus = isCancelled ? 'cancelled' : 'declined';
                const msgSenderId    = isCancelled ? rejectorId : recipientId;
                const msgRecipientId = isCancelled ? recipientId : rejectorId;
                const rejMsg = await new Message({
                    messageId:    uuidv4rej(),
                    senderId:     msgSenderId,
                    recipientId:  msgRecipientId,
                    ts:           Date.now(),
                    text:         '',
                    callType:     'voice',
                    callStatus,
                    callDuration: 0,
                    status:       'sent',
                }).save();
                const rejPayload = {
                    id: rejMsg.messageId, senderId: msgSenderId, recipientId: msgRecipientId,
                    ts: rejMsg.ts, text: '', type: 'call',
                    callType: 'voice', callStatus, callDuration: 0, status: 'sent',
                };
                const callerSid = findSocketId(msgSenderId);
                const recipSid2 = findSocketId(msgRecipientId);
                if (callerSid) io.to(callerSid).emit('new_message', { ...rejPayload, direction: 'sent' });
                if (recipSid2) io.to(recipSid2).emit('new_message', { ...rejPayload, direction: 'received' });
            }
        } catch (err) { console.error('call-rejected error:', err); }
    });

    socket.on('call-hold', ({ recipientId }) => {
        const uid = socketToUserMap.get(socket.id);
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('call-held', { senderId: uid });
    });

    socket.on('call-resume', ({ recipientId }) => {
        const uid = socketToUserMap.get(socket.id);
        const sid = findSocketId(recipientId);
        if (sid) io.to(sid).emit('call-resumed', { senderId: uid });
    });

    socket.on('call-unanswered', async ({ recipientId, callId }) => {
        const callerId = socketToUserMap.get(socket.id);
        try {
            await CallHistory.findOneAndUpdate(
                { callId, callerId, recipientId, status: { $in: ['pending', 'ended'] } },
                { status: 'no-answer', duration: 0 }
            );
            // Save no-answer call message
            const { v4: uuidv4na } = require('uuid');
            const callType2 = 'voice';
            const noAnsMsg = await new Message({
                messageId:    uuidv4na(),
                senderId:     callerId,
                recipientId,
                ts:           Date.now(),
                text:         '',
                callType:     callType2,
                callStatus:   'no-answer',
                callDuration: 0,
                status:       'sent',
            }).save();
            const noAnsMsgPayload = {
                id: noAnsMsg.messageId, senderId: callerId, recipientId,
                ts: noAnsMsg.ts, text: '', type: 'call',
                callType: callType2, callStatus: 'no-answer',
                callDuration: 0, status: 'sent',
            };
            const sid = findSocketId(recipientId);
            if (sid) {
                io.to(sid).emit('new_missed_call_count', { senderId: callerId });
                io.to(sid).emit('call-rejected', { senderId: callerId, reason: 'no-answer' });
                io.to(sid).emit('new_message', { ...noAnsMsgPayload, direction: 'received' });
            }
            const callerSid = findSocketId(callerId);
            if (callerSid) {
                io.to(callerSid).emit('call-unanswered-ack', { recipientId });
                io.to(callerSid).emit('new_message', { ...noAnsMsgPayload, direction: 'sent' });
            }
        } catch (err) { console.error('call-unanswered error:', err); }
    });

    socket.on('call-ended', async ({ recipientId, callId }) => {
        const uid = socketToUserMap.get(socket.id);
        try {
            const endTime = new Date();
            const callRecord = callId
                ? await CallHistory.findOne({ callId })
                : await CallHistory.findOne({
                    $or: [
                        { callerId: uid, recipientId, status: { $in: ['accepted', 'pending'] } },
                        { callerId: recipientId, recipientId: uid, status: { $in: ['accepted', 'pending'] } }
                    ]
                });
            let duration = 0;
            if (callRecord) {
                duration = Math.round((endTime - callRecord.startTime) / 1000);
                await callRecord.updateOne({ status: 'ended', endTime, duration });
            }
            // Save call message to chat
            const { v4: uuidv4 } = require('uuid');
            const callMsg = await new Message({
                messageId:    uuidv4(),
                senderId:     uid,
                recipientId,
                ts:           Date.now(),
                text:         '',
                callType:     callRecord?.callType || 'voice',
                callStatus:   'ended',
                callDuration: duration,
                status:       'sent',
            }).save();
            const msgPayload = {
                id: callMsg.messageId, senderId: uid, recipientId,
                ts: callMsg.ts, text: '', type: 'call',
                callType: callMsg.callType, callStatus: 'ended',
                callDuration: duration, status: 'sent',
            };
            const recipSid = findSocketId(recipientId);
            if (recipSid) {
                io.to(recipSid).emit('call-ended', { senderId: uid });
                io.to(recipSid).emit('new_message', { ...msgPayload, direction: 'received' });
            }
            const callerSid = findSocketId(uid);
            if (callerSid) {
                io.to(callerSid).emit('call-ended', { senderId: recipientId });
                io.to(callerSid).emit('new_message', { ...msgPayload, direction: 'sent' });
            }
        } catch (err) { console.error('call-ended error:', err); }
    });

    // ── XamePage Spaces — Real-time ──────────────────────────────────────────
    socket.on('space:join', ({ spaceSlug, userId }) => {
        socket.join(`space:${spaceSlug}`);
        socket.to(`space:${spaceSlug}`).emit('space:user_joined', { userId, spaceSlug });
    });

    socket.on('space:leave', ({ spaceSlug, userId }) => {
        socket.leave(`space:${spaceSlug}`);
        socket.to(`space:${spaceSlug}`).emit('space:user_left', { userId, spaceSlug });
    });

    socket.on('space:message', async ({ spaceSlug, message }) => {
        // Broadcast to all Space members
        io.to(`space:${spaceSlug}`).emit('space:message', { spaceSlug, message });
    });

    socket.on('space:typing', ({ spaceSlug, userId, name, isTyping }) => {
        socket.to(`space:${spaceSlug}`).emit('space:typing', { userId, name, isTyping });
    });

    socket.on('space:reaction', ({ spaceSlug, msgId, emoji, userId }) => {
        io.to(`space:${spaceSlug}`).emit('space:reaction', { msgId, emoji, userId });
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

// ── 30-day Referral Active Check (every 24 hours) ───────────────────────────
setInterval(async () => {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Find accounts referred at least 30 days ago that haven't been credited yet
    const accounts = await RewardAccount.find({
      referredBy: { $ne: '' },
      createdAt:  { $lte: thirtyDaysAgo },
    });
    for (const account of accounts) {
      const alreadyAwarded = await RewardTransaction.findOne({
        userId: account.referredBy, type: 'invite_active', referenceId: account.userId });
      if (!alreadyAwarded) {
        await creditCoins(account.referredBy, 200, 'invite_active',
          'Referral active for 30 days', account.userId);
        console.log(`✅ 30-day referral bonus credited to ${account.referredBy} for ${account.userId}`);
      }
    }
  } catch (err) { console.error('30-day referral sweep error:', err); }
}, 24 * 60 * 60 * 1000);

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

// ── Silent FCM keepalive — reconnects background sockets every 3 minutes ────
setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;
    if (!admin.apps.length) return;
    try {
        const users = await User.find({ fcmToken: { $exists: true, $ne: '' } }, 'xameId fcmToken').lean();
        if (!users.length) return;
        const chunks = [];
        for (let i = 0; i < users.length; i += 500) chunks.push(users.slice(i, i + 500));
        for (const chunk of chunks) {
            const tokens = chunk.map(u => u.fcmToken).filter(Boolean);
            if (!tokens.length) continue;
            await admin.messaging().sendEachForMulticast({
                tokens,
                data: { type: 'socket_keepalive', ts: String(Date.now()) },
                android: { priority: 'high' },
                apns: { headers: { 'apns-priority': '5', 'apns-push-type': 'background' }, payload: { aps: { 'content-available': 1 } } },
            }).catch(() => {});
        }
    } catch (_) {}
}, 180000); // every 3 minutes — balances background reconnect speed against push volume/battery cost

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
            avatarUrl = await uploadToImageKit(buffer, `media_${Date.now()}.jpg`, 'media');
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
            { recipientId: userId, status: { $in: ['pending', 'missed', 'no-answer', 'cancelled'] }, seen: { $ne: true } },
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
        const rt = await RechargeToken.findOne({ token: token.toUpperCase() });
        if (!rt) return res.status(400).json({ success: false, message: 'Invalid recharge token' });
        if (rt.usedBy) return res.status(400).json({ success: false, message: 'Token already used' });
        rt.usedBy = userId;
        rt.usedAt = new Date();
        await rt.save();
        let credits = await CallCredits.findOne({ xameId: userId });
        if (!credits) credits = new CallCredits({ xameId: userId });
        credits.balance += rt.amount;
        credits.transactions.push({ id: require('uuid').v4(), type: 'recharge', amount: rt.amount, label: `Recharge token: ${token}`, ref: token, ts: new Date() });
        await credits.save();
        res.json({ success: true, balance: credits.balance, amount: rt.amount });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Admin: Generate XameTel recharge tokens ──────────────────────────────────
// ── Wipe All Virtual Accounts (Admin) ────────────────────────────────────────
app.post('/api/admin/wipe-virtual-accounts', async (req, res) => {
    try {
        const { secret } = req.body;
        if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const result = await Wallet.updateMany({}, {
            $unset: {
                'virtualAccount.accountNumber':    '',
                'virtualAccount.bankName':         '',
                'virtualAccount.accountName':      '',
                'virtualAccount.accountReference': '',
                'virtualAccount.provider':         '',
                'virtualAccounts.monnify':         '',
                'virtualAccounts.flutterwave':     '',
                'virtualAccounts.squad':           '',
            }
        });
        res.json({ success: true, message: `Wiped virtual accounts for ${result.modifiedCount} users` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/xametel/generate-tokens', async (req, res) => {
    const { secret, amount, quantity, batch } = req.body;
    if (secret !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    if (!amount || !quantity || quantity < 1)
        return res.status(400).json({ success: false, message: 'Amount and quantity required' });
    try {
        const batchName = batch || `BATCH-${Date.now()}`;
        const tokens = [];
        for (let i = 0; i < Math.min(quantity, 1000); i++) {
            const rand = () => Math.floor(1000 + Math.random() * 9000).toString();
            const token = `XAME-${rand()}-${rand()}-${rand()}`;
            await RechargeToken.create({ token, amount, currency: 'NGN', batch: batchName });
            tokens.push(token);
        }
        res.json({ success: true, tokens, amount, quantity: tokens.length, batch: batchName });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Admin: List recharge tokens ───────────────────────────────────────────────
app.get('/api/admin/xametel/tokens', async (req, res) => {
    const { secret, status } = req.query;
    if (secret !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const filter = {};
        if (status === 'unused') filter.usedBy = '';
        if (status === 'redeemed') filter.usedBy = { $ne: '' };
        const tokens = await RechargeToken.find(filter).sort({ createdAt: -1 }).limit(500);
        res.json({ success: true, tokens });
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
        const twimlUrl = `${process.env.SERVER_URL || 'https://app.xamepage.com'}/api/pstn/twiml?to=${encodeURIComponent(to)}`;
        const call = await twilioClient.calls.create({
            url: twimlUrl,
            to: to,
            from: process.env.TWILIO_PHONE_NUMBER,
            statusCallback: `${process.env.SERVER_URL || 'https://app.xamepage.com'}/api/pstn/status`,
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
        if (true) { // ImageKit handles all media types
            url = await uploadToImageKit(req.file.buffer, `gallery_${userId}_${Date.now()}_${req.file.originalname}`, `gallery/${userId}`);
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
// ── Save BVN (encrypted) ─────────────────────────────────────────────────────
app.post('/api/wallet/save-bvn', async (req, res) => {
    const { userId, bvn } = req.body;
    if (!userId || !bvn) return res.json({ success: false, message: 'Missing fields' });
    if (!/^\d{11}$/.test(bvn)) return res.json({ success: false, message: 'BVN must be 11 digits' });
    try {
        const bcrypt = require('bcryptjs');
        const hashed = await bcrypt.hash(bvn, 10);
        await User.findOneAndUpdate({ xameId: userId }, { bvn: hashed });
        // Also store plain for Flutterwave use (needed for VA creation)
        await User.findOneAndUpdate({ xameId: userId }, { bvnPlain: bvn });
        res.json({ success: true, message: 'BVN saved successfully' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Monnify Auth Token Cache ──────────────────────────────────────────────────
let _monnifyToken = { token: '', expiresAt: 0 };
async function getMonnifyToken() {
    if (_monnifyToken.token && Date.now() < _monnifyToken.expiresAt) return _monnifyToken.token;
    const apiKey    = process.env.MONNIFY_API_KEY;
    const secretKey = process.env.MONNIFY_SECRET_KEY;
    const baseUrl   = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
    if (!apiKey || !secretKey) throw new Error('Monnify API_KEY/SECRET_KEY not configured');
    const basicAuth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const r = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}` }
    });
    const data = await r.json();
    if (!data.requestSuccessful || !data.responseBody?.accessToken) {
        throw new Error('Monnify auth failed: ' + (data.responseMessage || 'unknown error'));
    }
    _monnifyToken = {
        token: data.responseBody.accessToken,
        expiresAt: Date.now() + ((data.responseBody.expiresIn || 3600) - 120) * 1000, // refresh 2 min early
    };
    return _monnifyToken.token;
}

// Create Monnify virtual account
app.post('/api/wallet/monnify/virtual-account', async (req, res) => {
    const { userId, email, confirmSwitch, bvn } = req.body;
    if (!userId) return res.json({ success: false, message: 'Missing userId' });
    try {
        // Silently save BVN if provided, same as the Flutterwave route does
        if (bvn && bvn !== '00000000000' && bvn.length === 11) {
            try { await User.findOneAndUpdate({ xameId: userId }, { bvnPlain: bvn }); } catch(_) {}
        }
        const existingWallet = await Wallet.findOne({ xameId: userId });
        if (existingWallet?.virtualAccount?.provider === 'monnify' && existingWallet.virtualAccount.accountNumber) {
            return res.json({ success: true, account: {
                account_number: existingWallet.virtualAccount.accountNumber,
                bank_name:      existingWallet.virtualAccount.bankName,
                account_name:   existingWallet.virtualAccount.accountName,
            }});
        }
        // Never silently overwrite an existing different provider's account —
        // the user must explicitly confirm a switch (e.g. via wallet settings UI).
        if (existingWallet?.virtualAccount?.provider && existingWallet.virtualAccount.provider !== 'monnify' && existingWallet.virtualAccount.accountNumber && !confirmSwitch) {
            return res.json({ success: false, message: 'User already has a ' + existingWallet.virtualAccount.provider + ' virtual account. Pass confirmSwitch:true to replace it.', requiresConfirmation: true, currentProvider: existingWallet.virtualAccount.provider });
        }
        // If switching back to Monnify and account already exists in DB — return it directly
        if (confirmSwitch && existingWallet?.virtualAccount?.accountReference) {
            const mnfyRef = existingWallet.virtualAccount.accountReference;
            if (mnfyRef.startsWith('xamepay-mnfy-')) {
                await Wallet.findOneAndUpdate({ xameId: userId }, { 'virtualAccount.provider': 'monnify' });
                return res.json({ success: true, account: {
                    account_number: existingWallet.virtualAccount.accountNumber,
                    bank_name:      existingWallet.virtualAccount.bankName,
                    account_name:   existingWallet.virtualAccount.accountName,
                }});
            }
        }
        const baseUrl      = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
        const contractCode = process.env.MONNIFY_CONTRACT_CODE;
        if (!contractCode) return res.json({ success: false, message: 'MONNIFY_CONTRACT_CODE not configured' });
        const vaUser = await User.findOne({ xameId: userId }).lean();
        const formalAccountName = 'XamePay - ' + (vaUser ? `${vaUser.firstName} ${vaUser.lastName}`.trim() : userId);
        const token = await getMonnifyToken();
        const accountReference = 'xamepay-mnfy-' + userId + '-' + Date.now();
        // CBN mandates a valid BVN or NIN be linked to every reserved account in production.
        // Sandbox does not enforce this, but live mode will — same fallback pattern as Flutterwave.
        const finalBvn = bvn || vaUser?.bvnPlain || '00000000000';
        const response = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountReference,
                accountName:          formalAccountName,
                currencyCode:         'NGN',
                contractCode,
                customerEmail:        email || userId + '@xamepage.app',
                customerName:         formalAccountName,
                bvn:                  finalBvn,
                getAllAvailableBanks: true,
            })
        });
        const data = await response.json();
        if (data.requestSuccessful && data.responseBody?.accounts?.length) {
            const acct = data.responseBody.accounts[0];
            await User.findOneAndUpdate({ xameId: userId }, {
                'virtualAccount.accountNumber': acct.accountNumber,
                'virtualAccount.bankName':      acct.bankName,
                'virtualAccount.accountName':   formalAccountName,
            });
            await Wallet.findOneAndUpdate({ xameId: userId }, {
                'virtualAccount.accountNumber':    acct.accountNumber,
                'virtualAccount.bankName':         acct.bankName,
                'virtualAccount.accountName':      formalAccountName,
                'virtualAccount.provider':         'monnify',
                'virtualAccount.accountReference': accountReference,
            }, { upsert: true });
            res.json({ success: true, account: {
                account_number: acct.accountNumber,
                bank_name:      acct.bankName,
                account_name:   formalAccountName,
            }});
        } else if (data.responseMessage && data.responseMessage.includes('cannot reserve more than')) {
            // Account already exists — fetch it using customer email search
            try {
                const customerEmail = email || userId + '@xamepage.app';
                const savedWallet = await Wallet.findOne({ xameId: userId }).lean();
                const savedRef = savedWallet?.virtualAccounts?.monnify?.accountReference
                              || savedWallet?.virtualAccount?.accountReference
                              || null;
                const fetchUrl = savedRef
                    ? `${baseUrl}/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(savedRef)}`
                    : `${baseUrl}/api/v2/bank-transfer/reserved-accounts/search?q=${encodeURIComponent(customerEmail)}&page=0&size=10`;
                const fetchRes = await fetch(fetchUrl, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const fetchData = await fetchRes.json();
                if (fetchData.requestSuccessful && fetchData.responseBody?.accounts?.length) {
                    const acct = fetchData.responseBody.accounts[0];
                    const acctName = fetchData.responseBody.accountName || formalAccountName;
                    const acctRef  = fetchData.responseBody.accountReference || accountReference;
                    await Wallet.findOneAndUpdate({ xameId: userId }, {
                        'virtualAccount.accountNumber':    acct.accountNumber,
                        'virtualAccount.bankName':         acct.bankName,
                        'virtualAccount.accountName':      acctName,
                        'virtualAccount.provider':         'monnify',
                        'virtualAccount.accountReference': acctRef,
                    }, { upsert: true });
                    await User.findOneAndUpdate({ xameId: userId }, {
                        'virtualAccount.accountNumber': acct.accountNumber,
                        'virtualAccount.bankName':      acct.bankName,
                        'virtualAccount.accountName':   acctName,
                    });
                    res.json({ success: true, account: {
                        account_number: acct.accountNumber,
                        bank_name:      acct.bankName,
                        account_name:   acctName,
                    }});
                } else {
                    // Try fetching by customer email
                    const emailRes = await fetch(`${baseUrl}/api/v1/bank-transfer/reserved-accounts?customerEmail=${encodeURIComponent(customerEmail)}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const emailData = await emailRes.json();
                    if (emailData.requestSuccessful && emailData.responseBody?.content?.length) {
                        const acct = emailData.responseBody.content[0].accounts?.[0] || emailData.responseBody.content[0];
                        const acctName = emailData.responseBody.content[0].accountName || formalAccountName;
                        await Wallet.findOneAndUpdate({ xameId: userId }, {
                            'virtualAccount.accountNumber':    acct.accountNumber,
                            'virtualAccount.bankName':         acct.bankName,
                            'virtualAccount.accountName':      acctName,
                            'virtualAccount.provider':         'monnify',
                        }, { upsert: true });
                        res.json({ success: true, account: {
                            account_number: acct.accountNumber,
                            bank_name:      acct.bankName,
                            account_name:   acctName,
                        }});
                    } else {
                        // Last resort: list all reserved accounts and find by userId
                        try {
                            const listRes = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts/search?page=0&size=20&customerEmail=${encodeURIComponent(customerEmail)}`, {
                                headers: { Authorization: `Bearer ${token}` }
                            });
                            const listData = await listRes.json();
                            const found = listData.responseBody?.content?.find(a => 
                                a.customerEmail === customerEmail || 
                                a.contractCode === process.env.MONNIFY_CONTRACT_CODE
                            );
                            if (found && found.accounts?.[0]) {
                                const acct = found.accounts[0];
                                const acctName = found.accountName || formalAccountName;
                                await Wallet.findOneAndUpdate({ xameId: userId }, {
                                    'virtualAccount.accountNumber':    acct.accountNumber,
                                    'virtualAccount.bankName':         acct.bankName,
                                    'virtualAccount.accountName':      acctName,
                                    'virtualAccount.provider':         'monnify',
                                    'virtualAccounts.monnify.accountNumber':    acct.accountNumber,
                                    'virtualAccounts.monnify.bankName':         acct.bankName,
                                    'virtualAccounts.monnify.accountName':      acctName,
                                    'virtualAccounts.monnify.accountReference': found.reservationReference || '',
                                }, { upsert: true });
                                return res.json({ success: true, account: {
                                    account_number: acct.accountNumber,
                                    bank_name:      acct.bankName,
                                    account_name:   acctName,
                                }});
                            }
                        } catch(_) {}
                        // All retrieval attempts failed — create a fresh account
                        const newRes = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                accountReference:    'xamepay-mnfy-' + userId + '-' + Date.now(),
                                accountName:         formalAccountName,
                                currencyCode:        'NGN',
                                contractCode:        contractCode,
                                customerEmail:       customerEmail,
                                customerName:        formalAccountName,
                                getAllAvailableBanks: false,
                                preferredBanks:      ['035'],
                            })
                        });
                        const newData = await newRes.json();
                        if (newData.requestSuccessful && newData.responseBody?.accounts?.[0]) {
                            const acct = newData.responseBody.accounts[0];
                            const acctRef = newData.responseBody.reservationReference || '';
                            await Wallet.findOneAndUpdate({ xameId: userId }, {
                                'virtualAccount.accountNumber':    acct.accountNumber,
                                'virtualAccount.bankName':         acct.bankName,
                                'virtualAccount.accountName':      formalAccountName,
                                'virtualAccount.provider':         'monnify',
                                'virtualAccount.accountReference': acctRef,
                                'virtualAccounts.monnify.accountNumber':    acct.accountNumber,
                                'virtualAccounts.monnify.bankName':         acct.bankName,
                                'virtualAccounts.monnify.accountName':      formalAccountName,
                                'virtualAccounts.monnify.accountReference': acctRef,
                            }, { upsert: true });
                            return res.json({ success: true, account: {
                                account_number: acct.accountNumber,
                                bank_name:      acct.bankName,
                                account_name:   formalAccountName,
                            }});
                        }
                        // Auto-create also failed (likely "cannot reserve more than 1") — search by email one more time
                        if (newData.responseMessage && newData.responseMessage.includes('cannot reserve more than')) {
                            try {
                                const retryRes = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts/search?page=0&size=20&customerEmail=${encodeURIComponent(customerEmail)}`, {
                                    headers: { Authorization: `Bearer ${token}` }
                                });
                                const retryData = await retryRes.json();
                                const retryFound = retryData.responseBody?.content?.find(a => a.customerEmail === customerEmail);
                                if (retryFound && retryFound.accounts?.[0]) {
                                    const acct = retryFound.accounts[0];
                                    const acctName = retryFound.accountName || formalAccountName;
                                    const acctRef = retryFound.reservationReference || '';
                                    await Wallet.findOneAndUpdate({ xameId: userId }, {
                                        'virtualAccount.accountNumber':    acct.accountNumber,
                                        'virtualAccount.bankName':         acct.bankName,
                                        'virtualAccount.accountName':      acctName,
                                        'virtualAccount.provider':         'monnify',
                                        'virtualAccount.accountReference': acctRef,
                                        'virtualAccounts.monnify.accountNumber':    acct.accountNumber,
                                        'virtualAccounts.monnify.bankName':         acct.bankName,
                                        'virtualAccounts.monnify.accountName':      acctName,
                                        'virtualAccounts.monnify.accountReference': acctRef,
                                    }, { upsert: true });
                                    return res.json({ success: true, account: {
                                        account_number: acct.accountNumber,
                                        bank_name:      acct.bankName,
                                        account_name:   acctName,
                                    }});
                                }
                            } catch(_) {}
                        }
                        res.json({ success: false, message: 'Could not set up Monnify account. Please try again.' });
                    }
                }
            } catch (fetchErr) {
                res.json({ success: false, message: 'Could not retrieve existing Monnify account: ' + fetchErr.message });
            }
        } else {
            res.json({ success: false, message: data.responseMessage || 'Monnify VA creation failed', data });
        }
    } catch (err) {
        res.json({ success: false, message: 'Server error: ' + err.message });
    }
});

app.post('/api/wallet/flw/virtual-account', async (req, res) => {
  const { userId, email, name, currency, bvn, confirmSwitch } = req.body;
  const flwSecret = process.env.FLW_SECRET_KEY;
  if (!flwSecret || !userId) return res.json({ success: false, message: 'Missing fields' });
  try {
    // Silently save BVN if provided
    if (bvn && bvn !== '00000000000' && bvn.length === 11) {
        try { await User.findOneAndUpdate({ xameId: userId }, { bvnPlain: bvn }); } catch(_) {}
    }
    // Return saved virtual account if exists and already Flutterwave (idempotent re-fetch)
    const existingWallet = await Wallet.findOne({ xameId: userId });
    if (existingWallet?.virtualAccount?.accountNumber &&
        (!existingWallet.virtualAccount.provider || existingWallet.virtualAccount.provider === 'flutterwave')) {
      return res.json({ success: true, account: {
        account_number: existingWallet.virtualAccount.accountNumber,
        bank_name:      existingWallet.virtualAccount.bankName,
        account_name:   existingWallet.virtualAccount.accountName || ('XamePay' + userId),
      }});
    }
    // Never silently overwrite an existing different-provider account —
    // the user must explicitly confirm a switch (mirrors the Monnify route's guard).
    if (existingWallet?.virtualAccount?.provider && existingWallet.virtualAccount.provider !== 'flutterwave' && existingWallet.virtualAccount.accountNumber && !confirmSwitch) {
      return res.json({ success: false, message: 'User already has a ' + existingWallet.virtualAccount.provider + ' virtual account. Pass confirmSwitch:true to replace it.', requiresConfirmation: true, currentProvider: existingWallet.virtualAccount.provider });
    }
    // If switching back to Flutterwave and account already exists in DB — return it directly
    if (confirmSwitch && existingWallet?.virtualAccount?.accountNumber) {
      const flwWallet = await Wallet.findOne({ xameId: userId }).lean();
      if (flwWallet?.virtualAccount?.accountNumber) {
        await Wallet.findOneAndUpdate({ xameId: userId }, { 'virtualAccount.provider': 'flutterwave' });
        return res.json({ success: true, account: {
          account_number: flwWallet.virtualAccount.accountNumber,
          bank_name:      flwWallet.virtualAccount.bankName,
          account_name:   flwWallet.virtualAccount.accountName || ('XamePay' + userId),
        }});
      }
    }
    const vaUser = await User.findOne({ xameId: userId }).lean();
    const formalAccountName = 'XamePay - ' + (vaUser ? `${vaUser.firstName} ${vaUser.lastName}`.trim() : userId);
    const response = await fetch('https://api.flutterwave.com/v3/virtual-account-numbers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email || userId + '@xamepage.app',
        is_permanent: true,
        bvn: bvn || vaUser?.bvnPlain || '00000000000',
        tx_ref: 'xamepay-va-' + userId + '-' + Date.now(),
        amount: 0,
        currency: currency || 'NGN',
        narration: formalAccountName,
        account_name: formalAccountName
      })
    });
    const data = await response.json();
    if (data.status === 'success') {
      // Save virtual account to both User and Wallet collections
      await User.findOneAndUpdate({ xameId: userId }, {
        'virtualAccount.accountNumber': data.data.account_number,
        'virtualAccount.bankName':      data.data.bank_name,
        'virtualAccount.accountName':   formalAccountName,
      });
      await Wallet.findOneAndUpdate({ xameId: userId }, {
        'virtualAccount.accountNumber': data.data.account_number,
        'virtualAccount.bankName':      data.data.bank_name,
        'virtualAccount.accountName':   formalAccountName,
        'virtualAccount.provider':      'flutterwave',
      }, { upsert: true });
      res.json({ success: true, account: data.data });
    } else {
      res.json({ success: false, message: data.message, data: data });
    }
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// Flutterwave card payment init
app.post('/api/wallet/flw/init-payment', async (req, res) => {
    const { userId, amount, currency, email, name } = req.body;
    if (!userId || !amount) return res.json({ success: false, message: 'Missing fields.' });
    try {
        const txRef = 'xamepay-card-' + userId + '-' + Date.now();
        const r = await fetch('https://api.flutterwave.com/v3/payments', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tx_ref: txRef,
                amount,
                currency: currency || 'NGN',
                redirect_url: process.env.SERVER_URL + '/api/wallet/flw/card-callback',
                customer: { email: email || userId + '@xamepage.app', name: name || userId },
                customizations: { title: 'XamePay', logo: '' },
                meta: { userId },
            }),
        });
        const data = await r.json();
        if (data.status === 'success') {
            res.json({ success: true, paymentLink: data.data.link });
        } else {
            res.json({ success: false, message: data.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Flutterwave card callback
app.get('/api/wallet/flw/card-callback', async (req, res) => {
    const { transaction_id, status } = req.query;
    if (status !== 'successful' || !transaction_id) return res.redirect('/payment-failed');
    try {
        const r = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        });
        const data = await r.json();
        if (data.status === 'success' && data.data.status === 'successful') {
            const userId = data.data.meta?.userId;
            const amount = data.data.amount;
            const currency = data.data.currency;
            if (userId && amount) {
                const issuer = data.data.card?.issuer || data.data.issuer || '';
                const last4  = data.data.card?.last_4digits || '';
                const label  = issuer
                    ? `Card Payment · ${issuer}${last4 ? ' ****' + last4 : ''}`
                    : 'Card Payment';
                await creditWallet(userId, amount, label, '💳', transaction_id);
            }
        }
        res.redirect('/payment-success');
    } catch (err) {
        res.redirect('/payment-failed');
    }
});



// Squad card/bank payment init (NGN or USD)
// ── Squad Virtual Account ─────────────────────────────────────────────────────
app.post('/api/wallet/squad/virtual-account', async (req, res) => {
    const { userId, firstName, middleName, lastName, bvn, gender, dob, address } = req.body;
    if (!userId || !firstName || !lastName || !bvn || !dob) {
        return res.status(400).json({ success: false, message: 'Missing required fields: firstName, lastName, bvn, dob.' });
    }
    if (!/^\d{11}$/.test(bvn)) {
        return res.status(400).json({ success: false, message: 'BVN must be exactly 11 digits.' });
    }
    try {
        const squadKey  = process.env.SQUAD_SECRET_KEY;
        const baseUrl   = process.env.SQUAD_BASE_URL || 'https://api-d.squadco.com';
        if (!squadKey) return res.status(500).json({ success: false, message: 'Squad not configured.' });

        // Check if user already has a Squad VA stored
        const existingWallet = await Wallet.findOne({ xameId: userId }).lean();
        if (existingWallet?.virtualAccount?.provider === 'squad' &&
            existingWallet?.virtualAccount?.accountNumber) {
            return res.json({ success: true, account: {
                account_number: existingWallet.virtualAccount.accountNumber,
                bank_name:      existingWallet.virtualAccount.bankName || 'Squad MFB',
                account_name:   existingWallet.virtualAccount.accountName || `${firstName} ${lastName}`,
            }});
        }

        // Get user email
        const user = await User.findOne({ xameId: userId }).lean();
        const email = user?.email || `${userId}@xamepage.app`;

        // Format DOB from DD/MM/YYYY to MM/DD/YYYY (Squad format)
        let formattedDob = dob;
        if (dob && dob.includes('/')) {
            const parts = dob.split('/');
            if (parts.length === 3) formattedDob = `${parts[1]}/${parts[0]}/${parts[2]}`;
        }

        // Create Squad virtual account
        const payload = {
            customer_identifier: `xamepay-${userId}`,
            first_name:          firstName,
            last_name:           lastName,
            middle_name:         middleName || '',
            mobile_num:          user?.phone || '08000000000',
            email,
            bvn,
            dob:                 formattedDob,
            address:             address || 'Lagos, Nigeria',
            gender:              gender === 'F' ? '2' : '1', // Squad: 1=Male, 2=Female
            beneficiary_account: process.env.SQUAD_BENEFICIARY_ACCOUNT || '',
        };

        console.log('Squad VA creation payload:', JSON.stringify({ ...payload, bvn: '***' }));

        const r = await fetch(`${baseUrl}/virtual-account`, {
            method:  'POST',
            headers: {
                Authorization:  `Bearer ${squadKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const contentType = r.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await r.text();
            console.error('Squad VA non-JSON response:', text.substring(0, 300));
            return res.status(502).json({ success: false, message: 'Squad returned an unexpected response. Please try again.' });
        }

        const data = await r.json();
        console.log('Squad VA response:', JSON.stringify(data));

        if (data.status === 200 || data.success === true) {
            const acctNum  = data.data?.virtual_account_number || data.data?.account_number || '';
            const bankName = data.data?.bank_name || 'Squad MFB';
            const acctName = data.data?.customer_identifier || `${firstName} ${lastName}`;

            // Save to wallet
            await Wallet.findOneAndUpdate({ xameId: userId }, {
                'virtualAccount.accountNumber':    acctNum,
                'virtualAccount.bankName':         bankName,
                'virtualAccount.accountName':      acctName,
                'virtualAccount.provider':         'squad',
                'virtualAccount.accountReference': `xamepay-${userId}`,
            }, { upsert: true });

            // Save to user profile
            await User.findOneAndUpdate({ xameId: userId }, {
                'virtualAccount.accountNumber': acctNum,
                'virtualAccount.bankName':      bankName,
                'virtualAccount.accountName':   acctName,
            });

            return res.json({ success: true, account: {
                account_number: acctNum,
                bank_name:      bankName,
                account_name:   acctName,
            }});
        } else {
            const msg = data.message || data.data?.message || 'Squad virtual account creation failed.';
            // Handle duplicate customer
            if (msg.toLowerCase().includes('already exist') || msg.toLowerCase().includes('duplicate')) {
                // Try to fetch existing
                const fetchR = await fetch(`${baseUrl}/virtual-account/customer/xamepay-${userId}`, {
                    headers: { Authorization: `Bearer ${squadKey}` },
                });
                if (fetchR.ok) {
                    const fetchData = await fetchR.json();
                    if (fetchData.status === 200 && fetchData.data) {
                        const acctNum  = fetchData.data.virtual_account_number || fetchData.data.account_number || '';
                        const bankName = fetchData.data.bank_name || 'Squad MFB';
                        const acctName = `${firstName} ${lastName}`;
                        await Wallet.findOneAndUpdate({ xameId: userId }, {
                            'virtualAccount.accountNumber':    acctNum,
                            'virtualAccount.bankName':         bankName,
                            'virtualAccount.accountName':      acctName,
                            'virtualAccount.provider':         'squad',
                            'virtualAccount.accountReference': `xamepay-${userId}`,
                        }, { upsert: true });
                        return res.json({ success: true, account: {
                            account_number: acctNum,
                            bank_name:      bankName,
                            account_name:   acctName,
                        }});
                    }
                }
            }
            return res.json({ success: false, message: msg });
        }
    } catch (err) {
        console.error('Squad VA error:', err);
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
});

app.post('/api/wallet/squad/init-payment', async (req, res) => {
    const { userId, amount, currency, email, name } = req.body;
    if (!userId || !amount) return res.json({ success: false, message: 'Missing fields.' });
    try {
        const txRef = 'xamepay-sqd-' + userId + '-' + Date.now();
        const baseUrl = process.env.SQUAD_BASE_URL || 'https://sandbox-api-d.squadco.com';
        const r = await fetch(`${baseUrl}/transaction/initiate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Math.round(amount * 100), // Squad expects kobo/cent, lowest denomination
                email: email || userId + '@xamepage.app',
                currency: currency || 'NGN',
                initiate_type: 'inline',
                transaction_ref: txRef,
                callback_url: process.env.SERVER_URL + '/api/wallet/squad/callback',
                customer_name: name || userId,
                metadata: { userId },
            }),
        });
        const data = await r.json();
        if (data.status === 200 && data.data?.checkout_url) {
            res.json({ success: true, paymentLink: data.data.checkout_url });
        } else {
            res.json({ success: false, message: data.message || 'Squad init failed' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Squad payment callback (redirect after checkout)
app.get('/api/wallet/squad/callback', async (req, res) => {
    console.log('Squad callback DEBUG query params:', JSON.stringify(req.query));
    const { transaction_ref } = req.query;
    if (!transaction_ref) return res.redirect('/payment-failed');
    try {
        const baseUrl = process.env.SQUAD_BASE_URL || 'https://sandbox-api-d.squadco.com';
        const r = await fetch(`${baseUrl}/transaction/verify/${transaction_ref}`, {
            headers: { Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}` },
        });
        const data = await r.json();
        console.log('Squad callback DEBUG verify response:', JSON.stringify(data));
        if (data.status === 200 && data.data?.status === 'success') {
            const userId = transaction_ref.split('-')[2]; // xamepay-sqd-<userId>-<ts>
            const amount = (data.data.amount || 0) / 100; // convert from kobo/cent back to major unit
            if (userId && amount) {
                const wallet = await Wallet.findOne({ xameId: userId });
                const alreadyCredited = wallet?.transactions?.some(t => t.ref === transaction_ref);
                if (!alreadyCredited) {
                    await creditWallet(userId, amount, 'Card Payment · Squad', '💳', transaction_ref, { source: 'client_payment' });
                }
            }
        }
        res.redirect('/payment-success');
    } catch (err) {
        res.redirect('/payment-failed');
    }
});

// ── 3.0 Block 6: Public Profile API ─────────────────────────────────────────
app.get('/api/public/profile/:xameId', async (req, res) => {
    try {
        const user = await User.findOne({ xameId: req.params.xameId })
            .select('xameId firstName lastName profilePic').lean();
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        res.json({ success: true, profile: {
            xameId:     user.xameId,
            name:       `${user.firstName} ${user.lastName}`.trim(),
            profilePic: user.profilePic || '',
        }});
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Android App Links verification ──────────────────────────────────────────
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.xamepage.app',
      sha256_cert_fingerprints: [
        'F1:EE:03:97:F8:05:46:03:47:26:C4:CE:2C:1C:98:97:4A:81:B2:97:65:63:DB:6D:78:C2:B9:57:E3:EE:A5:1'
      ]
    }
  }]);
});

// ── 3.0 Block 6: Public Profile Page ─────────────────────────────────────────
app.get('/u/:xameId', async (req, res) => {
    try {
        const user = await User.findOne({ xameId: req.params.xameId })
            .select('xameId firstName lastName profilePic').lean();
        if (!user) return res.status(404).send(`<!DOCTYPE html><html><head><title>XamePage — User Not Found</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#07101C;color:#EDF3F8;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}a{color:#00B0A0}</style></head><body><h2>User not found</h2><p>This XamePage profile does not exist.</p><a href="https://xamepage.com">← Back to XamePage</a></body></html>`);

        const name       = `${user.firstName} ${user.lastName}`.trim();
        const pic        = user.profilePic || '';
        const xameId     = user.xameId;
        const msgUrl      = `https://app.xamepage.com/chat/${xameId}`;
        const callUrl     = `https://app.xamepage.com/call/${xameId}`;
        const payUrl      = `xamepage://add/${xameId}`;
        const downloadUrl = `https://app.xamepage.com/api/app/download`;

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} — XamePage</title>
<meta name="description" content="Connect with ${name} on XamePage — chat, call, and pay.">
<meta property="og:title" content="${name} on XamePage">
<meta property="og:description" content="Message, call, or send money to ${name} on XamePage.">
${pic ? `<meta property="og:image" content="${pic}">` : ''}
<link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#07101C;color:#EDF3F8;font-family:'Cabinet Grotesk',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.card{background:#0F1E2E;border:1px solid rgba(255,255,255,0.06);border-radius:24px;padding:40px 32px;max-width:380px;width:100%;text-align:center}
.avatar{width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid #00B0A0;margin-bottom:16px}
.avatar-placeholder{width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,#00B0A0,#007A6E);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:#fff;margin:0 auto 16px}
.name{font-size:24px;font-weight:800;margin-bottom:4px}
.xame-id{font-size:13px;color:#4A6E88;margin-bottom:32px}
.actions{display:flex;flex-direction:column;gap:12px}
.btn{display:block;padding:14px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;transition:all 0.2s;cursor:pointer;border:none;width:100%;text-align:center}
.btn-primary{background:#00B0A0;color:#000}
.btn-secondary{background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.25) !important;color:#00B0A0}
.divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:24px 0}
.footer{margin-top:24px;font-size:12px;color:#4A6E88}
.footer a{color:#00B0A0;text-decoration:none}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;align-items:center;justify-content:center;padding:24px}
.overlay.active{display:flex}
.panel{background:#0F1E2E;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:28px;width:100%;max-width:360px}
.panel h3{font-size:18px;font-weight:800;margin-bottom:6px}
.panel p{font-size:13px;color:#8AAFC8;margin-bottom:20px}
.input{width:100%;background:#07101C;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 14px;color:#EDF3F8;font-size:15px;margin-bottom:12px;font-family:inherit}
.input:focus{outline:none;border-color:#00B0A0}
textarea.input{min-height:90px;resize:none}
.row{display:flex;gap:10px}
.btn-cancel{background:rgba(255,255,255,0.06);color:#8AAFC8}
.success-msg{text-align:center;padding:16px 0}
.success-msg .icon{font-size:48px;margin-bottom:8px}
.success-msg h3{font-size:18px;font-weight:800;margin-bottom:6px}
.success-msg p{font-size:13px;color:#8AAFC8;margin-bottom:20px}
</style>
</head>
<body>
<div class="card">
  ${pic
    ? `<img src="${pic}" class="avatar" alt="${name}">`
    : `<div class="avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`}
  <div class="name">${name}</div>
  <div class="xame-id">@${xameId}</div>
  <div class="actions">
    <button class="btn btn-primary" onclick="showPanel('msg')">💬 Message on XamePage</button>
    <button class="btn btn-secondary" onclick="showPanel('call')">📞 Call on XamePage</button>
    <a href="${payUrl}" class="btn btn-secondary">💳 Send Money via XamePay</a>
  </div>
  <hr class="divider">
  <p style="font-size:13px;color:#8AAFC8;margin-bottom:16px">Don't have XamePage yet?</p>
  <a href="${downloadUrl}" class="btn btn-primary">⬇ Download Free</a>
</div>
<div class="footer">
  <a href="https://xamepage.com">xamepage.com</a> — by McErima International Limited
</div>

<!-- Message overlay -->
<div class="overlay" id="msgOverlay">
  <div class="panel">
    <div id="msgForm">
      <h3>💬 Message ${name.split(' ')[0]}</h3>
      <p>Your message will be delivered to ${name.split(' ')[0]}'s XamePage inbox.</p>
      <input class="input" id="msgName" placeholder="Your name" maxlength="40">
      <textarea class="input" id="msgText" placeholder="Type your message..." maxlength="500"></textarea>
      <div class="row">
        <button class="btn btn-cancel" onclick="hidePanel('msg')" style="flex:1">Cancel</button>
        <button class="btn btn-primary" onclick="sendMsg()" id="msgBtn" style="flex:2">Send Message</button>
      </div>
    </div>
    <div class="success-msg" id="msgSuccess" style="display:none">
      <div class="icon">✅</div>
      <h3>Message Sent!</h3>
      <p>${name.split(' ')[0]} will receive your message on XamePage.</p>
      <p style="margin-bottom:16px">Want to continue the conversation?</p>
      <a href="${downloadUrl}" class="btn btn-primary">⬇ Get XamePage Free</a>
      <button class="btn btn-cancel" onclick="hidePanel('msg')" style="margin-top:10px">Close</button>
    </div>
  </div>
</div>

<!-- Call overlay -->
<div class="overlay" id="callOverlay">
  <div class="panel">
    <div id="callForm">
      <h3>📞 Call ${name.split(' ')[0]}</h3>
      <p>${name.split(' ')[0]} will receive a call notification on XamePage and can answer from the app.</p>
      <input class="input" id="callName" placeholder="Your name" maxlength="40">
      <div class="row">
        <button class="btn btn-cancel" onclick="hidePanel('call')" style="flex:1">Cancel</button>
        <button class="btn btn-primary" onclick="sendCall()" id="callBtn" style="flex:2">📞 Request Call</button>
      </div>
    </div>
    <div class="success-msg" id="callSuccess" style="display:none">
      <div class="icon">📞</div>
      <h3>Call Request Sent!</h3>
      <p>${name.split(' ')[0]} has been notified and will call you back.</p>
      <p style="margin-bottom:16px">Get XamePage to receive calls too.</p>
      <a href="${downloadUrl}" class="btn btn-primary">⬇ Get XamePage Free</a>
      <button class="btn btn-cancel" onclick="hidePanel('call')" style="margin-top:10px">Close</button>
    </div>
  </div>
</div>

<script>
const XAME_ID = '${xameId}';
const API = 'https://project-50s.onrender.com';

function showPanel(type) { document.getElementById(type+'Overlay').classList.add('active'); }
function hidePanel(type) {
  document.getElementById(type+'Overlay').classList.remove('active');
  document.getElementById(type+'Form').style.display='';
  document.getElementById(type+'Success').style.display='none';
}

async function sendMsg() {
  const name = document.getElementById('msgName').value.trim();
  const text = document.getElementById('msgText').value.trim();
  if (!name) { alert('Please enter your name'); return; }
  if (!text)  { alert('Please enter a message'); return; }
  const btn = document.getElementById('msgBtn');
  btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    const r = await fetch(API+'/api/web/message', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ toXameId: XAME_ID, fromName: name, text })
    });
    const d = await r.json();
    if (d.success) {
      document.getElementById('msgForm').style.display='none';
      document.getElementById('msgSuccess').style.display='';
    } else { alert(d.message || 'Failed to send. Try again.'); }
  } catch(e) { alert('Connection error. Try again.'); }
  btn.textContent = 'Send Message'; btn.disabled = false;
}

async function sendCall() {
  const name = document.getElementById('callName').value.trim();
  if (!name) { alert('Please enter your name'); return; }
  const btn = document.getElementById('callBtn');
  btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    const r = await fetch(API+'/api/web/call-request', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ toXameId: XAME_ID, fromName: name })
    });
    const d = await r.json();
    if (d.success) {
      document.getElementById('callForm').style.display='none';
      document.getElementById('callSuccess').style.display='';
    } else { alert(d.message || 'Failed. Try again.'); }
  } catch(e) { alert('Connection error. Try again.'); }
  btn.textContent = '📞 Request Call'; btn.disabled = false;
}

// Close overlay on backdrop click
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if(e.target===o) o.classList.remove('active'); });
});
</script>
</body>
</html>`);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Squad webhook (server-side, uses SQUAD_SECRET_KEY for HMAC-SHA512 signature check)
app.post('/api/wallet/squad/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const rawBody = req.body.toString();
        const signature = req.headers['x-squad-encrypted-body'];
        const secretKey = process.env.SQUAD_SECRET_KEY || '';
        const expectedSig = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex').toUpperCase();
        const sigBuf = Buffer.from(signature || '', 'utf8');
        const expBuf = Buffer.from(expectedSig, 'utf8');
        const validSig = !!signature && sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
        console.log('Squad webhook received. signature valid:', validSig);
        if (!validSig) return res.status(401).send('Unauthorized');

        const payload = JSON.parse(rawBody);
        const d = payload.Body || {};
        console.log('Squad webhook event:', payload.Event, 'RAW body:', JSON.stringify(d));

        if (payload.Event === 'charge_successful' && d.transaction_status === 'Success') {
            const txRef = d.transaction_ref;
            const amount = (d.amount || 0) / 100; // Squad sends kobo/cent
            const userId = d.meta?.userId || (txRef?.startsWith('xamepay-sqd-') ? txRef.split('-')[2] : null);

            if (userId && amount) {
                try {
                    let wallet = await Wallet.findOne({ xameId: userId });
                    if (!wallet) wallet = new Wallet({ xameId: userId, currency: 'NGN' });
                    const alreadyCredited = wallet.transactions?.some(t => t.ref === txRef);
                    if (!alreadyCredited) {
                        await creditWallet(userId, amount, 'Card Payment · Squad', '💳', txRef, { source: 'client_payment' });
                        console.log(`✅ Squad webhook: credited ${amount} to ${userId}`);
                    }
                    const sockId = findSocketId(userId);
                    if (sockId) {
                        io.to(sockId).emit('wallet:funded', { amount, balance: wallet.balance });
                    }
                } catch (err) {
                    console.error('Squad webhook credit error:', err);
                }
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('Squad webhook error:', err.message);
        res.sendStatus(200); // ack anyway — Squad retries on non-200
    }
});

// Flutterwave USSD payment
app.post('/api/wallet/flw/ussd', async (req, res) => {
    const { userId, amount, currency, phone, account_bank } = req.body;
    if (!userId || !amount) return res.json({ success: false, message: 'Missing fields.' });
    if (!account_bank) return res.json({ success: false, message: 'Please select a bank.' });
    try {
        const txRef = 'xamepay-ussd-' + userId + '-' + Date.now();
        const r = await fetch('https://api.flutterwave.com/v3/charges?type=ussd', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tx_ref: txRef,
                account_bank,
                amount,
                currency: currency || 'NGN',
                email: userId + '@xamepage.app',
                phone_number: phone || userId,
                fullname: userId,
                meta: { userId },
            }),
        });
        const data = await r.json();
        if (data.status === 'success') {
            const ussdString = data.meta?.authorization?.note || data.data.payment_code;
            res.json({ success: true, ussdCode: ussdString });
        } else {
            res.json({ success: false, message: data.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Flutterwave webhook
app.post('/api/wallet/flw/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH || 'xamepay-flw-hash';
  const signature = req.headers['verif-hash'];
  console.log('FLW webhook received. signature:', signature, 'expected:', secretHash, 'match:', signature === secretHash);
  if (!signature || signature !== secretHash) return res.status(401).send('Unauthorized');
  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body);
  if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
    const narration = payload.data.narration || '';
    const txRef     = payload.data.tx_ref || '';
    // Card payments are handled by /api/wallet/flw/card-callback — skip here
    if (txRef.startsWith('xamepay-card-')) return res.status(200).send('OK');
    // Try narration-based userId extraction (all formats)
    let userId = null;
    if (narration.startsWith('XamePay|')) userId = narration.split('|')[1]?.trim();
    else if (narration.startsWith('XamePay - ')) userId = null; // name-based, use account lookup
    else if (narration.startsWith('XamePay ')) userId = narration.split(' ')[1]?.trim();
    else if (narration.includes('/')) userId = narration.split('/')[1]?.trim();
    // Validate userId looks like a phone number
    if (userId && !/^\d{8,}$/.test(userId)) userId = null;
    // Try tx_ref
    if (!userId && txRef.startsWith('xamepay-va-')) {
      userId = txRef.replace('xamepay-va-', '').split('-')[0];
    }
    // Try account number lookup — most reliable for virtual account transfers
    if (!userId && payload.data.account_number) {
      const w = await Wallet.findOne({ 'virtualAccount.accountNumber': payload.data.account_number }).lean();
      if (w) userId = w.xameId;
    }
    // Try meta userId
    if (!userId) userId = payload.data.meta?.userId || null;
    // Try email lookup — for payments via standalone Flutterwave payment links
    if (!userId && payload.data.customer?.email) {
        const email = payload.data.customer.email;
        if (email.endsWith('@xamepage.app')) {
            userId = email.replace('@xamepage.app', '');
        } else {
            const u = await User.findOne({ email: email.toLowerCase() }).lean();
            if (u) userId = u.xameId;
        }
    }

    // Try name-based lookup from narration (e.g. "XamePay Covenant Agbor")
    if (!userId && narration.startsWith('XamePay ')) {
        const namePart = narration.replace('XamePay - ', '').replace('XamePay ', '').trim();
        if (namePart && !/^\d+$/.test(namePart)) {
            const nameParts = namePart.split(' ');
            if (nameParts.length >= 2) {
                const u = await User.findOne({
                    firstName: { $regex: new RegExp('^' + nameParts[0] + '$', 'i') },
                    lastName:  { $regex: new RegExp('^' + nameParts[nameParts.length-1] + '$', 'i') }
                }).lean();
                if (u) userId = u.xameId;
            }
        }
    }
    console.log('FLW webhook userId:', userId, 'narration:', narration, 'tx_ref:', txRef);
    const amount = payload.data.amount;
    const currency = payload.data.currency;
    console.log('FLW webhook RAW payload.data:', JSON.stringify(payload.data));
    if (userId && amount) {
      try {
        // Credit wallet in database
        const paymentType  = (payload.data.payment_type || '').toLowerCase();
        const isBankTransfer = paymentType === 'account' ||
            paymentType === 'bank_transfer' ||
            paymentType === 'banktransfer' ||
            txRef.startsWith('xamepay-va-'); // virtual account funding is always a bank transfer
        // Flutterwave NGN virtual account webhook: sender info is in narration and meta
        // meta.sender_account_number and meta.sender_bank_code are the documented fields
        // Flutterwave stores sender info in meta with these exact field names (confirmed from dashboard):
        // originatorname, bankname, originatoraccountnum
        const senderBank   = payload.data.meta?.originatorname
            || payload.data.meta?.originator_name
            || (payload.data.customer?.name && payload.data.customer.name !== 'Anonymous customer'
                ? payload.data.customer.name : '')
            || '';
        const bankName     = payload.data.meta?.bankname
            || payload.data.meta?.bank_name
            || payload.data.meta?.sender_bank_name
            || '';
        const senderAccountNo = payload.data.meta?.originatoraccountnum
            || payload.data.meta?.originatoraccountnumber
            || payload.data.meta?.originator_account_number
            || payload.data.meta?.sender_account_number
            || '';
        const issuer       = payload.data.card?.issuer || payload.data.issuer || '';
        const last4        = payload.data.card?.last_4digits || '';
        const senderName   = isBankTransfer
            ? (senderBank ? `Bank Transfer · ${senderBank}${bankName ? ' (' + bankName + ')' : ''}` : 'Bank Transfer')
            : (issuer ? `Card Payment · ${issuer}${last4 ? ' ****' + last4 : ''}` : 'Card Payment');
        const icon = isBankTransfer ? '🏦' : '💳';
        const txId = payload.data.id?.toString() || Date.now().toString();
        const flwRef = payload.data.flw_ref || payload.data.flwRef || txId;
        // Verify transaction with Flutterwave API to get complete sender details
        // The webhook payload alone doesn't include full sender name/bank info
        let verifiedSenderName = senderBank;
        let verifiedBankName   = bankName;
        let verifiedAccountNo  = senderAccountNo;
        try {
          if (FLW_SECRET && txId) {
            const vr = await fetch(`https://api.flutterwave.com/v3/transactions/${txId}/verify`, {
              headers: { Authorization: `Bearer ${FLW_SECRET}` }
            });
            const vd = await vr.json();
            if (vd.status === 'success' && vd.data) {
              // Log full verify response meta to find correct field names
              console.log('FLW verify meta:', JSON.stringify(vd.data.meta));
              console.log('FLW verify customer:', JSON.stringify(vd.data.customer));
              verifiedSenderName = vd.data.meta?.originatorname
                  || vd.data.meta?.originator_name
                  || (vd.data.customer?.name && vd.data.customer.name !== 'Anonymous customer' ? vd.data.customer.name : '')
                  || verifiedSenderName;
              verifiedBankName   = vd.data.meta?.bankname || vd.data.meta?.bank_name || vd.data.meta?.sender_bank_name || verifiedBankName;
              verifiedAccountNo  = vd.data.meta?.originatoraccountnum || vd.data.meta?.sender_account_number || verifiedAccountNo;
              console.log('FLW verify result:', verifiedSenderName, verifiedBankName, verifiedAccountNo);
            }
          }
        } catch(e) { console.error('FLW verify error:', e.message); }
        let wallet = await Wallet.findOne({ xameId: userId });
        if (!wallet) wallet = new Wallet({ xameId: userId, currency });
        // Prevent duplicate credits
        const alreadyCredited = wallet.transactions?.some(t => t.ref === txId);
        if (!alreadyCredited) {
          wallet.balance = (wallet.balance || 0) + amount;
          wallet.transactions = wallet.transactions || [];
          // Look up recipient's virtual account details for structured receipt display
          const recipientWallet = await Wallet.findOne({ xameId: userId }).lean();
          const recipVA = recipientWallet?.virtualAccount || {};
          wallet.transactions.unshift({
            type: 'credit',
            amount,
            label: senderName,
            icon,
            ref: txId,
            flwRef,
            ts: new Date(),
            senderName:           verifiedSenderName,
            bankName:             verifiedBankName,
            accountNumber:        verifiedAccountNo,
            recipientName:        recipVA.accountName || '',
            recipientBankName:    recipVA.bankName    || '',
            recipientAccountNumber: recipVA.accountNumber || '',
          });
          await wallet.save();
          console.log(`✅ FLW webhook: credited ${amount} ${currency} to ${userId}`);
        }
        // Notify user via socket
        const recipSocketId = findSocketId(userId);
        if (recipSocketId) {
          io.to(recipSocketId).emit('wallet:receive', {
            senderId: 'bank',
            senderName,
            amount,
            currency
          });
          io.to(recipSocketId).emit('wallet:funded', { amount, balance: wallet.balance });
        }
      } catch (err) {
        console.error('FLW webhook credit error:', err);
      }
    }
  }
  res.sendStatus(200);
});

// Monnify webhook
app.post('/api/wallet/monnify/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const rawBody = req.body.toString();
        const signature = req.headers['monnify-signature'];
        const secretKey = process.env.MONNIFY_SECRET_KEY || '';
        const crypto = require('crypto');
        const expectedSig = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
        const sigBuf = Buffer.from(signature || '', 'utf8');
        const expBuf = Buffer.from(expectedSig, 'utf8');
        const validSig = !!signature && sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
        console.log('Monnify webhook received. signature valid:', validSig);
        if (!validSig) return res.status(401).send('Unauthorized');

        // Defense-in-depth: log (don't hard-reject) if the request didn't come from
        // Monnify's documented webhook IP — signature check above is the real gate.
        const MONNIFY_WEBHOOK_IP = '35.242.133.146';
        const forwardedFor = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        if (forwardedFor && forwardedFor !== MONNIFY_WEBHOOK_IP) {
            console.warn('Monnify webhook: unexpected source IP', forwardedFor, '(expected', MONNIFY_WEBHOOK_IP + ')');
        }

        const payload = JSON.parse(rawBody);
        const eventType = payload.eventType;
        const d = payload.eventData || {};
        console.log('Monnify webhook eventType:', eventType, 'RAW eventData:', JSON.stringify(d));

        if (eventType === 'SUCCESSFUL_TRANSACTION' && (d.paymentStatus === 'PAID' || d.paymentStatus === 'success')) {
            const amount = d.amountPaid;
            const txId   = d.transactionReference || d.paymentReference || Date.now().toString();

            // Try accountReference (most reliable) — saved when we created the reserved account
            let userId = null;
            const accountRef = d.product?.reference || d.accountReference || null;
            if (accountRef) {
                const w = await Wallet.findOne({ 'virtualAccount.accountReference': accountRef }).lean();
                if (w) userId = w.xameId;
            }
            // Fallback: destination account number, if present under any of the shapes Monnify may send
            if (!userId) {
                const destAcct = d.destinationAccountInformation?.accountNumber
                    || d.destinationAccountNumber
                    || null;
                if (destAcct) {
                    const w = await Wallet.findOne({ 'virtualAccount.accountNumber': destAcct }).lean();
                    if (w) userId = w.xameId;
                }
            }

            console.log('Monnify webhook userId:', userId, 'accountRef:', accountRef, 'amount:', amount);

            if (userId && amount) {
                try {
                    const senderName = d.paymentSourceInformation?.accountName
                        || d.customer?.name
                        || 'Bank Transfer';
                    const label = `Bank Transfer · ${senderName}`;
                    let wallet = await Wallet.findOne({ xameId: userId });
                    if (!wallet) wallet = new Wallet({ xameId: userId, currency: 'NGN' });
                    const alreadyCredited = wallet.transactions?.some(t => t.ref === txId);
                    if (!alreadyCredited) {
                        wallet.balance = (wallet.balance || 0) + amount;
                        wallet.transactions = wallet.transactions || [];
                        wallet.transactions.unshift({
                            type: 'credit', amount, label, icon: '🏦', ref: txId, ts: new Date(),
                        });
                        await wallet.save();
                        console.log(`✅ Monnify webhook: credited ${amount} to ${userId}`);
                    }
                    const sockId = findSocketId(userId);
                    if (sockId) {
                        io.to(sockId).emit('wallet:receive', { senderId: 'bank', senderName, amount, currency: 'NGN' });
                        io.to(sockId).emit('wallet:funded', { amount, balance: wallet.balance });
                    }
                } catch (err) {
                    console.error('Monnify webhook credit error:', err);
                }
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('Monnify webhook error:', err.message);
        res.sendStatus(200); // ack anyway — Monnify retries on non-200
    }
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
      try {
        const cashbackCoins = Math.floor((amount * 0.0002) / COIN_RATE);
        if (cashbackCoins > 0) await creditCoins(userId, cashbackCoins, 'cashback', `XamePay cashback on ₦${amount} airtime`);
        await Wallet.findOneAndUpdate({ xameId: userId }, { $inc: { monthlyVolume: amount } }, { upsert: true });
      } catch(e) {}
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
    const operatorMap = {
      'MTN-NG': 'BIL108', 'GLO-NG': 'BIL109', 'AIRTEL-NG': 'BIL110', '9MOBILE-NG': 'BIL111',
      'MTN-GH': 'BIL108', 'AIRTEL-GH': 'BIL110', 'VODAFONE-GH': 'BIL110', 'AIRTELTIGO-GH': 'BIL110',
    };
    const operatorId = req.params.operatorId;
    const billerCode = operatorMap[operatorId] || operatorId;
    const r = await fetch('https://api.flutterwave.com/v3/bill-categories', {
      headers: { Authorization: `Bearer ${FLW_SECRET}` }
    });
    const data = await r.json();
    const bundles = (data.data || [])
      .filter(b => b.biller_code === billerCode && b.amount > 0)
      .map(b => ({
        id: b.item_code,
        name: b.name,
        amount: b.amount,
        item_code: b.item_code,
        biller_code: b.biller_code,
        biller_type: b.biller_name,
      }));
    res.json({ success: true, bundles, billerCode });
  } catch(err) {
    res.json({ success: false, message: err.message });
  }
});

// Buy data bundle
app.post('/api/vtu/data', async (req, res) => {
  const { phone, countryCode, operatorId, bundleId, amount, userId, itemCode, billerType, billerCode } = req.body;
  if (!phone || !operatorId || !userId) return res.json({ success: false, message: 'Missing fields' });
  try {
    const wallet = await getWallet(userId);
    if (wallet.balance < amount) return res.json({ success: false, message: 'Insufficient balance' });
    await debitWallet(userId, amount, `Data - ${operatorId}`, '📶', 'data-'+Date.now());
    const r = await fetch('https://api.flutterwave.com/v3/bills', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        country: countryCode || 'NG',
        customer: phone,
        amount,
        recurrence: 'ONCE',
        type: billerType || 'DATA_BUNDLE',
        reference: 'xamepay-data-' + Date.now(),
        biller_name: itemCode,
        biller_code: itemCode,
      })
    });
    const data = await r.json();
    if (data.status === 'success') {
      try {
        const cashbackCoins = Math.floor((amount * 0.0002) / COIN_RATE);
        if (cashbackCoins > 0) await creditCoins(userId, cashbackCoins, 'cashback', `XamePay cashback on ₦${amount} data`);
        await Wallet.findOneAndUpdate({ xameId: userId }, { $inc: { monthlyVolume: amount } }, { upsert: true });
      } catch(e) {}
      res.json({ success: true, reference: data.data?.reference, message: 'Data bundle sent!' });
    } else {
      await creditWallet(userId, amount, 'Refund - Failed data purchase', '↩️', 'refund-'+Date.now());
      res.json({ success: false, message: data.message || 'Data purchase failed', flw_status: data.status, flw_data: data.data });
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
  const { account_number, account_bank } = req.body;
  if (!account_number || !account_bank) return res.json({ success: false, message: 'Missing fields' });
  const flwSecret = process.env.FLW_SECRET_KEY;
  const pskSecret = process.env.PSK_SECRET_KEY;
  try {
    if (flwSecret) {
      const r = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
        method: 'POST',
        headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number, account_bank })
      });
      const data = await r.json();
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
            const billerCodeMap = {
                electricity: ['BIL112','BIL113','BIL114','BIL115','BIL116','BIL117','BIL119','BIL120','BIL204','BIL215'],
                tv:          ['BIL121','BIL122','BIL123'],
                internet:    ['BIL136'],
                airtime:     ['BIL099','BIL100','BIL101','BIL102','BIL103'],
                data:        ['BIL108','BIL109','BIL110','BIL111'],
                water:       ['BIL127'],
                toll:        ['BIL127'],
                tax:         ['BIL130'],
                church:      ['BIL146','BIL147','BIL148','BIL149','BIL150','BIL151'],
                school:      ['BIL186','BIL207','BIL208','BIL209'],
            };
            const codes = billerCodeMap[type] || [];
            if (codes.length > 0) {
                bills = bills.filter(b => codes.includes(b.biller_code));
            } else {
                // fallback to name search
                bills = bills.filter(b => b.name.toUpperCase().includes(type.toUpperCase()));
            }
        }
        // Group by biller_code
        const grouped = {};
        bills.forEach(b => {
            const key = b.biller_code;
            if (!grouped[key]) {
                // Use clean biller name
                const billerNames = {
                    'BIL108': 'MTN Data', 'BIL109': 'Glo Data', 'BIL110': 'Airtel Data', 'BIL111': '9Mobile Data',
                    'BIL099': 'MTN Airtime', 'BIL100': 'Airtel Airtime', 'BIL102': 'Glo Airtime', 'BIL103': '9Mobile Airtime',
                    'BIL121': 'DSTV', 'BIL122': 'GOtv', 'BIL123': 'StarTimes',
                    'BIL112': 'EKEDC (Eko Electric)', 'BIL113': 'IKEDC (Ikeja Electric)',
                    'BIL114': 'IBEDC (Ibadan Electric)', 'BIL115': 'EEDC (Enugu Electric)',
                    'BIL116': 'PHED (Port Harcourt Electric)', 'BIL117': 'BEDC (Benin Electric)',
                    'BIL119': 'KAEDCO (Kaduna Electric)', 'BIL120': 'KEDCO (Kano Electric)',
                    'BIL204': 'AEDC (Abuja Electric)', 'BIL215': 'JED (Jos Electric)',
                    'BIL127': 'LCC Toll', 'BIL130': 'FIRS Tax', 'BIL136': 'MTN Hynet',
                };
                grouped[key] = { name: billerNames[key] || b.name, biller_code: b.biller_code, country: b.country, items: [] };
            }
            grouped[key].items.push({ item_code: b.item_code, label: b.name, amount: b.amount, fee: b.fee || 0, label_name: b.label_name });
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
            try {
                const cashbackCoins = Math.floor((parseFloat(amount) * 0.0002) / COIN_RATE);
                if (cashbackCoins > 0) await creditCoins(userId, cashbackCoins, 'cashback', `XamePay cashback on ₦${amount} bill payment`);
                await Wallet.findOneAndUpdate({ xameId: userId }, { $inc: { monthlyVolume: parseFloat(amount) } }, { upsert: true });
            } catch(e) {}
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

// Helper: get or create wallet for user
async function getWallet(xameId) {
    let wallet = await Wallet.findOne({ xameId });
    if (!wallet) wallet = await Wallet.create({ xameId });
    return wallet;
}

// Helper: add transaction and update balance
async function creditWallet(xameId, amount, label, icon, ref, extra = {}) {
    const wallet = await getWallet(xameId);
    wallet.balance = Math.round((wallet.balance + amount) * 100) / 100;
    wallet.transactions.unshift({
        id: Date.now().toString(), label, icon: icon||'💳', amount, type: 'credit',
        status: 'Completed', ref: ref||'', ts: new Date(),
        senderName:    extra.senderName    || '',
        bankName:      extra.bankName      || '',
        accountNumber: extra.accountNumber || '',
        recipientName: extra.recipientName || '',
        source:        extra.source        || '',
    });
    if (wallet.transactions.length > 100) wallet.transactions = wallet.transactions.slice(0, 100);
    wallet.updatedAt = new Date();
    await wallet.save();
    return wallet;
}

// ── Temporary: inspect Monnify's own record for a reserved account ───────────
app.get('/api/admin/monnify-debug/:accountRef', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const token = await getMonnifyToken();
        const baseUrl = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
        const r = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts/${req.params.accountRef}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await r.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Temporary: find which user owns a given virtual account number ──────────
app.get('/api/admin/find-by-account/:accountNumber', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const w = await Wallet.findOne({ 'virtualAccount.accountNumber': req.params.accountNumber }).lean();
        if (!w) return res.json({ success: false, message: 'No wallet found with that account number' });
        const u = await User.findOne({ xameId: w.xameId }).select('bvnPlain').lean();
        res.json({
            success: true,
            xameId: w.xameId,
            virtualAccount: w.virtualAccount,
            balance: w.balance,
            hasBvn: !!(u && u.bvnPlain && u.bvnPlain !== '00000000000'),
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Temporary: find a post by title for debugging ────────────────────────────
app.get('/api/admin/find-post/:title', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const posts = await DiscoveryPost.find({ title: new RegExp(req.params.title, 'i') }).lean();
        res.json({ success: true, count: posts.length, posts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

async function awardCoins(userId, coins, type, description) {
    try {
        const multiplier = { bronze: 1, silver: 1.5, gold: 2, diamond: 3 };
        const account = await RewardAccount.findOne({ userId });
        if (!account) return;
        const mult = multiplier[account.tier] || 1;
        const earned = Math.round(coins * mult);
        account.coinBalance  = (account.coinBalance  || 0) + earned;
        account.totalEarned  = (account.totalEarned  || 0) + earned;
        account.tier         = getTier(account.activeReferrals || 0);
        await account.save();
        await RewardTransaction.create({ userId, type, coins: earned, description });
    } catch (err) { console.error('awardCoins error:', err.message); }
}

async function debitWallet(xameId, amount, label, icon, ref, extra = {}) {
    const wallet = await getWallet(xameId);
    if (wallet.balance < amount) throw new Error('Insufficient balance');
    wallet.balance = Math.round((wallet.balance - amount) * 100) / 100;
    wallet.transactions.unshift({
        id: Date.now().toString(), label, icon: icon||'💸', amount,
        principal: extra.principal, fee: extra.fee, cashback: extra.cashback,
        type: 'debit', status: 'Completed', ref: ref||'', ts: new Date(),
        senderName:        extra.senderName        || '',
        senderBankName:    extra.senderBankName    || '',
        senderAccountNumber: extra.senderAccountNumber || '',
        recipientName:     extra.recipientName     || '',
        bankName:          extra.bankName          || '',
        accountNumber:     extra.accountNumber     || '',
    });
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

// Admin: reset virtualAccount.accountName so it gets rebuilt with correct real-name logic
app.post('/api/wallet/reset-account-name', async (req, res) => {
    try {
        const { userId, all } = req.body;
        if (all === true) {
            const result = await Wallet.updateMany(
                { 'virtualAccount.accountNumber': { $ne: '' } },
                { $set: { 'virtualAccount.accountName': '' } }
            );
            return res.json({ success: true, modified: result.modifiedCount });
        }
        if (!userId) return res.json({ success: false, message: 'userId required' });
        await Wallet.findOneAndUpdate({ xameId: userId },
            { $set: { 'virtualAccount.accountName': '' } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET wallet balance and transactions
app.get('/api/wallet/me', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, message: 'Missing userId' });
    try {
        const wallet = await getWallet(userId);
        let virtualAccount = wallet.virtualAccount;
        // Backfill missing accountName for older virtual accounts
        if (virtualAccount?.accountNumber && !virtualAccount.accountName) {
            const u = await User.findOne({ xameId: userId }).lean();
            const realName = u ? (`${u.firstName} ${u.lastName}`.trim() || u.preferredName || userId) : userId;
            const accountName = `XamePay ${realName}`;
            virtualAccount = { ...virtualAccount.toObject?.() ?? virtualAccount, accountName };
            await Wallet.findOneAndUpdate({ xameId: userId },
                { 'virtualAccount.accountName': accountName });
        }
        res.json({ success: true, balance: wallet.balance, currency: wallet.currency, transactions: wallet.transactions, virtualAccount, pinEnabled: wallet.pinEnabled || false });
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
        const [senderUser, recipientUser] = await Promise.all([
            User.findOne({ xameId: senderId }).lean(),
            User.findOne({ xameId: recipientId }).lean(),
        ]);
        const senderName    = senderUser    ? `${senderUser.firstName} ${senderUser.lastName}`.trim()    : senderId;
        const recipientName = recipientUser ? `${recipientUser.firstName} ${recipientUser.lastName}`.trim() : recipientId;
        await debitWallet(senderId, totalDebit, `Sent to ${recipientName}`, '💸', 'p2p-'+Date.now());
        await creditWallet(recipientId, amount, `Received from ${senderName}`, '💰', 'p2p-'+Date.now());
        if (fee > 0) await creditWallet(PLATFORM_WALLET_ID, fee, 'P2P fee from ' + senderName, '🏦', 'fee-'+Date.now());
        // Notify via socket — reuse already-fetched user data
        const recipSocketId = findSocketId(recipientId);

        if (recipSocketId) {
            io.to(recipSocketId).emit('wallet:receive', { senderId, senderName, amount, currency });
        }
        const senderSocketId = findSocketId(senderId);
        if (senderSocketId) {
            io.to(senderSocketId).emit('wallet:debit', { recipientId, recipientName, amount, currency });
        }
        res.json({ success: true, fee, message: 'Transfer successful' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Send to bank account
app.post('/api/wallet/send-bank', async (req, res) => {
    const { userId, account_bank, account_number, amount, currency, narration, accName, bankName } = req.body;
    // Get sender's real name and virtual account details for structured receipt fields
    const senderUser = await User.findOne({ xameId: userId }).lean();
    const senderFullName = senderUser ? `${senderUser.firstName} ${senderUser.lastName}`.trim() || userId : userId;
    const senderWallet = await Wallet.findOne({ xameId: userId }).lean();
    const senderVA = senderWallet?.virtualAccount || {};
    const senderVAName = senderVA.accountName || senderFullName;
    const senderBankName = senderVA.bankName || 'XamePay';
    const senderAccountNumber = senderVA.accountNumber || '';
    if (!userId || !account_bank || !account_number || !amount) return res.json({ success: false, message: 'Missing fields' });
    try {
        // Tiered flat fee: FLW rate + ~50% margin, rounded to clean numbers
        let flwFee, fee;
        if (amount <= 5000)       { flwFee = 10; fee = 15; }
        else if (amount <= 50000) { flwFee = 25; fee = 40; }
        else                      { flwFee = 50; fee = 75; }
        const ourMargin = fee - flwFee;
        const totalDebit = amount + fee;
        const txRef = 'bank-'+Date.now();
        // Debit wallet first
        const transferLabel = 'Transfer to ' + (accName || account_number) + (bankName ? ' (' + bankName + ')' : '');
        await debitWallet(userId, totalDebit, transferLabel, '🏦', txRef, {
            principal: amount, fee,
            senderName: senderVAName, senderBankName, senderAccountNumber,
            recipientName: accName || account_number, bankName: bankName || '', accountNumber: account_number,
        });
        // Log platform revenue for reconciliation
        try {
            await PlatformRevenue.create({
                userId, txRef, type: 'bank_transfer_out',
                amount, flwFee, userFee: fee, ourMargin, currency: currency || 'NGN',
            });
        } catch(_) {}
        // Send via Flutterwave
        if (FLW_SECRET) {
            const r = await fetch('https://api.flutterwave.com/v3/transfers', {
                method: 'POST',
                headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_bank, account_number, amount, currency: currency||'NGN', narration: `XamePay|${senderFullName}`, reference: 'xamepay-'+Date.now() })
            });
            const data = await r.json();
            if (data.status === 'success') {
                // Award cashback in XameCoins
                try {
                    const wallet = await Wallet.findOne({ xameId: userId }).lean();
                    const monthlyVol = wallet?.monthlyVolume || 0;
                    let cashbackRate = 0.0002; // 0.02% Basic
                    if (monthlyVol >= 200000) cashbackRate = 0.0008;      // 0.08% Diamond
                    else if (monthlyVol >= 50000) cashbackRate = 0.0006;  // 0.06% Gold
                    else if (monthlyVol >= 10000) cashbackRate = 0.0004;  // 0.04% Silver
                    const cashbackNGN = amount * cashbackRate;
                    const cashbackCoins = Math.floor(cashbackNGN / COIN_RATE);
                    if (cashbackCoins > 0) {
                        await creditCoins(userId, cashbackCoins, 'cashback', `XamePay cashback on ₦${amount} transfer`);
                        // Stamp cashback onto the original debit transaction so the receipt can show it
                        await Wallet.findOneAndUpdate(
                            { xameId: userId, 'transactions.ref': txRef },
                            { $set: { 'transactions.$.cashback': cashbackCoins } }
                        );
                    }
                    // Update monthly volume
                    await Wallet.findOneAndUpdate({ xameId: userId },
                        { $inc: { monthlyVolume: amount } }, { upsert: true });
                    return res.json({
                        success: true, fee, principal: amount, totalDebit, cashbackCoins,
                        txRef, senderName: senderVAName,
                        senderBankName, senderAccountNumber,
                        recipientName: accName || account_number, bankName: bankName || '',
                        accountNumber: account_number, ts: new Date().toISOString(),
                        message: 'Transfer successful',
                    });
                } catch(e) {}
                return res.json({ success: true, fee, principal: amount, totalDebit, txRef,
                    senderName: senderVAName, senderBankName, senderAccountNumber,
                    recipientName: accName || account_number,
                    bankName: bankName || '', accountNumber: account_number,
                    ts: new Date().toISOString(), message: 'Transfer successful' });
            }
            // Refund on failure
            await creditWallet(userId, totalDebit, 'Refund - Failed transfer', '↩️', 'refund-'+Date.now());
            return res.json({ success: false, message: data.message });
        }
        res.json({ success: false, message: 'No payment provider configured' });
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Buy airtime via Flutterwave Bills
app.post('/api/wallet/airtime', async (req, res) => {
    const { userId, phone, amount } = req.body;
    if (!userId || !phone || !amount) return res.json({ success: false, message: 'Missing fields' });
    try {
        const flwSecret = process.env.FLW_SECRET_KEY;
        if (!flwSecret) return res.json({ success: false, message: 'Payment provider not configured' });

        // Debit wallet first
        await debitWallet(userId, amount, 'Airtime - ' + phone, '📱', 'airtime-' + Date.now());

        // Send airtime via Flutterwave
        const ref = 'xamepay-airtime-' + userId + '-' + Date.now();
        const r = await fetch('https://api.flutterwave.com/v3/bills', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + flwSecret, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                country: 'NG',
                customer: phone,
                amount,
                recurrence: 'ONCE',
                type: 'AIRTIME',
                reference: ref,
            })
        });
        const data = await r.json();
        if (data.status === 'success') {
            res.json({ success: true, message: 'Airtime sent!' });
        } else {
            // Refund if failed
            await creditWallet(userId, amount, 'Refund - Airtime failed', '↩️', 'refund-' + Date.now());
            res.json({ success: false, message: data.message || 'Airtime purchase failed' });
        }
    } catch(err) {
        res.json({ success: false, message: err.message });
    }
});

// Toggle PIN on/off
app.post('/api/wallet/pin/toggle', async (req, res) => {
    const { userId, enable, pin } = req.body;
    if (!userId) return res.json({ success: false, message: 'Missing fields' });
    try {
        const bcrypt = require('bcryptjs');
        const wallet = await Wallet.findOne({ xameId: userId });
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });
        if (!enable) {
            // Disabling PIN requires current PIN verification
            if (!wallet.transactionPin) return res.json({ success: false, message: 'No PIN set' });
            const match = await bcrypt.compare(pin || '', wallet.transactionPin);
            if (!match) return res.json({ success: false, message: 'Incorrect PIN' });
        }
        wallet.pinEnabled = enable;
        await wallet.save();
        res.json({ success: true, pinEnabled: wallet.pinEnabled });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Wallet money request
app.post('/api/wallet/request', async (req, res) => {
    const { fromId, toId, amount, currency, note } = req.body;
    if (!fromId || !toId || !amount) return res.json({ success: false, message: 'Missing fields.' });
    try {
        const [sender, recipient] = await Promise.all([
            User.findOne({ xameId: fromId }),
            User.findOne({ xameId: toId }),
        ]);
        if (!sender || !recipient) return res.json({ success: false, message: 'User not found.' });
        const senderName = sender.preferredName || `${sender.firstName} ${sender.lastName}`.trim();
        if (recipient.fcmToken && admin.apps.length) {
            admin.messaging().send({
                token: recipient.fcmToken,
                android: { priority: 'high' },
                data: { type: 'wallet_request', fromId, fromName: senderName, amount: String(amount), currency: currency || 'NGN', note: note || '' },
            }).catch(e => console.warn('FCM wallet request failed:', e.message));
        }
        const recipSocketId = findSocketId(toId);
        if (recipSocketId) {
            io.to(recipSocketId).emit('wallet_request', { fromId, fromName: senderName, senderName, amount, currency: currency || 'NGN', note: note || '' });
        }
        res.json({ success: true, message: 'Request sent.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
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

// ── Transaction PIN ──────────────────────────────────────────────────────────
app.post('/api/wallet/pin/set', async (req, res) => {
    const { userId, pin } = req.body;
    if (!userId || !pin || !/^\d{4,6}$/.test(pin))
        return res.json({ success: false, message: 'PIN must be 4-6 digits' });
    try {
        const bcrypt = require('bcryptjs');
        const hashed = await bcrypt.hash(pin, 10);
        await Wallet.findOneAndUpdate({ xameId: userId },
            { transactionPin: hashed, pinAttempts: 0, pinLockedUntil: null },
            { upsert: true });
        res.json({ success: true, message: 'Transaction PIN set successfully' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/wallet/pin/verify', async (req, res) => {
    const { userId, pin } = req.body;
    if (!userId || !pin) return res.json({ success: false, message: 'Missing fields' });
    try {
        const bcrypt = require('bcryptjs');
        const wallet = await Wallet.findOne({ xameId: userId });
        if (!wallet || !wallet.transactionPin)
            return res.json({ success: false, message: 'No PIN set. Please set a transaction PIN first.' });
        // Check lock
        if (wallet.pinLockedUntil && wallet.pinLockedUntil > new Date())
            return res.json({ success: false, message: 'PIN locked. Try again in 30 minutes.' });
        const match = await bcrypt.compare(pin, wallet.transactionPin);
        if (!match) {
            wallet.pinAttempts = (wallet.pinAttempts || 0) + 1;
            if (wallet.pinAttempts >= 5) {
                wallet.pinLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
                wallet.pinAttempts = 0;
                await wallet.save();
                return res.json({ success: false, message: 'Too many attempts. PIN locked for 30 minutes.' });
            }
            await wallet.save();
            return res.json({ success: false, message: `Incorrect PIN. ${5 - wallet.pinAttempts} attempts remaining.` });
        }
        wallet.pinAttempts = 0;
        wallet.pinLockedUntil = null;
        await wallet.save();
        res.json({ success: true, message: 'PIN verified' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/wallet/pin/change', async (req, res) => {
    const { userId, oldPin, newPin } = req.body;
    if (!userId || !oldPin || !newPin || !/^\d{4,6}$/.test(newPin))
        return res.json({ success: false, message: 'Invalid fields' });
    try {
        const bcrypt = require('bcryptjs');
        const wallet = await Wallet.findOne({ xameId: userId });
        if (!wallet || !wallet.transactionPin)
            return res.json({ success: false, message: 'No PIN set' });
        const match = await bcrypt.compare(oldPin, wallet.transactionPin);
        if (!match) return res.json({ success: false, message: 'Current PIN incorrect' });
        wallet.transactionPin = await bcrypt.hash(newPin, 10);
        wallet.pinAttempts = 0;
        wallet.pinLockedUntil = null;
        await wallet.save();
        res.json({ success: true, message: 'PIN changed successfully' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Temp: Check FLW bill categories ─────────────────────────────────────────
app.get('/api/admin/flw-bills', async (req, res) => {
    try {
        const r = await fetch('https://api.flutterwave.com/v3/bill-categories', {
            headers: { Authorization: `Bearer ${FLW_SECRET}` }
        });
        const data = await r.json();
        const ng = (data.data || []).filter(b => b.country === 'NG');
        res.json({ success: true, total: ng.length, categories: ng, sample: ng.find(b => b.biller_code === 'BIL111') });
    } catch(err) { res.json({ success: false, message: err.message }); }
});

// ── Beneficiaries ────────────────────────────────────────────────────────────
app.get('/api/wallet/beneficiaries/:userId', async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ xameId: req.params.userId }).lean();
        res.json({ success: true, beneficiaries: wallet?.beneficiaries || [] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/wallet/beneficiaries/save', async (req, res) => {
    try {
        const { userId, accountNumber, bankCode, bankName, accountName } = req.body;
        if (!userId || !accountNumber || !bankCode) return res.json({ success: false, message: 'Missing fields' });
        const beneficiary = { accountNumber, bankCode, bankName, accountName, savedAt: new Date() };
        await Wallet.findOneAndUpdate(
            { xameId: userId },
            { $pull: { beneficiaries: { accountNumber } } },
            { upsert: true }
        );
        await Wallet.findOneAndUpdate(
            { xameId: userId },
            { $push: { beneficiaries: { $each: [beneficiary], $position: 0, $slice: 20 } } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/wallet/beneficiaries/:userId/:accountNumber', async (req, res) => {
    try {
        await Wallet.findOneAndUpdate(
            { xameId: req.params.userId },
            { $pull: { beneficiaries: { accountNumber: req.params.accountNumber } } }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Flutterwave webhook (server-side, uses FLW_SECRET_HASH from .env)
app.post('/api/wallet/webhook/flw', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['verif-hash'];
    if (signature !== (process.env.FLW_SECRET_HASH || 'xamepay-webhook-hash-2024')) return res.status(401).send('Unauthorized');
    try {
        const payload = JSON.parse(req.body);
        if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
            const narration = payload.data.narration || '';
            let userId = (narration.startsWith('XamePay|') ? narration.split('|')[1]?.trim() : narration.startsWith('XamePay ') ? narration.split(' ')[1]?.trim() : narration.split('/')[1]?.trim()) || payload.data.meta?.userId;
            if (!userId && payload.data.account_number) {
                const w = await Wallet.findOne({ 'virtualAccount.accountNumber': payload.data.account_number }).lean();
                if (w) userId = w.xameId;
            }
            if (userId) {
                const paymentType = (payload.data.payment_type || '').toLowerCase();
                const isBankTransfer = paymentType === 'account' ||
                    paymentType === 'bank_transfer' ||
                    paymentType === 'banktransfer';
                const senderBank  = payload.data.meta?.originatorname
                    || payload.data.meta?.originator_name
                    || payload.data.customer?.name
                    || '';
                const bankName    = payload.data.meta?.bankname
                    || payload.data.meta?.bank_name
                    || payload.data.issuer
                    || '';
                const issuer      = payload.data.card?.issuer || '';
                const last4       = payload.data.card?.last_4digits || '';
                const label = isBankTransfer
                    ? (senderBank ? `Bank Transfer · ${senderBank}${bankName ? ' (' + bankName + ')' : ''}` : 'Bank Transfer')
                    : (issuer ? `Card Payment · ${issuer}${last4 ? ' ****' + last4 : ''}` : 'Card Payment');
                const icon = isBankTransfer ? '🏦' : '💳';
                const wallet = await creditWallet(userId, payload.data.amount, label, icon, payload.data.id?.toString(), {
                    senderName:    senderBank,
                    bankName:      bankName,
                    accountNumber: payload.data.meta?.originator_account_number || payload.data.meta?.originatoraccountnumber || '',
                });
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
    const flwSecret = process.env.FLW_SECRET || process.env.FLW_SECRET_KEY;
    if (!flwSecret) return res.json({ success: false, message: 'Payment provider not configured' });

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
    const flwSecret = process.env.FLW_SECRET || process.env.FLW_SECRET_KEY;
    if (!flwSecret) return res.json({ success: false, message: 'Payment provider not configured' });

    const fee = Math.round(amount * (parseFloat(process.env.SERVICE_FEE) || 0.015) * 100) / 100;
    const totalDebit = amount + fee;
    await debitWallet(userId, totalDebit, 'Bank Transfer', '🏦', 'transfer-' + Date.now());

    const response = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_bank, account_number, amount, currency: currency || 'NGN', narration: narration || 'XamePay Transfer', reference: reference || 'xamepay-' + Date.now() })
    });
    const data = await response.json();
    if (data.status === 'success') {
      res.json({ success: true, fee, data: data.data });
    } else {
      await creditWallet(userId, totalDebit, 'Refund - Failed transfer', '↩️', 'refund-' + Date.now());
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
            id:           msg.messageId,
            text:         msg.text,
            file:         msg.file         || null,
            type:         msg.callType     ? 'call' : (msg.senderId === userId ? 'sent' : 'received'),
            direction:    msg.senderId === userId ? 'sent' : 'received',
            ts:           msg.ts,
            status:       msg.status,
            replyTo:      msg.replyTo      || null,
            expiresAt:    msg.expiresAt    || null,
            reactions:    msg.reactions    || {},
            forwarded:    msg.forwarded    || false,
            callType:     msg.callType     || null,
            callStatus:   msg.callStatus   || null,
            callDuration: msg.callDuration || null,
            actionButton: (msg.actionButton && msg.actionButton.url) ? msg.actionButton : null,
            albumId:      msg.albumId    || null,
            albumIndex:   msg.albumIndex ?? null,
            albumTotal:   msg.albumTotal || null,
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
    ipaUrl:      { type: String, default: '' },
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
    platform:       { type: String, default: 'both' }, // 'both', 'android', 'ios'
    ipaUrl:         { type: String, default: '' },
    ts:             { type: Date, default: Date.now },
});
const XamePageAnnouncement = mongoose.model('XamePageAnnouncement', xamePageAnnouncementSchema);

// ── Follow Schema ─────────────────────────────────────────────────────────────
const followSchema = new mongoose.Schema({
    followerId:  { type: String, required: true },
    followingId: { type: String, required: true },
    ts:          { type: Date, default: Date.now },
});
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
const Follow = mongoose.model('Follow', followSchema);

// ── Reporter Schema ────────────────────────────────────────────────────────────
const reporterSchema = new mongoose.Schema({
    userId:        { type: String, required: true, unique: true },
    name:          { type: String, required: true },
    country:       { type: String, default: '' },
    status:        { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    postCount:     { type: Number, default: 0 },
    followerCount: { type: Number, default: 0 },
    appliedAt:     { type: Date, default: Date.now },
    approvedAt:    { type: Date },
    certificateUrl:{ type: String, default: '' },
});
const Reporter = mongoose.model('Reporter', reporterSchema);

// ── Collab Thread Schema ─────────────────────────────────────────────────────
const collabMessageSchema = new mongoose.Schema({
    messageId:  { type: String, required: true },
    senderId:   { type: String, required: true },
    senderName: { type: String, default: '' },
    text:       { type: String, default: '' },
    ts:         { type: Date, default: Date.now },
});

const collabThreadSchema = new mongoose.Schema({
    threadId:     { type: String, required: true, unique: true },
    postId:       { type: String, required: true },
    postTitle:    { type: String, default: '' },
    postMediaUrl: { type: String, default: '' },
    authorId:     { type: String, required: true },
    requesterId:  { type: String, required: true },
    status:       { type: String, enum: ['pending','active','authorized','submitted','cancelled','expired'], default: 'pending' },
    messages:     [collabMessageSchema],
    createdAt:    { type: Date, default: Date.now },
    expiresAt:    { type: Date, default: () => new Date(Date.now() + 7*24*60*60*1000) },
});
collabThreadSchema.index({ threadId: 1 });
collabThreadSchema.index({ authorId: 1, requesterId: 1 });
const CollabThread = mongoose.model('CollabThread', collabThreadSchema);

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
    mediaUrls:    [{ url: String, type: { type: String, enum: ['image','video'], default: 'image' } }], // for multi-image carousel posts; mediaUrl/mediaType always set to the first item for backward compatibility
    region:       { type: String, default: 'Global' },
    category:     { type: String, default: 'General' },
    isLive:       { type: Boolean, default: false },
    viewCount:    { type: Number, default: 0 },
    viewedBy:     [{ type: String }], // capped at 100 unique viewers
    likeCount:    { type: Number, default: 0 },
    likedBy:      [{ type: String }],
    commentCount: { type: Number, default: 0 },
    ts:           { type: Date, default: Date.now },
    isWhisper:    { type: Boolean, default: false },
    isImmortal:          { type: Boolean, default: false },
    pulseExpiresAt:      { type: Date, default: null },
    isCollabOpen:        { type: Boolean, default: false },
    musicUrl:            { type: String,  default: '' },
    musicTitle:          { type: String,  default: '' },
    collabStatus:        { type: String, enum: ['none','pending','accepted'], default: 'none' },
    collabPartnerId:     { type: String, default: '' },
    collabPartnerName:   { type: String, default: '' },
    collabPartnerAvatar: { type: String, default: '' },
    collabMediaUrl:      { type: String, default: '' },
    collabMediaType:     { type: String, default: 'image' },
    collabLayout:        { type: String, enum: ['side-by-side','top-bottom','picture-in-picture'], default: 'side-by-side' },
    pendingCollabBy:     { type: String, default: '' },
    pendingCollabMedia:  { type: String, default: '' },
    pendingCollabType:   { type: String, default: 'image' },
    originalPostId:      { type: String, default: '' },
    isRemix:             { type: Boolean, default: false },
});
discoveryPostSchema.index({ region: 1, ts: -1 });
// TTL index: auto-delete posts where pulseExpiresAt is set and reached
discoveryPostSchema.index({ pulseExpiresAt: 1 },
    { expireAfterSeconds: 0, sparse: true });
const DiscoveryPost = mongoose.model('DiscoveryPost', discoveryPostSchema);


const discoveryStorySchema = new mongoose.Schema({
    storyId:      { type: String, required: true, unique: true },
    authorId:     { type: String, required: true, index: true },
    authorName:   { type: String, required: true },
    authorAvatar: { type: String, default: '' },
    mediaUrl:     { type: String, required: true },
    mediaType:    { type: String, enum: ['image','video'], default: 'image' },
    seen:         [{ type: String }],
    expiresAt:    { type: Date, default: () => new Date(Date.now() + 72*60*60*1000) },
    ts:           { type: Date, default: Date.now },
});
const DiscoveryStory = mongoose.model('DiscoveryStory', discoveryStorySchema);

// ── GET /api/discover/feed ────────────────────────────────────────────────────
// Returns paginated discovery posts filtered by region
app.get('/api/discover/feed', async (req, res) => {
    try {
        const { region, limit = 20, page = 1, userId } = req.query;
        const query = {};
        if (region && region !== 'global' && region !== 'Global') {
            query.region = new RegExp(region, 'i');
        }

        // Get requester's contact list for whisper filtering
        let myContactIds = [];
        if (userId) {
            const me = await User.findOne({ xameId: userId }).lean();
            if (me) myContactIds = (me.contacts || []).map(c => c.contactId?.toString());
        }

        const allPosts = await DiscoveryPost.find(query)
            .sort({ ts: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();

        // Filter: whisper posts only visible to mutual contacts of author
        const posts = allPosts.filter(p => {
            if (!p.isWhisper) return true; // public post — always show
            if (!userId) return false;     // no user — hide whisper
            if (p.authorId === userId) return true; // own post — always show
            return myContactIds.includes(p.authorId); // mutual contact — show
        });

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
                isWhisper:       p.isWhisper || false,
                isImmortal:      p.isImmortal || false,
                isCollabOpen:    p.isCollabOpen || false,
                musicUrl:        p.musicUrl || '',
                musicTitle:      p.musicTitle || '',
                collabStatus:    p.collabStatus || 'none',
                collabPartnerId:     p.collabPartnerId || '',
                collabPartnerName:   p.collabPartnerName || '',
                collabPartnerAvatar: p.collabPartnerAvatar || '',
                collabMediaUrl:      p.collabMediaUrl || '',
                collabMediaType:     p.collabMediaType || 'image',
                collabLayout:        p.collabLayout || 'side-by-side',
                originalPostId:      p.originalPostId || '',
                isRemix:             p.isRemix || false,
                mediaUrls:    (p.mediaUrls && p.mediaUrls.length > 0) ? p.mediaUrls : null,
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

// ── GET /api/discover/author/:authorId ────────────────────────────────────────
// Returns all posts by a specific author (for author gallery screen)
app.get('/api/discover/author/:authorId', async (req, res) => {
    try {
        const { authorId } = req.params;
        const { userId } = req.query;

        let myContactIds = [];
        if (userId) {
            const me = await User.findOne({ xameId: userId }).lean();
            if (me) myContactIds = (me.contacts || []).map(c => c.contactId?.toString());
        }

        const allPosts = await DiscoveryPost.find({ authorId })
            .sort({ ts: -1 })
            .lean();

        const posts = allPosts.filter(p => {
            if (!p.isWhisper) return true;
            if (!userId) return false;
            if (p.authorId === userId) return true;
            return myContactIds.includes(p.authorId);
        });

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
                isWhisper:       p.isWhisper || false,
                isImmortal:      p.isImmortal || false,
                isCollabOpen:    p.isCollabOpen || false,
                musicUrl:        p.musicUrl || '',
                musicTitle:      p.musicTitle || '',
                collabStatus:    p.collabStatus || 'none',
                collabPartnerId:     p.collabPartnerId || '',
                collabPartnerName:   p.collabPartnerName || '',
                collabPartnerAvatar: p.collabPartnerAvatar || '',
                collabMediaUrl:      p.collabMediaUrl || '',
                collabMediaType:     p.collabMediaType || 'image',
                collabLayout:        p.collabLayout || 'side-by-side',
                originalPostId:      p.originalPostId || '',
                isRemix:             p.isRemix || false,
                mediaUrls:    (p.mediaUrls && p.mediaUrls.length > 0) ? p.mediaUrls : null,
            })),
            total: posts.length,
        });
    } catch (err) {
        console.error('Discovery author posts error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/upload-music ─────────────────────────────────────────
app.post('/api/discover/upload-music', memoryUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, message: 'No audio file' });
        const musicUrl = await uploadToImageKit(req.file.buffer, `music_${Date.now()}_${req.file.originalname}`, 'music');
        res.json({ success: true, url: musicUrl });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// ── GET /api/discover/music-library ──────────────────────────────────────────
app.get('/api/discover/music-library', (req, res) => {
    const base = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';
    const t = (title, genre) => ({ title, genre, url: base + encodeURIComponent(title + '.mp3') });
    const tracks = [
        t('Cool Vibes', 'Jazz'), t('Local Forecast', 'Jazz'), t('Monkeys Spinning Monkeys', 'Fun'),
        t('Tech Talk', 'Rock'), t('Carefree', 'Contemporary'), t('Sneaky Snitch', 'Comedy'),
        t('Canon in D Major', 'Classical'), t('Funky Chunk', 'Funk'), t('Wallpaper', 'Electronic'),
        t('Gymnopedie No 1', 'Classical'), t('Aces High', 'Funk'), t('Hep Cats', 'Jazz'),
        t('Hotrock', 'Rock'), t('Bossa Antigua', 'Jazz'), t('Itty Bitty 8 Bit', 'Electronic'),
        t('Wepa', 'Latin'), t('Beach Party', 'Reggae'), t('Garden Music', 'New Age'),
        t('Healing', 'New Age'), t('Sunshine', 'Rock'), t('Jingle Bells', 'Holiday'),
        t('Achilles', 'Soundtrack'), t('Friendly Day', 'Soundtrack'), t('Spy Glass', 'Jazz'),
        t('Cuban Sandwich', 'Latin'), t('Mandeville', 'Reggae'), t('Pixel Peeker Polka - faster', 'Fun'),
        t('Hero Theme', 'Cinematic'), t('Epic Unease', 'Soundtrack'), t('Take the Lead', 'Rock'),
        t('Relaxing Piano Music', 'New Age'), t('Sunday Dub', 'Chill'),
    ].map((x, i) => ({ id: String(i + 1), title: x.title, artist: 'Kevin MacLeod (incompetech.com)', url: x.url, duration: '2:00', genre: x.genre }));
    res.json({ success: true, tracks });
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
        const { userId, limit = 30, page = 1 } = req.query;
        if (!userId) return res.json({ success: false, message: 'userId required' });

        const me = await User.findOne({ xameId: userId }).lean();
        if (!me) return res.json({ success: false, message: 'User not found' });

        const myContactIds = (me.contacts || []).map(c => c.contactId?.toString());
        myContactIds.push(userId); // exclude self

        const skip  = (parseInt(page) - 1) * parseInt(limit);
        const total = await User.countDocuments({ xameId: { $nin: myContactIds } });

        // Find users not in contacts
        const suggestions = await User.find({
            xameId: { $nin: myContactIds }
        }).skip(skip).limit(parseInt(limit)).lean();

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

        res.json({ success: true, people: result, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        console.error('People discovery error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Collab Endpoints ─────────────────────────────────────────────────────────
app.post('/api/discover/collab/request', memoryUpload.single('media'), async (req, res) => {
    try {
        const postId          = req.body.postId          || req.fields?.postId;
        const requesterId     = req.body.requesterId     || req.fields?.requesterId;
        let requesterName   = req.body.requesterName   || req.fields?.requesterName   || '';
        const requesterAvatar = req.body.requesterAvatar || req.fields?.requesterAvatar || '';
        if (!postId || !requesterId) return res.status(400).json({ success: false, message: 'Missing fields.' });
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
        if (post.authorId === requesterId) return res.status(400).json({ success: false, message: 'Cannot collab on your own post.' });
        if (post.isCollabOpen === false) return res.status(400).json({ success: false, message: 'Post not open for collab.' });
        if (post.collabStatus && post.collabStatus !== 'none') return res.status(400).json({ success: false, message: 'Collab already in progress.' });
        // If requesterName is empty or looks like a XameID, look up real name
        const requester = await User.findOne({ xameId: requesterId }).lean();
        if (!requester) return res.status(404).json({ success: false, message: 'Requester not found.' });
        if (!requesterName || /^\d+$/.test(requesterName)) {
            requesterName = requester.preferredName || `${requester.firstName} ${requester.lastName}`.trim();
        }
        const finalRequesterAvatar = requesterAvatar || (requester.hideProfilePicture ? '' : (requester.profilePic || ''));
        // Handle the requester's proposed collab media upload, if provided
        let mediaUrl = '';
        if (req.file) {
            mediaUrl = await uploadToImageKit(req.file.buffer, `collab_${requesterId}_${Date.now()}_${req.file.originalname}`, 'discovery/collab');
        }
        post.collabStatus       = 'pending';
        post.pendingCollabBy    = requesterId;
        post.pendingCollabMedia = mediaUrl;
        post.pendingCollabType  = req.body.mediaType || 'image';
        await post.save();
        const authorSocket = userToSocketMap.get(post.authorId);
        if (authorSocket) {
            io.to(authorSocket).emit('collab_request', {
                postId, postTitle: post.title, mediaUrl,
                requesterId, requesterName, requesterAvatar: finalRequesterAvatar,
            });
        }
        res.json({ success: true, message: 'Collab request sent.' });
    } catch (err) {
        console.error('collab request error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/discover/collab/accept', async (req, res) => {
    try {
        const { postId, authorId, requesterId } = req.body;
        console.log('🤝 accept request:', { postId, authorId, requesterId });
        if (!postId || !authorId || !requesterId) { console.log('🤝 accept: missing fields'); return res.status(400).json({ success: false, message: 'Missing fields.' }); }
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) { console.log('🤝 accept: post not found', postId); return res.status(404).json({ success: false, message: 'Post not found.' }); }
        const threadId = require('uuid').v4();
        await CollabThread.create({
            threadId, postId,
            postTitle:    post.title,
            postMediaUrl: post.mediaUrl,
            authorId, requesterId,
            status: 'active',
        });
        console.log('🤝 accept: thread created', threadId);
        // Update post collab status
        const partner = await User.findOne({ xameId: requesterId }).lean();
        if (partner) {
            await DiscoveryPost.updateOne({ postId }, {
                collabStatus:        'accepted',
                collabPartnerId:     requesterId,
                collabPartnerName:   partner.preferredName || `${partner.firstName} ${partner.lastName}`.trim(),
                collabPartnerAvatar: partner.hideProfilePicture ? '' : (partner.profilePic || ''),
                isCollabOpen:        false,
            });
        }
        try {
            await awardCoins(authorId, 50, 'collab_accepted', 'Collab post accepted');
            await awardCoins(requesterId, 50, 'collab_accepted', 'Your collab was accepted');
        } catch(_) {}
        const requesterSocket = userToSocketMap.get(requesterId);
        if (requesterSocket) {
            io.to(requesterSocket).emit('collab_accepted', {
                threadId, postId,
                postTitle:    post.title,
                postMediaUrl: post.mediaUrl,
            });
        }
        res.json({ success: true, threadId, message: 'Collab accepted.' });
    } catch (err) {
        console.error('collab accept error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/discover/collab/thread/:threadId', async (req, res) => {
    try {
        const { threadId } = req.params;
        const { userId } = req.query;
        const thread = await CollabThread.findOne({ threadId });
        if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
        if (thread.authorId !== userId && thread.requesterId !== userId)
            return res.status(403).json({ success: false, message: 'Access denied.' });
        res.json({ success: true, thread });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/discover/collab/thread/:threadId/send', async (req, res) => {
    try {
        const { threadId } = req.params;
        const { userId, senderName, text } = req.body;
        const thread = await CollabThread.findOne({ threadId });
        if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
        if (thread.authorId !== userId && thread.requesterId !== userId)
            return res.status(403).json({ success: false, message: 'Access denied.' });
        const messageId = require('uuid').v4();
        const msg = { messageId, senderId: userId, senderName, text, ts: new Date() };
        thread.messages.push(msg);
        await thread.save();
        const otherId = thread.authorId === userId ? thread.requesterId : thread.authorId;
        const otherSocket = userToSocketMap.get(otherId);
        if (otherSocket) {
            io.to(otherSocket).emit('collab_message', { threadId, message: msg });
        }
        res.json({ success: true, message: msg });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Authorize collab — author confirms collaboration
app.post('/api/discover/collab/authorize', async (req, res) => {
    try {
        const { threadId, authorId } = req.body;
        if (!threadId || !authorId) return res.status(400).json({ success: false, message: 'Missing fields.' });
        const thread = await CollabThread.findOne({ threadId });
        if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
        if (thread.authorId !== authorId) return res.status(403).json({ success: false, message: 'Access denied.' });
        thread.status = 'authorized';
        await thread.save();
        // Notify requester
        const requesterSocket = userToSocketMap.get(thread.requesterId);
        if (requesterSocket) {
            io.to(requesterSocket).emit('collab_authorized', {
                threadId, postId: thread.postId, postTitle: thread.postTitle });
        }
        res.json({ success: true, message: 'Collab authorized.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Submit collab — requester submits their contribution
app.post('/api/discover/collab/submit', memoryUpload.single('media'), async (req, res) => {
    try {
        const { threadId, requesterId } = req.body;
        console.log('🤝 submit request:', { threadId, requesterId, hasFile: !!req.file });
        if (!threadId || !requesterId) return res.status(400).json({ success: false, message: 'Missing fields.' });
        const thread = await CollabThread.findOne({ threadId });
        if (!thread) { console.log('🤝 submit: thread not found', threadId); return res.status(404).json({ success: false, message: 'Thread not found.' }); }
        if (thread.requesterId !== requesterId) { console.log('🤝 submit: requesterId mismatch — thread.requesterId=', thread.requesterId, 'req=', requesterId); return res.status(403).json({ success: false, message: 'Access denied.' }); }

        const post = await DiscoveryPost.findOne({ postId: thread.postId });
        console.log('🤝 submit: found original post?', !!post, 'postId=', thread.postId);
        if (!post) return res.status(404).json({ success: false, message: 'Original post not found.' });

        // Determine the requester's final contribution — either a fresh upload,
        // or whatever they proposed at request time.
        let finalMediaUrl, finalMediaType;
        if (req.file) {
            finalMediaUrl = await uploadToImageKit(req.file.buffer,
                `collab_final_${requesterId}_${Date.now()}_${req.file.originalname}`, 'discovery/collab');
            finalMediaType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
        } else {
            finalMediaUrl  = post.pendingCollabMedia || '';
            finalMediaType = post.pendingCollabType  || 'image';
        }

        const requester = await User.findOne({ xameId: requesterId }).lean();
        const requesterName = requester
            ? (requester.preferredName || `${requester.firstName} ${requester.lastName}`.trim())
            : '';
        const requesterAvatar = requester && !requester.hideProfilePicture ? (requester.profilePic || '') : '';

        // Create the remix — a brand new, independent post carrying both media
        // items, so the original post stays untouched and reusable for future
        // collabs instead of being permanently consumed by this one pairing.
        // The requester (the person actively completing/submitting the collab)
        // becomes the remix's primary author; the original post's owner is
        // credited alongside them as the collaborator.
        const remixPostId = require('uuid').v4();
        await DiscoveryPost.create({
            postId:              remixPostId,
            authorId:            requesterId,
            authorName:          requesterName,
            authorAvatar:        requesterAvatar,
            title:               post.title,
            caption:             post.caption,
            mediaUrl:            post.mediaUrl,
            mediaType:           post.mediaType,
            thumbnailUrl:        post.thumbnailUrl,
            region:              post.region,
            category:            post.category,
            musicUrl:            post.musicUrl,
            musicTitle:          post.musicTitle,
            isImmortal:          post.isImmortal,
            collabStatus:        'accepted',
            collabPartnerId:     post.authorId,
            collabPartnerName:   post.authorName,
            collabPartnerAvatar: post.authorAvatar,
            collabMediaUrl:      finalMediaUrl,
            collabMediaType:     finalMediaType,
            collabLayout:        post.collabLayout || 'side-by-side',
            originalPostId:      post.postId,
            isRemix:             true,
        });
        console.log('🤝 submit: remix post created', remixPostId);

        // Reset and reopen the original post so anyone else can collab with it too.
        post.collabStatus        = 'none';
        post.pendingCollabBy     = '';
        post.pendingCollabMedia  = '';
        post.pendingCollabType   = 'image';
        post.collabPartnerId     = '';
        post.collabPartnerName   = '';
        post.collabPartnerAvatar = '';
        post.collabMediaUrl      = '';
        post.isCollabOpen        = true;
        await post.save();
        console.log('🤝 submit: original post reset and reopened for new collabs');

        thread.status = 'submitted';
        await thread.save();
        console.log('🤝 submit: thread status now', thread.status);

        io.emit('collab_updated', { postId: post.postId, isCollabOpen: post.isCollabOpen });

        // Notify author — points at the new remix post, not the reopened original
        const authorSocket = userToSocketMap.get(thread.authorId);
        if (authorSocket) {
            io.to(authorSocket).emit('collab_submitted', {
                threadId, postId: remixPostId, postTitle: thread.postTitle, requesterId });
        }
        res.json({ success: true, message: 'Collab submitted.', remixPostId });
    } catch (err) {
        console.error('🤝 submit error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get user's collab threads
app.get('/api/discover/collab/my-threads', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ success: false, message: 'Missing userId.' });
        const threads = await CollabThread.find({
            $or: [{ authorId: userId }, { requesterId: userId }],
            status: { $in: ['active', 'authorized', 'submitted'] }
        }).sort({ createdAt: -1 }).limit(20).lean();
        res.json({ success: true, threads });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/post ───────────────────────────────────────────────────
// Create a new discovery post — upload media to Cloudinary
app.post('/api/discover/post', memoryUpload.array('media', 10), async (req, res) => {
    try {
        const { authorId, title, caption, region, category, mediaType, musicUrl, musicTitle } = req.body;
        if (!authorId || !title) {
            return res.json({ success: false, message: 'authorId and title required' });
        }

        const author = await User.findOne({ xameId: authorId }).lean();
        if (!author) return res.json({ success: false, message: 'User not found' });

        let mediaUrl     = '';
        let thumbnailUrl = '';
        let mediaUrls    = [];

        const files = req.files || [];
        if (files.length > 0) {
            // Upload each file to Cloudinary in order
            for (const file of files) {
                const uploadedUrl = await uploadToImageKit(file.buffer, `post_${authorId}_${Date.now()}_${mediaUrls.length}_${file.originalname}`, 'discovery');
                mediaUrls.push({ url: uploadedUrl, type: mediaType === 'video' ? 'video' : 'image' });
            }
            mediaUrl = mediaUrls[0].url;
            if (mediaType === 'video') {
                thumbnailUrl = `${mediaUrl}/ik-thumbnail.jpg`;
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
            ...(mediaUrls.length > 1 && { mediaUrls }),
            region: (() => {
                const regionMap = {
                    'ng':'Nigeria','gh':'Ghana','ke':'Kenya','za':'South Africa',
                    'us':'USA','gb':'UK','eu':'Europe','in':'India','ae':'UAE',
                    'sg':'Singapore','jp':'Japan','br':'Brazil','ca':'Canada','au':'Australia',
                    'global':'Global'
                };
                return regionMap[region] || region || 'Global';
            })(),
            category:     category || 'General',
            isWhisper:    req.body.isWhisper === 'true',
            isCollabOpen: req.body.isCollabOpen === 'true',
            musicUrl:     musicUrl  || '',
            musicTitle:   musicTitle || '',
            pulseExpiresAt: null, // Regular posts don't expire
        });

        res.json({ success: true, post: { id: post.postId, mediaUrl, thumbnailUrl } });
        // Award 10 coins for posting
        try { await awardCoins(authorId, 10, 'post_discovery', 'Posted on Discovery'); } catch(_) {}
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
            const uploadResult = { secure_url: await uploadToImageKit(req.file.buffer, `story_${authorId}_${Date.now()}_${req.file.originalname}`, 'stories') };
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
        // Award 2 coins to post author when liked (not when unliked)
        if (!hasLiked) {
            try { await awardCoins(post.authorId, 2, 'post_liked', 'Your post got a like'); } catch(_) {}
        }
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

        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.json({ success: false });

        const newViewCount = (post.viewCount || 0) + 1;
        const update = { $inc: { viewCount: 1 } };

        if (!post.isImmortal) {
            if (newViewCount >= 50) {
                // Immortalize — remove expiry forever
                update.$set = { isImmortal: true, pulseExpiresAt: null };
            } else if (newViewCount >= 5) {
                // Has engagement — extend expiry by 48h from now
                update.$set = { pulseExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) };
            } else if (newViewCount >= 1) {
                // First view — extend expiry by 24h more
                update.$set = { pulseExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
            }
        }

        // Track unique viewer (cap at 100)
        const { userId: viewerId } = req.body;
        if (viewerId && !post.viewedBy?.includes(viewerId)) {
            update.$push = { viewedBy: { $each: [viewerId], $slice: -100 } };
        }
        await DiscoveryPost.updateOne({ postId }, update);
        // Award 1 coin to author for every 10 views
        if (newViewCount % 10 === 0) {
            try { await awardCoins(post.authorId, 1, 'post_views', `Your post reached ${newViewCount} views`); } catch(_) {}
        }
        res.json({ success: true, isImmortal: newViewCount >= 50 });
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


// POST /api/discover/collab/toggle — Toggle collab open/closed on a post

// TEMP DEBUG — reset a post's collab status back to 'none' for testing. Remove after use.
app.post('/api/discover/collab/debug-reset', async (req, res) => {
    try {
        const { postId } = req.body;
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.json({ success: false, message: 'Post not found' });
        post.collabStatus = 'none';
        post.pendingCollabBy = '';
        post.pendingCollabMedia = '';
        post.collabPartnerId = '';
        post.collabPartnerName = '';
        post.collabPartnerAvatar = '';
        post.collabMediaUrl = '';
        await post.save();
        console.log('🤝 debug-reset:', postId, '-> collabStatus now none');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// TEMP DEBUG — bulk reset every post currently stuck with a non-'none' collabStatus. Remove after use.
app.post('/api/discover/collab/debug-reset-all', async (req, res) => {
    try {
        const stuck = await DiscoveryPost.find({ collabStatus: { $ne: 'none' } });
        for (const post of stuck) {
            post.collabStatus = 'none';
            post.pendingCollabBy = '';
            post.pendingCollabMedia = '';
            post.collabPartnerId = '';
            post.collabPartnerName = '';
            post.collabPartnerAvatar = '';
            post.collabMediaUrl = '';
            await post.save();
        }
        console.log('🤝 debug-reset-all: reset', stuck.length, 'posts');
        res.json({ success: true, resetCount: stuck.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// TEMP DEBUG — one-time drop of the broken unique index on collabthreads.messages.messageId. Remove after use.
app.post('/api/discover/collab/debug-drop-index', async (req, res) => {
    try {
        await mongoose.connection.collection('collabthreads').dropIndex('messages.messageId_1');
        console.log('🤝 debug-drop-index: dropped messages.messageId_1');
        res.json({ success: true, message: 'Index dropped.' });
    } catch (err) {
        console.error('🤝 debug-drop-index error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/discover/collab/toggle', async (req, res) => {
    try {
        const { postId, authorId } = req.body;
        console.log('🤝 toggle request:', { postId, authorId });
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) { console.log('🤝 toggle: post not found for postId', postId); return res.json({ success: false, message: 'Post not found' }); }
        if (post.authorId !== authorId) { console.log('🤝 toggle: authorId mismatch — post.authorId=', post.authorId, 'req authorId=', authorId); return res.json({ success: false, message: 'Not authorized' }); }
        post.isCollabOpen = !post.isCollabOpen;
        await post.save();
        io.emit('collab_updated', { postId: post.postId, isCollabOpen: post.isCollabOpen });
        console.log('🤝 toggle success — isCollabOpen now', post.isCollabOpen);
        res.json({ success: true, isCollabOpen: post.isCollabOpen });
    } catch (err) {
        console.error('🤝 toggle error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/discover/collab/set-layout — either the author or the accepted collab
// partner can change how the two media items are combined for display.
app.post('/api/discover/collab/set-layout', async (req, res) => {
    try {
        const { postId, userId, layout } = req.body;
        const validLayouts = ['side-by-side', 'top-bottom', 'picture-in-picture'];
        if (!postId || !userId || !layout) return res.status(400).json({ success: false, message: 'Missing fields.' });
        if (!validLayouts.includes(layout)) return res.status(400).json({ success: false, message: 'Invalid layout.' });
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
        if (post.authorId !== userId && post.collabPartnerId !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized.' });
        }
        post.collabLayout = layout;
        await post.save();
        io.emit('collab_layout_updated', { postId, layout });
        res.json({ success: true, layout });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/discover/collab/cancel — either party can withdraw/cancel a collab
// at any stage (pending request, accepted, authorized, or submitted), giving
// users a real way to self-recover instead of getting permanently stuck.
app.post('/api/discover/collab/cancel', async (req, res) => {
    try {
        const { postId, userId, threadId } = req.body;
        console.log('🤝 cancel request:', { postId, userId, threadId });
        if (!postId || !userId) return res.status(400).json({ success: false, message: 'Missing fields.' });
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) { console.log('🤝 cancel: post not found', postId); return res.status(404).json({ success: false, message: 'Post not found.' }); }

        const isParty = post.authorId === userId ||
            post.pendingCollabBy === userId ||
            post.collabPartnerId === userId;
        if (!isParty) { console.log('🤝 cancel: not authorized — userId=', userId, 'authorId=', post.authorId, 'pendingCollabBy=', post.pendingCollabBy, 'collabPartnerId=', post.collabPartnerId); return res.status(403).json({ success: false, message: 'Not authorized.' }); }
        console.log('🤝 cancel: authorized, resetting post', postId);

        // Figure out who to notify before we clear the partner fields
        const otherId = userId === post.authorId
            ? (post.collabPartnerId || post.pendingCollabBy)
            : post.authorId;

        post.collabStatus        = 'none';
        post.pendingCollabBy     = '';
        post.pendingCollabMedia  = '';
        post.pendingCollabType   = 'image';
        post.collabPartnerId     = '';
        post.collabPartnerName   = '';
        post.collabPartnerAvatar = '';
        post.collabMediaUrl      = '';
        await post.save();

        if (threadId) {
            const thread = await CollabThread.findOne({ threadId });
            if (thread) { thread.status = 'cancelled'; await thread.save(); }
        }

        io.emit('collab_updated', { postId, isCollabOpen: post.isCollabOpen });
        const otherSocket = otherId ? userToSocketMap.get(otherId) : null;
        if (otherSocket) {
            io.to(otherSocket).emit('collab_cancelled', { postId, threadId: threadId || '', cancelledBy: userId });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── COMMENTS ─────────────────────────────────────────────────────────────────
const commentSchema = new mongoose.Schema({
    commentId:    { type: String, required: true, unique: true },
    postId:       { type: String, required: true, index: true },
    authorId:     { type: String, required: true },
    authorName:   { type: String, required: true },
    authorAvatar: { type: String, default: '' },
    text:         { type: String, required: true },
    ts:           { type: Date, default: Date.now },
});
const Comment = mongoose.model('Comment', commentSchema);

// POST /api/discover/comment
app.post('/api/discover/comment', async (req, res) => {
    try {
        const { postId, userId, text } = req.body;
        if (!postId || !userId || !text?.trim())
            return res.status(400).json({ success: false, message: 'postId, userId and text required.' });
        const post = await DiscoveryPost.findOne({ postId });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
        // Always resolve commenter's real name and avatar from DB
        const commenter = await User.findOne({ xameId: userId }).select('preferredName firstName lastName profilePic hideProfilePicture').lean();
        const authorName   = commenter ? (commenter.preferredName || `${commenter.firstName} ${commenter.lastName}`.trim()) : 'User';
        const authorAvatar = commenter ? (commenter.hideProfilePicture ? '' : (commenter.profilePic || '')) : '';
        const { v4: uuidv4 } = require('uuid');
        const comment = await Comment.create({
            commentId:    uuidv4(),
            postId,
            authorId:     userId,
            authorName,
            authorAvatar,
            text:         text.trim(),
        });
        await DiscoveryPost.updateOne({ postId }, { $inc: { commentCount: 1 } });
        res.json({ success: true, comment });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/discover/:postId/comments
app.get('/api/discover/:postId/comments', async (req, res) => {
    try {
        const { postId } = req.params;
        const { page = 1, limit = 30 } = req.query;
        const comments = await Comment.find({ postId })
            .sort({ ts: 1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();
        const total = await Comment.countDocuments({ postId });
        res.json({ success: true, comments, total });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/discover/comment/:commentId
app.delete('/api/discover/comment/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { userId } = req.body;
        const comment = await Comment.findOne({ commentId });
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
        if (comment.authorId !== userId)
            return res.status(403).json({ success: false, message: 'Unauthorized.' });
        await Comment.deleteOne({ commentId });
        await DiscoveryPost.updateOne({ postId: comment.postId }, { $inc: { commentCount: -1 } });
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
            ipaUrl:      v.ipaUrl,
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
        const page  = parseInt(req.query.page  || '1');
        const limit = parseInt(req.query.limit || '20');
        const search = req.query.search || '';
        const query = search
            ? { title: { $regex: search, $options: 'i' } }
            : {};
        const total = await XamePageAnnouncement.countDocuments(query);
        const announcements = await XamePageAnnouncement.find(query)
            .sort({ ts: -1 })
            .skip((page - 1) * limit)
            .limit(limit);
        res.json({ success: true, announcements, total, page, pages: Math.ceil(total / limit) });
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


// ── Legal & Support Pages ─────────────────────────────────────────────────────
app.get('/api/referral/:code', async (req, res) => {
    try {
        const user = await User.findOne({ referralCode: req.params.code });
        if (!user) return res.status(404).json({ success: false, message: 'Referral code not found.' });
        res.json({
            success:      true,
            name:         user.preferredName || user.firstName,
            profilePic:   user.profilePic || '',
            referralCode: user.referralCode,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.get('/join/:code', async (req, res) => {
    try {
        const code = req.params.code;
        let user = await User.findOne({ referralCode: code });
        if (!user) {
            const account = await RewardAccount.findOne({ referralCode: code });
            if (account) user = await User.findOne({ xameId: account.userId });
        }
        const name = user ? (user.preferredName || user.firstName) : 'A friend';
        const pic  = user ? (user.profilePic || '') : '';
        const apkUrl = 'https://app.xamepage.com/api/app/download';

        let userPosts = [];
        if (user && user.xameId) {
            userPosts = await DiscoveryPost.find({ authorId: user.xameId, isWhisper: { $ne: true } })
                .sort({ ts: -1 })
                .limit(3)
                .lean();
        }

        const previewHtml = userPosts.length > 0 ? `
  <div style="margin-bottom:20px;text-align:left;">
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin-bottom:8px;font-weight:600;">LATEST FROM ${name.toUpperCase()}</p>
    <div style="display:grid;grid-template-columns:repeat(${userPosts.length}, 1fr);gap:8px;">
      ${userPosts.map(p => `
        <div style="background:#1e1e2e;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);aspect-ratio:1;position:relative;">
          ${p.thumbnailUrl || p.mediaUrl ? `<img src="${p.thumbnailUrl || p.mediaUrl}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="padding:8px;font-size:10px;color:rgba(255,255,255,0.7);overflow:hidden;">${p.title || p.caption || 'Post'}</div>`}
        </div>
      `).join('')}
    </div>
  </div>` : '';

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Join ${name} on XamePage</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0f; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #13131a; border: 1px solid #ffffff18; border-radius: 24px; padding: 40px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 24px 64px #00000080; }
  .logo { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 32px; background: linear-gradient(135deg, #00e5ff, #7c4dff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .avatar { width: 88px; height: 88px; border-radius: 50%; object-fit: cover; border: 3px solid #00e5ff44; margin-bottom: 16px; background: #1e1e2e; }
  .avatar-placeholder { width: 88px; height: 88px; border-radius: 50%; background: linear-gradient(135deg, #00e5ff22, #7c4dff22); border: 3px solid #00e5ff44; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 36px; }
  .invite-text { color: #ffffff80; font-size: 14px; margin-bottom: 6px; }
  .name { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
  .tagline { color: #ffffff50; font-size: 13px; margin-bottom: 32px; line-height: 1.5; }
  .btn { display: block; background: linear-gradient(135deg, #00e5ff, #7c4dff); color: #fff; text-decoration: none; padding: 16px 24px; border-radius: 14px; font-size: 16px; font-weight: 700; letter-spacing: 0.3px; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.88; }
  .footer { margin-top: 24px; color: #ffffff30; font-size: 11px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">XamePage</div>
  ${pic ? `<img class="avatar" src="${pic}" onerror="this.style.display='none'" alt="${name}">` : `<div class="avatar-placeholder">👤</div>`}
  <p class="invite-text">You were invited by</p>
  <h1 class="name">${name}</h1>
  <p class="tagline">Join XamePage — the ultramodern messaging & calling experience. Earn XameCoins just for signing up!</p>
  ${previewHtml}
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:14px;margin-bottom:16px;">
    <p style="color:rgba(255,255,255,0.4);font-size:11px;margin-bottom:8px;letter-spacing:1px;">REFERRAL CODE</p>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <span style="font-size:20px;font-weight:800;letter-spacing:3px;color:#00e5ff;">${code}</span>
      <button onclick="navigator.clipboard.writeText('${code}').then(()=>{this.textContent='✓ Copied!';setTimeout(()=>this.textContent='Copy',2000)})" style="background:linear-gradient(135deg,#00e5ff,#7c4dff);border:none;border-radius:8px;padding:8px 14px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Copy</button>
    </div>
  </div>
  <a class="btn" href="${apkUrl}">⬇️ Download XamePage</a>
  <p style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:12px;">Copy the code above and enter it during registration</p>
</div>
</body>
</html>`);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/privacy',     (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'privacy.html')));
app.get('/terms',       (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'terms.html')));
app.get('/wallet-info', (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'wallet-info.html')));
app.get('/support',     (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'support.html')));


// ── Legal & Support Pages ─────────────────────────────────────────────────────
app.get('/payment-success', (req, res) => res.sendFile(path.join(BASE_DIR, 'public', 'pay', 'success.html')));
app.get('/payment-failed',  (req, res) => res.sendFile(path.join(BASE_DIR, 'public', 'pay', 'failed.html')));
app.get('/api/referral/:code', async (req, res) => {
    try {
        const user = await User.findOne({ referralCode: req.params.code });
        if (!user) return res.status(404).json({ success: false, message: 'Referral code not found.' });
        res.json({
            success:      true,
            name:         user.preferredName || user.firstName,
            profilePic:   user.profilePic || '',
            referralCode: user.referralCode,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.get('/join/:code', async (req, res) => {
    try {
        const code = req.params.code;
        let user = await User.findOne({ referralCode: code });
        if (!user) {
            const account = await RewardAccount.findOne({ referralCode: code });
            if (account) user = await User.findOne({ xameId: account.userId });
        }
        const name = user ? (user.preferredName || user.firstName) : 'A friend';
        const pic  = user ? (user.profilePic || '') : '';
        const apkUrl = 'https://app.xamepage.com/api/app/download';
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Join ${name} on XamePage</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0f; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #13131a; border: 1px solid #ffffff18; border-radius: 24px; padding: 40px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 24px 64px #00000080; }
  .logo { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 32px; background: linear-gradient(135deg, #00e5ff, #7c4dff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .avatar { width: 88px; height: 88px; border-radius: 50%; object-fit: cover; border: 3px solid #00e5ff44; margin-bottom: 16px; background: #1e1e2e; }
  .avatar-placeholder { width: 88px; height: 88px; border-radius: 50%; background: linear-gradient(135deg, #00e5ff22, #7c4dff22); border: 3px solid #00e5ff44; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 36px; }
  .invite-text { color: #ffffff80; font-size: 14px; margin-bottom: 6px; }
  .name { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
  .tagline { color: #ffffff50; font-size: 13px; margin-bottom: 32px; line-height: 1.5; }
  .btn { display: block; background: linear-gradient(135deg, #00e5ff, #7c4dff); color: #fff; text-decoration: none; padding: 16px 24px; border-radius: 14px; font-size: 16px; font-weight: 700; letter-spacing: 0.3px; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.88; }
  .footer { margin-top: 24px; color: #ffffff30; font-size: 11px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">XamePage</div>
  ${pic ? `<img class="avatar" src="${pic}" onerror="this.style.display='none'" alt="${name}">` : `<div class="avatar-placeholder">👤</div>`}
  <p class="invite-text">You were invited by</p>
  <h1 class="name">${name}</h1>
  <p class="tagline">Join XamePage — the ultramodern messaging & calling experience. Earn XameCoins just for signing up!</p>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:14px;margin-bottom:16px;">
    <p style="color:rgba(255,255,255,0.4);font-size:11px;margin-bottom:8px;letter-spacing:1px;">REFERRAL CODE</p>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <span style="font-size:20px;font-weight:800;letter-spacing:3px;color:#00e5ff;">${code}</span>
      <button onclick="navigator.clipboard.writeText('${code}').then(()=>{this.textContent='✓ Copied!';setTimeout(()=>this.textContent='Copy',2000)})" style="background:linear-gradient(135deg,#00e5ff,#7c4dff);border:none;border-radius:8px;padding:8px 14px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Copy</button>
    </div>
  </div>
  <a class="btn" href="${apkUrl}">⬇️ Download XamePage</a>
  <p style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:12px;">Copy the code above and enter it during registration</p>
</div>
</body>
</html>`);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/privacy',     (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'privacy.html')));
app.get('/terms',       (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'terms.html')));
app.get('/wallet-info', (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'wallet-info.html')));
app.get('/support',     (req, res) => res.sendFile(path.join(BASE_DIR, 'legal', 'support.html')));

app.get('/admin', adminConsoleAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(BASE_DIR, 'admin', 'index.html'));
});

// ── App Version ──────────────────────────────────────────────────────────────
let _appVersion = {
    version:     process.env.APP_VERSION      || '2.1.1',
    buildNumber: parseInt(process.env.APP_BUILD_NUMBER || '1145'),
    downloadUrl: process.env.APP_DOWNLOAD_URL || '',
    changelog:   process.env.APP_CHANGELOG    || 'Latest improvements and bug fixes.',
    forceUpdate: false,
};

// Cache for GitHub release lookup — avoids hitting GitHub's unauthenticated
// rate limit (60 req/hour) on every single download request.
let _ghApkUrlCache = { tag: '', url: '', fetchedAt: 0 };
const GH_APK_CACHE_MS = 10 * 60 * 1000; // 10 minutes

// ── IPA Download Proxy ───────────────────────────────────────────────────────
app.get('/api/app/download/ios', async (req, res) => {
    try {
        const v = await AppVersion.findOne().sort({ updatedAt: -1 });
        const url = v && v.ipaUrl;
        // Never trust an ipaUrl pointing back at our own download endpoints —
        // same redirect-loop class of bug fixed for Android (see /api/app/download).
        if (!url || url.includes('/api/app/download')) return res.status(404).json({ success: false, message: 'No IPA download URL set.' });
        res.redirect(302, url);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── APK/IPA Download Proxy ───────────────────────────────────────────────────
app.get('/api/app/download', async (req, res) => {
    try {
        const v = await AppVersion.findOne().sort({ updatedAt: -1 });

        // Fetch latest APK from GitHub releases — cached for 10 min to avoid
        // GitHub's unauthenticated rate limit (60 req/hour) being exhausted
        // by user traffic, which silently breaks downloads for everyone.
        // Never trust a downloadUrl that points back at this same endpoint —
        // that creates an infinite redirect loop (seen in production June 2026).
        const isSelfReferencing = (u) => !u || u.includes('/api/app/download');
        const ipaUrl = isSelfReferencing(v?.ipaUrl) ? '' : v.ipaUrl;
        let apkUrl = '';

        // Only serve the APK for the specific version/build that has been
        // manually approved via /api/app/promote or /api/admin/set-version.
        // We deliberately do NOT fall back to "GitHub's newest release" —
        // that would expose unapproved builds the moment CI finishes,
        // bypassing the manual approval gate by design.
        const approvedTag = (v && v.version && v.buildNumber) ? `v${v.version}-build${v.buildNumber}` : '';

        if (approvedTag) {
            const cacheAge = Date.now() - _ghApkUrlCache.fetchedAt;
            if (_ghApkUrlCache.tag === approvedTag && _ghApkUrlCache.url && cacheAge < GH_APK_CACHE_MS) {
                apkUrl = _ghApkUrlCache.url;
            } else {
                try {
                    const ghRes = await fetch(`https://api.github.com/repos/mcerimainterltd-ctrl/Project-50s-flutter/releases/tags/${approvedTag}`, {
                        headers: { 'User-Agent': 'XamePage-Server', 'Accept': 'application/vnd.github+json' }
                    });
                    if (!ghRes.ok) {
                        console.error('GitHub release tag fetch failed:', ghRes.status, approvedTag);
                        if (_ghApkUrlCache.tag === approvedTag && _ghApkUrlCache.url) apkUrl = _ghApkUrlCache.url;
                    } else {
                        const release = await ghRes.json();
                        const apkAsset = (release.assets || []).find(a => a.name.endsWith('.apk'));
                        if (apkAsset) {
                            apkUrl = apkAsset.browser_download_url;
                            _ghApkUrlCache = { tag: approvedTag, url: apkUrl, fetchedAt: Date.now() };
                        }
                    }
                } catch(e) {
                    console.error('GitHub release tag fetch error:', e.message);
                    if (_ghApkUrlCache.tag === approvedTag && _ghApkUrlCache.url) apkUrl = _ghApkUrlCache.url;
                }
            }
        }

        // Direct download if ?platform= is specified or if non-browser request
        const platform = req.query.platform;
        const ua = req.headers['user-agent'] || '';
        const isBrowser = /Mozilla/i.test(ua);

        if (platform === 'ios') {
            if (!ipaUrl) return res.status(404).json({ success: false, message: 'No IPA download URL set.' });
            return res.redirect(302, ipaUrl);
        }
        if (platform === 'apk' || !isBrowser) {
            if (!apkUrl) return res.status(404).json({ success: false, message: 'No download URL set.' });
            return res.redirect(302, apkUrl);
        }

        // Browser — show picker page
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Download XamePage</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0D1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#111827;border:1px solid #1F2937;border-radius:24px;padding:40px 32px;max-width:400px;width:100%;text-align:center}
  .logo{width:72px;height:72px;background:#00C896;border-radius:20px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:36px}
  h1{color:#fff;font-size:22px;font-weight:800;margin-bottom:8px}
  p{color:#6B7280;font-size:14px;margin-bottom:32px;line-height:1.6}
  .btn{display:flex;align-items:center;justify-content:space-between;background:#1F2937;border:1px solid #374151;border-radius:14px;padding:18px 20px;text-decoration:none;margin-bottom:12px;transition:border-color .2s}
  .btn:hover{border-color:#00C896}
  .btn-left{display:flex;align-items:center;gap:12px}
  .btn-icon{font-size:28px}
  .btn-title{color:#fff;font-size:15px;font-weight:700;text-align:left}
  .btn-sub{color:#6B7280;font-size:12px;text-align:left}
  .btn-arrow{color:#6B7280;font-size:18px}
  .version{color:#374151;font-size:12px;margin-top:20px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📲</div>
  <a href="javascript:history.back()" style="display:inline-flex;align-items:center;gap:6px;color:#6B7280;font-size:13px;text-decoration:none;margin-bottom:24px">‹ Back</a>
  <h1>Download XamePage</h1>
  <p>Choose your platform to download the latest version.</p>
  <a href="/api/app/download?platform=apk" class="btn">
    <div class="btn-left">
      <span class="btn-icon">🤖</span>
      <div>
        <div class="btn-title">Android APK</div>
        <div class="btn-sub">For Android devices</div>
      </div>
    </div>
    <span class="btn-arrow">›</span>
  </a>
  <a href="/api/app/download?platform=ios" class="btn">
    <div class="btn-left">
      <span class="btn-icon">🍎</span>
      <div>
        <div class="btn-title">iOS IPA</div>
        <div class="btn-sub">For iPhone & iPad (sideload)</div>
      </div>
    </div>
    <span class="btn-arrow">›</span>
  </a>
  <div class="version">v${v ? v.version : '2.1.1'} · build ${v ? v.buildNumber : ''}</div>
</div>
</body>
</html>`);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/users', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    const { query = '', page = 1, limit = 20 } = req.query;
    try {
        const filter = query ? {
            $or: [
                { xameId:    { $regex: query, $options: 'i' } },
                { firstName: { $regex: query, $options: 'i' } },
                { lastName:  { $regex: query, $options: 'i' } },
                { preferredName: { $regex: query, $options: 'i' } },
            ]
        } : {};
        const total = await User.countDocuments(filter);
        const users = await User.find(filter)
            .select('xameId firstName lastName preferredName profilePic suspended createdAt fcmToken')
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();
        res.json({ success: true, users, total, pages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// XAMEPAGE REWARDS SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

// ── Schemas ───────────────────────────────────────────────────────────────────
const rewardAccountSchema = new mongoose.Schema({
    userId:           { type: String, required: true, unique: true },
    coinBalance:      { type: Number, default: 0 },
    totalEarned:      { type: Number, default: 0 },
    totalWithdrawn:   { type: Number, default: 0 },
    tier:             { type: String, default: 'bronze', enum: ['bronze', 'silver', 'gold', 'diamond'] },
    referralCode:     { type: String, required: true, unique: true },
    referredBy:       { type: String, default: '' },
    activeReferrals:  { type: Number, default: 0 },
    streakDays:       { type: Number, default: 0 },
    lastLoginDate:    { type: Date, default: null },
    callMinsToday:    { type: Number, default: 0 },
    callMinsDate:     { type: Date, default: null },
    weeklyCallUsers:  { type: [String], default: [] },
    weeklyCallDate:   { type: Date, default: null },
    monthlyReferrals: { type: Number, default: 0 },
    monthlyRefDate:   { type: Date, default: null },
    createdAt:        { type: Date, default: Date.now },
});
const RewardAccount = mongoose.model('RewardAccount', rewardAccountSchema);

const rewardTxSchema = new mongoose.Schema({
    userId:      { type: String, required: true },
    type:        { type: String, required: true },
    coins:       { type: Number, required: true },
    description: { type: String, default: '' },
    referenceId: { type: String, default: '' },
    ts:          { type: Date, default: Date.now },
});
const RewardTransaction = mongoose.model('RewardTransaction', rewardTxSchema);

const rewardWithdrawalSchema = new mongoose.Schema({
    userId:  { type: String, required: true },
    coins:   { type: Number, required: true },
    amount:  { type: Number, required: true },
    currency:{ type: String, default: 'NGN' },
    status:  { type: String, default: 'pending', enum: ['pending', 'completed', 'failed'] },
    ts:      { type: Date, default: Date.now },
});
const RewardWithdrawal = mongoose.model('RewardWithdrawal', rewardWithdrawalSchema);

// ── Constants ─────────────────────────────────────────────────────────────────
const COIN_RATE         = 0.1;  // 1 coin = ₦0.10 → 1000 coins = ₦100
const MIN_WITHDRAWAL    = 10000; // 10,000 coins = ₦1,000
const MAX_CALL_MINS_DAY = 60;
const COINS_PER_MIN     = 2;

// ── Helper: update tier ───────────────────────────────────────────────────────
function getTier(activeReferrals) {
    if (activeReferrals >= 50) return 'diamond';
    if (activeReferrals >= 21) return 'gold';
    if (activeReferrals >= 6)  return 'silver';
    return 'bronze';
}

// ── Helper: credit coins ──────────────────────────────────────────────────────
async function creditCoins(userId, coins, type, description, referenceId = '') {
    const multiplier = { bronze: 1, silver: 1.5, gold: 2, diamond: 3 };
    let account = await RewardAccount.findOne({ userId });
    if (!account) return;
    const tierMult  = multiplier[account.tier] || 1;
    const earned    = Math.round(coins * tierMult);
    account.coinBalance  += earned;
    account.totalEarned  += earned;
    account.tier          = getTier(account.activeReferrals);
    await account.save();
    await RewardTransaction.create({ userId, type, coins: earned, description, referenceId });
    return earned;
}

// ── GET /api/rewards/leaderboard ── top 10 by total coins ────────────────────
app.get('/api/rewards/leaderboard', async (req, res) => {
    try {
        const topAccounts = await RewardAccount.find({ totalEarned: { $gt: 0 } })
            .sort({ totalEarned: -1 })
            .limit(10);
        const results = await Promise.all(topAccounts.map(async a => {
            const user = await User.findOne({ xameId: a.userId })
                .select('preferredName firstName lastName profilePic hideProfilePicture');
            return {
                userId:      a.userId,
                weeklyCoins: a.totalEarned,
                tier:        a.tier || 'bronze',
                name:        user?.preferredName || `${user?.firstName} ${user?.lastName}`.trim() || a.userId,
                profilePic:  user?.hideProfilePicture ? '' : (user?.profilePic || ''),
            };
        }));
        res.json({ success: true, leaderboard: results });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/rewards/:userId — get account + recent ledger ───────────────────
app.get('/api/rewards/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let account = await RewardAccount.findOne({ userId });
        if (!account) {
            // Auto-create account
            const code = userId + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            account = await RewardAccount.create({ userId, referralCode: code });
        }
        const txs = await RewardTransaction.find({ userId }).sort({ ts: -1 }).limit(50);
        res.json({ success: true, account, transactions: txs });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/login ── daily login streak ────────────────────────────
app.post('/api/rewards/login', async (req, res) => {
    try {
        const { userId } = req.body;
        let account = await RewardAccount.findOne({ userId });
        if (!account) return res.json({ success: false });
        const today = new Date().toDateString();
        const lastLogin = account.lastLoginDate ? new Date(account.lastLoginDate).toDateString() : null;
        if (lastLogin === today) return res.json({ success: true, coins: 0 });
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        account.streakDays   = lastLogin === yesterday ? account.streakDays + 1 : 1;
        account.lastLoginDate = new Date();
        await account.save();
        let coins = 0;
        if (account.streakDays % 7 === 0) {
            coins = await creditCoins(userId, 50, 'login_streak', `${account.streakDays}-day login streak`);
        }
        res.json({ success: true, coins, streakDays: account.streakDays });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/call ── credit call minutes ────────────────────────────
app.post('/api/rewards/call', async (req, res) => {
    try {
        const { userId, peerId, durationSeconds, callId } = req.body;
        if (!userId || !durationSeconds) return res.json({ success: false });
        let account = await RewardAccount.findOne({ userId });
        if (!account) return res.json({ success: false });

        const today = new Date().toDateString();
        const callDate = account.callMinsDate ? new Date(account.callMinsDate).toDateString() : null;
        if (callDate !== today) { account.callMinsToday = 0; account.callMinsDate = new Date(); }

        const mins = Math.floor(durationSeconds / 60);
        const billable = Math.min(mins, MAX_CALL_MINS_DAY - account.callMinsToday);
        if (billable <= 0) return res.json({ success: true, coins: 0 });

        account.callMinsToday += billable;

        // Weekly benchmark tracking
        const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekDate = account.weeklyCallDate ? new Date(account.weeklyCallDate) : null;
        if (!weekDate || weekDate < weekStart) { account.weeklyCallUsers = []; account.weeklyCallDate = new Date(); }
        if (peerId && !account.weeklyCallUsers.includes(peerId)) account.weeklyCallUsers.push(peerId);

        await account.save();
        const coins = await creditCoins(userId, billable * COINS_PER_MIN, 'call_minute',
            `Call · ${billable} min`, callId);

        // Weekly benchmark: 10 unique users
        let benchmarkCoins = 0;
        if (account.weeklyCallUsers.length >= 10) {
            const alreadyAwarded = await RewardTransaction.findOne({ userId, type: 'benchmark_weekly',
                ts: { $gte: weekStart } });
            if (!alreadyAwarded) {
                benchmarkCoins = await creditCoins(userId, 500, 'benchmark_weekly', 'Weekly benchmark: 10 users called');
                account.weeklyCallUsers = [];
                await account.save();
            }
        }
        res.json({ success: true, coins, benchmarkCoins });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/message ── first daily message ─────────────────────────
app.post('/api/rewards/message', async (req, res) => {
    try {
        const { userId } = req.body;
        const today = new Date().toDateString();
        const existing = await RewardTransaction.findOne({ userId, type: 'first_message',
            ts: { $gte: new Date(today) } });
        if (existing) return res.json({ success: true, coins: 0 });
        const coins = await creditCoins(userId, 5, 'first_message', 'First message of the day');
        res.json({ success: true, coins });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/wallet-send ── wallet payment sent ─────────────────────
app.post('/api/rewards/wallet-send', async (req, res) => {
    try {
        const { userId } = req.body;
        const coins = await creditCoins(userId, 10, 'wallet_send', 'Wallet payment sent');
        res.json({ success: true, coins });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/rewards/referral/:code ── resolve referral code ─────────────────
app.get('/api/rewards/referral/:code', async (req, res) => {
    try {
        const account = await RewardAccount.findOne({ referralCode: req.params.code });
        if (!account) return res.json({ success: false, message: 'Invalid referral code' });
        const user = await User.findOne({ xameId: account.userId }).select('preferredName firstName lastName profilePic');
        res.json({ success: true, userId: account.userId, user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/register-referral ── credit referrer on signup ──────────
app.post('/api/rewards/register-referral', async (req, res) => {
    try {
        const { newUserId, referralCode } = req.body;
        if (!referralCode) return res.json({ success: false });
        let referrerAccount = await RewardAccount.findOne({ referralCode });
        if (!referrerAccount) {
            // Fall back: look up by User model referralCode
            const referrerUser = await User.findOne({ referralCode });
            if (referrerUser) {
                referrerAccount = await RewardAccount.findOne({ userId: referrerUser.xameId });
            }
        }
        if (!referrerAccount) return res.json({ success: false });

        // Create new user reward account
        const code = newUserId + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        await RewardAccount.findOneAndUpdate({ userId: newUserId },
            { userId: newUserId, referralCode: code, referredBy: referrerAccount.userId },
            { upsert: true, new: true });

        // Credit referrer
        referrerAccount.activeReferrals += 1;
        referrerAccount.monthlyReferrals += 1;
        referrerAccount.tier = getTier(referrerAccount.activeReferrals);
        await referrerAccount.save();
        await creditCoins(referrerAccount.userId, 50, 'invite_register',
            `New user joined via your referral`, newUserId);

        // Monthly benchmark: 5 referrals
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
        if (referrerAccount.monthlyReferrals >= 5) {
            const alreadyAwarded = await RewardTransaction.findOne({ userId: referrerAccount.userId,
                type: 'benchmark_monthly', ts: { $gte: monthStart } });
            if (!alreadyAwarded) {
                await creditCoins(referrerAccount.userId, 1000, 'benchmark_monthly',
                    'Monthly benchmark: 5 referrals');
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/invite-active ── credit referrer when invite is 30-day active ──
app.post('/api/rewards/invite-active', async (req, res) => {
    try {
        const { userId } = req.body; // the new user who is now 30 days active
        const account = await RewardAccount.findOne({ userId });
        if (!account || !account.referredBy) return res.json({ success: false });
        const alreadyAwarded = await RewardTransaction.findOne({
            userId: account.referredBy, type: 'invite_active', referenceId: userId });
        if (alreadyAwarded) return res.json({ success: false });
        await creditCoins(account.referredBy, 200, 'invite_active',
            `Referral active for 30 days`, userId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/invite-first-call ── credit referrer on invite's first call ──
app.post('/api/rewards/invite-first-call', async (req, res) => {
    try {
        const { userId } = req.body;
        const account = await RewardAccount.findOne({ userId });
        if (!account || !account.referredBy) return res.json({ success: false });
        const alreadyAwarded = await RewardTransaction.findOne({
            userId: account.referredBy, type: 'invite_first_call', referenceId: userId });
        if (alreadyAwarded) return res.json({ success: false });
        await creditCoins(account.referredBy, 100, 'invite_first_call',
            `Referral made their first call`, userId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/rewards/withdraw ── withdraw coins to XamePay ──────────────────
app.post('/api/rewards/withdraw', async (req, res) => {
    try {
        const { userId, coins } = req.body;
        if (!userId || !coins) return res.json({ success: false, message: 'Missing fields' });
        if (coins < MIN_WITHDRAWAL) return res.json({ success: false,
            message: `Minimum withdrawal is ${MIN_WITHDRAWAL} coins` });
        const account = await RewardAccount.findOne({ userId });
        if (!account) return res.json({ success: false, message: 'Account not found' });
        if (account.coinBalance < coins) return res.json({ success: false, message: 'Insufficient coins' });
        const amount = Math.round(coins * COIN_RATE * 100) / 100;
        account.coinBalance    -= coins;
        account.totalWithdrawn += coins;
        await account.save();
        await RewardTransaction.create({ userId, type: 'withdrawal',
            coins: -coins, description: `Withdrawal · ₦${amount}` });
        await RewardWithdrawal.create({ userId, coins, amount, status: 'pending' });
        // Credit XamePay wallet
        await creditWallet(userId, amount, 'XameCoins withdrawal', '🪙', 'reward-' + Date.now());
        res.json({ success: true, amount, message: `₦${amount} credited to your XamePay wallet` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});




// ── GET /api/discover/:postId/viewers ────────────────────────────────────────
app.get('/api/discover/:postId/viewers', async (req, res) => {
    try {
        const post = await DiscoveryPost.findOne({ postId: req.params.postId }).lean();
        if (!post) return res.json({ success: false, message: 'Post not found' });
        const ids = post.viewedBy || [];
        const users = await User.find({ xameId: { $in: ids } })
            .select('xameId preferredName firstName lastName profilePic hideProfilePicture').lean();
        const list = ids.map(id => {
            const u = users.find(x => x.xameId === id);
            return {
                userId: id,
                name: u ? (u.preferredName || `${u.firstName} ${u.lastName}`.trim()) : id,
                avatar: u && !u.hideProfilePicture ? (u.profilePic || '') : '',
            };
        }).reverse(); // most recent first
        res.json({ success: true, viewers: list, totalViews: post.viewCount || 0 });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/discover/:postId/commenters ─────────────────────────────────────
app.get('/api/discover/:postId/commenters', async (req, res) => {
    try {
        const comments = await Comment.find({ postId: req.params.postId })
            .sort({ ts: -1 }).limit(100).lean();
        // Deduplicate by authorId, keep latest comment
        const seen = new Set();
        const list = comments.filter(c => {
            if (seen.has(c.authorId)) return false;
            seen.add(c.authorId);
            return true;
        }).map(c => ({
            userId:   c.authorId,
            name:     c.authorName,
            avatar:   c.authorAvatar || '',
            comment:  c.text,
            commentedAt: c.ts,
        }));
        res.json({ success: true, commenters: list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/discover/follow/:userId ────────────────────────────────────────
app.post('/api/discover/follow/:userId', async (req, res) => {
    try {
        const { followerId } = req.body;
        const followingId = req.params.userId;
        if (followerId === followingId) return res.json({ success: false });
        await Follow.findOneAndUpdate(
            { followerId, followingId },
            { followerId, followingId },
            { upsert: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/discover/unfollow/:userId ───────────────────────────────────────
app.post('/api/discover/unfollow/:userId', async (req, res) => {
    try {
        const { followerId } = req.body;
        const followingId = req.params.userId;
        await Follow.deleteOne({ followerId, followingId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/discover/follow-status/:userId ───────────────────────────────────
app.get('/api/discover/follow-status/:userId', async (req, res) => {
    try {
        const { followerId } = req.query;
        const followingId = req.params.userId;
        const isFollowing = await Follow.exists({ followerId, followingId });
        const followerCount = await Follow.countDocuments({ followingId });
        const mutualCount = await Follow.countDocuments({
            followerId, followingId: { $in: await Follow.distinct('followerId', { followingId: followerId }) }
        });
        res.json({ success: true, isFollowing: !!isFollowing, followerCount, mutualCount });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/discover/followers/:userId ───────────────────────────────────────
app.get('/api/discover/followers/:userId', async (req, res) => {
    try {
        const followerCount = await Follow.countDocuments({ followingId: req.params.userId });
        res.json({ success: true, followerCount });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/discover/followers-list/:userId ─────────────────────────────────
// Returns the actual list of people following this user
app.get('/api/discover/followers-list/:userId', async (req, res) => {
    try {
        const follows = await Follow.find({ followingId: req.params.userId }).sort({ ts: -1 }).limit(200).lean();
        const ids = follows.map(f => f.followerId);
        const users = await User.find({ xameId: { $in: ids } })
            .select('xameId preferredName firstName lastName profilePic hideProfilePicture').lean();
        const list = follows.map(f => {
            const u = users.find(x => x.xameId === f.followerId);
            return {
                userId: f.followerId,
                name: u ? (u.preferredName || `${u.firstName} ${u.lastName}`.trim()) : f.followerId,
                avatar: u && !u.hideProfilePicture ? (u.profilePic || '') : '',
                followedAt: f.ts,
            };
        });
        res.json({ success: true, followers: list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/discover/following-list/:userId ─────────────────────────────────
// Returns the actual list of people this user is following
app.get('/api/discover/following-list/:userId', async (req, res) => {
    try {
        const follows = await Follow.find({ followerId: req.params.userId }).sort({ ts: -1 }).limit(200).lean();
        const ids = follows.map(f => f.followingId);
        const users = await User.find({ xameId: { $in: ids } })
            .select('xameId preferredName firstName lastName profilePic hideProfilePicture').lean();
        const list = follows.map(f => {
            const u = users.find(x => x.xameId === f.followingId);
            return {
                userId: f.followingId,
                name: u ? (u.preferredName || `${u.firstName} ${u.lastName}`.trim()) : f.followingId,
                avatar: u && !u.hideProfilePicture ? (u.profilePic || '') : '',
                followedAt: f.ts,
            };
        });
        res.json({ success: true, following: list });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 8080;

createDirectories().then(() => {

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────
function verifyAdminSecret(req, res) {
    const secret = req.body.secret || req.headers['x-admin-secret'];
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

// Admin manual wallet credit/debit
app.post('/api/admin/wallet-credit', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { userId, amount, label, ref, type } = req.body;
    if (!userId || !amount) return res.json({ success: false, message: 'userId and amount required' });
    try {
        let wallet = await Wallet.findOne({ xameId: userId });
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });
        const isCredit = type !== 'debit';
        if (!isCredit && wallet.balance < amount)
            return res.json({ success: false, message: 'Insufficient balance' });
        wallet.balance = isCredit
            ? (wallet.balance || 0) + amount
            : (wallet.balance || 0) - amount;
        wallet.transactions = wallet.transactions || [];
        wallet.transactions.unshift({
            type:   isCredit ? 'credit' : 'debit',
            amount,
            label:  label || (isCredit ? 'Admin Credit' : 'Admin Debit'),
            icon:   isCredit ? '🏦' : '💸',
            ref:    ref || 'admin-' + Date.now(),
            ts:     new Date(),
        });
        await wallet.save();
        res.json({ success: true, balance: wallet.balance });
    } catch(err) { res.json({ success: false, message: err.message }); }
});

// Admin check wallet balance
app.get('/api/admin/wallet-balance/:userId', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    try {
        const wallet = await Wallet.findOne({ xameId: req.params.userId }).lean();
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });
        const user = await User.findOne({ xameId: req.params.userId })
            .select('firstName lastName preferredName profilePic').lean();
        res.json({
            success: true,
            balance: wallet.balance,
            currency: wallet.currency,
            userName: user ? (user.preferredName || `${user.firstName} ${user.lastName}`.trim()) : req.params.userId,
            userAvatar: user?.profilePic || '',
            virtualAccount: wallet.virtualAccount || null,
            transactions: (wallet.transactions || []).sort((a, b) => new Date(b.ts) - new Date(a.ts)),
        });
    } catch(err) { res.json({ success: false, message: err.message }); }
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
    const { version, buildNumber, changelog, forceUpdate } = req.body;
    if (!version || !buildNumber)
        return res.status(400).json({ success: false, message: 'version and buildNumber required.' });
    // downloadUrl is intentionally NOT taken from the client — it always points
    // to our own canonical download page, which auto-resolves the latest GitHub
    // APK release. A previous bug let the client send a self-referencing URL
    // here, breaking downloads for all users.
    const downloadUrl = 'https://app.xamepage.com/api/app/download';
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
        _appVersion = { version, buildNumber: parseInt(buildNumber), downloadUrl, changelog: changelog || '', forceUpdate: forceUpdate === true };
        await AppVersion.findOneAndUpdate({}, _appVersion, { upsert: true, new: true, sort: { updatedAt: -1 } });
        res.json({ success: true, message: `Update notification sent to ${sent} users. ${failed} failed.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/xamepage/announce', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    const { title, caption, mediaUrl, mediaType, downloadUrl, actionLabel, version, platform, ipaUrl } = req.body;
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
            platform:    platform    || 'both',
            ipaUrl:      ipaUrl      || '',
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
    const { version, buildNumber, downloadUrl, ipaUrl, forceUpdate, changelog } = req.body;
    if (!version || !buildNumber)
        return res.status(400).json({ success: false, message: 'version and buildNumber required.' });
    try {
        await AppVersion.deleteMany({});
        const finalDownloadUrl = downloadUrl || 'https://github.com/mcerimainterltd-ctrl/Project-50s-flutter/releases/latest';
        await AppVersion.create({
            version, buildNumber: parseInt(buildNumber),
            downloadUrl: finalDownloadUrl,
            ipaUrl:      ipaUrl || '',
            forceUpdate: forceUpdate === true || forceUpdate === 'true',
            changelog:   changelog || 'Latest improvements and bug fixes.',
            updatedAt:   new Date(),
        });

        // ── Broadcast update notice from XamePage Team to all users ──────
        let notified = 0;
        try {
            const TEAM_ID = '058000000001';
            const team = await User.findOne({ xameId: TEAM_ID });
            if (team) {
                const cleanDownloadUrl = 'https://app.xamepage.com/api/app/download';
                const updateText = `📲 New XamePage update available!\n\nVersion ${version} (build ${buildNumber}) is now live.\n\n${changelog || 'Bug fixes and performance improvements.'}`;
                const actionButton = { label: '⬇️ Download Update', url: cleanDownloadUrl };
                const allUsers = await User.find({ xameId: { $ne: TEAM_ID } }).select('xameId').lean();
                const bulkMessages = allUsers.map(u => ({
                    messageId:   'update-' + u.xameId + '-' + Date.now(),
                    senderId:    TEAM_ID,
                    recipientId: u.xameId,
                    ts:          Date.now(),
                    text:        updateText,
                    actionButton,
                }));
                if (bulkMessages.length > 0) {
                    await Message.insertMany(bulkMessages, { ordered: false });
                    notified = bulkMessages.length;
                    // Notify online users via socket
                    for (const u of allUsers) {
                        const sockId = findSocketId(u.xameId);
                        if (sockId) {
                            io.to(sockId).emit('receive-message', {
                                senderId: TEAM_ID,
                                message: { id: 'update-' + u.xameId, text: updateText, ts: Date.now(), actionButton },
                            });
                        }
                    }
                }
            }
        } catch (broadcastErr) {
            console.error('Update broadcast error:', broadcastErr.message);
        }

        res.json({ success: true, message: `Version set to ${version} (build ${buildNumber}). Notified ${notified} users.`, notified });
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


// Admin: view platform revenue summary
app.get('/api/admin/platform-revenue', async (req, res) => {
    if (!verifyAdminSecret(req, res)) return;
    try {
        const { from, to, userId, page = 1, limit = 50 } = req.query;
        const pageNum  = Math.max(1, parseInt(page));
        const pageSize = Math.min(200, Math.max(1, parseInt(limit)));
        const filter = {};
        if (from || to) {
            filter.ts = {};
            if (from) filter.ts.$gte = new Date(from);
            if (to)   filter.ts.$lte = new Date(to);
        }
        if (userId) filter.userId = userId;
        // Totals computed across ALL matching records, not just current page
        const allMatching = await PlatformRevenue.find(filter).lean();
        const totals = allMatching.reduce((acc, e) => {
            acc.totalAmount  += e.amount;
            acc.totalFlwFee  += e.flwFee;
            acc.totalUserFee += e.userFee;
            acc.totalMargin  += e.ourMargin;
            return acc;
        }, { totalAmount: 0, totalFlwFee: 0, totalUserFee: 0, totalMargin: 0 });
        const totalCount = allMatching.length;
        const totalPages  = Math.max(1, Math.ceil(totalCount / pageSize));
        const entries = await PlatformRevenue.find(filter)
            .sort({ ts: -1 })
            .skip((pageNum - 1) * pageSize)
            .limit(pageSize)
            .lean();
        res.json({
            success: true,
            count: entries.length,
            totalCount, totalPages, page: pageNum, pageSize,
            totals, entries,
        });
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

// ── Cloudinary signed upload ─────────────────────────────────────────────────
// ── Fix existing broken thumbnail URLs ───────────────────────────────────────
app.post('/api/admin/fix-thumbnails', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        const posts = await DiscoveryPost.find({ thumbnailUrl: /so_0,f_jpg/ }).lean();
        let fixed = 0;
        for (const post of posts) {
            const newThumb = post.thumbnailUrl.replace('so_0,f_jpg', 'so_0/f_jpg');
            await DiscoveryPost.updateOne({ _id: post._id }, { $set: { thumbnailUrl: newThumb } });
            fixed++;
        }
        res.json({ success: true, message: `Fixed ${fixed} thumbnails` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/cloudinary/sign', (req, res) => {
    const folder    = req.query.folder || 'xamepage_chat';
    const timestamp = Math.round(Date.now() / 1000);
    try {
        const signature = cloudinary.utils.api_sign_request(
            { timestamp, folder },
            process.env.CLOUDINARY_API_SECRET
        );
        res.json({
            signature, timestamp, folder,
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key:    process.env.CLOUDINARY_API_KEY,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/discover/reporter/apply ─────────────────────────────────────────
app.post('/api/discover/reporter/apply', async (req, res) => {
    try {
        const { userId, name, country } = req.body;
        const postCount     = await DiscoveryPost.countDocuments({ authorId: userId });
        const followerCount = await Follow.countDocuments({ followingId: userId });
        if (postCount < 100) return res.json({ success: false, message: `You need at least 100 posts. You have ${postCount}.` });
        if (followerCount < 200) return res.json({ success: false, message: `You need at least 200 followers. You have ${followerCount}.` });
        const existing = await Reporter.findOne({ userId });
        if (existing) return res.json({ success: false, message: 'Application already submitted.', status: existing.status });
        await Reporter.create({ userId, name, country, postCount, followerCount });
        res.json({ success: true, message: 'Application submitted! XamePage Admin will review it.' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/discover/reporter/status/:userId ─────────────────────────────────
app.get('/api/discover/reporter/status/:userId', async (req, res) => {
    try {
        const reporter = await Reporter.findOne({ userId: req.params.userId });
        if (!reporter) return res.json({ success: true, status: 'none' });
        res.json({ success: true, status: reporter.status, certificateUrl: reporter.certificateUrl });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/admin/reporter/approve/:userId ──────────────────────────────────
app.post('/api/admin/reporter/approve/:userId', basicAuth, async (req, res) => {
    try {
        const reporter = await Reporter.findOne({ userId: req.params.userId });
        if (!reporter) return res.status(404).json({ success: false });
        reporter.status     = 'approved';
        reporter.approvedAt = new Date();
        await reporter.save();
        res.json({ success: true, message: `${reporter.name} approved as XamePage Reporter.` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/admin/reporters ──────────────────────────────────────────────────
app.get('/api/admin/reporters', basicAuth, async (req, res) => {
    try {
        const reporters = await Reporter.find().sort({ appliedAt: -1 });
        res.json({ success: true, reporters });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Monthly Creator Payout (call via cron or admin) ───────────────────────────
app.post('/api/admin/creator-payout', basicAuth, async (req, res) => {
    try {
        const users = await User.find({});
        let credited = 0;
        for (const user of users) {
            const account = await RewardAccount.findOne({ userId: user.xameId });
            if (!account) continue;
            const followerCount = await Follow.countDocuments({ followingId: user.xameId });
            const mutualCount   = await Follow.countDocuments({
                followerId: user.xameId,
                followingId: { $in: await Follow.distinct('followerId', { followingId: user.xameId }) }
            });
            if (mutualCount < 100) continue;

            // Base payout by tier
            const tier = account.tier || 'bronze';
            const tierPayout = { bronze: 500, silver: 1500, gold: 5000, diamond: 15000 };
            let payout = tierPayout[tier] || 500;

            // Reporter bonus
            const reporter = await Reporter.findOne({ userId: user.xameId, status: 'approved' });
            if (reporter) payout = Math.round(payout * 1.5);

            // Credit to wallet
            await Wallet.findOneAndUpdate(
                { userId: user.xameId },
                {
                    $inc: { balance: payout },
                    $push: { transactions: {
                        id:     'creator_' + user.xameId + '_' + Date.now(),
                        label:  'Creator payout — ' + tier + ' tier' + (reporter ? ' + Reporter bonus' : ''),
                        icon:   '🎙️',
                        amount: payout,
                        type:   'credit',
                        status: 'Completed',
                        ref:    'creator_payout',
                        ts:     new Date(),
                    }},
                    $set: { updatedAt: new Date() }
                },
                { upsert: true }
            );
            credited++;
        }
        res.json({ success: true, message: `Payout completed. ${credited} creators credited.` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});



// ── Manual wallet credit (admin) ─────────────────────────────────────────────
app.post('/api/admin/credit-wallet', async (req, res) => {
    try {
        const { userId, amount, label, icon } = req.body;
        if (!userId || !amount) return res.json({ success: false, message: 'Missing fields' });
        const wallet = await creditWallet(userId, amount, label || 'Manual credit', icon || '💰', 'manual-' + Date.now());
        res.json({ success: true, balance: wallet.balance });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Fix Virtual Account Names ────────────────────────────────────────────────
app.post('/api/admin/fix-virtual-account-names', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const users = await User.find({}).lean();
        let fixed = 0;
        for (const user of users) {
            const name = `${user.firstName} ${user.lastName}`.trim() || user.xameId;
            const accountName = `XamePay|${name}`;
            await Wallet.findOneAndUpdate(
                { xameId: user.xameId },
                { $set: { 'virtualAccount.accountName': accountName } }
            );
            fixed++;
        }
        res.json({ success: true, message: `Fixed ${fixed} accounts` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Delete single user virtual account (for testing) ───────────────────────
app.post('/api/admin/delete-virtual-account-single', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    try {
        await Wallet.updateOne({ xameId: userId }, { $set: {
            'virtualAccount.accountNumber': '',
            'virtualAccount.bankName':      '',
            'virtualAccount.accountName':   '',
            'virtualAccount.provider':      '',
        }});
        await User.updateOne({ xameId: userId }, { $set: {
            'virtualAccount.accountNumber': '',
            'virtualAccount.bankName':      '',
            'virtualAccount.accountName':   '',
        }});
        res.json({ success: true, message: `Virtual account cleared for ${userId}` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Delete virtual accounts (force re-setup) ────────────────────────────────
app.post('/api/admin/delete-virtual-accounts', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const result = await Wallet.updateMany(
            { 'virtualAccount.accountNumber': { $exists: true, $ne: '' } },
            { $set: {
                'virtualAccount.accountNumber': '',
                'virtualAccount.bankName':      '',
                'virtualAccount.accountName':   '',
                'virtualAccount.provider':      '',
            }}
        );
        await User.updateMany(
            { 'virtualAccount.accountNumber': { $exists: true, $ne: '' } },
            { $set: {
                'virtualAccount.accountNumber': '',
                'virtualAccount.bankName':      '',
                'virtualAccount.accountName':   '',
            }}
        );
        res.json({ success: true, message: `Cleared ${result.modifiedCount} virtual accounts` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Recreate virtual accounts with correct names ─────────────────────────────
app.post('/api/admin/recreate-virtual-accounts', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    const flwSecret = process.env.FLW_SECRET_KEY;
    if (!flwSecret) return res.json({ success: false, message: 'FLW_SECRET_KEY not set' });
    try {
        const users = await User.find({}).lean();
        let recreated = 0, failed = 0, skipped = 0;
        for (const user of users) {
            const realName = `${user.firstName} ${user.lastName}`.trim();
            const accountName = `XamePay|${realName}`;
            if (!user.bvnPlain) { skipped++; continue; }
            try {
                const r = await fetch('https://api.flutterwave.com/v3/virtual-account-numbers', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${flwSecret}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: user.xameId + '@xamepage.app',
                        is_permanent: true,
                        bvn: user.bvnPlain || '',
                        tx_ref: 'xamepay-va-' + user.xameId + '-' + Date.now(),
                        amount: 0,
                        currency: 'NGN',
                        narration: accountName,
                        account_name: accountName,
                    })
                });
                const data = await r.json();
                if (data.status === 'success') {
                    await User.findOneAndUpdate({ xameId: user.xameId }, {
                        'virtualAccount.accountNumber': data.data.account_number,
                        'virtualAccount.bankName':      data.data.bank_name,
                        'virtualAccount.accountName':   accountName,
                    });
                    await Wallet.findOneAndUpdate({ xameId: user.xameId }, {
                        'virtualAccount.accountNumber': data.data.account_number,
                        'virtualAccount.bankName':      data.data.bank_name,
                        'virtualAccount.accountName':   accountName,
                        'virtualAccount.provider':      'flutterwave',
                    }, { upsert: true });
                    recreated++;
                } else {
                    console.warn('VA recreate failed for', user.xameId, data.message);
                    failed++;
                }
            } catch (e) {
                console.error('VA recreate error for', user.xameId, e.message);
                failed++;
            }
            // Rate limit — Flutterwave allows ~10 req/sec
            await new Promise(r => setTimeout(r, 150));
        }
        res.json({ success: true, recreated, failed, skipped, total: users.length });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Create XamePage Team account (one-time setup) ────────────────────────────
app.post('/api/admin/create-xamepage-team', async (req, res) => {
    const { secret } = req.body;
    if (secret !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const TEAM_ID = '058000000001';
        const existing = await User.findOne({ xameId: TEAM_ID });
        if (existing) return res.json({ success: true, message: 'XamePage Team account already exists', xameId: TEAM_ID });
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('XamePageTeamInternal' + Date.now(), 10);
        const referralCode = TEAM_ID.replace('@', '').toUpperCase() + 'TEAM';
        const team = await new User({
            xameId: TEAM_ID,
            firstName: 'XamePage',
            lastName: 'Team',
            dob: '2024-01-01',
            password: hashedPassword,
            referralCode,
            preferredName: 'XamePage Team',
        }).save();
        res.json({ success: true, message: 'XamePage Team account created', xameId: team.xameId });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Recall last broadcast (delete recent update-* messages) ──────────────────
app.post('/api/admin/recall-broadcast', async (req, res) => {
    const { secret, minutesAgo } = req.body;
    if (secret !== process.env.ADMIN_SECRET)
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    try {
        const cutoff = Date.now() - ((minutesAgo || 30) * 60 * 1000);
        const result = await Message.deleteMany({
            senderId: '058000000001',
            messageId: { $regex: '^update-' },
            ts: { $gte: cutoff },
        });
        res.json({ success: true, message: `Deleted ${result.deletedCount} broadcast messages from the last ${minutesAgo || 30} minutes.`, deleted: result.deletedCount });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── END ADMIN ENDPOINTS ───────────────────────────────────────────────────────

// ── Referral landing page ─────────────────────────────────────────────────────
app.get('/join/:code', async (req, res) => {
    try {
        const account = await RewardAccount.findOne({ referralCode: req.params.code });
        if (!account) return res.redirect('/');
        const user = await User.findOne({ xameId: account.userId })
            .select('preferredName firstName lastName profilePic');
        const name = user?.preferredName || `${user?.firstName} ${user?.lastName}`.trim() || account.userId;
        const pic  = user?.profilePic || '';
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${name} invited you to XamePage</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#07101C;color:#EDF3F8;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#0F1E2E;border:1px solid rgba(255,255,255,0.06);border-radius:24px;padding:40px 32px;max-width:400px;width:100%;text-align:center}
.avatar{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #00B0A0;margin:0 auto 16px}
.avatar-placeholder{width:80px;height:80px;border-radius:50%;background:#00B0A0;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;margin:0 auto 16px}
h1{font-size:22px;font-weight:800;margin-bottom:8px}
p{color:#8AAFC8;font-size:15px;margin-bottom:32px;line-height:1.6}
.btn{display:block;background:#00B0A0;color:#fff;text-decoration:none;padding:16px 32px;border-radius:14px;font-size:16px;font-weight:700;margin-bottom:12px}
.btn-ghost{display:block;background:rgba(255,255,255,0.06);color:#EDF3F8;text-decoration:none;padding:14px 32px;border-radius:14px;font-size:15px}
.logo{font-size:13px;color:#4A6E88;margin-top:24px}
</style>
</head>
<body>
<div class="card">
${pic ? `<img src="${pic}" class="avatar" alt="${name}">` : `<div class="avatar-placeholder">${name[0]?.toUpperCase()}</div>`}
<h1>${name} invited you!</h1>
<p>Join XamePage — the ultramodern messaging, calling and payments app. Sign up and start earning XameCoins together.</p>
<a href="https://app.xamepage.com/api/app/download?ref=${req.params.code}" class="btn">📲 Download XamePage</a>
<a href="https://xamepage.com" class="btn-ghost">Learn More</a>
<div class="logo">XamePage by McErima Interltd</div>
</div>
</body>
</html>`);
    } catch (err) { res.redirect('/'); }
});

// ── POST /api/change-password ────────────────────────────────────────────────
app.post('/api/change-password', async (req, res) => {
    try {
        const { xameId, currentPassword, newPassword } = req.body;
        if (!xameId || !currentPassword || !newPassword) {
            return res.json({ success: false, message: 'All fields are required' });
        }
        const user = await User.findOne({ xameId });
        if (!user) return res.json({ success: false, message: 'User not found' });

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.json({ success: false, message: 'Current password is incorrect' });

        if (newPassword.length < 6) {
            return res.json({ success: false, message: 'New password must be at least 6 characters' });
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ xameId }, { password: hashed });
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Official Account Endpoints ───────────────────────────────────────────────
const OFFICIAL_ID = '058000000001';

app.get('/api/admin/official-account', async (req, res) => {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) return res.json({ success: false, message: 'Unauthorized' });
    try {
        const user = await User.findOne({ xameId: OFFICIAL_ID }).lean();
        if (!user) return res.json({ success: false, message: 'Official account not found' });
        res.json({ success: true, ...user });
    } catch (err) { res.json({ success: false, message: err.message }); }
});

app.post('/api/admin/official-account/pic', memoryUpload.single('file'), async (req, res) => {
    const secret = req.body.secret || req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) return res.json({ success: false, message: 'Unauthorized' });
    try {
        if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
        const profilePic = await uploadToImageKit(req.file.buffer, 'official_avatar.jpg', 'official');
        if (!profilePic) return res.json({ success: false, message: 'ImageKit upload failed' });
        await User.findOneAndUpdate({ xameId: OFFICIAL_ID }, { profilePic });
        res.json({ success: true, profilePic });
    } catch (err) { res.json({ success: false, message: err.message }); }
});

app.get('/api/admin/official-account/recent-broadcasts', async (req, res) => {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) return res.json({ success: false, message: 'Unauthorized' });
    try {
        // Get distinct broadcasts — one record per unique messageId
        const messages = await Message.aggregate([
            { $match: { senderId: OFFICIAL_ID, isBroadcast: true } },
            { $sort: { ts: -1 } },
            { $group: { _id: '$text', messageId: { $first: '$messageId' }, text: { $first: '$text' }, ts: { $first: '$ts' } } },
            { $sort: { ts: -1 } },
            { $limit: 10 }
        ]);
        res.json({ success: true, messages });
    } catch (err) { res.json({ success: false, message: err.message }); }
});

app.post('/api/admin/official-account/delete-message', async (req, res) => {
    const secret = req.body.secret || req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) return res.json({ success: false, message: 'Unauthorized' });
    const { messageId } = req.body;
    if (!messageId) return res.json({ success: false, message: 'messageId required' });
    try {
        // Find the text of this message to delete all copies sent to all users
        const sample = await Message.findOne({ messageId }).lean();
        let result;
        if (sample?.text) {
            result = await Message.deleteMany({ senderId: OFFICIAL_ID, text: sample.text });
        } else {
            result = await Message.deleteMany({ messageId });
        }
        // Notify all online users to delete this message
        io.emit('messages-deleted', { deleterId: OFFICIAL_ID, contactId: OFFICIAL_ID, messageIds: [messageId], permanently: true });
        res.json({ success: true, deleted: result.deletedCount });
    } catch (err) { res.json({ success: false, message: err.message }); }
});

app.post('/api/admin/official-account/broadcast', async (req, res) => {
    const secret = req.body.secret || req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) return res.json({ success: false, message: 'Unauthorized' });
    const { message, mediaUrl } = req.body;
    if (!message) return res.json({ success: false, message: 'Message required' });
    try {
        const users = await User.find({ xameId: { $ne: OFFICIAL_ID } }, { xameId: 1 }).lean();
        let sent = 0;
        const { v4: uuidv4b } = require('uuid');
        for (const user of users) {
            try {
                const msgId = uuidv4b();
                const ts = Date.now();
                const msgObj = {
                    id:       msgId,
                    senderId: OFFICIAL_ID,
                    text:     message,
                    ts,
                    status:   'delivered',
                    ...(mediaUrl && { fileUrl: mediaUrl, fileMime: 'image/jpeg' }),
                };
                // Save to DB
                await new Message({
                    messageId:   msgId,
                    senderId:    OFFICIAL_ID,
                    recipientId: user.xameId,
                    ts,
                    text: message,
                    isBroadcast: true,
                    ...(mediaUrl && { file: { url: mediaUrl, mime: 'image/jpeg', name: 'media' } }),
                }).save();
                // Notify if online
                const socketId = findSocketId(user.xameId);
                if (socketId) {
                    io.to(socketId).emit('receive-message', { senderId: OFFICIAL_ID, message: msgObj });
                    io.to(socketId).emit('new_message_count', { senderId: OFFICIAL_ID });
                }
                sent++;
            } catch(_) {}
        }
        res.json({ success: true, sent });
    } catch (err) { res.json({ success: false, message: err.message }); }
});

    // Catch-all MUST be last — after every other route is registered,
    // otherwise routes defined below this point would never be reached.
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ success: false, message: 'API endpoint not found' });
        }
        res.sendFile(path.join(BASE_DIR, 'index.html'));
    });

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
// imagekit-1784893344


// Phase 1: Web SSR Landing Page for Spaces
app.get('/space/:slug', async (req, res) => {
    const slug = req.params.slug;
    const Space = require('./models/Space');
    const SpaceMessage = require('./models/SpaceMessage');
    try {
        const space = await Space.findOne({ spaceSlug: slug }).lean();
        const name = space?.name || slug;
        const archetype = space?.archetype || 'community';
        const description = space?.description || '';
        const memberCount = space?.stats?.memberCount || 0;
        const avatar = space?.avatar || '';
        const archetypeEmoji = { family:'👨‍👩‍👧‍👦', school:'🎓', business:'💼', community:'🌍', project:'🚀', event:'🎉' }[archetype] || '🌍';
        const messages = space ? await SpaceMessage.find({ spaceSlug: slug, deleted: false }).sort({ createdAt: 1 }).limit(50).lean() : [];
        const msgsJson = JSON.stringify(messages);

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} · XamePage Space</title>
<meta name="description" content="${description || `Join ${name} on XamePage`}">
<meta property="og:title" content="${name} · XamePage Space">
<meta property="og:description" content="${description || `Join ${name} — ${memberCount} members`}">
${avatar ? `<meta property="og:image" content="${avatar}">` : ''}
<link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#07101C;--surface:#0F1E2E;--card:#1A2A3A;--primary:#00B0A0;--text:#EDF3F8;--muted:#4A6E88;--border:rgba(255,255,255,0.06)}
body{background:var(--bg);color:var(--text);font-family:'Cabinet Grotesk',sans-serif;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.avatar{width:40px;height:40px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.hinfo{flex:1;min-width:0}
.hname{font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hmeta{font-size:12px;color:var(--muted)}
.download-btn{background:var(--primary);color:#000;border:none;padding:8px 14px;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}
.banner{background:linear-gradient(135deg,rgba(0,176,160,0.15),rgba(0,176,160,0.05));border-bottom:1px solid rgba(0,176,160,0.2);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0}
.banner-text{font-size:13px;color:var(--primary)}
.messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{display:flex;gap:8px;align-items:flex-end}
.msg.mine{flex-direction:row-reverse}
.msg-avatar{width:28px;height:28px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#000;flex-shrink:0}
.bubble{max-width:72%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.4}
.msg:not(.mine) .bubble{background:var(--card);border-bottom-left-radius:4px}
.msg.mine .bubble{background:var(--primary);color:#000;border-bottom-right-radius:4px}
.sender-name{font-size:11px;color:var(--muted);margin-bottom:3px;font-weight:700}
.msg-time{font-size:10px;opacity:0.5;margin-top:3px}
.guest-badge{font-size:10px;background:rgba(255,165,0,0.2);color:orange;padding:1px 5px;border-radius:4px;margin-left:4px}
.composer{background:var(--surface);border-top:1px solid var(--border);padding:12px 16px;display:flex;gap:10px;align-items:flex-end;flex-shrink:0}
.composer input{flex:1;background:var(--card);border:none;border-radius:20px;padding:10px 16px;color:var(--text);font-size:14px;outline:none;font-family:inherit}
.composer input::placeholder{color:var(--muted)}
.send-btn{width:40px;height:40px;background:var(--primary);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.send-btn svg{fill:#000}
.empty{text-align:center;padding:40px 20px;color:var(--muted)}
.join-modal{position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal-card{background:var(--surface);border-radius:20px;padding:28px;max-width:340px;width:100%;border:1px solid var(--border)}
.modal-title{font-size:20px;font-weight:800;margin-bottom:8px}
.modal-sub{font-size:13px;color:var(--muted);margin-bottom:20px}
.modal-input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;color:var(--text);font-size:14px;font-family:inherit;outline:none;margin-bottom:12px}
.modal-btn{width:100%;background:var(--primary);color:#000;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:8px}
.modal-skip{width:100%;background:transparent;color:var(--muted);border:none;padding:10px;font-size:13px;cursor:pointer}
</style>
</head>
<body>
<header>
  <div class="avatar">${avatar ? `<img src="${avatar}" alt="${name}">` : archetypeEmoji}</div>
  <div class="hinfo">
    <div class="hname">${name}</div>
    <div class="hmeta">${memberCount} members · ${archetype}</div>
  </div>
  <a class="download-btn" href="https://app.xamepage.com/api/app/download">Get App</a>
</header>
<div class="banner">
  <span class="banner-text">📱 Better experience in the app</span>
  <a class="download-btn" href="xamepage://spaces/${slug}">Open in App</a>
</div>
<div class="messages" id="messages">
  ${messages.length === 0 ? '<div class="empty">No messages yet. Be the first to say hello! 👋</div>' : ''}
</div>
${space?.accessControl?.allowGuestPosting !== false ? `
<div class="composer">
  <input type="text" id="msgInput" placeholder="Message ${name}..." maxlength="500">
  <button class="send-btn" onclick="sendMsg()">
    <svg width="18" height="18" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
  </button>
</div>` : `<div style="text-align:center;padding:12px;color:var(--muted);font-size:13px">Guest posting is disabled for this Space</div>`}

<div class="join-modal" id="joinModal">
  <div class="modal-card">
    <div style="font-size:36px;text-align:center;margin-bottom:12px">${archetypeEmoji}</div>
    <div class="modal-title">Join ${name}</div>
    <div class="modal-sub">Enter a display name to participate in this Space</div>
    <input class="modal-input" id="nameInput" placeholder="Your display name" maxlength="30" autocomplete="off">
    <button class="modal-btn" onclick="joinSpace()">Join Space</button>
    <button class="modal-skip" onclick="browseOnly()">Just browse</button>
  </div>
</div>

<script>
const slug = '${slug}';
const API  = '/api/v3/spaces';
let guestToken = '', displayName = '', guestId = '';

const msgs = ${msgsJson};

function renderMessages() {
  const el = document.getElementById('messages');
  if (!msgs.length) return;
  el.innerHTML = msgs.map(m => {
    const isMine = m.senderId === guestId;
    const initial = (m.senderName || 'G')[0].toUpperCase();
    const time = new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    return \`<div class="msg \${isMine ? 'mine' : ''}">
      \${!isMine ? \`<div class="msg-avatar">\${initial}</div>\` : ''}
      <div>
        \${!isMine ? \`<div class="sender-name">\${m.senderName || 'Guest'}\${m.isGuest ? '<span class="guest-badge">guest</span>':''}</div>\` : ''}
        <div class="bubble">\${m.text}</div>
        <div class="msg-time">\${time}</div>
      </div>
    </div>\`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function joinSpace() {
  displayName = document.getElementById('nameInput').value.trim();
  if (!displayName) return;
  document.getElementById('joinModal').style.display = 'none';
  await fetch(\`\${API}/\${slug}/join\`, {
    method: 'POST',
    headers: {'Content-Type':'application/json', ...(guestToken ? {Authorization:'Bearer '+guestToken} : {})},
    body: JSON.stringify({displayName})
  });
}

function browseOnly() {
  displayName = 'Guest';
  document.getElementById('joinModal').style.display = 'none';
}

async function sendMsg() {
  const text = document.getElementById('msgInput').value.trim();
  if (!text || !displayName) return;
  document.getElementById('msgInput').value = '';
  const r = await fetch(\`\${API}/\${slug}/messages\`, {
    method: 'POST',
    headers: {'Content-Type':'application/json', ...(guestToken ? {Authorization:'Bearer '+guestToken} : {})},
    body: JSON.stringify({text, displayName})
  });
  const d = await r.json();
  if (d.success) {
    msgs.push(d.message);
    renderMessages();
  }
}

document.getElementById('msgInput')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

async function init() {
  const r = await fetch(\`\${API}/\${slug}\`);
  const d = await r.json();
  if (d.guestToken) { guestToken = d.guestToken; guestId = JSON.parse(atob(d.guestToken.split('.')[1])).sub; }
  renderMessages();
}
init();
</script>
</body>
</html>`);
    } catch(err) {
        res.status(500).send('Server error');
    }
})


// ═══════════════════════════════════════════════════════════════════
// WEB INTERACTION LAYER — message, call request, payment from browser
// ═══════════════════════════════════════════════════════════════════

// POST /api/web/message — deliver a web message to a XamePage user's inbox
app.post('/api/web/message', async (req, res) => {
  try {
    const { toXameId, fromName, text } = req.body;
    if (!toXameId || !fromName?.trim() || !text?.trim())
      return res.json({ success: false, message: 'Missing fields.' });

    const recipient = await User.findOne({ xameId: toXameId }).lean();
    if (!recipient) return res.json({ success: false, message: 'User not found.' });

    const guestId  = 'web_' + toXameId + '_' + Date.now();
    const msgId    = require('uuid').v4();
    const msgObj   = {
      messageId:   msgId,
      senderId:    guestId,
      recipientId: toXameId,
      text:        `[Web message from ${fromName.trim()}]: ${text.trim()}`,
      ts:          new Date(),
      status:      'delivered',
    };

    // Save to DB
    await new Message(msgObj).save();

    // Deliver via socket if online
    const recipSocketId = findSocketId(toXameId);
    if (recipSocketId) {
      io.to(recipSocketId).emit('receive-message', {
        id:          msgId,
        senderId:    guestId,
        recipientId: toXameId,
        text:        msgObj.text,
        ts:          msgObj.ts,
        status:      'delivered',
        type:        'text',
      });
    }

    // FCM push if offline
    if (recipient.fcmToken && admin.apps.length) {
      await admin.messaging().send({
        token: recipient.fcmToken,
        android: { priority: 'high' },
        notification: {
          title: `Web message from ${fromName.trim()}`,
          body: text.trim(),
        },
        data: { type: 'web_message', fromName: fromName.trim() },
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/web/call-request — notify XamePage user of a web call request
app.post('/api/web/call-request', async (req, res) => {
  try {
    const { toXameId, fromName } = req.body;
    if (!toXameId || !fromName?.trim())
      return res.json({ success: false, message: 'Missing fields.' });

    const recipient = await User.findOne({ xameId: toXameId }).lean();
    if (!recipient) return res.json({ success: false, message: 'User not found.' });

    // Notify via socket if online
    const recipSocketId = findSocketId(toXameId);
    if (recipSocketId) {
      io.to(recipSocketId).emit('web_call_request', {
        fromName: fromName.trim(),
        callUrl:  `https://app.xamepage.com/web-call/${toXameId}`,
      });
    }

    // FCM push
    if (recipient.fcmToken && admin.apps.length) {
      await admin.messaging().send({
        token: recipient.fcmToken,
        android: { priority: 'high' },
        notification: {
          title: `Web call from ${fromName.trim()}`,
          body:  `${fromName.trim()} wants to call you on XamePage`,
        },
        data: { type: 'web_call', fromName: fromName.trim(), toXameId },
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
