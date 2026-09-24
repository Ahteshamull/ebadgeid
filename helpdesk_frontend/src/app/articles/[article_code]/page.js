// Alternative approach - using markdown-it which is more reliable
// Install: npm install markdown-it highlight.js

"use client"
import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Head from 'next/head';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { API_BASE_URL, ORGANIZATION_CODE } from '@/lib/config';
import { 
  ArrowLeft, 
  Clock, 
  Calendar, 
  User, 
  Menu, 
  X,
  ArrowUp,
  Copy,
  ExternalLink,
  Check
} from 'lucide-react';

const ArticleScreen = () => {
  const params = useParams();
  const router = useRouter();
  const article_code = params?.article_code;
  
  const [article, setArticle] = useState(null);
  const [content, setContent] = useState('');
  const [parsedContent, setParsedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tableOfContents, setTableOfContents] = useState([]);
  const [activeSection, setActiveSection] = useState('');
  const [readingTime, setReadingTime] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Initialize markdown-it
  const [md] = useState(() => {
    const markdownIt = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return `<div class="code-block-wrapper mb-6">
              <div class="bg-gray-50 border rounded-lg overflow-hidden">
                <div class="flex items-center justify-between px-4 py-2 bg-gray-100 border-b">
                  <span class="text-sm font-medium text-gray-600 capitalize">${lang}</span>
                  <button 
                    class="copy-btn h-8 px-3 py-1 text-sm bg-transparent hover:bg-gray-200 rounded transition-colors flex items-center gap-2"
                    onclick="copyCodeToClipboard('${encodeURIComponent(str)}')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                  </button>
                </div>
                <div class="p-4 overflow-x-auto">
                  <pre class="text-sm"><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang }).value}</code></pre>
                </div>
              </div>
            </div>`;
          } catch (__) {}
        }

        return `<div class="code-block-wrapper mb-6">
          <div class="bg-gray-50 border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2 bg-gray-100 border-b">
              <span class="text-sm font-medium text-gray-600">Code</span>
              <button 
                class="copy-btn h-8 px-3 py-1 text-sm bg-transparent hover:bg-gray-200 rounded transition-colors flex items-center gap-2"
                onclick="copyCodeToClipboard('${encodeURIComponent(str)}')"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                </svg>
              </button>
            </div>
            <div class="p-4 overflow-x-auto">
              <pre class="text-sm"><code>${markdownIt.utils.escapeHtml(str)}</code></pre>
            </div>
          </div>
        </div>`;
      }
    });

    // Override heading rendering
    const defaultHeadingOpen = markdownIt.renderer.rules.heading_open || function(tokens, idx, options, env, renderer) {
      return renderer.renderToken(tokens, idx, options);
    };

    markdownIt.renderer.rules.heading_open = function (tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const level = token.tag.slice(1); // h1 -> 1, h2 -> 2, etc.
      
      // Get the heading text from the next token
      const nextToken = tokens[idx + 1];
      const headingText = nextToken && nextToken.content ? nextToken.content : '';
      
      // Generate ID safely
      const id = headingText
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();

      const classes = level === '1' ? 'text-3xl font-bold mt-12 mb-6 first:mt-0 scroll-mt-24' :
                     level === '2' ? 'text-2xl font-semibold mt-10 mb-4 scroll-mt-24' :
                     'text-xl font-medium mt-8 mb-3 scroll-mt-24';

      token.attrSet('id', id);
      token.attrSet('class', classes);
      
      return defaultHeadingOpen(tokens, idx, options, env, renderer);
    };

    // Override paragraph rendering
    const defaultParagraph = markdownIt.renderer.rules.paragraph_open || function(tokens, idx, options, env, renderer) {
      return renderer.renderToken(tokens, idx, options);
    };

    markdownIt.renderer.rules.paragraph_open = function (tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      token.attrSet('class', 'text-gray-700 leading-relaxed mb-4');
      return defaultParagraph(tokens, idx, options, env, renderer);
    };

    // Override list rendering
    markdownIt.renderer.rules.bullet_list_open = function () {
      return '<ul class="space-y-2 mb-6 ml-6 list-disc">\n';
    };

    markdownIt.renderer.rules.ordered_list_open = function () {
      return '<ol class="space-y-2 mb-6 ml-6 list-decimal">\n';
    };

    markdownIt.renderer.rules.list_item_open = function () {
      return '<li class="text-gray-700">';
    };

    // Override blockquote
    markdownIt.renderer.rules.blockquote_open = function () {
      return '<blockquote class="border-l-4 border-gray-300 pl-6 py-2 my-6 italic text-gray-600">\n';
    };

    // Override links
    const defaultLinkOpen = markdownIt.renderer.rules.link_open || function(tokens, idx, options, env, renderer) {
      return renderer.renderToken(tokens, idx, options);
    };

    markdownIt.renderer.rules.link_open = function (tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      token.attrSet('class', 'text-black underline hover:no-underline inline-flex items-center gap-1');
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpen(tokens, idx, options, env, renderer);
    };

    // Override inline code
    markdownIt.renderer.rules.code_inline = function (tokens, idx) {
      const token = tokens[idx];
      return `<code class="bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm font-mono">${markdownIt.utils.escapeHtml(token.content)}</code>`;
    };

    return markdownIt;
  });

  // Copy code function
  useEffect(() => {
    window.copyCodeToClipboard = async (encodedCode) => {
      try {
        const code = decodeURIComponent(encodedCode);
        await navigator.clipboard.writeText(code);
        
        // You could add a toast notification here
        console.log('Code copied to clipboard');
      } catch (err) {
        console.error('Failed to copy code:', err);
      }
    };

    return () => {
      delete window.copyCodeToClipboard;
    };
  }, []);

  // Calculate reading time
  const calculateReadingTime = (text) => {
    if (!text || typeof text !== 'string') return;
    const wordsPerMinute = 200;
    const wordCount = text.split(/\s+/).length;
    const time = Math.ceil(wordCount / wordsPerMinute);
    setReadingTime(time);
  };

  // Extract table of contents from markdown
  const extractTOC = (markdown) => {
    if (!markdown || typeof markdown !== 'string') return;
    
    const headingRegex = /^(#{1,3})\s+(.+)$/gm;
    const toc = [];
    let match;
    
    while ((match = headingRegex.exec(markdown)) !== null) {
      const level = match[1].length;
      const text = match[2] || '';
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();
      
      if (level <= 3 && text.trim()) {
        toc.push({ level, text: text.trim(), id });
      }
    }
    
    setTableOfContents(toc);
  };

  // Parse markdown content
  useEffect(() => {
    if (content && typeof content === 'string') {
      try {
        const parsed = md.render(content);
        // Sanitize before this reaches dangerouslySetInnerHTML — article
        // content can come from an author's stored input, so it must never
        // be trusted as-is (stored XSS, see AUDIT_FIXES.md).
        setParsedContent(typeof window !== 'undefined' ? DOMPurify.sanitize(parsed) : '');
      } catch (error) {
        console.error('Markdown parsing error:', error);
        // Fallback to escaped raw content
        setParsedContent(`<pre class="whitespace-pre-wrap">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
      }
    }
  }, [content, md]);

  useEffect(() => {
    const handleScroll = () => {
      const sections = document.querySelectorAll('h1[id], h2[id], h3[id]');
      let currentSection = '';
      
      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top <= 100) {
          currentSection = section.id;
        }
      });
      
      setActiveSection(currentSection);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!article_code) return;

    const fetchArticle = async () => {
      try {
        setLoading(true);
        setError(null);

        const articleResponse = await fetch(`${API_BASE_URL}/articles/${article_code}?organization_code=${encodeURIComponent(ORGANIZATION_CODE)}`);
        
        if (!articleResponse.ok) {
          throw new Error(`Failed to fetch article: ${articleResponse.status}`);
        }

        const articleData = await articleResponse.json();
        setArticle(articleData);

        const contentResponse = await fetch(articleData.article_content);
        
        if (!contentResponse.ok) {
          throw new Error(`Failed to fetch article content: ${contentResponse.status}`);
        }

        const contentText = await contentResponse.text();
        setContent(contentText);
        calculateReadingTime(contentText);
        extractTOC(contentText);

      } catch (err) {
        setError(err.message);
        console.error('Error fetching article:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchArticle();
  }, [article_code]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-gray-600">Loading article...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto">
              <X className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            <p className="text-gray-600">{error}</p>
            <Button onClick={() => router.back()} className="w-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!article) return null;

  return (
    <>
      <Head>
        <title>{article.article_title}</title>
        <meta name="description" content={`${article.article_title} - ${article.article_category}`} />
        <meta name="author" content={article.author} />
      </Head>

      <div className="min-h-screen bg-white">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white border-b">
          <div className="flex items-center justify-between p-4 max-w-7xl mx-auto">
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                {readingTime} min read
              </div>
              
              {tableOfContents.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="lg:hidden"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  <Menu className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto flex">
          {/* Sidebar */}
          {tableOfContents.length > 0 && (
            <>
              <aside className="hidden lg:block w-64 sticky top-16 h-fit">
                <div className="p-6">
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-500 mb-4">
                    Contents
                  </h3>
                  <ScrollArea className="h-[calc(100vh-200px)]">
                    <nav className="space-y-1">
                      {tableOfContents.map((item, index) => (
                        <a
                          key={index}
                          href={`#${item.id}`}
                          className={`block py-2 px-3 text-sm transition-colors hover:bg-gray-100 rounded ${
                            activeSection === item.id 
                              ? 'text-black font-medium bg-gray-100' 
                              : 'text-gray-600'
                          }`}
                          style={{ paddingLeft: `${(item.level - 1) * 0.75 + 0.75}rem` }}
                        >
                          {item.text}
                        </a>
                      ))}
                    </nav>
                  </ScrollArea>
                </div>
              </aside>

              {sidebarOpen && (
                <div className="lg:hidden fixed inset-0 z-50 bg-black/20" onClick={() => setSidebarOpen(false)}>
                  <div className="bg-white w-80 h-full shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between p-4 border-b">
                      <h3 className="font-semibold">Contents</h3>
                      <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <ScrollArea className="h-[calc(100vh-80px)]">
                      <nav className="p-4 space-y-1">
                        {tableOfContents.map((item, index) => (
                          <a
                            key={index}
                            href={`#${item.id}`}
                            onClick={() => setSidebarOpen(false)}
                            className="block py-2 px-3 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            style={{ paddingLeft: `${(item.level - 1) * 0.75 + 0.75}rem` }}
                          >
                            {item.text}
                          </a>
                        ))}
                      </nav>
                    </ScrollArea>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Main Content */}
          <main className="flex-1 max-w-4xl mx-auto">
            <article className="p-6 lg:p-8">
              {/* Article Header */}
              <header className="mb-12 pb-8 border-b">
                <Badge variant="outline" className="mb-4">
                  {article.article_category}
                </Badge>
                
                <h1 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight">
                  {article.article_title}
                </h1>
                
                <div className="flex flex-wrap items-center gap-6 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {article.author}
                  </div>
                  
                  <Separator orientation="vertical" className="h-4" />
                  
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {new Date(article.createdAt).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </div>
                  
                  <div className="flex items-center gap-2 sm:hidden">
                    <Clock className="w-4 h-4" />
                    {readingTime} min read
                  </div>
                </div>
              </header>

              {/* Article Content */}
              <div 
                className="prose prose-gray max-w-none"
                dangerouslySetInnerHTML={{ __html: parsedContent }}
              />
            </article>
          </main>
        </div>

        {/* Footer */}
        <footer className="border-t bg-gray-50 mt-12">
          <div className="max-w-7xl mx-auto p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                Last updated: {new Date(article.updatedAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <ArrowUp className="w-4 h-4 mr-2" />
                  Back to Top
                </Button>
                
                <Button onClick={() => router.back()}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Articles
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default ArticleScreen;
