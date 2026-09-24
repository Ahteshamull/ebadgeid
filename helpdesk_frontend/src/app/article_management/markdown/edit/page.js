"use client"
import React, { useState, useRef, useEffect } from 'react';
import { Save, Eye, Download, FileText, Copy, CheckCircle, AlertCircle, Moon, Sun, Settings } from 'lucide-react';
import { API_BASE_URL, FTP_BASE_URL } from '@/lib/config';
import DOMPurify from 'dompurify';

export default function MarkdownEditor() {
  const [content, setContent] = useState('<h1>Welcome to Your Blog Post</h1><p>This is your <strong>TinyMCE editor</strong> where you can write beautiful content.</p><h2>Features</h2><ul><li><strong>Rich text editing</strong> with WYSIWYG interface</li><li><strong>Markdown export</strong> for your blog</li><li>Tables, images, and media support</li><li>Code blocks and syntax highlighting</li><li>Real-time collaboration ready</li></ul><h2>Code Example</h2><pre class="language-javascript"><code>function blogPost() {\n  return "Hello World!";\n}</code></pre><p>Start writing your amazing content here!</p>');
  
  const [title, setTitle] = useState('My New Blog Post');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saving', 'saved', 'error'
  const [exportStatus, setExportStatus] = useState(''); // 'exporting', 'exported', 'error'
  const [showSettings, setShowSettings] = useState(false);
  const [markdownContent, setMarkdownContent] = useState('');
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [articleCode, setArticleCode] = useState('');
  
  const editorRef = useRef(null);
  const editorInstanceRef = useRef(null);

  // Extract article_code from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('article_code');
    if (code) {
      setArticleCode(code);
      console.log('Article code extracted from URL:', code);
    } else {
      console.warn('No article_code found in URL parameters');
    }
  }, []);

  // Upload image to storage server
  const uploadImage = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${FTP_BASE_URL}/api/uploads`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload image');
      }
      
      const data = await response.json();
      return data.url; // Assuming the server returns { url: "image_url" }
    } catch (error) {
      console.error('Image upload error:', error);
      throw error;
    }
  };

  // Upload markdown file to storage server
  const uploadMarkdownFile = async (content, filename) => {
    try {
      const blob = new Blob([content], { type: 'text/markdown' });
      const formData = new FormData();
      formData.append('file', blob, filename);
      
      const response = await fetch(`${FTP_BASE_URL}/api/uploads`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload markdown file');
      }
      
      const data = await response.json();
      return data.url; // Assuming the server returns { url: "file_url" }
    } catch (error) {
      console.error('Markdown upload error:', error);
      throw error;
    }
  };

 // Update article with content URL
  const updateArticleContentUrl = async (contentUrl) => {
    try {
      const response = await fetch(`${API_BASE_URL}/articles/${articleCode}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          article_content: contentUrl,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update article');
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Article update error:', error);
      throw error;
    }
  };

  // Load TinyMCE script
  useEffect(() => {
    if (window.tinymce) {
      setEditorLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.tiny.cloud/1/gkrm6jjt2bcwfn3en20szpzjk5pneyzkh932m8dbjrw6gwtu/tinymce/6/tinymce.min.js';
    script.onload = () => {
      setEditorLoaded(true);
    };
    script.onerror = () => {
      console.error('Failed to load TinyMCE');
      setEditorLoaded(false);
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup
      if (window.tinymce) {
        window.tinymce.remove();
      }
    };
  }, []);

  // Initialize TinyMCE when loaded
  useEffect(() => {
    if (!editorLoaded || !window.tinymce) return;

    // Remove existing editor if it exists
    if (window.tinymce.get('blog-editor')) {
      window.tinymce.get('blog-editor').remove();
    }

    const initEditor = () => {
      window.tinymce.init({
        selector: '#blog-editor',
        height: 500,
        menubar: false,
        plugins: [
          'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
          'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
          'insertdatetime', 'media', 'table', 'help', 'wordcount', 'codesample'
        ],
        toolbar: 'undo redo | blocks | bold italic forecolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link image media table | codesample code preview | fullscreen help',
        // Custom image upload handler
        images_upload_handler: async (blobInfo, progress) => {
          try {
            progress(0);
            const imageUrl = await uploadImage(blobInfo.blob());
            progress(100);
            return imageUrl;
          } catch (error) {
            console.error('Image upload failed:', error);
            throw new Error('Image upload failed. Please try again.');
          }
        },
        // Allow all image file types
        images_file_types: 'jpg,jpeg,png,gif,webp,svg',
        // Automatic uploads enabled
        automatic_uploads: true,
        content_style: `
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            font-size: 14px; 
            line-height: 1.6;
            max-width: none;
            margin: 1rem;
          }
          h1, h2, h3, h4, h5, h6 { 
            margin-top: 1.5em; 
            margin-bottom: 0.5em; 
            color: #1a1a1a;
          }
          p { margin-bottom: 1em; }
          pre { 
            background: #f8f9fa; 
            padding: 1em; 
            border-radius: 6px; 
            border-left: 4px solid #007acc;
            overflow-x: auto;
          }
          code { 
            background: #f1f3f4; 
            padding: 0.2em 0.4em; 
            border-radius: 3px; 
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          }
          blockquote {
            border-left: 4px solid #ddd;
            margin: 1em 0;
            padding-left: 1em;
            color: #666;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
          }
          table th, table td {
            border: 1px solid #ddd;
            padding: 0.5em;
            text-align: left;
          }
          table th {
            background-color: #f8f9fa;
            font-weight: bold;
          }
          img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
        `,
        placeholder: 'Start writing your blog post...',
        skin: isDarkMode ? 'oxide-dark' : 'oxide',
        content_css: isDarkMode ? 'dark' : 'default',
        setup: (editor) => {
          editor.on('change keyup paste', () => {
            const htmlContent = editor.getContent();
            setContent(htmlContent);
            setMarkdownContent(htmlToMarkdown(htmlContent));
          });
        },
        init_instance_callback: (editor) => {
          editorInstanceRef.current = editor;
          editor.setContent(content);
          setEditorReady(true);
        }
      });
    };

    // Small delay to ensure DOM is ready
    setTimeout(initEditor, 100);

    return () => {
      if (editorInstanceRef.current) {
        editorInstanceRef.current.remove();
        editorInstanceRef.current = null;
      }
    };
  }, [editorLoaded, isDarkMode]);

  // Simple HTML to Markdown converter
  const htmlToMarkdown = (html) => {
    return html
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
      .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      .replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)')
      .replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)')
      .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
      .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi, '```\n$1\n```\n')
      .replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```\n')
      .replace(/<ul[^>]*>/gi, '')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<ol[^>]*>/gi, '')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      // Get content from TinyMCE
      const htmlContent = editorInstanceRef.current ? editorInstanceRef.current.getContent() : content;
      const markdown = htmlToMarkdown(htmlContent);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // In real implementation:
      // await savePost({ title, content: markdown, html: htmlContent });
      
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

const handleExport = async () => {
    if (!articleCode) {
      alert('Article code not found in URL. Please ensure you are accessing this page with a valid article code.');
      return;
    }

    setExportStatus('exporting');
    try {
      // Get content from TinyMCE
      const htmlContent = editorInstanceRef.current ? editorInstanceRef.current.getContent() : content;
      const markdown = htmlToMarkdown(htmlContent);
      
      // Create filename for local download
      const filename = `${title.toLowerCase().replace(/\s+/g, '-')}.md`;
      console.log('Starting export with filename:', filename);
      
      // Upload markdown file to storage server
      const contentUrl = await uploadMarkdownFile(markdown, filename);
      console.log('Got content URL from upload:', contentUrl);
      
      // Update article with content URL (use the actual URL returned by server)
      const updateResult = await updateArticleContentUrl(contentUrl);
      console.log('Article update completed:', updateResult);
      
      setExportStatus('exported');
      
      // Also download locally for user
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setTimeout(() => setExportStatus(''), 3000);
    } catch (error) {
      console.error('Export failed:', error);
      setExportStatus('error');
      setTimeout(() => setExportStatus(''), 3000);
    }
  };

  const copyToClipboard = async () => {
    try {
      const htmlContent = editorInstanceRef.current ? editorInstanceRef.current.getContent() : content;
      const markdown = htmlToMarkdown(htmlContent);
      await navigator.clipboard.writeText(markdown);
      // Show success feedback
      console.log('Copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getPreviewContent = () => {
    const raw = showPreview
      ? (editorInstanceRef.current ? editorInstanceRef.current.getContent() : content)
      : content;
    // Sanitize before this ever reaches dangerouslySetInnerHTML — the raw
    // editor output can contain <script>/onerror/etc. injected by whoever
    // has access to this editor (stored XSS, see AUDIT_FIXES.md).
    if (typeof window === 'undefined') return '';
    return DOMPurify.sanitize(raw);
  };

  const getWordCount = () => {
    if (editorInstanceRef.current && editorInstanceRef.current.plugins.wordcount) {
      return editorInstanceRef.current.plugins.wordcount.getCount();
    }
    const text = content.replace(/<[^>]*>/g, '');
    return text.split(/\s+/).filter(word => word.length > 0).length;
  };

  const getCharCount = () => {
    const text = editorInstanceRef.current ? 
      editorInstanceRef.current.getContent({ format: 'text' }) : 
      content.replace(/<[^>]*>/g, '');
    return text.length;
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDarkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'
    }`}>
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className={`rounded-lg shadow-sm border p-6 mb-6 ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold">Markdown Editor</h1>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  showPreview 
                    ? 'bg-blue-600 text-white' 
                    : isDarkMode 
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Eye className="w-4 h-4" />
                {showPreview ? 'Edit' : 'Preview'}
              </button>
              
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`p-2 rounded-lg transition-colors ${
                  isDarkMode 
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  isDarkMode 
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Article Code Display */}
          {articleCode && (
            <div className={`mb-4 p-3 rounded-lg ${
              isDarkMode ? 'bg-blue-900/20 border-blue-700' : 'bg-blue-50 border-blue-200'
            } border`}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-sm font-medium">Article Code: {articleCode}</span>
              </div>
            </div>
          )}

          {/* Title Input */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter your blog post title..."
            className={`w-full text-xl font-semibold bg-transparent border-b-2 border-dashed pb-2 mb-4 focus:outline-none focus:border-blue-500 transition-colors ${
              isDarkMode ? 'border-gray-600' : 'border-gray-300'
            }`}
          />

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saveStatus === 'saving' ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : saveStatus === 'saved' ? (
                <CheckCircle className="w-4 h-4" />
              ) : saveStatus === 'error' ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Save'}
            </button>
            
            <button
              onClick={handleExport}
              disabled={exportStatus === 'exporting' || !articleCode}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                exportStatus === 'exported' 
                  ? 'bg-green-600 text-white' 
                  : exportStatus === 'error'
                    ? 'bg-red-600 text-white'
                    : isDarkMode 
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {exportStatus === 'exporting' ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : exportStatus === 'exported' ? (
                <CheckCircle className="w-4 h-4" />
              ) : exportStatus === 'error' ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {exportStatus === 'exporting' ? 'Uploading...' : exportStatus === 'exported' ? 'Exported!' : exportStatus === 'error' ? 'Failed' : 'Export & Upload'}
            </button>
            
            <button
              onClick={copyToClipboard}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                isDarkMode 
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className={`rounded-lg shadow-sm border p-6 mb-6 ${
            isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
          }`}>
            <h3 className="text-lg font-semibold mb-4">Editor Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Font Size</label>
                <select className={`w-full p-2 rounded border ${
                  isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}>
                  <option>12px</option>
                  <option>14px</option>
                  <option>16px</option>
                  <option>18px</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Theme</label>
                <select className={`w-full p-2 rounded border ${
                  isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}>
                  <option>Default</option>
                  <option>Minimal</option>
                  <option>Modern</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Auto-save</label>
                <select className={`w-full p-2 rounded border ${
                  isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}>
                  <option>Off</option>
                  <option>Every 30s</option>
                  <option>Every 60s</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Editor Area */}
        <div className={`rounded-lg shadow-sm border overflow-hidden ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          {showPreview ? (
            // Preview Mode
            <div className="p-6">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold">Preview</h3>
                <span className="text-sm text-gray-500">Live preview of your content</span>
              </div>
              <div 
                className="prose max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: getPreviewContent() }}
              />
            </div>
          ) : (
            // Editor Mode
            <div className="relative">
              {/* Loading State */}
              {!editorReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white dark:bg-gray-800">
                  <div className="text-center">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Loading TinyMCE Editor...</p>
                  </div>
                </div>
              )}
              
              {/* TinyMCE Editor */}
              <div className={`${editorReady ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}>
                <textarea
                  id="blog-editor"
                  style={{ height: '500px', width: '100%' }}
                  defaultValue={content}
                />
              </div>
            </div>
          )}
        </div>

        {/* Stats Bar */}
        <div className={`mt-6 rounded-lg shadow-sm border p-4 ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-6">
              <span>Words: {getWordCount()}</span>
              <span>Characters: {getCharCount()}</span>
              <span>Reading time: ~{Math.ceil(getWordCount() / 200)} min</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${editorReady ? 'bg-green-500' : 'bg-gray-400'}`}></div>
              <span>TinyMCE {editorReady ? 'Ready' : 'Loading...'}</span>
            </div>
          </div>
        </div>

        {/* Implementation Note */}
        <div className={`mt-6 rounded-lg border p-4 ${
          isDarkMode ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-green-800 dark:text-green-200 mb-1">✅ Full Integration Complete!</h4>
              <p className="text-sm text-green-700 dark:text-green-300 mb-3">
                The editor now includes complete image upload and markdown export functionality:
              </p>
              <ul className="text-sm text-green-700 dark:text-green-300 space-y-1 ml-4">
                <li>✅ <strong>Image Upload</strong> - Drag & drop or click to upload images to your storage server</li>
                <li>✅ <strong>Automatic Image Handling</strong> - Images are uploaded and URLs are inserted automatically</li>
                <li>✅ <strong>Markdown Export & Upload</strong> - Export creates MD file and uploads to storage</li>
                <li>✅ <strong>Article Content URL Update</strong> - Automatically updates article with content_url</li>
                <li>✅ <strong>Article Code Detection</strong> - Extracts article_code from URL params</li>
                <li>✅ <strong>Progress Indicators</strong> - Visual feedback for upload and export operations</li>
              </ul>
              <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded border">
                <p className="text-xs font-medium mb-1">🔧 Server Endpoints Expected:</p>
                <ul className="text-xs space-y-0.5">
                  <li>• <code>POST {FTP_BASE_URL}/api/uploads</code> - Returns a managed file URL</li>
                  <li>• <code>PUT {API_BASE_URL}/articles/:code</code> - Updates article with content_url</li>
                </ul>
                {articleCode && (
                  <p className="text-xs mt-2 text-blue-600 dark:text-blue-400">
                    📝 Current article code: <strong>{articleCode}</strong>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
