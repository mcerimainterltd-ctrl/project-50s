const mongoose = require('mongoose');

const SpaceMessageSchema = new mongoose.Schema({
    spaceSlug: { type: String, required: true, index: true },
    senderXameId: { type: String, required: true },
    senderName: { type: String, default: 'Guest' },
    isGuest: { type: Boolean, default: false },
    text: { type: String, required: true },
    attachments: [{
        type: { type: String, enum: ['file', 'image', 'call_link', 'payment'] },
        url: String,
        name: String
    }]
}, { timestamps: true });

module.exports = mongoose.model('SpaceMessage', SpaceMessageSchema);
