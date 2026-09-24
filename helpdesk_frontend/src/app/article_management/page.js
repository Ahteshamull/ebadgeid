'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { API_BASE_URL } from '@/lib/config';

export default function ArticleManagement() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [formData, setFormData] = useState({
    article_code: '',
    article_title: '',
    article_category: '',
    article_content: '',
    author: ''
  });

  // Fetch articles
  const fetchArticles = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/articles/manage`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch articles');
      }
      const data = await response.json();
      setArticles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Create article
  const createArticle = async (e) => {
    e.preventDefault();
    try {
      setCreateLoading(true);
      const response = await fetch(`${API_BASE_URL}/articles/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to create article');
      }

      // Reset form and close modal
      setFormData({
        article_code: '',
        article_title: '',
        article_category: '',
        article_content: '',
        author: ''
      });
      setShowCreateForm(false);
      setShowSuccessMessage(true);
      
      // Refresh articles list
      await fetchArticles();
      
      // Hide success message after 5 seconds
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  // Delete article
  const deleteArticle = async (articleCode) => {
    if (!confirm('Are you sure you want to delete this article?')) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/articles/${encodeURIComponent(articleCode)}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete article');
      }

      // Refresh articles list
      await fetchArticles();
    } catch (err) {
      setError(err.message);
    }
  };

  // Edit markdown - redirect to edit page
  const editMarkdown = (articleCode) => {
    window.location.href = `/article_management/markdown/edit?article_code=${articleCode}`;
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCreateClick = () => {
    setFormData(prev => ({
      ...prev,
      article_content: ''
    }));
    setShowCreateForm(true);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex space-x-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl font-bold">Article Management</CardTitle>
              <CardDescription>Manage your articles and content</CardDescription>
            </div>
            <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
              <DialogTrigger asChild>
                <Button onClick={handleCreateClick} className="gap-2">
                  <Plus size={20} />
                  Create Article
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Create New Article</DialogTitle>
                  <DialogDescription>
                    Fill in the details to create a new article. The content URL is auto-generated.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={createArticle} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="article_code">Article Code</Label>
                    <Input
                      id="article_code"
                      name="article_code"
                      value={formData.article_code}
                      onChange={handleInputChange}
                      placeholder="e.g., EDU-001"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="article_title">Article Title</Label>
                    <Input
                      id="article_title"
                      name="article_title"
                      value={formData.article_title}
                      onChange={handleInputChange}
                      placeholder="e.g., Education for All"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="article_category">Category</Label>
                    <Input
                      id="article_category"
                      name="article_category"
                      value={formData.article_category}
                      onChange={handleInputChange}
                      placeholder="e.g., Education"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="article_content">Content URL</Label>
                    <Input
                      id="article_content"
                      name="article_content"
                      value={formData.article_content}
                      onChange={handleInputChange}
                      placeholder="Auto-generated content URL"
                      required
                      readOnly
                      className="bg-gray-50"
                    />
                    <p className="text-xs text-muted-foreground">
                      This URL is auto-generated. You can edit the markdown content after creation.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="author">Author</Label>
                    <Input
                      id="author"
                      name="author"
                      value={formData.author}
                      onChange={handleInputChange}
                      placeholder="e.g., OpenAI Writer"
                      required
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCreateForm(false)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createLoading}
                      className="flex-1"
                    >
                      {createLoading ? 'Creating...' : 'Create Article'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
      </Card>

      {/* Success Message */}
      {showSuccessMessage && (
        <Alert className="border-green-200 bg-green-50">
          <FileText className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Article created successfully! Please remember to add your content and markdown to the generated file.
          </AlertDescription>
        </Alert>
      )}

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Articles Table */}
      <Card>
        <CardHeader>
          <CardTitle>Articles</CardTitle>
          <CardDescription>
            {articles.length} article{articles.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Article Code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan="6" className="text-center py-8 text-muted-foreground">
                    No articles found. Create your first article!
                  </TableCell>
                </TableRow>
              ) : (
                articles.map((article) => (
                  <TableRow key={article._id}>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono">
                        {article.article_code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {article.article_title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {article.article_category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {article.author}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(article.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => editMarkdown(article.article_code)}
                          className="gap-1"
                        >
                          <Edit size={14} />
                          Edit Markdown
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteArticle(article.article_code)}
                          className="gap-1 text-red-600 hover:text-red-800 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
