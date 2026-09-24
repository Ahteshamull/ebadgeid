const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema({
    organization_code: { type: String, index: true },
    article_code: { type: String, required: true, maxlength: 100 },
    article_title: { type: String, required: true, maxlength: 300 },
    article_category: { type: String, required: true, maxlength: 100 },
    article_content: { type: String, default: '', maxlength: 2048 },
    published: { type: Boolean, default: false, index: true },
    author: { type: String, required: true, maxlength: 200 },
}, { timestamps: true });

articleSchema.index({ organization_code: 1, article_code: 1 }, { unique: true });

module.exports = mongoose.model("Articles", articleSchema);
