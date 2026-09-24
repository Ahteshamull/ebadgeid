const Article = require('../models/articleSchema'); // Should be renamed to Articles.js for clarity

const managedMarkdownUrl = value => {
  try {
    const candidate = new URL(value);
    const allowedOrigin = new URL(process.env.PUBLIC_STORAGE_BASE_URL).origin;
    return candidate.origin === allowedOrigin && /^\/uploads\/[a-f0-9]{24}\.md$/i.test(candidate.pathname);
  } catch {
    return false;
  }
};

// Create an article
exports.createArticle = async (req, res) => {
  try {
    const { article_code, article_title, article_category, author } = req.body;
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(String(article_code || ''))) {
      return res.status(400).json({ message: 'Article code must contain only letters, numbers, dashes, or underscores' });
    }
    const newArticle = new Article({
      article_code, article_title, article_category, author,
      organization_code: req.user.org_code,
      published: false,
    });
    const saved = await newArticle.save();
    res.status(201).json(saved);
  } catch (error) {
    // Was `{ message: '...', error }` -- Error's own message/stack are
    // non-enumerable so a plain Error serializes to `{}` here, but a
    // Mongoose ValidationError has enumerable `errors`/`name`/`message`
    // properties that DO serialize, leaking internal field paths and
    // validator class names to the client (confirmed by hand: a missing
    // required field produced a JSON body naming every failing path).
    // Logged server-side instead; the client gets a message, not the
    // object.
    console.error('Error creating article:', error);
    res.status(500).json({ message: 'Error creating article' });
  }
};

// Get all articles
exports.getAllArticles = async (req, res) => {
  try {
    const articles = await Article.find({ organization_code: req.organizationCode, published: true }).sort({ createdAt: -1 });
    res.status(200).json(articles);
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ message: 'Error fetching articles' });
  }
};

// Get a single article by code
exports.getArticleByCode = async (req, res) => {
  try {
    const article = await Article.findOne({
      article_code: req.params.code,
      organization_code: req.organizationCode,
      published: true,
    });
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.status(200).json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ message: 'Error fetching article' });
  }
};

exports.getManagedArticles = async (req, res) => {
  try {
    const articles = await Article.find({ organization_code: req.user.org_code }).sort({ createdAt: -1 }).lean();
    return res.status(200).json(articles);
  } catch {
    return res.status(500).json({ message: 'Error fetching managed articles' });
  }
};

// Update an article by code
exports.updateArticle = async (req, res) => {
  try {
    if (req.body.article_content && !managedMarkdownUrl(req.body.article_content)) {
      return res.status(400).json({ message: 'Article content must be a managed markdown upload' });
    }
    const fields = Object.fromEntries(Object.entries(req.body).filter(([key]) => ['article_title', 'article_category', 'article_content', 'author'].includes(key)));
    if (fields.article_content) fields.published = true;
    const updated = await Article.findOneAndUpdate(
      { article_code: req.params.code, organization_code: req.user.org_code },
      fields,
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Article not found' });
    res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating article:', error);
    res.status(500).json({ message: 'Error updating article' });
  }
};

// Delete an article by code
exports.deleteArticle = async (req, res) => {
  try {
    const deleted = await Article.findOneAndDelete({ article_code: req.params.code, organization_code: req.user.org_code });
    if (!deleted) return res.status(404).json({ message: 'Article not found' });
    res.status(200).json({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ message: 'Error deleting article' });
  }
};
