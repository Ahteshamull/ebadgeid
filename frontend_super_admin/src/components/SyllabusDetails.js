"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlusCircle, FileText, Book, ExternalLink, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";

export default function SyllabusDetails({ 
  syllabus, 
  onAddTopic, 
  onEditTopic, 
  onDeleteTopic 
}) {
  const [expandedTopics, setExpandedTopics] = useState({});

  const toggleTopic = (index) => {
    setExpandedTopics(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle>{syllabus.subject}</CardTitle>
          <Button 
            onClick={onAddTopic}
            className="flex items-center gap-2"
          >
            <PlusCircle size={16} />
            Add Topic
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="details">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="topics">Topics ({syllabus.topics?.length || 0})</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Syllabus Code</h3>
                <p>{syllabus.syllabus_code}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Class Code</h3>
                <p>{syllabus.class_code}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Teacher</h3>
                <p>{syllabus.teacher_username}</p>
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Description</h3>
              <p className="text-gray-700">{syllabus.subject_description}</p>
            </div>
            
            {syllabus.syllabus_document && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Syllabus Document</h3>
                <a 
                  href={syllabus.syllabus_document} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-800"
                >
                  <FileText size={16} />
                  <span>View Document</span>
                  <ExternalLink size={14} />
                </a>
              </div>
            )}
            
            {syllabus.recommendated_books && syllabus.recommendated_books.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Recommended Books</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {syllabus.recommendated_books.map((book, index) => (
                    <li key={index}>{book}</li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="topics">
            {!syllabus.topics || syllabus.topics.length === 0 ? (
              <div className="text-center py-12">
                <Book size={48} className="mx-auto text-gray-300 mb-4" />
                <h3 className="font-medium text-gray-700 mb-2">No Topics Added Yet</h3>
                <p className="text-gray-500 mb-6">Add your first topic to this syllabus</p>
                <Button onClick={onAddTopic} className="flex items-center gap-2 mx-auto">
                  <PlusCircle size={16} />
                  Add First Topic
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {syllabus.topics.map((topic, index) => (
                    <Card key={index} className="border border-gray-200">
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <h3 className="font-medium">{topic.title}</h3>
                            <Badge variant="outline">{topic.difficulty_level}</Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => onEditTopic(topic, index)}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => onDeleteTopic(index)}
                            >
                              <Trash2 size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => toggleTopic(index)}
                            >
                              {expandedTopics[index] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </Button>
                          </div>
                        </div>
                        
                        <p className="text-sm text-gray-600 mt-1">{topic.short_description}</p>
                        
                        {expandedTopics[index] && (
                          <div className="mt-4 pt-4 border-t space-y-4">
                            <div>
                              <h4 className="text-sm font-medium text-gray-500 mb-1">Detailed Description</h4>
                              <p className="text-sm">{topic.long_description}</p>
                            </div>
                            
                            {topic.sub_topics && topic.sub_topics.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-500 mb-2">Sub-topics</h4>
                                <ul className="list-disc pl-5 space-y-1">
                                  {topic.sub_topics.map((subTopic, subIndex) => (
                                    <li key={subIndex} className="text-sm">{subTopic}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            
                            {topic.supporting_documents && topic.supporting_documents.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-500 mb-2">Supporting Documents</h4>
                                <div className="space-y-2">
                                  {topic.supporting_documents.map((doc, docIndex) => (
                                    <a 
                                      key={docIndex}
                                      href={doc.document_link}
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="block p-2 border rounded flex items-center gap-2 hover:bg-gray-50"
                                    >
                                      <FileText size={16} className="text-gray-500" />
                                      <div>
                                        <div className="text-sm font-medium">{doc.document_name}</div>
                                        <div className="text-xs text-gray-500 truncate">{doc.document_link}</div>
                                      </div>
                                      <ExternalLink size={14} className="ml-auto text-gray-400" />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}