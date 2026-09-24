'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function FAQManagementPage() {
  const [faqs, setFaqs] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedFaq, setSelectedFaq] = useState(null);
  const [formData, setFormData] = useState({
    faq_title: '',
    faq_body: '',
    faq_status: 'visible',
  });


  const fetchFAQs = async () => {
    try {
      const response = await apiClient.get('/faqs/');
      setFaqs(response.data.data || response.data);
    } catch (error) {
      console.error('Failed to fetch FAQs:', error);
      toast.error('Failed to fetch FAQs');
    }
  };

  useEffect(() => {
    fetchFAQs();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSelectChange = (value) => {
    setFormData({ ...formData, faq_status: value });
  };

  const resetForm = () => {
    setFormData({
      faq_title: '',
      faq_body: '',
      faq_status: 'visible',
    });
  };

  const handleCreateSubmit = async () => {
    try {
      const response = await apiClient.post('/faqs/create', formData);
      setFaqs([...faqs, response.data]);
      setCreateOpen(false);
      resetForm();
      toast.success('FAQ created successfully');
    } catch (error) {
      console.error('Failed to create FAQ:', error);
      toast.error('Failed to create FAQ');
    }
  };

  const handleEditSubmit = async () => {
    try {
      const response = await apiClient.put(`/faqs/${selectedFaq._id}`, formData);
      setFaqs(faqs.map(faq => faq._id === selectedFaq._id ? response.data : faq));
      setEditOpen(false);
      setSelectedFaq(null);
      resetForm();
      toast.success('FAQ updated successfully');
    } catch (error) {
      console.error('Failed to update FAQ:', error);
      toast.error('Failed to update FAQ');
    }
  };

  const handleEdit = (faq) => {
    setSelectedFaq(faq);
    setFormData({
      faq_title: faq.faq_title,
      faq_body: faq.faq_body,
      faq_status: faq.faq_status,
    });
    setEditOpen(true);
  };

  const handleDelete = async (faqId) => {
    if (window.confirm('Are you sure you want to delete this FAQ?')) {
      try {
        await apiClient.delete(`/faqs/${faqId}`);
        setFaqs(faqs.filter(faq => faq._id !== faqId));
        toast.success('FAQ deleted successfully');
      } catch (error) {
        console.error('Failed to delete FAQ:', error);
        toast.error('Failed to delete FAQ');
      }
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const handleCreateCancel = () => {
    setCreateOpen(false);
    resetForm();
  };

  const handleEditCancel = () => {
    setEditOpen(false);
    setSelectedFaq(null);
    resetForm();
  };

  return (
    <div className="p-6 space-y-6 bg-white min-h-screen">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">FAQ Management</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Create FAQ
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create New FAQ</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Input
                name="faq_title"
                placeholder="FAQ Title"
                value={formData.faq_title}
                onChange={handleInputChange}
              />
              <Textarea
                name="faq_body"
                placeholder="FAQ Answer/Body"
                value={formData.faq_body}
                onChange={handleInputChange}
                rows={6}
              />
              <Select value={formData.faq_status} onValueChange={handleSelectChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="visible">Visible</SelectItem>
                  <SelectItem value="hidden">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCreateCancel}>Cancel</Button>
              <Button onClick={handleCreateSubmit}>Create FAQ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit FAQ</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              name="faq_title"
              placeholder="FAQ Title"
              value={formData.faq_title}
              onChange={handleInputChange}
            />
            <Textarea
              name="faq_body"
              placeholder="FAQ Answer/Body"
              value={formData.faq_body}
              onChange={handleInputChange}
              rows={6}
            />
            <Select value={formData.faq_status} onValueChange={handleSelectChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="visible">Visible</SelectItem>
                <SelectItem value="hidden">Hidden</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleEditCancel}>Cancel</Button>
            <Button onClick={handleEditSubmit}>Update FAQ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto border rounded-md">
        <Table>
          <TableHeader className="bg-gray-100">
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Body Preview</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {faqs.map((faq) => (
              <TableRow key={faq._id}>
                <TableCell className="font-medium max-w-xs">
                  <div className="truncate" title={faq.faq_title}>
                    {faq.faq_title}
                  </div>
                </TableCell>
                <TableCell className="max-w-md">
                  <div className="truncate text-gray-600" title={faq.faq_body}>
                    {faq.faq_body.length > 100 
                      ? `${faq.faq_body.substring(0, 100)}...` 
                      : faq.faq_body
                    }
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    faq.faq_status === 'visible' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {faq.faq_status.charAt(0).toUpperCase() + faq.faq_status.slice(1)}
                  </span>
                </TableCell>
                <TableCell>{formatDate(faq.createdAt)}</TableCell>
                <TableCell>{formatDate(faq.updatedAt)}</TableCell>
                <TableCell>
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleEdit(faq)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleDelete(faq._id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {faqs.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No FAQs found. Create your first FAQ to get started.
        </div>
      )}
    </div>
  );
}
