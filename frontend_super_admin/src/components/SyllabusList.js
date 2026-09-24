"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Pencil, Trash2, Book, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";

export default function SyllabusList({
  syllabi = [], // Default value to prevent undefined errors
  loading,
  selectedSyllabus,
  onSelectSyllabus,
  onEditSyllabus,
  onDeleteSyllabus
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredSyllabi, setFilteredSyllabi] = useState([]);

  // Update filtered syllabi whenever syllabi or searchTerm changes
  useEffect(() => {
    if (!syllabi || !Array.isArray(syllabi)) {
      setFilteredSyllabi([]);
      return;
    }

    const filtered = syllabi.filter(syllabus => 
      syllabus.subject.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredSyllabi(filtered);
  }, [syllabi, searchTerm]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute top-2.5 left-3 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search syllabi..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {filteredSyllabi.length === 0 ? (
        <div className="text-center py-8">
          <Book size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-gray-500 mb-2">No syllabi found</h3>
          {searchTerm ? (
            <p className="text-sm text-gray-400">Try adjusting your search</p>
          ) : (
            <p className="text-sm text-gray-400">Create your first syllabus to get started</p>
          )}
        </div>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-2 pr-3">
            {filteredSyllabi.map((syllabus) => (
              <div
                key={syllabus._id}
                className={`p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all border ${
                  selectedSyllabus && selectedSyllabus._id === syllabus._id
                    ? "bg-primary-50 border-primary-200"
                    : "bg-white hover:bg-gray-50 border-gray-100"
                }`}
                onClick={() => onSelectSyllabus(syllabus)}
              >
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{syllabus.subject}</h3>
                  <div className="flex gap-2 text-xs text-gray-500">
                    <span>{syllabus.syllabus_code}</span>
                    <span>•</span>
                    <span>{syllabus.class_code}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditSyllabus(syllabus);
                    }}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon" 
                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSyllabus(syllabus);
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}