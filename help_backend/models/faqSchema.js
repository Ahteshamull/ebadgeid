const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema({
    organization_code: { type: String, index: true },
    faq_title: {type:String, required: true, maxlength: 300},
    faq_body: {type:String, required: true, maxlength: 10000},
    language: {type:String, required: false, enum: ['en', 'es', 'fr', 'de', 'it'], default: 'en'},
    faq_status: {type:String, required: true, enum: ['visible', 'hidden'], default: 'visible'}
}, { timestamps: true });

module.exports = mongoose.model("FAQ", faqSchema);
