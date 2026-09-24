const FAQ = require("../models/faqSchema");

// Create FAQ
exports.createFAQ = async (req, res) => {
  try {
    const { faq_title, faq_body, language, faq_status } = req.body;
    const newFAQ = new FAQ({ faq_title, faq_body, language, faq_status, organization_code: req.user.org_code });
    const savedFAQ = await newFAQ.save();
    res.status(201).json(savedFAQ);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get All FAQs (supports ?lang=en)
exports.getAllFAQs = async (req, res) => {
  try {
    const { lang } = req.query;

    let filter = { organization_code: req.organizationCode, faq_status: 'visible' };

    if (lang) {
      filter.language = lang;
    }

    // Optionally filter only visible FAQs
    // filter.faq_status = "visible";

    const faqs = await FAQ.find(filter);

    res.status(200).json({
      success: true,
      count: faqs.length,
      language: lang || "all",
      data: faqs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get Single FAQ by ID
exports.getFAQById = async (req, res) => {
  try {
    const faq = await FAQ.findOne({ _id: req.params.id, organization_code: req.organizationCode, faq_status: 'visible' });
    if (!faq) return res.status(404).json({ error: "FAQ not found" });
    res.status(200).json(faq);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update FAQ
exports.updateFAQ = async (req, res) => {
  try {
    const { faq_title, faq_body, language, faq_status } = req.body;
    const updatedFAQ = await FAQ.findOneAndUpdate(
      { _id: req.params.id, organization_code: req.user.org_code },
      { faq_title, faq_body, language, faq_status },
      { new: true, runValidators: true }
    );
    if (!updatedFAQ) return res.status(404).json({ error: "FAQ not found" });
    res.status(200).json(updatedFAQ);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete FAQ
exports.deleteFAQ = async (req, res) => {
  try {
    const deletedFAQ = await FAQ.findOneAndDelete({ _id: req.params.id, organization_code: req.user.org_code });
    if (!deletedFAQ) return res.status(404).json({ error: "FAQ not found" });
    res.status(200).json({ message: "FAQ deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
